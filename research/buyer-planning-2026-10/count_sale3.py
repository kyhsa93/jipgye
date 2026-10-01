"""3차: 정책대출 가격선 아래 거래, 유사매매사례 표본, 2026-05-09 전후 주간, 매수 후보 가격 경계별 부대비용."""
import os, json, glob, collections as C, statistics as S, datetime as D
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows=[]
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows+=json.load(open(f))['items']
amt=lambda r:int(str(r['dealAmount']).replace(',',''))
date=lambda r:D.date(r['dealYear'],r['dealMonth'],r['dealDay'])
alive=[r for r in rows if r.get('cdealType')!='O']
market=[r for r in alive if r['dealingGbn']=='중개거래']
names={}
for r in rows: pass
recent=[r for r in market if D.date(2026,3,1)<=date(r)<=D.date(2026,8,31)]
print('## 정책대출 가격선 (2026-03~08 중개, n=%d)'%len(recent))
for lim in (50000,60000,90000):
    sub=[r for r in recent if amt(r)<=lim]; fam=[r for r in sub if r['excluUseAr']>=59]
    print(f'≤{lim//10000}억: {len(sub)} ({len(sub)/len(recent):.1%}), 그중 전용59㎡↑ {len(fam)} ({len(fam)/len(recent):.1%})')
    g=C.Counter(r['sggCd'] for r in fam)
    print('   59㎡↑ 상위 구', g.most_common(6), '0~9건인 구 수', sum(1 for k in {x['sggCd'] for x in recent} if g[k]<10))
print('\n## 유사매매사례: 대상(2026-06 계약) 하나마다 같은 단지·전용 ±5%·전 6개월 거래 수')
byc=C.defaultdict(list)
for r in market: byc[(r['sggCd'],r['aptNm'])].append(r)
ns=[]
for r in market:
    if not (D.date(2026,6,1)<=date(r)<=D.date(2026,6,30)): continue
    d0=date(r); a=r['excluUseAr']
    ns.append(sum(1 for x in byc[(r['sggCd'],r['aptNm'])] if x is not r and abs(x['excluUseAr']-a)<=0.05*a and d0-D.timedelta(days=183)<=date(x)<=d0))
print('대상',len(ns),'0건',f'{sum(n==0 for n in ns)/len(ns):.1%}','1건↑',f'{sum(n>=1 for n in ns)/len(ns):.1%}','3건↑',f'{sum(n>=3 for n in ns)/len(ns):.1%}')
print('\n## 2026-05-09(양도세 중과 유예 종료) 전후 주간 거래(해제 제외)')
wk=C.Counter()
for r in alive:
    d=date(r)
    if D.date(2026,3,30)<=d<D.date(2026,6,29): wk[d-D.timedelta(days=d.weekday())]+=1
for k in sorted(wk): print(k,wk[k])
print('\n## 매도자 법인·직거래 제외 효과: 법인 매도 중 중개거래', sum(1 for r in alive if r['slerGbn']=='법인' and r['dealingGbn']=='중개거래'))
