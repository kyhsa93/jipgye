# #900 사전 등록: 재수집 덧씌움 소비자 2단계 (측정 전, 2026-11-16)

#861 정정 ④ 표(pm, #861 issuecomment-6892470425)를 보면, 덧씌움(raw/recollect)을 읽는 화면은 시세 칸·해제·등기·정정 Release, 그리고 #920(PR #922) 뒤의 단지 추이뿐이다.
이 문서는 측정 전에 다음을 고정한다. 결과를 보기 전에 커밋하며, 이 커밋의 sha가 「측정 전 sha」다.

- (가) 두 경로: 거래 검색·예산, 전세가율·전세 비중. 어긋남 행·칸이 있으면 덧씌움으로 바꾼다.
- (나) 여섯 빌더: 직거래, 갈아타기·가격대 변화, 신고가, 층 격차, 예산 군집, 반복거래. 공개 값이 달라지면 넓히고, 아니면 「아니오」로 확정한다.

고정하는 것은 지표, 어긋남 정의, 문턱, 무효·멈춤 조건, 실행 명령이다. 이 등록에서는 실거래 API를 한 번도 부르지 않는다.

단지 추이(`build-complex-history.ts`)는 이 측정 밖이다. #920이 고쳤고, 그 전후 차이는 PR #922 본문이 기록이다(본문 v2 「이 이슈 밖」).
그래서 #908 기록의 곁가지도 이 측정에 넣지 않는다. 곁가지는 `complex-history-*.json`이 complex-price 칸 이름을 거쳐 25개 중 12개가 달라진 일이다.

## 1. 고정값

| 항목 | 값 | 근거 |
|---|---|---|
| R0 (원본 커밋) | `f692748e4c0434557f382470de883e3646234b39` (2026-11-16 Daily 「실거래 원본」) | 본문 기준 커밋, #908과 같음 |
| 데이터 커밋 | `cd20a99bc954797ae12bedeffa48252e8e505a22` (같은 실행 「데일리 데이터 갱신」) | 아래 참고 |
| 코드 | main `05a4469e0f90e5021efee3b436521a7802b86f74` | 아래 참고 |
| 덧씌움 | raw/recollect 1회차 `f3def1ee` (round 202611, 202604~202609 × 25구 = 150파일) | R0 확인 (a): `git diff --stat f3def1ee cd20a99b -- raw/recollect` 0줄(등록 때 확인, 실행 때 다시 확인) |
| 동명 단지 판정 | 늘 저장 원본(`readSameNames(raw)`) | #861 정정 ④ 8행 고정 「아니오」. 소비자를 따르지 않는다 |

데이터 커밋을 쓰는 이유는 cto 권고다. raw와 docs/data를 둘 다 cd20a99b에서 꺼낸다.

- 방법: `git restore --source=<커밋> --staged --worktree -- raw` 뒤에 `git diff --cached --quiet <커밋> -- raw`로 확인한다.
- cd20a99b의 raw는 R0에 `raw/first-seen/rent` 9파일만 더한 것이다.
- 이 등록의 빌더가 읽는 raw/sale·rent·recollect·ecos·indicators는 R0와 0파일 다르다.

코드를 05a4469e로 고정하는 이유는 본문 「기준 커밋·순서」 표의 측정 시점 세 가지를 모두 채우기 때문이다.

- (가) 거래 검색·예산: 「R0 이후 main」.
- (가) 전세가율: 「#910 병합 뒤」. #910은 PR #923 `84bd34c0`로 병합됐다.
- (나) 갈아타기: 「#908 pm 판정 뒤」. #908 판정은 (라) 규칙 없음이고, PR #918 `f684e39c`는 문서만 바꿨다.
- 함께 반영된 것: #572(PR #915 `07e95b90`)가 `collect`에 읽기 인자를 넣었고, #920(PR #922)도 반영됐다.

