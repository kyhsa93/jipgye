"""5차: P1 시점 보정의 자치구별 잔여 치우침 — 권역 지수가 권역 안 자치구 차이를 덮나."""
import os, json, glob, collections as C, statistics as S, datetime as D
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows=[]
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows+=json.load(open(f))['items']
amt=lambda r:int(str(r['dealAmount']).replace(',',''))
date=lambda r:D.date(r['dealYear'],r['dealMonth'],r['dealDay'])
ym=lambda r:f"{r['dealYear']}{r['dealMonth']:02d}"
cell=lambda r:f"{r['sggCd']}|{r['aptNm']}|{r['excluUseAr']}"
market=[r for r in rows if r.get('cdealType')!='O' and r['dealingGbn']=='중개거래']
REG={'210':["11110","11140","11170"],'220':["11200","11215","11230","11260","11290","11305","11320","11350"],'240':["11380","11410","11440"],'250':["11470","11500","11530","11545","11560","11590","11620"],'230':["11650","11680","11710","11740"]}
reg_of={d:k for k,v in REG.items() for d in v}
idx={k:dict(v) for k,v in json.load(open(f'{REPO}/raw/ecos/apt-price-index.json'))['series'].items()}
by=C.defaultdict(list)
for r in market: by[cell(r)].append(r)
res=C.defaultdict(lambda:{'raw':[],'adj':[],'w6':[]})
for r in market:
    if ym(r) not in ('202606','202607'): continue
    d0=date(r); g=reg_of[str(r['sggCd'])]; t=idx[g][ym(r)]
    p=[x for x in by[cell(r)] if d0-D.timedelta(days=365)<=date(x)<d0]
    if len(p)>=5:
        res[r['sggCd']]['raw'].append(amt(r)/S.median([amt(x) for x in p])-1)
        res[r['sggCd']]['adj'].append(amt(r)/S.median([amt(x)*t/idx[g][ym(x)] for x in p])-1)
    p6=[x for x in by[cell(r)] if d0-D.timedelta(days=183)<=date(x)<d0]
    if len(p6)>=3: res[r['sggCd']]['w6'].append(amt(r)/S.median([amt(x)*t/idx[g][ym(x)] for x in p6])-1)
out=sorted(res.items(), key=lambda kv:S.median(kv[1]['adj']))
for g,v in out: print(g,len(v['adj']),f"보정전 {S.median(v['raw']):+.1%}",f"권역보정 {S.median(v['adj']):+.1%}",f"6개월·보정 {S.median(v['w6']):+.1%} (n={len(v['w6'])})")
allw6=[x for v in res.values() for x in v['w6']]
print('6개월 창·권역보정 전체', len(allw6), f'{S.median(allw6):+.1%}')
