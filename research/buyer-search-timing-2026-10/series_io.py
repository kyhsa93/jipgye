"""연구 스크립트가 계열을 읽는 한 곳(#588).

- 일반 계열(금리·거래량·전세가율 등)은 `cache/series.json`. 이 파일은 .gitignore 라 저장소에 없다 -
  `python3 research/buyer-search-timing-2026-10/fetch_series.py` 가 다시 만든다.
- KB 두 계열(kb_sale·kb_jeonse)은 재배포 허락을 확인하지 못해 저장소에 두지 않는다. 저장소 루트의
  `cache/indicators/kb-history.json`(.gitignore)에서 읽는다. 매 Daily 의 scripts/fetch-indicators.ts 가
  이 파일을 새로 쓰고, 로컬에서는 `python3 research/buyer-search-timing-2026-10/fetch_series.py --kb-only`
  (ECOS sample 키, 1986-01~2026-09)로 받는다.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("REPO", os.path.abspath(os.path.join(HERE, "../..")))
SERIES_FILE = os.path.join(HERE, "cache", "series.json")
KB_FILE = os.path.join(REPO, "cache", "indicators", "kb-history.json")
KB_NAMES = ("kb_sale", "kb_jeonse")
KB_HINT = "python3 research/buyer-search-timing-2026-10/fetch_series.py --kb-only"
SERIES_HINT = "python3 research/buyer-search-timing-2026-10/fetch_series.py"

def load_kb():
    """KB 두 계열 {이름: [[YYYYMM, 값], ...]}. 임시 사본이 없으면 받는 명령을 알려 주고 멈춘다."""
    try:
        with open(KB_FILE) as f:
            series = json.load(f)["series"]
    except FileNotFoundError:
        raise SystemExit(f"KB 계열 임시 사본이 없다({KB_FILE}). 저장소에는 KB 원값을 두지 않는다 - 받으려면: {KB_HINT}")
    return {name: series[name] for name in KB_NAMES}

def load_series(with_kb=True):
    """cache/series.json 의 일반 계열 + (with_kb 이면) KB 임시 사본."""
    try:
        with open(SERIES_FILE) as f:
            S = json.load(f)
    except FileNotFoundError:
        raise SystemExit(f"{SERIES_FILE} 이 없다(.gitignore, 저장소에 없음) - 받으려면: {SERIES_HINT}")
    if with_kb:
        S.update(load_kb())
    return S
