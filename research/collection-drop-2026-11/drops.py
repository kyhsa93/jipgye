# 원본 슬롯 이력(raw/sale, raw/rent)에서 슬롯별 건수 감소 사건을 센다. 호출 0, git 읽기만.
import json, os, subprocess, sys, collections, pickle
# 저장소 루트는 이 파일 위치에서 정한다. 읽을 기준(ref)은 두 번째 인자: python3 drops.py <out.pkl> [ref, 기본 HEAD]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
REF = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
def git(*a): return subprocess.run(['git', '-C', REPO, *a], capture_output=True, check=True).stdout
commits = git('log', '--reverse', '--format=%H %s', REF, '--', 'raw/sale', 'raw/rent').decode().splitlines()
commits = [(l.split()[0], l.split()[-1]) for l in commits]
# 각 커밋 시점 각 슬롯의 내용(바뀐 파일만 읽는다)
VOLATILE = ('rgstDate', 'cdealType', 'cdealDay', 'aptDong')
def ident(it):
    return json.dumps({k: v for k, v in it.items() if k not in VOLATILE}, sort_keys=True, ensure_ascii=False)
versions = collections.defaultdict(list)  # slot -> [(idx, day, observedAt, count, totalCount, items)]
prev = None
for idx, (h, day) in enumerate(commits):
    if prev is None:
        out = git('ls-tree', '-r', '--name-only', h, '--', 'raw/sale', 'raw/rent').decode().split()
        changed = [('A', p) for p in out]
    else:
        out = git('diff', '--name-status', '--no-renames', prev, h, '--', 'raw/sale', 'raw/rent').decode().splitlines()
        changed = [tuple(l.split('\t')) for l in out]
    for st, p in changed:
        slot = p.split('/', 1)[1][:-5]
        if st == 'D':
            versions[slot].append((idx, day, None, None, None, None)); continue
        d = json.loads(git('show', f'{h}:{p}'))
        versions[slot].append((idx, day, d.get('observedAt'), d.get('count'), d.get('totalCount'), [ident(i) for i in d.get('items', [])], d.get('items', [])))
    prev = h
pickle.dump({'commits': commits, 'versions': dict(versions)}, open(sys.argv[1], 'wb'))
print(len(commits), 'commits', len(versions), 'slots', sum(len(v) for v in versions.values()), 'versions')
