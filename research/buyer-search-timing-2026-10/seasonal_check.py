"""계절 관찰(11·12월이 덜 오른다)이 지수 하나의 버릇인지: ① 기간을 반으로 ② 다른 조사(KB 서울 아파트, 1987~)로 ③ 5권역으로."""
import os, json, numpy as np
REPO = os.environ.get("REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "cache", "series.json")))
IDX = json.load(open(os.path.join(REPO, "raw/ecos/apt-price-index.json")))["series"]
def season(pairs, y0, y1):
    v = dict(pairs); ms = sorted(v)
    r = {m: np.log(v[m] / v[p]) * 100 for p, m in zip(ms, ms[1:])}
    out = {k: [] for k in range(1, 13)}
    for y in range(y0, y1 + 1):
        vals = [r.get(f"{y}{k:02d}") for k in range(1, 13)]
        if None in vals: continue
        mu = np.mean(vals)
        for k in range(1, 13): out[k].append(vals[k - 1] - mu)
    return out
def show(label, o):
    n = len(o[1])
    print(f"{label} ({n}년): " + " ".join(f"{k}월{np.mean(o[k]):+.2f}" for k in range(1, 13)) + f" | 11·12월 평균 {np.mean(o[11]+o[12]):+.2f}, 그 두 달이 둘 다 평균 아래인 해 {np.mean([a<0 and b<0 for a,b in zip(o[11],o[12])]):.0%}")
show("부동산원 서울 2007~2015", season(IDX["200"], 2007, 2015))
show("부동산원 서울 2016~2025", season(IDX["200"], 2016, 2025))
show("KB 서울 아파트 1987~2005", season(S["kb_sale"], 1987, 2005))
show("KB 서울 아파트 2007~2025", season(S["kb_sale"], 2007, 2025))
for c, n in [("210","도심"),("220","동북"),("240","서북"),("250","서남"),("230","동남")]:
    show(f"부동산원 {n} 2007~2025", season(IDX[c], 2007, 2025))
