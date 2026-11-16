# 재방문 데이터 전송량 — 판 키 전후 (#695 완료 2)

- 측정일: 2026-11-16 (KST 14:42, 다른 무거운 계산 없이 단독 실행, `uptime` 부하 2.7 → 1.1)
- 입력: 같은 docs/data(origin/main b360dcfb)로 그린 두 렌더 출력. 기준 = b360dcfb 의 `render-pipeline --out`, 후보 = 가지 auto/695-data-keys 의 같은 명령. `diff -rq base/data head/data` 차이 0.
- 브라우저: Chromium(playwright 1.62.1, chromium-1234, 헤드리스).
- 서버: `measure.mjs` 안의 Pages 흉내 서버 — `cache-control: max-age=600`, ETag, If-None-Match 일치 시 304(본문 0), 쿼리 무시. 「만료 뒤」는 서버가 `max-age=0` + ETag 를 준다. ETag 는 두 기준이 다르다: 흉내 서버는 내용 해시이고, 실제 Pages 는 `"<배포 시각 16진>-<크기 16진>"`(약한 `W/` 포함)이다(#695 실주소 재측정, #917). 그래서 실제 Pages 의 「만료 뒤」 304 는 그 사이 재배포가 없을 때만 나온다.
- 센 것: 재방문(같은 브라우저 문맥에서 새 탭으로 같은 주소) 동안 서버가 `/data/` 에 보낸 **본문 바이트**(압축 전), 200·304 따로. 첫 방문은 세지 않는다.
- 서비스 워커 허용: index.html 을 먼저 열어 `navigator.serviceWorker.ready` 뒤에 잰다. 표의 모든 허용 행에서 측정 장이 SW 제어 아래였다(`controller` 있음, result.json `controlled`).

재현: `PLAYWRIGHT=<playwright 패키지 경로> node research/data-version-key-2026-11/measure.mjs --base=<기준 렌더> --head=<후보 렌더> --out=result.json`

| 장 | SW | 재방문 | 기준 /data/ 바이트 (200·304) | 후보 /data/ 바이트 (200·304) | 변화 |
|---|---|---|---|---|---|
| realestate | 차단 | 즉시 | 442,214 (3·0) | 0 (0·0) | −100% |
| realestate | 차단 | 만료 뒤† | 442,214 (3·0) | 0 (0·3) | −100% |
| realestate | 허용 | 즉시 | 442,214 (3·0) | 0 (0·0) | −100% |
| realestate | 허용 | 만료 뒤† | 442,214 (3·0) | 0 (0·3) | −100% |
| deal-search (강남구) | 차단 | 즉시 | 494,968 (4·0) | 0 (0·0) | −100% |
| deal-search (강남구) | 차단 | 만료 뒤† | 494,968 (4·0) | 0 (0·4) | −100% |
| deal-search (강남구) | 허용 | 즉시 | 494,968 (4·0) | 0 (0·0) | −100% |
| deal-search (강남구) | 허용 | 만료 뒤† | 494,968 (4·0) | 0 (0·4) | −100% |
| news | 차단 | 즉시 | 31,104 (2·0) | 0 (0·0) | −100% |
| news | 차단 | 만료 뒤† | 31,104 (2·0) | 0 (0·2) | −100% |
| news | 허용 | 즉시 | 31,104 (2·0) | 0 (0·0) | −100% |
| news | 허용 | 만료 뒤† | 31,104 (2·0) | 0 (0·2) | −100% |
| budget-7eok (예산대 틀, 관문 아님) | 차단 | 즉시 | 586,027 (4·0) | 0 (0·0) | −100% |
| budget-7eok | 차단 | 만료 뒤† | 586,027 (4·0) | 0 (0·4) | −100% |
| budget-7eok | 허용 | 즉시 | 586,027 (4·0) | 0 (0·0) | −100% |
| budget-7eok | 허용 | 만료 뒤† | 586,027 (4·0) | 0 (0·4) | −100% |

† 후보의 304 는 흉내 서버의 내용 해시 ETag 기준이다. 실제 Pages 는 ETag 가 배포 시각 꼴이라, 600초 뒤 재검증 사이에 재배포가 한 번이라도 있으면 키가 같아도 200 으로 본문 전체를 받는다(하루 12~34회 배포한 날은 0에 가까울 수 있다). 「즉시」(600초 안) 행의 절감은 ETag 와 상관없다.

요청 파일 목록(경로·쿼리 앞머리·상태)은 `result.json` 의 `files` 다. 이 네 장의 재방문(조작 없이 열기만)에서는 키 없는 데이터 요청(search.js 의 search-index.json·budget-table.js 의 reco-*.json)이 서버 로그에 나오지 않았다. 둘은 범위 밖이다(#917).

읽는 법: 절감은 **같은 데이터 판 안의 재방문**이다. Daily 가 데이터 185개 중 181개를 매일 바꾸고 news 장의 키는 Summarize 때도 바뀌므로, 판이 바뀐 뒤의 첫 재방문은 전처럼 새로 받는다. 배포 뒤 실제 주소의 재측정은 머지 판정 뒤 cto 가 본다.

## #917 — 키 없이 받던 세 곳(search-index·reco-counts·reco-${sl})

사전 등록(측정 전에 적었다, 2026-11-16). 결과는 `result-917.json` 에 쓰고 위 `result.json`(#695 기록)은 고치지 않는다.

- 입력: base = origin/main 0916d6bf(#695 병합 ca94ed12 이후)의 `render-pipeline --out`, head = 가지 auto/917-data-keys-rest 의 같은 명령. `diff -rq base/data head/data` 차이 0.
- 서버·센 것: 위와 같은 흉내 서버(ETag 동작 그대로)와 같은 정의 — 재방문 동안 `/data/` 에 보낸 본문 바이트 전체. 대상 파일별 값은 따로 적는다.
- 장과 조작(첫 방문과 재방문에서 똑같이 한다 - 첫 방문에서 받아야 재방문 캐시를 잴 수 있다):
  - (가) `index.html`: 열고 `#site-search-input` 에 포커스 → 대상 `search-index.json`(search.js 의 focus 처리기가 한 번 받는다).
  - (나) `buy-by-budget.html`: 열고 **노원구** 행의 「줄 보기」 버튼을 누른다 → 대상 `reco-counts.json`(열 때)·`reco-nowon.json`(누를 때).
    버튼의 `data-d` 는 구 이름이 아니라 건수 파일 `C.d` 의 순번이다(0916d6bf 데이터에서 노원구 = 8). 그래서 순번을 박지 않고 `#bt-live` 표에서 행 머리 글자가 「노원구」인 행의 버튼을 찾는다.
    버튼은 reco-counts.json 을 받은 뒤 그려지므로 15초까지 기다린다. 그래도 없으면 측정 실패로 멈추고, 다른 구로 바꾸지 않는다.
- 유효 조건: 첫 방문에서 base·head 모두 대상 파일마다 200 이 1건 이상(아니면 조작 실패). SW 허용 행은 측정 장이 SW 제어 아래이고 base 재방문에 대상 파일 200 이 1건 이상일 때만 인정한다(0건이면 −100% 가 아니라 측정 실패).
- 문턱: SW 허용 두 행(즉시·만료 뒤)만 기준 대비 −80% 이상. SW 차단 두 행은 기준도 HTTP 캐시가 받으므로(즉시는 디스크 캐시, 만료 뒤는 304) 바이트와 200·304 수를 기록만 하고, head 가 base 보다 늘면 멈춘다.
- 두 기준: 흉내 서버는 내용 해시 ETag, 실제 Pages 는 배포 시각 ETag 다. 실제 Pages 의 「만료 뒤」 절감은 그 사이 재배포가 없을 때만 생긴다. 「즉시」 절감은 둘 다 같다.

재현: `PLAYWRIGHT=<playwright 패키지 경로> node research/data-version-key-2026-11/measure.mjs --base=<기준 렌더> --head=<후보 렌더> --set=917 --out=research/data-version-key-2026-11/result-917.json`
