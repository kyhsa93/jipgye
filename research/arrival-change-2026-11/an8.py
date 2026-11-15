import json, statistics, sys, datetime
R=[json.loads(l) for l in open(sys.argv[1])]
mis=[(r['date'],k) for r in R for k in ('sale','jeonse','wolse') if r[k].get('recV') is not None and r[k]['v']!=r[k]['recV']]
print('value mismatches', len(mis), mis[:8])
for k in ('sale','jeonse','wolse'):
  for upto in ('2026-11-04','2026-11-15'):
   for exact in (False, True):
    xs=[r for r in R if r['date']<=upto and r['basis']=='arrival' and r.get('baseBasis') and 'chg' in r[k]]
    if exact: xs=[r for r in xs if r['base']==(datetime.date.fromisoformat(r['date'])-datetime.timedelta(days=7)).isoformat()]
    if not xs: continue
    a=[abs(r[k]['chg']) for r in xs]; hw=[(r[k]['hi']-r[k]['lo'])/2 for r in xs]
    ex=[r['date'] for r in xs if r[k]['lo']>0 or r[k]['hi']<0]
    print(k,'~'+upto,'exact7' if exact else 'findBaseline',len(xs),xs[0]['date'],'|d| med %.2f%%'%(statistics.median(a)*100),'max %.2f%%'%(max(a)*100),
          'halfwidth med ±%.2f%% (%.2f~%.2f)'%(statistics.median(hw)*100,min(hw)*100,max(hw)*100),'excl0 %d'%len(ex), ex if len(ex)<15 else '')
