"""#21: KB 지수로 공식 지수 공백을 메우는 효과 - 공표일을 반영해서.
공표 일정(2026-10-01 확인): 한국부동산원 실거래가격지수는 매월 15일께 두 달 전 달을, KB 월간 지수는 그 달 말
(또는 다음 달 초)에 그 달을 낸다. 그래서 어느 달 M의
  1~14일: 공식은 M-3까지, KB는 M-1까지 → KB가 두 달 앞선다
  15일~: 공식은 M-2까지, KB는 M-1까지 → KB가 한 달 앞선다
오리진을 매달 5일·20일로 잡아, 그날 실제로 볼 수 있었던 것만으로 '공식 마지막 달 + 3개월'을 예측한다.
값은 최종본이다(고쳐지기 전 값은 없다) - 실거래가격지수는 고쳐지므로 이 결과도 실제보다 좋게 나온다.
저장소 루트에서: python3 research/kb-vintage/check.py
"""
import os, json, numpy as np
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
IDX = json.load(open(f'{REPO}/raw/ecos/apt-price-index.json'))['series']['200']
KB = dict(json.load(open(f'{REPO}/raw/indicators/series.json'))['series']['kb_sale'])
ymi = lambda m: int(m[:4]) * 12 + int(m[4:]) - 1
iym = lambda i: f"{i // 12}{i % 12 + 1:02d}"
P = {ymi(m): np.log(v) for m, v in IDX}
K = {ymi(m): np.log(v) for m, v in KB.items()}
months = sorted(P); lp = np.array([P[m] for m in months]); r = np.r_[np.nan, np.diff(lp)]
idx = {m: i for i, m in enumerate(months)}
def bf(i): return None if i < 6 else [1.0, r[i], r[i-1], np.mean(r[i-5:i-1])]
H = 3
def fit(i, kb_lead):
    """오리진 i(공식 마지막 달)에서 H달 뒤. kb_lead달 앞의 KB 변화를 입력으로(0이면 기준 모델)."""
    X, y = [], []
    for j in range(6, i - H + 1):
        f = bf(j)
        if kb_lead:
            m = months[j]
            if any(m + k not in K for k in range(0, kb_lead + 1)): continue
            f = f + [K[m + kb_lead] - K[m]]
        X.append(f); y.append(lp[j + H] - lp[j])
    if len(X) < 24: return None
    b = np.linalg.lstsq(np.array(X), np.array(y), rcond=None)[0]
    x = bf(i)
    if kb_lead:
        m = months[i]
        if any(m + k not in K for k in range(0, kb_lead + 1)): return None
        x = x + [K[m + kb_lead] - K[m]]
    return float(np.dot(x, b))
rows = []
for M in range(ymi('201205'), months[-1] + 3):
    for day in (5, 20):
        last = M - 3 if day < 15 else M - 2      # 그날 볼 수 있던 공식 마지막 달
        kb_last = M - 1                            # 그날 볼 수 있던 KB 마지막 달
        if last not in idx or idx[last] + H >= len(months): continue
        i = idx[last]
        lead = kb_last - last
        base = fit(i, 0); kb = fit(i, lead)
        if base is None or kb is None: continue
        actual = lp[i + H] - lp[i]
        rows.append((iym(M), day, lead, abs(actual - base) * 100, abs(actual - kb) * 100))
rows = np.array([(d, l, b, k) for _, d, l, b, k in rows])
for lab, sel in (('전체', rows[:, 0] > 0), ('1~14일(KB 두 달 앞)', rows[:, 0] < 15), ('15일~(KB 한 달 앞)', rows[:, 0] >= 15)):
    s = rows[sel]; print(f'{lab}: 오리진 {len(s)}, 기준 {s[:,2].mean():.2f}%p, +KB {s[:,3].mean():.2f}%p')
# 블록 부트스트랩(12개월 = 오리진 24개) - 전체
rng = np.random.default_rng(20261001); n = len(rows); wins = 0
for _ in range(1000):
    ix = []
    while len(ix) < n:
        st = rng.integers(0, n - 24 + 1); ix.extend(range(st, st + 24))
    ix = ix[:n]
    if rows[ix, 3].mean() < rows[ix, 2].mean(): wins += 1
print('부트스트랩(+KB가 기준보다 나은 비율)', wins / 1000)

# 조사 때의 형태(KB '앞선 달의 1개월 변화' 하나)로도 - 그 형태는 66번 검정 가운데 고른 것이라 다중검정 위험이 있다.
def fit1(i, kb_lead):
    X, y = [], []
    for j in range(6, i - H + 1):
        m = months[j]; f = bf(j)
        if kb_lead:
            if m + kb_lead not in K or m + kb_lead - 1 not in K: continue
            f = f + [K[m + kb_lead] - K[m + kb_lead - 1]]
        X.append(f); y.append(lp[j + H] - lp[j])
    if len(X) < 24: return None
    b = np.linalg.lstsq(np.array(X), np.array(y), rcond=None)[0]
    m = months[i]; x = bf(i)
    if kb_lead:
        if m + kb_lead not in K or m + kb_lead - 1 not in K: return None
        x = x + [K[m + kb_lead] - K[m + kb_lead - 1]]
    return float(np.dot(x, b))
rows2 = []
for M in range(ymi('201205'), months[-1] + 3):
    for day in (5, 20):
        last = M - 3 if day < 15 else M - 2
        if last not in idx or idx[last] + H >= len(months): continue
        i = idx[last]; lead = (M - 1) - last
        base = fit1(i, 0); kb = fit1(i, lead)
        if base is None or kb is None: continue
        a = lp[i + H] - lp[i]
        rows2.append((day, abs(a - base) * 100, abs(a - kb) * 100))
rows2 = np.array(rows2)
print('\n## 조사 때 형태(앞선 달 1개월 변화)')
for lab, sel in (('전체', rows2[:, 0] > 0), ('1~14일', rows2[:, 0] < 15), ('15일~', rows2[:, 0] >= 15)):
    s = rows2[sel]; print(f'{lab}: 오리진 {len(s)}, 기준 {s[:,1].mean():.2f}%p, +KB {s[:,2].mean():.2f}%p')
rng = np.random.default_rng(20261001); n = len(rows2); wins = 0
for _ in range(1000):
    ix = []
    while len(ix) < n:
        st = rng.integers(0, n - 24 + 1); ix.extend(range(st, st + 24))
    if rows2[ix[:n], 2].mean() < rows2[ix[:n], 1].mean(): wins += 1
print('부트스트랩', wins / 1000)

# 이슈 조건 둘째: 집계 원본으로 메운 달(nowcast)보다 나은가. 공식 지수가 아직 없는 달 하나를 메우는 정확도로 견준다.
# 겹치는 달: 우리 nowcast가 공식과 겹치는 달(docs/data/outlook.json의 overlap)과 같은 기간.
out = json.load(open(f'{REPO}/docs/data/outlook.json'))
seoul = next(r for r in out['regions'] if r['code'] == '200')
print('\n## 한 달 메우기: 공식 지수의 그 달 변화와의 평균 차이(%p)')
print('집계 원본(nowcast):', seoul['nowcast']['mae'], f"({seoul['nowcast']['overlap']}개월)")
ov = [m for m in months if m >= ymi('202510') and m - 1 in P and m in K and m - 1 in K]
gaps = [abs((K[m] - K[m - 1]) - (P[m] - P[m - 1])) * 100 for m in ov]
print('KB 같은 달 1개월 변화:', round(float(np.mean(gaps)), 2), f'({len(ov)}개월, {iym(ov[0])}~{iym(ov[-1])})')
