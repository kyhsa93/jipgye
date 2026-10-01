"""#18: 가격대별 해제율이 익은 달에서도 갈리는가.
해제는 계약 뒤 시간이 지나며 쌓인다. 해제까지 걸린 날의 95분위를 '다 쌓이는 데 걸리는 날'로 보고,
그만큼 지난 계약월만 센다. 가격대 차이는 계약을 다시 뽑아(부트스트랩) 우연인지 본다.
저장소 루트에서: python3 research/cancel-by-price/check.py
"""
import os, json, glob, random, datetime as D, statistics as S
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows += json.load(open(f))['items']
amt = lambda r: int(str(r['dealAmount']).replace(',', ''))
date = lambda r: D.date(r['dealYear'], r['dealMonth'], r['dealDay'])
def cdate(r):
    s = str(r.get('cdealDay') or '').strip()
    if not s: return None
    y, m, d = s.split('.'); return D.date(2000 + int(y), int(m), int(d))
canc = [r for r in rows if str(r.get('cdealType') or '').strip()]
gaps = sorted((cdate(r) - date(r)).days for r in canc if cdate(r))
p95 = gaps[int(len(gaps) * 0.95)]
END = max(date(r) for r in rows)
print('해제', len(canc), '/', len(rows), '해제까지 걸린 날 중앙', S.median(gaps), '95분위', p95, '데이터 끝', END)
# 계약월별 해제율 - 익은 달 판정
by_month = {}
for r in rows:
    k = f"{r['dealYear']}{r['dealMonth']:02d}"; by_month.setdefault(k, [0, 0]); by_month[k][1] += 1
    if str(r.get('cdealType') or '').strip(): by_month[k][0] += 1
def month_end(k):
    y, m = int(k[:4]), int(k[4:]); nm = D.date(y + (m == 12), m % 12 + 1, 1); return nm - D.timedelta(days=1)
mature = sorted(k for k in by_month if (END - month_end(k)).days >= p95)
for k in sorted(by_month): print(k, by_month[k][1], f"{by_month[k][0]/by_month[k][1]:.2%}", '익음' if k in mature else '')
BANDS = [(0, 60000, '6억 이하'), (60000, 90000, '6~9억'), (90000, 150000, '9~15억'), (150000, 250000, '15~25억'), (250000, 10**9, '25억 초과')]
sel = [r for r in rows if f"{r['dealYear']}{r['dealMonth']:02d}" in mature]
print('\n익은 달', mature, '계약', len(sel))
random.seed(20261001)
res = []
for lo, hi, lab in BANDS:
    b = [1 if str(r.get('cdealType') or '').strip() else 0 for r in sel if lo < amt(r) <= hi]
    boots = sorted(sum(random.choices(b, k=len(b))) / len(b) for _ in range(400))
    res.append((lab, len(b), sum(b) / len(b), boots[20], boots[379]))
    print(f'{lab}: n={len(b)} 해제율 {sum(b)/len(b):.2%} (90% {boots[20]:.2%}~{boots[379]:.2%})')
lo_band, hi_band = res[0], res[-1]
print('\n가장 싼 대와 가장 비싼 대의 구간이 겹치나:', not (lo_band[4] < hi_band[3] or hi_band[4] < lo_band[3]))

# 반증: 가격대 차이가 시기 차이(해제율이 높던 달에 비싼 거래가 몰렸다)는 아닌가.
# 같은 계약월 안에서만 가격대를 견준다 - 달마다 (가격대 해제율 - 그 달 전체 해제율)을 계약 수로 가중 평균.
print('\n## 같은 달 안에서만 견주면 (그 달 전체 대비 %p, 계약 수 가중)')
for lo, hi, lab in BANDS:
    num = den = 0
    for k in mature:
        mon = [r for r in sel if f"{r['dealYear']}{r['dealMonth']:02d}" == k]
        base = sum(1 for r in mon if str(r.get('cdealType') or '').strip()) / len(mon)
        b = [r for r in mon if lo < amt(r) <= hi]
        if not b: continue
        rate = sum(1 for r in b if str(r.get('cdealType') or '').strip()) / len(b)
        num += (rate - base) * len(b); den += len(b)
    print(f'{lab}: {num/den*100:+.2f}%p')
print('\n## 가격대 구성이 달마다 다른가 (6억 이하 비중)')
for k in mature:
    mon = [r for r in sel if f"{r['dealYear']}{r['dealMonth']:02d}" == k]
    print(k, f"{sum(1 for r in mon if amt(r) <= 60000)/len(mon):.1%}")

# 층화 추정의 흔들림: 달마다 계약을 다시 뽑아(달 안에서) 가장 싼 대와 가장 비싼 대의 층화 차이를 400번.
print('\n## 층화 차이(25억 초과 - 6억 이하)의 90% 구간')
by_m = {k: [(amt(r), 1 if str(r.get('cdealType') or '').strip() else 0) for r in sel if f"{r['dealYear']}{r['dealMonth']:02d}" == k] for k in mature}
def strat(sample):
    out = {}
    for lo, hi, lab in (BANDS[0], BANDS[-1]):
        num = den = 0
        for k, mon in sample.items():
            base = sum(c for _, c in mon) / len(mon)
            b = [c for a, c in mon if lo < a <= hi]
            if b: num += (sum(b) / len(b) - base) * len(b); den += len(b)
        out[lab] = num / den
    return out[BANDS[-1][2]] - out[BANDS[0][2]]
random.seed(7)
diffs = sorted(strat({k: random.choices(m, k=len(m)) for k, m in by_m.items()}) for _ in range(400))
print(f'점 추정 {strat(by_m)*100:+.2f}%p, 90% {diffs[20]*100:+.2f}%p ~ {diffs[379]*100:+.2f}%p')