이 등록 뒤 main의 코드가 바뀌어도 측정은 05a4469e 코드로 한다. 구현 PR의 전후는 완료 조건 7이 그 PR의 base 위에서 다시 잰다.

시각(`now`)은 빌더마다 cd20a99b 공개 파일의 `updatedAt`으로 고정한다. 창(달)과 updatedAt만 이 값에 기댄다.

| 빌더 | now |
|---|---|
| build-budget-deals (가-1) | 2026-11-16T02:42:32.139Z |
| build-complex-ratio·jeonse-risk (가-2) | 2026-11-16T02:45:01.520Z |
| direct-deals (나-1) | 2026-11-16T02:43:39.411Z |
| district-change·segment-change (나-2) | 2026-11-16T02:44:23.771Z |
| record-high (나-3) | 2026-11-16T02:44:17.671Z |
| floor-gap (나-4) | 2026-11-16T02:43:56.886Z |
| 예산대 장 렌더 (나-5) | 2026-11-16T02:45:11Z (배포가 넣는 BUILD_NOW = HEAD 커밋 시각, cd20a99b) |
| repeat-sales (나-6) | 2026-11-16T02:44:59.272Z |

## 2. 측정 전 입력 신선도 (완료 조건 1, 기록 항목)

명령은 `git diff --name-only <이미 본 커밋> cd20a99b -- <raw 폴더> | wc -l`이다(2026-11-16 등록 때 셈). `run-900.sh`가 측정 첫머리에서 같은 표를 다시 찍는다.

| 이미 본 커밋 | 무엇을 본 입력인가 | sale | rent | recollect | ecos | indicators | first-seen |
|---|---|---:|---:|---:|---:|---:|---:|
| `8eb314f7` | #908 입력 B, 이 이슈 v1 착수 기준 | 0 | 9 | 0 | 0 | 0 | 9 |
| `f3def1ee` | #861 1회차, #861 조건 4 대조 | 0 | 9 | 0 | 0 | 0 | 9 |
| `f692748e` | R0, #908 입력 A, #910 계수 | 0 | 0 | 0 | 0 | 0 | 9 |

rent 9파일은 202610·202611 슬롯이다.

빌더가 읽는 raw 폴더:

| 경로·빌더 | 읽는 raw 폴더 |
|---|---|
| (가-1) | sale·recollect, 동명 판정용 sale·rent |
| (가-2) | sale·rent·recollect |
| (나-1)·(나-3) | sale·recollect, 동명 판정용 rent |
| (나-2) | sale·recollect·rent(동명)·ecos·indicators |
| (나-4) | sale·rent·recollect |
| (나-5)·(나-6) | sale·recollect·indicators |

first-seen은 어느 경로도 읽지 않는다.

**한계(측정 전에 적는다).** 이 측정에 쓰는 매매 원본과 덧씌움은 이미 본 자료다.

- 매매 원본(raw/sale)과 덧씌움(raw/recollect)은 f3def1ee 뒤로 0파일 바뀌었다. #861 조건 4 대조, #908 측정이 본 매매 자료와 같다(메인 세션 기록 #900 issuecomment-6908217609).
- (가-2)·(나-4)가 읽는 전월세는 R0와 같다. 전세 쪽은 #910 계수가 본 자료다.
- 아직 재지 않은 것은 「같은 자료에서 소비자마다 저장과 덧씌움 사이 차이」다. 문턱(1행·1칸 이상, (나)는 공개 값 하나라도)은 #861 pm 판정(issuecomment-6892470425)에서 이미 정해졌고, 이 자료의 경로별 결과를 보기 전에 정한 것이다.

## 3. 슬롯 적용·무시 (cto 조건 1-b)

경로·창마다 (구, 달) 슬롯을 셋으로 센다(`lib-900.mjs` slotTable).

