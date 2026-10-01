"""#11 완료 조건: 신고가 다음 거래 반증이 문턱과 생존 편향에 견고한가.
저장소 루트에서: python3 research/record-high/robustness.py
- 선행 거래 수(2/3/5건)와 비교 기간(90/180/365일)을 흔든다.
- 생존 편향(체크리스트 7): 다음 거래가 있는 것만 세면 빨리 다시 팔리는 칸만 남는다. 그래서 데이터 끝에서
  H일 이상 전에 생긴 거래(신고가와 대조군 모두)만 놓고, 'H일 안에 다음 거래가 있었나'까지 같이 센다.
"""
import os, json, glob, collections as C, statistics as S, datetime as D
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows += json.load(open(f))['items']
amt = lambda r: int(str(r['dealAmount']).replace(',', ''))
date = lambda r: D.date(r['dealYear'], r['dealMonth'], r['dealDay'])
market = [r for r in rows if r.get('cdealType') != 'O' and r['dealingGbn'] == '중개거래']
by = C.defaultdict(list)
for r in market: by[f"{r['sggCd']}|{r['aptNm']}|{r['excluUseAr']}"].append(r)
for l in by.values(): l.sort(key=date)
END = max(date(r) for r in market)
print('데이터 끝', END, '중개거래', len(market))

def run(min_prev, min_span, horizon):
    cut = END - D.timedelta(days=horizon)
    out = {'hi': [], 'near': [], 'all': [], 'up': [], 'hi_none': 0, 'all_none': 0}
    for l in by.values():
        for i, r in enumerate(l):
            d0 = date(r)
            if d0 > cut: continue
            prev = [x for x in l[:i] if date(x) < d0]
            nxt = [x for x in l[i+1:] if d0 < date(x) <= d0 + D.timedelta(days=horizon)]
            ch = amt(nxt[0]) / amt(r) - 1 if nxt else None
            # 대조군 '모든 거래'도 같은 조건(선행 기록이 있는 거래)에서 센다
            if len(prev) < min_prev or (d0 - date(prev[0])).days < min_span: continue
            m = max(amt(x) for x in prev)
            if ch is None: out['all_none'] += 1
            else: out['all'].append(ch)
            if amt(r) > m:
                if ch is None: out['hi_none'] += 1
                else:
                    out['hi'].append(ch); out['up'].append(amt(nxt[0]) > m)
            elif amt(r) >= 0.98 * m and ch is not None:
                out['near'].append(ch)
    return out

share = lambda v: sum(x >= 0 for x in v) / len(v) if v else float('nan')
print('\n선행건수 | 비교기간 | H(다음 거래를 기다린 날) | 신고가 n | 다음 거래 없음 | 다음 ≥ 신고가 | 대조(전체) | 대조(최고가 -2~0%) | 그 전 최고가는 넘음 | 결론 유지')
ok_all = True
for min_prev in (2, 3, 5):
    for span in (90, 180, 365):
        for H in (90, 180):
            o = run(min_prev, span, H)
            if len(o['hi']) < 100:
                print(f'{min_prev} | {span} | {H} | {len(o["hi"])} | 표본 부족'); continue
            hi, al, ne = share(o['hi']), share(o['all']), share(o['near'])
            up = sum(o['up']) / len(o['up'])
            none = o['hi_none'] / (o['hi_none'] + len(o['hi']))
            keep = hi < al and up > 0.5
            ok_all &= keep
            print(f'{min_prev} | {span} | {H} | {len(o["hi"])} | {none:.1%} | {hi:.1%} | {al:.1%} | {ne:.1%} | {up:.1%} | {"유지" if keep else "깨짐"}')
print('\n전 조합에서 결론 유지:', ok_all)
