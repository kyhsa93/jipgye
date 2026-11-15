# 보류 규칙 재생: 각 원본 커밋을 한 수집 회차로 보고, 갱신 달(현재·전달, 1~3일은 전전달) 슬롯의 응답 = 그 회차까지의 최신 저장본.
# 규칙: 저장 >= 20행이고 (응답*2 < 저장 또는 저장-응답 >= N) 이면 보류. 보류 H 수집일(KST 날짜 기준) 뒤에도 걸리면 반영.
import pickle, collections, sys
D = pickle.load(open(sys.argv[1], 'rb')); C = D['commits']; V = D['versions']
def shift(ym, d):
    y, m = int(ym[:4]), int(ym[4:]); i = y*12 + m-1 + d; return f"{i//12}{i%12+1:02d}"
def refreshing(day, ym):
    cur = day[:4] + day[5:7]; ms = {cur, shift(cur, -1)}
    if int(day[8:10]) <= 3: ms.add(shift(cur, -2))
    return ym in ms
def run(N, H, kinds=('sale', 'rent'), half=True, verbose=False):
    trig = held_runs = forced = 0; delayed_rows = 0; delayed_rowdays = 0; maxdelay = 0; events = []; held = []
    for slot, vs in V.items():
        kind, rest = slot.split('/'); ym = rest[-6:]
        if kind not in kinds: continue
        byidx = {v[0]: v for v in vs}
        saved = None; cur = None; hold_days = []; first_seen = {}
        for idx, (h, day) in enumerate(C):
            if idx in byidx:
                cur = byidx[idx]
                if cur[3] is None: saved = None; cur = None; hold_days = []; continue
            if cur is None: continue
            if saved is None: saved = cur; continue
            if not (refreshing(day, ym) or idx in byidx): continue
            if cur is saved: continue
            s, r = saved[3], cur[3]
            t = s >= 20 and ((half and r*2 < s) or s - r >= N)
            newk = collections.Counter(cur[5]) - collections.Counter(saved[5])
            if t:
                if not hold_days: trig += 1; events.append((slot, day, s, r))
                if day not in hold_days: hold_days.append(day)
                if len(hold_days) <= H:
                    held_runs += 1; held.append((slot, idx))
                    for k in newk: first_seen.setdefault(k, day)
                    continue
                forced += 1
            # 반영
            for k in newk:
                if k in first_seen:
                    import datetime
                    dd = (datetime.date.fromisoformat(day) - datetime.date.fromisoformat(first_seen[k])).days
                    if dd > 0: delayed_rows += newk[k]; delayed_rowdays += dd*newk[k]; maxdelay = max(maxdelay, dd)
            first_seen = {}; hold_days = []; saved = cur
    return dict(N=N, H=H, triggers=trig, held_runs=held_runs, forced=forced, delayed_rows=delayed_rows, delayed_rowdays=delayed_rowdays, maxdelay=maxdelay, events=events, held=held)
if __name__ == '__main__':
    for kinds in (('sale', 'rent'), ('sale',)):
        for N in (2, 10, 20, 50, 125, 126, 166, 10**9):
            r = run(N, 3, kinds)
            print(kinds, {k: v for k, v in r.items() if k not in ('events', 'held')})
        print(' half only:', [ (e[0], e[1], e[2], e[3]) for e in run(10**9, 3, kinds)['events']])
    r = run(10, 3)
    print('N=10,H=3 events', r['events'])
    for H in (1, 2, 3, 4, 5):
        r = run(10, H); print('H', H, {k: v for k, v in r.items() if k not in ('events', 'held')})
