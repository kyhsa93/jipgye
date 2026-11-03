"""공통 로더. 입력은 snapshot.sh 로 꺼낸 cef5ab55 트리. 저장소에 쓰지 않는다.
SNAP 환경변수 필수. 정규화 표는 CACHE 에 pickle (재생성 가능)."""
import os, json, glob, re, pickle, sys
import numpy as np, pandas as pd
SNAP=os.environ['SNAP']; CACHE=os.environ.get('CACHE', os.path.join(SNAP,'cache')); os.makedirs(CACHE,exist_ok=True)
ASOF=pd.Timestamp('2026-11-02')
REGIONS={'210':['11110','11140','11170'],'220':['11200','11215','11230','11260','11290','11305','11320','11350'],'240':['11380','11410','11440'],'250':['11470','11500','11530','11545','11560','11590','11620'],'230':['11650','11680','11710','11740']}
REGION_OF={c:r for r,cs in REGIONS.items() for c in cs}
NAMES={'11110':'종로','11140':'중구','11170':'용산','11200':'성동','11215':'광진','11230':'동대문','11260':'중랑','11290':'성북','11305':'강북','11320':'도봉','11350':'노원','11380':'은평','11410':'서대문','11440':'마포','11470':'양천','11500':'강서','11530':'구로','11545':'금천','11560':'영등포','11590':'동작','11620':'관악','11650':'서초','11680':'강남','11710':'송파','11740':'강동'}
def _amount(s): return pd.to_numeric(pd.Series(s).astype(str).str.replace(',','').str.strip(),errors='coerce')
def load_sale_all():
    p=os.path.join(CACHE,'sale_all.pkl')
    if os.path.exists(p): return pd.read_pickle(p)
    rows=[]
    for f in sorted(glob.glob(os.path.join(SNAP,'raw/sale/*.json'))):
        d=json.load(open(f)); slot=os.path.basename(f)[:-5]
        for it in d['items']:
            r=dict(it); r['_slot']=slot; rows.append(r)
    df=pd.DataFrame(rows)
    df['sgg']=df.sggCd.astype(str); df['umd']=df.umdNm.astype(str).str.strip(); df['jibun_']=df.jibun.fillna('').astype(str).str.strip(); df['apt']=df.aptNm.fillna('').astype(str).str.strip()
    df['amount']=_amount(df.dealAmount).values
    df['area']=pd.to_numeric(df.excluUseAr,errors='coerce').round(2)
    df['date']=pd.to_datetime(dict(year=df.dealYear,month=df.dealMonth,day=df.dealDay),errors='coerce')
    df['month']=df.dealYear.astype(int).astype(str)+df.dealMonth.astype(int).astype(str).str.zfill(2)
    df['by']=pd.to_numeric(df.buildYear,errors='coerce'); df.loc[~(df.by>1900),'by']=np.nan
    df['cancel']=df.cdealType.fillna('').astype(str).str.strip()!=''
    df['direct']=df.dealingGbn.fillna('').astype(str).str.strip()=='직거래'
    df['floor_']=pd.to_numeric(df.floor,errors='coerce')
    df['key']=df.sgg+'|'+df.umd+'|'+df.jibun_+'|'+df.apt
    df['site']=df.sgg+'|'+df.umd+'|'+df.jibun_
    df['namekey']=df.sgg+'|'+df.apt
    df.to_pickle(p); return df
def market(df):
    return df[(~df.cancel)&(~df.direct)&(df.amount>0)&(df.area>0)&df.date.notna()&(df.apt!='')].copy()
def load_rent_all():
    p=os.path.join(CACHE,'rent_all.pkl')
    if os.path.exists(p): return pd.read_pickle(p)
    rows=[]
    cols=['aptNm','aptSeq','buildYear','contractType','dealDay','dealMonth','dealYear','deposit','excluUseAr','floor','jibun','monthlyRent','sggCd','umdNm']
    for f in sorted(glob.glob(os.path.join(SNAP,'raw/rent/*.json'))):
        for it in json.load(open(f))['items']:
            rows.append({k:it.get(k) for k in cols})
    df=pd.DataFrame(rows)
    df['sgg']=df.sggCd.astype(str); df['umd']=df.umdNm.astype(str).str.strip(); df['jibun_']=df.jibun.fillna('').astype(str).str.strip(); df['apt']=df.aptNm.fillna('').astype(str).str.strip()
    df['deposit_']=_amount(df.deposit).values; df['rent']=_amount(df.monthlyRent).values
    df['area']=pd.to_numeric(df.excluUseAr,errors='coerce').round(2)
    df['date']=pd.to_datetime(dict(year=df.dealYear,month=df.dealMonth,day=df.dealDay),errors='coerce')
    df['month']=df.dealYear.astype(int).astype(str)+df.dealMonth.astype(int).astype(str).str.zfill(2)
    df['key']=df.sgg+'|'+df.umd+'|'+df.jibun_+'|'+df.apt
    df.to_pickle(p); return df
def area_groups(areas):
    """scripts/complex-price.ts areaGroups 와 같은 규칙: 작은 것부터, 묶음 첫 면적에서 1㎡ 미만이면 같은 묶음, 이름은 최다(같으면 작은 쪽)."""
    vc=pd.Series(areas).value_counts(); srt=sorted(vc.index); label={}; group=[]
    def close():
        if not group: return
        name=sorted(group,key=lambda a:(-vc[a],a))[0]
        for a in group: label[a]=name
    for a in srt:
        if group and a-group[0]>=1: close(); group=[]
        group.append(a)
    close(); return label
def add_cells(df,keycol='key'):
    out=df.copy(); out['cellarea']=np.nan
    res=[]
    for k,g in out.groupby(keycol,sort=False):
        lab=area_groups(g.area.values); res.append(g.area.map(lab))
    out['cellarea']=pd.concat(res).reindex(out.index)
    out['cell']=out[keycol]+'#'+out.cellarea.map(lambda x:f'{x:g}')
    return out
def region_index():
    d=json.load(open(os.path.join(SNAP,'raw/ecos/apt-price-index.json')))['series']
    return {k:dict((m,float(v)) for m,v in rows) for k,rows in d.items()}
def district_index(long=False):
    here=os.path.dirname(os.path.abspath(__file__))
    f=os.path.join(here,'data/rone-districts-long.json') if long else os.path.join(SNAP,'raw/indicators/rone-districts.json')
    d=json.load(open(f))['series']
    return {k:dict((m,float(v)) for m,v in rows) for k,rows in d.items()}
def adj_region(df,idx,ref):
    r=df.sgg.map(REGION_OF)
    a=[idx.get(x,{}).get(m,np.nan) for x,m in zip(r,df.month)]
    b=[idx.get(x,{}).get(ref,np.nan) for x in r]
    f=np.array(b,float)/np.array(a,float)
    f[np.isnan(f)]=1.0
    return df.amount.values*f
def adj_district(df,idx,ref):
    a=[idx.get(x,{}).get(m,np.nan) for x,m in zip(df.sgg,df.month)]
    b=[idx.get(x,{}).get(ref,np.nan) for x in df.sgg]
    f=np.array(b,float)/np.array(a,float)
    f[np.isnan(f)]=1.0
    return df.amount.values*f
def spearman(a,b):
    from scipy.stats import rankdata
    ra=rankdata(a); rb=rankdata(b)
    ra=ra-ra.mean(); rb=rb-rb.mean()
    d=np.sqrt((ra*ra).sum()*(rb*rb).sum())
    return float((ra*rb).sum()/d) if d>0 else float('nan')
