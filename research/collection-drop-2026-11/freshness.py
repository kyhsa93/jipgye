# 보류(N=10, H=3)가 수집 신선도(scripts/source-age.ts readRawSources)를 바꾸는가. 호출 0, drops.py 의 pickle 만 읽는다.
# source-age 는 종류별로 「가장 최근 달」 슬롯 파일들의 observedAt 중 최신을 본다. 보류한 회차는 슬롯을 쓰지 않으므로 그 슬롯의 observedAt 이 멈춘다.
# 각 원본 커밋(= 수집 회차)마다 실제 이력과 보류 재생의 최신 observedAt(KST 날짜)을 견주고, 다음 회차 직전 경과일(STALE_DAYS = 2 와 비교)을 적는다.
# 사용: python3 freshness.py <drops.pkl>
import datetime, sys
sys.argv = [sys.argv[0], sys.argv[1]]
import sim  # sim.py 가 같은 pickle 을 읽는다

C, V = sim.C, sim.V
STALE_DAYS = 2
held = set(sim.run(10, 3)['held'])

def kst(iso):
    t = datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')) + datetime.timedelta(hours=9)
    return t.date().isoformat()

# 슬롯별 회차마다 보이는 observedAt 의 KST 날짜(실제, 보류). 삭제된 슬롯은 None.
shown = {}
for slot, vs in V.items():
    byidx = {v[0]: v for v in vs}
    ym = slot[-6:]
    act = hold = None; behind = False
    seq = []
    for idx, (h, day) in enumerate(C):
        v = byidx.get(idx)
        if v is not None:
            if v[3] is None:
                act = hold = None; behind = False
            else:
                act = kst(v[2])
                if (slot, idx) in held: behind = True
                else: hold = act; behind = False
        elif behind and (slot, idx) not in held and sim.refreshing(day, ym):
            # 보류가 풀리는 회차에 새 판이 없으면 그 회차 시각으로 쓴다
            hold = day; behind = False
        seq.append((act, hold))
    shown[slot] = seq

rows = []
for idx, (h, day) in enumerate(C):
    nxt = C[idx + 1][1] if idx + 1 < len(C) else None
    for kind in ('sale', 'rent'):
        live = [s for s in shown if s.startswith(kind + '/') and shown[s][idx][0] is not None]
        if not live: continue
        latest = max(s[-6:] for s in live)
        cur = [shown[s][idx] for s in live if s.endswith(latest)]
        a = max(x[0] for x in cur); b = max(x[1] for x in cur if x[1] is not None)
        age = lambda d: (datetime.date.fromisoformat(nxt) - datetime.date.fromisoformat(d)).days if nxt else None
        heldnow = sorted(s for (s, i) in held if i == idx and s.startswith(kind + '/'))
        rows.append((day, kind, latest, a, b, age(a), age(b), heldnow))

diff = [r for r in rows if r[3] != r[4]]
print('회차', len(C), '· 보류한 (슬롯, 회차)', len(held))
per_day = {}
for (s, i) in held: per_day.setdefault(C[i][1], set()).add(s)
print('같은 날 보류한 슬롯 수 최대', max(len(v) for v in per_day.values()), {d: sorted(v) for d, v in sorted(per_day.items())})
print('보류가 가장 최근 달 최신 observedAt 을 바꾼 회차', len(diff))
for r in diff: print(' ', r)
stale_a = [r for r in rows if r[5] is not None and r[5] >= STALE_DAYS]
stale_b = [r for r in rows if r[6] is not None and r[6] >= STALE_DAYS]
print('다음 회차 직전 경과 >= %d일: 실제 %d회 · 보류 %d회' % (STALE_DAYS, len(stale_a), len(stale_b)))
print('  보류에서만 낡음:', [r[:3] for r in stale_b if r not in stale_a])
for r in rows:
    if r[7]: print('  보류 회차', r[0], r[1], '최근 달', r[2], '최신 실제/보류', r[3], r[4], '보류 슬롯', r[7])
