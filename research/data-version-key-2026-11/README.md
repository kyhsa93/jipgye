# 재방문 데이터 전송량 — 판 키 전후 (#695 완료 2)

- 측정일: 2026-11-16 (KST 14:42, 다른 무거운 계산 없이 단독 실행, `uptime` 부하 2.7 → 1.1)
- 입력: 같은 docs/data(origin/main b360dcfb)로 그린 두 렌더 출력. 기준 = b360dcfb 의 `render-pipeline --out`, 후보 = 가지 auto/695-data-keys 의 같은 명령. `diff -rq base/data head/data` 차이 0.
- 브라우저: Chromium(playwright 1.62.1, chromium-1234, 헤드리스).
- 서버: `measure.mjs` 안의 Pages 흉내 서버 — `cache-control: max-age=600`, ETag(내용 해시), If-None-Match 일치 시 304(본문 0), 쿼리 무시. 「만료 뒤」는 서버가 `max-age=0` + ETag 를 준다.
- 센 것: 재방문(같은 브라우저 문맥에서 새 탭으로 같은 주소) 동안 서버가 `/data/` 에 보낸 **본문 바이트**(압축 전), 200·304 따로. 첫 방문은 세지 않는다.
- 서비스 워커 허용: index.html 을 먼저 열어 `navigator.serviceWorker.ready` 뒤에 잰다. 표의 모든 허용 행에서 측정 장이 SW 제어 아래였다(`controller` 있음, result.json `controlled`).

재현: `PLAYWRIGHT=<playwright 패키지 경로> node research/data-version-key-2026-11/measure.mjs --base=<기준 렌더> --head=<후보 렌더> --out=result.json`

| 장 | SW | 재방문 | 기준 /data/ 바이트 (200·304) | 후보 /data/ 바이트 (200·304) | 변화 |
|---|---|---|---|---|---|
| realestate | 차단 | 즉시 | 442,214 (3·0) | 0 (0·0) | −100% |
| realestate | 차단 | 만료 뒤 | 442,214 (3·0) | 0 (0·3) | −100% |
| realestate | 허용 | 즉시 | 442,214 (3·0) | 0 (0·0) | −100% |
| realestate | 허용 | 만료 뒤 | 442,214 (3·0) | 0 (0·3) | −100% |
| deal-search (강남구) | 차단 | 즉시 | 494,968 (4·0) | 0 (0·0) | −100% |
| deal-search (강남구) | 차단 | 만료 뒤 | 494,968 (4·0) | 0 (0·4) | −100% |
| deal-search (강남구) | 허용 | 즉시 | 494,968 (4·0) | 0 (0·0) | −100% |
| deal-search (강남구) | 허용 | 만료 뒤 | 494,968 (4·0) | 0 (0·4) | −100% |
| news | 차단 | 즉시 | 31,104 (2·0) | 0 (0·0) | −100% |
| news | 차단 | 만료 뒤 | 31,104 (2·0) | 0 (0·2) | −100% |
| news | 허용 | 즉시 | 31,104 (2·0) | 0 (0·0) | −100% |
| news | 허용 | 만료 뒤 | 31,104 (2·0) | 0 (0·2) | −100% |
| budget-7eok (예산대 틀, 관문 아님) | 차단 | 즉시 | 586,027 (4·0) | 0 (0·0) | −100% |
| budget-7eok | 차단 | 만료 뒤 | 586,027 (4·0) | 0 (0·4) | −100% |
| budget-7eok | 허용 | 즉시 | 586,027 (4·0) | 0 (0·0) | −100% |
| budget-7eok | 허용 | 만료 뒤 | 586,027 (4·0) | 0 (0·4) | −100% |

요청 파일 목록(경로·쿼리 앞머리·상태)은 `result.json` 의 `files` 다. 이 네 장의 재방문(조작 없이 열기만)에서는 키 없는 데이터 요청(search.js 의 search-index.json·budget-table.js 의 reco-*.json)이 서버 로그에 나오지 않았다. 둘은 범위 밖이다(#917).

읽는 법: 절감은 **같은 데이터 판 안의 재방문**이다. Daily 가 데이터 185개 중 181개를 매일 바꾸고 news 장의 키는 Summarize 때도 바뀌므로, 판이 바뀐 뒤의 첫 재방문은 전처럼 새로 받는다. 배포 뒤 실제 주소의 재측정은 머지 판정 뒤 cto 가 본다.
