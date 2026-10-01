"""#28: 해제 기록 가운데 정정 재신고(같은 계약이 해제 없이 다시 신고된 것)가 얼마인가, 그리고 우연이 아닌가.
저장소 루트에서: python3 research/correction-twins/check.py
"""
import os, json, glob, collections as C
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
rows = []
for f in sorted(glob.glob(f'{REPO}/raw/sale/*.json')): rows += json.load(open(f))['items']
canc = lambda it: bool(str(it.get('cdealType') or '').strip() or str(it.get('cdealDay') or '').strip())
key = lambda it: (it['sggCd'], it['umdNm'], str(it['jibun']), it['aptNm'], it['excluUseAr'], it.get('floor'), it['dealYear'], it['dealMonth'], it['dealDay'], it['dealAmount'])
groups = C.defaultdict(list)
for it in rows: groups[key(it)].append(it)
cancelled = [it for it in rows if canc(it)]
twins = [it for it in cancelled if any(not canc(x) for x in groups[key(it)])]
live = [it for it in rows if not canc(it)]
dup_live = sum(1 for g in groups.values() if sum(1 for x in g if not canc(x)) >= 2)
print(f'해제 기록 {len(cancelled)}건 중 같은 계약의 정상 기록을 가진 것 {len(twins)}건 ({len(twins)/len(cancelled):.1%})')
print(f'비교: 정상 기록끼리 완전히 같은 계약 {dup_live}건 ({dup_live/len(live):.2%})')
old = [it for it in twins if (it['dealYear'], it['dealMonth']) <= (2026, 3)]
reg = sum(1 for it in old if any(not canc(x) and str(x.get('rgstDate') or '').strip() for x in groups[key(it)]))
print(f'2026-03 이전 계약의 정정 {len(old)}건 중 짝이 등기까지 간 것 {reg}건 ({reg/len(old):.1%})')
