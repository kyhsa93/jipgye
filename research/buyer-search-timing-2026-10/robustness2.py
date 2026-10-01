"""① 주담대 금리 수준의 개선이 2022~23 금리 급등 한 번에서 나오나 ② 거래량은 가격 모멘텀 없이 혼자서는
'그대로다'를 이기나(정보가 없는 건지, 이미 가격에 들어 있는 건지) ③ 거래량 학습을 2009년부터로 잘라도 해치나."""
import os, importlib.util, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ["REGION"] = "200"
spec = importlib.util.spec_from_file_location("bt", os.path.join(HERE, "backtest_indicators.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ymi, iym = m.ymi, m.iym
mae = lambda rs, k: np.mean([abs(x[k]) for x in rs])

for h in (3, 6):
    rows = m.run(h, m.f_mort_lvl, 1)
    ex = [x for x in rows if not (ymi("202110") <= x[0] <= ymi("202312"))]
    print(f"h={h} 주담대 수준 lag1: 전체 {mae(rows,1):.2f}->{mae(rows,2):.2f} | 2021-10~2023-12 오리진 뺌 n={len(ex)} {mae(ex,1):.2f}->{mae(ex,2):.2f} 부트 {m.boot(ex,2,1):.2f}")
    # 개선이 어디서 났나: 오리진 연도별 |기준|-|추가|
    by = {}
    for x in rows: by.setdefault(iym(x[0])[:4], []).append(abs(x[1]) - abs(x[2]))
    print("   연도별 개선합(%p·월):", " ".join(f"{y}:{sum(v):+.1f}" for y, v in sorted(by.items())))

# ② 거래량만 쓰는 모델 vs 그대로다 vs 모멘텀만
def run_alone(h, feat, start="201201", train_from=None):
    out = []; lp, months = m.lp, m.months
    for i in range(len(months)):
        t = months[i]
        if t < ymi(start) or i + h >= len(months): continue
        x = feat(i)
        if x is None: continue
        X, y = [], []
        for j in range(6, i - h + 1):
            if train_from and months[j] < ymi(train_from): continue
            f = feat(j)
            if f is None: continue
            X.append(f); y.append(lp[j + h] - lp[j])
        if len(X) < 24: continue
        b, *_ = np.linalg.lstsq(np.array(X), np.array(y), rcond=None)
        act = (lp[i + h] - lp[i]) * 100
        out.append((t, act - np.dot(x, b) * 100, act))
    return out
vol_only = lambda i: (lambda v: None if v is None else [1.0] + v)(m.f_vol_yoy(m.months[i]))
mom_only = lambda i: m.base_feat(i)
for h in (3, 6):
    a = run_alone(h, vol_only); b = run_alone(h, mom_only)
    common = sorted(set(x[0] for x in a) & set(x[0] for x in b))
    A = [x for x in a if x[0] in common]; B = [x for x in b if x[0] in common]
    print(f"h={h} 거래량만 {np.mean([abs(x[1]) for x in A]):.2f} / 가격 모멘텀만 {np.mean([abs(x[1]) for x in B]):.2f} / 그대로다 {np.mean([abs(x[2]) for x in A]):.2f}  (n={len(common)})")
    # 학습을 2009년부터로
    both = lambda i: (lambda v, bf: None if v is None or bf is None else bf + v)(m.f_vol_yoy(m.months[i]), m.base_feat(i))
    c = run_alone(h, both, train_from="200901"); d = run_alone(h, mom_only, train_from="200901")
    common = sorted(set(x[0] for x in c) & set(x[0] for x in d))
    C = [x for x in c if x[0] in common]; D = [x for x in d if x[0] in common]
    print(f"   학습 2009~: 모멘텀 {np.mean([abs(x[1]) for x in D]):.2f} → +거래량 {np.mean([abs(x[1]) for x in C]):.2f}")
# 동시 상관: 거래량 전년비 vs 같은 시기 가격 변화, vs 다음 3개월 가격 변화
xs, same, nxt, past = [], [], [], []
for i in range(12, len(m.months) - 3):
    v = m.f_vol_yoy(m.months[i])
    if v is None or m.months[i] < ymi("200702"): continue
    xs.append(v[0]); same.append(m.lp[i] - m.lp[i - 3]); nxt.append(m.lp[i + 3] - m.lp[i])
print("corr(거래량 전년비, 지난 3개월 가격)", round(np.corrcoef(xs, same)[0, 1], 2), " corr(거래량 전년비, 다음 3개월 가격)", round(np.corrcoef(xs, nxt)[0, 1], 2), " corr(지난3개월, 다음3개월)", round(np.corrcoef(same, nxt)[0, 1], 2))
