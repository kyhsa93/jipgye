"""backtest_indicators.py에서 부트스트랩 0.9를 넘은 것(주담대 금리 수준, KB 1개월 lag2, 계절)과
거래량을 다시 흔든다: ① 기간을 반으로 나눠 ② 5개 권역에 그대로 ③ 계수 부호가 시간에 따라 유지되나
④ 거래량은 학습을 2009년부터로 잘라서도."""
import os, json, numpy as np, importlib.util, sys
HERE = os.path.dirname(os.path.abspath(__file__))
def load(region):
    os.environ["REGION"] = region
    spec = importlib.util.spec_from_file_location("bt" + region, os.path.join(HERE, "backtest_indicators.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m

TESTS = [("주담대 금리 수준", "f_mort_lvl", 1), ("주담대 금리 수준", "f_mort_lvl", 0),
         ("KB 매매 1개월 lag2", "f_kb1", 2), ("계절", "f_month", 0),
         ("전세가율 12개월 변화", "f_jr_kb_chg", 0),
         ("거래량 전년비", "f_vol_yoy", 0), ("거래량 3/24", "f_vol_norm", 0)]
for region, rname in [("200","서울"),("210","도심"),("220","동북"),("240","서북"),("250","서남"),("230","동남")]:
    m = load(region)
    for h in (3, 6):
        for name, fn, lag in TESTS:
            rows = m.run(h, getattr(m, fn), lag)
            def mae(rs, k): return np.mean([abs(x[k]) for x in rs])
            first = [x for x in rows if x[0] < m.ymi("201901")]; second = [x for x in rows if x[0] >= m.ymi("201901")]
            print(f"{rname} h={h} {name} lag{lag}: 전체 {mae(rows,1):.2f}->{mae(rows,2):.2f} 부트 {m.boot(rows,2,1):.2f} | 2012~18 {mae(first,1):.2f}->{mae(first,2):.2f} | 2019~ {mae(second,1):.2f}->{mae(second,2):.2f} | 그대로다 {mae(rows,3):.2f} 늘오른다 {mae(rows,4):.2f}")
