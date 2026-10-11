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
node bin/compare.mjs /tmp/a /tmp/b [--bytes]     # 정준 비교(+ 바이트). 같으면 종료 0
node bin/bench.mjs   --repo ../.. --sha HEAD --runs 10   # 렌더 단계 시간 중앙값·상한
```

## 구성

- `lib/render.mjs` — 렌더 단계 여섯(`daily-update.yml`의 "정적 HTML에 오늘 내용 심기")을 **깨끗한 작업 사본**에서 돌린다.
  출발점(pristine)은 `git archive <SHA>`(커밋된 상태) 또는 `--src <디렉터리>`(작업 트리 스냅숏 — #238의 shadow가 "같은 렌더
  전 스냅숏"을 만들 때 쓰는 모양)이고, 렌더마다 복제해 쓰므로 저장소 `docs/`는 바뀌지 않고 두 렌더가 같은 출발점을 갖는다.
  호출자가 준 환경변수(`TZ`·`BUILD_NOW`·`JIPGYE_RENDERER`)만 들어간다.
- `lib/canon.mjs` — 정준 덤프. 허용 차이는 주석·속성 순서·엔티티 표기·공백 줄이기(없애기는 불허)·인라인 script 줄바꿈뿐이다.
  head 메타 전부, 본문 텍스트(hidden 아래는 `[hidden]`), 제목 계층, 모든 href, 표 셀 속성, script src 순서, 인라인 script 본문(JSON 섬 포함)은 남긴다.
- `lib/compare.mjs` — 디렉터리 쌍 비교(정준·바이트), 줄 diff, 보고서.
- `lib/mock-date-now.mjs` — `--import`로 `Date.now()`를 `GOLDEN_MOCK_NOW`에 고정한다(BUILD_NOW 도입 전·후 코드 비교용).
- `test/mutation.test.mjs` — 비교기 변이 시험: 검출 4(표본 문장 삭제·noindex 제거·숫자 한 자리·인라인 script)·통과 1(속성 순서)·대조군.
  입력은 `test/fixtures/`의 고정 HTML 사본이다.

## 한계

- 이 폴더의 시험은 CI에 없다(워크플로를 바꾸지 않는다, #236). 변이 시험·자기 비교는 PR 본문에 명령·출력을 붙여 증빙한다.
- 공백 줄이기는 CSS 공백 접힘을 흉내 낸 규칙이다(블록 요소의 시작·끝·이웃에서만 공백을 뺀다). 화면에서 달라 보이는 공백 차이는 잡고,
  화면에서 같은 공백 차이는 통과시킨다.
- 비교 대상은 `.html`이다. JSON·CSS·JS의 차이는 `--bytes`로 따로 본다.
