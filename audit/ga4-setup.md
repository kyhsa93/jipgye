# 집계 GA4 운영

GA4 속성: young's blog - GA4 (365557560), 웹 스트림 github page (4936225261), 측정 ID G-Z1LH7S1ZE5.
전용 보고서: https://analytics.google.com/analytics/web/?pli=1#/a119146423p365557560/reports/explorer?r=16211968778
보고서 이름: 집계 · 일반 방문과 핵심 행동. /jipgye/ 경로로 시작하며 Internal Traffic 테스트 표시를 제외하는 고정 필터를 저장했다.

개인 블로그와 공유하므로 항상 /jipgye/ 경로 조건을 적용한다. 저장된 비교 '집계 전용 · /jipgye/'를 재사용할 수 있다.

## 본인 방문 구분

운영 사이트에서 https://kyhsa93.github.io/jipgye/?ga_internal=1 을 한 번 열면 그 브라우저의 이후 방문을 traffic_type=internal 로 보낸다.
해제는 https://kyhsa93.github.io/jipgye/?ga_internal=0 . 브라우저·프로필마다 따로 설정하고 저장소가 차단된 경우 현재 페이지에만 적용된다.
GA4 기존 Internal Traffic 필터는 Testing 상태다. 표시된 방문은 Test data filter name = Internal Traffic 으로 구분하며, 일반 방문 보고서에서 제외한다.
필터가 적용되기까지 24~36시간이 걸릴 수 있다. 과거 방문을 소급해서 분리할 수 없고, Active 전환은 데이터가 영구 제외되므로 검증 후 별도로 결정한다.
기존 Developer Traffic 필터는 Active다. ?ga_debug=1 방문은 DebugView 검사용이며 일반 보고서 검증용으로 쓰지 않는다.

## 핵심 이벤트

