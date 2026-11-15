# raw/

이 폴더는 집계가 공공 데이터 원천에서 받은 자료를 받은 그대로 두는 곳이다. 사이트 화면과 Release 의 숫자는 이 자료를 집계·가공한 값이다. `sale/`·`rent/`는 국토교통부 실거래 API 응답의 행 단위 사본이며, 수집 시각·처음 본 날 같은 수집 기록만 더했다. 원천이 공개한 항목 밖의 것을 더하거나 다른 자료와 결합해 두지 않는다. 아래 이용허락은 각 원천 페이지가 표시한 문자열이고, 확인일은 그 페이지를 다시 본 날이다.

| 폴더 | 원천 | 이용허락(원천 표시) | 원천 수정일 | 확인일 |
|---|---|---|---|---|
| `sale/` | 국토교통부 아파트 매매 실거래가 자료, 공공데이터포털 [15126469](https://www.data.go.kr/data/15126469/openapi.do). 서울 25개 구 × 계약월 파일 | 이용허락범위 제한 없음 | 2026-07-22 | 2026-11-15 |
| `rent/` | 국토교통부 아파트 전월세 실거래가 자료, 공공데이터포털 [15126474](https://www.data.go.kr/data/15126474/openapi.do). 서울 25개 구 × 계약월 파일 | 이용허락범위 제한 없음 | 2026-07-29 | 2026-11-15 |
| `recollect/` | `sale/`과 같은 원천(공공데이터포털 [15126469](https://www.data.go.kr/data/15126469/openapi.do)). `sale/`의 지난 계약월을 다시 받아 저장 파일과 다른 행만 둔다. `recollect/sale/<구>-<달>.json`은 바뀐 행과 새 행을 원천 응답 그대로 담고, 원천이 더는 내지 않는 행은 행 해시만 담는다. `recollect/round-<달>.json`은 회차 기록이다(받은 달·호출 수·파일별 처리 결과·소유자 고지 링크). `sale/` 파일은 고치지 않는다 | 이용허락범위 제한 없음 | 2026-07-22 | 2026-11-15 |
| `official-price/` | 국토교통부 건축HUB 건축물대장정보 서비스, 공공데이터포털 [15134735](https://www.data.go.kr/data/15134735/openapi.do). 주택가격을 지번·전용면적 칸으로 접은 값이며 원천 응답 행이 아니다 | 이용허락범위 제한 없음 | 2026-07-10 | 2026-11-15 |
| `move-in/` | 한국부동산원 주택공급정보 입주예정물량정보, 공공데이터포털 파일데이터 [15111714](https://www.data.go.kr/data/15111714/fileData.do). 받은 CSV 그대로다. 원천 설명에 따르면 한국부동산원과 부동산114가 보유한 자료로 산정한 값이다 | 이용허락범위 제한 없음 | 2026-08-28 | 2026-11-15 |
| `ecos/` | 한국부동산원 아파트 실거래가격지수(한국은행 경제통계시스템(ECOS) 901Y089 제공) | 한국은행 저작권보호방침: 출처 표시, 가공했으면 그 사실 표시 | - | 2026-10-25 |
| `indicators/` | `series.json`: 한국은행 ECOS 계열과 한국부동산원 R-ONE 계열. `rone-districts.json`: R-ONE A_2024_00045. KB국민은행 주택가격지수 원값은 두지 않는다 | ECOS: 위와 같다. R-ONE 서비스이용약관: 저작자·출처 표시, 임의 변경·왜곡 금지(공공데이터포털 15134761 표시는 이용허락범위 제한 없음, 수정일 2024-09-05) | - | 2026-10-25 |

`raw/` 밖에도 원천 사본이 하나 있다. `research/buyer-search-timing-2026-10/cache/kapt-seoul.json`은 공동주택관리정보시스템(K-apt) 자료실의 기본정보 엑셀(2026-09-25 게시분)에서 서울 3,336개 단지의 단지 정보만 뽑은 것이다. 이용조건은 아직 확인하지 못했고 다음 재확인 때 본다. 아래 정정·삭제 규칙을 같이 따른다.

**정정·삭제.** 원천이 기록을 정정·삭제하면 이 폴더도 따른다. `sale/`·`rent/`는 최근 몇 달의 파일만 정해진 주기로 다시 받아 원천에 맞추고(범위는 `scripts/realestate-slots.ts`), 그보다 오래된 달은 다시 받지 않으므로 원천의 정정이 바로 반영되지 않는다. 다만 매매는 그 가운데 정해진 달(범위는 `scripts/recollect-sale.ts`)을 한 달에 한 번 다시 받아 차이만 `recollect/`에 두고, 그 차이를 합쳐 읽는 계산은 `scripts/realestate-recollect.ts`에 적혀 있다. 원천이 더는 내지 않는 행은 `recollect/`에 해시로만 표시하고 그 계산에서 빼지만, 행 본문은 `sale/` 파일에 남으며 지워 달라는 요청이 오면 `sale/`과 `recollect/sale/` 두 곳에서 지운다. 보관 창을 벗어난 달은 `recollect/sale/`의 같은 달 파일도 같이 지운다. 계약월이 보관 창(24개월)을 벗어난 파일은 지운다. `ecos/`·`indicators/`는 최근 14개월을 매일 다시 받고, `move-in/`은 원천 파일을 매일 다시 받는다. 원천이 정정·삭제한 기록을 알려 주면 그 파일을 다시 받아 맞춘다. 지난 내용은 git 이력에 남으며, 이력에서 지워 달라는 요청도 같은 경로로 받아 검토한다.

**요청 경로.** 저장소 이슈(https://github.com/kyhsa93/jipgye/issues)로 받는다. 공개 글이므로 파일 이름(예: `sale/11110-202505.json`)만 적고, 개인을 알아볼 수 있는 내용이나 연락처는 적지 말아 달라.

**이용허락 재확인.** 위 표의 원천 페이지를 다시 보고 문자열·수정일·확인일을 이 표에 고친다. 다음 재확인은 첫 집계 Release(#485) 공개 전 7일 안이고, 그 뒤로는 마지막 확인일에서 6개월 안이다. 원천 페이지의 이용허락 표시나 수정일이 바뀐 것을 알면 바로 다시 본다. 이용허락이 「제한 없음」에서 바뀌면 이 폴더의 공개 여부를 다시 정한다.

This folder keeps data from public sources as received. `sale/` and `rent/` are record-level copies of the Ministry of Land, Infrastructure and Transport real transaction APIs (data.go.kr 15126469 and 15126474; licence shown on the source pages: no restriction, checked 2026-11-15), with only collection records added. The table above lists each folder's source, licence terms and check date. If a source corrects or deletes records we follow it: recent months are re-fetched on a schedule, and older months are re-fetched when we are told about a correction. For sales, some recent months are also re-fetched once a month into `recollect/` as differences only (changed and new rows as the source returned them, rows the source no longer returns as hashes, plus a per-round log); the `sale/` files are not rewritten, so such a row stays there until its month leaves the 24-month window or someone asks us to remove it. Requests for correction or removal go to the repository's issues (https://github.com/kyhsa93/jipgye/issues); please name the file only and do not post personal information.
