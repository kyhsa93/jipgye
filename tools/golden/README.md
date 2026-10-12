# tools/golden — 같은-실행 비교 도구 (#236)

렌더러를 바꾸기 전에 "바뀌지 않았다"를 기계로 판정하는 자다(React SSG 체인, #235). 자체 `package.json`(parse5)이라
루트 `npm ci`·`node --test test/*.test.mjs`(CI)에는 설치되지 않는다 — **이 폴더의 시험은 CI에 들어가지 않고**, 여기서
`npm ci && npm test`로 돌린다. 루트 `test/`는 parse5를 import하지 않는다.

## 쓰는 법

```
cd tools/golden && npm ci
npm test                       # 고정 fixture만 읽는 시험(정준 덤프·변이 시험·비교기·렌더 격리·invariants) — 오늘의 docs/ 데이터를 읽지 않는다
npm run test:live              # 실제 저장소로: 자기 비교(TZ=UTC·Asia/Seoul), BUILD_NOW 시각 의존, invariants 자기 비교·실제 67장 변이, (GOLDEN_BASE_SHA가 있으면) 미설정 바이트 동일

node bin/render.mjs  --repo ../.. --sha HEAD --out /tmp/a  --env TZ=UTC --env BUILD_NOW=2026-10-11T00:00:00Z
node bin/render.mjs  --repo ../.. --sha HEAD --out /tmp/b  --env JIPGYE_RENDERER=react --env BUILD_NOW=2026-10-11T00:00:00Z
node bin/render.mjs  --repo ../.. --src ../.. --out /tmp/c --keep   # 미커밋 작업 트리 스냅숏으로 렌더. 스냅숏은 끝나면 지운다(--keep이면 남기고 경로를 출력)
node bin/compare.mjs /tmp/a /tmp/b [--bytes]     # 정준 비교(+ 바이트). 같으면 종료 0
node bin/bench.mjs   --repo ../.. --sha HEAD --runs 10   # 렌더 단계 시간 중앙값·상한

node bin/invariants.mjs --render --repo ../..    # 불변 조건(#274): merge-base와 작업 트리를 같은 BUILD_NOW로 렌더해 견준다. 하드 실패가 없으면 종료 0
node bin/invariants.mjs /tmp/a /tmp/b            # 이미 구운 폴더 둘(같은 입력·같은 BUILD_NOW로 구운 것만)
node bin/invariants.mjs --snapshot ../../docs --table   # 장별 표(robots·canonical·JS 바이트). --table을 빼면 스냅숏 JSON, 지문은 stderr
node bin/invariants.mjs --hooks-check --repo ../..      # 훅 클래스 목록이 소스와 맞는지(어긋나면 --hooks-write로 다시 만든다)
```

## 구성

- `lib/render.mjs` — 렌더 단계 여섯(`daily-update.yml`의 "정적 HTML에 오늘 내용 심기")을 **깨끗한 작업 사본**에서 돌린다.
  출발점(pristine)은 `git archive <SHA>`(커밋된 상태) 또는 `--src <디렉터리>`(작업 트리 스냅숏 — #238의 shadow가 "같은 렌더
  전 스냅숏"을 만들 때 쓰는 모양)이고, 렌더마다 복제해 쓰므로 저장소 `docs/`는 바뀌지 않고 두 렌더가 같은 출발점을 갖는다.
  호출자가 준 환경변수(`TZ`·`BUILD_NOW`·`JIPGYE_RENDERER`)만 들어간다.
- `lib/cleanup.mjs` — 임시 사본·캐시 정리(#263): 시작 전 디스크 점검, 신호·예외 때 정리 목록, 24시간 넘은 고아 정리, SHA 캐시 상한, 동시 실행용 rename 확정.
  아래 "임시 사본과 정리".
- `lib/canon.mjs` — 정준 덤프. 허용 차이는 주석·속성 순서·엔티티 표기·공백 줄이기(없애기는 불허)·인라인 script 줄바꿈뿐이다.
  head 메타 전부, 본문 텍스트(hidden 아래는 `[hidden]`), 제목 계층, 모든 href, 표 셀 속성, script src 순서, 인라인 script 본문(JSON 섬 포함)은 남긴다.
- `lib/compare.mjs` — 디렉터리 쌍 비교(정준·바이트), 줄 diff, 보고서.
- `lib/invariants.mjs`·`bin/invariants.mjs` — 불변 조건 비교(#274). 아래 "불변 조건(invariants)".
- `hook-classes.json` — 기계로 뽑은 훅 클래스 목록. 손으로 고치지 않는다.
- `lib/mock-date-now.mjs` — `--import`로 `Date.now()`를 `GOLDEN_MOCK_NOW`에 고정한다(BUILD_NOW 도입 전·후 코드 비교용).
- `test/mutation.test.mjs` — 비교기 변이 시험: 검출 4(표본 문장 삭제·noindex 제거·숫자 한 자리·인라인 script)·통과 1(속성 순서)·대조군.
  입력은 `test/fixtures/`의 고정 HTML 사본이다.

## 불변 조건(invariants) (#274)

Tailwind 도입과 디자인 개편은 구운 HTML의 class와 껍데기 구조를 바꾸므로 정준 비교(S1)는 합격 조건으로 못 쓴다.
invariants는 같은 parse5 트리에서 **디자인이 바뀌어도 변하면 안 되는 것**만 견준다. class·style 속성, 태그 이름과 트리 모양은 보지 않는다.

| check | 무엇을 | 판정 |
|---|---|---|
| `url-set` | `.html` 파일 이름 집합 | 하드 |
| `noindex` | 장마다 `meta[name=robots]`의 값(없음 포함) | 하드 |
| `head` | head의 `title`·`meta`·`link`·`base` 줄의 다중집합. 허용 예외는 `HEAD_EXCEPTIONS`(지금 `theme-color`의 값 하나) | 하드, 예외 값이 다르면 소프트 `head-exception` |
| `ld-json` | `script[type="application/ld+json"]` 개수(지금 0) | 하드 |
| `text` | body의 텍스트 노드(script·style 제외, 공백 줄이고 양끝 뗌, `hidden` 속성 아래는 `[hidden]` 표시)의 다중집합 | 하드 |
| `text-order` | 다중집합은 같은데 문서 순서가 다르다 | 소프트 |
| `attr-text` | 속성에 든 글자: `title`·`alt`·`placeholder`·`label`·`lang`·`dir`·`aria-label`·`data-label`·`data-*-en`의 다중집합 | 하드 |
| `links`·`link-target` | `a[href]`의 (href 원문·rel·target·링크 글자) 다중집합, 후보의 내부 링크 대상 파일이 있는지 | 하드 |
| `headings` | `h1`~`h6`의 (레벨·글자) 순서 | 하드 |
| `landmarks` | `main`·`nav` 개수, `.skip-link`의 href·그 대상 요소·본문 링크 중 몇 번째인지 | 하드 |
| `hooks` | 기준의 `id`·`data-*`·`aria-*`(이름=값)과 훅 클래스가 후보에 그 수만큼 있다 | 사라지면 하드, 늘면 소프트 `hooks-added`(PR에 목록) |
| `inline-script` | 인라인 script의 본문과 순서(한·영 문자열표가 여기 있다) | 하드 |
| `s6-scripts`·`s6-inline-bytes`·`s6-external-bytes`·`s6-src-missing`·`s6-js-total` | script 줄 목록이 늘거나 바뀌지 않는다, 인라인·외부 JS 바이트 합이 기준 이하, 폴더 안 `.js` 합이 기준 이하 | 늘면 하드, 줄면 통과(`scripts-removed`는 소프트) |
| `tw-dark` | 후보의 class·JS·CSS에 `tw:dark:` 변형이 없다(네 갈래 테마는 CSS 변수에서 갈린다) | 하드 |
| `semantic` | `role`·`hidden`·`name`·`for`·`scope`·`colspan` 따위 | 소프트 |

- **비교 조건.** 기준은 PR의 merge-base, 후보는 PR 머리(또는 작업 트리)이고 **같은 입력·같은 `BUILD_NOW`로 렌더한 둘**만 견준다.
  다른 날 데이터나 다른 `BUILD_NOW`로 구운 폴더끼리 견주면 디자인이 같아도 텍스트가 갈린다(#8 부류 — `test:live`가 하루 다른 쌍으로 보인다).
  `--render`가 이 조건을 지킨다: `--base`(기본 `git merge-base origin/main HEAD`)와 `--head <SHA>`/`--src <디렉터리>`(기본 작업 트리)를
  같은 `--build-now`(기본 기준 커밋의 커밋 시각)로 `renderIsolated`에 넣는다. 폴더 둘을 직접 줄 때는 부르는 쪽이 책임진다.
- **훅 클래스는 기계로 뽑는다.** `hook-classes.json`의 `js`는 `docs/` 아래 `.js`와 `docs/*.html` 인라인 script의
  `querySelector(All)`·`closest`·`matches`·`getElementsByClassName`·`classList`·`className`에서, `markup`은 루트 `test/*.mjs`와
  `scripts/build-*-pages.mjs`가 문자열로 쓰는 `class="…"`에서 뽑은 이름이다(`collectHookClasses`). 목록이 소스와 어긋나면
  `test/invariants.test.mjs`가 실패하고, `--hooks-write`로 다시 만든다. 비교 때는 목록에 **후보 폴더의 JS가 읽는 class**를 더한다.
  정규식 어림이라 변수로 조립한 선택자는 못 읽는다(`--hooks a,b`로 보탠다). 구운 HTML의 class 속성은 읽지 않는다 — `low-sample`처럼
  그날 데이터에 따라 나오는 class가 목록을 흔들지 않게 하려는 것이다.
- **의도한 차이.** 하드 항목을 일부러 바꾸는 PR은 차이를 PR 본문에 목록으로 적고 po·cmo가 확인한 것만 예외다(#274 범위 1).
  도구에는 `--expect <파일>`로 준다. 항목 문자열은 `--json`이 낸 결과에서 **글자 그대로** 옮겨 적는다 — 맞은 항목만 하드에서 빠지고,
  목록에 없는 차이는 그대로 실패한다. check를 통째로 면제하는 줄과 `reason`·`confirmedBy`가 빈 줄은 받지 않는다. 쓰이지 않은 줄은 보고서에 적힌다.
  폴더 단위 항목(`url-set`·`s6-js-total`·`tw-dark`)은 `page`에 `(폴더)`를 적는다. 이 모양은 engineer 제안이고 cto 확인 대상이다.

  ```json
  { "exceptions": [
    { "page": "index.html", "check": "inline-script",
      "missing": ["105:     budgetHeading: \"Search by budget\","], "added": ["105:     budgetHeading: \"Find by budget\","],
      "reason": "영어 제목 문구 교체", "confirmedBy": "po 확인 댓글 주소" }
  ] }
  ```
- **못 보는 것.** parse5는 CSS를 모른다. 유틸리티 class(`tw:hidden`·`tw:sr-only`·`tw:invisible`·`tw:opacity-0`)나 `style`로 본문을 숨겨도
  통과한다(`test/invariants.test.mjs`가 이 구멍을 시험으로 적어 둔다). 가로 넘침, 대화형 요소 크기, 대비, 초점 순서, `::before`가 그리는
  `attr(data-label)`도 못 본다. 이쪽은 #278 PR A의 렌더 검사 도구가 맡는다. 값이 같은 속성을 다른 요소로 옮긴 것(예: `aria-hidden="true"`)과
  텍스트 노드 사이의 공백도 보지 않는다(정준 비교는 본다).
- 스냅숏(`--snapshot`)은 기준선 기록용이다(#274 범위 3). 저장소에 커밋하지 않고 기준 SHA에서 다시 만든다: `git archive <SHA> docs | tar -x -C <폴더>` 뒤
  `node bin/invariants.mjs --snapshot <폴더>/docs`.

## 임시 사본과 정리 (#263)

이 도구가 디스크에 만드는 것은 셋이고, 사본 하나가 약 290MB다(`raw/` 272MB + `docs/` 15MB + 소스, #263 측정).

| 무엇 | 언제 지우나 |
|---|---|
| `$TMPDIR/jipgye-golden/snap-*` (`--src` 스냅숏) | **렌더가 끝나면** `pristine.dispose()`가 지운다(성공·실패·SIGINT·SIGTERM·SIGHUP 모두). 남기려면 `--keep`(경로를 출력, 7일 뒤 고아 정리) |
| `$TMPDIR/jipgye-render-*` (렌더 한 번의 작업 사본) | 렌더마다 `dispose()`. 렌더 단계가 예외로 끝나도 `renderIsolated`가 먼저 지우고 던진다 |
| `$TMPDIR/jipgye-golden/sha-<SHA>` (`git archive` 캐시) | 지우지 않고 재사용한다. 쓸 때마다 `.done`의 mtime을 올리고(atime은 믿지 못한다), 개수 상한을 넘으면 **mtime이 오래된 것부터** 지운다. 지금 쓰는 것과 10분 안에 쓴 것은 남긴다 |

- **시작 전 디스크 점검**: 캐시 폴더와 렌더 사본 폴더(`os.tmpdir()`) 둘의 `statfs` 여유가 5GiB 미만이면 아무것도 만들지 않고 종료 3으로 멈춘다(`bin/render.mjs`·`bin/bench.mjs`).
- **고아 정리**: SIGKILL·`ENOSPC`는 정리할 틈이 없으므로, 시작 때 24시간 넘은 `snap-*`·`jipgye-render-*`·만들다 만 `sha-*.tmp-*`를 지운다. 폴더마다 `.golden-owner`(pid·생성 시각)를 두고 그 pid가 살아 있으면 건드리지 않는다.
- **동시 실행**: `.done`은 잠금이 아니라 "다 만들었다"는 표시다. SHA 캐시는 `sha-<SHA>.tmp-XXXXXX`에 끝까지 만들고 `rename`으로 확정한다 — 둘이 동시에 만들면 먼저 확정한 쪽이 이기고 진 쪽은 자기 것을 지우고 이긴 쪽을 쓴다. 스냅숏·렌더 사본은 매번 새 이름이라 겹치지 않는다.
- 상한·문턱은 환경변수로 바꾼다(시험이 이 값을 주입한다): `GOLDEN_MIN_FREE_GB`(기본 5, GiB), `GOLDEN_CACHE_MAX_SHA`(기본 8 ≈ 2.3GB), `GOLDEN_CACHE_GRACE_MIN`(기본 10분), `GOLDEN_ORPHAN_HOURS`(기본 24).
  라이브러리로 쓰면 같은 값을 `preparePristine`·`renderIsolated`의 옵션(`minFreeBytes`·`maxShaCaches`·`graceMs`·`orphanMs`)으로 준다. 기본값은 engineer 제안이고 cto 확인 대상이다.
- 라이브러리로 쓸 때: `preparePristine`이 돌려주는 객체의 `dispose()`(스냅숏이면 지우고 SHA 캐시면 남긴다)와 `renderIsolated`가 돌려주는 객체의 `dispose()`를 `finally`에서 부른다.
  CLI는 `installSignalHandlers()`로 신호 때 같은 정리를 한다(라이브러리를 import만 해서는 신호 처리기가 걸리지 않는다).
- **#238(F1) shadow가 Actions 러너에서 같은 도구를 쓸 때**: 러너는 일회용이라 여러 날 쌓이지는 않지만 한 실행 안에서 사본 수·용량에 상한이 필요하다 —
  렌더 2회 + 스냅숏 1개 ≈ 870MB(ext4 러너는 reflink가 없어 렌더마다 전체 복사). shadow는 렌더를 끝낼 때마다 `dispose()`하고 실패 경로(`continue-on-error`)에서도 `finally`로 지울 것.

## 한계

- 신호 처리는 `spawnSync`(rsync·cp·git)가 도는 동안 그 호출이 끝난 뒤로 미뤄진다(이벤트 루프가 막힌다). Ctrl-C(프로세스 그룹 전체에 간다)는 그 자식도 끊는다. SIGKILL은 못 잡으므로 다음 시작 때의 고아 정리가 맡는다.
- 고아 정리가 pid로 보호하므로, 죽은 실행의 pid를 다른 프로세스가 재사용하고 있으면 그 고아는 그 프로세스가 끝날 때까지 남는다.

- 이 폴더의 시험은 CI에 없다(워크플로를 바꾸지 않는다, #236). 변이 시험·자기 비교는 PR 본문에 명령·출력을 붙여 증빙한다.
  `npm test` 가운데 "훅 클래스 목록이 소스와 맞는다" 하나만 저장소의 코드(`docs/`의 JS·인라인 script, `test/*.mjs`, `scripts/build-*-pages.mjs`)를 읽는다 — 데이터는 읽지 않는다.
  정리 시험(`test/cleanup.test.mjs`)은 고정 가짜 저장소만 쓰고 시험마다 자기 폴더 안에서 돌아 끝에 지운다.
- 공백 줄이기는 CSS 공백 접힘을 흉내 낸 규칙이다(블록 요소의 시작·끝·이웃에서만 공백을 뺀다). 화면에서 달라 보이는 공백 차이는 잡고,
  화면에서 같은 공백 차이는 통과시킨다.
- 비교 대상은 `.html`이다. JSON·CSS·JS의 차이는 `--bytes`로 따로 본다.
