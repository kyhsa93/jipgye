# 단지 탐색·매수 시점 재료 — 세어 본 것 (2026-10-01)

위키 "단지 탐색", "매수 시점 재료"의 숫자가 나온 곳. 저장소 루트에서 `python3 research/buyer-search-timing-2026-10/<스크립트>`로 돌린다(저장소 경로는 이 폴더 기준 `../..`, 환경변수 `REPO`로 바꿀 수 있다). 외부에서 받은 것은 `cache/`에 있다. **K-apt 원본 엑셀(12.7MB)은 넣지 않았다** — 서울만 뽑은 `cache/kapt-seoul.json`이 있으므로 `match_kapt.py`부터는 다시 돌릴 수 있다. 세대수는 앞으로 공공데이터포털 API로 받는다(엑셀 경로는 연구용 기록).

| 순서 | 스크립트 | 무엇 | 출력 |
|---|---|---|---|
| 1 | `fetch_ecos_tables.py` | ECOS 통계표 844개(sample 키) — 거래량 계열 없음 확인 | `cache/ecos-tables.json` |
| 1 | `ecos_items.py 901Y074 …` | ECOS 항목 코드 | 화면 |
| 1 | `probe_rone_ids.py` | R-ONE 표 ID 하나씩 조회(키 없이 목록 넘기기 불가) | `out_rone_ids.txt` |
| 2 | `fetch_series.py` (`--kb-only` 는 KB 두 계열만) | 후보 지표 10계열 | `cache/series.json`(일반 8계열, .gitignore), `../../cache/indicators/kb-history.json`(KB 2계열, .gitignore) |
| 3 | `backtest_indicators.py` | 지표별 3·6개월 백테스트 + 블록 부트스트랩 (`REGION=200` 서울, 210/220/230/240/250 권역) | `out_backtest_seoul.txt` |
| 4 | `robustness.py`, `robustness2.py` | 권역·기간·급등기 제외·거래량 단독·상관 | `out_robustness*.txt` |
| 5 | `timing_questions.py`, `seasonal_check.py` | 계절, 계약→등기 | `out_timing.txt`, `out_seasonal.txt` |
| 6 | `load_kapt.py` → `match_kapt.py` | K-apt 엑셀(`cache/kapt-basic-20260925.xlsx`) 서울 → 실거래 매칭 | `cache/kapt-seoul.json`, `cache/match.json`, `out_match.txt` |
| 7 | `count_search.py` | 조건 조합별 후보 단지 수·빈 화면 비율·칸 요약 크기 | `out_search.txt` |

`fetch_rone_tables.py`는 키 없이 `pIndex`가 무시돼 첫 5줄만 반복한다(남겨 둠, 쓰지 않음).
K-apt 엑셀 받는 법: k-apt.go.kr 자료실 목록 → `/web/board/webReference/boardListAjax.do`(scode=01) → 글 `boardView.do` → `fileListData.do?seq=BOARD_FILE`(JSON POST, CSRF 헤더) → `/cmm/file/BOARD/fileDownload.do?key=1&fileName=…`. 브라우저 UA와 쿠키 필요.

**KB 두 계열(`kb_sale`·`kb_jeonse`, KB국민은행 지수)은 저장소에 없다**(#588 — 재배포 허락을 확인하지 못했다). `cache/series.json` 도 .gitignore 라 저장소에 없다. 3~5번 스크립트(`backtest_indicators.py`·`robustness*.py`·`seasonal_check.py`·`timing_questions.py`)와 `../kb-vintage/check.py` 를 돌리기 전에 저장소 루트에서 한 번 받는다.

```
python3 research/buyer-search-timing-2026-10/fetch_series.py            # 일반 8계열 + KB 2계열 (R-ONE 이 느리다)
python3 research/buyer-search-timing-2026-10/fetch_series.py --kb-only  # KB 2계열만(ECOS sample 키, 1986-01~2026-09, 키 불필요)
```

KB 사본은 저장소 루트 `cache/indicators/kb-history.json` 으로, 매 Daily 의 `scripts/fetch-indicators.ts` 가 쓰는 파일과 같은 모양이다(Daily 는 시작할 때 지우고 다시 쓴다). 스크립트는 `series_io.py` 로 읽고, 없으면 위 명령을 알려 주고 멈춘다. `out_*.txt` 는 1986-01~2026-09 로 계산한 값이다 — KB 쪽은 `--kb-only` 로 받은 값이 옛 사본과 한 줄도 다르지 않았다(2026-10-25 확인; R-ONE 두 계열 `jratio_seoul`·`supply_demand_seoul` 은 그 뒤 값이 고쳐져 새로 받으면 다르다). Daily 사본은 더 늦은 달까지 있어 숫자가 조금 달라질 수 있다.
