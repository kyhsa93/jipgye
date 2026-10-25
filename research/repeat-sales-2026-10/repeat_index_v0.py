"""반복거래 지수 v0 - 이슈 #170 (V8), 사전 기준 research/repeat-sales-2026-10/DESIGN.md 5-1절(개정 2).

이 스크립트는 DESIGN 5-1의 A~F와 ②·③을 그대로 옮긴 것이다. 기준을 바꾸려면 DESIGN에 새 버전을
계산 전에 먼저 병합한다(5-1 ⑧) - 이 파일에서 임의로 바꾸지 않는다.
쌍 만들기(해제 제거·중개거래·창·집 키·면적 묶음·층)는 count_repeat.py(#70)의 함수를 그대로 불러 쓴다.

입력은 --root 디렉터리의 raw/sale/*.json 과 raw/indicators/rone-districts.json 이다(네트워크 없음).
--root 는 5-1 ③의 입력 커밋을 꺼낸 디렉터리여야 한다(HEAD·raw/ 깨끗함·R-ONE blob 검증):

    git worktree add --detach <dir> 39c2481150a68f8862af5b0745889084da232c8b
    python3 -I repeat_index_v0.py --root <dir> > <결과 파일>

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
_spec = importlib.util.spec_from_file_location('count_repeat', os.path.join(HERE, 'count_repeat.py'))
cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cr)

# 5-1 ③
INPUT_COMMIT = '39c2481150a68f8862af5b0745889084da232c8b'
RONE_BLOB = 'e6e8e667d4e1524e4273b13f73de2c7d8f258591'
RONE_FILE = os.path.join('raw', 'indicators', 'rone-districts.json')
RONE_SOURCE = 'R-ONE A_2024_00045'
# 창은 count_repeat.WINDOW(202411~202608)를 그대로 쓴다 - to_trades가 그 값으로 거른다.
assert cr.WINDOW == (202411, 202608)

# 5-1 ②(#70 고정)
GU = cr.GU
GU_THRESHOLD = cr.GU_THRESHOLD          # 91
GU_COUNT_THRESHOLD = cr.GU_COUNT_THRESHOLD  # 13
BOOT_N = cr.BOOT_N                      # 400
BOOT_LO, BOOT_HI = cr.BOOT_LO, cr.BOOT_HI  # 20, 379
BOOT_SEED = 1

# 5-1 ①
OUTLIER_LOG = math.log(2)    # A: |ln| > ln 2 제외
OUTLIER_FLAG_SHARE = 0.05    # A: 제외 비율 > 5% 이면 「이상치 많음」
SIGN_MISMATCH_MAX = 3        # D(i): 3곳 이상이면 발동
SPEARMAN_MIN = 0.3           # D(ii): 0.3 미만이면 발동
GAP_RHO_MAX = 0.5            # E: |rho| >= 0.5 이면 구 사이 비교 문구 삭제
JITTER_DROP = 0.10           # F: 집 10%(내림) 제외
JITTER_N = 50                # F: 50회
JITTER_SEED = 2              # F: 별도 random.Random(2)

FORBIDDEN = ('오를', '내릴', '전망', '기대 수익')  # 5-1 ⑦

Pair = collections.namedtuple('Pair', 'log gap ym_a ym_b')


# ---------------------------------------------------------------- 쌍

def _ym(day):
    return day.year * 100 + day.month


def house_pair_records(lst):
    """count_repeat.house_pairs와 같은 인접쌍·간격 규칙(300~730일 양끝 포함). 쌍마다 로그 비율·간격·두 계약월."""
    out = []
    for a, b in zip(lst, lst[1:]):
        gap = (b.day - a.day).days
        if cr.GAP_MIN <= gap <= cr.GAP_MAX:
            out.append(Pair(math.log(b.amount / a.amount), gap, _ym(a.day), _ym(b.day)))
    return out


def is_outlier(p):
    """A: |ln 비율| > ln 2. 경계(정확히 두 배·반값)는 남긴다."""
    return abs(p.log) > OUTLIER_LOG


def pair_units(houses):
    """구별 [집별 쌍 목록(이상치 제외 뒤, 비지 않은 것)...] 집 키 오름차순, 그리고 구별 제외 전 쌍 수·제외 쌍 수."""
    units = collections.defaultdict(list)
    before = collections.Counter()
    excluded = collections.Counter()
    for key, lst in houses:
        recs = house_pair_records(lst)
        if not recs:
            continue
        g = key[0]
        before[g] += len(recs)
        kept = [p for p in recs if not is_outlier(p)]
        excluded[g] += len(recs) - len(kept)
        if kept:
            units[g].append(kept)
    return units, before, excluded


# ---------------------------------------------------------------- 통계

def flat(units):
    return [p for house in units for p in house]


def logs_median(units):
    return statistics.median(p.log for p in flat(units))


def boot_interval(units, rnd):
    """집 단위 복원추출 len(units)개 -> 쌍 중앙값, BOOT_N회. (boots[20], boots[379])."""
    boots = sorted(logs_median(rnd.choices(units, k=len(units))) for _ in range(BOOT_N))
    return boots[BOOT_LO], boots[BOOT_HI]


def jitter_range(units, rng):
    """F: 집의 10%(내림)를 빼고 남은 쌍의 중앙값을 50회. 반환: 최대 - 최소."""
    h = len(units)
    drop = int(h * JITTER_DROP)
    meds = []
    for _ in range(JITTER_N):
        gone = set(rng.sample(range(h), drop))
        meds.append(logs_median([u for i, u in enumerate(units) if i not in gone]))
    return max(meds) - min(meds)


def ranks(xs):
    """평균 순위(동률은 평균)."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2 + 1
        i = j + 1
    return r