| 이벤트 | 발생 시점 | 추가 매개변수 |
|---|---|---|
| calculator_result | 유효한 비교 결과를 화면에 표시한 뒤 800ms 동안 입력이 안정됐을 때 | calculator_type, result_status=success, result_scope; 전세·월세는 result_outcome |
| watchlist_add | 관심 단지 저장 성공 | watchlist_count |
| watchlist_remove | 관심 단지 삭제 성공 | watchlist_count |
| compare_start | 재계약 장 「다른 집으로 옮기면」 절(#777)을 처음 조작했을 때 장 하나에 1회(칸 입력·종류·기회비용 상자·참고값 단추·내 돈 단추). 장 열기·확인기 입력·언어 전환은 아니다 | calculator_type=renewal_move |
| calculator_unavailable | 비교할 수 없는 상태가 800ms 머물렀을 때 사유마다 장 하나에 1회 | calculator_type, unavailable_reason |
| evidence_open | 「이 계산의 근거와 한계」를 처음 펼쳤을 때 장 하나에 1회 | calculator_type=renewal_move |

calculator_type: jeonse_vs_wolse / renewal_vs_new / renewal_move(재계약 vs 이사 비교, #777).
result_scope: district_budget / matched_complex / district_band / inputs_only(renewal_move 에서 단지를 고르지 않고 금액만으로 비교).
result_outcome: 전세·월세는 jeonse/wolse/null, renewal_move 는 renew/move/even(입력한 조건에서 덜 드는 쪽 — 판정이 아니다). 관찰 지표에 쓰지 않아 맞춤 측정기준으로 등록하지 않는다.
result_round(renewal_move 만): first = 그 장에서 처음 센 결과, repeat = 결과를 본 뒤 조건을 바꿔 다시 센 결과. 화면이 analytics.js 와 같은 800ms 대기로 센다.
unavailable_reason: invalid_input(범위를 벗어난 입력 — 빈 칸은 입력 중이라 세지 않는다) / cash_short(보증금 80% 대출 가정을 넘어 견주지 않음) — renewal_move. low_sample(고른 칸의 한 줄이 min.show — 지금 3 — 건 미만, 확인기 표의 「표본 부족(n건)」과 같은 문턱. 근거 줄의 「표본 부족」은 min.ratio(5) 문턱이라 다르다) — renewal_vs_new.
자료 받기 실패는 이벤트로 세지 않는다(exception 은 장이 따로 보낸다). renewal_move 의 비교 불가는 calculator_result 로 세지 않는다(low_sample 은 renewal_vs_new 결과와 함께 날 수 있다).
calculator_result와 watchlist_add를 주요 이벤트로 등록한다. 기본 금액은 지정하지 않는다.
이벤트 범위 맞춤 측정기준: calculator_type(집계 계산 종류), result_scope(집계 결과 범위).

계산 결과 이벤트는 단지명·정확한 입력 금액을 보내지 않는다. 중복 방지용 입력 서명은 페이지 메모리에만 보관한다.
renewal_move 의 보증금·월세·내 돈·금리·기간 입력은 URL 에도 싣지 않는다(test/renewal-move.test.mjs 가 dataLayer 전체에 그 값과 단지명이 없음을 본다). page_referrer 도 page_location 과 같은 규칙으로 정리한다(#779).

전세·월세의 기존 조건 변경 이벤트 jeonse_vs_wolse는 계산 완료 횟수가 아니다. 현금은 conversion_cash_band의 구간으로만 전송한다.
GA 전송 URL에서 q, apt, dong, cash, ga_internal, ga_debug를 제거한다. 공유/복원용 실제 페이지 URL은 바꾸지 않는다.
관심 목록 저장 실패·10개 한도 초과·단순 재렌더는 저장 이벤트로 세지 않는다.

## 배포와 확인

소스 docs/와 테스트만 수정한다. main 병합 후 기존 Deploy site 워크플로가 build/site를 생성하고 시험한 뒤 GitHub Pages에 게시한다.
서비스워커는 HTML·JS를 네트워크 우선으로 받으므로 새 배포 후 다시 열어 확인한다.
DebugView에서 두 계산기를 조작하고 관심 단지를 담고 빼며 이벤트를 확인한다. 테스트 브라우저에 내부 표시를 켜 둔다.
일반 보고서·새 맞춤 측정기준은 24~48시간 처리 후 확인한다. 주요 이벤트 등록만으로 과거 계산 성공이 새로 만들어지지는 않는다.

Clarity는 이번 범위에서 설치하지 않는다. 사용자 요청에 따라 GA4만 사용한다.

## 관찰 지표(#777 P4 — 절대 목표치는 두지 않고 기준선부터 쌓는다, 단위는 모두 사용자 수)
- 비교 시작 대비 완료: calculator_result(calculator_type=renewal_move) 사용자 ÷ compare_start 사용자. 결과가 있는 사용자는 곧 first 가 있는 사용자다.
- 비교 불가 비율과 원인: calculator_unavailable(calculator_type=renewal_move) 사용자 ÷ compare_start 사용자, unavailable_reason 별. 사유마다 장 하나에 1건(그래서 한 장에 최대 2건).
- 조건을 바꿔 다시 비교: result_round=repeat 가 있는 사용자 ÷ renewal_move 결과가 있는 사용자.
- 근거를 열어 본 비율: compare_start 사용자 가운데 evidence_open 이 있는 사용자(탐색 세그먼트). evidence_open 은 compare_start 없이도 난다 — 단순 나눗셈으로 쓰지 않는다.
- 확인기 표본 부족: calculator_unavailable(renewal_vs_new, low_sample) 건수만(분모 없음). 장을 열기만 해도 나고, 같은 칸의 renewal_vs_new calculator_result 와 함께 날 수 있다.

## 소유자 콘솔 작업(#777 P4)
이벤트 범위 맞춤 측정기준 둘을 등록해야 위 지표를 보고서에서 나눌 수 있다 — result_round(집계 결과 회차), unavailable_reason(집계 비교 불가 사유). 등록 전 데이터는 소급되지 않는다. 시작 대비 완료와 이벤트 이름별 건수(compare_start·evidence_open)는 등록 없이(이미 있는 calculator_type 으로) 보인다.
calculator_result 는 주요 이벤트다 — #777 배포일부터 renewal_move 가 더해져 합계 추이가 끊기므로 calculator_type 으로 나눠 본다.
