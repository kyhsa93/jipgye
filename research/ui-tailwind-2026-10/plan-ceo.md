# 집계(jipgye) UI 프레임워크 후보 비교와 관찰 기간 병행 적용 계획 (ceo 초안)

> **2026-10-12 소유자 결정으로 권고가 바뀌었다: 이 문서 맨 아래 「개정 B안」(Tailwind v4를 지금 시작, 디자인 개편 허용)이 현행이다. 0~9절의 권고((a) 먼저)는 대체됐고 비교·사실만 근거로 남는다.**

작성: ceo, 2026-10-12 KST. 조사·문서만 했다(코드 변경·병합·라벨 변경·커밋 없음, 유료 API 호출 없음).
읽은 저장소 상태: `origin/main` 8c984329(2026-10-12 12:20 KST AI 요약 갱신), 로컬 작업 브랜치는 건드리지 않고 `git archive`로 스크래치패드(`.../scratchpad/jg`)에 풀어 읽었다.
측정 사본: `.../scratchpad/deps/*`(후보별 `npm install --ignore-scripts`, Node v22.16.0·npm 10.9.2, 2026-10-12).

---

## 0. 결론 (먼저)

1. **권고: 후보 (a) "프레임워크 없는 CSS 체계 정리"를 지금 시작하고, Tailwind v4는 D+14 판정 뒤의 조건부 2단계 후보로 둔다.** 이유 한 줄: 지금 시작해도 되는 변경은 "구운 HTML 바이트가 0 바뀌는 것"뿐이고(롤백 문턱 #246과 원인 분리 때문), 이 사이트는 이미 CSS 변수 토큰·단일 스타일시트·다크모드 네 갈래가 있어서 (a)가 비용 대비 효과가 가장 크다.
2. **(d) MUI/Chakra류는 S6·DIRECTION 1부 80행 범위를 넘고(하이드레이션 필요), 관찰 기간 병행은 불가로 기각.** (c)는 지금 구조(손으로 고치는 HTML 틀 14장 + 인라인 스크립트 + JSX는 조각뿐)와 맞지 않아 기각(재검토 조건 명시). (b) Tailwind는 "기각"이 아니라 **보류**: 도입하면 모든 조각의 class가 바뀌어 legacy 쌍둥이(#246 롤백 경로)와 동시에 고쳐야 하므로 #248(legacy 제거) 뒤가 맞다.
3. **소유자 결정이 필요한 것**: ① "프레임워크 적용"을 지금은 (a)로 해석할지(Tailwind 보류 동의), ② 관찰 기간 중 UI 변경을 "HTML 0바이트 변경"으로 제한하는 규칙(#247에 붙일 것), ③ 시각 정체성 변경 단계(3단계)의 승인, ④ S6·1부 80행을 바꿀지(권고: 바꾸지 않는다). 상세는 6절.

---

## 1. 현재 스타일 구조 (읽은 근거)

| 항목 | 사실 | 근거(파일, 명령) |
|---|---|---|
| CSS 방식 | 사이트 전체가 `docs/style.css` **한 장**(65,108바이트·2,904줄, gzip 16,933바이트). 페이지 `<style>` 블록 0개, 인라인 `style=` 속성은 페이지당 1~3개(index는 `margin-top:-8px` 한 곳). 페이지에 `<style>` 재도입은 시험이 막는다. | `docs/style.css` 1~10행 주석, `README.md` "화면" 절(293~299행), `grep -c '<style'` 67장 모두 0 |
| 토큰 | `:root`에 색 변수 10개(`--bg --fg --muted --card --border --up --down --accent --accent-on --accent-weak`), 글자 크기 축척 `--fs-xs…--fs-3xl`·`--fs-field`, `--tap`(44px), `--prose`(46rem). 사용 횟수 상위: `--muted` 93, `--fs-sm` 56, `--border` 55. 간격·반경·그림자 토큰은 **없다**(확인: `:root` 블록에 없음). | `docs/style.css` 12~85행, `grep -o 'var(--…)'` |
| 테마·다크모드 | **네 갈래 팔레트**: 기본(라이트) / `@media (prefers-color-scheme: dark)`(2702행) / `:root[data-theme="dark"]` / `:root[data-theme="light"]`. 토글은 각 HTML 인라인 스크립트가 `localStorage.theme`을 읽어 `data-theme`을 붙이고 뗀다(`auto`는 속성 제거). 오르내림 색은 테마마다 따로 대비(4.5:1) 시험. | `docs/style.css` 55~85행·2702~2715행, `docs/index.html` 456~471행, `test/style.test.mjs` 192~256행 |
| 반응형 | 미디어쿼리 13개: `max-width` 480×2·520·560×2, `min-width` 720·1024×5·1440, 다크 1. `main` 폭 760px → 1024px 이상 1120px. 표는 `data-label` 카드 변형(좁은 폭에서 접힘). | `grep -n '@media' docs/style.css` |
| 클래스 어휘 | 스타일시트의 서로 다른 클래스 209개, 구운 HTML 67장에서 쓰인 서로 다른 class 토큰 215개. `!important` 1개(`[hidden]`), 루트 밖 하드코딩 색 17곳. `@layer`·`@container` 없음. | `grep -oE`, `grep -c '!important'` |
| 공용 틀 | **JSX는 조각뿐이다.** `scripts/render/entry.jsx`(882줄) 한 파일에 조각 44개(`fragments`), `className` 60곳. 페이지 껍데기(머리·nav·검색·푸터·인라인 스크립트)는 JSX가 아니라 **손으로 고치는 HTML 틀 14장**(`index news realestate rates deal-search jeonse-vs-wolse cancelled-deals renewal-vs-new floor-gap record-high switch-house price-outlook about method`)이고 나머지 53장은 `scripts/build-*-pages.mjs`가 그 틀을 문자열 치환으로 찍는다. 틀 JSX화는 DIRECTION이 "2차 게이트, #248 뒤 별도 판정"으로 미뤘다. | `README.md` 293~296행, `DIRECTION.md` 332~360행(특히 "나중에"), `scripts/render/entry.jsx` 1~25행 |
| 렌더 로더 | `scripts/render/load-jsx.mjs`가 esbuild build API로 진입 JSX를 ESM으로 묶어 import(Node에서만, 산출물은 `node_modules/.cache` 임시, `docs/`로 안 나감). `renderToStaticMarkup`으로 문자열을 만들어 틀의 `<!--prerender:…-->` 자리에 심는다. legacy(문자열 조립)와 react 두 벌이 같은 바이트를 낸다. | `scripts/render/load-jsx.mjs`, `scripts/render/react.mjs`, `scripts/render-pipeline.mjs` |
| 브라우저 JS | 외부 파일 4개(`nav.js` 14,419 · `search.js` 13,330 · `analytics.js` 2,945 · `load-state.js` 2,578 바이트, 합쳐 gzip 12,260)와 **페이지별 인라인 스크립트**(index 75,317바이트·gzip 21,754 / realestate 58,814 / deal-search 71,783 / rates 3,499 / about 3,399). 인라인에 한/영 문자열표 `T`와 토글·정렬·차트 코드가 들어 있다. `className`/`classList` 사용은 index 5·nav.js 3·rates 1(문자열로 만든 DOM 조각이 적다). 서비스워커(`sw.js`, 캐시 `jipgye-v15`)는 `.html`·`.js`·`.css`를 **네트워크 우선**으로 받는다. | `docs/*.html`, `docs/*.js`, `docs/sw.js`, `wc -c`, `gzip -9c` |
| 웹폰트 | 없다. 시스템 글꼴 스택(`-apple-system … Pretendard … Malgun Gothic`). `@font-face`·구글폰트 요청 0. | `docs/style.css` 111행, `grep -n '@font-face\|googleapis'` |
| 광고(AdSense) | **마크업에 광고 슬롯이 없다**(`adsbygoogle`·`ins` 0건). `docs/analytics.js` 끝 5행이 `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1195159445218373`를 `async`로 동적 삽입하고, 페이지 `<meta name="google-adsense-account">`가 붙는다. 사이트는 애드센스 **승인 전**이고 재신청은 연기 중(#67, #246 면제 기록). 수동 슬롯 위치 = **확인 못함**(자동 광고 설정은 AdSense 콘솔에 있고 이 환경에서 볼 수 없다). | `docs/analytics.js` 77~84행, `grep -rniE "adsbygoogle\|pagead" docs scripts`, `README.md` 67행, #246 댓글 |
| 시험이 CSS에 거는 제약 | `test/style.test.mjs`(280줄)가 **`docs/style.css`를 정규식으로 직접 읽어** 글자 크기 축척·터치 크기 44px·초점 표시·팔레트 네 갈래·대비 4.5:1·액센트를 데이터 안에 쓰지 않기를 검사한다. 같은 파일을 읽는 시험이 9개(`style`·`icons`·`method-callout`·`nav-scroll`·`question-nav`·`realestate-pages`·`service-worker`·`url-state`·`table-scroll`). 시험 파일 중 `class=`·`classList`·`querySelector`를 언급하는 것 39개/전체 118개 항목. | `grep -l "style.css" test/*.mjs`, `test/style.test.mjs` |
| 배포 | `static.yml`은 `./docs`를 그대로 업로드한다(CSS 빌드 단계 없음). 액션은 전부 SHA 고정. `npm ci`는 daily-update·summarize·test 등에서 돈다. 현재 의존: `esbuild 0.28.2 · react 19.3.0 · react-dom 19.3.0 · scheduler 0.28.0 · fast-xml-parser · rss-parser`(설치 18패키지, 내 측정). | `.github/workflows/static.yml`, `package.json` |

**S6 현황**: DIRECTION S6 = "콘텐츠 페이지에 늘어나는 JS 0KB". 컷오버는 하이드레이션 없이 `renderToStaticMarkup`만 쓴다. 즉 **브라우저 쪽 JS 증가가 없어야** 한다는 계약이다.

**측정하지 못한 것(확인 못함)**: 현재 Lighthouse·Core Web Vitals 값(#246 면제 기록에서 S7 미실측), 대표 5개 URL이 어느 것인지, 소유자 Search Console D0 값이 이미 #247에 적혔는지(댓글 2건 모두 pm 정리글이고 값은 없다), 광고 자동 삽입 위치.

---

## 2. 후보 비교

외부 사실(2026-10-12 확인): `npm view` 레지스트리 JSON(https://registry.npmjs.org/<패키지>/latest) — tailwindcss 4.3.3(2026-07-16, MIT, 의존 0), @tailwindcss/cli 4.3.3, @vanilla-extract/css 1.21.3(2026-10-08), @vanilla-extract/esbuild-plugin 2.3.22(peer esbuild), @pandacss/dev 2.2.0(2026-10-09, peer postcss), @mui/material 9.5.0(2026-10-09, peer react·react-dom·@emotion/react), @chakra-ui/react 3.37.0(2026-08-28, peer react·react-dom·@emotion/react). Tailwind 지원 브라우저 Chrome 111·Safari 16.4·Firefox 128(https://tailwindcss.com/docs/compatibility), Tailwind CLI는 Node 없이 쓰는 단독 실행 파일 제공(https://tailwindcss.com/docs/installation/tailwind-cli, 파일명·검증 방법은 **확인 못함**). esbuild는 `.module.css`를 `local-css` 로더로 번들(https://esbuild.github.io/content-types/#local-css; 클래스 이름이 해시로 바뀌어 하드코딩 금지·`composes` 순서 미정의).

내 측정(재현: 스크래치패드 `deps/*`에서 `npm install --ignore-scripts` 후 `esbuild --bundle --minify --platform=browser`):

| 후보 | 새로 깔리는 패키지 수(설치된 것) | 설치 디스크 |
|---|---|---|
| 현재 의존 6종(기준) | 18 | 23.4MB |
| (b) tailwindcss + @tailwindcss/cli | 33 (현재 의존과 별개 디렉터리에서 잰 값) | 18.6MB |
| (b') tailwindcss 코어만(PostCSS/CLI 없이) | 1 | 0.86MB |
| (c) @vanilla-extract/css + esbuild-plugin(+esbuild) | 75 | 37.6MB |
| (c') @pandacss/dev + postcss | 48 | 36.7MB |
| (d) @mui/material + emotion + react | 84 | 50.1MB |
| (d') @chakra-ui/react + emotion + react | 155 | 66.8MB |

(d) 브라우저 번들(하이드레이션 + 컴포넌트 2개만, 트리셰이킹·minify): react-dom/client 하이드레이션만 222,732바이트(gzip 68,852) → MUI Button+Table 336,224(gzip 107,054) → Chakra Button+Table 476,409(gzip 132,216). 사이트가 지금 페이지에 쓰는 JS(index 인라인 gzip 21.7KB + 공용 4파일 12.3KB ≈ 34KB)의 **3~4배**가 추가된다.

### 기준별 평가

| 기준 | (a) 프레임워크 없는 CSS 정리 | (b) Tailwind v4 | (c) 빌드타임 CSS(vanilla-extract·Panda·CSS Modules) | (d) MUI·Chakra(런타임) |
|---|---|---|---|---|
| 구운 HTML·정적 산출물 유지 | 유지. 1단계는 HTML 0바이트 변경 가능 | 유지(CLI가 CSS만 생성). 단 class가 유틸리티 문자열로 바뀌어 HTML 바이트가 전부 바뀐다(`@apply`로 의미 클래스를 유지하면 HTML은 안 바뀌지만 이득이 사라진다) | 유지(빌드타임 CSS 추출). 해시 클래스명으로 HTML 바이트 전부 변경 | 정적 마크업은 나오지만 emotion이 페이지·조각마다 `<style>`을 인라인으로 심고, 상호작용 부분은 하이드레이션이 있어야 동작 |
| 브라우저 JS 증가량 | 0 | 0 | 0 | gzip +107~132KB(위 측정, 최소 사용). **S6 위반** |
| CSS 크기·CWV·AdSense | 현재 gzip 16.9KB에서 중복 정리로 소폭 감소 여지(추정, 측정 안 함). 레이아웃 불변이면 CLS 영향 0 | 유틸리티만 쓰면 보통 작게 나오나 이 사이트 변환 후 크기는 **확인 못함**. 유틸리티 수천 개가 HTML에 반복돼 gzip 후 HTML 증가 가능(추정). 레이아웃을 건드리면 광고 자동 삽입과 CLS 상호작용 | CSS 크기는 작을 수 있으나 클래스 해시로 HTML 증가. 레이아웃 변경 시 (b)와 같은 위험 | LCP·INP·TBT 악화 가능성이 가장 크다(추정, 하이드레이션 222KB 추가 파싱). 광고 로더와 메인 스레드 경쟁 |
| SEO(HTML 구조 변경 폭) | 1단계 0. 2단계 클래스명 정리 시 소폭 | **전 67장 class 속성 변경.** 제목·텍스트·링크·메타는 유지할 수 있으나 색인 61장의 HTML 바이트가 전부 달라져 #246 문턱과 원인 분리 불가 | (b)와 동급(해시 클래스) + 틀 14장이 JSX가 아니라 해시를 가져다 쓸 길이 없음 | 구조·접근성 속성이 라이브러리 기본값으로 바뀌어 폭이 가장 크다 |
| JSX 44조각·esbuild 로더 통합 비용 | 없음(CSS 파일만). 조각은 안 건드림 | CLI가 `docs/`·`scripts/render/entry.jsx`·`scripts/*.mjs`(문자열 조립 class 110곳, 17개 파일)를 **전부 스캔**해야 한다. 조각의 class 60곳 + legacy 쌍둥이 110곳을 같이 고쳐야 한다(R6) | `.css.ts`는 조각 JSX에서만 import 가능. 틀 14장·인라인 스크립트는 해시 클래스를 못 쓴다 → **틀 JSX화(2차 게이트)가 선행**. vanilla-extract가 esbuild 0.28.2와 호환되는지 **확인 못함**(peer 선언만 확인) | 조각 44개 전부를 MUI/Chakra 컴포넌트로 다시 쓰고 하이드레이션 진입점 신설 |
| 신규 의존·공급망 | 0 (필요 시 이미 있는 esbuild의 CSS 번들 기능) | 33패키지(CLI) 또는 단독 실행 파일(Node 의존 0이나 바이너리 검증 절차 신설 필요). MIT | 48~75패키지 | 84~155패키지. 직접 의존이 크고 postinstall 위험은 `--ignore-scripts`로만 줄임 |
| 유지 보수(혼자 운영) | 낮음. 지금 방식의 연장. 시험이 이미 토큰·대비를 지킨다 | 중간~낮음(관례가 널리 알려짐). 다만 네 갈래 팔레트에서 `dark:` 변형을 `data-theme`·`prefers-color-scheme`와 맞추는 설정 필요. `test/style.test.mjs` 9개 시험이 CSS 파일 정규식 검사라 재작성 필요 | 높음(타입·코드 생성·해시 디버깅) | 높음(메이저 버전 추격, 테마 시스템 학습, SSR/하이드레이션 불일치 디버깅) |
| 점진 적용·롤백 단위 | 단계마다 CSS 파일 한 개 revert. 페이지 단위 적용은 필요 없음 | 페이지 단위로 가능(페이지별 CSS 분리 시)하나 틀 공유(news 틀 → 4장, build 스크립트 → 생성 53장)로 단위가 굵다 | 틀·조각이 얽혀 단위가 굵다 | 라이브러리 단위(전부 아니면 전무)에 가깝다 |

각 칸 중 "추정"은 측정하지 못한 것이다. (b)(c)로 이 저장소를 실제 변환해 본 시험은 하지 않았다.

---

## 3. 관찰 기간 병행 적용 점진 계획 (초안)

**전제 사실**
- 롤백은 PR #271의 병합 커밋 2bc1b395를 `git revert`하는 한 줄 PR이고 cto 승인만으로 즉시 집행(#246 댓글). 문턱: 색인 D+7 −10%·D+14 −5%·61장 중 5장 이상 하락 → 롤백, 대표 URL 이상 → 롤백, soft 404·5xx·새 noindex → 즉시 롤백. 이 문안은 불변이다. 이 계획은 문턱을 건드리지 않는다.
- 롤백하면 렌더러가 legacy로 돌아간다. **JSX 조각 쪽에만 새 class·구조를 넣으면, 롤백이 곧 화면 변경이 된다.** R6(조각 함수를 바꾸는 PR은 JSX 쌍둥이도 같이 고친다)이 #248 전까지 유효한 이유다.
- #238의 shadow·#239의 render-only는 면제돼 없다(폴백 #273만 있다). #247 본문의 "즉시 롤백 = render-only"는 현재 존재하지 않는 수단이다(#246 면제 기록 3번, 확인).
- 소유자 콘솔 값은 D0 대체값(가능한 빨리)·D+7(10-19)·D+14(10-26) 세 번이다. D0는 아직 적히지 않은 것으로 보인다(#247 댓글 2건에 값 없음, 확인 시점 2026-10-12).
- 노인덱스 6장(deal-search·news·rate-news·rates·realestate-news·stock-news, `robots`를 직접 읽음)은 색인 대상 61장에서 빠진다. 뉴스 4장은 `docs/news.html` 틀에서 `build-news-pages.mjs`가 찍는다.

**규칙(모든 단계 공통, #247에 붙일 문안은 7절)**
- R-UI1: 관찰 기간(D+14 = 2026-10-26까지) UI PR은 **구운 HTML 바이트를 바꾸지 않는 것**만 병합한다. 확인은 `tools/golden`의 같은-실행 비교(`--bytes`)로 diff 0, 첫 시험 외에는 CSS 파일만 바뀐 PR임을 파일 목록으로 확인한다.
- R-UI2: UI PR은 하루 한 건, 소유자 콘솔 읽기일(10-12·10-19·10-26) 전날 이후부터 당일에는 병합하지 않는다(읽기 값에 새 변경이 섞이지 않게 하는 것이지만 색인 반영 지연 때문에 완전한 분리는 안 된다. 한계로 적는다).
- R-UI3: 각 UI PR을 #247에 한 줄로 기록한다(날짜·SHA·바뀐 파일).
- R-UI4(롤백 연동): #246 문턱 위반(1·2·5번)으로 컷오버를 되돌릴 때는 **그날까지 병합된 UI PR도 같이 되돌린다**(원인 분리가 안 되므로). 같은 한 줄 revert PR 묶음, cto 승인. 복구 뒤에 UI PR을 한 건씩 다시 올린다. 이는 문턱 문안을 바꾸지 않고 집행 방법만 더한다.

| 단계 | 시기 | 내용 | HTML 변화 | 롤백 | 중단 조건 | 소유자 승인 |
|---|---|---|---|---|---|---|
| 0 기준선 | 2026-10-12~13 | (1) `tools/golden`으로 현재 SHA의 67장 구운 HTML 확보(기준). (2) 대표 5장(index·realestate·rates·budget-7eok·district-gangnam 정도, **대표 5개 URL이 이미 정해져 있다면 그것**을 pm에게 확인)을 라이트·다크 × 3 폭(375·768·1280)으로 스크린샷 기준 확보. (3) Lighthouse 기준값(S7이 미실측이라 처음 재는 것). 이 환경에서 못 돌리면 "확인 못함"으로 둔다. | 없음 | 해당 없음(측정만) | 기준선이 안 잡히면 1단계 착수 금지 | 불필요 |
| 1 CSS 계층 정리 | 병합은 2026-10-14 이후(10-13 08:07 KST 첫 full 실행 관찰 뒤) | `docs/style.css`를 **제자리에서** `@layer reset, tokens, base, components, utilities` 순으로 재배치, 간격·반경·그림자 토큰 추가(값은 현재 쓰는 값 그대로 치환), 하드코딩 색 17곳을 토큰으로, 중복 규칙 병합. 클래스명·HTML·JS·sw.js 목록 모두 불변. (`@layer`는 우선순위 규칙을 바꿀 수 있어 **계층 밖 규칙이 계층 안 규칙을 이긴다**는 점을 확인하는 시각 비교가 필요.) | **0바이트**(golden diff 0) | `git revert` 한 건(CSS 한 파일). `sw.js`는 `.css`를 네트워크 우선으로 받으므로 캐시 때문에 오래 남지 않는다 | 스크린샷 기준 대비 의도하지 않은 화소 차이, `npm test` 개수 감소·실패, `test/style.test.mjs` 실패 | 불필요(시각 동일이 조건). 시각이 달라지면 3단계로 보낸다 |
| 2 의미 정리 | 1단계 병합 뒤 며칠 | 같은 역할의 중복 클래스 합치기를 **CSS 안에서 셀렉터 목록으로** 처리(클래스명은 안 바꾼다). 사용처 없는 규칙 제거(`grep`으로 HTML·JS·mjs 전부에서 0건 확인). 필요하면 esbuild CSS 번들로 `src/css/*.css`를 한 장으로 합치되 **산출 `docs/style.css`는 커밋하고** 시험이 읽는 위치를 그대로 둔다(배포는 `./docs` 업로드뿐이라 빌드 단계가 없다). | 0바이트 | revert | 1단계와 같음 + 사용처 오탐(JS가 문자열로 조합하는 class를 놓침) 발견 시 | 불필요 |
| (관찰 종료) | D+14 = 2026-10-26 판정 후 | #247 판정(S8 통과 여부)과 growth의 "문턱 창 종료·안정" 댓글을 기다린다. W가 14일보다 길면 그만큼 연장 | | | | |
| 3 한 페이지 시험 | 관찰 종료 뒤(+ 필요 시 #248 뒤) | 노인덱스 한 장에서 마크업·시각 변경을 시험한다. 후보: `rates.html`(11KB, 조각은 금리 4종뿐)이나 `news.html` 계열은 틀이 4장을 낳아 단위가 4장. 시험 대상은 색인 61장을 건드리지 않는다. 이 단계에서 Tailwind/기타를 쓸지 판정하고, 쓴다면 이 한 장의 CSS를 별도 파일로 두고 비교한다. | 그 한 장만 | 그 PR revert | 노인덱스 장이라 색인 문턱과는 무관하나 사용자 시험 실패·CLS 악화 시 | **필요**: 시각 정체성 변경(색·글꼴·레이아웃), 새 의존 추가, 광고 자동 삽입이 있는 레이아웃을 건드릴 때 |
| 4 확대 | 3단계 합격 뒤, 소유자 승인 | 색인 대상 장으로 넓힌다. 생성 페이지는 틀 단위로 묶어(예산 19장, 자치구 25장, 뉴스 4장) 한 틀씩, 한 번에 한 묶음. 새 문서의 소유자 재판정 필요 | 틀 단위 | 틀 단위 revert | #246과 같은 문턱을 새 기준(새 D0)으로 다시 세운다 | **필요** |

**위험 정리**
- 원인 분리: 1·2단계는 HTML이 0바이트라 색인 변화의 원인이 될 경로가 없다고 보지만(구글은 렌더링에 CSS를 쓰므로 "영향 0"이 아니라 "화소 동일이면 사실상 0"이다 — 추정), Search Console은 연결이 안 돼 사후 확인도 소유자 수동값뿐이다. 그래서 변경을 한 번에 작게, 날짜와 함께 기록한다.
- AdSense: 광고 슬롯 마크업이 없고 자동 광고 위치를 모른다(확인 못함). 레이아웃 간격·높이를 건드리는 변경은 3단계 이후로 미룬다. 재신청(#67)이 연기 중이라 신청 전에 사이트가 한 번 크게 바뀌는 것은 심사자가 보는 화면이 달라지는 일이므로 소유자 판단 사항이다.
- 비용: 후보 전부 MIT, 유료 서비스 없음. Actions 분 증가는 CSS 빌드가 없으면 0, 있어도 초 단위(추정). 돈 드는 일은 없다. 소유자 시간(스크린샷 비교 판정)이 실제 비용이다.

---

## 4. 권고 (1개)

**(a) 프레임워크 없는 CSS 체계 정리를 지금 시작한다. Tailwind v4는 D+14 뒤 3단계 한 페이지 시험에서 평가할 조건부 후보로 남긴다.**

이유
1. 지금 병행해도 되는 유일한 종류의 변경이 "HTML 0바이트 변경"이다. 그 범위에서 후보 (b)~(d)는 얻는 것이 없다(Tailwind도 의미 클래스를 유지하면 `@apply` 전처리기일 뿐이다).
2. 이 사이트는 이미 토큰·한 장 스타일시트·네 갈래 팔레트·대비 시험을 가졌다. 부족한 것은 간격·반경 토큰, 계층(`@layer`), 중복·하드코딩 정리뿐이다(1절 표). 사람이 매일 손대지 않는 무인 구조를 해치지 않는다.
3. 새 의존 0, S6 불변, 롤백 단위가 CSS 한 파일, 시험(`test/style.test.mjs` 외 8개)이 그대로 안전망이다.
4. (b) Tailwind는 도입하면 구운 HTML의 class가 67장 전부 바뀌고, 조각 44개를 JSX와 legacy 두 벌로 동시에 고쳐야 한다. 롤백(legacy 복귀)이 곧 화면 변경이 되는 위험을 #248 전에는 피해야 한다.

솔직한 한계: 이것은 "이름 있는 프레임워크를 들이라"는 소유자 결정(1)을 지금 **가장 보수적으로 해석한** 것이다. 소유자가 이름 있는 프레임워크를 원한다면 6절 ①로 결정해 달라.

---

## 5. 기각·보류 후보와 이유

| 후보 | 판정 | 이유 |
|---|---|---|
| (d) MUI·Chakra | **기각** | 하이드레이션이 필요하고 브라우저 JS가 gzip +107~132KB(내 측정, 컴포넌트 2개만)로 S6 0KB를 넘는다. DIRECTION 332~360행: "클라이언트 하이드레이션·UI 프레임워크 도입은 허용한 것이 아니며… 1부 개정이므로 소유자 결정(정체성 변경)". emotion 런타임·84~155 패키지로 최소 의존 기조에도 반한다. 하이드레이션을 안 쓰는 정적 렌더만 쓰면 이득(상호작용)이 없다. 관찰 기간 병행은 더더욱 불가(HTML·JS가 전부 바뀐다). |
| (c) vanilla-extract·Panda·CSS Modules | **기각(재검토 조건 있음)** | 해시 클래스명은 JSX 조각에서만 쓸 수 있는데, 손으로 고치는 틀 14장·인라인 스크립트·시험 39개가 클래스명을 직접 쓴다. 틀 JSX화(2차 게이트, #248 뒤)가 선행이다. 의존도 48~75패키지(Panda는 postcss와 코드 생성 단계, vanilla-extract는 esbuild 플러그인으로 esbuild 0.28.2 호환 **확인 못함**). 재검토 조건: 틀이 JSX가 된 뒤. |
| (b) Tailwind v4 | **보류(3단계에서 평가)** | 의존 33패키지(CLI) 또는 단독 실행 파일. 유틸리티 방식은 구운 HTML의 class를 전부 바꾸고 조각 쌍둥이 동시 수정이 필요해 관찰 기간·#248 전에는 맞지 않는다. 지원 브라우저 Chrome 111/Safari 16.4/Firefox 128 하한이 이 사이트 방문자에게 문제인지(GA 기기 분포)는 **확인 못함**. D+14 뒤 노인덱스 한 장에서 CSS 크기·HTML 증가·유지 비용을 실제로 재서 판정한다. |

---

## 6. 소유자가 결정할 항목

(「협업 절차 3」의 다섯 기준 중 정체성 변경·계정 로그인에 해당하는 것이 있다. 돈 드는 것은 없다.)

1. **"UI 프레임워크 적용"을 지금은 (a)로 시작하고 Tailwind는 D+14 뒤에 평가하는 것에 동의하는가.**
   - 선택지 A(권고): (a) 지금, (b) 조건부 보류.
   - 선택지 B: Tailwind를 지금 시작. 이 경우 관찰 기간 병행 안전규칙(R-UI1: HTML 0바이트)을 포기하거나, 관찰 종료·#248까지 대기해야 한다. 원인 분리가 사실상 불가능해지는 위험을 소유자가 이미 인지한 선택이므로 가능하지만, #246 문턱 위반 시 컷오버 revert와 UI revert를 같이 해야 하고 legacy 쌍둥이 구현비가 든다.
   - 권장 이유: 소유자가 인지한 위험(색인 변화 원인 분리 불가, Search Console 미연결)을 가장 덜 키운다.
2. **관찰 기간(10-26까지) 중 UI 변경은 구운 HTML 0바이트 변경만 병합한다**는 규칙(R-UI1~4)을 채택할지. 채택이 아니면 어떤 변경을 허용할지.
3. **3단계(시각 정체성 변경)의 승인.** 색·글꼴·레이아웃·톤이 바뀌면 소유자 결정(정체성 변경). 광고 자동 삽입이 있을 수 있는 레이아웃과 애드센스 재신청(#67) 시점을 겹칠지.
4. **S6·DIRECTION 1부 80행(하이드레이션·UI 프레임워크)을 바꿀지.** 권고: 바꾸지 않는다. (d)나 클라이언트 하이드레이션을 하려면 1부 개정이고 정체성 변경이므로 소유자 결정이다.
5. **소유자 Search Console 값 세 번(D0 가능한 빨리·10-19·10-26)** — 계정 로그인이 필요해 소유자만 한다(#247). UI 병행 중에는 이 값에 변경 기록을 같이 대조한다.

---

## 7. 올릴 이슈·댓글 초안 (집행은 부른 쪽, 저장소 jipgye)

기존 이슈와 겹치는지 확인한 결과 UI 프레임워크 이슈는 열려 있지 않다(오픈 이슈 목록 2026-10-12 직접 조회: #246·#247·#248 등만, UI 관련 없음). 새 이슈 1건 + #247 댓글 1건을 제안한다.

**새 이슈(jipgye, `[개선]`, 라벨 제안: enhancement, `우선순위: 다음`)**
- 제목: `[개선] CSS 체계 정리 — @layer·간격/반경 토큰·중복 정리 (구운 HTML 0바이트 변경, 컷오버 관찰 병행) — 소유자 결정(UI 프레임워크)`
- 본문 골자: 위 3절 표의 0~2단계, 합격선(golden `--bytes` diff 0, 스크린샷 화소 차이 0, `npm test` 개수 감소 0·`test/style.test.mjs` 통과), 롤백(CSS 파일 revert), 중단 조건, R-UI1~4, 3~4단계는 별도 이슈로 소유자 승인 뒤. 선행: 0단계 기준선. 유료 호출 금지.

**#247 댓글(제안, pm 집행)**
> UI 변경 병행 규칙(소유자 결정 2026-10-12 반영): 관찰 기간(D+14 = 2026-10-26)까지 UI PR은 구운 HTML 바이트를 바꾸지 않는 것만 병합한다(tools/golden `--bytes` diff 0). 하루 한 건, 소유자 콘솔 읽기일(10-12·10-19·10-26) 당일은 병합하지 않는다. 각 PR은 이 이슈에 날짜·SHA를 기록한다. #246 문턱 위반으로 컷오버를 revert할 때는 그날까지 병합된 UI PR도 같이 revert한다. 문턱 문안은 바꾸지 않는다.

**DIRECTION 문안 변경**: 권고안(a)은 DIRECTION 개정이 필요 없다. 소유자가 6절 4를 "바꾼다"로 결정할 때만 1부 80행·S6 개정 초안을 별도로 쓴다.

---

## 8. 넘길 것

- `jipgye:pm` — 위 이슈·댓글 등록 판단, 대표 5개 URL 확정 확인, UI PR과 `우선순위` 큐 조정(R1).
- `jipgye:engineer` — 0단계 스크린샷·golden 기준선 측정 도구 마련(루트 의존에 넣지 말고 `tools/` 아래 별도 `package.json`, 현재 `tools/golden`과 같은 방식. 새 의존이므로 cto 판단).
- `cto` — 0바이트 확인 방법(골든 비교·화소 비교)과 R-UI4 병합·revert 집행 절차 승인.
- `jipgye:cpo` — 3단계 이후 시각 변경의 제품·접근성 판단(색 대비 4.5:1·터치 44px 시험 유지).
- `cmo`/`jipgye:growth` — Search Console 색인·노출 영향 해석과 AdSense 재신청(#67) 일정 충돌 확인.
- `clo` — 해당 없음(법무 변경 없음).

## 9. 고친 것

저장소 파일 변경 없음. 이 문서 1개만 스크래치패드에 작성: `<scratchpad>/ui-framework-ceo.md`. 읽기 사본(`scratchpad/jg`)과 의존 측정 디렉터리(`scratchpad/deps`)는 임시 산출물.


---
---

# 개정 B안 — Tailwind v4를 지금 시작한다 (소유자 결정 반영, 2026-10-12 KST)

**이 절이 위 0~9절의 권고((a) 먼저, Tailwind 보류)를 대체한다.** 위 절의 사실·측정은 그대로 근거로 쓴다.

## B0. 이미 정해진 것 (다시 묻지 않는다)

| 결정 | 내용 |
|---|---|
| 프레임워크 | Tailwind를 지금 시작한다. 관찰 병행과 위험(원인 분리 어려움, Search Console 미연결)은 소유자가 수용했다. |
| 시각 정체성 | "디자인 굳이 지금을 유지하지 않아도 됨" — 픽셀 동일은 조건이 아니고 디자인 개편이 허용된다. |
| 폐기되는 규칙 | 위 R-UI1(구운 HTML 0바이트만 병합)은 폐기한다. 픽셀 동일 스크린샷은 합격 조건에서 빠지고 회귀 감지 기준선으로만 쓴다. |
| 불변 | #246 롤백 문턱 문안(변경 금지), S6(브라우저 JS 증가 없음), DIRECTION 1부(정적 산출물·무인 Actions). |

## B1. 이번에 새로 확인한 사실 (측정, 2026-10-12, 스크래치패드)

재현 위치: `.../scratchpad/tw-trial`(저장소 사본 + Tailwind), `.../scratchpad/twbin`(단독 실행 파일), `.../scratchpad/lh`(Lighthouse), `.../scratchpad/bl`(브라우저 점유율).

1. **세 설치 방식 비교(Tailwind 4.3.3, Node v22.16.0):**
   - npm `@tailwindcss/cli`: 저장소 사본에서 `npm install --save-exact --save-dev --ignore-scripts`로 **package-lock 항목 44개 → 110개(+66, 그중 플랫폼별 optional 바이너리 약 40)**, 실제 설치 +51패키지. 설치 스크립트가 있는 것은 `@parcel/watcher` 1개, 라이선스는 대부분 MIT이고 `lightningcss`(+플랫폼 12종)가 **MPL-2.0**, `detect-libc`가 Apache-2.0.
   - **단독 실행 파일**: GitHub 릴리스 v4.3.3(2026-07-16)의 `tailwindcss-linux-x64`(111,749,248바이트)·`tailwindcss-macos-arm64`(79,826,018바이트) 등 7종과 `sha256sums.txt`가 있다(`gh api repos/tailwindlabs/tailwindcss/releases/tags/v4.3.3`). macOS 파일을 받아 `shasum -a 256`이 `sha256sums.txt`의 `cdf64670…dce9d`와 일치함을 확인했다.
   - **같은 입력에서 npm CLI 4.3.3과 단독 파일의 출력이 바이트 동일**(36,370바이트, `cmp` 통과), 단독 파일 두 번 실행도 동일(결정적). 빌드 시간은 약 0.06초(Done in 56ms).
2. **이 저장소는 이미 "외부 바이너리를 버전·SHA-256으로 고정해 `sha256sum -c`로 대조"하는 관례가 있다**(`.github/workflows/test.yml`의 actionlint v1.7.7). 단독 파일은 그 관례와 같은 모양이다.
3. **CSS 빌드가 사이트 클래스와 충돌한다(실측):** 접두사 없이 소스를 스캔하면 기존 HTML·JS의 낱말 때문에 의도하지 않은 유틸리티 **17개**(`.sr-only .table .container .hidden .static .grid .border .rounded .shadow .block .filter .resize .visible .fixed .relative .contents .tabular-nums`)가 생겼다. **`prefix(tw)`를 쓰면 0개**로 줄고 클래스는 `tw:flex`처럼 쓴다(해당 클래스만 생성됨을 확인).
4. **기존 CSS를 `@layer components`로 감싸면 시험이 깨진다(실측):** `test/style.test.mjs` 외 8개, 모두 `docs/style.css`를 읽는 9개 시험 파일(154개 시험)을 돌려 보면 — 현재 154/154 통과, Tailwind로 `@layer`에 감싼 **비압축 빌드 출력을 `docs/style.css`에 두면 148/154**(6개 실패: 글자 크기 축척, h3 축척, 워드마크 획, 상자 모양, 2층 탭, 한국어 줄바꿈), **압축 출력이면 133/154**. 시험이 CSS를 정규식으로 읽는 구조 때문이다(원본은 `docs/data`를 같이 풀어야 통과, 없으면 26개가 데이터 부재로 실패하니 비교는 같은 조건에서만 의미가 있다). 의미: 빌드 출력을 그대로 두면 안 되고 시험을 **원본 조각 파일**에 대해 돌리거나 시험 쪽 파서를 고쳐야 한다.
5. **색 토큰 매핑이 된다(실측):** `@theme inline { --color-card: var(--card) }`로 `tw:bg-card`가 `background-color: var(--card)`로 나온다. 즉 기존 네 갈래 팔레트(자동 라이트·자동 다크·강제 라이트·강제 다크)가 CSS 변수에서 갈리므로 **유틸리티에 `dark:` 변형을 쓰지 않고도** 네 갈래가 그대로 따라온다. 주의: `--text-sm` 같은 글자 크기 토큰을 덮어쓰면 `--text-sm--line-height`도 같이 정의해야 한다(안 하면 줄 높이가 무효값이 된다 — 출력에서 `var(--tw-leading, var(--tw-text-sm--line-height))` 확인).
6. **JSON-LD는 이 사이트에 없다:** `grep -l ld+json docs/*.html` 0장. `sitemap.xml`·`robots.txt`도 이 저장소 `docs/`에 없다(다른 곳에 있는지는 **확인 못함**). 그래서 "구조화 데이터 불변"은 "새로 생기거나 사라지지 않음"으로 검사한다.
7. **parity 시험의 규모:** `test/render-parity.test.mjs` 1,723줄, 조각 44개를 legacy와 react가 **문자열 그대로 같은지** 비교한다. 조각 JSX에 새 class를 넣으면 이 시험 전체가 깨진다. golden 도구(`tools/golden/lib/canon.mjs`)도 class를 포함한 모든 속성을 비교한다.
8. **지원 브라우저 하한:** Tailwind v4 핵심 기능은 Chrome 111·Safari 16.4·Firefox 128 이상에 의존한다(https://tailwindcss.com/docs/compatibility). caniuse-lite 1.0.30001815의 한국 점유율로 계산하면 이 하한 아래 브라우저(Chrome 109 0.34%, iOS Safari 15.6~15.8 0.21% 등)는 **합쳐 1.31%**다. 단 caniuse 점유율은 사이트 방문자 분포가 아니고(GA는 이 환경에서 볼 수 없다, **사이트 실제 분포는 확인 못함**) 한국 전체 점유율 합이 100%가 아니라 약 88.5%만 분류돼 있다.
9. **기준선 도구가 이 머신에서 돈다:** Google Chrome 헤드리스로 4개 모드 스크린샷을 찍을 수 있고(같은 입력 두 번에서 4장 중 3장은 바이트 동일, `index` 375px 라이트 1장은 달랐다 — 그래서 픽셀 비교는 합격 조건이 아니라 참고용이다), Lighthouse 12.8.2(npm, 무료)가 돈다. 단일 실행 예: 로컬 서버로 서빙한 `index.html` 성능 0.64(LCP 9.1초, FCP 4.5초, TBT 10ms, CLS 0.037, 총 888KiB), 접근성 1, `rates.html` 성능 1(LCP 1.7초, CLS 0.001, 561KiB), 접근성 1, SEO 0.63(noindex라 정상). **한 번 돈 값이고 시뮬레이션 제한·실제 외부 스크립트(GA·애드센스 로더) 네트워크 영향이 섞여 있어 기준선은 3회 중앙값으로 다시 잡아야 한다.** 필드 데이터(CrUX)는 **확인 못함**.

## B2. Tailwind v4 도입 계획

### B2-1. 의존성 선택: 단독 실행 파일(권고), npm CLI는 대안

| 기준 | 단독 실행 파일 | npm `@tailwindcss/cli` | PostCSS(`@tailwindcss/postcss`) |
|---|---|---|---|
| package-lock 영향 | **없음**(0항목) | +66항목(optional 포함), `npm audit` 대상 증가 | +postcss 계열, 별도 실행기 필요 |
| 설치 스크립트 | 없음 | `@parcel/watcher` 1개(빌드엔 watch 불필요한데 딸려옴) | 해당 CLI 없음, 실행기 직접 작성 |
| 라이선스 | 바이너리 안에 lightningcss가 정적으로 들어 있음(MPL-2.0, 재배포 아님) — clo 확인 대상 | lock에 `lightningcss` MPL-2.0 12종 | 같음 |
| 공급망 고정 | 릴리스 SHA-256 고정(actionlint 관례) | package-lock integrity | 같음 |
| 단점 | 80~112MB 내려받기(CI는 필요 시에만), 플랫폼별 해시 표(CI linux-x64, 소유자 macos-arm64), `npm audit`가 못 본다 → Tailwind 보안 공지를 직접 추적 | R2(의존 PR 병합 규칙) 적용, 최소 의존 기조에 반함 | 가장 무겁다 |
| 출력 | 같은 입력에서 npm CLI와 **바이트 동일**(실측) | 같음 | 미측정 |

권고: **단독 실행 파일을 `scripts/build-css.mjs`(신규)가 `.cache/`에 내려받아 SHA-256을 대조한 뒤 실행**한다(버전·해시 표는 스크립트 안에 상수로 고정). 새 npm 의존 0, 기존 `esbuild` 로더와 무관(esbuild는 CSS를 만들지 않는다). 공급망 점검 항목: ① 릴리스 태그·SHA-256을 `sha256sums.txt`와 GitHub API digest 두 곳에서 교차 확인, ② 버전 올림은 해시 표 갱신 PR로만, ③ 릴리스 노트의 보안 항목을 갱신 때 읽기(자동 공지 없음), ④ 다운로드 실패·해시 불일치 시 빌드 실패(조용히 지나가지 않음), ⑤ 바이너리를 저장소에 커밋하지 않는다.

### B2-2. 빌드 통합 위치: 개발 시점에 만들어 커밋, CI는 신선도만 검사

- **daily-update·summarize의 렌더 step에는 CSS 생성이 필요 없다.** 이 렌더는 데이터를 틀의 `<!--prerender:…-->` 자리에 심을 뿐이고, 조각 JSX의 class는 코드 안에서 정해진다(`className={…}` 5곳 — `scripts/render/entry.jsx` 456·570·583·678·697행. 그중 570행은 `change ${p.dir}`처럼 문자열을 이어 붙이고 678행은 변수라, Tailwind 클래스를 쓸 때는 완전한 리터럴 선택지로 바꿔야 한다). 그래서 CSS는 **개발 시점에 `node scripts/build-css.mjs`로 만들어 `docs/style.css`를 커밋**한다. 무인 경로는 안 바뀐다(daily-update·summarize·static 워크플로 불변, R2 대상은 test.yml 변경 PR 하나뿐).
- 규칙: **Tailwind 클래스는 소스에 완전한 리터럴로만 쓴다**(`tw:p-${n}` 같은 조립 금지). 시험으로 막는다.
- **CI 신선도 검사(test.yml 한 스텝):** 같은 스크립트로 다시 만든 CSS가 커밋된 `docs/style.css`와 같은지 대조. 다르면 실패.
- 산출 위치는 **`docs/style.css` 그대로**다. 67장 HTML의 `<link>`·`sw.js` 캐시 목록을 바꾸지 않고(바꿀 이유가 없다), 서비스워커는 `.css`를 네트워크 우선으로 받는다(`docs/sw.js`). 커밋 산출물은 비압축 유지를 권고한다(리뷰·시험 가능, gzip 후 차이는 작다 — 이번 시험 입력 기준 비압축 49,270바이트, 압축 37,003바이트(gzip 7,152바이트)).
- **렌더 폴백(#273)·legacy 쌍둥이(R6)와의 관계는 B4에 정리했다.**

### B2-3. 기존 CSS·테마·시험·JS 클래스와의 이행 순서

소스 배치: `src/css/legacy.css`(현재 `docs/style.css`를 **글자 그대로** 이동) + `src/css/main.css`(진입: `@layer theme, base, components, utilities;` → 테마 `prefix(tw)` → `legacy.css`를 `layer(components)`로 → 유틸리티 `prefix(tw)` → `@theme inline` 토큰 매핑 → `@source`로 `docs/*.html`·`docs/*.js`·`scripts/render/entry.jsx`·`scripts/*.mjs`). **Tailwind의 `preflight`(기본 초기화)는 켜지 않는다** — 켜면 제목·목록·버튼이 모두 바뀐다(이번 시험에서도 base 계층을 가져오지 않았다).

1. **빌드 배선만 먼저(출력 의미 불변).** 원본을 옮기고 같은 이름으로 재생성. HTML·JS·`sw.js` 불변. 시험은 아래 둘 중 하나로 재배선: (가) 정규식 시험 9개가 읽는 위치를 `src/css/legacy.css`(원본, 정규식 친화)로 옮기고 "빌드 결과에 legacy 규칙이 전부 들어 있다"는 시험을 추가, (나) 파서를 고침. **(가) 권고** — 시험 154개가 그대로 통과함이 이미 확인된 입력이다.
2. **토큰을 Tailwind에 연결.** `@theme inline`으로 `--color-*`·`--text-*`·`--breakpoint-*`(현재 480/520/560/720/1024/1440 미디어쿼리와 맞춤)를 기존 `:root` 변수에 매핑. 네 갈래 팔레트는 변수에서 갈리므로 유틸리티가 자동으로 따라온다. `prefers-color-scheme`를 쓰는 `tw:dark:` 변형은 금지(정적 시험으로 막음) — 쓰면 강제 라이트/강제 다크와 어긋난다.
3. **JS가 읽는 class는 그대로 둔다(훅 목록).** 확인한 훅: `.table-scroll .page-nav .sub-nav .site-search .site-search-results .header-actions .skip-link .brand .marker .marker-line .marker-dot .news-item .context-chip .stat-card .news-chip .history-more .realestate-table .budget-summary .budget-empty .empty` 등, 그리고 JS가 켜고 끄는 상태 클래스 `read sorted scroll-start scroll-end on placeholder icon-toggle summary-meta`. 이식 규칙: **새 `tw:` 클래스를 *더하기만* 하고 훅 클래스는 지우지 않는다**(훅은 JS와 시험의 계약). 상태 클래스는 `legacy.css`에 남기고, 나중에 `data-*`/`aria-*` 상태로 바꿀지는 별도 판단.
4. **페이지·묶음 단위 점진 적용.** 아래 B2-4.
5. **`legacy.css` 퇴역은 #248 이후**(legacy 쌍둥이가 옛 class를 쓰는 동안은 필요).

### B2-4. 페이지 단위 적용 경계와 롤백 단위

틀 단위로 묶이는 사실(`README.md` 293~296행, `scripts/build-*-pages.mjs`): `docs/realestate.html` 하나가 **realestate 자신 + 예산대 18장 + 거래유형 3장 + 자치구 25장 = 47장의 틀**이고(예산 3~20억 = 18장), `scripts/rates-template.html`이 금리 4장, `docs/news.html`이 뉴스 3장(+자신)을 만든다. 손으로 고치는 나머지: index, 도구 7장(jeonse-vs-wolse·cancelled-deals·renewal-vs-new·floor-gap·record-high·switch-house·price-outlook), about, method, deal-search, rates. **한 틀을 바꾸면 그 틀이 만드는 장이 전부 같이 바뀐다**는 것이 롤백 단위의 하한이다.

| 묶음 | 장 수 | 색인 | 롤백 단위 | 비고 |
|---|---|---|---|---|
| P0 빌드 배선 | 0 | — | PR 1건 | HTML 불변 |
| P1 노인덱스 파일럿 1: `rates.html` | 1 | noindex | PR 1건 | 가장 작음(11KB), 금리 조각 2개 |
| P2 노인덱스 파일럿 2: 뉴스 틀(`news.html`→4장) | 4 | noindex 4 | PR 1건 | 틀 1개 |
| P3 노인덱스 파일럿 3: `deal-search.html` | 1 | noindex | PR 1건 | 검색 UI(인라인 JS 72KB) — JS 훅이 가장 많음 |
| P4 색인 소묶음 A: about·method | 2 | 색인 | PR 1건 | 정적 문장, 조각 없음 |
| P5 색인 묶음 B: 도구 7장 | 7 | 색인 | 장 단위 PR 가능 | 손으로 고치는 틀 |
| P6 색인 묶음 C: 금리 틀(4장) | 4 | 색인 | PR 1건 | 틀 1개 |
| P7 색인 묶음 D: `index.html` | 1 | 색인 | PR 1건 | 첫 화면 |
| P8 색인 묶음 E: `realestate.html` 틀 → **47장** | 47 | 색인 47 | PR 1건(분할 불가) | 영향 최대. 분할하려면 build 스크립트가 출력별로 클래스 변형을 골라야 해 추가 비용 — 권고: 분할하지 않고 **#247 관찰 판정 뒤**에 병합 |
| P9 공용 스크립트 `nav.js`·`search.js`·`analytics.js`의 class | 67 | 전체 | PR 1건 | 모든 장에 동시에 영향 → 가장 마지막. S6: JS 바이트 비증가 |
| P10 조각 구조 변경(표→카드 등), `legacy.css` 퇴역 | 전체 | — | PR 단위 | **#248 이후만**(B4) |

순서의 이유: 영향이 적고 되돌리기 쉬운 것(노인덱스·소량)부터, 틀 하나가 수십 장을 바꾸는 것과 공용 스크립트는 관찰 판정 뒤에. 색인 대상 장의 트래픽 순위는 Search Console이 없어 **확인 못함**이라 위험 순서는 "구조 단순성·영향 장 수"로 정했다.

## B3. 관찰 병행 위험 완화 (R-UI1 대체)

### B3-1. 새 규칙 (R-UI′)

1. **단계당 PR 한 건, 하루 한 건.** 위 B2-4의 한 줄이 한 PR이다. 워크플로·의존을 바꾸는 PR(P0의 test.yml)은 기존 R2도 함께 지킨다(다른 날, `mode=news` 성공 전 이슈 닫지 않음).
2. **소유자 콘솔 읽기일 당일 병합 금지**: 2026-10-12(D0 대체)·10-19(D+7)·10-26(D+14). 추가: **D0 값이 #247에 적히기 전에는 바이트를 바꾸는 PR을 병합하지 않는다**(D0는 소유자가 "가능한 빨리" 읽는 값인데, 이 값 없이는 비교 기준 자체가 없다). 현재 #247에 D0 값은 없다(확인).
3. **병합 전 자동 검증 통과(B3-2)와 기준선 확보(B3-3)가 병합 조건이다.** PR 본문에 출력을 붙인다(기존 R5 증빙 형식).
4. **색인 대상 묶음(P4~P8)은 직전 PR 병합 뒤 24시간 이상** 사이를 두고, 그 사이 `daily-update` 정기 실행 둘이 폴백 없이 성공한 것을 확인한다.
5. **P8(47장 틀)과 P9(공용 스크립트)는 D+14 판정(S8) 뒤에만** 병합한다. 이유는 롤백 단위가 크고 되돌려도 이미 크롤러가 본 뒤라 원인 분리가 가장 어려워서다(소유자가 수용한 위험의 크기를 키우지 않는 선).
6. **PR마다 #247에 한 줄 기록**(날짜·SHA·묶음명·검증 출력 링크).

### B3-2. 불변 조건 자동 검증 (디자인이 바뀌어도 지키는 것)

**도구**: `tools/golden`에 **invariants 모드**를 더한다(`lib/invariants.mjs`, `bin/invariants.mjs`). 이미 parse5 DOM 파서와 두 디렉터리 비교 골격이 있어 새 npm 의존은 없다(parse5는 그 폴더 `package.json`에만 있음). 기준 SHA의 구운 HTML(67장)과 후보 HTML을 비교한다. 비교기 자체의 변이 시험(`test/mutation.test.mjs` 방식)을 같이 쓴다.

| 불변 | 비교 방법 | 판정 |
|---|---|---|
| URL 집합 | `docs/*.html` 파일명 집합 67장 동일 | 하드 실패 |
| noindex 6장 | `meta[name=robots]` 값을 장별로 비교(6장 집합과 `noindex, follow` 문자열 동일) | 하드 실패 |
| canonical·메타 | `head`의 `title`·`meta`·`link` 전부(단 허용 예외: `theme-color`와 아이콘/manifest 색은 디자인 변경 시 바뀔 수 있음 — 예외 목록을 명시) | 하드 실패 |
| 구조화 데이터 | `script[type="application/ld+json"]` 개수 0 유지(현재 0장) | 하드 실패 |
| 본문 텍스트·수치 | 보이는 텍스트 노드(공백 정규화, `script`·`style` 제외, hidden 표시 포함)의 **다중집합 동일** | 하드 실패 |
| 텍스트 순서 | 문서 순서 동일 여부 | **소프트**: 다르면 목록을 PR에 붙이고 po·cmo가 확인(레이아웃 재배치는 허용이나 본문 순서는 SEO·접근성 의미가 있다) |
| 링크 | 모든 `a[href]`(+`rel`·`target`)의 다중집합 동일, 내부 링크의 대상 파일이 `docs/`에 존재 | 하드 실패 |
| 제목 계층 | `h1`~`h6` 레벨·텍스트 순서 동일 | 하드 실패 |
| JS가 읽는 훅 | 모든 `id`·`data-*`·`aria-*`와, B2-3의 훅 클래스 목록이 HTML에 존재 | 하드 실패 |
| S6(JS 증가 없음) | 장마다 `script src` 목록과 인라인 스크립트 바이트 합, 외부 JS 4개의 바이트 합이 **기준 이하** | 하드 실패(증가 시). 감소·불변만 허용 |
| 접근성 기준 | 기존 `npm test`의 대비 4.5:1·터치 44px·초점 표시·글자 크기 시험이 그대로 통과(시험 개수 감소 0) + Lighthouse 접근성 점수 기준선 이상 | 하드 실패 |
| 다크모드 네 갈래 | (가) 정적: 빌드된 CSS에 `tw:dark:` 변형 없음, 색 유틸리티가 토큰(`var(--…)`)만 사용 / (나) 동적: 대표 5장을 4모드(자동 라이트·자동 다크·`data-theme=light`·`data-theme=dark`)로 Chrome 헤드리스에서 열어 콘솔 오류 0·텍스트 대비 시험 | (가) 하드, (나) 소프트(스크린샷을 PR에 첨부, 회귀 감지용) |
| 클래스 | 비교하지 않는다(디자인 개편 허용). `style` 속성도 비교하지 않는다 | — |

**tools/golden은 CI에 없다**(자체 `package.json`, README 첫 문단). 그래서 PR 증빙으로 붙이는 방식(R5)을 쓰되, 반복 위반을 막으려면 test.yml에 `cd tools/golden && npm ci && node bin/invariants.mjs`를 더하는 것을 cto가 판정한다(워크플로 변경이라 R2 적용).

### B3-3. 기준선 (단계 0에서 확보, 합격 조건이 아니라 비교용)

- **구운 HTML 67장**: 기준 SHA에서 `tools/golden`으로 렌더해 보관(invariants의 기준 입력).
- **Core Web Vitals(S7 미실측)**: 대표 5장(대표 5개 URL이 이미 정해져 있으면 그것, 없으면 index·realestate·budget-7eok·district-gangnam·rates)에 로컬 Lighthouse 12.8.2를 **장마다 3회 돌려 중앙값**(성능·접근성·SEO, LCP·CLS·TBT·총 바이트). 같은 장소·같은 Node/Chrome 버전을 적는다. 필드 값(CrUX, Search Console 핵심 웹 지표)은 소유자 콘솔에서만 볼 수 있어 **확인 못함** — 소유자 읽기에 "핵심 웹 지표 보고서" 한 항목을 더할 수 있다(#247 D0 읽기에 추가 요청).
- **스크린샷 시트**: 대표 5장 × 4모드 × 2폭(375·1280). 픽셀이 같아야 한다는 뜻이 아니라, 개편 전후를 사람이 훑는 자료와 대략적인 화소 차이 표시용이다(같은 입력 반복에서 1/4가 달랐으므로 결정적이지 않다).
- **JS 바이트 기준**: 장마다 인라인·외부 JS 바이트(S6).
- **`npm test` 개수** 병합 직전 main 기준(감소 0).

### B3-4. #246 롤백 문턱이 발동할 때 무엇을 먼저 되돌리나

전제(사실): ① 컷오버 #271은 **구운 HTML 바이트를 바꾸지 않았다**(S1 diff 0, #246 기록). 따라서 그 revert는 렌더러 경로만 legacy로 돌릴 뿐 구글이 보는 HTML을 바꾸지 않는다. ② Tailwind PR들은 **HTML 바이트를 바꾸는 유일한 변경**이다. ③ #246 문안은 "롤백 = 2bc1b395 한 줄 revert, 이상 시 질문 없이 revert 먼저"이고 이 문안은 바꾸지 않는다.

판정 기준(ceo, 문턱 문안은 그대로 두고 집행 순서만 정함):

| 신호 | 되돌리는 것 | 순서 |
|---|---|---|
| 문턱 1(색인 −10%/−5%/5장 이상)·2(대표 URL 이상)·4(크롤링됨-미색인 +20%) | **그날까지 병합된 Tailwind PR 전부 + 컷오버 revert**를 같은 날 한 묶음 | ① Tailwind PR을 최신순으로 revert(바이트가 바뀐 유일한 변경이라 가장 유력한 원인) ② 이어서 2bc1b395 revert(#246 문안 그대로 집행). 둘 다 cto 승인만으로, 원인 조사는 그 뒤 |
| 문턱 5(soft 404·5xx·신규 noindex) | 같음 + **즉시**(Tailwind PR 최신 것부터) | 같음 |
| 문턱 3(노출·클릭 −30%)은 "검토" | 되돌리지 않고 pm·growth 심의 | 심의에 "Tailwind PR 병합일과 겹치는지"를 첫 질문으로 올림 |
| 빨간 실행·렌더 폴백 발동·`render` step 실패 (색인 신호가 아님) | **컷오버 쪽을 먼저 본다**(폴백 로그, legacy 출력) — Tailwind PR은 되돌리지 않는다 | 렌더러 문제는 컷오버, 스타일 문제는 Tailwind. CSS는 빌드 산출물이 커밋돼 있어 무인 렌더 경로에 들어오지 않는다 |
| 회복 뒤 | Tailwind PR을 **한 건씩** 다시 올린다(R-UI′ 1) | 원인 분리 복원 |

주의: 컷오버 revert로 legacy가 돌아가면 legacy 조각은 **옛 class**를 내고, 이를 꾸미는 `legacy.css`가 `docs/style.css` 안에 남아 있어야 한다(B4). 이 전제를 P0 합격 조건에 넣는다.

## B4. legacy 쌍둥이(R6) 부담을 줄이는 방법 — 판단

질문: 디자인 개편이 허용됐으니 #248(legacy 제거)을 앞당기거나 폴백을 걷을 수 있는가.

**판단: 롤백 문턱이 살아 있는 동안(최소 2026-10-26 + #247 판정) legacy를 지우지 않는다.** 근거:
1. #248 본문이 착수 조건을 "#247 닫힘 + growth 안정 댓글 + pm S8 통과"로 못박았고, "이 PR이 병합되면 롤백 수단(`renderer: legacy`)이 사라진다"고 적었다. #246의 롤백 문안은 컷오버 revert(=legacy 복귀)에 의존한다. 롤백 수단을 지우는 것은 소유자가 수용한 "원인 분리 어려움"을 넘어 **되돌릴 길 자체를 없애는 것**이다.
2. 폴백(#273)은 React 렌더가 실패한 날 **수집 데이터 커밋을 지키는 안전장치**다(`scripts/render-pipeline.mjs` 머리말). #272(수집 job 분리)가 아직 열려 있어 폴백이 하는 일을 대신하는 것이 없다. #272가 병합돼 "수집분이 렌더 실패와 무관하게 먼저 커밋"되는 상태가 되면 폴백의 존재 이유가 줄지만, 그것도 #248 범위(#248 본문 "컷오버·수집 분리 반영 ②")다.

**그 대신 부담을 줄이는 길 (권고):**
- **(1) 쌍둥이 의무를 "내용"으로 좁힌다.** R6은 텍스트·수치·링크·구조를 바꾸는 PR에만 적용하고, **class 속성 변경은 legacy에 옮기지 않는다.** legacy는 "옛 디자인 동결본"이 되고, `legacy.css`(옛 class 규칙)가 `components` 계층에 남는 한 폴백 출력도 읽을 수 있게 그려진다(조각만 옛 모양인 혼합 화면 — 비상용이며 폴백 발동은 job을 빨갛게 만든다).
- **(2) 비교기를 내용 비교로 바꾼다.** 이 때문에 `test/render-parity.test.mjs`(1,723줄)의 비교를 "문자열 완전 일치"에서 "**class·style 속성을 정규화한 뒤 일치**"로 바꾼다(정규화 함수 하나를 양쪽에 적용). 시험 개수 감소 0이어야 하고(S3), `JAVASCRIPT_URL_DIFF` 같은 알려진 차이 목록은 그대로 둔다. `tools/golden`의 S1 비교도 같은 정규화 모드를 더한다. 이것이 **이슈 체인의 필수 선행 PR**이다(없으면 조각에 class를 넣는 순간 시험 전체가 깨진다).
- **(3) 구조 변경은 #248 뒤로 미룬다.** 조각의 태그 트리(표→카드, 래퍼 추가 등)를 바꾸면 legacy와 내용 비교도 어긋난다. 그래서 **P0~P9에서는 조각의 class만** 바꾸고, **페이지 껍데기(손으로 고치는 틀 14장, 두 렌더러가 공유)의 구조는 자유롭게** 바꾼다. 조각 구조 변경은 P10(#248 이후)이다. 이 분리가 쌍둥이 부담을 사실상 없앤다.
- **(4) #248이 끝나면** 조각의 옛 class와 `legacy.css`를 지우는 정리(P10)가 마지막 단계다.

일정 함의: 관찰 기간(~10-26) 동안은 "껍데기 구조 + 조각 class + 토큰", 그 뒤에 "조각 구조 + legacy 퇴역". 소유자가 앞당기고 싶다면 가능한 가장 이른 시점은 D+14 판정 직후이고 그 이전에는 **롤백 수단 포기 + #272 선행**이 필요하다 — 이것은 위험 수용 범위를 넘으므로 권고하지 않는다.

## B5. 접근성·다크모드·광고·성능 점검 항목

**접근성(자동 + 사람)**
- 기존 시험 154개(9개 파일)와 전체 `npm test` 개수 감소 0, 대비 4.5:1(`--up`·`--down`이 카드 위에서도)·터치 44px(`--tap`)·초점 표시·글자 크기 하한 0.78rem·입력칸 16px(iOS 확대 방지)를 **토큰으로 유지**한다. 새 유틸리티가 이 하한을 우회하지 못하게 `tw:text-[…]`·`tw:min-h-[…]` 같은 임의값 사용을 시험으로 막는다(임의값 금지 규칙).
- `prefers-reduced-motion`: 현재 `docs/style.css`에 `prefers-reduced-motion` 규칙이 없다(grep 0건). `animation`·`transition`·`@keyframes`도 0건(`grep -c`)이라 지금은 움직임이 없다. 개편에서 움직임을 더하면 이 속성을 지킨다는 항목을 PR 체크리스트에 넣는다.
- Lighthouse 접근성 점수 기준선(index 1, rates 1) 이상. 실제 보조기술 확인은 기존 #122가 미완이다.
- 표의 모바일 카드 변형(`data-label`)과 가로 스크롤 표(`.table-scroll`)는 개편 시 가장 깨지기 쉬워 대표 확인 대상이다(#211: 가로 넘침 실측 미완).

**다크모드 네 갈래**: 위 B3-2 (가)(나). 강제 라이트가 OS 다크에서도 라이트로 나오는지, 자동 모드에서 `localStorage.theme` 제거 시 `data-theme` 속성이 제거되는 기존 동작(`index.html` 456~471행)을 유지하는지.

**AdSense**
- 슬롯 마크업이 없고 로더만 동적으로 들어간다(자동 광고 설정은 콘솔에 있어 **확인 못함**). 승인 전이라 지금 광고가 실제로 뜨는지도 **확인 못함**.
- 점검 항목: ① 본문 컨테이너에 `overflow:hidden`·고정 높이를 새로 걸지 않는다(자동 광고 삽입이 막히거나 잘릴 수 있음), ② 화면 가장자리에 고정(sticky/fixed) 요소를 새로 만들 때는 광고 정책·겹침을 cmo가 확인(**정책 원문은 이번에 읽지 않았다 — 확인 못함**), ③ CLS: Lighthouse CLS를 단계마다 기준선과 비교(index 0.037, rates 0.001을 예시 기준으로 3회 중앙값으로 재측정), ④ 재신청(#67)이 연기 중이라 심사자가 보는 화면은 신청 시점의 개편 결과가 된다 — 순서는 소유자 선택(B6).

**Core Web Vitals / 성능**
- 시험 입력 기준 CSS는 비압축 49KB·압축 37KB(gzip 7.2KB)로 현재 65KB(gzip 17KB)보다 작지만(기존 규칙을 계층으로 감싼 결과일 뿐 개편 후 크기가 아니다), **전 페이지 변환 뒤의 실제 크기는 확인 못함**(유틸리티가 HTML에 반복돼 HTML gzip이 늘 수 있다). 단계마다 HTML 바이트·gzip 바이트·CSS 바이트를 PR에 적고, 장당 HTML gzip 증가가 기준 대비 5%(제안값)를 넘으면 중단하고 cto가 판정한다.
- 웹폰트를 새로 들이지 않는다(현재 0). 디자인 개편에서 글꼴을 바꿀 때 시스템 글꼴 스택을 유지하는 것을 기본으로 하고, 웹폰트는 LCP·CLS 비용이 있으므로 시안 단계에서 소유자에게 보이는 선택지로만 올린다.

## B6. 디자인 방향을 누가 정하나, 시안을 소유자에게 보이는 지점

- 현재 팀에는 UI/UX 디자이너 역할이 없다. 명부는 2026-10에 "jipgye `po`가 화면 UX를 맡으므로 공백 아님"으로 판단했다(`agents/README.md` 500~504행). 이번처럼 시각 전체를 바꾸면 그 판단을 다시 볼 수 있다 → chro에게 의견만 넘긴다(**정의 변경은 내가 하지 않는다**).
- **역할 분담(제안):** `po`가 디자인 브리프를 쓴다(DIRECTION의 정직성·표본 부족 비우기·숫자 가독성 원칙을 지키는 조건 — 색을 오르내림 의미에 쓰는 규칙, 액센트를 데이터 안에 쓰지 않는 규칙이 시험으로 이미 고정돼 있다). `engineer`가 시안을 만든다(토큰만 다른 2~3종, 같은 대표 3장 — index·budget-7eok·rates — 에 입혀 4모드 × 2폭 스크린샷 시트와 로컬 파일). `cpo`(그룹)·`po`가 접근성·동선을 검토한다. `cmo`가 검색·광고 영향을 본다. 최종 선택은 소유자.
- **소유자에게 보이는 지점은 정확히 하나다 — D1 시안 확인(1회).** 시안 2~3종과 추천 1종을 스크린샷 시트로 보이고 소유자가 "이 방향으로 진행"을 고르거나 거부권을 쓴다. 이 승인을 받기 전에는 시각이 크게 바뀌는 PR(P1 이후)을 병합하지 않는다. P0(배선)과 불변 검증 도구는 시안과 무관하게 먼저 진행한다. 시안 확인용 페이지는 비공개 아티팩트 또는 이슈 첨부 이미지로 전달할 수 있다(전달 수단은 메인 세션이 고른다).
- 브랜드색 `#253e81`은 `theme-color` 메타·`manifest`·아이콘(`scripts/build-icons.mjs`)에 걸려 있다. 시안이 브랜드색을 바꾸면 이 셋이 같이 바뀌므로(`test/icons.test.mjs`가 읽음) 시안 설명에 명시한다. 이것은 B3-2의 허용 예외 목록에 있다.

## B7. 소유자에게 더 물을 것 (정말 남은 것만)

이미 정해진 것(프레임워크, 병행, 위험, 디자인 개편 허용, 픽셀 동일 불요)은 묻지 않는다.

1. **D1 시안 확인 (필수, 1회).** 2~3종의 방향 중 선택/거부. 위 B6. 이것이 시각 정체성에 대해 남은 유일한 소유자 접점이다.
2. **재신청(#67) 순서 (비차단, 선택).** 개편이 끝난 뒤 신청할지, 신청 일정과 무관하게 진행할지. 신청은 소유자가 직접 하는 일이다. 답이 없으면 "일정과 무관하게 진행"으로 두고 growth에 알린다.

ceo가 정하고 소유자에게 묻지 않는 것(근거와 함께 기록):
- **지원 브라우저 하한**: Tailwind v4 기본 하한(Chrome 111·Safari 16.4·Firefox 128)을 채택한다. 근거: 한국 점유율 기준 그 아래가 합쳐 1.31%(caniuse-lite 1.0.30001815, 2026-10-12 계산, 단 이 사이트 방문자 분포는 확인 못함). 이견이 있으면 소유자가 뒤집을 수 있다.
- **신규 의존 승인**: 소유자의 Tailwind 결정에 포함. 구체 형태(단독 실행 파일 + SHA-256 고정, npm 의존 0)는 cto 승인 사항이고 MPL-2.0(lightningcss가 바이너리에 들어 있음)은 clo 확인 대상이다. 돈은 들지 않는다(MIT, 유료 서비스 없음).
- **R-UI′ 규칙**: pm·cto 집행 규칙.

## B8. pm에게 넘길 이슈 체인 초안

초안 파일: `<scratchpad>/ui-tailwind-issue-chain-draft.md` (이슈 등록은 하지 않았다. 등록 집행은 pm/메인 세션).