def spearman(xs, ys):
    """스피어만 순위상관(평균 순위의 피어슨). 두 개 미만이거나 분산 0이면 None."""
    if len(xs) < 2:
        return None
    rx, ry = ranks(xs), ranks(ys)
    mx, my = statistics.fmean(rx), statistics.fmean(ry)
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sxx = sum((a - mx) ** 2 for a in rx)
    syy = sum((b - my) ** 2 for b in ry)
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def sign(x):
    return (x > 0) - (x < 0)


# ---------------------------------------------------------------- R-ONE

def load_rone(root):
    with open(os.path.join(root, RONE_FILE), encoding='utf-8') as fh:
        d = json.load(fh)
    if d.get('source') != RONE_SOURCE:
        raise ValueError(f'R-ONE 계열이 {RONE_SOURCE}이 아니다: {d.get("source")!r}')
    return {g: {int(m): float(v) for m, v in rows} for g, rows in d['series'].items()}


def rone_match(units, series):
    """C: 쌍마다 ln(R[뒤 계약월]/R[앞 계약월]). 뒤 계약월이 그 구 계열 최신 달보다 늦거나 앞 달이 없는 쌍은 비교에서만 뺀다.
    반환: (쌍맞춤 중앙값 또는 None, 비교에 쓴 쌍 수, 뺀 쌍 수)."""
    if not series:
        return None, 0, len(flat(units))
    latest = max(series)
    vals, dropped = [], 0
    for p in flat(units):
        if p.ym_b > latest or p.ym_a not in series or p.ym_b not in series:
            dropped += 1
            continue
        vals.append(math.log(series[p.ym_b] / series[p.ym_a]))
    return (statistics.median(vals) if vals else None), len(vals), dropped


# ---------------------------------------------------------------- 계산

