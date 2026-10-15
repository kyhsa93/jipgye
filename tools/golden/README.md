# tools/golden — 같은-실행 비교 도구 (#236)

렌더러를 바꾸기 전에 "바뀌지 않았다"를 기계로 판정하는 자다(React SSG 체인, #235). 자체 `package.json`(parse5)이라
루트 `npm ci`·`node --test 'test/*.test.{mjs,ts}'`에는 설치되지 않는다 — CI(`.github/workflows/test.yml`)가 루트 시험 뒤에
이 폴더에서 따로 `npm ci && npm test`를 돌린다(#289 PR 2). 손으로 돌릴 때도 같다. 루트 `test/`는 parse5를 import하지 않는다.

## 쓰는 법

```
cd tools/golden && npm ci
npm test                       # 고정 fixture만 읽는 시험(정준 덤프·변이 시험·비교기·렌더 격리·invariants) — 오늘의 docs/ 데이터를 읽지 않는다
npm run test:live              # 실제 저장소로: 자기 비교(TZ=UTC·Asia/Seoul), BUILD_NOW 시각 의존, invariants 자기 비교·실제 67장 변이(#274 셋, #289 여섯), (GOLDEN_BASE_SHA가 있으면) 미설정 바이트 동일

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
invariants는 같은 parse5 트리에서 **디자인이 바뀌어도 변하면 안 되는 것**만 견준다. class·style 속성, 블록·중립 인라인 태그의 이름과 트리 모양은 보지 않는다.

| check | 무엇을 | 판정 |
|---|---|---|
| `url-set` | `.html` 파일 이름 집합 | 하드 |
| `noindex` | 장마다 head의 `meta[name=robots]` **전부**의 값 다중집합(없음 포함, 이름은 대소문자 무시). 앞에 `none`을 하나 더 끼워도 잡힌다 | 하드 |
| `body-meta` | body 안의 `meta`·`base` 줄의 다중집합(body에 놓은 robots·`http-equiv=refresh`·base) | 하드 |
| `head` | head의 `title`·`meta`·`link`·`base` 줄과 head 안 `noscript` 본문의 다중집합. 허용 예외는 `HEAD_EXCEPTIONS`(지금 `theme-color`의 값 하나) | 하드, 예외 값이 다르면 소프트 `head-exception`(media별로 여럿이면 전부 적는다) |
| `ld-json` | `script[type="application/ld+json"]` 개수(지금 0) | 하드 |
| `text` | body의 **블록 단위 글자 흐름**의 다중집합(아래 "블록 단위 글자 흐름"). 블록 안의 글자·공백·뜻 있는 인라인 태그와 숨김 표시가 한 항목이다 | 하드 |
| `text-wrap` | 글자 흐름은 같고 텍스트 노드가 잘린 자리만 다른 블록(중립 인라인으로 일부를 감싸거나 풀었다, 공백 자리에 br). 블록 모양과 장별 수(`블록 n개 — 래퍼 a→b개, br c→d개`)를 낸다 | 소프트 |
| `text-order` | 다중집합은 같은데 문서 순서가 다르다 | 소프트 |
| `details-open` | `details`의 `open` 유무와 요약 글자. `open`이 빠지면 본문이 접힌다 | 소프트 — **po가 PR의 소프트 목록에서 반드시 읽는다**(`aria-hidden`·`role`과 같은 줄) |
| `attr-text` | 속성에 든 글자: `title`·`alt`·`placeholder`·`label`·`lang`·`dir`·`aria-label`·`data-label`·`data-*-en`의 다중집합 | 하드 |
| `links`·`link-target` | `a[href]`의 (href 원문·rel·target·링크 글자) 다중집합, 후보의 내부 링크 대상 파일이 있는지 | 하드 |
| `resource-target` | `link[href]`(stylesheet·manifest·icon·canonical)·`[src]`(script 밖)·`poster`·`object[data]`·`srcset`이 가리키는 내부 파일이 후보에 있는지(기준에서도 없던 것은 뺀다) | 하드 |
| `files-removed` | 기준 폴더에 있던 파일(.html 밖)이 후보에 없다. HTML이 속성으로 가리키지 않는 것(JS가 `fetch`로 읽는 `data/`)은 이 목록으로만 보인다 | 소프트(폴더 단위) |
| `headings` | `h1`~`h6`의 (레벨·글자) 순서 | 하드 |
| `landmarks` | `main`·`nav` 개수, `.skip-link`의 href·그 대상 요소·본문 링크 중 몇 번째인지 | 하드 |
| `hooks` | 기준의 `id`·`data-*`·`aria-*`(이름=값)과 훅 클래스가 후보에 그 수만큼 있다 | 사라지면 하드, 늘면 소프트 `hooks-added`(PR에 목록) |
| `inline-script` | 인라인 script의 본문과 순서(한·영 문자열표가 여기 있다) | 하드 |
| `s6-scripts`·`s6-inline-bytes`·`s6-external-bytes`·`s6-src-missing`·`s6-js-total` | script 줄 목록이 늘거나 바뀌지 않는다, 인라인·외부 JS 바이트 합이 기준 이하, 폴더 안 `.js` 합이 기준 이하 | 늘면 하드, 줄면 통과(`scripts-removed`는 소프트) |
| `s6-handlers` | 인라인 이벤트 핸들러 속성(`onclick`·`onload` … 이름이 `on`으로 시작하는 것)의 (이름=값) 다중집합. 속성 안의 JS라 위 바이트 합이 못 본다 | 새로 생기거나 값이 바뀌면 하드, 줄기만 하면 소프트 `handlers-removed` |
| `tw-dark` | 후보의 class·JS·CSS에 `tw:dark:` 변형이 없다(네 갈래 테마는 CSS 변수에서 갈린다) | 하드 |
| `semantic` | `role`·`hidden`·`name`·`for`·`scope`·`colspan` 따위 | 소프트 |
| `hook-list`·`hook-list-dropped` | (`--render`만) 훅 클래스 목록 파일이 후보 소스와 어긋났다 / 기준 소스에서는 훅이었는데 후보 소스에서는 아닌 class | 소프트(폴더 단위) |

### 블록 단위 글자 흐름 (#289)

`text`의 비교 단위는 텍스트 노드가 아니라 **블록 하나**다. 블록 안의 텍스트 노드를 공백까지 이어 붙이고(연속 공백은 한 칸, 블록 양끝의 공백은 뗀다)
그 문자열의 다중집합을 견준다. 숫자를 `<strong>`으로 감싸 텍스트 노드가 셋으로 잘려도 블록의 글자 흐름은 같다. 요소는 넷으로 나뉜다.

| 갈래 | 태그 | 글자 흐름에서 |
|---|---|---|
| 블록(`TEXT_BLOCK`) | `address` `article` `aside` `blockquote` `details` `dialog` `dd` `div` `dl` `dt` `fieldset` `figcaption` `figure` `footer` `form` `h1`~`h6` `header` `hgroup` `hr` `li` `main` `menu` `nav` `ol` `p` `pre` `section` `summary` `table` `caption` `colgroup` `col` `thead` `tbody` `tfoot` `tr` `td` `th` `ul` `option` `optgroup` `select` `datalist` `button` `input` `textarea` `label` `legend`, 그리고 `html` `head` `body` `title` `meta` `link` `base` `style` `script` `template` `noscript` | 흐름을 끊는다. SVG·MathML **안의** 요소와 숨김 표시가 바뀌는 요소도 흐름을 끊는다 |
| 중립 인라인(`NEUTRAL_INLINE`) | `span` `strong` `em` `b` `i` `small` `mark` `abbr` | 아무것도 보태지 않는다 — 감싸도 풀어도 흐름이 같다(`text-wrap` 소프트) |
| 줄바꿈 | `br` | 공백 한 칸으로 센다 |
| 그 밖의 인라인 | `a` `code` `sup` `sub` `del` `ins` `s` `u` `q` `cite` `time` … 과 모르는 태그 | 뜻이 실리므로 흐름에 `‹a›…‹/a›`처럼 남는다. 블록을 **바깥에서** 감싸면(`<del><p>…</p></del>`, 블록 링크 `<a href><div>…</div></a>`) 안쪽 블록의 항목에 `[in:del]`·`[in:a]` 표시로 남는다 |

`img`·`wbr`·`picture`·`source`와 SVG·MathML 덩어리 자체는 흐름을 끊지도 보태지도 않는다(문장 안에 아이콘을 넣는 것은 글자 변화가 아니다. SVG 안의 글자는 요소마다 한 항목이다).
블록 목록은 `canon.mjs`의 공백 규칙이 쓰는 목록에서 `br`을 빼고 폼 컨트롤 다섯을 더한 것이다. 중립 인라인 목록은 위 여덟 개로 **확정**이다(cto, PR #292 —
`br`은 공백 한 칸으로 두고 `code`·`kbd`·`time`·`u`는 넣지 않는다).

- **통과하는 것(소프트 `text-wrap`)**: 블록 안 글자의 일부를 중립 인라인으로 감싸거나 푸는 것, 낱말 사이 공백 자리에 `<br>`을 넣는 것(공백을 남기든 br로 바꾸든).
  보고서 머리에 `인라인 경계만 다른 블록(text-wrap, 통과): n장 m개`가 나오고, 장마다 감싸기 전·후 블록 모양(`"7억대에서 ‹strong›575‹/strong›건이 …"`)과 수가 나온다 — po가 무엇이 감싸졌는지 읽는다.
  노드 전체를 감싼 것(`<p><span>…</span></p>`)과 중립 태그끼리 바꾼 것(`strong` → `span`), 블록 태그끼리 바꾼 것(`p` → `div`), 블록을 블록으로 감싼 것은 보고도 하지 않는다.
- **계속 하드인 것**(전부 `text`, 변이 시험이 하나씩 있다)
  - 래퍼 안팎의 글자 한 글자·숫자 한 자리(`575건` → `<strong>576</strong>건`).
  - 블록 안 공백의 추가·삭제, 래퍼 경계에서도(`575건` ↔ `<strong>575</strong> 건`, `</strong> 입니다` ↔ `</strong>입니다`). 낱말 한가운데의 `<br>`도 공백이 생긴 것이다.
    #285 판이 못 잡던 "인라인 요소 사이의 공백을 없애 낱말이 붙는 것"이 여기서 잡힌다. 보고서는 `글자는 같고 블록 안 공백이나 블록 경계가 달라졌다`고 주를 단다.
  - 블록 경계를 넘는 이동·합침·나눔: 글자가 다른 `p`·`li`·`td`·`th`·제목·`dt`·`dd`·`caption`으로 옮겨 가거나, 두 블록이 하나가 되거나, 한 블록이 둘로 갈린다.
    인라인 형제를 블록으로 바꾸는 것(`<span>가</span> <span>나</span>` → `<div>가</div> <div>나</div>`)과 붙어 있던 인라인 형제 사이에 블록 래퍼를 끼우는 것도 블록 나눔이다.
    블록을 통째로 옮기는 것(순서)은 `text-order` 소프트다.
  - 중립 목록 밖의 태그로 감싸거나 푸는 것(`del`·`s`·`ins`·`sub`·`sup`·`a`·`code` …, 노드 전체를 감싸도 같다)과 `template`·`script`·`style`·`noscript`로 감싸는 것.
    블록을 바깥에서 감싸도 같다 — `<del><p>…</p></del>`·`<s><div>…</div></s>`·`<ins><ul>…</ul></ins>`·`<sub><p>…</p></sub>`·href 없는 `<a><p>…</p></a>`는 안쪽 블록의 항목마다
    `[in:태그]`가 붙어 달라지고, 기준에 있던 바깥 감싸기를 벗기는 것도 달라진다. 블록 링크(`<a href><div>…</div></a>`)는 기준·후보가 같으면 표시도 같아 통과한다.
  - `hidden`·`aria-hidden="true"`·`inert`가 붙은 요소 아래의 글자(래퍼든 블록이든). 표시(`[hidden]`·`[aria-hidden]`·`[inert]`)가 항목에 붙으므로 붙이거나 떼면 달라진다.
- **숨김 표시.** `hidden` 속성은 `[hidden]`, 브라우저 기본 스타일이 그리지 않는 요소(`template`·`noscript`·`noembed`·`noframes`·`datalist`·`canvas`·`object`·`video`·`audio`·`iframe`·body 안 `title`)와
  `open`이 없는 `dialog`는 `[hidden:태그]`, `aria-hidden="true"`는 `[aria-hidden]`, `inert`는 `[inert]`다. 겹치면 이어 적는다. 속성 글자와 제목 줄에도 같은 표시가 붙는다.
  본문 텍스트 항목에는 그 뒤에 바깥에서 감싼 뜻 있는 인라인의 `[in:태그]`가 이어진다(`"숨김" [hidden] [in:ins]`).
  `details`의 `open`은 표시가 아니라 `details-open` 소프트로 본다(접힌 글자는 사용자가 펼 수 있다).
- **제목·링크 글자·속성 글자는 이 완화와 무관하다.** `headings`·`links`·`attr-text`는 전과 같이 자기 문자열을 글자 그대로 견준다(제목·링크 안의 br은 아무것도 보태지 않는다 —
  낱말 사이 공백을 남기고 넣으면 같고, 공백을 br로 바꾸면 `headings`·`links`가 건다).
- **블록 나눔이 하드인 동안 통과하는 길 둘.** 붙어 있는 인라인 형제(`<span>자기 돈이 적어도</span><strong>4억 6,950만원</strong><span>…</span>`)를 블록처럼 쌓고 싶을 때:
  ① **인라인 태그를 유지하고 class로 블록처럼 그린다**(`<span class="tw:block">` — class는 보지 않는다), ② **붙어 있는 형제를 함께 감싸는 블록 래퍼**를 둔다
  (`<li><div class="tw:flex tw:flex-col">…형제 전부…</div></li>` — 블록 하나의 글자 흐름이 그대로다). 형제의 **일부만** 블록으로 감싸거나 `span`을 `div`로 바꾸면 한 블록이 둘로 갈려 하드다
  (시험 "#279가 쓸 수 있는 통과하는 길 둘"). 블록 나눔을 소프트로 푸는 것은 이 도구에 아직 없다 — 조건부 후속이고(cto 판정, PR #292), 착수 신호는 #279 초안의 `--render` 결과에
  블록 나눔 하드가 실제로 나올 때다. 넣게 되면 뜻 없는 블록(`div`·`section`·`article`·`aside`·`header`·`footer`·`main`·`nav`·`figure`·`form`·`fieldset`)이 기준의 요소 경계 자리에 만든 나눔만
  소프트로 하고, `p`·`li`·`td`·`th`·`dt`·`dd`·`caption`·제목·`summary`·`label`·`button`·`option`이 만든 경계와 합침은 계속 하드로 둔다.
- **전보다 엄격해진 자리**(#285 판에서는 통과하던 것): 인라인 요소 사이 공백의 추가·삭제, 텍스트 노드는 그대로 두고 블록만 나누거나 합친 것, 중립 목록 밖 인라인 태그의 추가·삭제·교체,
  글자 위에 새로 거는 `aria-hidden="true"`(전에는 `hooks-added` 소프트뿐이었다), `a`를 `span`으로 바꾸는 것(`links`에 더해 `text`도 건다). flex·grid 안처럼 화면에서 안 보이는 공백 변화도 하드다.

- **비교 조건.** 기준은 PR의 merge-base, 후보는 PR 머리(또는 작업 트리)이고 **같은 입력·같은 `BUILD_NOW`로 렌더한 둘**만 견준다.
  다른 날 데이터나 다른 `BUILD_NOW`로 구운 폴더끼리 견주면 디자인이 같아도 텍스트가 갈린다(#8 부류 — `test:live`가 하루 다른 쌍으로 보인다).
  `--render`가 이 조건을 지킨다: `--base`(기본 `git merge-base origin/main HEAD`)와 `--head <SHA>`/`--src <디렉터리>`(기본 작업 트리)를
  같은 `--build-now`(기본 기준 커밋의 커밋 시각)로 `renderIsolated`에 넣는다. 폴더 둘을 직접 줄 때는 부르는 쪽이 책임진다.
- **훅 클래스는 기계로 뽑는다.** `hook-classes.json`의 `js`는 `docs/` 아래 `.js`와 `docs/*.html` 인라인 script의
  `querySelector(All)`·`closest`·`matches`·`getElementsByClassName`·`classList`·`className`에서, `markup`은 루트 `test/*.mjs`와
  `scripts/build-*-pages.mjs`가 문자열로 쓰는 `class="…"`에서 뽑은 이름이다(`collectHookClasses`). 목록이 소스와 어긋나면
  `test/invariants.test.mjs`가 실패하고, `--hooks-write`로 다시 만든다. 비교 때는 목록에 **후보 폴더의 JS가 읽는 class**를 더한다.
  `--render`는 소스를 갖고 있으므로 한 걸음 더 간다: **후보 소스에서 다시 뽑은 이름**을 목록에 더해 판정하고(목록이 낡아도 새지 않는다), 목록이 후보 소스와
  어긋난 것(`hook-list`)과 기준 소스에서는 훅이었는데 후보 소스에서는 빠진 이름(`hook-list-dropped`)을 보고에 소프트로 같이 낸다. 빠진 이름은 더는 훅으로 보지 않으므로
  (HTML에서 그 class가 사라져도 `hooks`가 안 건다) PR에서 사람이 읽는다.
  정규식 어림이라 변수로 조립한 선택자는 못 읽는다(`--hooks a,b`로 보탠다). 구운 HTML의 class 속성은 읽지 않는다 — `low-sample`처럼
  그날 데이터에 따라 나오는 class가 목록을 흔들지 않게 하려는 것이다.
- **의도한 차이.** 하드 항목을 일부러 바꾸는 PR은 차이를 PR 본문에 목록으로 적고 po·cmo가 확인한 것만 예외다(#274 범위 1).
  도구에는 `--expect <파일>`로 준다. 항목 문자열은 `--json`이 낸 결과에서 **글자 그대로** 옮겨 적는다 — 맞은 항목만 하드에서 빠지고,
  목록에 없는 차이는 그대로 실패한다. check를 통째로 면제하는 줄과 `reason`·`confirmedBy`가 빈 줄은 받지 않는다. 쓰이지 않은 줄은 보고서에 적힌다.
  형식이 틀린 목록(JSON이 아니다, 배열이 아니다, 위 조건을 어긴 줄)은 사용법 오류라 종료 2다(하드 실패 1과 가른다).
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
  `attr(data-label)`도 못 본다. 이쪽은 #278 PR A의 렌더 검사 도구가 맡는다. 그 밖에 보지 않는 것(시험 "#289 8번 못 잡는 것"과 "못 잡는 것(적어 둔다, PR #292 cto)"이 적어 둔다):
  - **글자 없는 요소의 추가**: `alt` 없는 `img`, `iframe`, body 안의 `link`(stylesheet 포함), 빈 `div`. 글자도 훅도 없으면 어느 check에도 걸리지 않는다
    (가리키는 내부 파일이 없을 때만 `resource-target`이 건다. `alt`가 있으면 `attr-text`가 건다).
    거꾸로 **거짓 실패 쪽**: 문장 안에 `<img alt="">` 아이콘을 넣으면 빈 `alt`가 하나 늘어 `attr-text` 하드다(지금 `docs/`에 `img`는 0곳).
  - **폼·상호작용 속성의 변경**: `form`의 `action`·`method`, `disabled`, `tabindex`. (`inert`는 글자 위에 붙으면 `text`가 건다.)
  - **`on*` 밖의 스크립트 자리**: `form action="javascript:…"`, `button formaction`, `iframe srcdoc`, `javascript:`를 담은 `src`는 `on*` 속성이 아니라 `s6-handlers`에 안 걸린다
    (`a[href]`의 `javascript:`는 `links`가 건다).
  - **글자를 그려지지 않거나 다르게 그려지는 자리로 옮긴 것**: `<select><option>`·`<textarea>`·SVG `<title>`·`<desc>` 안으로 옮기면 블록 하나의 글자 흐름이 같아 통과한다.
  - **블록의 글자 전체를 빈 블록으로 옮긴 것**: `<td>7억</td><td></td>` → `<td></td><td>7억</td>`는 다중집합도 순서도 같아 보고가 없다(빈 블록은 항목이 아니다).
    글자가 있는 칸(`-`)과 맞바꾸면 `text-order` 소프트로 나온다. 지금 `docs/`에 빈 `td`·`th`는 0곳이다.
  - **참조 파일의 내용**: `resource-target`은 있는지만 본다. `style.css`를 0바이트로 비워도 통과한다(화면 동일 증빙은 #276이 따로 정한 방법이 맡는다).
  - **인라인 `style` 속성으로 숨긴 글자**(`style="display:none"`): `style`은 비교하지 않으므로 class로 숨긴 것과 같이 통과한다(#278 PR A의 렌더 검사 몫).
  - 값이 같은 속성을 다른 요소로 옮긴 것(예: `aria-hidden="true"`를 글자 없는 요소끼리, `onclick`을 다른 요소로) — 다중집합만 본다.
  - 블록 가장자리의 공백, SVG 안에서 `<text>` 밖에 놓여 그려지지 않는 글자, `manifest.webmanifest`·CSS·JS **안에서** 가리키는 파일(HTML 속성이 가리키는 것만 대상 확인을 한다).
  - `details`를 닫아 본문을 접는 것은 하드가 아니다(`details-open` 소프트).
- 스냅숏(`--snapshot`)은 기준선 기록용이다(#274 범위 3). 저장소에 커밋하지 않고 기준 SHA에서 다시 만든다: `git archive <SHA> docs | tar -x -C <폴더>` 뒤
  `node bin/invariants.mjs --snapshot <폴더>/docs`. 추출 항목이 바뀌면 스냅숏 `version`이 오르고 지문도 달라진다(#289에서 2 — 예전 JSON은 읽지 않고 다시 뜨라고 알린다).

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

- `npm test`는 CI(`.github/workflows/test.yml`)가 루트 시험 뒤에 `working-directory: tools/golden`으로 돌린다(#289 PR 2). **`--render` 자기 비교와 `npm run test:live`는 CI에 없다** — 변이 시험·자기 비교 출력은 그대로 PR 본문에 명령·출력을 붙여 증빙한다.
  `npm test` 가운데 "훅 클래스 목록이 소스와 맞는다" 하나만 저장소의 코드(`docs/`의 JS·인라인 script, `test/*.mjs`, `scripts/build-*-pages.mjs`)를 읽는다 — 데이터는 읽지 않는다.
  정리 시험(`test/cleanup.test.mjs`)은 고정 가짜 저장소만 쓰고 시험마다 자기 폴더 안에서 돌아 끝에 지운다.
- 공백 줄이기는 CSS 공백 접힘을 흉내 낸 규칙이다(블록 요소의 시작·끝·이웃에서만 공백을 뺀다). 화면에서 달라 보이는 공백 차이는 잡고,
  화면에서 같은 공백 차이는 통과시킨다.
- 비교 대상은 `.html`이다. JSON·CSS·JS의 차이는 `--bytes`로 따로 본다.
