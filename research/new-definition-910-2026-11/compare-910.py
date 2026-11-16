# #910 계수 비교: out/before(현행, main b360dcfb) vs out/after(「신규」만 패치) — R0 raw 위.
# 실행: python3 -I compare-910.py <da-910 dir> <worktree>
import json, sys, os, statistics as st, glob
D, WT = sys.argv[1], sys.argv[2]
B, A = f"{D}/out/before", f"{D}/out/after"
L = lambda p: json.load(open(p))
def q(vals, p):
    s = sorted(vals); return s[min(len(s) - 1, int(len(s) * p))] if s else None
def dist(vals):
    if not vals: return "변화 없음"
    a = [abs(v) for v in vals]
    return f"n={len(vals)} · 절대값 중앙 {st.median(a):.2f} · P90 {q(a,0.9):.2f} · 최대 {max(a):.2f} · 부호 +{sum(v>0 for v in vals)}/−{sum(v<0 for v in vals)}"
def num(v):
    t = str(v if v is not None else "").replace(",", "").strip()
    try: return int(t)
    except: return 0
out = []
P = out.append

# ---------- 미표기 비율(창별) ----------
DIST = [l for l in open(f"{D}/codes.txt")] if False else None
codes = sorted({os.path.basename(p).split("-")[0] for p in glob.glob(f"{WT}/raw/rent/*.json")})
def rows(ym):
    for c in codes:
        f = f"{WT}/raw/rent/{c}-{ym}.json"
        if not os.path.exists(f): continue
        j = L(f)
        if j.get("ok") is False: continue
        for it in j.get("items", []): yield it
def ct(it): return str(it.get("contractType") or "").strip()
def cdate(it):
    try: return f"{int(it['dealYear'])}-{int(it['dealMonth']):02d}-{int(it['dealDay']):02d}"
    except: return None
def pureJ(it): return str(it.get("aptNm") or "").strip() and num(it.get("monthlyRent")) == 0 and num(it.get("deposit")) > 0
def rentOK(it):  # summarizeRent 가 세는 줄(갱신 제외 전): 보증금>0·면적>0
    try: area = float(it.get("excluUseAr"))
    except: return False
    return num(it.get("deposit")) > 0 and area > 0
def share(items, pred):
    n = b = 0
    for it in items:
        if not pred(it) or ct(it) == "갱신": continue
        if ct(it) == "": b += 1
        else: n += 1
    return b, n + b
P("## 창별 미표기 비율(갱신 아닌 줄 중 계약구분 빈칸)")
def line(label, items, pred):
    items = list(items); b, t = share(items, pred); P(f"- {label}: {b:,}/{t:,} = {100*b/t:.1f}%")
line("A1·A2 가장 오래된 달 202606(순수 전세·단지명)", rows("202606"), pureJ)
line("A1·A2 창 202606~202611", (it for ym in ["202606","202607","202608","202609","202610","202611"] for it in rows(ym)), pureJ)
a3w = [it for ym in ["202605","202606","202607","202608","202609","202610","202611"] for it in rows(ym)]
line("A3 가장 오래된 달 202605(창 시작 2026-05-17 이후만)", (it for it in rows("202605") if (cdate(it) or "") >= "2026-05-17"), pureJ)
line("A3 창 183일(2026-05-17~)", (it for it in a3w if (cdate(it) or "") >= "2026-05-17"), pureJ)
bw = [it for ym in ["202609","202610"] for it in rows(ym) if "2026-09-14" <= (cdate(it) or "") < "2026-10-12"]
line("B1 창(계약 2026-09-14~10-11) 전세", bw, lambda it: rentOK(it) and num(it.get("monthlyRent")) == 0)
line("B2 같은 창 월세", bw, lambda it: rentOK(it) and num(it.get("monthlyRent")) > 0)
line("B1 창 첫 주(09-14~09-20) 전세", (it for it in bw if cdate(it) < "2026-09-21"), lambda it: rentOK(it) and num(it.get("monthlyRent")) == 0)
b5 = ["202509","202510","202511","202512","202601","202602","202603","202604","202605","202606","202607","202608","202609","202610","202611"]
line("B5 가장 오래된 달 202509(전세+월세)", rows("202509"), rentOK)
line("B5 창 202509~202611(전세+월세)", (it for ym in b5 for it in rows(ym)), rentOK)
line("B6 가장 오래된 달 202609(전세+월세)", rows("202609"), rentOK)
line("B6 창 202609~202611(전세+월세)", (it for ym in ["202609","202610","202611"] for it in rows(ym)), rentOK)

