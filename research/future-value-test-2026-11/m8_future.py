"""M8 미래가치 순위상관(사전 등록 D). 재현: SNAP=... python3 m8_future.py"""
from common import *
from scipy.stats import rankdata
s=load_sale_all(); m=market(s); r=load_rent_all(); r=r[(r.rent==0)&r.date.notna()&(r.deposit_>0)]
dx=district_index(long=False); ec=region_index()
assert all(dx[k].get('202609') for k in NAMES)
print('시장 배경 (같은 입력): ECOS 서울 202412',ec['200']['202412'],'202509',ec['200']['202509'],'202608',ec['200']['202608'],' 로그변화 202412→202509',round(np.log(ec['200']['202509']/ec['200']['202412'])*100,2),'202509→202608',round(np.log(ec['200']['202608']/ec['200']['202509'])*100,2))
rs=[np.log(ec['200'][b]/ec['200'][a])*100 for a,b in zip(sorted(k for k in ec['200'] if '202412'<=k<'202608'),sorted(k for k in ec['200'] if '202412'<k<='202608'))]
print('이 창 안 ECOS 서울 월 변화: 상승 달',sum(x>0 for x in rs),'/',len(rs),'최저',round(min(rs),2))
SPLITS={'S1':dict(T='202509',Wm=('202412','202503'),W0=('202504','202509'),W1=('202604','202609'),base='202412'),
        'S2':dict(T='202506',Wm=('202412','202502'),W0=('202503','202506'),W1=('202603','202606'),base='202412')}
def win(df,a,b): return df[(df.month>=a)&(df.month<=b)]
def attach_area(df,names):
    out=[]
    for k,a in zip(df.key.values,df.area.values):
        best=None
        for nm in names.get(k,()):
            if abs(nm-a)<1 and (best is None or abs(nm-a)<abs(best-a)): best=nm
        out.append(best)
    return np.array(out,dtype=float)
def build(sp):
    w0=add_cells(win(m,*sp['W0']))
    names=w0.groupby('key').cellarea.apply(lambda x:sorted(set(x))).to_dict()
    def adjm(df,end):
        return adj_district(df,dx,end)
    w0['adj']=adjm(w0,sp['W0'][1])
    g=w0.groupby(['key','cellarea'])
    t=pd.DataFrame({'sgg':g.sgg.first(),'by':g.by.first(),'n0':g.size(),'m0':g.adj.median(),'perm2':g.apply(lambda x:np.median(x.adj/x.area),include_groups=False)}).reset_index()
    def tally(df,end,prefix,adjust=True,val='amount'):
        df=df.copy(); df['cellarea']=attach_area(df,names); df=df[df.cellarea.notna()]
        df['v']=adj_district(df,dx,end) if adjust else df[val].values
        a=df.groupby(['key','cellarea']).v.agg(['size','median']).rename(columns={'size':'n'+prefix,'median':'m'+prefix}).reset_index()
        return t.merge(a,on=['key','cellarea'],how='left')
    t=tally(win(m,*sp['W1']),sp['W1'][1],'1')
    t=tally(win(m,*sp['Wm']),sp['Wm'][1],'m')
    rr=win(r,*sp['W0']).rename(columns={'deposit_':'dep'})
    t=tally(rr,sp['W0'][1],'j',adjust=False,val='dep')
    # 유동성: 202412~T
    lq=win(m,'202412',sp['T']).copy(); lq['cellarea']=attach_area(lq,names); lq=lq[lq.cellarea.notna()]
    t=t.merge(lq.groupby(['key','cellarea']).size().rename('liq').reset_index(),on=['key','cellarea'],how='left')
    t['ab']=np.where(t.cellarea<60,'a',np.where(t.cellarea<=85,'b','c')); t['decade']=t.by//10
    w0n3=t[t.n0>=3]
    peers=w0n3.groupby(['sgg','ab','decade']).perm2.median().rename('peer').reset_index()
    t=t.merge(peers,on=['sgg','ab','decade'],how='left')
    t['V1']=np.where(t.nj>=3,t.mj/t.m0,np.nan)
    t['V2']=t.liq.astype(float)
    t['V3']=np.where(t.nm>=3,np.log(t.m0/t.mm),np.nan)
    t['V4']=-np.log(t.perm2/t.peer)
    t['V5']=np.log(t.perm2)
    t['V6']=2025-t.by
    t['B0']=[np.log(dx[g][sp['T']]/dx[g][sp['base']]) for g in t.sgg]
    t['B1']=[np.log(dx[g][sp['W1'][1]]/dx[g][sp['T']]) for g in t.sgg]
    c=t[(t.n0>=3)&(t.n1>=3)].copy()
    c['y']=np.log(c.m1/c.m0)
    p=lambda x:pd.Series(x).rank(pct=True).values
    ok=c.V1.notna()
    c['B']=np.nan
    cc=c[ok]
    c.loc[ok,'B']=(30*p(cc.V4)+15*p(cc.B0)+15*p(cc.V1)+20*p(cc.V2))/80
    return c,t
