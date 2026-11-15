# 신고 기준 7일 변화와 다시 찍힌 행 (#862 2단계)

호출 0회. 모두 저장소의 git 이력과 작업 트리의 `raw` 만 읽는다. 저장소 뿌리에서 돌린다.
재생 스크립트는 `scripts/build-realestate.ts` 의 `readWindowItems` 를 그대로 부르되 슬롯을 git 이력에서 읽는다 — 이 경우 행 첫 관측일 상태(`raw/first-seen`)는 읽지 않으므로 그날 기록과 같은 표본이 나온다.

| 파일 | 무엇을 재나 | 판정 |
|---|---|---|
| `replay.mjs` | 각 날짜 기록을 마지막으로 바꾼 커밋의 `raw/sale` 로 그날 구 매매 표본(구 창)을 다시 만들고 가장 큰 한 단지·한 계약일 묶음을 센다 | 구 매매 쏠림 문턱(data-analyst 11-15) |
| `overall2.mjs` · `an8.py` | 서울 매매·전세·월세 표본 재생, `findBaseline` 기준 7일 변화, 행 재추출 1,000회 90% 구간 | 서울 7일 변화 내림(data-analyst 11-15, pm 11-15) |
| `jeonse_check.mjs` | 서울 전세 신고 표본의 가장 큰 단지·단지+계약일 묶음, 이름에 「임대」가 든 행 | 같은 판정의 전세 구성 확인 |
| `district7.mjs` · `district7_summary.py` · `district7_summary.out` | 구 매매·전세·월세 7일 변화, 짝 재추출(겹친 행은 한 번 뽑아 양쪽에) 1,000회 | 구 7일 변화 내림(사전 등록, data-analyst 11-17) |
| `first-seen-effect.mjs` | 행 첫 관측일 상태로 도착일을 앞당겼을 때 앞당긴 행 수, 서울·구 대표값과 week-digest 의 전후 | 조건 6 구현 확인 |

## 재현

```sh
# 구 쏠림 문턱: 구-일마다 JSON 한 줄(건수·값이 기록과 같은지, 가장 큰 묶음)
node research/arrival-change-2026-11/replay.mjs > replay.jsonl

# 서울 7일 변화
node research/arrival-change-2026-11/overall2.mjs 1000 > overall2.jsonl
python3 research/arrival-change-2026-11/an8.py overall2.jsonl
node research/arrival-change-2026-11/jeonse_check.mjs 2026-11-08 2026-11-15

# 구 7일 변화(사전 등록 규칙). REF 로 이력 가지를 고른다(기본 main)
node research/arrival-change-2026-11/district7.mjs 1000 > district7.jsonl
python3 research/arrival-change-2026-11/district7_summary.py district7.jsonl

# 조건 6 효과(작업 트리 raw 기준, 날짜 생략 시 2026-11-15)
node research/arrival-change-2026-11/first-seen-effect.mjs 2026-11-15
```

`replay.mjs`·`overall2.mjs`·`jeonse_check.mjs` 는 `main` 가지 이력을 읽는다. 결과 표는 이슈 #862 의 data-analyst 판정 댓글에 있다.

## 판정 규칙(요약)

7일 변화를 싣는 조건은 「잰 날들의 |Δ| 중앙값이 행 재추출 90% 구간 반폭 중앙값보다 크다」다.

| 범위 | 표본 | 매매 | 전세 | 월세 | 규칙을 정한 때 |
|---|---|---|---|---|---|
| 서울 1주 | 2026-08-25~11-15 신고 기준 40일 | 2.49% 대 ±5.62% | 1.84% 대 ±3.62% | 2.76% 대 ±4.22% | 11-04 값을 본 뒤(사전 등록 아님) |
| 구 4주 | 같은 기간 44일, 구-일 1,008~1,070 | 1.55% 대 ±3.65% | 1.49% 대 ±2.89% | 1.64% 대 ±3.29% | 재기 전에 등록 |

여섯 칸 모두 조건을 넘지 못해 신고 기준 날의 서울·구 7일 증감을 내렸다. 계약 기준으로 물러난 날은 이 판정 밖이다.

## 조건 6 효과(2026-11-15, 기준 `9840a001`)

`first-seen-effect.mjs` 출력의 요약이다.

- 2026-10-19 이후 도장이 찍힌 매매 4,309행 중 766행(17.8%)이 이미 본 행(신원 = `rgstDate`·`cdealType`·`cdealDay`·`aptDong` 을 뺀 칸)이 다시 찍힌 것이다. 전월세는 16,075행 중 1행이다.
- 서울 1주 매매: 5,379만원·1,079건 → 5,387만원·1,022건. 전세·월세 건수는 같다.
- week-digest 매매: 이번 창(11/9~15) 1,078 → 1,021, 직전 창(11/2~8) 1,024 → 913. 직전 창의 많은 구에서 동대문구가 빠진다.
- 구 쏠림: 동대문구 313행은 첫 관측일(10-21)이 아직 구 창 안이라 11-15 에는 남고, 구 창이 10-26 부터인 날(11-16~)에 빠진다. 도봉구 29행은 첫 관측일이 창 밖이라 빠진다.
