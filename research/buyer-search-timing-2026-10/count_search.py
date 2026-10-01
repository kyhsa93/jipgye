"""우리 원본만으로 '조건 → 단지 후보' 탐색을 하면 결과가 몇 개씩 나오나(체크리스트 8·9).

후보 = 최근 6개월(신고 기한이 닫힌 2026-03~08) 같은 단지·같은 평형대에서 해제 아닌 거래가 n건 이상이고,
그 중앙값이 예산 창 [0.75B, B] 안에 드는 단지×평형대. 조건 조합마다 후보 수를 센다.
K-apt 매칭(match_kapt.py → cache/match.json)이 붙으면 세대수 조건도 얹어 본다. REPO만 바꾸면 된다."""
import os, re, json, glob, collections, itertools, statistics
REPO = os.environ.get("REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
HERE = os.path.dirname(os.path.abspath(__file__))
SGG = dict(re.findall(r'code: "(\d+)", name: "([^"]+)"', open(os.path.join(REPO, "scripts/realestate-districts.mjs")).read()))
match = json.load(open(os.path.join(HERE, "cache", "match.json")))
kapt = {k["단지코드"]: k for k in json.load(open(os.path.join(HERE, "cache", "kapt-seoul.json")))}
MONTHS = {f"2026{m:02d}" for m in range(3, 9)}

def band(a):
    return "~49㎡" if a < 50 else "50~69㎡(59형)" if a < 70 else "70~99㎡(84형)" if a < 100 else "100~134㎡" if a < 135 else "135㎡~"

cells = collections.defaultdict(list); meta = {}
for f in glob.glob(os.path.join(REPO, "raw/sale/*.json")):
    for it in json.load(open(f))["items"]:
        if str(it.get("cdealType", "")).strip(): continue
        ym = f"{it['dealYear']}{int(it['dealMonth']):02d}"
        if ym not in MONTHS: continue
        g = SGG[str(it["sggCd"])]
        ck = (g, it["umdNm"], str(it["jibun"]), it["aptNm"])
        price = int(str(it["dealAmount"]).replace(",", "")) / 10000  # 억
        cells[(ck, band(float(it["excluUseAr"])))].append(price)
        meta[ck] = it.get("buildYear")

def hh(ck):
    code = match.get("|".join(ck)); 
    if not code or code not in kapt: return None
    try: return float(kapt[code]["세대수"])
    except ValueError: return None

rows = []
for (ck, b), ps in cells.items():
    rows.append(dict(g=ck[0], ck=ck, band=b, n=len(ps), med=statistics.median(ps), by=meta[ck] or 0, hh=hh(ck)))
print("6개월 단지×평형대 칸", len(rows), "| 거래 3건↑ 칸", sum(r["n"] >= 3 for r in rows), "| 단지", len({r["ck"] for r in rows}))
print("세대수를 아는 칸(거래 3건↑ 중)", f"{sum(r['hh'] is not None for r in rows if r['n']>=3)/sum(r['n']>=3 for r in rows):.1%}")

BUDGETS = [4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30]
BANDS = [None, "~49㎡", "50~69㎡(59형)", "70~99㎡(84형)", "100~134㎡", "135㎡~"]
AGES = {"연식 무관": lambda y: True, "10년 이내(2016~)": lambda y: y >= 2016, "20년 이내(2006~)": lambda y: y >= 2006, "30년 넘음(~1996)": lambda y: 0 < y <= 1996}
HH = {"세대수 무관": lambda h: True, "300세대↑": lambda h: h is not None and h >= 300, "1000세대↑": lambda h: h is not None and h >= 1000}
GUS = [None] + sorted(set(SGG.values()))

def count(B, bd, age, hhf, g, minn=3):
    return sum(1 for r in rows if r["n"] >= minn and 0.75 * B <= r["med"] <= B and (bd is None or r["band"] == bd)
               and AGES[age](r["by"]) and HH[hhf](r["hh"]) and (g is None or r["g"] == g))

# 수요 가중치: 그 예산 창 × 구에서 실제로 난 거래 수(사람들이 실제로 그 조건에 있었던 정도)
deals_in = collections.Counter()
for (ck, b), ps in cells.items():
    for p in ps:
        for B in BUDGETS:
            if 0.75 * B <= p <= B: deals_in[(B, ck[0], b)] += 1

def summarize(label, combos):
    zero = sum(1 for c in combos if c[1] == 0); few = sum(1 for c in combos if 1 <= c[1] <= 2); ok = sum(1 for c in combos if c[1] >= 3)
    w = sum(c[2] for c in combos) or 1
    wz = sum(c[2] for c in combos if c[1] == 0) / w; wf = sum(c[2] for c in combos if 1 <= c[1] <= 2) / w
    print(f"{label}: 조합 {len(combos)} | 0개 {zero/len(combos):.0%} · 1~2개 {few/len(combos):.0%} · 3개↑ {ok/len(combos):.0%} | 거래 가중 0개 {wz:.0%} · 1~2개 {wf:.0%}")

print("\n[후보 = 같은 단지·평형대 6개월 3건↑, 중앙값이 예산 창 0.75B~B]")
for age in AGES:
    for hhf in HH:
        for scope in ("서울 전체", "자치구"):
            combos = []
            for B, bd in itertools.product(BUDGETS, BANDS[1:]):
                for g in ([None] if scope == "서울 전체" else GUS[1:]):
                    wt = deals_in[(B, g, bd)] if g else sum(v for (b2, g2, bd2), v in deals_in.items() if b2 == B and bd2 == bd)
                    combos.append((B, count(B, bd, age, hhf, g), wt))
            summarize(f"{scope} × 예산{len(BUDGETS)} × 평형5 × {age} × {hhf}", combos)

print("\n[서울 전체, 평형대 × 예산별 후보 수 — 연식·세대수 무관]")
print("예산(억) | " + " | ".join(b for b in BANDS[1:]))
for B in BUDGETS:
    print(f"{B} | " + " | ".join(str(count(B, bd, '연식 무관', '세대수 무관', None)) for bd in BANDS[1:]))
print("\n[같은 표, 1건↑로 낮추면]")
for B in BUDGETS:
    print(f"{B} | " + " | ".join(str(count(B, bd, '연식 무관', '세대수 무관', None, 1)) for bd in BANDS[1:]))
# 84형 9억에서 구별
print("\n[84형 · 예산 9억(6.75~9억) 구별 후보 3건↑]", {g: count(9, "70~99㎡(84형)", "연식 무관", "세대수 무관", g) for g in GUS[1:]})
print("[84형 · 예산 15억 구별]", {g: count(15, "70~99㎡(84형)", "연식 무관", "세대수 무관", g) for g in GUS[1:]})

# 화면에 넘길 칸 요약 파일 크기 어림(빌드에서 한 장, 브라우저는 거르기만)
import gzip
out = [[r["g"], r["ck"][1], r["ck"][3], r["band"][:3], r["n"], round(r["med"], 2), r["by"], int(r["hh"]) if r["hh"] else None] for r in rows]
blob = json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode()
print(f"\n칸 요약 {len(out)}줄: {len(blob)/1024:.0f} KB, gzip {len(gzip.compress(blob))/1024:.0f} KB")
