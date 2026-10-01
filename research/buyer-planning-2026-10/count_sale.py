"""raw/sale 원본을 직접 세어 매매자 기능 제안의 표본을 확인한다. 저장소는 읽기만 한다."""
import os, json, glob, collections as C, statistics as S, random, datetime as D, math

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')):
    rows += json.load(open(f))['items']

def amt(r): return int(str(r['dealAmount']).replace(',', '').strip())
def date(r): return D.date(r['dealYear'], r['dealMonth'], r['dealDay'])
def ym(r): return r['dealYear'] * 100 + r['dealMonth']
def cell(r): return f"{r['sggCd']}|{r['aptNm']}|{r['excluUseAr']}"
def cplx(r): return f"{r['sggCd']}|{r['aptNm']}"

alive = [r for r in rows if r.get('cdealType') != 'O']
market = [r for r in alive if r['dealingGbn'] == '중개거래']
print('전체', len(rows), '해제', len(rows) - len(alive), '해제 제외', len(alive), '중개만', len(market))
print('계약일 범위', min(date(r) for r in rows), max(date(r) for r in rows))

# 신고 기한(30일)이 닫힌 달만: 수집일 2026-10-01 기준 2026-08까지
CLOSED = 202608
print('\n## A. 월별 거래량(해제 제외, 직거래 포함 / 중개만)')
mc = C.Counter(ym(r) for r in alive); mm = C.Counter(ym(r) for r in market)
for k in sorted(mc): print(k, mc[k], mm[k], '' if k <= CLOSED else '(신고 기한 미마감)')

# 토허제 발효 전후 주간
print('\n2025-10 일별 주 단위 (토허제 2025-10-20 발효 가정 — 웹 확인 필요)')
wk = C.Counter()
for r in alive:
    d = date(r)
    if D.date(2025, 9, 29) <= d < D.date(2025, 12, 1):
        wk[d - D.timedelta(days=d.weekday())] += 1
for k in sorted(wk): print(k, wk[k])

# B. 가격 확인 표본: 마감된 최근 달(2026-07, 2026-08) 거래 하나하나에 대해, 그 이전 N개월 같은 칸 거래 수
print('\n## B. "이 값이 이 단지 이 평형에서 정상인가" — 같은 칸(구|단지|전용면적) 선행 거래 수')
by_cell = C.defaultdict(list)
for r in market: by_cell[cell(r)].append(r)
targets = [r for r in market if ym(r) in (202607, 202608)]
def prior(r, months):
    d0 = date(r); lo = d0 - D.timedelta(days=round(30.4 * months))
    return [x for x in by_cell[cell(r)] if lo <= date(x) < d0]
for months in (3, 6, 12):
    ns = [len(prior(r, months)) for r in targets]
    tot = len(ns)
    print(f'선행 {months}개월: 대상 {tot}건, 0건 {sum(n==0 for n in ns)/tot:.1%}, 3건↑ {sum(n>=3 for n in ns)/tot:.1%}, 5건↑ {sum(n>=5 for n in ns)/tot:.1%}, 10건↑ {sum(n>=10 for n in ns)/tot:.1%}')

# 같은 단지 다른 평형까지 넓히면(단지 단위, 평당가)
by_cx = C.defaultdict(list)
for r in market: by_cx[cplx(r)].append(r)
ns = []
for r in targets:
    d0 = date(r); lo = d0 - D.timedelta(days=365)
    ns.append(sum(1 for x in by_cx[cplx(r)] if lo <= date(x) < d0))
print(f'단지 단위 선행 12개월: 3건↑ {sum(n>=3 for n in ns)/len(ns):.1%}, 0건 {sum(n==0 for n in ns)/len(ns):.1%}')

# 단지 수 분포(15개월)
cx_n = C.Counter(cplx(r) for r in market)
print('단지 수', len(cx_n), '15개월 1건뿐인 단지', sum(v == 1 for v in cx_n.values()), '10건↑', sum(v >= 10 for v in cx_n.values()))
cell_n = C.Counter(cell(r) for r in market)
print('칸 수', len(cell_n), '1건뿐', sum(v == 1 for v in cell_n.values()), '3건↑', sum(v >= 3 for v in cell_n.values()))

# 자치구별: 선행 12개월 3건↑ 비율
print('\n자치구별 선행12개월 같은 칸 3건↑ 비율')
gu = C.defaultdict(list)
for r in targets: gu[r['sggCd']].append(len(prior(r, 12)) >= 3)
for k, v in sorted(gu.items(), key=lambda kv: sum(kv[1]) / len(kv[1])):
    print(k, len(v), f'{sum(v)/len(v):.0%}')

# C. 칸 안의 흩어짐: 선행 12개월 5건↑인 대상에 대해, 대상 가격이 선행 중앙값에서 얼마나 떨어졌나 + 선행의 IQR/중앙값
print('\n## C. 같은 칸 안에서 값이 얼마나 흩어지나 (선행 12개월 5건↑)')
dev, iqr, dev6 = [], [], []
for r in targets:
    p = [amt(x) for x in prior(r, 12)]
    if len(p) >= 5:
        m = S.median(p); dev.append(amt(r) / m - 1)
        q = S.quantiles(p, n=4); iqr.append((q[2] - q[0]) / m)
    p6 = [amt(x) for x in prior(r, 3)]
    if len(p6) >= 3:
        dev6.append(amt(r) / S.median(p6) - 1)
