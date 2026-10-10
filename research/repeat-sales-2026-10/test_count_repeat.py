"""count_repeat.py 시험 - 합성 입력만 쓴다(README 4절 2단계). 실데이터 raw/는 열지도 일부 추출하지도 않는다.

    python3 -I research/repeat-sales-2026-10/test_count_repeat.py

`npm test`는 test/count-repeat.test.mjs가 이 파일을 돌린다.
시험 항목은 README 4절 2단계의 (a)~(h)와 판정 규칙·머리 기록이다.
"""
import contextlib
import datetime as D
import importlib.util
import io
import json
import math
import os
import random
import statistics
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('count_repeat', os.path.join(HERE, 'count_repeat.py'))
cr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cr)

SEQ = [0]


def row(day, amount, *, gu='11110', umd='가동', apt='A단지', area=84.0, floor='5', cancel=None, gbn='중개거래', **extra):
    """합성 거래 한 줄. day는 date."""
    r = {'sggCd': gu, 'umdNm': umd, 'aptNm': apt, 'excluUseAr': area, 'floor': floor,
         'dealYear': day.year, 'dealMonth': day.month, 'dealDay': day.day,
         'dealAmount': f'{amount:,}', 'dealingGbn': gbn}
    if cancel is not None:
        r['cdealType'] = cancel
    r.update(extra)
    return r


def d(y, m, dd):
    return D.date(y, m, dd)


def logs_of(rows):
    houses = cr.build_houses(cr.to_trades(rows))
    units, _ = cr.pair_units(houses)
    return units


class Cancel(unittest.TestCase):
    def test_a_cancelled_removed_and_neighbours_reconnect(self):
        # A(2025-01-01) - B(해제, 2025-06-01) - C(2026-01-01). B가 살아 있었다면 A-B 151일(범위 밖), B-C 214일(범위 밖)이라
        # 쌍이 0개다. 제거 후 재연결되면 A-C 365일 쌍 하나가 생긴다.
        rows = [row(d(2025, 1, 1), 100), row(d(2025, 6, 1), 999, cancel='O'), row(d(2026, 1, 1), 110)]
        u = logs_of(rows)
        self.assertEqual(len(u['11110']), 1)
        self.assertAlmostEqual(u['11110'][0][0], math.log(110 / 100))

    def test_a_only_O_counts_as_cancelled(self):
        # isCancelled와 달리 cdealType 비공백이면 무조건 해제가 아니다: 'O'만이다(항목 8).
        rows = [row(d(2025, 1, 1), 100), row(d(2026, 1, 1), 110, cancel='X')]
        self.assertEqual(len(logs_of(rows)['11110']), 1)

    def test_non_brokerage_removed(self):
        rows = [row(d(2025, 1, 1), 100), row(d(2025, 8, 1), 105, gbn='직거래'), row(d(2026, 1, 1), 110)]
        u = logs_of(rows)
        # 직거래가 빠져 A-C 365일 하나만 남는다
        self.assertEqual([len(h) for h in u['11110']], [1])

    def test_adjacent_only_not_skip(self):
        # A-B 100일(범위 밖), B-C 400일(범위 안): 낀 거래를 건너뛴 A-C(500일) 쌍은 만들지 않는다.
        rows = [row(d(2025, 1, 1), 100), row(d(2025, 4, 11), 101), row(d(2026, 5, 16), 120)]
        u = logs_of(rows)
        self.assertEqual(u['11110'][0], [math.log(120 / 101)])

    def test_shared_trades_all_counted(self):
        # A-B 365, B-C 365: 거래 B를 공유해도 쌍 두 개를 모두 센다.
        rows = [row(d(2024, 11, 1), 100), row(d(2025, 9, 1), 110), row(d(2026, 8, 1), 120)]
        u = logs_of(rows)
        self.assertEqual(len(u['11110'][0]), 2)

    def test_window_filter(self):
        rows = [row(d(2024, 10, 31), 100), row(d(2025, 10, 31), 110),  # 2024-10은 창 밖
                row(d(2026, 8, 31), 120), row(d(2026, 9, 1), 130)]  # 2026-09는 창 밖
        trades = cr.to_trades(rows)
        self.assertEqual(len(trades), 2)