# ---------- A1 ----------
P("\n## A1 complex-ratio.json")
a1b, a1a = L(f"{B}/a1.json"), L(f"{A}/a1.json")
P(f"- 서울: {a1b['seoul']} → {a1a['seoul']}")
db, da = a1b["districts"], a1a["districts"]
names = sorted(set(db) | set(da))
chg = [n for n in names if db.get(n) != da.get(n)]
gone = [n for n in names if n in db and n not in da]; new = [n for n in names if n in da and n not in db]
tier = [n for n in names if n in db and n in da and ("q1" in db[n]) != ("q1" in da[n])]
medchg = [round(da[n]["median"] - db[n]["median"], 1) for n in names if n in db and n in da and da[n]["median"] != db[n]["median"]]
P(f"- 공개 구 {len(db)} → {len(da)}: 값(칸 수 포함)이 바뀐 구 {len(chg)}, 사라진 구 {gone}, 생긴 구 {new}, 분위 유무가 바뀐 구 {tier}")
P(f"- 공개 중앙값(0.1%p 자리)이 바뀐 구 {len(medchg)}: {dist(medchg)}")
q1c = [round(da[n][k] - db[n][k], 1) for n in names if n in db and n in da for k in ("q1","q3") if k in db[n] and k in da[n] and db[n][k] != da[n][k]]
P(f"- 분위(q1·q3) 값이 바뀐 자리 {len(q1c)}: {dist(q1c)}")
cb, ca = L(f"{B}/a1-cells.json"), L(f"{A}/a1-cells.json")
mb = {(n, c["key"]): c["ratio"] for n, cs in cb.items() for c in cs}; ma = {(n, c["key"]): c["ratio"] for n, cs in ca.items() for c in cs}
common = [k for k in mb if k in ma]; d = [ma[k] - mb[k] for k in common if abs(ma[k] - mb[k]) > 1e-9]
P(f"- 칸 {len(mb):,} → {len(ma):,}: 사라진 칸 {len([k for k in mb if k not in ma])}, 생긴 칸 {len([k for k in ma if k not in mb])}, 값이 바뀐 칸 {len(d)}(%p): {dist(d)}")
pub = [k for k in common if round(ma[k],1) != round(mb[k],1)]
P(f"- 칸 비율 0.1%p 자리로 바뀐 칸 {len(pub)}")
cross80 = [k for k in common if (mb[k] >= 80) != (ma[k] >= 80)]
P(f"- 80% 선을 넘나든 칸 {len(cross80)}")
for n in names:
    b, a = db.get(n), da.get(n)
    if b != a: P(f"  - {n}: {b} → {a}")

# ---------- A2 ----------
P("\n## A2 jeonse-risk.json")
a2b, a2a = L(f"{B}/a2.json"), L(f"{A}/a2.json")
P(f"- 서울: {a2b['seoul']} → {a2a['seoul']}")
rb, ra = a2b["districts"], a2a["districts"]
ch = [n for n in rb if rb[n] != ra.get(n)]
short = [n for n in rb if rb[n].get("short") != ra.get(n, {}).get("short")]
P(f"- 구 행 {len(rb)}: 값이 바뀐 구 {len(ch)}, short(칸<{20}) 상태가 바뀐 구 {short}")
for k in ("highShare", "fellShare"):
    v = [ra[n][k] - rb[n][k] for n in rb if isinstance(rb[n].get(k), (int, float)) and isinstance(ra.get(n, {}).get(k), (int, float)) and rb[n][k] != ra[n][k]]
    P(f"- {k} 바뀐 구 {len(v)}: {dist(v)}")
for n in ch: P(f"  - {n}: {rb[n]} → {ra.get(n)}")

# ---------- A3 ----------
P("\n## A3 reco-<구>.json jeonseN")
r3b, r3a = L(f"{B}/a3.json"), L(f"{A}/a3.json")
def cells(files):
    o = {}
    for slug, f in files.items():
        af, cf = f["apartmentFields"], f["cellFields"]
        for ap in f["apartments"]:
            for c in ap[af.index("cells")]:
                o[(slug, ap[af.index("id")], c[cf.index("areaSqm")])] = dict(zip(cf, c))
    return o