def compute(rows, rone):
    houses = cr.build_houses(cr.to_trades(rows))
    units, before, excluded = pair_units(houses)

    rnd = random.Random()
    rnd.seed(BOOT_SEED)  # 5-1 ③: 구 반복(sggCd 오름차순) 직전에 한 번
    table = {}
    for g in sorted(units):
        lo, hi = boot_interval(units[g], rnd)
        table[g] = {'median': logs_median(units[g]), 'lo': lo, 'hi': hi, 'width': hi - lo,
                    'gap_median': statistics.median(p.gap for p in flat(units[g]))}
    rows_out = []
    for g in GU:
        b, x = before.get(g, 0), excluded.get(g, 0)
        u = units.get(g, [])
        n_g = len(flat(u))
        r = {'gu': g, 'before': b, 'excluded': x, 'excl_share': (x / b) if b else None,
             'n_g': n_g, 'houses': len(u), 'qualified': n_g >= GU_THRESHOLD, 'stat': table.get(g),
             'rone_fallback': g not in rone}
        r['many_outliers'] = r['excl_share'] is not None and r['excl_share'] > OUTLIER_FLAG_SHARE
        r['rone'], r['rone_n'], r['rone_dropped'] = rone_match(u, rone.get(g)) if u else (None, 0, 0)
        r['diff'] = (r['stat']['median'] - r['rone']) if (r['stat'] and r['rone'] is not None) else None
        rows_out.append(r)

    rng = random.Random(JITTER_SEED)  # F: 별도 난수, 구 sggCd 오름차순·회차 순
    for r in rows_out:
        r['jitter'] = None
        r['shaky'] = False
        if r['qualified']:
            r['jitter'] = jitter_range(units[r['gu']], rng)
            r['shaky'] = r['jitter'] > r['stat']['width']

    rnd.seed(BOOT_SEED)  # 서울 참고 값 직전에 다시
    seoul_units = [h for g in sorted(units) for h in units[g]]
    seoul = None
    if seoul_units:
        lo, hi = boot_interval(seoul_units, rnd)
        allr, dropped = [], 0
        for g in sorted(units):  # 각 쌍은 자기 구 계열(rone_match와 같은 규칙)
            s = rone.get(g) or {}
            latest = max(s) if s else None
            for p in flat(units[g]):
                if latest is None or p.ym_b > latest or p.ym_a not in s or p.ym_b not in s:
                    dropped += 1
                else:
                    allr.append(math.log(s[p.ym_b] / s[p.ym_a]))
        seoul = {'n': len(flat(seoul_units)), 'houses': len(seoul_units), 'median': logs_median(seoul_units),
                 'lo': lo, 'hi': hi, 'rone': statistics.median(allr) if allr else None,
                 'rone_n': len(allr), 'rone_dropped': dropped,
                 'before': sum(before.values()), 'excluded': sum(excluded.values())}
    return rows_out, seoul


def checks(rows):
    """D·E·F와 13곳 조건, v0 통과 여부."""
    q = [r for r in rows if r['qualified']]
    mism = [r['gu'] for r in q
            if r['rone'] is not None and (r['stat']['lo'] > 0 or r['stat']['hi'] < 0)
            and sign(r['stat']['median']) != sign(r['rone'])]
    qr = [r for r in q if r['rone'] is not None]
    rho = spearman([r['stat']['median'] for r in qr], [r['rone'] for r in qr])
    kill_sign = len(mism) >= SIGN_MISMATCH_MAX
    kill_rho = rho is None or rho < SPEARMAN_MIN  # 계산할 수 없으면 정합을 보이지 못한 것으로 본다
    gap_rho = spearman([r['stat']['median'] for r in q], [r['stat']['gap_median'] for r in q])
    drop_compare = gap_rho is not None and abs(gap_rho) >= GAP_RHO_MAX
    published = [r['gu'] for r in q if not r['shaky']]
    enough = len(published) >= GU_COUNT_THRESHOLD
    return {'qualified': len(q), 'mismatch': mism, 'kill_sign': kill_sign, 'rho': rho, 'kill_rho': kill_rho,
            'kill': kill_sign or kill_rho, 'gap_rho': gap_rho, 'drop_compare': drop_compare,
            'shaky': [r['gu'] for r in q if r['shaky']], 'published': published, 'enough': enough,
            'many_outliers': [r['gu'] for r in rows if r['many_outliers']],
            'pass': enough and not (kill_sign or kill_rho)}


# ---------------------------------------------------------------- 출력

def _f(x, nd=6):
    return '' if x is None else f'{x:.{nd}f}'


def _pct(x):
    return '' if x is None else f'{math.expm1(x) * 100:+.1f}%'


