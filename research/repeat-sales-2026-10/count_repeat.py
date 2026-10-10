"""반복거래(연속 중개거래 쌍) 재계측 - 이슈 #70, 사전 기준 research/repeat-sales-2026-10/README.md.

이 스크립트는 README 2·3절(개정 3)을 그대로 옮긴 것이다. 괄호의 '항목 N'·'2-N'은 README의 번호다.
기준을 바꾸려면 README 개정 규칙(5절)을 먼저 거친다 - 이 파일에서 임의로 바꾸지 않는다.

입력은 인자 --root가 가리키는 디렉터리의 raw/sale/*.json 이다. 기본값은 없다. README 0-2의 3번 때문에
작업 트리의 raw/는 읽지 않는다: 첫 실행은 `git worktree add --detach <dir> 3a92151`로 꺼낸 디렉터리를 --root로 준다.
입력은 읽기 전용이다. 표준 출력이 그대로 .out 이 된다.

    python3 -I count_repeat.py --root <3a92151 트리가 꺼내진 디렉터리> > count_repeat.out
"""
import argparse
import collections
import datetime
import glob
import hashlib
import json
import math
import os
import random
import statistics
import subprocess
import sys

PINNED_COMMIT = '3a921516fac7ad3a275a9e64e1865b594b650a43'  # README 0-2 3번

# README 1: 쌍 창(계약월), 간격, 문턱, 부트스트랩 횟수. 91·13·300~730·400은 개정 대상이 아니다.
WINDOW = (202411, 202608)
GAP_MIN, GAP_MAX = 300, 730
GU_THRESHOLD = 91
GU_COUNT_THRESHOLD = 13
BOOT_N = 400
SEED = 1
BOOT_LO, BOOT_HI = 20, 379  # README 2-1: boots[20]·boots[379] (count_sale2.py:73-75와 같다)

# README 항목 11: 기준기 2024-11~2025-01, 최근기 2026-06~2026-08
BASE_MONTHS = (202411, 202412, 202501)
RECENT_MONTHS = (202606, 202607, 202608)

# 서울 25개 자치구(count_sale2.py의 REG와 같은 코드 25개). README 항목 9: 쌍 0개인 구도 25구에 포함한다.
GU = ['11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350',
      '11380', '11410', '11440', '11470', '11500', '11530', '11545', '11560', '11590', '11620',
      '11650', '11680', '11710', '11740']

AREA_GROUP = 1  # README 항목 4, scripts/complex-price.mjs AREA_GROUP

Trade = collections.namedtuple('Trade', 'sgg umd apt area floor day amount order')


# ---------------------------------------------------------------- 입력

def load_rows(root):
    """sorted(glob) 파일 순, 파일 안 items 순서(README 항목 6의 입력 순서)."""
    rows = []
    for f in sorted(glob.glob(os.path.join(root, 'raw', 'sale', '*.json'))):
        with open(f, encoding='utf-8') as fh:
            rows += json.load(fh)['items']
    return rows


def _blank_to_empty(v):
    """항목 5: 필드가 없음·None·공백이면 빈 문자열. 값이 있으면 strip하지 않고 그대로(aptNm은 strip 안 함)."""
    if v is None or str(v).strip() == '':
        return ''
    return str(v)


def _amount(r):
    return int(str(r['dealAmount']).replace(',', '').strip())  # count_sale.py의 amt와 같다


def to_trades(rows):
    """항목 8: cdealType == 'O' 제거(alive) -> dealingGbn == '중개거래'(market) -> 쌍 창 안(계약월). 입력 순서를 order로 남긴다."""
    out = []
    for order, r in enumerate(rows):
        if r.get('cdealType') == 'O':
            continue
        if r.get('dealingGbn') != '중개거래':
            continue
        ym = int(r['dealYear']) * 100 + int(r['dealMonth'])
        if not (WINDOW[0] <= ym <= WINDOW[1]):
            continue
        sgg = str(r['sggCd'])
        if sgg not in GU:
            # 25구 밖의 코드는 표에 자리가 없다. 임의로 버리거나 더하지 않고 결과 출력 전에 멈춘다(재실행 허용 사유).
            raise ValueError(f'25구 밖의 sggCd: {sgg!r}')
        floor = r.get('floor')
        out.append(Trade(
            sgg, _blank_to_empty(r.get('umdNm')), _blank_to_empty(r.get('aptNm')),
            float(r['excluUseAr']),  # 항목 4: float 값 그대로, 반올림·문자열 정규화 없음
            '' if floor is None else str(floor),  # 항목 4: 같은 집 판정은 층 문자열 그대로
            datetime.date(int(r['dealYear']), int(r['dealMonth']), int(r['dealDay'])),
            _amount(r), order))
    return out