class Gap(unittest.TestCase):
    def pairs_at(self, days):
        a = d(2025, 1, 1)
        return logs_of([row(a, 100), row(a + D.timedelta(days=days), 110)]).get('11110', [])

    def test_b_gap_boundaries(self):
        self.assertEqual(self.pairs_at(299), [])
        self.assertEqual(len(self.pairs_at(300)), 1)  # 300일 포함

    def test_b_gap_730_inclusive(self):
        # 쌍 창(2024-11~2026-08)의 가장 긴 간격은 668일이라 730일 경계는 창 안 거래로는 닿지 않는다.
        # 경계 식 자체는 창을 거치지 않고 house_pairs로 본다.
        a = cr.Trade('11110', '', 'A', 84.0, '5', d(2024, 1, 1), 100, 0)
        for days, n in ((729, 1), (730, 1), (731, 0)):
            b = a._replace(day=a.day + D.timedelta(days=days), order=1)
            self.assertEqual(len(cr.house_pairs([a, b])[0]), n, days)


class SameDay(unittest.TestCase):
    def test_c_same_day_amount_then_input_order(self):
        day = d(2025, 3, 1)
        rows = [row(day, 300, area=84.0), row(day, 100), row(day, 200),
                row(day, 200, dealingGbn='중개거래', buyerGbn='x')]  # 금액 같은 두 줄: 입력 순서
        houses = cr.build_houses(cr.to_trades(rows))
        lst = houses[0][1]
        self.assertEqual([(t.amount, t.order) for t in lst], [(100, 1), (200, 2), (200, 3), (300, 0)])

    def test_c_same_day_changes_pair(self):
        # 같은 날 두 거래(500, 100) + 365일 뒤 거래: 금액 오름차순이면 100이 앞, 500이 뒤라 쌍은 (500 -> 뒤 거래)다.
        a = d(2025, 1, 1)
        rows = [row(a, 500), row(a, 100), row(a + D.timedelta(days=365), 600)]
        self.assertEqual(logs_of(rows)['11110'][0], [math.log(600 / 500)])


class Keys(unittest.TestCase):
    def test_d_umd_blank_none_missing_same_complex(self):
        base = [row(d(2025, 1, 1), 100, umd=''), row(d(2026, 1, 1), 110, umd=None)]
        r3 = row(d(2025, 1, 1), 100)
        del r3['umdNm']
        r4 = row(d(2026, 1, 1), 110, umd='   ')
        trades = cr.to_trades(base + [r3, r4])
        self.assertEqual({t.umd for t in trades}, {''})  # 'None' 문자열이 되지 않는다
        # 빈 값·None·누락·공백 4가지가 모두 같은 단지, 같은 집
        houses = cr.build_houses(trades)
        self.assertEqual(len(houses), 1)

    def test_d_other_umd_is_other_complex(self):
        rows = [row(d(2025, 1, 1), 100, umd='가동'), row(d(2026, 1, 1), 110, umd='나동')]
        self.assertEqual(len(cr.build_houses(cr.to_trades(rows))), 2)
        self.assertEqual(logs_of(rows), {})

    def test_d_apt_not_stripped(self):
        rows = [row(d(2025, 1, 1), 100, apt='A단지'), row(d(2026, 1, 1), 110, apt='A단지 ')]
        self.assertEqual(len(cr.build_houses(cr.to_trades(rows))), 2)

    def test_floor_string_identity(self):
        rows = [row(d(2025, 1, 1), 100, floor='05'), row(d(2026, 1, 1), 110, floor='5')]
        self.assertEqual(len(cr.build_houses(cr.to_trades(rows))), 2)

    def test_floor_sort_numeric_and_unparseable_last(self):
        keys = [('g', 'u', 'a', 84.0, f) for f in ['10', '2', '', 'B1', '-1', 'A']]
        got = [k[4] for k in sorted(keys, key=cr.house_sort_key)]
        self.assertEqual(got, ['-1', '2', '10', '', 'A', 'B1'])

    def test_unknown_gu_aborts(self):
        with self.assertRaises(ValueError):
            cr.to_trades([row(d(2025, 1, 1), 100, gu='99999')])