def header(root, pinned):
    head, dirty = cr.pin_state(root)
    L = ['# 반복거래 지수 v0 (이슈 #170 V8, research/repeat-sales-2026-10/DESIGN.md 5-1절 개정 2)',
         '## 0. 머리 기록',
         f'입력 루트 git HEAD: {head or "(git 아님)"}  (고정 {INPUT_COMMIT}) 고정 검증: {"통과" if pinned else "생략(--allow-unpinned)"}',
         f'raw/ 미커밋 변경: {"없음" if dirty == "" else (dirty if dirty is not None else "(확인 못 함)")}',
         f'git rev-parse HEAD:raw/sale: {cr._git(root, "rev-parse", "HEAD:raw/sale") or "(확인 못 함)"}',
         f'R-ONE 파일 blob: {cr.blob_hash(os.path.join(root, RONE_FILE))} (고정 {RONE_BLOB}), 계열 {RONE_SOURCE} ITM 100001',
         f'스크립트 blob: {cr.blob_hash(os.path.abspath(__file__))}, count_repeat.py blob: {cr.blob_hash(os.path.join(HERE, "count_repeat.py"))}',
         f'raw/sale 파일 {len(cr.input_files(root, "sale"))}개',
         f'창: 계약월 {cr.WINDOW[0]}~{cr.WINDOW[1]}, 간격 {cr.GAP_MIN}~{cr.GAP_MAX}일, 이상치 |ln|>ln2, 문턱 {GU_THRESHOLD}쌍·{GU_COUNT_THRESHOLD}곳, '
         f'부트스트랩 {BOOT_N}회 seed {BOOT_SEED}, 흔들림 {int(JITTER_DROP * 100)}%x{JITTER_N}회 seed {JITTER_SEED}']
    return L


