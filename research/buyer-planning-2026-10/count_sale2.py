"""2차: (1) 12개월 선행 중앙값을 권역 지수로 시점 보정하면 쓸 만해지나 (2) 가격 경계 몰림의 대조군 (3) 갈아타기 — 자치구 1년 변화를 칸 체인으로 낼 표본이 되나."""
import os, json, glob, collections as C, statistics as S, random, datetime as D, math
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows += json.load(open(f))['items']
amt = lambda r: int(str(r['dealAmount']).replace(',', ''))
date = lambda r: D.date(r['dealYear'], r['dealMonth'], r['dealDay'])
ym = lambda r: f"{r['dealYear']}{r['dealMonth']:02d}"
cell = lambda r: f"{r['sggCd']}|{r['aptNm']}|{r['excluUseAr']}"
alive = [r for r in rows if r.get('cdealType') != 'O']
market = [r for r in alive if r['dealingGbn'] == '중개거래']
REG = {'210': ["11110", "11140", "11170"], '220': ["11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350"],
       '240': ["11380", "11410", "11440"], '250': ["11470", "11500", "11530", "11545", "11560", "11590", "11620"],
       '230': ["11650", "11680", "11710", "11740"]}
reg_of = {d: k for k, v in REG.items() for d in v}
idx = {k: dict(v) for k, v in json.load(open(f'{REPO}/raw/ecos/apt-price-index.json'))['series'].items()}
by_cell = C.defaultdict(list)
for r in market: by_cell[cell(r)].append(r)

def pct(a, q): a = sorted(a); return a[min(len(a) - 1, int(q * len(a)))]
print('## 1. 시점 보정 (대상: 2026-06·07 계약, 선행 12개월 같은 칸 5건↑, 권역 지수로 대상 달 값으로 환산)')
raw_dev, adj_dev, seoul_dev, iqr_raw, iqr_adj = [], [], [], [], []
n_all = n_ok = 0
for r in market:
    if ym(r) not in ('202606', '202607'): continue
    n_all += 1
    d0 = date(r); lo = d0 - D.timedelta(days=365)
    p = [x for x in by_cell[cell(r)] if lo <= date(x) < d0]
    if len(p) < 5: continue
    n_ok += 1
    g = reg_of[str(r['sggCd'])]
    t = idx[g][ym(r)]
    ra = [amt(x) for x in p]
    ad = [amt(x) * t / idx[g][ym(x)] for x in p]
    sd = [amt(x) * idx['200'][ym(r)] / idx['200'][ym(x)] for x in p]
    raw_dev.append(amt(r) / S.median(ra) - 1); adj_dev.append(amt(r) / S.median(ad) - 1); seoul_dev.append(amt(r) / S.median(sd) - 1)
    q = S.quantiles(ad, n=4); iqr_adj.append((q[2] - q[0]) / S.median(ad))
    q = S.quantiles(ra, n=4); iqr_raw.append((q[2] - q[0]) / S.median(ra))
print('대상', n_all, '5건↑', n_ok, f'{n_ok/n_all:.1%}')
for lab, v in (('보정 없음', raw_dev), ('권역 지수 보정', adj_dev), ('서울 지수 보정', seoul_dev)):
    print(f'{lab}: 중앙 {S.median(v):+.1%}, 10~90% {pct(v,.1):+.1%} ~ {pct(v,.9):+.1%}, |편차|중앙 {S.median([abs(x) for x in v]):.1%}, 대상이 선행 범위(IQR) 위로 벗어난 비율 계산 생략')
print('선행 IQR/중앙값: 보정 전', f'{S.median(iqr_raw):.1%}', '보정 후', f'{S.median(iqr_adj):.1%}')
# 대상 가격이 보정된 선행 10~90% 안에 드는 비율
inside = 0; tot = 0
for r in market:
    if ym(r) not in ('202606', '202607'): continue
    d0 = date(r); lo = d0 - D.timedelta(days=365)
    p = [x for x in by_cell[cell(r)] if lo <= date(x) < d0]
    if len(p) < 5: continue
    g = reg_of[str(r['sggCd'])]; t = idx[g][ym(r)]
    ad = sorted(amt(x) * t / idx[g][ym(x)] for x in p); ra = sorted(amt(x) for x in p)
    tot += 1; inside += ad[0] <= amt(r) <= ad[-1]
print(f'대상이 보정된 선행 최저~최고 안에 든 비율 {inside/tot:.1%}')

print('\n## 2. 가격 경계 몰림: 경계 직전 2천만원(경계 포함) ÷ 직후 2천만원, 10·15 대책 전후, 대조 경계 포함')
cut = D.date(2025, 10, 15)
pre = [amt(r) for r in alive if date(r) <= cut]; post = [amt(r) for r in alive if date(r) > cut]
def ratio(A, b):
    lo = sum(b - 2000 < a <= b for a in A); hi = sum(b < a <= b + 2000 for a in A)
    return lo, hi, (lo / hi if hi else float('nan'))
for b in (50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000, 130000, 140000, 150000, 160000, 170000, 180000, 200000, 220000, 240000, 250000, 260000, 280000, 300000):
    a1 = ratio(pre, b); a2 = ratio(post, b)
    print(f'{b//10000:>3}억  전 {a1[0]:>4}/{a1[1]:>4} = {a1[2]:.2f}   후 {a2[0]:>4}/{a2[1]:>4} = {a2[2]:.2f}')

print('\n## 3. 갈아타기: 자치구 1년 변화 — 같은 칸이 기준기(2025-08~10)와 최근기(2026-06~08)에 다 있는 것')
base = ('202508', '202509', '202510'); rec = ('202606', '202607', '202608')
gu_ch = C.defaultdict(list)
for k, lst in by_cell.items():
    b = [amt(x) for x in lst if ym(x) in base]; c = [amt(x) for x in lst if ym(x) in rec]
    if b and c: gu_ch[k.split('|')[0]].append(math.log(S.median(c) / S.median(b)))
res = []
random.seed(1)
for g, v in gu_ch.items():
    m = S.median(v)
    boots = sorted(S.median(random.choices(v, k=len(v))) for _ in range(400))
    res.append((m, g, len(v), boots[20], boots[379]))
res.sort()
for m, g, n, lo, hi in res: print(g, n, f'{math.expm1(m):+.1%}', f'90% {math.expm1(lo):+.1%}~{math.expm1(hi):+.1%}')
allv = [x for v in gu_ch.values() for x in v]
print('서울', len(allv), f'{math.expm1(S.median(allv)):+.1%}', '공식 서울 지수 2025-09→2026-07', f"{idx['200']['202607']/idx['200']['202509']-1:+.1%}")
# 몇 쌍의 구가 서로 갈라 말할 수 있나(구간 겹치지 않음)
sep = 0; pairs = 0
for i in range(len(res)):
    for j in range(i + 1, len(res)):
        pairs += 1
        if res[i][4] < res[j][3] or res[j][4] < res[i][3]: sep += 1
print('구 쌍', pairs, '90% 구간이 안 겹치는 쌍', sep)