class AreaBundles(unittest.TestCase):
    def test_h_first_area_basis_no_chain(self):
        # 84.0 -> 84.9(차이 0.9 < 1, 같은 묶음) -> 85.8(첫 면적 84.0과 1.8 >= 1, 새 묶음): 사슬로 번지지 않는다.
        lab = cr.area_labels([84.0, 84.9, 85.8])
        self.assertEqual(lab[84.0], lab[84.9])
        self.assertNotEqual(lab[84.9], lab[85.8])

    def test_h_exactly_one_opens_new_bundle(self):
        lab = cr.area_labels([84.0, 85.0])
        self.assertNotEqual(lab[84.0], lab[85.0])

    def test_h_name_is_mode_then_smaller(self):
        lab = cr.area_labels([84.0, 84.5, 84.5, 84.9])
        self.assertEqual(set(lab.values()), {84.5})
        lab = cr.area_labels([84.2, 84.6])
        self.assertEqual(set(lab.values()), {84.2})

    def test_h_bundles_are_per_complex(self):
        rows = [row(d(2025, 1, 1), 100, area=84.0, apt='A'), row(d(2026, 1, 1), 110, area=84.6, apt='A'),
                row(d(2025, 1, 1), 100, area=84.6, apt='B'), row(d(2026, 1, 1), 110, area=84.0, apt='B')]
        houses = cr.build_houses(cr.to_trades(rows))
        self.assertEqual(len(houses), 2)  # 두 단지 모두 한 집으로 묶인다
        self.assertEqual(logs_of(rows)['11110'] and len(logs_of(rows)['11110']), 2)


class Medians(unittest.TestCase):
    def test_f_even_count_median_is_average(self):
        self.assertEqual(cr.pair_stat([[1.0, 3.0]]), 2.0)
        self.assertEqual(cr.cell_stat([1.0, 2.0, 4.0, 8.0]), 3.0)

    def test_f_cell_value_uses_median_of_even(self):
        rows = [row(d(2024, 11, 1), 100), row(d(2024, 12, 1), 200), row(d(2026, 6, 1), 300), row(d(2026, 7, 1), 500)]
        vals = cr.cell_values(cr.build_houses(cr.to_trades(rows)))['11110']
        self.assertEqual(vals, [math.log(400 / 150)])

    def test_f_median_of_r_with_inf(self):
        table = [{'qualified': True, 'r_g': r} for r in (0.5, math.inf)]
        self.assertEqual(cr.verdict(table)['B_median'], math.inf)  # (0.5 + inf) / 2


class Ratio(unittest.TestCase):
    def test_e_pair_width_zero_is_inf(self):
        self.assertEqual(cr.ratio(0.0, 0.3), math.inf)
        self.assertEqual(cr.ratio(0.0, 0.0), math.inf)  # 둘 다 0도 inf(1이 아니다)
        self.assertEqual(cr.ratio(0.0, None), math.inf)

    def test_e_cell_width_zero_or_missing_is_inf(self):
        self.assertEqual(cr.ratio(0.2, 0.0), math.inf)
        self.assertEqual(cr.ratio(0.2, None), math.inf)

    def test_ratio_normal(self):
        self.assertAlmostEqual(cr.ratio(0.2, 0.4), 0.5)

    def test_e_zero_width_end_to_end(self):
        # 한 집에서만 쌍이 나오면 재추출이 늘 같은 값 -> 폭 0
        units = {'11110': [[0.1, 0.1]]}
        res = cr.run_method(units, cr.pair_stat, lambda u: [v for h in u for v in h])
        self.assertEqual(res['11110']['width'], 0)


