"""반복거래 가격대별 N6 - 이슈 #170, 사전 기준 research/repeat-sales-2026-10/DESIGN.md 5-2절(개정 3).

이 스크립트는 DESIGN 5-2의 ①~⑦과 ③의 고정 입력을 그대로 옮긴 것이다. 기준을 바꾸려면 DESIGN에 새 버전을
계산 전에 먼저 병합한다(5-2 ⑧) - 이 파일에서 임의로 바꾸지 않는다.
쌍 만들기(해제 제거·중개거래·창·집 키·면적 묶음·층·간격·이상치)는 count_repeat.py·repeat_index_v0.py의 함수를 그대로 쓴다.

입력은 --root 디렉터리의 raw/sale/*.json 과 --n4 의 segment-change.json 이다(네트워크 없음).
--root 는 5-2 ③의 입력 커밋을 꺼낸 디렉터리여야 한다(HEAD·raw/ 깨끗함·raw/sale 트리 해시 검증):

    git worktree add --detach <dir> 39c2481150a68f8862af5b0745889084da232c8b
    python3 -I repeat_bands_n6.py --root <dir> > <결과 파일>

표준 출력이 그대로 결과 파일이다. 시각·환경에 따라 바뀌는 값은 찍지 않는다(같은 입력이면 같은 바이트).
"""
import argparse
import collections
import importlib.util
import json
import math
import os
import random
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cr = _load('count_repeat')
ri = _load('repeat_index_v0')

# 5-2 ③
INPUT_COMMIT = ri.INPUT_COMMIT
RAW_SALE_TREE = '0578a78dc2647aa967adbb309045eb50a430b7e9'
EXPECTED_SEOUL_PAIRS = 6324  # repeat_index_v0.out 2절(이상치 제외 뒤 서울 쌍 수)
BOOT_SEED = 1
JITTER_SEED = 2

# 5-2 ②
BAND_THRESHOLD = cr.GU_THRESHOLD  # 91
MIN_BANDS = 3
BAND_NAMES = ('낮은 쪽', '가운데', '높은 쪽')

# 5-2 ⑥
GAP_SPREAD_MAX = 90  # 일. 최대 - 최소 >= 90 이면 「차이」 문장 삭제

# 5-2 ⑦ (N4 가격대 5구간, 경계 만원, lo < a <= hi)
N4_BANDS = (('upTo6', 0, 60000), ('upTo9', 60000, 90000), ('upTo15', 90000, 150000),
            ('upTo25', 150000, 250000), ('over25', 250000, math.inf))
N4_FILE = os.path.join(HERE, '..', '..', 'docs', 'data', 'segment-change.json')

FORBIDDEN = ri.FORBIDDEN

# 쌍마다 앞 거래가(만원 정수)를 더 가진다. ri 의 통계 함수는 .log 만 읽는다.
Pair = collections.namedtuple('Pair', 'log gap front')


class SumMismatch(ValueError):
    pass


# ---------------------------------------------------------------- 쌍

def pair_units(houses):
    """집 키 오름차순으로 [(집 쌍 목록(이상치 제외 뒤, 비지 않은 것))...], 제외 전 쌍 수, 제외 쌍 수. 서울 전체."""
    units = []
    before = excluded = 0
    for _key, lst in houses:
        recs = []
        for a, b in zip(lst, lst[1:]):
            gap = (b.day - a.day).days
            if cr.GAP_MIN <= gap <= cr.GAP_MAX:
                recs.append(Pair(math.log(b.amount / a.amount), gap, a.amount))
        if not recs:
            continue
        before += len(recs)
        kept = [p for p in recs if not ri.is_outlier(p)]
        excluded += len(recs) - len(kept)
        if kept:
            units.append(kept)
    return units, before, excluded