def pct(a, q): a = sorted(a); return a[min(len(a) - 1, int(q * len(a)))]
print('대상 수', len(dev), '대상가/선행12개월 중앙값-1 중앙', f'{S.median(dev):+.1%}', '10~90%', f'{pct(dev,.1):+.1%} ~ {pct(dev,.9):+.1%}')
print('선행 IQR/중앙값 중앙', f'{S.median(iqr):.1%}')
print('선행3개월 3건↑ 대상', len(dev6), '중앙', f'{S.median(dev6):+.1%}', '10~90%', f'{pct(dev6,.1):+.1%} ~ {pct(dev6,.9):+.1%}')
# 층 통제: 1층·2층 빼고
dev_nf = []
for r in targets:
    if r['floor'] <= 2: continue
    p = [amt(x) for x in prior(r, 12) if x['floor'] > 2]
    if len(p) >= 5: dev_nf.append(amt(r) / S.median(p) - 1)
print('3층↑끼리만', len(dev_nf), f'중앙 {S.median(dev_nf):+.1%}', f'10~90% {pct(dev_nf,.1):+.1%} ~ {pct(dev_nf,.9):+.1%}')

# D. 신고가: 같은 칸 선행 거래(전체 보유 기간) 3건↑ 중 최고가를 넘은 거래 비율, 월별
print('\n## D. 신고가(같은 칸 그 전 최고가 초과) 비율, 월별 — 선행 3건↑만')
for r in market: r['_d'] = date(r); r['_a'] = amt(r)
for k in by_cell: by_cell[k].sort(key=lambda x: x['_d'])
nh = C.defaultdict(lambda: [0, 0])
newhigh = []
for k, lst in by_cell.items():
    for i, r in enumerate(lst):
        prev = [x for x in lst[:i] if x['_d'] < r['_d']]
        if len(prev) < 3: continue
        if (r['_d'] - prev[0]['_d']).days < 180: continue  # 비교 기간 6개월 이상 확보
        is_high = r['_a'] > max(x['_a'] for x in prev)
        nh[ym(r)][0] += is_high; nh[ym(r)][1] += 1
        if is_high: newhigh.append((k, i, r))
for k in sorted(nh): print(k, nh[k][1], f'{nh[k][0]/nh[k][1]:.1%}')

# 신고가 뒤 같은 칸의 다음 거래가 그 신고가 이상인가 (반증: "신고가 = 새 시세")
nxt = []
for k, i, r in newhigh:
    lst = by_cell[k]
    later = [x for x in lst[i + 1:] if x['_d'] > r['_d']]
    if later: nxt.append(later[0]['_a'] / r['_a'] - 1)
if nxt:
    print('신고가 뒤 다음 거래 있음', len(nxt), '다음 거래가 신고가 이상', f'{sum(x>=0 for x in nxt)/len(nxt):.1%}', '중앙', f'{S.median(nxt):+.1%}')
# 대조: 신고가 아닌 거래 뒤 다음 거래 변화
ctrl = []
for k, lst in by_cell.items():
    for i, r in enumerate(lst[:-1]):
        later = [x for x in lst[i + 1:] if x['_d'] > r['_d']]
        if later: ctrl.append(later[0]['_a'] / r['_a'] - 1)
print('모든 거래 뒤 다음 거래 변화 중앙', f'{S.median(ctrl):+.1%}', '이상 비율', f'{sum(x>=0 for x in ctrl)/len(ctrl):.1%}', len(ctrl))

# E. 세금·대출 경계에 거래가 몰리나
print('\n## E. 가격 경계 근처 몰림 (해제 제외, 직거래 포함)')
A = [amt(r) for r in alive]
def band(lo, hi): return sum(lo <= a < hi for a in A)
for b in (60000, 90000, 120000, 150000, 250000):
    print(f'{b/1e4:.0f}억 경계: 직전 2천만원 {band(b-2000,b)} / 직후 2천만원 {band(b,b+2000)}  | 정확히 {b/1e4:.0f}억 {sum(a==b for a in A)}')
    # 이웃 비교: 직전 구간 앞
    print('    대조 (경계-6천~-4천)', band(b-6000, b-4000), '(경계+4천~+6천)', band(b+4000, b+6000))
# 경계 전후를 10/15 대책 전후로 나눠서
for b in (150000, 250000):
    for lab, cond in (('대책 전(~2025-10-15)', lambda r: date(r) <= D.date(2025, 10, 15)), ('대책 후(2025-10-16~)', lambda r: date(r) > D.date(2025, 10, 15))):
        sub = [amt(r) for r in alive if cond(r)]
        lo = sum(b - 2000 <= a < b for a in sub); hi = sum(b < a <= b + 2000 for a in sub); eq = sum(a == b for a in sub)
        print(f'  {b/1e4:.0f}억 {lab}: 직전2천 {lo} / 정확히 {eq} / 직후2천(초과) {hi}')
