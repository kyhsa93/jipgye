"""시장 타이밍 말고 계약을 앞둔 사람의 '시점' 질문 중 우리 데이터로 답할 수 있는 것.
① 계절: 실거래가격지수(901Y089, 2006~)의 월별 변화가 달력 달마다 다른가 — 해마다 평균을 빼고, 연도 단위 부트스트랩
② 계절: 거래량(R-ONE 아파트매매거래현황 서울, 2007~2025)의 달별 몫
③ 계약 → 등기 걸린 날: rgstDate가 있는 거래, 계약월이 충분히 익은 것만(검사 7)
REPO만 바꾸면 된다."""
import os, json, glob, collections, datetime as dt, numpy as np
REPO = os.environ.get("REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
HERE = os.path.dirname(os.path.abspath(__file__))
IDX = json.load(open(os.path.join(REPO, "raw/ecos/apt-price-index.json")))["series"]["200"]
S = json.load(open(os.path.join(HERE, "cache", "series.json")))

# ① 가격 계절
v = dict(IDX); ms = sorted(v)
r = {m: np.log(v[m] / v[p]) * 100 for p, m in zip(ms, ms[1:])}
years = sorted({m[:4] for m in r if "2007" <= m[:4] <= "2025"})
dev = {y: {} for y in years}
for y in years:
    vals = [r[f"{y}{k:02d}"] for k in range(1, 13) if f"{y}{k:02d}" in r]
    if len(vals) < 12: continue
    mu = np.mean(vals)
    for k in range(1, 13): dev[y][k] = r[f"{y}{k:02d}"] - mu
years = [y for y in years if len(dev[y]) == 12]
rng = np.random.default_rng(20261001)
print(f"① 실거래가격지수 서울 월 변화 - 그해 평균 ({years[0]}~{years[-1]}, {len(years)}년), 연도 부트스트랩 2000회 90% 구간")
for k in range(1, 13):
    xs = np.array([dev[y][k] for y in years])
    bs = [rng.choice(xs, len(xs)).mean() for _ in range(2000)]
    lo, hi = np.percentile(bs, [5, 95])
    flag = "← 0을 안 품음" if lo > 0 or hi < 0 else ""
    print(f"  {k:2d}월 {xs.mean():+.2f}%p (90% {lo:+.2f}~{hi:+.2f}) 그 달이 그해 평균보다 낮았던 해 {np.mean(xs<0):.0%} {flag}")

# ② 거래량 계절
vol = dict(S["vol_seoul"])
share = collections.defaultdict(list)
for y in range(2007, 2026):
    tot = sum(vol.get(f"{y}{k:02d}", 0) for k in range(1, 13))
    for k in range(1, 13): share[k].append(vol[f"{y}{k:02d}"] / tot * 100)
print("\n② 서울 아파트 매매 거래량(신고 기준) 달별 몫 2007~2025 — 중앙값(최소~최대)")
print("  " + " · ".join(f"{k}월 {np.median(share[k]):.1f}%({min(share[k]):.1f}~{max(share[k]):.1f})" for k in range(1, 13)))

# ③ 계약 → 등기
rows = []
for f in glob.glob(os.path.join(REPO, "raw/sale/*.json")):
    for it in json.load(open(f))["items"]:
        if str(it.get("cdealType", "")).strip(): continue
        d = dt.date(int(it["dealYear"]), int(it["dealMonth"]), int(it["dealDay"]))
        rg = str(it.get("rgstDate", "")).strip()
        rd = None
        if rg:
            try: rd = dt.datetime.strptime(rg, "%y.%m.%d").date()
            except ValueError: rd = None
        p = int(str(it["dealAmount"]).replace(",", ""))
        rows.append((d, rd, p, it.get("dealingGbn")))
print("\n③ 계약 → 등기(rgstDate) 걸린 날. 수집 마지막:", max(r_[0] for r_ in rows))
for lo_m, hi_m in [((2025, 8), (2025, 12)), ((2026, 1), (2026, 3)), ((2026, 4), (2026, 6))]:
    sel = [x for x in rows if (x[0].year, x[0].month) >= lo_m and (x[0].year, x[0].month) <= hi_m]
    have = [x for x in sel if x[1]]
    days = np.array([(x[1] - x[0]).days for x in have])
    print(f"  계약 {lo_m}~{hi_m}: {len(sel)}건 중 등기일 있음 {len(have)/len(sel):.1%} | 걸린 날 중앙 {np.median(days):.0f}일, 25~75% {np.percentile(days,25):.0f}~{np.percentile(days,75):.0f}일, 90% {np.percentile(days,90):.0f}일")
sel = [x for x in rows if (x[0].year, x[0].month) <= (2025, 12) and x[1]]
for name, lo, hi in [("~6억", 0, 60000), ("6~9억", 60001, 90000), ("9~15억", 90001, 150000), ("15~25억", 150001, 250000), ("25억~", 250001, 10**9)]:
    d_ = np.array([(x[1] - x[0]).days for x in sel if lo <= x[2] <= hi])
    print(f"  (익은 계약 2025-08~12) {name}: {len(d_)}건 중앙 {np.median(d_):.0f}일, 25~75% {np.percentile(d_,25):.0f}~{np.percentile(d_,75):.0f}")

sel = [x for x in rows if (x[0].year, x[0].month) <= (2025, 12)]
d_ = np.array([(x[1] - x[0]).days for x in sel if x[1]])
print(f"\n  (익은 계약 2025-08~12, {len(sel)}건, 등기일 있는 {len(d_)}건) 30일 안 {np.mean(d_<=30):.1%} · 60일 안 {np.mean(d_<=60):.1%} · 90일 안 {np.mean(d_<=90):.1%} · 120일 안 {np.mean(d_<=120):.1%} · 음수(등기가 계약보다 앞) {np.sum(d_<0)}건")
for gb in ["중개거래", "직거래"]:
    dd = np.array([(x[1] - x[0]).days for x in sel if x[1] and x[3] == gb])
    print(f"  {gb}: {len(dd)}건 중앙 {np.median(dd):.0f}일")
