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

calculator_type: jeonse_vs_wolse / renewal_vs_new.
result_scope: district_budget / matched_complex / district_band.
calculator_result와 watchlist_add를 주요 이벤트로 등록한다. 기본 금액은 지정하지 않는다.
이벤트 범위 맞춤 측정기준: calculator_type(집계 계산 종류), result_scope(집계 결과 범위).

계산 결과 이벤트는 단지명·정확한 입력 금액을 보내지 않는다. 중복 방지용 입력 서명은 페이지 메모리에만 보관한다.
전세·월세의 기존 조건 변경 이벤트 jeonse_vs_wolse는 계산 완료 횟수가 아니다. 현금은 conversion_cash_band의 구간으로만 전송한다.
GA 전송 URL에서 q, apt, dong, cash, ga_internal, ga_debug를 제거한다. 공유/복원용 실제 페이지 URL은 바꾸지 않는다.
관심 목록 저장 실패·10개 한도 초과·단순 재렌더는 저장 이벤트로 세지 않는다.

## 배포와 확인

소스 docs/와 테스트만 수정한다. main 병합 후 기존 Deploy site 워크플로가 build/site를 생성하고 시험한 뒤 GitHub Pages에 게시한다.
서비스워커는 HTML·JS를 네트워크 우선으로 받으므로 새 배포 후 다시 열어 확인한다.
DebugView에서 두 계산기를 조작하고 관심 단지를 담고 빼며 이벤트를 확인한다. 테스트 브라우저에 내부 표시를 켜 둔다.
일반 보고서·새 맞춤 측정기준은 24~48시간 처리 후 확인한다. 주요 이벤트 등록만으로 과거 계산 성공이 새로 만들어지지는 않는다.

Clarity는 이번 범위에서 설치하지 않는다. 사용자 요청에 따라 GA4만 사용한다.