class Bootstrap(unittest.TestCase):
    def test_g_resamples_houses_not_pairs(self):
        seen = []

        def fake_choices(population, k):
            seen.append((list(population), k))
            return [population[0]] * k  # 첫 집만 k번

        houses = [[1.0, 2.0, 3.0], [10.0], [20.0, 30.0]]
        with mock.patch.object(cr.random, 'choices', fake_choices):
            cr.interval(houses, cr.pair_stat)
        self.assertEqual(seen[0][0], houses)  # 모집단 = 집 목록(쌍 6개가 아니라 집 3개)
        self.assertEqual(seen[0][1], 3)  # 집 수만큼 뽑는다
        self.assertEqual(len(seen), cr.BOOT_N)

    def test_g_duplicate_house_pairs_counted_with_multiplicity(self):
        # 집 [1.0, 1.0, 1.0]이 두 번, 집 [10.0]이 한 번 뽑히면 쌍 7개 [1,1,1,1,1,1,10]의 중앙값 1
        self.assertEqual(cr.pair_stat([[1.0, 1.0, 1.0], [1.0, 1.0, 1.0], [10.0]]), 1.0)
        # 집이 많이 뽑히는 쪽이 중앙값을 끈다: 쌍 [10, 10, 1, 1, 1]의 중앙값은 1
        self.assertEqual(cr.pair_stat([[10.0], [10.0], [1.0, 1.0, 1.0]]), 1.0)

    def test_interval_indices_20_and_379(self):
        # 400번의 중앙값이 0..399가 되게 하면 boots[20]=20, boots[379]=379, 폭 359
        n = [-1]

        def fake_choices(population, k):
            n[0] += 1
            return [float(n[0])] * k

        with mock.patch.object(cr.random, 'choices', fake_choices):
            lo, hi = cr.interval([0.0, 0.0, 0.0], cr.cell_stat)
        n[0] = -1
        self.assertEqual((lo, hi), (20.0, 379.0))

    def test_seed_once_per_method_and_gu_ascending(self):
        seeds, order = [], []
        real_seed = random.seed
        real_interval = cr.interval

        def spy_seed(x=None):
            seeds.append(x)
            real_seed(x)

        def spy_interval(units, stat):
            order.append(len(units))
            return real_interval(units, stat)

        units = {'11140': [[0.1], [0.3]], '11110': [[0.2], [0.4], [0.6]]}
        with mock.patch.object(cr.random, 'seed', spy_seed), mock.patch.object(cr, 'interval', spy_interval):
            cr.run_method(units, cr.pair_stat, lambda u: [v for h in u for v in h])
        self.assertEqual(seeds, [1])
        self.assertEqual(order, [3, 2])  # 11110(3집) 다음 11140(2집)

    def test_deterministic(self):
        units = {'11110': [[0.1, 0.2], [0.3], [0.5, 0.7, 0.9]]}
        a = cr.run_method(units, cr.pair_stat, lambda u: [v for h in u for v in h])
        random.seed(12345)  # 바깥 상태가 달라도
        b = cr.run_method(units, cr.pair_stat, lambda u: [v for h in u for v in h])
        self.assertEqual(a, b)


class Disjoint(unittest.TestCase):
    def test_disjoint_count(self):
        self.assertEqual(cr.disjoint_count([]), 0)
        self.assertEqual(cr.disjoint_count([0]), 1)
        self.assertEqual(cr.disjoint_count([0, 1]), 1)
        self.assertEqual(cr.disjoint_count([0, 1, 2]), 2)
        self.assertEqual(cr.disjoint_count([0, 1, 2, 3]), 2)
        self.assertEqual(cr.disjoint_count([0, 2, 3]), 2)


def make_chain(gu, apt, n_pairs, start=d(2024, 11, 1)):
    """한 단지에서 쌍 n_pairs개(거래 n_pairs+1개, 간격 300일 이상)를 만드는 합성 행. 창 안에 들게 층을 달리해 집마다 쌍 1개."""
    rows = []
    for i in range(n_pairs):
        fl = str(i + 1)
        rows.append(row(start, 100, gu=gu, apt=apt, floor=fl))
        rows.append(row(start + D.timedelta(days=400), 100 + i % 7, gu=gu, apt=apt, floor=fl))
    return rows


