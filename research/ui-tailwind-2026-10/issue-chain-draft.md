# 이슈 체인 초안 — Tailwind v4 도입 (집계, 저장소 kyhsa93/jipgye)

작성: ceo, 2026-10-12 KST. **이슈 등록·라벨 변경은 하지 않았다.** 등록 집행은 pm(또는 메인 세션 대행).
근거 문서: `<scratchpad>/ui-framework-ceo.md` 「개정 B안」(B1 측정, B2 도입 계획, B3 규칙, B4 legacy, B6 디자인).
기존 이슈 중복 확인: 2026-10-12 오픈 이슈 목록에 UI·Tailwind 이슈 없음. 관련 기존 번호: #246(롤백 문턱, 변경 금지), #247(관찰·D0/D+7/D+14), #248(legacy 제거), #272(수집 job 분리), #67(재신청), #211·#122(접근성 후속).

공통: 본문 첫 줄에 "소유자 결정 2026-10-12: Tailwind 지금 시작, 디자인 개편 허용, 병행·위험 수용". 유료 API·`claude -p` 사용 금지. 새 npm 의존 0(단독 실행 파일). 커밋·PR 문구에 Co-Authored-By 등 줄 금지(메모리 규칙). 큐는 R1(선두 하나씩 승격, 승격 때 cpo 교차검증 댓글). 열린 `우선순위: 지금` 개수(2026-10-12 조회: #68·#70·#246)는 상한 5이므로 U1 승격 때 pm이 다시 센다.

규칙 R-UI′(병행 규칙)은 U1 본문에 한 번만 쓰고 이하 이슈는 "R-UI′ 준수"로 참조한다:
1) 단계당 PR 한 건·하루 한 건, 2) 소유자 콘솔 읽기일(10-12 D0, 10-19, 10-26) 당일 병합 금지, D0 값이 #247에 적히기 전 바이트 변경 PR 병합 금지, 3) 병합 전 invariants 통과(U1)·기준선 확보, 4) 색인 묶음은 직전 PR 24시간 뒤·정기 실행 둘 폴백 없이 성공, 5) U9·U10은 #247 S8 판정 뒤, 6) PR마다 #247에 한 줄 기록, 7) #246 문턱 발동 시 Tailwind PR 최신순 revert 후 2bc1b395 revert(같은 날), 회복 뒤 한 건씩 재도입.

---

## U1 [개선] 불변 조건 검증 도구(tools/golden invariants 모드)와 개편 전 기준선 확보 — Tailwind 도입 단계 0
- 라벨 제안: enhancement, `우선순위: 지금`
- 선행: 없음(사이트 불변). 다만 #247 D0 값이 적히기 전에도 도구 작성은 가능.
- 내용: `tools/golden/lib/invariants.mjs`·`bin/invariants.mjs` 추가. 비교 항목은 URL 집합 67장, noindex 6장 집합, `head`의 title·meta·link(예외: theme-color·아이콘/manifest 색), ld+json 0 유지, 본문 텍스트 노드 다중집합, 텍스트 순서(소프트), `a[href]`+rel·target 다중집합, 제목 계층, id·data-*·aria-*·훅 클래스 존재, 장별 JS 바이트(S6), class·style 비교 안 함. 비교기 변이 시험을 `tools/golden/test`에 추가. 기준선: 기준 SHA의 구운 HTML 67장, 대표 5장 Lighthouse 12.8.2 3회 중앙값(성능·접근성·SEO·LCP·CLS·TBT·바이트), 4모드×2폭 스크린샷 시트, 장별 JS 바이트, `npm test` 개수. 측정 환경(Node·Chrome·Lighthouse 버전)을 적는다.
- 완료 조건: ① invariants가 기준 SHA 대 같은 SHA에서 diff 0, 변이 시험 검출 확인, ② 기준선 파일 위치와 값이 이슈 댓글에 있음, ③ test.yml 편입 여부를 cto가 판정(편입하면 별도 R2 PR), ④ 사이트 파일 변경 0.
- 담당: engineer 구현, cto 판정(CI 편입·새 도구 의존은 parse5 한 개뿐이고 tools/golden 안에 이미 있음).

## U2 [개선] 디자인 방향 — po 브리프와 시안 2~3종, 소유자 확인(D1)
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: 없음(U1과 병렬 가능하나 R1 큐상 U1 뒤 승격).
- 내용: po가 디자인 브리프(목표·지킬 원칙: 오르내림 색 의미, 액센트를 데이터 안에 쓰지 않음, 숫자 가독성·tabular-nums, 시스템 글꼴 스택 기본, 다크모드 네 갈래, 접근성 하한)를 쓰고, engineer가 토큰만 다른 시안 2~3종을 대표 3장(index·budget-7eok·rates)에 입혀 4모드×2폭 스크린샷 시트로 만든다(저장소 PR 아님, 이슈 첨부 또는 비공개 아티팩트). cpo(그룹)·po 접근성·동선 검토, cmo 검색·광고 영향 의견. 브랜드색 변경 시 theme-color·manifest·아이콘이 같이 바뀐다는 점을 시안에 표시.
- 완료 조건: **소유자가 방향 1종을 고르거나 거부권을 행사한 댓글**이 있다(소유자 결정 요청: B7의 1번). 선택된 방향의 토큰 표(색·글자 크기 축척·간격·반경)가 이슈에 있다.
- 담당: po(브리프·검토), engineer(시안), 소유자(선택). chro에게는 UI/UX 역할 공백 재판단 의견만 넘김(정의 변경 아님).