cb3, ca3 = cells(r3b), cells(r3a)
other = 0
jd, zero, rel = [], 0, []
for k, v in cb3.items():
    w = ca3.get(k)
    if w is None: other += 1; continue
    if {x: y for x, y in v.items() if x != "jeonseN"} != {x: y for x, y in w.items() if x != "jeonseN"}: other += 1
    if v["jeonseN"] != w["jeonseN"]:
        jd.append(w["jeonseN"] - v["jeonseN"]); rel.append(100 * (w["jeonseN"] - v["jeonseN"]) / v["jeonseN"])
        if w["jeonseN"] == 0: zero += 1
pos_b = sum(1 for v in cb3.values() if v["jeonseN"] > 0); pos_a = sum(1 for v in ca3.values() if v["jeonseN"] > 0)
P(f"- 값을 낸 칸 {len(cb3):,} → {len(ca3):,}, jeonseN 외 필드가 바뀐 칸 {other}")
P(f"- jeonseN>0 칸 {pos_b:,} → {pos_a:,}; 바뀐 칸 {len(jd):,}(단지 {len({(k[0],k[1]) for k in cb3 if cb3[k]['jeonseN'] != ca3.get(k,{}).get('jeonseN')})}), 그중 0이 된 칸 {zero}")
P(f"- 건수 변화: {dist(jd)}; 상대 변화(%): {dist(rel)}")
P(f"- 서울 jeonseN 합 {sum(v['jeonseN'] for v in cb3.values()):,} → {sum(v['jeonseN'] for v in ca3.values()):,}")
P(f"- 다른 최상위 필드 차이 구: {[s for s in r3b if {k:v for k,v in r3b[s].items() if k!='apartments'} != {k:v for k,v in r3a[s].items() if k!='apartments'}]}")

# ---------- B1·B2 ----------
P("\n## B1·B2 realestate.json (계약 기준 창)")
reb, rea = L(f"{B}/re/realestate.json"), L(f"{A}/re/realestate.json")
P(f"- 창: {reb['window']} / after {rea['window'] == reb['window']}")
for k in ("jeonse", "wolse"):
    P(f"- 서울 {k}: {reb['overall'][k]} → {rea['overall'][k]}")
db = {d["name"]: d for d in reb["districts"]}; da = {d["name"]: d for d in rea["districts"]}
for kind, field in (("jeonse", "avgDepositPerPyeong10k"), ("wolse", "avgConvertedPerPyeong10k"), ("wolse", "avgDeposit10k"), ("wolse", "avgMonthlyRent10k")):
    pct, absd, cnt = [], [], []
    for n in db:
        b, a = db[n].get(kind), da[n].get(kind)
        if b and a and b[field] != a[field]: pct.append(100 * (a[field] - b[field]) / b[field]); absd.append(a[field] - b[field])
    P(f"- 구 {kind}.{field} 바뀐 구 {len(pct)}/25: 변화율(%) {dist(pct)} · 절대 {dist(absd)}")
for kind in ("jeonse", "wolse"):
    c = [(n, db[n][kind]["transactionCount"], da[n][kind]["transactionCount"] if da[n].get(kind) else 0) for n in db if db[n].get(kind)]
    drop = [100 * (a - b) / b for _, b, a in c]
    below = [n for n, b, a in c if b >= 5 and a < 5]
    P(f"- 구 {kind} 건수: 바뀐 구 {sum(1 for _, b, a in c if a != b)}, 감소율(%) {dist(drop)}, MIN_SAMPLE 5 아래로 떨어진 구 {below}, 최소 건수 after {min(a for _,_,a in c)}")
