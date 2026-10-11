# tools/golden — 같은-실행 비교 도구 (#236)

렌더러를 바꾸기 전에 "바뀌지 않았다"를 기계로 판정하는 자다(React SSG 체인, #235). 자체 `package.json`(parse5)이라
루트 `npm ci`·`node --test test/*.test.mjs`(CI)에는 설치되지 않는다 — **이 폴더의 시험은 CI에 들어가지 않고**, 여기서
`npm ci && npm test`로 돌린다. 루트 `test/`는 parse5를 import하지 않는다.

## 쓰는 법

```
cd tools/golden && npm ci
npm test                       # 고정 fixture만 읽는 시험(정준 덤프·변이 시험·비교기·렌더 격리) — 오늘의 docs/를 읽지 않는다
npm run test:live              # 실제 저장소로: 자기 비교(TZ=UTC·Asia/Seoul), BUILD_NOW 시각 의존, (GOLDEN_BASE_SHA가 있으면) 미설정 바이트 동일

node bin/render.mjs  --repo ../.. --sha HEAD --out /tmp/a  --env TZ=UTC --env BUILD_NOW=2026-10-11T00:00:00Z
node bin/render.mjs  --repo ../.. --sha HEAD --out /tmp/b  --env JIPGYE_RENDERER=react --env BUILD_NOW=2026-10-11T00:00:00Z
node bin/render.mjs  --repo ../.. --src ../.. --out /tmp/c --keep   # 미커밋 작업 트리 스냅숏으로 렌더. 스냅숏은 끝나면 지운다(--keep이면 남기고 경로를 출력)
node bin/compare.mjs /tmp/a /tmp/b [--bytes]     # 정준 비교(+ 바이트). 같으면 종료 0
node bin/bench.mjs   --repo ../.. --sha HEAD --runs 10   # 렌더 단계 시간 중앙값·상한
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
- `lib/mock-date-now.mjs` — `--import`로 `Date.now()`를 `GOLDEN_MOCK_NOW`에 고정한다(BUILD_NOW 도입 전·후 코드 비교용).
- `test/mutation.test.mjs` — 비교기 변이 시험: 검출 4(표본 문장 삭제·noindex 제거·숫자 한 자리·인라인 script)·통과 1(속성 순서)·대조군.
  입력은 `test/fixtures/`의 고정 HTML 사본이다.

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
  정리 시험(`test/cleanup.test.mjs`)은 고정 가짜 저장소만 쓰고 시험마다 자기 폴더 안에서 돌아 끝에 지운다.
- 공백 줄이기는 CSS 공백 접힘을 흉내 낸 규칙이다(블록 요소의 시작·끝·이웃에서만 공백을 뺀다). 화면에서 달라 보이는 공백 차이는 잡고,
  화면에서 같은 공백 차이는 통과시킨다.
- 비교 대상은 `.html`이다. JSON·CSS·JS의 차이는 `--bytes`로 따로 본다.