## U3 [개선] Tailwind v4 빌드 배선 — 단독 실행 파일(SHA-256 고정), src/css 분리, docs/style.css 재생성(의미 불변)
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U1 닫힘. (U2와 무관하게 진행 가능.)
- 내용: `docs/style.css` 글자 그대로 `src/css/legacy.css`로 이동. `src/css/main.css`(`@layer theme, base, components, utilities`; 테마·유틸리티 `prefix(tw)`; legacy는 `layer(components)`; preflight 미사용; `@source`는 `docs/*.html`·`docs/*.js`·`scripts/render/entry.jsx`·`scripts/*.mjs`). `scripts/build-css.mjs`(신규): Tailwind v4.3.3 단독 파일을 플랫폼별로 내려받아 SHA-256 상수 표(릴리스 `sha256sums.txt`와 API digest 교차 확인)와 대조, 불일치·실패 시 빌드 실패. `docs/style.css`는 커밋 산출물(비압축). `test/style.test.mjs` 외 8개 시험이 읽는 위치를 `src/css/legacy.css`로 옮기고 "빌드 결과에 legacy 규칙이 전부 있음"·"`tw:dark:` 금지"·"임의값 `tw:…[…]` 금지"·"Tailwind 클래스는 리터럴"·"산출물 신선도" 시험 추가. test.yml에 신선도 스텝(바이너리 다운로드+해시 대조). HTML·JS·`sw.js` 불변, daily-update·summarize·static 워크플로 불변.
- 완료 조건: ① `npm test` 개수 감소 0(현재 9개 파일 154개는 원본 입력에서 전부 통과), ② invariants diff 0(HTML 불변), ③ 빌드가 두 번 돌려 바이트 동일, ④ 클린 체크아웃에서 CI 신선도 스텝 성공, ⑤ **`legacy.css` 규칙이 산출물에 남는다**(컷오버 revert 시 legacy 조각이 읽히는 전제), ⑥ R2: test.yml 변경 PR이므로 다른 날 병합·병합 직후 `daily-update` `mode=news` 1회 성공 확인 전에는 닫지 않음, ⑦ clo: lightningcss(MPL-2.0)가 바이너리에 포함됨을 확인(재배포 아님) 댓글.
- 담당: engineer 구현, cto 승인(새 외부 바이너리·해시 표), clo 확인.