def boundaries(fronts):
    """① B1 = x(ceil(N/3)), B2 = x(ceil(2N/3)) (1부터 센 오름차순, 보간 없음)."""
    n = len(fronts)
    if n == 0:
        raise ValueError('쌍이 없다')
    s = sorted(fronts)
    return s[-(-n // 3) - 1], s[-(-2 * n // 3) - 1]


def band_of(front, b1, b2):
    """① 낮은 쪽 <= B1 < 가운데 <= B2 < 높은 쪽."""
    return 0 if front <= b1 else (1 if front <= b2 else 2)


def split_bands(units, b1, b2):
    """가격대별 [집 단위(그 가격대 쌍만) ...]. 한 집이 두 가격대에 있을 수 있다."""
    bands = [[], [], []]
    for house in units:
        per = [[], [], []]
        for p in house:
            per[band_of(p.front, b1, b2)].append(p)
        for k in range(3):
            if per[k]:
                bands[k].append(per[k])
    return bands


# ---------------------------------------------------------------- 대조 규칙

def overlaps(a, b):
    """⑤ 구간이 겹치지 않을 때만 차이를 적는다. 끝점이 같으면 겹친 것."""
    return not (a['hi'] < b['lo'] or b['hi'] < a['lo'])


def diff_verdicts(stats):
    """낮은–가운데, 가운데–높은, 낮은–높은. 각각 (i, j, 말할 수 있나, 방향 부호 = 높은 쪽 - 낮은 쪽)."""
    out = []
    for i, j in ((0, 1), (1, 2), (0, 2)):
        ok = not overlaps(stats[i], stats[j])
        out.append((i, j, ok, ri.sign(stats[j]['median'] - stats[i]['median'])))
    return out


def n4_band_of(price):
    for idx, (_k, lo, hi) in enumerate(N4_BANDS):
        if lo < price <= hi:
            return idx
    raise ValueError(f'N4 가격대 밖: {price}')


def load_n4(path):
    with open(path, encoding='utf-8') as fh:
        d = json.load(fh)
    by_key = {r['key']: r['change'] for r in d['price']}
    return [by_key[k] for k, _lo, _hi in N4_BANDS]


def n4_check(stats, fronts_by_band, n4_changes):
    """⑦ 반환: dict(map, pairs=[(i, j, 비교가능, n6부호, n4부호, 일치)], comparable, agree, show)."""
    mapped = [n4_band_of(statistics.median(f)) for f in fronts_by_band]
    pairs = []
    for i, j in ((0, 1), (1, 2), (0, 2)):
        if mapped[i] == mapped[j]:
            pairs.append((i, j, False, None, None, False))
            continue
        s6 = ri.sign(stats[j]['median'] - stats[i]['median'])
        s4 = ri.sign(n4_changes[mapped[j]] - n4_changes[mapped[i]])
        pairs.append((i, j, True, s6, s4, s6 != 0 and s6 == s4))
    comparable = sum(1 for p in pairs if p[2])
    agree = sum(1 for p in pairs if p[5])
    return {'map': mapped, 'pairs': pairs, 'comparable': comparable, 'agree': agree,
            'show': comparable >= 2 and agree >= 2}


# ---------------------------------------------------------------- 계산

def compute(rows, expect_pairs=EXPECTED_SEOUL_PAIRS):
    houses = cr.build_houses(cr.to_trades(rows))
    units, before, excluded = pair_units(houses)
    fronts = [p.front for h in units for p in h]
    n_total = len(fronts)
    b1, b2 = boundaries(fronts)
    bands = split_bands(units, b1, b2)
    sizes = [sum(len(h) for h in b) for b in bands]
    if expect_pairs is not None and sum(sizes) != expect_pairs:
        raise SumMismatch(f'가격대별 쌍 수의 합 {sum(sizes)} 이(가) 기대 {expect_pairs}와 다르다 - 입력·코드 오류, 값을 내지 않는다(5-2 ③)')

    rnd = random.Random()
    rnd.seed(BOOT_SEED)  # ③: 가격대 반복 직전에 한 번
    stats = []
    for k in range(3):
        u = bands[k]
        allp = [p for h in u for p in h]
        if not u:
            raise SumMismatch(f'{BAND_NAMES[k]} 가격대에 쌍이 없다')
        lo, hi = ri.boot_interval(u, rnd)
        stats.append({'n': len(allp), 'houses': len(u), 'median': ri.logs_median(u), 'lo': lo, 'hi': hi, 'width': hi - lo,
                      'gap_median': statistics.median(p.gap for p in allp),
                      'front_min': min(p.front for p in allp), 'front_max': max(p.front for p in allp),
                      'front_median': statistics.median(p.front for p in allp),
                      'qualified': len(allp) >= BAND_THRESHOLD})

    rng = random.Random(JITTER_SEED)  # F: 가격대 순·회차 순
    for k in range(3):
        s = stats[k]
        s['jitter'] = None
        s['shaky'] = False
        if s['qualified']:
            s['jitter'] = ri.jitter_range(bands[k], rng)
            s['shaky'] = s['jitter'] > s['width']
    return {'b1': b1, 'b2': b2, 'n_total': n_total, 'before': before, 'excluded': excluded, 'stats': stats,
            'fronts_by_band': [[p.front for h in b for p in h] for b in bands]}


def judge(res, n4_changes):
    stats = res['stats']
    published = [k for k in range(3) if stats[k]['qualified'] and not stats[k]['shaky']]
    table_public = len(published) >= MIN_BANDS
    verdicts = diff_verdicts(stats)
    gaps = [s['gap_median'] for s in stats]
    gap_spread = max(gaps) - min(gaps)
    drop_diff = gap_spread >= GAP_SPREAD_MAX
    n4 = n4_check(stats, res['fronts_by_band'], n4_changes) if n4_changes is not None else None
    return {'published': published, 'table_public': table_public, 'verdicts': verdicts, 'gap_spread': gap_spread,
            'drop_diff': drop_diff, 'n4': n4}


# ---------------------------------------------------------------- 출력

_f = ri._f
_pct = ri._pct


def header(root, pinned, n4_path):
    head, dirty = cr.pin_state(root)
    n4_blob = cr.blob_hash(n4_path) if n4_path and os.path.isfile(n4_path) else '(없음)'
    return ['# 반복거래 가격대별 N6 (이슈 #170, research/repeat-sales-2026-10/DESIGN.md 5-2절 개정 3)',
            '## 0. 머리 기록',
            f'입력 루트 git HEAD: {head or "(git 아님)"}  (고정 {INPUT_COMMIT}) 고정 검증: {"통과" if pinned else "생략(--allow-unpinned)"}',
            f'raw/ 미커밋 변경: {"없음" if dirty == "" else (dirty if dirty is not None else "(확인 못 함)")}',
            f'git rev-parse HEAD:raw/sale: {cr._git(root, "rev-parse", "HEAD:raw/sale") or "(확인 못 함)"} (고정 {RAW_SALE_TREE})',
            f'스크립트 blob: {cr.blob_hash(os.path.abspath(__file__))}, count_repeat.py blob: {cr.blob_hash(os.path.join(HERE, "count_repeat.py"))}, '
            f'repeat_index_v0.py blob: {cr.blob_hash(os.path.join(HERE, "repeat_index_v0.py"))}',
            f'N4 segment-change.json blob: {n4_blob}',
            f'raw/sale 파일 {len(cr.input_files(root, "sale"))}개',
            f'창: 계약월 {cr.WINDOW[0]}~{cr.WINDOW[1]}, 간격 {cr.GAP_MIN}~{cr.GAP_MAX}일, 이상치 |ln|>ln2, 가격대 문턱 {BAND_THRESHOLD}쌍, '
            f'공개 최소 가격대 수 {MIN_BANDS}, 부트스트랩 {ri.BOOT_N}회 seed {BOOT_SEED}, '
            f'흔들림 {int(ri.JITTER_DROP * 100)}%x{ri.JITTER_N}회 seed {JITTER_SEED}, 간격 폭 기준 {GAP_SPREAD_MAX}일']


def render(res, j):
    stats = res['stats']
    L = ['', '## 1. 가격대 경계 (5-2 ①) - 앞 거래가 기준, 만원',
         f'이상치 제외 뒤 서울 쌍 {res["n_total"]} (제외 전 {res["before"]}, 이상치 제외 {res["excluded"]})',
         f'B1 = {res["b1"]}, B2 = {res["b2"]} (낮은 쪽 <= B1 < 가운데 <= B2 < 높은 쪽)',
         f'가격대별 쌍 수 합 = {sum(s["n"] for s in stats)}',
         '', '## 2. 가격대별 값 (로그 척도 값과 expm1 %; 구간 = boots[20]~boots[379])',
         '가격대 | 쌍 n | 집 | 앞 거래가 최소 | 앞 거래가 최대 | 앞 거래가 중앙값 | 중앙값 | % | 구간 하한 | 구간 상한 | 구간 % | 폭 | '
         '간격 중앙값(일) | 흔들림 폭 | 표시']
    for k, s in enumerate(stats):
        marks = []
        if not s['qualified']:
            marks.append(f'쌍이 모자람({s["n"]}쌍) - 값 비움')
        if s['shaky']:
            marks.append('흔들림 - 값 비움')
        L.append(' | '.join([
            BAND_NAMES[k], str(s['n']), str(s['houses']), str(s['front_min']), str(s['front_max']), f'{s["front_median"]:g}',
            _f(s['median']), _pct(s['median']), _f(s['lo']), _f(s['hi']), f'{_pct(s["lo"])}~{_pct(s["hi"])}', _f(s['width']),
            f'{s["gap_median"]:g}', _f(s['jitter']), ', '.join(marks)]))
    L += ['', '## 3. 가격대 사이 차이 (5-2 ⑤: 90% 구간이 겹치지 않을 때만 말할 수 있다)']
    for i, jj, ok, d in j['verdicts']:
        word = '말할 수 있음' if ok else '말할 수 없음(구간이 겹침)'
        L.append(f'{BAND_NAMES[i]}-{BAND_NAMES[jj]}: {word}'
                 + (f', 높은 쪽 가격대 값이 {"더 큼" if d > 0 else "더 작음"}' if ok and d else ''))
    gap_text = ', '.join('%g' % s['gap_median'] for s in stats)
    L += ['', '## 4. 점검 (DESIGN 5-2)',
          f'② 쌍 수 >= {BAND_THRESHOLD}인 가격대: {sum(1 for s in stats if s["qualified"])}곳 / 3',
          f'⑥ F 흔들림 가격대: {", ".join(BAND_NAMES[k] for k in range(3) if stats[k]["shaky"]) or "없음"}',
          f'② 공개된 가격대 {len(j["published"])}곳 -> {"3곳, 표 공개 가능" if j["table_public"] else "3곳 미만 - 표 보류"}',
          f'⑥ E 간격 중앙값 {gap_text}일, 최대-최소 = {j["gap_spread"]:g}일 -> '
          f'{"가격대 사이 「차이」 문장 삭제(>= 90일)" if j["drop_diff"] else "문장 유지(< 90일)"}']
    n4 = j['n4']
    L += ['', '## 5. N4(#676) 대조 (5-2 ⑦)']
    if n4 is None:
        L.append('N4 산출이 없어 대조를 하지 못했다(N4 병합 뒤에 한다). 그때까지 표는 접힌 채.')
    else:
        L.append('대응(가격대 쌍의 앞 거래가 중앙값이 속하는 N4 가격대): ' + ', '.join(
            f'{BAND_NAMES[k]}({res["stats"][k]["front_median"]:g}만원) -> {N4_BANDS[n4["map"][k]][0]}' for k in range(3)))
        for i, jj, comp, s6, s4, hit in n4['pairs']:
            if not comp:
                L.append(f'{BAND_NAMES[i]}-{BAND_NAMES[jj]}: 같은 N4 가격대에 걸려 비교하지 않음')
            else:
                L.append(f'{BAND_NAMES[i]}-{BAND_NAMES[jj]}: N6 부호 {s6:+d}, N4 부호 {s4:+d} -> {"일치" if hit else "불일치"}')
        L.append(f'비교 가능 {n4["comparable"]}쌍, 일치 {n4["agree"]}쌍 -> {"표시" if n4["show"] else "접음"}')
    L += ['', '## 6. 판정',
          f'② 가격대 문턱·공개 최소 가격대 수: {"통과" if j["table_public"] else "미달 - 표 보류"}',
          f'⑤ 차이 문장: ' + ', '.join(f'{BAND_NAMES[i]}-{BAND_NAMES[jj]} {"가능" if ok and not j["drop_diff"] else "불가"}'
                                      for i, jj, ok, _d in j['verdicts']),
          f'⑥ E: {"문장 삭제" if j["drop_diff"] else "유지"}, F: {"흔들림 있음" if any(s["shaky"] for s in stats) else "흔들림 없음"}',
          f'⑦ N4 대조: {"대조 안 함" if n4 is None else ("표시" if n4["show"] else "접음")}',
          '단서(DESIGN 0장·5-1 ⑥·5-2 ⑧): 사전 등록 순서 위반 하의 #70 통과, 15개월 겹침, 알려진 노출 1건. '
          '앞 거래가 분포와 가격대별 값은 이 실행 전에 공개된 적이 없다. 서울 전체 한 값은 repeat_index_v0.out에 이미 있었다.',
          '일치·통과는 「지수가 맞다」는 증거가 아니다.']
    return L


def check_forbidden(text):
    hits = [w for w in FORBIDDEN if w in text]
    if hits:
        raise ValueError(f'금지어가 출력에 있다: {hits}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', required=True, help='5-2 ③ 입력 커밋을 꺼낸 디렉터리. 기본값 없음')
    ap.add_argument('--n4', default=N4_FILE, help='N4 segment-change.json (기본: 저장소 docs/data). 없으면 대조를 하지 않는다')
    ap.add_argument('--allow-unpinned', action='store_true', help='고정 검증·쌍 수 합 검증 생략(시험용). 머리에 표시된다')
    ap.add_argument('--expect-pairs', type=int, default=None, help='시험용(--allow-unpinned와 함께): 쌍 수 합 기대값')
    a = ap.parse_args(argv)
    root = a.root
    if not os.path.isdir(os.path.join(root, 'raw', 'sale')):
        ap.error(f'{root}/raw/sale 이 없다')
    pinned = False
    expect = a.expect_pairs
    if not a.allow_unpinned:
        head, dirty = cr.pin_state(root)
        if head != INPUT_COMMIT:
            ap.error(f'--root의 git HEAD가 {INPUT_COMMIT}이 아니다(HEAD={head})')
        if dirty != '':
            ap.error('--root의 raw/에 미커밋 변경이 있거나 상태를 확인 못 했다')
        tree = cr._git(root, 'rev-parse', 'HEAD:raw/sale')
        if tree != RAW_SALE_TREE:
            ap.error(f'HEAD:raw/sale 트리 해시가 {RAW_SALE_TREE}이 아니다({tree})')
        pinned = True
        expect = EXPECTED_SEOUL_PAIRS
    n4_changes = load_n4(a.n4) if os.path.isfile(a.n4) else None
    head_lines = header(root, pinned, a.n4)
    res = compute(cr.load_rows(root), expect)
    text = '\n'.join(head_lines + render(res, judge(res, n4_changes))) + '\n'
    check_forbidden(text)
    sys.stdout.write(text)


if __name__ == '__main__':
    main()