- 적용: `mergeRecollect`가 합친 새 객체를 돌려준다.
- 무시: 덧씌움 파일이 있는데 저장 슬롯을 그대로 돌려준다. 원인은 base의 observedAt·count가 다르거나, 없앨 행이 슬롯에 없는 것이다(`realestate-recollect.ts` 177·188행).
- 없음: 덧씌움 파일이 없다.

무시 슬롯은 처리 방식을 다음과 같이 정한다.

- 목록(구·달·원인)과 무시 비율(무시 ÷ 덧씌움)을 측정 표에 둔다.
- 무시 비율은 pm 판정 전에 적는다.
- 무시 슬롯의 어긋남은 0이다. 두 읽기가 같은 객체를 돌려주므로 계산에서 저절로 0이 된다. 공개 화면도 같은 이유로 저장 값이다.
- 무시 비율로 판정을 바꾸지 않는다.

창별 덧씌움 슬롯:

| 경로·빌더 | 창 | 덧씌움이 걸리는 달 |
|---|---|---|
| (가-1) | 202609~202611 | 202609 하나, 25슬롯 |
| (가-2)·(나-4) | 202606~202611 | 202606~202609, 100슬롯 |
| (나-1) | 24달 | 150슬롯 |
| (나-2)·(나-3)·(나-5)·(나-6) | 원본 전부 | 150슬롯 |

## 4. (가) 지표·어긋남 정의·문턱 (`ga-900.mjs`)

두 경로 모두 문턱은 본문대로 **1행(칸) 이상이면 전환**이다.

### (가-1) 거래 검색·예산