# ---------------------------------------------------------------- 집 키·면적 묶음

def area_labels(areas):
    """항목 4. areas: 한 단지의 거래별 면적 목록(중복 포함). 반환: {면적: 묶음 이름}.
    작은 면적부터 훑어 묶음의 첫 면적과의 차이가 1 미만이면 같은 묶음, >= 1이면 새 묶음. 이름은 거래 수가
    가장 많은 면적, 같으면 작은 면적(scripts/complex-price.mjs areaGroups)."""
    counts = collections.Counter(areas)
    label = {}
    group = []

    def close():
        if group:
            name = sorted(group, key=lambda a: (-counts[a], a))[0]
            for a in group:
                label[a] = name
            group.clear()

    for a in sorted(counts):
        if group and a - group[0] >= AREA_GROUP:
            close()
        group.append(a)
    close()
    return label


def floor_sort_key(floor):
    """항목 4: 층은 정수로 파싱해 수치 오름차순(정렬에만 쓴다), 파싱 불가는 맨 뒤에 원문 문자열 오름차순.
    수치가 같은 서로 다른 문자열('05'·'5')은 문자열 순으로 가른다(README에 없는 동률 처리 - PR 본문 참조)."""
    try:
        return (0, int(floor), floor)
    except ValueError:
        return (1, floor)


def house_sort_key(key):
    sgg, umd, apt, name, floor = key
    return (sgg, umd, apt, name, floor_sort_key(floor))


def build_houses(trades):
    """항목 5·6: 집 키 (sggCd, umdNm, aptNm, 면적 묶음 이름, 층) -> 계약일·금액·입력 순서로 세운 거래 목록.
    반환: 집 키 오름차순으로 정렬된 [(집 키, [Trade...])]."""
    by_complex = collections.defaultdict(list)
    for t in trades:
        by_complex[(t.sgg, t.umd, t.apt)].append(t.area)
    labels = {c: area_labels(a) for c, a in by_complex.items()}
    houses = collections.defaultdict(list)
    for t in trades:
        houses[(t.sgg, t.umd, t.apt, labels[(t.sgg, t.umd, t.apt)][t.area], t.floor)].append(t)
    out = []
    for key in sorted(houses, key=house_sort_key):
        # 항목 6: 같은 날은 금액 오름차순, 그다음 입력 순서
        out.append((key, sorted(houses[key], key=lambda t: (t.day, t.amount, t.order))))
    return out


# ---------------------------------------------------------------- 쌍 방식

def house_pairs(lst):
    """항목 6·7: 인접한 두 거래를 쌍으로 만든 뒤 300 <= 일수 <= 730만 남긴다.
    반환: (로그 비율 목록, 남은 쌍의 인접쌍 번호 목록)."""
    logs, idxs = [], []
    for i, (a, b) in enumerate(zip(lst, lst[1:])):
        if GAP_MIN <= (b.day - a.day).days <= GAP_MAX:
            logs.append(math.log(b.amount / a.amount))
            idxs.append(i)
    return logs, idxs


def disjoint_count(idxs):
    """겹치지 않는 쌍 수(보고용, 판정에 안 씀): 인접쌍 i와 i+1은 거래 하나를 공유하므로, 서로 거래를 공유하지
    않는 쌍의 최대 개수를 왼쪽부터 탐욕으로 센다(경로 위 최대 독립 간선 집합이라 탐욕이 최적)."""
    n, last = 0, None
    for i in idxs:
        if last is None or i != last + 1:  # 직전에 센 쌍과 거래를 공유하면(i == last + 1) 건너뛴다
            n += 1
            last = i
    return n