# 전세가율(참고: 하류, 구현 PR 전후 차이로 확인)
def jr(x): return 100 * x["jeonse"]["avgDepositPerPyeong10k"] / x["sale"]["avgPricePerPyeong10k"]
P(f"- (참고) 서울 전세가율 {jr(reb['overall']):.2f}% → {jr(rea['overall']):.2f}% ({jr(rea['overall'])-jr(reb['overall']):+.2f}%p)")
jrd = [jr(da[n]) - jr(db[n]) for n in db if db[n].get("jeonse") and db[n].get("sale")]
P(f"- (참고) 구 전세가율 변화(%p): {dist([v for v in jrd if abs(v) > 1e-9])}")
# 공개 파일 전체에서 바뀐 경로
def leaves(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items(): yield from leaves(v, f"{p}.{k}")
    elif isinstance(o, list):
        for i, v in enumerate(o): yield from leaves(v, f"{p}[{i}]")
    else: yield p, o
lb, la = dict(leaves(reb)), dict(leaves(rea))
diff = sorted(k for k in set(lb) | set(la) if lb.get(k) != la.get(k) and not k.endswith("PerM2"))
import re
kinds = sorted({re.sub(r"\[\d+\]", "[]", k) for k in diff})
P(f"- 바뀐 공개 경로 {len(diff)}개, 모양 {len(kinds)}종: " + "; ".join(kinds))
P(f"- 7일 증감 관련 경로(change·Change) 차이: {[k for k in diff if 'hange' in k and 'changeWithheld' not in k]}")

# ---------- B4 history ----------
hb, ha = L(f"{B}/re/realestate-history.json"), L(f"{A}/re/realestate-history.json")
P(f"\n## B4 history: 오늘 레코드만 다름 {all(x == y for x, y in zip(hb[:-1], ha[:-1])) and hb[-1] != ha[-1]} (레코드 {len(hb)}, 마지막 {hb[-1]['date']})")

# ---------- B5 ----------
P("\n## B5 realestate-trend.json")
tb, ta = L(f"{B}/re/realestate-trend.json"), L(f"{A}/re/realestate-trend.json")
P(f"- weeks 같음 {tb['weeks'] == ta['weeks']} ({len(tb['weeks'])}주), pending 같음 {tb['pendingWeeks'] == ta['pendingWeeks']}")
def series(t):
    o = {}
    for w, v in t["overall"].items():
        for k in ("jeonse", "wolse"):
            if v.get(k): o[("서울", w, k)] = v[k]
    for n, ws in t["districts"].items():
        for w, v in ws.items():
            for k in ("jeonse", "wolse"):
                if v.get(k): o[(n, w, k)] = v[k]
    return o
sb, sa = series(tb), series(ta)
for kind, field in (("jeonse", "avgDepositPerPyeong10k"), ("wolse", "avgDeposit10k"), ("wolse", "avgMonthlyRent10k")):
    keys = [k for k in sb if k[2] == kind]
    gone = [k for k in keys if k not in sa]; newk = [k for k in sa if k[2] == kind and k not in sb]
    pct = [100 * (sa[k][field] - sb[k][field]) / sb[k][field] for k in keys if k in sa and sa[k][field] != sb[k][field]]
    P(f"- {kind}.{field}: 점 {len(keys):,}(서울+구×주), 사라진 점 {len(gone)}, 생긴 점 {len(newk)}, 값 바뀐 점 {len(pct):,}: 변화율(%) {dist(pct)}")
    if kind == "jeonse":
        so = [(k[1], 100*(sa[k][field]-sb[k][field])/sb[k][field]) for k in keys if k[0]=="서울" and k in sa]
        P(f"  - 서울 주별 전세 변화율(%): 중앙 {st.median([v for _,v in so]):+.2f}, 최소 {min(v for _,v in so):+.2f}({min(so,key=lambda x:x[1])[0]}), 최대 {max(v for _,v in so):+.2f}({max(so,key=lambda x:x[1])[0]})")
        if gone: P(f"  - 사라진 점(TREND_MIN_SAMPLE 5 아래): {gone[:12]}")
tbr = json.dumps({k: v for k, v in tb.items() if k not in ('overall', 'districts', 'updatedAt')}) == json.dumps({k: v for k, v in ta.items() if k not in ('overall', 'districts', 'updatedAt')})
P(f"- 매매 점 같음: {all(tb['overall'][w].get('sale') == ta['overall'][w].get('sale') for w in tb['overall'])}")

# ---------- B6 ----------
P("\n## B6 rent-preview.json")
pb, pa = L(f"{B}/b6.json"), L(f"{A}/b6.json")
for k in ("jeonse", "wolse"):
    ids = lambda L_: [json.dumps(x, sort_keys=True, ensure_ascii=False) for x in L_]
    xb, xa = ids(pb[k]["deals"]), ids(pa[k]["deals"])
    P(f"- {k} total {pb[k]['total']:,} → {pa[k]['total']:,} ({100*(pa[k]['total']-pb[k]['total'])/pb[k]['total']:+.1f}%), 최근 30건 중 빠진 줄 {len([x for x in xb if x not in xa])}(빠진 줄의 renewal 필드 없음 {sum(1 for x in pb[k]['deals'] if 'renewal' not in x and json.dumps(x, sort_keys=True, ensure_ascii=False) not in xa)})")
print("\n".join(out))