def within_rho(a,b,g):
    a=np.asarray(a,float);b=np.asarray(b,float)
    da=a-pd.Series(a).groupby(g).transform('mean').values
    db=b-pd.Series(b).groupby(g).transform('mean').values
    return spearman(da,db)
rng=np.random.default_rng(20261103)
VARS=['V1','V2','V3','V4','B','V5','V6']
results={}
def run(name,sp,verdict=True):
    c,t=build(sp)
    print(f'\n===== {name}: T={sp["T"]} W-1={sp["Wm"]} W0={sp["W0"]} W1={sp["W1"]}  W0 n>=3 칸 {int((t.n0>=3).sum())} → W1 n>=3 남은 칸 {len(c)} 단지 {c.key.nunique()} 구 {c.sgg.nunique()}')
    print('y(로그변화 %) 중앙',round(c.y.median()*100,2),'P10',round(c.y.quantile(.1)*100,2),'P90',round(c.y.quantile(.9)*100,2),' y>0 비율',f'{(c.y>0).mean():.1%}')
    print('기준선 B0 ρ',round(spearman(c.B0,c.y),3),' 참고 오라클 B1 ρ(미래 본 값, 판정 불사용)',round(spearman(c.B1,c.y),3),' 구 간 설명분(구 더미 R²)',round(1-((c.y-c.groupby('sgg').y.transform('mean'))**2).sum()/((c.y-c.y.mean())**2).sum(),3))
    gu=c.groupby('sgg').agg(y=('y','median'),b0=('B0','first'),b1=('B1','first'),n=('y','size'))
    print('구 단위(25구): ρ(B0,구 y 중앙)',round(spearman(gu.b0,gu.y),3),' ρ(B1,구 y 중앙)',round(spearman(gu.b1,gu.y),3),'구 칸 수 최소',int(gu.n.min()),'중앙',int(gu.n.median()))
    # 잡음 천장
    w0,w1=win(m,*sp['W0']),win(m,*sp['W1'])
    rows=[]
    big=c[(c.n0>=6)&(c.n1>=6)]
    wc0=add_cells(w0); names=wc0.groupby('key').cellarea.apply(lambda x:sorted(set(x))).to_dict()
    w1=w1.copy(); w1['cellarea']=attach_area(w1,names); wc1=w1[w1.cellarea.notna()]
    wc0['v']=adj_district(wc0,dx,sp['W0'][1]); wc1=wc1.assign(v=adj_district(wc1,dx,sp['W1'][1]))
    v0={k:v.v.values for k,v in wc0.groupby(['key','cellarea'])}; v1={k:v.v.values for k,v in wc1.groupby(['key','cellarea'])}
    bk=list(zip(big.key,big.cellarea)); ra=[];rw=[]
    gs=big.sgg.values
    for it in range(50):
        ya=[];yb=[]
        for k in bk:
            a=rng.permutation(v0[k]);b=rng.permutation(v1[k]);h0=len(a)//2;h1=len(b)//2
            ya.append(np.log(np.median(b[:h1])/np.median(a[:h0])));yb.append(np.log(np.median(b[h1:])/np.median(a[h0:])))
        ra.append(spearman(ya,yb)); rw.append(within_rho(ya,yb,gs))
    print(f'잡음 천장(W0·W1 각 n>=6 칸 {len(bk)}): 반분 y 상관 전체 {np.mean(ra):.3f}, 구 내 {np.mean(rw):.3f} (반분이라 실제 신뢰도보다 낮게 나옴)')
    out={}
    for v in VARS:
        q=c[c[v].notna()].reset_index(drop=True)
        rho=spearman(q[v],q.y); rb=spearman(q.B0,q.y); rw=within_rho(q[v],q.y,q.sgg)
        # 군집
        byk=[idx.values for _,idx in q.groupby('key').groups.items()] if False else [np.array(i) for i in q.groupby('key').indices.values()]
        byg=[np.array(i) for i in q.groupby('sgg').indices.values()]
        def boot(groups,B=1000):
            d=[];w=[]
            for _ in range(B):
                pick=rng.integers(0,len(groups),len(groups)); idx=np.concatenate([groups[i] for i in pick])
                x=q.iloc[idx]; d.append(spearman(x[v],x.y)-spearman(x.B0,x.y))
                w.append(within_rho(x[v].values,x.y.values,x.sgg.values))
            return np.array(d),np.array(w)
        dk,wk=boot(byk); dg,_=boot(byg,1000)
        p1k=np.mean(dk>0);p1g=np.mean(dg>0)
        lo,hi=np.quantile(wk,[.025,.975])
        # P3
        sg=[]
        for g,x in q.groupby('sgg'):
            if len(x)>=20: sg.append(spearman(x[v],x.y)>0)
        p3=np.mean(sg) if sg else float('nan')
        # P5
        pr=q.groupby('sgg')[v].rank(pct=True); yd=q.y-q.groupby('sgg').y.transform('mean')
        spread=(yd[pr>=.8].mean()-yd[pr<=.2].mean())*100
        # 가격대·n 민감도
        bands=[]
        for lo_,hi_ in [(0,150000),(150000,250000),(250000,1e12)]:
            x=q[(q.m0>=lo_)&(q.m0<hi_)]
            bands.append((len(x),round(within_rho(x[v].values,x.y.values,x.sgg.values),3) if len(x)>30 else None))
        x=q[(q.n0>=5)&(q.n1>=5)]; r5=(len(x),round(within_rho(x[v].values,x.y.values,x.sgg.values),3))
        out[v]=dict(n=len(q),rho=rho,rb=rb,rw=rw,p1k=p1k,p1g=p1g,lo=lo,hi=hi,p3=p3,ng=len(sg),spread=spread,bands=bands,r5=r5)
        print(f'{v}: n {len(q)} ρ {rho:+.3f} B0 ρ(같은 표본) {rb:+.3f} | P1 단지군집 {p1k:.3f} 구군집 {p1g:.3f} | 구내 ρ {rw:+.3f} [{lo:+.3f},{hi:+.3f}] | 구 부호 {p3:.0%} of {len(sg)} | 상하위 20% 차 {spread:+.2f}%p | 가격대 <15억·15~25억·25억↑ {bands} | n>=5 {r5}')
    return out,c