tot = len(A)
print('취득세 구간 비중: 6억 이하', f'{band(0,60001)/tot:.1%}', '6억 초과~9억 이하', f'{sum(60000<a<=90000 for a in A)/tot:.1%}', '9억 초과', f'{sum(a>90000 for a in A)/tot:.1%}')
print('85㎡ 초과(농특세)', f"{sum(r['excluUseAr']>85 for r in alive)/len(alive):.1%}")
print('12억 초과(1주택 양도 비과세 한도 초과 가격대)', f'{sum(a>120000 for a in A)/tot:.1%}')
print('15억 초과', f'{sum(a>150000 for a in A)/tot:.1%}', '25억 초과', f'{sum(a>250000 for a in A)/tot:.1%}')

# F. 자치구 × 월 표본 (갈아타기: 두 구 사이 간격 추이)
print('\n## F. 자치구 × 월 중개거래 수 (마감된 달만)')
gm = C.Counter((r['sggCd'], ym(r)) for r in market if ym(r) <= CLOSED)
gus = sorted({g for g, _ in gm}); months = sorted({m for _, m in gm})
mins = []
for g in gus:
    v = [gm[(g, m)] for m in months]
    mins.append((min(v), g, S.median(v)))
mins.sort()
print('구별 (최소 월, 중앙 월):', [(g, a, b) for a, g, b in mins[:8]], '...', [(g, a, b) for a, g, b in mins[-3:]])
print('구-월 칸 중 30건 미만', sum(gm[(g, m)] < 30 for g in gus for m in months), '/', len(gus) * len(months))

# G. 같은 집(칸+층) 반복 거래
print('\n## G. 같은 칸·같은 층 반복 거래 쌍 (15개월)')
unit = C.defaultdict(list)
for r in market: unit[(cell(r), r['floor'])].append(r)
pairs = []
for k, lst in unit.items():
    lst.sort(key=lambda x: x['_d'])
    for a, b in zip(lst, lst[1:]): pairs.append(((b['_d'] - a['_d']).days, b['_a'] / a['_a'] - 1))
print('쌍', len(pairs), '90일↑', sum(d >= 90 for d, _ in pairs), '180일↑', sum(d >= 180 for d, _ in pairs), '365일↑', sum(d >= 365 for d, _ in pairs))

# H. 해제율: 가격대별, 월별
print('\n## H. 해제율 (전체 신고 중 해제, 중개거래만) 가격대별')
def pb(a):
    for lim, lab in ((60000, '~6억'), (90000, '6~9억'), (150000, '9~15억'), (250000, '15~25억')):
        if a <= lim: return lab
    return '25억~'
hb = C.defaultdict(lambda: [0, 0])
for r in rows:
    if r['dealingGbn'] != '중개거래' or ym(r) > CLOSED: continue
    hb[pb(amt(r))][0] += r.get('cdealType') == 'O'; hb[pb(amt(r))][1] += 1
for k in ('~6억', '6~9억', '9~15억', '15~25억', '25억~'): print(k, hb[k][1], f'{hb[k][0]/hb[k][1]:.2%}')
hm = C.defaultdict(lambda: [0, 0])
for r in rows:
    if r['dealingGbn'] != '중개거래' or ym(r) > CLOSED: continue
    hm[ym(r)][0] += r.get('cdealType') == 'O'; hm[ym(r)][1] += 1
print('월별 해제율', {k: f'{v[0]/v[1]:.1%}' for k, v in sorted(hm.items())})

# I. 매수·매도 주체
print('\n## I. 거래 주체')
print('매도자', C.Counter(r['slerGbn'] for r in alive).most_common())
print('매수자', C.Counter(r['buyerGbn'] for r in alive).most_common())
pub = [r for r in alive if r['buyerGbn'] == '공공기관']
print('공공기관 매수 월별', sorted(C.Counter(ym(r) for r in pub).items()))
print('공공기관 매수 직거래 비율', f"{sum(r['dealingGbn']=='직거래' for r in pub)/max(1,len(pub)):.0%}")
corp = [r for r in alive if r['slerGbn'] == '법인']
print('법인 매도 직거래 비율', f"{sum(r['dealingGbn']=='직거래' for r in corp)/max(1,len(corp)):.0%}", '법인 매도 상위 단지', C.Counter(r['aptNm'] for r in corp).most_common(5))

# J. 연식
print('\n## J. 준공 연식 (계약 연도 기준 나이)')
ages = [r['dealYear'] - r['buildYear'] for r in market if r.get('buildYear')]
print('5년 이하', f'{sum(a<=5 for a in ages)/len(ages):.1%}', '30년 이상', f'{sum(a>=30 for a in ages)/len(ages):.1%}', '중앙', S.median(ages))

# K. 같은 단지 매매 + 전세(갈아타기·첫 집: 가진 전세금으로 어디까지) — 생략, 전세 파일은 rent 쪽
