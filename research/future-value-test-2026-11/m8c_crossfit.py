"""M8c 사후 점검: W0 거래를 둘로 나눠 변수와 y 기준값이 같은 표본 잡음을 공유하지 않게(V1·V3·V4·V5). W1 n>=1 생존 민감도. 판정을 바꾸지 않는다. 재현: SNAP=... python3 m8c_crossfit.py"""
from common import *
s=load_sale_all(); m=market(s); r=load_rent_all(); r=r[(r.rent==0)&r.date.notna()&(r.deposit_>0)]
dx=district_index()
win=lambda d,a,b:d[(d.month>=a)&(d.month<=b)]
W0=('202504','202509');W1=('202604','202609');Wm=('202412','202503')
w0=add_cells(win(m,*W0)); w0['adj']=adj_district(w0,dx,W0[1]); w0['pm']=w0.adj/w0.area
names=w0.groupby('key').cellarea.apply(lambda x:sorted(set(x))).to_dict()
def att(df):
    o=[]
    for k,a in zip(df.key.values,df.area.values):
        best=None
        for nm in names.get(k,()):
            if abs(nm-a)<1 and (best is None or abs(nm-a)<abs(best-a)): best=nm
        o.append(best)
    return np.array(o,dtype=float)
w1=win(m,*W1).copy(); w1['cellarea']=att(w1); w1=w1[w1.cellarea.notna()]; w1['adj']=adj_district(w1,dx,W1[1])
wm=win(m,*Wm).copy(); wm['cellarea']=att(wm); wm=wm[wm.cellarea.notna()]; wm['adj']=adj_district(wm,dx,Wm[1])
rj=win(r,*W0).copy(); rj['cellarea']=att(rj); rj=rj[rj.cellarea.notna()]
lq=win(m,'202412','202509').copy(); lq['cellarea']=att(lq); lq=lq[lq.cellarea.notna()]
K=['key','cellarea']
m1=w1.groupby(K).adj.agg(['size','median']); mm=wm.groupby(K).adj.agg(['size','median']); mj=rj.groupby(K).deposit_.agg(['size','median']); L=lq.groupby(K).size()
meta=w0.groupby(K).agg(sgg=('sgg','first'),by=('by','first'))
g0={k:v[['adj','pm']].values for k,v in w0.groupby(K)}
n0=w0.groupby(K).size()
def wr(a,b,g):
    a=np.asarray(a,float);b=np.asarray(b,float)
    g=np.asarray(g)
    return spearman(a-pd.Series(a).groupby(g).transform('mean').values,b-pd.Series(b).groupby(g).transform('mean').values)
rng=np.random.default_rng(20261103)
cells=[k for k in g0 if n0[k]>=6 and k in m1.index and m1.loc[k,'size']>=3]
print('교차 적합 표본: W0 n>=6 ∧ W1 n>=3 칸',len(cells))
ab=lambda a:'a' if a<60 else 'b' if a<=85 else 'c'
res={v:[] for v in ['V1','V2','V3','V4','V5']}
ns={}
for it in range(40):
    rows=[]
    for k in cells:
        v=g0[k]; p=rng.permutation(len(v)); h=len(v)//2
        A=v[p[:h]];B=v[p[h:]]
        rows.append(dict(key=k[0],area=k[1],sgg=meta.loc[k,'sgg'],by=meta.loc[k,'by'],ma=np.median(A[:,0]),mb=np.median(B[:,0]),pa=np.median(A[:,1]),m1=m1.loc[k,'median'],
                         mm=mm.loc[k,'median'] if k in mm.index and mm.loc[k,'size']>=3 else np.nan,
                         mj=mj.loc[k,'median'] if k in mj.index and mj.loc[k,'size']>=3 else np.nan,L=L.get(k,0)))
    d=pd.DataFrame(rows); d['y']=np.log(d.m1/d.mb); d['ab']=d.area.map(ab); d['dec']=d.by//10
    d['V1']=d.mj/d.ma; d['V2']=d.L.astype(float); d['V3']=np.log(d.ma/d.mm); d['peer']=d.groupby(['sgg','ab','dec']).pa.transform('median'); d['V4']=-np.log(d.pa/d.peer); d['V5']=np.log(d.pa)
    for v in res:
        x=d[d[v].notna()]; res[v].append(wr(x[v],x.y,x.sgg)); ns[v]=len(x)
for v in res: print(f' {v}: 구내 ρ 평균 {np.mean(res[v]):+.3f} (40회 범위 {min(res[v]):+.3f}~{max(res[v]):+.3f}) n {ns[v]}')
print('=== 생존 민감도(V2): W1 표본 문턱을 바꿔서 (W0 n>=3 칸 기준)')
base=pd.DataFrame({'n0':n0,'m0':w0.groupby(K).adj.median()}).join(meta); base=base[base.n0>=3]
base['n1']=m1['size'].reindex(base.index).fillna(0); base['m1']=m1['median'].reindex(base.index); base['V2']=L.reindex(base.index).fillna(0).astype(float)
print(' W0 n>=3 칸',len(base),' W1 건수 0:',int((base.n1==0).sum()),' 1~2:',int(((base.n1>0)&(base.n1<3)).sum()),' 3↑:',int((base.n1>=3).sum()))
print(' V2 분위별 W1 탈락(n1<3) 비율:',base.assign(q=pd.qcut(base.V2,5,labels=False,duplicates='drop'),drop=base.n1<3).groupby('q').drop.mean().round(3).to_dict())
for th in [1,2,3,5]:
    x=base[base.n1>=th]; print(f' W1 n>={th}: 칸 {len(x)} 구내 ρ(V2,y) {wr(x.V2,np.log(x.m1/x.m0),x.sgg):+.3f}')