r1,c1=run('S1',SPLITS['S1'])
r2,c2=run('S2',SPLITS['S2'])
print('\n===== 판정 (사전 등록, 항목 V1~V4·합성 B)')
for v in ['V1','V2','V3','V4','B']:
    a=r1[v];b=r2[v]
    P=dict(P1=(a['p1k']>=.975 and a['p1g']>=.975),P2=(a['rw']>=.10 and a['lo']>0),P3=(a['p3']>=.70),P4=(b['rw']>0),P5=(a['spread']>=1.0))
    print(v,P,'→','통과' if all(P.values()) else '미달')
print('참고 변수(점수 항목 후보 아님):')
for v in ['V5','V6']:
    a=r1[v];b=r2[v]
    P=dict(P1=(a['p1k']>=.975 and a['p1g']>=.975),P2=(a['rw']>=.10 and a['lo']>0),P3=(a['p3']>=.70),P4=(b['rw']>0),P5=(a['spread']>=1.0))
    print(v,P)
# 구 수준 탐색(판정 불사용): 입주·금리
print('\n입주물량: raw/move-in 은 2026-06-30 기준 스냅숏 1개, 서울 2026-07~2028-06 만 있어 T=2025 시점 값이 없다 → 못 잼. 금리: 횡단 변이 없음 → 칸 순위 시험 불가, 못 잼.')
c1.to_pickle(os.path.join(CACHE,'m8_s1.pkl'))
