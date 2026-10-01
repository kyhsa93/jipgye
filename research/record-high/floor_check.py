"""#11 반증: 신고가가 낮아 보이는 것이 '신고가가 고층이었고 다음 거래가 저층이었을 뿐'인가.
다음 거래가 신고가보다 같거나 높은 층일 때만 다시 센다. 기준: 선행 3건·180일, 다음 거래를 90일 기다림.
"""
import os, json, glob, collections as C, datetime as D
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows += json.load(open(f))['items']
amt = lambda r: int(str(r['dealAmount']).replace(',', ''))
date = lambda r: D.date(r['dealYear'], r['dealMonth'], r['dealDay'])
fl = lambda r: int(r.get('floor') or 0)
market = [r for r in rows if r.get('cdealType') != 'O' and r['dealingGbn'] == '중개거래']
by = C.defaultdict(list)
for r in market: by[f"{r['sggCd']}|{r['aptNm']}|{r['excluUseAr']}"].append(r)
for l in by.values(): l.sort(key=date)
END = max(date(r) for r in market); H = 90; cut = END - D.timedelta(days=H)
res = C.defaultdict(list); hi_floor = []; all_floor = []
for l in by.values():
    for i, r in enumerate(l):
        d0 = date(r)
        if d0 > cut: continue
        prev = [x for x in l[:i] if date(x) < d0]
        if len(prev) < 3 or (d0 - date(prev[0])).days < 180: continue
        nxt = [x for x in l[i+1:] if d0 < date(x) <= d0 + D.timedelta(days=H)]
        if not nxt: continue
        n = nxt[0]; ch = amt(n) / amt(r) - 1
        is_hi = amt(r) > max(amt(x) for x in prev)
        key = 'hi' if is_hi else 'all'
        res[key].append(ch)
        if fl(n) >= fl(r): res[key + '_samefloor_or_up'].append(ch)
        (hi_floor if is_hi else all_floor).append(fl(r) - sorted(fl(x) for x in prev)[len(prev)//2])
share = lambda v: f"{sum(x >= 0 for x in v)/len(v):.1%} (n={len(v)})"
print('다음 ≥ 이번, 전체 | 다음 거래가 같거나 높은 층일 때만')
print('신고가 ', share(res['hi']), '|', share(res['hi_samefloor_or_up']))
print('대조   ', share(res['all']), '|', share(res['all_samefloor_or_up']))
md = lambda v: sorted(v)[len(v)//2]
print('이번 거래 층 - 선행 거래 층 중앙: 신고가', md(hi_floor), ' 대조', md(all_floor))