- 소비자: `realestate-source.ts` `readDealSource` → `collect`(#572의 `read` 인자) → `build-budget-deals.ts`. 출력은 budget-deals.json, deal-search.json, budget-months.json, deals-<구>.json 25개다.
- before는 `readDealSource(now, 202609~202611, readSlotFile)`, after는 `readRecollectedSlot`이다. 빌더 파일은 고치지 않는다. 내보낸 `buildPayload`·`buildDealFiles`에 두 source를 넣는다.
- **어긋남 행**은 소비자 출력의 전수 줄(deals-<구>.json의 `deals`, 단지 키를 붙인 정규화 줄)을 구마다 다중집합으로 견준 수다.
  - 셈: before에만 있는 줄 수 + after에만 있는 줄 수.
  - 기록용 나눔: 같은 (동·단지·면적·층·계약일) 키로 짝지어 「값이 바뀐 줄」·「사라진 줄」·「새 줄」로 나눈다. 판정은 합계로 한다.
  - 정규화 줄에 실리지 않는 칸(등기일, 동 번호 등)만 바뀐 행은 출력에 실리지 않으므로 어긋남이 아니다.
  - 덧씌움에서 해제가 붙은 행은 `dropCancelled`로 빠지므로 「사라진 줄」이다.
  - 본문 정의 「시세 칸(덧씌움)과 그 소비자(저장)가 다르게 들이는 줄 중 그 소비자 출력에 실리는 줄」을 이렇게 잰다.
- cto 조건 2: #572가 병합됐으므로 파일 해시 비교도 가능하다. 그래도 판정은 행 다중집합으로 한다.
- 기록할 공개 값: 세 화면 파일의 바뀐 잎 수, budget-deals 구간별 건수·직거래 수 전후, 해제 제외 건수 전후. 단지명이 든 잎은 경로·값을 찍지 않고 수만 센다.

### (가-2) 전세가율·전세 비중

- 소비자: `build-complex-ratio.ts` `readRaw`가 complex-ratio.json을 만들고, `runJeonseRisk`가 jeonse-risk.json을 만든다.
  - 매매 읽기는 지금 29행이다. 본문의 「28행」은 b360dcfb 기준이고, #919가 줄을 더해 한 줄 밀렸다. 전월세는 30행이다.
- before는 빌더의 `readRaw(months, raw)` 그대로다. after는 같은 읽기에서 매매만 `readRecollectedSlot`으로 바꾼 사본(`readRawWith`)이고, 전월세는 늘 저장 그대로 둔다.
  - 사본이 맞는지 확인: `readRawWith(readSlotFile)`이 `readRaw`와 같아야 한다(멈춤 5).
  - 1년 전 값은 두 쪽 모두 cd20a99b의 complex-price-*.json(이미 덧씌움 반영)이다.
- **어긋남 칸**은 구마다 `cellRatioEntries` 칸 키로 견준 아래 셋의 합집합이다.
  - (a) 칸 집합에 들거나 나는 칸
  - (b) 양쪽에 있는데 전세가율 값(반올림 전)이 다른 칸
  - (c) 1년 전 값 맞물림(compared, `districtCounts`와 같은 찾기·조건)이 달라지는 칸
  - 구조상(결과가 아니라 코드에서) (c)는 (a) 안에 든다. 양쪽에 다 있는 칸은 같은 키로 같은 가격 파일을 찾기 때문이다. 그래도 셋을 따로 센다.
- pm 순서 판정에 따른 확인: before는 #910 계수 after와 같아야 한다. 칸 977, compared 710, high 13, 서울 중앙 49.4%다(PR #923 84bd34c0). 다르면 after를 만들지 않고 멈춘다(멈춤 4).
- 기록할 공개 값: complex-ratio.json 서울·구(cells·median·q1·q3), jeonse-risk.json 서울·구(cells·compared·high·highShare·highCompared·highFell·fellShare) 전후. 칸 이름은 출력하지 않는다.
- 이 경로를 바꿔도 추천(`build-recommendation.ts`의 readSlotFile)은 움직이지 않는다. 이 측정은 추천을 재지 않는다(cto 조건 3).

## 5. (나) 지표와 공개 자릿수 기준 (`na-900.mjs`)

### 측정 방법

빌더 파일은 고치지 않는다(cto 조건 5). 내보낸 함수에 저장 입력(S)과 덧씌움 입력(O)을 차례로 넣는다.

- 매매 원본 전부는 `build-district-change.ts` `readAll(raw)`의 `items`(S)와 `recollected`(O)다. 같은 `mergeRecollect`를 쓴다.
- 빌더가 읽기 함수를 내보내지 않으면 그 읽기를 스크립트에 그대로 옮겨 쓴다. 옮긴 곳은 층 격차 `readRaw` 33~47행, 예산 군집 `readCapDeals` 239~254행이다.
- 반복거래는 `build({ rawDir })`에 덧씌움을 합친 원본 사본을 넘긴다.
  - 사본은 적용된 슬롯만 `readRecollectedSlot` 결과로 쓰고 나머지는 바이트 그대로 복사한다.
  - 합친 슬롯의 행 순서는 `mergeRecollect`의 정렬을 따른다. 넓힌 구현이 읽기 층으로 읽어도 같은 순서다.
- 그래서 임시 사본에 넣을 패치는 없다.

| # | 빌더 | 공개 산출물(화면) | S / O 입력 | 재현 대조 |
|---|---|---|---|---|
| 1 | 직거래 | direct-deals.json (cancelled-deals.html) | `readRawSales(24달, raw, readSlotFile / readRecollectedSlot)` | cd20a99b direct-deals.json |
| 2 | 갈아타기·가격대 변화 | district-change.json (switch-house.html), segment-change.json | `readAll` items / recollected. 지수 원본 raw/ecos·raw/indicators 고정 | district-change.json, segment-change.json |
| 3 | 신고가 | record-high.json (record-high.html) | 같음 | record-high.json |
| 4 | 층 격차 | floor-gap.json (floor-gap.html) | 매매 6달 S/O, 전세는 늘 저장 | floor-gap.json |
| 5 | 예산 군집 | 예산대 장 18장 HTML, method.html 규칙 문단 | capDeals S/O → `clustering`·`lineCounts` → `buildBudgetPage`·`budgetRulesHtml` | 없음(장은 배포 때 렌더되고 Daily가 커밋하지 않는다) |
| 6 | 반복거래 | repeat-sales.json (switch-house 「같은 집」 절) | `build({ rawDir: raw / 합친 사본 })` | repeat-sales.json(provenance 포함) |

### 한 빌더씩 떼어 재기 위한 고정

- 반복거래의 대조 상대 N4(segment-change.json)와 예산 군집의 budget-deals.json은 두 실행 모두 cd20a99b 공개 파일로 고정한다. 가격대 변화의 덧씌움 효과는 (나-2)에서, 거래 검색·예산의 효과는 (가-1)에서 잰다.
- 갈아타기 금액 구간은 재추출 4,000번에 씨앗을 고정한다. 입력이 바뀌면 추첨 몫도 함께 움직인다(#908). 그 몫도 넓혔을 때 화면에 나가는 차이이므로 데이터 몫과 가르지 않는다.

### 공개 자릿수 기준

#861 pm 판정의 「화면에 보이는 자릿수로 문장이나 표 값이 하나라도 바뀌면 넓힌다」를 다음 두 단계로 잰다.

1. **글자 잎.** 빌더 출력을 잎(문자열·숫자)까지 펴서 S와 O를 견준다.
   - 빼는 경로: `updatedAt`, 그리고 반복거래 `provenance.*`(입력 해시·파일 수, 화면에 나가지 않는 출처 기록).
   - 글자 잎(문장·표 HTML, ko·en)이 하나라도 다르면 **바뀜**이다. 빌더가 화면 자릿수로 구워 둔 글자이기 때문이다.
   - 예산 군집은 렌더한 장 HTML과 규칙 문단 글자만으로 판정한다. 화면 그 자체다. capStats·policyCounts 숫자 차이는 기록만 한다.
2. **숫자 잎.** 글자 잎 차이가 0이고 숫자 잎만 다르면, 다른 잎마다 화면 코드의 서식을 전후 값에 적용해 판정한다.
   - 화면 코드: `scripts/data-keys.ts` PAGE_SETS에서 그 파일을 읽는 장의 `docs/<장>.html` 인라인 스크립트, 그 장에 굽는 `scripts/*-view.ts`·`scripts/prerender.ts`.
   - 서식: `toFixed`, `Math.round`, `toLocaleString`, `eokText` 등.
   - 서식을 적용한 결과가 하나라도 다르면 **바뀜**이다.
   - 그 잎을 읽는 코드가 없으면(키 이름 grep 0건) 화면에 나가지 않는 잎으로 보고 세지 않는다. 대신 grep 명령과 0건을 표에 남긴다.
   - 읽는 코드가 있는데 서식을 하나로 정할 수 없으면 **바뀜**으로 센다.
   - 서식은 코드가 정한다. 결과를 보고 고르지 않는다.
3. 두 단계 모두 차이가 0이면 **같음**이다.

### 판정

- 바뀜: 그 빌더의 후속 이슈 초안(파일·측정값·완료 조건)을 #900 댓글로 남긴다. 이 이슈에서 구현하지 않는다. method 문단에서는 「쓰지 않는 화면」에 둔다.
- 같음: #861 정정 ④ 표의 그 행을 「아니오 확정」으로 적는다.
- #820 실측상 갈아타기(쌍 140→142)와 반복거래(바뀐 잎 129/357)는 바뀜일 가능성이 높다(본문). 이것은 예상이고, 문턱은 그와 무관하게 위와 같다.

## 6. 판정 규칙 요약 (결과 보기 전에 고정)

| 경로·빌더 | 지표 | 문턱 | 넘으면 | 못 넘으면 |
|---|---|---|---|---|
| (가-1) 거래 검색·예산 | 어긋남 행(나간 줄 + 들어온 줄) | ≥ 1 | `collect`의 read 인자로 매매만 `readRecollectedSlot`(완료 조건 2) | 전환하지 않고 method 「쓰지 않는 화면」 |
| (가-2) 전세가율·전세 비중 | 어긋남 칸 (a)∪(b)∪(c) | ≥ 1 | `readRaw` 29행 매매 읽기만 `readRecollectedSlot` | 같음 |
| (나) 여섯 빌더 각각 | 공개 자릿수 바뀜(5절) | 글자 1 또는 서식 적용 숫자 1 | 후속 이슈 초안 | 「아니오 확정」 |

판정은 pm이 한다. data-analyst는 결과 표와 판정안을 #900에 단다. 무시 비율은 판정 전에 적는다.

## 7. 무효·멈춤

무효가 되면 결과를 싣지 않는다. 멈춘 경로는 판정하지 않고 원인을 #900에 적는다.

1. 측정 작업 트리의 HEAD가 05a4469e가 아니거나 scripts가 그와 다르면 멈춘다(`run-900.sh`).
2. raw·docs/data가 cd20a99b와 다르면 멈춘다(`git diff --cached --quiet cd20a99b -- raw`, `-- docs/data`).
3. `git diff --stat f3def1ee cd20a99b -- raw/recollect`가 0줄이 아니면 멈춘다(R0 확인 (a)).
4. 재현 대조가 실패하면 그 경로·빌더의 after를 만들지 않고 멈춘다.
   - 대조: before(S)가 cd20a99b 공개 파일과 `updatedAt`만 빼고 같아야 한다.
   - (가-2)는 #910 계수 after와 대조한다(칸 977·compared 710·high 13·중앙 49.4%).
   - 원인이 측정 스크립트에 있으면 고친 커밋을 새 등록 sha로 삼아 그 경로만 다시 잰다. 원인이 입력에 있으면 pm에게 올린다.
5. (가-2)의 읽기 사본 `readRawWith(readSlotFile)`이 빌더 `readRaw`와 다르면 멈춘다.
6. 키 환경변수가 있거나 네트워크 호출이 0이 아니면 전부 무효다. 스크립트가 종료 3·2로 끝난다.
   - 키 환경변수: MOLIT_API_KEY·MOLIT_RENT_API_KEY·BUILDINGHUB_API_KEY·GITHUB_TOKEN, 그리고 이름이 `*_KEY`·`*_TOKEN`·`*_SECRET`인 것.
   - 실행은 `env -i`로 한다. 네트워크 입구 fetch·http(s)·net·tls·dns.lookup을 막고 그 수를 마지막 줄에 찍는다.
7. git이 D 상태로 멈추면 다시 시도하지 않는다. 멈추고 cto에 넘긴다.
8. 결과 커밋 전에 `node scripts/check-prereg-order.ts --prereg <등록 sha 40자> --prereg-path research/recollect-consumers-900-2026-11/PREREG.md --output research/recollect-consumers-900-2026-11/measure-900.out`가 통과해야 한다. 통과 출력을 판정 댓글에 싣는다.
9. cto·cpo 사전 등록 검토에서 수정 요청이 오면 측정 전에 고친다. 그 수정 커밋이 측정 전 sha가 된다. 결과를 본 뒤에는 8절대로 한다.

## 8. 결과를 본 뒤 바꾸지 않는다

결과를 본 뒤 다음을 바꾸지 않는다.

- 입력(R0·데이터 커밋·코드 sha)과 시각
- 어긋남 행·칸 정의와 문턱(1행·1칸, (나)는 공개 값 하나)
- 공개 자릿수 두 단계와 빼는 경로(`updatedAt`·반복거래 `provenance`)
- 고정한 대조 상대(N4·budget-deals)
- 무시 슬롯을 0으로 세는 규칙

결과가 마음에 들지 않아도 고치지 않는다. 바꿀 이유가 보이면 이 측정 결과를 그대로 싣고, 새 사전 등록과 아직 보지 않은 다음 Daily 입력으로 다시 잰다.

## 9. 실행 순서

저장소 루트(`~/workspace/jipgye`)에서 시작한다. `D=research/recollect-consumers-900-2026-11`이고, `<등록 sha>`는 이 문서를 main에 올린 커밋이다.

```sh
git fetch -q
timeout -k 10 600 git worktree add --detach ../jipgye.worktrees/900-measure 05a4469e0f90e5021efee3b436521a7802b86f74
W=../jipgye.worktrees/900-measure
git -C $W restore --source=cd20a99bc954797ae12bedeffa48252e8e505a22 --staged --worktree -- raw docs/data
git -C $W diff --cached --quiet cd20a99bc954797ae12bedeffa48252e8e505a22 -- raw        # 종료 0
git -C $W diff --cached --quiet cd20a99bc954797ae12bedeffa48252e8e505a22 -- docs/data  # 종료 0
git -C $W restore --source=<등록 sha> --staged --worktree -- $D
ln -s "$PWD/node_modules" $W/node_modules
echo "등록 <등록 sha> · 데이터 cd20a99b · R0 f692748e"
dmesg | grep -c 'hv_storvsc.*0x28'
$W/$D/run-900.sh $W $W/$D/out 2>&1 | tee $W/$D/measure-900.out
```

`run-900.sh`는 1~3절의 확인을 하고 입력 신선도 표를 찍은 뒤 `ga-900.mjs`, `na-900.mjs` 순서로 돈다. 둘 다 `env -i`·`nice -n 19`로 돈다.

- `out/`(경로별 전체 차이 JSON, 반복거래 합친 원본 사본)은 커밋하지 않는다(`.gitignore`). 위 명령이 같은 바이트로 다시 만든다.
- `measure-900.out`은 결과 커밋에 넣는다.
- 끝나면 측정 작업 트리를 지운다.
- (나) 숫자 잎 2단계 판정에 쓴 grep 명령·줄은 결과 표 옆에 적는다.

## 10. 결과 표 (측정 뒤 판정 댓글과 결과 커밋에 채운다)

| 경로·빌더 | 재현 대조 | 덧씌움 적용/무시(비율) | 지표 | 판정안 |
|---|---|---|---|---|
| (가-1) 거래 검색·예산 | | | 어긋남 행 | |
| (가-2) 전세가율·전세 비중 | | | 어긋남 칸 (a)/(b)/(c)/합 | |
| (나-1) 직거래 | | | 글자/숫자 잎 | |
| (나-2) 갈아타기·가격대 변화 | | | 글자/숫자 잎 | |
| (나-3) 신고가 | | | 글자/숫자 잎 | |
| (나-4) 층 격차 | | | 글자/숫자 잎 | |
| (나-5) 예산 군집 | 없음 | | 바뀐 장/규칙 문단 | |
| (나-6) 반복거래 | | | 글자/숫자 잎 | |

## 11. 이 등록이 하지 않는 것

- 구현은 하지 않는다. 다음 항목은 구현 PR의 몫이다.
  - 완료 조건 2의 전환
  - 4: 동명 단지·대표 시세 두 분기·week-digest·원장 C1·전망의 출력 해시 시험
  - 5: 덧씌움 없음 골든
  - 6: method 문단
  - 7: PR 본문 전후
  - 8: `test/recollect-sale.test.mjs` 연결 시험
- 파일 사이 일치를 강제하는 다른 커밋본 시험은 origin/main 기준 `test/complex-history.test.mjs` 144행 하나뿐이다(cpo 확인).
  - 그래서 (가-2) 전환이 #920 같은 PR CI 교착을 만들 근거는 지금 보이지 않는다.
  - 다만 구현 PR은 complex-ratio.json·jeonse-risk.json을 함께 움직인다. #910처럼 Daily 전에 공개 값이 바뀌는 날짜를 PR 본문에 적는다.