def pair_units(houses):
    """구별로 [쌍을 가진 집의 로그 비율 목록...]을 집 키 오름차순으로. 반환: ({구: units}, {구: 겹치지 않는 쌍 수})."""
    units = collections.defaultdict(list)
    disjoint = collections.defaultdict(int)
    for key, lst in houses:
        logs, idxs = house_pairs(lst)
        if logs:  # 항목 6: 쌍을 가진 집 = 필터를 통과한 쌍이 1개 이상인 집
            units[key[0]].append(logs)
            disjoint[key[0]] += disjoint_count(idxs)
    return units, disjoint


# ---------------------------------------------------------------- 같은 칸 방식

def cell_values(houses):
    """항목 11: 기준기·최근기 모두 거래가 있는 집(칸)의 ln(최근기 중앙값/기준기 중앙값). 구별, 칸 키 오름차순."""
    out = collections.defaultdict(list)
    for key, lst in houses:
        base, recent = [], []
        for t in lst:
            ym = t.day.year * 100 + t.day.month
            if ym in BASE_MONTHS:
                base.append(t.amount)
            elif ym in RECENT_MONTHS:
                recent.append(t.amount)
        if base and recent:
            out[key[0]].append(math.log(statistics.median(recent) / statistics.median(base)))
    return out


# ---------------------------------------------------------------- 부트스트랩

def pair_stat(draw):
    """뽑힌 집의 쌍을 모두 모아(중복 포함) 중앙값."""
    return statistics.median([v for house in draw for v in house])


def cell_stat(draw):
    return statistics.median(draw)


def interval(units, stat):
    """복원추출 len(units)개 -> 중앙값, BOOT_N회. 반환: (boots[20], boots[379]). 2-1·2-2."""
    boots = sorted(stat(random.choices(units, k=len(units))) for _ in range(BOOT_N))
    return boots[BOOT_LO], boots[BOOT_HI]


def run_method(units_by_gu, stat, flatten):
    """항목 3: 방법마다 구 반복 직전에 random.seed(1)을 한 번, 구는 sggCd 오름차순.
    단위가 하나라도 있는 모든 구를 돈다(n_g가 문턱 미만인 구도 - count_sale2.py가 gu_ch의 모든 구를 도는 것과 같다)."""
    random.seed(SEED)
    res = {}
    for g in sorted(units_by_gu):
        units = units_by_gu[g]
        lo, hi = interval(units, stat)
        res[g] = {'median': statistics.median(flatten(units)), 'lo': lo, 'hi': hi, 'width': hi - lo}
    return res


def ratio(pair_w, cell_w):
    """2-1 적용 순서: 쌍 폭 0이면 inf, (쌍 폭 > 0일 때) 칸 폭이 0이거나 칸이 없으면 inf, 아니면 나눗셈.
    cell_w가 None이면 그 구에 칸이 하나도 없다."""
    if pair_w == 0:
        return math.inf
    if cell_w is None or cell_w == 0:
        return math.inf
    return pair_w / cell_w


def measure(rows):
    trades = to_trades(rows)
    houses = build_houses(trades)
    punits, disjoint = pair_units(houses)
    cunits = cell_values(houses)
    pair = run_method(punits, pair_stat, lambda units: [v for house in units for v in house])
    cell = run_method(cunits, cell_stat, lambda units: units)
    table = []
    for g in GU:
        n_g = sum(len(u) for u in punits.get(g, []))
        row = {'gu': g, 'n_g': n_g, 'houses': len(punits.get(g, [])), 'disjoint': disjoint.get(g, 0),
               'pair': pair.get(g), 'cells': len(cunits.get(g, [])), 'cell': cell.get(g)}
        row['qualified'] = n_g >= GU_THRESHOLD
        row['r_g'] = ratio(pair[g]['width'], cell[g]['width'] if g in cell else None) if g in pair else None
        table.append(row)
    return table