def render(rows, seoul, c):
    L = ['', '## 1. 구별 (로그 척도 값과 expm1 %; 구간 = boots[20]~boots[379]; 정렬은 구 코드순, 순위 아님)',
         '구 | 제외 전 쌍 | 이상치 제외 | 제외 비율 | n_g | 집 | 중앙값 | % | 구간 하한 | 구간 상한 | 구간 % | 폭 | 간격 중앙값(일) | '
         'R-ONE 쌍맞춤 | R-ONE % | 비교 쌍 | 비교 제외 | 차이 | 흔들림 폭 | 표시']
    for r in rows:
        s = r['stat'] or {}
        marks = []
        if not r['qualified']:
            marks.append(f'쌍이 모자람({r["n_g"]}쌍) - 값 비움')
        if r['shaky']:
            marks.append('흔들림 - 값 비움')
        if r['many_outliers']:
            marks.append('이상치 많음')
        if r['rone_fallback']:
            marks.append('R-ONE 권역 계열로 내림(계열 없음)')
        L.append(' | '.join([
            r['gu'], str(r['before']), str(r['excluded']),
            '' if r['excl_share'] is None else f'{r["excl_share"] * 100:.1f}%', str(r['n_g']), str(r['houses']),
            _f(s.get('median')), _pct(s.get('median')), _f(s.get('lo')), _f(s.get('hi')),
            '' if not s else f'{_pct(s["lo"])}~{_pct(s["hi"])}', _f(s.get('width')),
            '' if not s else f'{s["gap_median"]:g}',
            _f(r['rone']), _pct(r['rone']), str(r['rone_n']), str(r['rone_dropped']), _f(r['diff']),
            _f(r['jitter']), ', '.join(marks)]))
    L += ['', '## 2. 서울 참고 값 (판정에 쓰지 않음)']
    if seoul:
        L.append(f'25구 이상치 제외 뒤 쌍 {seoul["n"]} (제외 전 {seoul["before"]}, 이상치 제외 {seoul["excluded"]}), 집 {seoul["houses"]}')
        L.append(f'중앙값 {_f(seoul["median"])} ({_pct(seoul["median"])}), 구간 {_f(seoul["lo"])}~{_f(seoul["hi"])} '
                 f'({_pct(seoul["lo"])}~{_pct(seoul["hi"])}), R-ONE 쌍맞춤 {_f(seoul["rone"])} ({_pct(seoul["rone"])}), '
                 f'비교 쌍 {seoul["rone_n"]}, 비교 제외 {seoul["rone_dropped"]}')
    else:
        L.append('(쌍 없음)')
    L += ['', '## 3. 점검 (DESIGN 5-1)',
          f'n_g >= {GU_THRESHOLD}인 구: {c["qualified"]}곳',
          f'A 이상치 많음(제외 비율 > 5%): {", ".join(c["many_outliers"]) or "없음"} (값 유지)',
          f'D(i) 부호 불일치(우리 90% 구간이 0을 포함하지 않는 구만): {len(c["mismatch"])}곳 '
          f'{", ".join(c["mismatch"])} -> {"발동(3곳 이상)" if c["kill_sign"] else "미발동"}',
          f'D(ii) 스피어만(쌍 중앙값 대 R-ONE 쌍맞춤) = {_f(c["rho"], 4) or "계산 불가"} -> '
          f'{"발동(0.3 미만 또는 계산 불가)" if c["kill_rho"] else "미발동"} (0.3은 최소 정합선, 통과가 지수가 맞다는 증거는 아니다)',
          f'E 간격 상관 스피어만(쌍 중앙값 대 간격 중앙값) = {_f(c["gap_rho"], 4) or "계산 불가"} -> '
          f'{"구 사이 비교 문구 삭제(|rho| >= 0.5)" if c["drop_compare"] else "유지"}',
          f'F 흔들림(50회 변동 폭 > 90% 구간 폭): {", ".join(c["shaky"]) or "없음"} (값 비움)',
          f'공표 가능 구(n_g >= 91, 흔들림 아님): {len(c["published"])}곳 -> {"13곳 이상" if c["enough"] else "13곳 미만 - 화면 전체 보류"}',
          '', '## 4. v0 판정',
          f'판정: {"통과" if c["pass"] else "실패"} (13곳 조건 {"충족" if c["enough"] else "미충족"}, 킬 스위치 {"발동" if c["kill"] else "미발동"})',
          '단서(DESIGN 0장·5-1 ⑥): 사전 등록 순서 위반 하의 #70 통과, 15개월 겹침, 알려진 노출 1건. '
          '이상치 제외 전 같은 창의 구별 쌍 중앙값은 count_repeat.out(입력 3a92151)에 이미 공개돼 있었다(5-1 ⑤).']
    if c['kill']:
        L.append('킬 스위치 발동: 화면을 만들지 않고 이 결과와 method 한 줄을 #170에 공개한다(5-1 ④).')
    return L


def check_forbidden(text):
    hits = [w for w in FORBIDDEN if w in text]
    if hits:
        raise ValueError(f'금지어가 출력에 있다: {hits}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--root', required=True, help='5-1 ③ 입력 커밋을 꺼낸 디렉터리. 기본값 없음')
    ap.add_argument('--allow-unpinned', action='store_true', help='고정 검증 생략(시험용). 머리에 표시된다')
    a = ap.parse_args(argv)
    root = a.root
    if not os.path.isdir(os.path.join(root, 'raw', 'sale')):
        ap.error(f'{root}/raw/sale 이 없다')
    pinned = False
    if not a.allow_unpinned:
        head, dirty = cr.pin_state(root)
        if head != INPUT_COMMIT:
            ap.error(f'--root의 git HEAD가 {INPUT_COMMIT}이 아니다(HEAD={head})')
        if dirty != '':
            ap.error('--root의 raw/에 미커밋 변경이 있거나 상태를 확인 못 했다')
        if cr.blob_hash(os.path.join(root, RONE_FILE)) != RONE_BLOB:
            ap.error(f'{RONE_FILE} blob이 {RONE_BLOB}이 아니다')
        pinned = True
    head_lines = header(root, pinned)
    rows, seoul = compute(cr.load_rows(root), load_rone(root))
    text = '\n'.join(head_lines + render(rows, seoul, checks(rows))) + '\n'
    check_forbidden(text)
    sys.stdout.write(text)


if __name__ == '__main__':
    main()
