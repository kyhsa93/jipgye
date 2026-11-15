# #862 구 7일 변화 요약. 입력: district7.mjs 출력(JSON 줄). 사용: python3 district7_summary.py district7.jsonl
# 판정(사전 등록): 종류별 구-일 전부의 |Δ| 중앙값 > 90% 구간 반폭 중앙값이면 유지, 아니면 내림. 구별 표는 참고.
import json, sys, statistics as st, collections
R = [json.loads(l) for l in open(sys.argv[1])]
med = st.median
pct = lambda x: f"{x*100:.2f}%"
print("재현(구-일-종류 1,500씩):")
for k in ("sale", "jeonse", "wolse"):
    rs = [r for r in R if r["kind"] == k]
    nok = sum(r["n"] == (r["recN"] or 0) for r in rs)
    vok = sum(r["v"] == r["recV"] for r in rs if r["recV"] is not None)
    vtot = sum(r["recV"] is not None for r in rs)
    print(f"  {k}: 건수 {nok}/{len(rs)}, 값 {vok}/{vtot}")
S = [r for r in R if r["inSample"]]
print("\n표본 날짜:", min(r["date"] for r in S), "~", max(r["date"] for r in S), len({r["date"] for r in S}), "일")
print("\n종류 | 구-일 | |Δ| 중앙 | 최대 | 반폭 중앙(범위) | 0 밖 | 정확히 7일 전 기준 구-일 | 겹침 비중 중앙 | 판정")
for k in ("sale", "jeonse", "wolse"):
    rs = [r for r in S if r["kind"] == k]
    ad = [abs(r["chg"]) for r in rs]; hw = [r["half"] for r in rs]
    out = sum(r["lo"] > 0 or r["hi"] < 0 for r in rs)
    ov = med([r["nO"] / max(r["n"], 1) for r in rs])
    print(f"{k} | {len(rs)} | {pct(med(ad))} | {pct(max(ad))} | ±{pct(med(hw))} ({pct(min(hw))}~{pct(max(hw))}) | {out} | {sum(1 for r in rs if r['base'] and (__import__('datetime').date.fromisoformat(r['date'])-__import__('datetime').date.fromisoformat(r['base'])).days==7)} | {ov:.2f} | {'유지' if med(ad) > med(hw) else '내림'}")
# 정확히 7일 전 기준만
import datetime as dt
print("\n정확히 7일 전 기준만:")
for k in ("sale", "jeonse", "wolse"):
    rs = [r for r in S if r["kind"] == k and (dt.date.fromisoformat(r["date"]) - dt.date.fromisoformat(r["base"])).days == 7]
    print(f"  {k}: {len(rs)} 구-일, |Δ| 중앙 {pct(med([abs(r['chg']) for r in rs]))}, 반폭 중앙 ±{pct(med([r['half'] for r in rs]))}")
# 건수 구간별
print("\n지금 건수 구간별(참고):")
for k in ("sale", "jeonse", "wolse"):
    for lo, hi in ((20, 50), (50, 100), (100, 200), (200, 10**9)):
        rs = [r for r in S if r["kind"] == k and lo <= min(r["n"], r["bn"]) < hi]
        if rs:
            print(f"  {k} 양쪽 최소 {lo}~{hi if hi < 10**9 else ''}: {len(rs)} 구-일, |Δ| 중앙 {pct(med([abs(r['chg']) for r in rs]))}, 반폭 중앙 ±{pct(med([r['half'] for r in rs]))}, 넘은 구-일 {sum(abs(r['chg']) > r['half'] for r in rs)}")
# 구별 표(참고)
print("\n구별(참고) 구 | 매매 일·|Δ|중앙·반폭중앙·0밖 | 전세 … | 월세 …")
names = {}
for r in S: names[r["code"]] = r["name"]
for code in sorted(names):
    cells = []
    for k in ("sale", "jeonse", "wolse"):
        rs = [r for r in S if r["kind"] == k and r["code"] == code]
        if not rs: cells.append("0 | - | - | -"); continue
        cells.append(f"{len(rs)} | {pct(med([abs(r['chg']) for r in rs]))} | ±{pct(med([r['half'] for r in rs]))} | {sum(r['lo'] > 0 or r['hi'] < 0 for r in rs)}")
    print(f"{names[code]} | " + " | ".join(cells))
# 구-일 하나하나가 |Δ| > 반폭 인 비율(참고)
print("\n구-일마다 |Δ| > 그날 반폭(=0 밖과 거의 같음) 비율:")
for k in ("sale", "jeonse", "wolse"):
    rs = [r for r in S if r["kind"] == k]
    print(f"  {k}: {sum(abs(r['chg']) > r['half'] for r in rs)}/{len(rs)}")
# 다음 기록과 부호 뒤집힘(같은 구, 이어진 표본일)
print("\n다음 표본일과 부호가 뒤집힌 구-일(참고):")
for k in ("sale", "jeonse", "wolse"):
    by = collections.defaultdict(list)
    for r in S:
        if r["kind"] == k: by[r["code"]].append(r)
    flip = tot = 0
    for rs in by.values():
        rs.sort(key=lambda r: r["date"])
        for a, b in zip(rs, rs[1:]):
            if a["chg"] == 0 or b["chg"] == 0: continue
            tot += 1; flip += (a["chg"] > 0) != (b["chg"] > 0)
    print(f"  {k}: {flip}/{tot}")