class Verdict(unittest.TestCase):
    def test_pass_and_fail_rules(self):
        def tbl(n_qualified, r):
            return [{'qualified': i < n_qualified, 'r_g': r} for i in range(25)]

        self.assertTrue(cr.verdict(tbl(13, 0.9))['pass'])
        self.assertFalse(cr.verdict(tbl(12, 0.9))['pass'])  # A 어긋남
        self.assertFalse(cr.verdict(tbl(13, 1.0))['pass'])  # B: 같으면 어긋남
        self.assertFalse(cr.verdict(tbl(13, math.inf))['pass'])
        self.assertIsNone(cr.verdict(tbl(0, 0.5))['B_median'])

    def test_threshold_91_inclusive(self):
        rows = make_chain('11110', 'A', 91) + make_chain('11140', 'A', 90)
        table = cr.measure(rows)
        by = {r['gu']: r for r in table}
        self.assertEqual(by['11110']['n_g'], 91)
        self.assertTrue(by['11110']['qualified'])
        self.assertEqual(by['11140']['n_g'], 90)
        self.assertFalse(by['11140']['qualified'])
        self.assertEqual(len(table), 25)
        self.assertEqual(by['11170']['n_g'], 0)  # 쌍 0개인 구도 표에 있다
        self.assertIsNone(by['11170']['r_g'])


class EndToEnd(unittest.TestCase):
    def write_root(self, rows, zero=()):
        tmp = tempfile.mkdtemp(prefix='repeat-synth-')
        for kind in ('sale', 'rent'):
            os.makedirs(os.path.join(tmp, 'raw', kind))
        with open(os.path.join(tmp, 'raw', 'sale', '11110-202411.json'), 'w', encoding='utf-8') as fh:
            json.dump({'totalCount': len(rows), 'items': rows}, fh)
        for kind, code, ym in zero:
            with open(os.path.join(tmp, 'raw', kind, f'{code}-{ym}.json'), 'w', encoding='utf-8') as fh:
                json.dump({'totalCount': 0, 'items': []}, fh)
        return tmp

    def run_main(self, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cr.main(argv)
        return buf.getvalue()

    def test_root_is_required_and_no_default(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cr.main([])

    def test_refuses_unpinned_root_without_flag(self):
        tmp = self.write_root(make_chain('11110', 'A', 3))  # git 저장소가 아닌 임시 디렉터리
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            cr.main(['--root', tmp])

    def test_header_and_table(self):
        rows = make_chain('11110', 'A', 5)
        tmp = self.write_root(rows, zero=[('sale', '11140', '202610')])
        def snapshot():
            return sorted((os.path.join(a, f), os.path.getmtime(os.path.join(a, f))) for a, _, fl in os.walk(tmp) for f in fl)

        before = snapshot()
        out = self.run_main(['--root', tmp, '--allow-unpinned'])
        for needle in ('git rev-parse HEAD:raw/sale', 'git hash-object', '파이썬 버전', '정렬된 파일 목록 sha256',
                       '0건 슬롯(totalCount=0) 1개 (구·월·종류): 11140-202610-sale',
                       '기간이 같지 않고 연율화도 없다', '판정: 접기', '고정 검증: 생략(--allow-unpinned)'):
            self.assertIn(needle, out)
        # 입력은 읽기 전용: 파일이 바뀌지 않았다
        self.assertEqual(before, snapshot())
        # 같은 입력이면 같은 출력(머리의 경로 줄 제외 전부)
        self.assertEqual(out, self.run_main(['--root', tmp, '--allow-unpinned']))

    def test_zero_slots_lists_only_slots(self):
        tmp = self.write_root([], zero=[('rent', '11110', '202610'), ('sale', '11140', '202610')])
        # 11110-202411.json(sale)은 totalCount가 행 수(0)라 0건 슬롯으로 잡힌다
        self.assertEqual(cr.zero_slots(tmp), [('11110', '202411', 'sale'), ('11110', '202610', 'rent'), ('11140', '202610', 'sale')])

    def test_blob_hash_matches_git(self):
        import subprocess
        p = os.path.join(HERE, 'count_repeat.py')
        try:
            want = subprocess.run(['git', 'hash-object', p], capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            self.skipTest('git 없음')
        self.assertEqual(cr.blob_hash(p), want)


if __name__ == '__main__':
    unittest.main()
