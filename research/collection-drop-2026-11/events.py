# 감소 사건 표: 직전 저장 대비 count가 준 모든 버전. 신원 = 등기일·해제 칸·aptDong을 뺀 행. 빠진 행이 뒤에 돌아왔는지, 같은 해시로 돌아왔는지.
import pickle, collections, sys
D = pickle.load(open(sys.argv[1], 'rb')); commits = D['commits']; V = D['versions']
rows = []
for slot, vs in V.items():
    vs = [v for v in vs]
    for i in range(1, len(vs)):
        a, b = vs[i-1], vs[i]
        if a[3] is None or b[3] is None: continue
        if b[3] >= a[3]: continue
        ma, mb = collections.Counter(a[5]), collections.Counter(b[5])
        missing = ma - mb
        nmiss = sum(missing.values())
        hashes_a = collections.Counter(map(lambda it: __import__('json').dumps(it, sort_keys=True, ensure_ascii=False), a[6]))
        # 뒤 버전에서 돌아왔나
        ret_idx = None; same_hash = None
        for j in range(i+1, len(vs)):
            c = vs[j]
            if c[3] is None: break
            mc = collections.Counter(c[5])
            back = sum((missing & mc).values())
            if nmiss and back >= 0.9 * nmiss:
                ret_idx = j
                hc = collections.Counter(map(lambda it: __import__('json').dumps(it, sort_keys=True, ensure_ascii=False), c[6]))
                # 빠진 행 중 원래 해시 그대로 돌아온 수
                miss_hash = hashes_a - collections.Counter(map(lambda it: __import__('json').dumps(it, sort_keys=True, ensure_ascii=False), b[6]))
                same_hash = sum((miss_hash & hc).values())
                break
        rows.append(dict(slot=slot, day=commits[b[0]][1], prev_day=commits[a[0]][1], old=a[3], new=b[3], tc=b[4], drop=a[3]-b[3], nmiss=nmiss,
                         ret_day=commits[vs[ret_idx][0]][1] if ret_idx else None, ret_runs=(vs[ret_idx][0]-b[0]) if ret_idx else None,
                         same_hash=same_hash, tc_ok=(b[4]==b[3])))
pickle.dump(rows, open(sys.argv[2], 'wb'))
print(len(rows), 'drop events')
for r in sorted(rows, key=lambda r: -r['drop'])[:40]:
    print(r['slot'], r['prev_day'], '->', r['day'], f"{r['old']}->{r['new']}", 'drop', r['drop'], 'miss', r['nmiss'], 'tc', r['tc'], 'ret', r['ret_day'], r['ret_runs'], 'samehash', r['same_hash'])
