# 대조 슬롯 무효 문턱의 재료(#820, PREREG 6절). 호출 없음. 커밋된 원본의 이력만 읽는다.
#   python3 research/slot-freeze-2026-11/control-churn.py 1d5c8b83 > research/slot-freeze-2026-11/control-churn.out
import json
import subprocess
import sys
from collections import Counter

REF = sys.argv[1]
CODES = "11110 11230 11350 11500 11620".split()


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, timeout=60, check=True).stdout


pairs = []
for code in CODES:
    for ym in ["202610", "202609"]:
        path = f"raw/sale/{code}-{ym}.json"
        prev = None
        for sha in reversed(git("log", "--format=%H", "-n", "15", REF, "--", path).split()):
            doc = json.loads(git("show", f"{sha}:{path}"))
            cur = Counter(json.dumps(i, sort_keys=True, ensure_ascii=False) for i in doc["items"])
            if prev is not None and sum(prev.values()) >= 20:
                gone = sum((prev - cur).values())
                n = sum(prev.values())
                pairs.append((round(gone / n * 100, 1), gone, n, code, ym, doc["observedAt"][:10]))
            prev = cur

pairs.sort(reverse=True)
shares = sorted(p[0] for p in pairs)
print(f"기준 {REF}, 쌍 {len(pairs)}, 슬롯 변화율 P50 {shares[len(shares) // 2]} P90 {shares[int(len(shares) * 0.9)]} 최대 {shares[-1]}")
print("변화율% | 사라진 행 | 앞 버전 행 | 구 | 달 | 관측일")
for p in pairs[:8]:
    print(" | ".join(map(str, p)))
