"""4차 검증: (a) 갈아타기 칸 비교를 권역으로 묶어 공식 지수와 대조 (b) 신고가 다음 거래 반증의 견고성 — 회귀 효과 대조군."""
import os, json, glob, collections as C, statistics as S, datetime as D, math, random
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
base=('202508','202509','202510'); rec=('202605','202606','202607')
reg=C.defaultdict(list)
for k,l in by.items():
    b=[amt(x) for x in l if ym(x) in base]; c=[amt(x) for x in l if ym(x) in rec]
    if b and c: reg[reg_of[k.split('|')[0]]].append(math.log(S.median(c)/S.median(b)))
print('(a) 권역: 우리(2025-08~10 → 2026-05~07, 칸 중앙값) vs 공식(같은 석 달 평균끼리)')
for g,v in sorted(reg.items()):
    ob=sum(idx[g][m] for m in base)/3; oc=sum(idx[g][m] for m in rec)/3
    print(g,len(v),f'우리 {math.expm1(S.median(v)):+.1%}',f'공식 {oc/ob-1:+.1%}')
# 자치구 강남·서초만 다시: 같은 기간
for gu in ('11680','11650','11710','11740'):
    v=[]
    for k,l in by.items():
        if not k.startswith(gu): continue
        b=[amt(x) for x in l if ym(x) in base]; c=[amt(x) for x in l if ym(x) in rec]
        if b and c: v.append(math.log(S.median(c)/S.median(b)))
    print(gu,len(v),f'{math.expm1(S.median(v)):+.1%}')
print('\n(b) 신고가 반증 견고성: 칸 선행 3건↑·180일↑. 신고가 vs "선행 최고가에서 -2%~0% 사이였던 거래"(거의 최고가) 다음 거래')
for l in by.values(): l.sort(key=date)
hi=[];near=[];top_q=[]
for l in by.values():
    for i,r in enumerate(l):
        prev=[x for x in l[:i] if date(x)<date(r)]
        if len(prev)<3 or (date(r)-date(prev[0])).days<180: continue
        nxt=[x for x in l[i+1:] if date(x)>date(r)]
        if not nxt: continue
        m=max(amt(x) for x in prev); ch=amt(nxt[0])/amt(r)-1
        if amt(r)>m: hi.append((ch,(date(nxt[0])-date(r)).days))
        elif amt(r)>=0.98*m: near.append((ch,(date(nxt[0])-date(r)).days))
for lab,v in (('신고가',hi),('최고가 -2%~0%',near)):
    c=[a for a,_ in v]; print(lab,len(v),f'다음 거래 ≥ 이번 {sum(x>=0 for x in c)/len(c):.1%}',f'중앙 {S.median(c):+.1%}',f'간격 중앙 {S.median([d for _,d in v])}일')
# 다음 거래가 이전 최고가(신고가 이전의 최고)보다는 높은가
up=[]
for l in by.values():
    for i,r in enumerate(l):
        prev=[x for x in l[:i] if date(x)<date(r)]
        if len(prev)<3 or (date(r)-date(prev[0])).days<180: continue
        m=max(amt(x) for x in prev)
        if amt(r)<=m: continue
        nxt=[x for x in l[i+1:] if date(x)>date(r)]
        if nxt: up.append(amt(nxt[0])>m)
print('신고가 다음 거래가 그 이전 최고가는 넘은 비율', f'{sum(up)/len(up):.1%}')