## U4 [개선] 렌더 parity·golden 비교를 내용 비교로 완화 — class·style 정규화 (legacy 쌍둥이 부담 축소)
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U3 닫힘.
- 내용: `test/render-parity.test.mjs`(1,723줄)의 legacy 대 react 비교에 양쪽 같은 정규화(class·style 속성 제거)를 적용. `tools/golden`의 S1 비교에 같은 모드 추가. 알려진 차이 목록(`JAVASCRIPT_URL_DIFF`·`RAW_COUNT_DIFF`·`RAW_TEXT_DIFF`·예산 알려진 차이) 불변. **조각의 태그 트리를 바꾸는 변경은 여전히 두 렌더러가 같아야 한다**는 규칙을 시험으로 고정(class만 자유). R6 문구를 "내용(텍스트·수치·링크·구조) 변경은 쌍둥이, class 변경은 쌍둥이 불요"로 갱신(이슈 #248 본문에 붙일 정정 댓글 초안 포함).
- 완료 조건: ① 시험 개수 감소 0, ② 정규화 비교가 class 변경을 통과시키고 텍스트·링크·태그 구조 변경은 실패시킴(변이 시험), ③ legacy 옛 class가 `legacy.css`로 읽힘, ④ 기존 parity 케이스가 전부 그대로 통과.
- 담당: engineer, cto 승인.

## U5 [개선] 토큰 계층 — `@theme inline`으로 기존 CSS 변수 매핑, 브레이크포인트, 접근성 시험 유지
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U2(소유자 선택 완료), U3.
- 내용: 선택된 방향의 색·글자 크기·간격·반경을 `:root` 변수(네 갈래 팔레트가 갈리는 곳)에 두고 `@theme inline`으로 `tw:` 유틸리티에 연결. 글자 크기 토큰을 덮어쓸 때 `--text-*--line-height`도 정의. 대비 4.5:1·터치 44px·글자 크기 하한·입력칸 16px 시험은 새 토큰에 대해서도 통과. 시각 변경을 일으키는 규칙은 이 PR에서 `legacy.css`의 토큰 값만 바꾸는 것으로 시작하고 개별 컴포넌트는 아래 이슈에서.
- 완료 조건: invariants 통과(HTML 불변이면 diff 0), 기존 접근성 시험 통과·개수 감소 0, 4모드 스크린샷 첨부(기준선과 비교용), Lighthouse 접근성 기준 이하 아님.
- 담당: engineer 구현, po·cpo 검토, cto 승인.

## U6 [개선] 노인덱스 파일럿 1 — rates.html (+ 금리 조각 클래스)
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U4, U5.
- 내용: `docs/rates.html`(11KB, noindex)의 껍데기·금리 조각(`ratesHtml`·`ratesHeadHtml`)의 class를 `tw:` 유틸리티로 개편(훅 클래스는 유지, 조각 태그 트리 불변, 껍데기 구조는 자유). 표의 모바일 카드 변형(`data-label`)과 가로 스크롤 동작 확인.
- 완료 조건: R-UI′ 준수, invariants 통과, 4모드 스크린샷, Lighthouse(3회 중앙값)가 기준선 대비 성능·접근성 악화 없음(성능은 −10% 초과 하락 없음), HTML gzip 증가 5% 이내(제안값; 초과 시 cto 판정), S6 불변.
- 담당: engineer, cpo/po 검토, cto 승인.

## U7 [개선] 노인덱스 파일럿 2·3 — 뉴스 틀(news.html→4장), deal-search.html
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U6 닫힘+24시간.
- 내용: `docs/news.html` 틀 개편(생성 3장 포함 4장 noindex)은 PR 1건, `deal-search.html`(인라인 JS 72KB, 훅 최다)은 별도 PR 1건. 훅 클래스·상태 클래스(`read sorted on placeholder` 등) 유지.
- 완료 조건: U6과 같음 + 검색·필터 동작 확인(기존 시험 `deal-search`·`filter-chips`·`rates-sort` 계열 통과).
- 담당: engineer, cpo/po, cto.

## U8 [개선] 색인 묶음 A·B — about·method, 도구 7장
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U7 닫힘+24시간, 정기 실행 둘 폴백 없이 성공.
- 내용: about·method(PR 1), 도구 7장(jeonse-vs-wolse·cancelled-deals·renewal-vs-new·floor-gap·record-high·switch-house·price-outlook; 장 단위 PR 가능, 하루 한 건). 조각이 쓰는 장은 조각의 class만.
- 완료 조건: U6과 같음 + 색인 대상이라 invariants의 canonical·robots·제목 계층 하드 항목 통과 증빙, #247에 기록.
- 담당: engineer, po·cmo 확인, cto.

## U9 [개선] 색인 묶음 C·D — 금리 틀(4장), index.html
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: U8 닫힘+24시간 **그리고 #247의 D+7(2026-10-19) 읽기가 #246 문턱 안**.
- 내용: `scripts/rates-template.html`(금리 4장), `docs/index.html`(첫 화면, 인라인 JS 75KB).
- 완료 조건: U8과 같음 + index의 첫 화면 CLS 기준선 이하(3회 중앙값).
- 담당: engineer, po·cmo, cto.

## U10 [개선] 색인 묶음 E — realestate.html 틀(47장)과 공용 스크립트(nav·search·analytics)의 class
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: **#247 닫힘(S8 통과·growth 안정 댓글)** — D+14(2026-10-26) 이후. 틀 하나가 47장(realestate 1·예산 18·거래유형 3·자치구 25)을 바꾸고 공용 스크립트는 67장 전부에 닿아 롤백 단위가 가장 크다.
- 내용: `docs/realestate.html` 틀 개편(PR 1건, 분할 불가), 이어서 `nav.js`·`search.js`의 class 정리(별도 PR; S6: JS 바이트 비증가).
- 완료 조건: U8과 같음 + 47장 전수 invariants, 생성 스크립트 문자열 패치(`replaceOnce`)가 깨지지 않음(기존 시험 통과).
- 담당: engineer, po·cmo·cpo, cto.

## U11 [개선] 조각 구조 변경과 legacy.css 퇴역 (#248 이후)
- 라벨 제안: enhancement, `우선순위: 후순위`
- 선행: **#248 닫힘**(legacy·폴백 제거).
- 내용: 조각의 태그 트리 변경(표→카드, 래퍼 추가 등), `legacy.css` 옛 규칙·옛 class 제거, parity 시험을 react 출력 fixture 검증으로 정리(#248 범위와 겹치면 #248에 흡수 여부를 pm이 판정). 
- 완료 조건: 옛 class 사용 0(`grep`), `legacy.css` 삭제 또는 빈 파일, invariants 통과, 시험 개수 감소 0(감소 사유는 #248 규칙대로 기록).
- 담당: engineer, po·cpo, cto.

---
## 소유자 결정 요청 (이 체인 전체에서 남은 것)
1) U2의 D1 시안 확인(필수, 1회). 2) 재신청(#67) 순서(비차단, 답 없으면 일정과 무관하게 진행).
