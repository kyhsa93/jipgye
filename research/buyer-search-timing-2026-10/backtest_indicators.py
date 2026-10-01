"""각 지표가 '지난 가격만 쓰는 모델'(scripts/outlook.mjs와 같은 직접 회귀) 위에
3·6개월 뒤 서울 실거래가격지수(ECOS 901Y089) 변화를 더 잘 맞히는지.

- 기준 모델: [1, r_t, r_{t-1}, mean(r_{t-2..t-5})] → log P_{t+h} - log P_t, OLS.
- 추가 모델: 기준 모델 + 지표 feature(들). 같은 오리진에서 기준 모델과 견준다.
- 2012-01부터 매달 확장 창으로 다시 풀고(롤링 오리진), 학습은 j + h <= t 만.
- 지표 값은 오리진 달 t까지만(LAG=0) 쓴다. 공표가 가격지수보다 빠른 지표는 t+1까지 쓴 변형(LAG=1)을 따로 적는다.
- 12개월 블록 부트스트랩 1,000회로 '추가 모델 MAE < 기준 모델 MAE' 비율.
REPO만 바꾸면 저장소 밖에서도 돈다.
"""
import json, os, sys
import numpy as np

REPO = os.environ.get("REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, "cache", "series.json")))
IDX = json.load(open(os.path.join(REPO, "raw/ecos/apt-price-index.json")))["series"]

def ymi(ym): return int(ym[:4]) * 12 + int(ym[4:]) - 1
def iym(i): return f"{i // 12}{i % 12 + 1:02d}"

price = {ymi(m): np.log(v) for m, v in IDX[os.environ.get("REGION", "200")]}
P0, P1 = min(price), max(price)
months = list(range(P0, P1 + 1))
lp = np.array([price[m] for m in months])
r = np.diff(lp, prepend=np.nan)

def series(name):
    return {ymi(m): v for m, v in S[name]}

def base_feat(i):
    if i < 6: return None
    return [1.0, r[i], r[i - 1], np.mean(r[i - 5:i - 1])]

# ---- 지표 feature 정의: 미리 정한 것만(결과 보고 고르지 않는다) ----
def make(name, fn, lag=0):
    return (name, fn, lag)

def logs(name):
    d = series(name); return {k: np.log(v) for k, v in d.items() if v > 0}

vol = logs("vol_seoul"); vol = {k: v for k, v in vol.items() if k >= ymi("200602")}
kbs, kbj = logs("kb_sale"), logs("kb_jeonse")
base_rate, mort, ktb = series("base_rate"), series("mortgage_rate"), series("ktb3")
unsold = logs("unsold_seoul"); csi = series("csi_house_seoul")
jr = series("jratio_seoul"); sd = series("supply_demand_seoul")

def avg(d, t, n):
    vals = [d.get(t - k) for k in range(n)]
    return None if any(v is None for v in vals) else float(np.mean(vals))

def f_vol_norm(t):  # 최근 3개월 거래량 평균 / 직전 24개월 평균 (로그)
    a, b = avg(vol, t, 3), avg(vol, t - 3, 24)
    return None if a is None or b is None else [a - b]
def f_vol_yoy(t):  # 3개월 평균 거래량 전년 대비(로그)
    a, b = avg(vol, t, 3), avg(vol, t - 12, 3)
    return None if a is None or b is None else [a - b]
def f_jr_kb(t):  # KB 전세/매매 지수 비(로그) — 수준
    return None if t not in kbs or t not in kbj else [kbj[t] - kbs[t]]
def f_jr_kb_chg(t):  # 그 비의 12개월 변화
    if any(x not in kbs or x not in kbj for x in (t, t - 12)): return None
    return [(kbj[t] - kbs[t]) - (kbj[t - 12] - kbs[t - 12])]
def f_jeonse3(t):  # KB 전세 3개월 상승률
    return None if t not in kbj or t - 3 not in kbj else [kbj[t] - kbj[t - 3]]
def f_jr_rone(t):  # 한국부동산원 평균 매매가격 대비 전세가격(%) — 수준
    return None if t not in jr else [jr[t]]
def f_base12(t):
    return None if t not in base_rate or t - 12 not in base_rate else [base_rate[t] - base_rate[t - 12]]
def f_mort12(t):
    return None if t not in mort or t - 12 not in mort else [mort[t] - mort[t - 12]]
def f_mort_lvl(t):
    return None if t not in mort else [mort[t]]
def f_ktb12(t):
    return None if t not in ktb or t - 12 not in ktb else [ktb[t] - ktb[t - 12]]
def f_unsold(t):
    return None if t not in unsold else [unsold[t]]
def f_unsold_yoy(t):
    return None if t not in unsold or t - 12 not in unsold else [unsold[t] - unsold[t - 12]]
def f_csi(t):
    return None if t not in csi else [csi[t]]
def f_sd(t):
    return None if t not in sd else [sd[t]]
def f_kb3(t):  # KB 매매 3개월 상승률 (다른 조사, 같은 시장)
    return None if t not in kbs or t - 3 not in kbs else [kbs[t] - kbs[t - 3]]
def f_kb1(t):
    return None if t not in kbs or t - 1 not in kbs else [kbs[t] - kbs[t - 1]]

def f_month(t):  # 계절: 오리진 달의 월 더미 11개
    m = (t % 12); return [1.0 if m == k else 0.0 for k in range(1, 12)]

CANDS = [
    ("거래량: 3개월/직전24개월", f_vol_norm, [0, 1]),
    ("거래량: 3개월 전년비", f_vol_yoy, [0, 1]),
    ("전세가율(KB 지수비) 수준", f_jr_kb, [0, 1]),
    ("전세가율(KB 지수비) 12개월 변화", f_jr_kb_chg, [0, 1]),
    ("KB 전세 3개월 상승률", f_jeonse3, [0, 1]),
    ("전세가율(부동산원, 2012~) 수준", f_jr_rone, [0, 1]),
    ("기준금리 12개월 변화", f_base12, [0, 1]),
    ("주담대 금리 12개월 변화", f_mort12, [0, 1]),
    ("주담대 금리 수준", f_mort_lvl, [0, 1]),
    ("국고채3년 12개월 변화", f_ktb12, [0, 1]),
    ("서울 미분양(로그) 수준", f_unsold, [0]),
    ("서울 미분양 전년비", f_unsold_yoy, [0]),
    ("주택가격전망CSI 서울(2013~)", f_csi, [0, 1]),
    ("매매수급지수 서울(2012.07~)", f_sd, [0, 1]),
    ("KB 매매 3개월 상승률", f_kb3, [0, 1]),
    ("KB 매매 1개월 상승률", f_kb1, [0, 1, 2]),
    ("계절(오리진 달 월 더미)", f_month, [0]),
]

def run(h, fn, lag, start="201201", min_train=24):
    """returns list of (origin, err_base, err_aug, err_naive, err_drift)"""
    out = []
    n = len(months)
    for i in range(n):
        t = months[i]
        if t < ymi(start) or i + h >= n: continue
        xb = base_feat(i)
        if xb is None: continue
        xa = fn(t + lag) if fn else []
        if xa is None: continue
        Xb, Xa, y = [], [], []
        for j in range(6, i - h + 1):
            fb = base_feat(j)
            fa = fn(months[j] + lag) if fn else []
            # 학습: j+h <= i 이고, 지표의 lag 달도 오리진 시점에 이미 있어야 한다(j+lag <= i+lag 자동 성립)
            yy = lp[j + h] - lp[j]
            Xb.append(fb)
            if fa is not None:
                Xa.append(fb + fa); y.append((len(Xb) - 1, yy))
        yb = np.array([lp[j + h] - lp[j] for j in range(6, i - h + 1)])
        Xb = np.array(Xb)
        if len(Xa) < max(min_train, len(Xa[0]) * 4 if Xa else 0): continue
        bb, *_ = np.linalg.lstsq(Xb, yb, rcond=None)
        ya = np.array([v for _, v in y]); Xa = np.array(Xa)
        ba, *_ = np.linalg.lstsq(Xa, ya, rcond=None)
        # 같은 학습 창(지표가 있는 달만)으로 푼 기준 모델도 같이
        Xbw = Xa[:, :4]
        bw, *_ = np.linalg.lstsq(Xbw, ya, rcond=None)
        actual = (lp[i + h] - lp[i]) * 100
        pb = np.dot(xb, bb) * 100
        pa = np.dot(xb + xa, ba) * 100
        pw = np.dot(xb, bw) * 100
        drift = h * np.nanmean(r[1:i + 1]) * 100
        out.append((t, actual - pb, actual - pa, actual, actual - drift, actual - pw))
    return out

def boot(rows, a, b, rounds=1000, block=12, seed=20261001):
    rng = np.random.default_rng(seed)
    ea = np.abs(np.array([x[a] for x in rows])); eb = np.abs(np.array([x[b] for x in rows]))
    n = len(rows); wins = 0
    for _ in range(rounds):
        idx = []
        while len(idx) < n:
            s = rng.integers(0, n - block + 1); idx.extend(range(s, s + block))
        idx = idx[:n]
        if ea[idx].mean() < eb[idx].mean(): wins += 1
    return wins / rounds

if __name__ == "__main__":
    print("REGION", os.environ.get("REGION", "200"), "price", iym(P0), "~", iym(P1))
    for h in (3, 6):
        base = run(h, None, 0)
        mb = np.mean([abs(x[1]) for x in base]); mn = np.mean([abs(x[3]) for x in base]); md = np.mean([abs(x[4]) for x in base])
        print(f"\n=== h={h}  기준 모델 MAE {mb:.2f}%p  그대로다 {mn:.2f}  늘오른다 {md:.2f}  오리진 {len(base)} ({iym(base[0][0])}~{iym(base[-1][0])})")
        print("지표 | lag | 오리진 | 첫 오리진 | 기준MAE | +지표MAE | 개선%p | 같은창기준MAE | 부트(추가<기준) | 부트(추가<같은창기준)")
        for name, fn, lags in CANDS:
            for lag in lags:
                rows = run(h, fn, lag)
                if len(rows) < 36:
                    print(f"{name} | {lag} | {len(rows)} | 오리진 부족"); continue
                b_ = np.mean([abs(x[1]) for x in rows]); a_ = np.mean([abs(x[2]) for x in rows]); w_ = np.mean([abs(x[5]) for x in rows])
                print(f"{name} | {lag} | {len(rows)} | {iym(rows[0][0])} | {b_:.2f} | {a_:.2f} | {b_-a_:+.2f} | {w_:.2f} | {boot(rows,2,1):.2f} | {boot(rows,2,5):.2f}")