def verdict(table):
    """3절 판정표. A: n_g >= 91인 구가 13 이상. B: 충족 구 r_g의 중앙값 < 1. 통과 = A 그리고 B."""
    qualified = [r for r in table if r['qualified']]
    a_count = len(qualified)
    r_med = statistics.median([r['r_g'] for r in qualified]) if qualified else None
    a_ok = a_count >= GU_COUNT_THRESHOLD
    b_ok = r_med is not None and r_med < 1
    return {'A_count': a_count, 'A_ok': a_ok, 'B_median': r_med, 'B_ok': b_ok, 'pass': a_ok and b_ok}


# ---------------------------------------------------------------- 머리 기록 (README 4절 3단계)

def _git(cwd, *args):
    try:
        r = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def blob_hash(path):
    """`git hash-object <path>`와 같은 값(git 없이도 낸다)."""
    with open(path, 'rb') as fh:
        data = fh.read()
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def _file_sha256(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def input_files(root, kind):
    return sorted(glob.glob(os.path.join(root, 'raw', kind, '*.json')))


def zero_slots(root):
    """0건 슬롯(totalCount == 0)의 (구, 월, 종류) 목록만. 월별·구별 합계는 내지 않는다(README 0-2 3번)."""
    out = []
    for kind in ('sale', 'rent'):
        for f in input_files(root, kind):
            with open(f, encoding='utf-8') as fh:
                if json.load(fh).get('totalCount') == 0:
                    code, ym = os.path.basename(f)[:-len('.json')].split('-')
                    out.append((code, ym, kind))
    return sorted(out)


def pin_state(root):
    """root의 HEAD가 3a92151이고 raw/가 깨끗한지. (head, dirty)"""
    head = _git(root, 'rev-parse', 'HEAD')
    dirty = _git(root, 'status', '--porcelain', '--', 'raw')
    return head, dirty


def header(root, script_path, pinned_checked):
    L = []
    L.append('# 반복거래 재계측 (이슈 #70, research/repeat-sales-2026-10/README.md 개정 3)')
    L.append('## 0. 머리 기록 (README 4절 3단계)')
    L.append(f'입력 루트(--root): {os.path.abspath(root)}')
    head, dirty = pin_state(root)
    L.append(f'입력 루트 git HEAD: {head or "(git 아님)"}  (고정 커밋 {PINNED_COMMIT}) 고정 검증: {"통과" if pinned_checked else "생략(--allow-unpinned)"}')
    L.append(f'raw/ 미커밋 변경: {"없음" if dirty == "" else (dirty if dirty is not None else "(확인 못 함)")}')
    for kind in ('sale', 'rent'):
        L.append(f'git rev-parse HEAD:raw/{kind} (트리 해시): {_git(root, "rev-parse", f"HEAD:raw/{kind}") or "(확인 못 함)"}')
    sp = os.path.abspath(script_path)
    sdir = os.path.dirname(sp)
    L.append(f'스크립트 git hash-object: {blob_hash(sp)}')
    L.append(f'스크립트 커밋 해시(git log -1 -- 스크립트): {_git(sdir, "log", "-1", "--format=%H", "--", sp) or "(확인 못 함)"}')
    sdirty = _git(sdir, 'status', '--porcelain', '--', sp)
    L.append(f'스크립트 미커밋 변경: {"없음" if sdirty == "" else (sdirty if sdirty is not None else "(확인 못 함)")}')
    L.append(f'파이썬 버전: {sys.version.split(chr(10))[0]}')
    for kind in ('sale', 'rent'):
        files = input_files(root, kind)
        rels = [os.path.relpath(f, root) for f in files]
        names_sha = hashlib.sha256(''.join(r + '\n' for r in rels).encode()).hexdigest()
        content_sha = hashlib.sha256(''.join(
            r + ' ' + _file_sha256(f) + '\n' for r, f in zip(rels, files)).encode()).hexdigest()
        n202411 = sum('-202411.json' in r for r in rels)
        L.append(f'raw/{kind}: 파일 {len(files)}개(기대 600), *-202411.json {n202411}개(기대 25)')
        L.append(f'raw/{kind} 정렬된 파일 목록 sha256(상대경로 + 개행): {names_sha}')
        L.append(f'raw/{kind} 정렬된 (상대경로, 내용 sha256) 목록 sha256(보조): {content_sha}')
    zs = zero_slots(root)
    L.append(f'0건 슬롯(totalCount=0) {len(zs)}개 (구·월·종류): ' + (', '.join(f'{c}-{m}-{k}' for c, m, k in zs) or '없음'))
    L.append(f'창: 계약월 {WINDOW[0]}~{WINDOW[1]}, 간격 {GAP_MIN}~{GAP_MAX}일(양끝 포함), 문턱 {GU_THRESHOLD}쌍·{GU_COUNT_THRESHOLD}곳, 부트스트랩 {BOOT_N}회, 시드 random.seed({SEED}) 방법마다 1회')
    return L


# ---------------------------------------------------------------- 출력

def _f(x):
    return '' if x is None else f'{x:.6f}'


def render(table, v):
    L = ['', '## 1. 구별 결과 (로그 비율 척도; 폭 = boots[379] - boots[20])',
         '※ 쌍 방식(24개월 전체)과 같은 칸 방식(3개월+3개월)은 보는 기간이 같지 않고 연율화도 없다. 같은 24개월 창 안이라는 뜻의 같은 기간이다.',
         '구 | n_g | 쌍 가진 집 | 겹치지 않는 쌍 | 쌍 중앙값 | 쌍 폭 | 칸 수 | 칸 중앙값 | 칸 폭 | r_g | n_g>=91']
    for r in table:
        p, c = r['pair'], r['cell']
        L.append(' | '.join([
            r['gu'], str(r['n_g']), str(r['houses']), str(r['disjoint']),
            _f(p and p['median']), _f(p and p['width']),
            str(r['cells']), _f(c and c['median']), _f(c and c['width']),
            '' if r['r_g'] is None else ('inf' if math.isinf(r['r_g']) else f'{r["r_g"]:.6f}'),
            '예' if r['qualified'] else '아니오']))
    L += ['', '## 2. 판정표 (README 3절)',
          f'A: n_g >= {GU_THRESHOLD}인 구 {v["A_count"]}곳 / 25구 -> {"통과(13 이상)" if v["A_ok"] else "접기(12 이하)"}',
          'B: 충족 구 r_g의 중앙값 = ' + ('(충족 구 없음)' if v['B_median'] is None else ('inf' if math.isinf(v['B_median']) else f'{v["B_median"]:.6f}'))
          + f' -> {"통과(< 1)" if v["B_ok"] else "접기(1 이상 또는 없음)"}' + ('' if v['A_ok'] else ' (A가 어긋나 판정에는 쓰지 않는다)'),
          f'판정: {"통과 (A 그리고 B)" if v["pass"] else "접기"}']
    if v['pass']:
        L.append('통과 단서(README 0-4·0-5): 결과 문장에 "사전 등록 순서 위반 하의 통과"와 알려진 노출 1건을 붙이고 cpo가 한 번 더 확인한다.')
    return L


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', required=True, help='raw/sale 이 들어 있는 입력 루트(3a92151 트리를 꺼낸 디렉터리). 기본값 없음')
    ap.add_argument('--allow-unpinned', action='store_true', help='git 정보가 없거나 HEAD가 3a92151이 아닌 루트를 허용(시험·git archive용). 머리에 표시된다')
    a = ap.parse_args(argv)
    root = a.root
    if not os.path.isdir(os.path.join(root, 'raw', 'sale')):
        ap.error(f'{root}/raw/sale 이 없다')
    pinned_checked = False
    if not a.allow_unpinned:
        head, dirty = pin_state(root)
        if head != PINNED_COMMIT:
            ap.error(f'--root의 git HEAD가 {PINNED_COMMIT}이 아니다(HEAD={head}). 3a92151 worktree를 쓰거나 --allow-unpinned')
        if dirty != '':
            ap.error('--root의 raw/에 미커밋 변경이 있거나 상태를 확인 못 했다')
        pinned_checked = True
    # 결과를 낸 뒤의 재실행은 금지다(README 4절 4단계): 계산을 모두 끝낸 뒤에 한꺼번에 출력해 중간 예외가 부분 출력을 남기지 않게 한다.
    head_lines = header(root, __file__, pinned_checked)
    table = measure(load_rows(root))
    out = head_lines + render(table, verdict(table))
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
