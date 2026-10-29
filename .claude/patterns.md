# 승인된 패턴 (#548, cto 판정 2026-10-24)

같은 모양의 PR 이 되풀이되면 매번 전체 판정을 하지 않고, 한 번 승인한 **패턴**에 해당하는지만 본다. 패턴은 이 파일에 등록한다. 판정 에이전트는 PR 본문의 패턴 ID 로 여기 절을 찾는다.
골든 도구(`scripts/dev/golden-run.sh`, `scripts/dev/golden-expect.mjs`)는 이 파일의 「이유 문구」 줄을 읽는다 — 줄 모양(`- <check id>: <문구>`)을 바꾸면 도구가 멈춘다.

## 위임 규칙

**「P1 해당」은 아래 조건이 전부 충족될 때만이다**(이슈 #548 본문은 "6개"라 썼지만 나열한 것은 일곱 항목이고, 나열대로 일곱 모두를 조건으로 둔다).
1. 같은 메커니즘이다(아래 P1 「메커니즘」).
2. 바뀐 파일이 전부 허용 목록 안이다.
3. 장별 인라인 script 순증이 ≤ +400 B 이다.
4. `docs/load-state.js` 가 한 줄도 안 바뀌었다.
5. 영어 알림 규칙을 지킨다.
6. 골든 하드 실패가 등록된 예외 모양(`inline-script` + `s6-inline-bytes`)뿐이다.
7. CLS 가 0 이고 접근성 role 이 기준과 같다.

**해당이면** 판정은 「패턴 일탈」 절만 쓴다. 일탈이 없으면 `P1 해당, 일탈 없음, <head SHA>` 한 줄이다.

**항상 전체 판정**(패턴 위임 없음): 새 메커니즘 · 바이트 초과 · 데이터·워크플로·수집기·scripts 의 데이터 생성부 접촉 · 새 S6 예외 종류나 새 하드 실패 id · 접근성·CLS 악화 · 소유자 승인 사안 · 허용 목록 밖 파일(`test/COUNT*` 를 내리는 PR 포함). 일탈이 두 건 연속이면 그 모양을 패턴으로 새로 등록한다.

**서명.** cto + po + cmo 가 **한 번에 한 판정 댓글**을 쓴다(서명 3줄을 한 댓글에). 골든 expect 의 `confirmedBy` 는 그 댓글 URL 하나다. cpo 는 D 등급이거나 제품 범위가 바뀔 때만 부른다. P1 밖 모든 PR 도 같은 한 댓글이다(`.claude/ENGINEER-COMMON.md` 「판정은 PR 하나에 한 댓글」). 재검토는 **마지막 판정 SHA 이후 바뀐 줄만** 본다. 판정 댓글은 ≤8줄(SHA · 해당 패턴 · 일탈 판정 · 서명).

## P1 — 틀 고지 PR (등록 2026-10-24, 근거 PR #412 #527 #528 #531 #534 #536 #546)

### 메커니즘
틀 페이지(손으로 고치는 틀)가 데이터 요청의 **받는 중·재시도 대기·실패** 상태를 말할 때, 구운 내용을 지우지 않고 그 옆에 알림 한 자리를 상태 하나로 그린다. 영어 화면에서는 한국어 전용 내용이 있음을 고지 한 줄로 알린다. 공통 함수 `notifyBeside`(`docs/load-state.js`, #412 이 도입)를 부르기만 하고, 새 문장·id·`data-*`·CSS 를 만들지 않는 것이 기본이다. 알림은 언어 전환을 따라가고 왕복해도 하나다.

| PR | 이슈 | 대상 |
|---|---|---|
| #412 | #296 (바) | 시세 틀 — `notifyBeside` 도입, 유일하게 `load-state.js` 를 바꾼 PR(기준) |
| #527 | #296 (다) | index 틀 |
| #528 | #296 (나) | 뉴스 틀 |
| #531 | #296 (마), #323 | 금리 틀 |
| #534 | #296 (가)(라) | 분석 틀 |
| #536 | #532 | 금리 추이 |
| #546 | #410, #413 | 시세 틀 받는 중·재시도 대기 영어 고지, `?area=59` 칸 가림, 언어 전환 |

### 허용 파일 목록
- `docs/*.html` 중 손으로 고치는 틀(생성 장은 main 에 없다 — 사이트는 배포 때 `build/site` 에 만들어진다).
- `scripts/*template*.html`(`realestate-template.html`).
- 시험 파일(`test/*.test.mjs`, `test/helpers/*.mjs`).
이 밖의 파일이 `gh pr diff --stat` 에 보이면 패턴이 아니라 전체 판정이다. `docs/load-state.js`·`test/COUNT*`(PR 은 하한을 건드리지 않는다, #548)·워크플로·수집기·`scripts/` 의 데이터 생성부는 목록 밖이다.

### 예산
장별 틀 인라인 script 순증 ≤ **+400 B**(골든 `s6-inline-bytes` 의 `added` 끝 `(+N)`). 기준: #546 은 47장 모두 +358 B/장이었다. 넘으면 `golden-expect` 가 「전체 판정」을 찍고 멈춘다.

### 영어 알림 규칙
영어 화면의 알림 본문은 영어이고 **끝에 `Some of it is in Korean only.` 가 정확히 한 번** 붙는다. 한국어 화면에는 이 문장이 0번이다. 알림 요소는 한 번에 하나(언어 전환·재시도·왕복에도 중복 없음)이고 구운 한국어 내용은 그대로 둔다.

### 골든 예외 모양
`invariants.ts --render` 의 하드 실패가 아래 둘뿐이다.
- `inline-script`: 모든 장에서 줄 번호까지 같으면 `"page":"*"` **한 줄**(#546 은 47장 × 31줄), 장마다 다르면 장별 항목.
- `s6-inline-bytes`: **장마다 한 줄**(`missing` `55862B`, `added` `56220B (+358)` 처럼 문자열이 장마다 다르다).
둘의 `confirmedBy` 는 판정 댓글 URL 하나다. 검증은 `--expect` 로 「불변 비교 N장 — 통과 N, 하드 실패 0」 이고 「쓰이지 않은 예외 0」이어야 한다.

### 이유 문구
`golden-expect` 가 읽는 줄이다(`{refs}` = `--refs` 로 준 이슈 번호, `{bytes}` = 그 장의 순증 바이트).
- inline-script: {refs} 패턴 P1 — 승인된 틀 고지 메커니즘의 인라인 script 줄 변경(장 동일 항목)
- s6-inline-bytes: {refs} 패턴 P1 — 틀 인라인 +{bytes} B/장 ≤ 기준+400 B(cto 판정 #548)

**S6 예외 종류 — 장 전용 외부 JS**(cto 승인 #681 https://github.com/kyhsa93/jipgye/pull/681#issuecomment-6403354947): 한 장만 `defer` 로 참조하고 sw.js 사전캐시에 넣지 않는 `docs/*.js` 는 gzip ≤2 KB 까지 `s6-js-total`·`s6-scripts`·`s6-external-bytes` 를 예외로 받는다(문구를 그 장의 `data-*` 속성으로 옮겨 생기는 `attr-text` 도 같이 받는다 — #681 재판정 6403575944; 첫 사례 `renewal-convert.js`, 시험이 gzip·참조 장·사전캐시를 지킨다). 그 밖은 전체 판정.
- **측정 기준(#784)**: 장 전용 외부 JS(sw.js `SHELL_ASSETS` 에 없는 `docs/*.js`)는 배포 사본에서 주석을 뗀다(`scripts/page-assets.ts` `stripPageScripts`, 주석만 뗐다는 증명은 `test/page-assets.test.mjs`). 그래서 2 KB 는 **나가는 사본(주석 뗀 것)의 gzip** 이다. 소스 주석은 줄이지 않는다(#313 과 같은 길).
- 둘째 사례 `lease-expiry.js`(#674 N2, renewal-vs-new 만기 달력 — 구를 골라 12개월 표를 다시 그리는 일이라 빌드 시점 렌더로 대신할 수 없다): gzip 1,667 B(level 9), 같은 장의 두 번째 장 전용 JS. 시험 `test/lease-expiry-section.test.mjs` 가 gzip·참조 장·사전캐시를 지킨다.
- 셋째·넷째 사례 `move-cost.js`·`renewal-move.js`(#777 재계약 vs 이사 비교 절 — 사용자가 넣은 금액으로 다시 계산하는 일이라 빌드 시점 렌더로 대신할 수 없다): 같은 장의 셋째·넷째 장 전용 JS(pm 판정 #777 댓글 6471593090). 계산·문장 함수는 `move-cost.js`, DOM 배선은 `renewal-move.js`. 배포 사본 gzip(level 9) move-cost 1,597 B · renewal-move 1,587 B(P3 시점 실측). 시험 `test/renewal-move.test.mjs` 가 gzip(배포 사본 기준)·참조 장·사전캐시를 지킨다.
- 다섯째 사례 `renewal-move-basis.js`(#777 P3 참고값 단추·근거 줄 배선, 배포 사본 gzip 1,209 B — P3 시점 실측, 이 장 다섯 파일 합 7,130 B. P4(계측·금리 줄을 근거 파일로) 뒤 basis 1,588 · renewal-move 1,873 · 합 7,795 B. P5(일회성 비용·손익분기) 뒤 move-cost 2,006 · renewal-move 1,933 · 합 8,264 B. #792(입력 흐름·칸 옆 오류·계산에 쓴 금리) 뒤 move-cost 2,046 · renewal-move 2,004 · basis 1,875 · 합 8,662 B): group-cto 조건부 승인 https://github.com/kyhsa93/jipgye/issues/777#issuecomment-6472370190 — 기능 경계로 나누고, 이 장 다섯 파일 목록·합계를 `test/renewal-move.test.mjs` 가 지킨다. **이 장 여섯째 파일이나 파일당 한도 올리기는 group-ceo 안건이다.**
- 여섯째 사례 `move-text.js`(#792 5 — 재계약 vs 이사 결과의 문장·표 줄. `move-cost.js` 에서 계산(check·side·compare)과 나눔): group-ceo 판정 A https://github.com/kyhsa93/jipgye/issues/792#issuecomment-6478527947 — 조건 ① 기능 경계로 나눔, 여섯 파일 각 ≤2,048 B ② `test/renewal-move.test.mjs` 가 여섯 파일 목록·합계 고정, 합계 상한은 병합 때 잰 값을 100 B 단위로 올림, 그 뒤 +400 B 넘게 늘면 group-cto 재판정 ③ 배선 파일(`renewal-move.js`)이 넘치면 일곱째 파일·한도 올리기로 풀지 않고 배선을 줄이거나 다시 group-ceo 안건 ④ 이 장 Lighthouse 가 S7 안. 병합 커밋 실측(배포 사본 gzip): move-cost 1,101 · move-text 1,381 · renewal-move 1,958 · basis 1,997 · 이 장 여섯 합 9,174 B(합계 상한 9,200 B). #797(모바일 핵심 숫자 카드·금액 읽기·선택 조건 요약·금리 문구, +564 B) 뒤 실측: move-cost 1,101 · move-text 2,031 · renewal-move 1,938 · basis 1,931 · 여섯 합 9,738 B(합계 상한 9,800 B) — group-cto 재판정 조건부 승인(병합 커밋 재측정 ≤9,800 B·Lighthouse S7, 다음 재판정 기준점은 이 병합 실측). move-text 여유 17 B 라 다음 증가는 조건 ③ 으로 간다.
