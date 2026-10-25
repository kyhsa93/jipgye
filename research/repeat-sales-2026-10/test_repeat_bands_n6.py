"""repeat_bands_n6.py 시험 - 합성 입력만 쓴다. 실데이터 raw/는 열지 않는다.

    python3 -I research/repeat-sales-2026-10/test_repeat_bands_n6.py

`npm test`는 test/repeat-bands-n6.test.mjs가 이 파일을 돌린다. 항목은 DESIGN 5-2의 ①~⑦·고정 검증이다.
"""
import contextlib
import datetime as D
import importlib.util
import io
import json
import math
import os
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('repeat_bands_n6', os.path.join(HERE, 'repeat_bands_n6.py'))
rb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rb)


def row(day, amount, *, gu='11110', apt='A단지', floor='5', area=84.0):
    return {'sggCd': gu, 'umdNm': '가동', 'aptNm': apt, 'excluUseAr': area, 'floor': floor,
            'dealYear': day.year, 'dealMonth': day.month, 'dealDay': day.day,
            'dealAmount': f'{amount:,}', 'dealingGbn': '중개거래'}


def house(i, front, ratio, *, gu='11110', gap=400):
    start = D.date(2024, 12, 1)
    return [row(start, front, gu=gu, apt=f'단지{i}'), row(start + D.timedelta(days=gap), round(front * ratio), gu=gu, apt=f'단지{i}')]


def three_band_rows(per_band, ratios, gaps=(400, 400, 400), gu='11110'):
    """앞 거래가가 모두 다른 집 3*per_band채. 가격대마다 같은 비율."""
    rows = []
    for k in range(3):
        for m in range(per_band):
            i = k * per_band + m
            rows += house(i, 30000 + i * 100, ratios[k], gu=gu, gap=gaps[k])
    return rows


class Boundaries(unittest.TestCase):
    def test_ceil_index_no_interpolation(self):
        self.assertEqual(rb.boundaries(list(range(1, 10))), (3, 6))      # N=9
        self.assertEqual(rb.boundaries(list(range(1, 11))), (4, 7))      # N=10: ceil(10/3)=4, ceil(20/3)=7
        self.assertEqual(rb.boundaries([7]), (7, 7))
        with self.assertRaises(ValueError):
            rb.boundaries([])

    def test_ceil_index_six(self):
        # N=6: x(2), x(4) (정렬 1 2 3 5 7 9)
        self.assertEqual(rb.boundaries([9, 1, 5, 3, 7, 2]), (2, 5))

    def test_edges_inclusive_to_lower_band(self):
        self.assertEqual([rb.band_of(v, 10, 20) for v in (9, 10, 11, 20, 21)], [0, 0, 1, 1, 2])

    def test_ties_not_split(self):
        b1, b2 = rb.boundaries([5] * 6 + [9] * 3)
        self.assertEqual((b1, b2), (5, 5))
        self.assertEqual([rb.band_of(5, b1, b2), rb.band_of(9, b1, b2)], [0, 2])

    def test_house_may_sit_in_two_bands(self):
        P = rb.Pair
        units = [[P(0.1, 400, 10), P(0.2, 400, 30)], [P(0.1, 400, 20)]]
        bands = rb.split_bands(units, 10, 20)
        self.assertEqual([len(b) for b in bands], [1, 1, 1])
        self.assertEqual([[p.front for p in h] for h in bands[0]], [[10]])
        self.assertEqual([[p.front for p in h] for h in bands[2]], [[30]])

    def test_front_price_is_earlier_trade_not_later(self):
        units, before, excl = rb.pair_units(rb.cr.build_houses(rb.cr.to_trades(house(0, 50000, 1.3))))
        self.assertEqual((before, excl), (1, 0))
        self.assertEqual(units[0][0].front, 50000)

    def test_outlier_excluded_before_boundaries(self):
        rows = house(0, 10000, 2.0) + house(1, 20000, 2.01) + house(2, 30000, 0.5) + house(3, 40000, 0.49)
        units, before, excl = rb.pair_units(rb.cr.build_houses(rb.cr.to_trades(rows)))
        self.assertEqual((before, excl, len(units)), (4, 2, 2))
        self.assertEqual(sorted(p.front for h in units for p in h), [10000, 30000])


class Compute(unittest.TestCase):
    def test_bands_values_threshold_and_sum(self):
        rows = three_band_rows(100, (1.20, 1.10, 1.00))
        res = rb.compute(rows, 300)
        st = res['stats']
        self.assertEqual([s['n'] for s in st], [100, 100, 100])
        self.assertAlmostEqual(st[0]['median'], math.log(1.20), places=6)
        self.assertTrue(all(s['qualified'] for s in st))
        self.assertEqual(res['b1'], 30000 + 99 * 100)
        self.assertEqual(res['b2'], 30000 + 199 * 100)
        j = rb.judge(res, None)
        self.assertTrue(j['table_public'])
        self.assertEqual([v[2] for v in j['verdicts']], [True, True, True])   # 폭 0, 값이 다르면 겹치지 않음
        self.assertEqual([v[3] for v in j['verdicts']], [-1, -1, -1])         # 높은 쪽이 더 작음

    def test_threshold_91_boundary(self):
        res = rb.compute(three_band_rows(91, (1.2, 1.1, 1.0)), 273)
        self.assertTrue(all(s['qualified'] for s in res['stats']))
        res = rb.compute(three_band_rows(90, (1.2, 1.1, 1.0)), 270)
        self.assertFalse(any(s['qualified'] for s in res['stats']))
        self.assertFalse(rb.judge(res, None)['table_public'])

    def test_sum_mismatch_stops_without_values(self):
        with self.assertRaises(rb.SumMismatch):
            rb.compute(three_band_rows(100, (1.2, 1.1, 1.0)), 6324)

    def test_empty_band_stops(self):
        rows = []
        for i in range(9):
            rows += house(i, 50000, 1.1)  # 모든 앞 거래가 같음 -> 가운데 가격대가 비다
        with self.assertRaises(rb.SumMismatch):
            rb.compute(rows, None)

    def test_gap_rule_90_days(self):
        res = rb.compute(three_band_rows(100, (1.2, 1.1, 1.0), gaps=(310, 350, 399)), 300)
        j = rb.judge(res, None)
        self.assertEqual(j['gap_spread'], 89)
        self.assertFalse(j['drop_diff'])
        res = rb.compute(three_band_rows(100, (1.2, 1.1, 1.0), gaps=(310, 350, 400)), 300)
        j = rb.judge(res, None)
        self.assertEqual(j['gap_spread'], 90)   # 90일 이상이면 삭제
        self.assertTrue(j['drop_diff'])

    def test_jitter_rule_uses_full_width(self):
        res = rb.compute(three_band_rows(100, (1.2, 1.1, 1.0)), 300)
        for s in res['stats']:
            self.assertEqual(s['jitter'], 0)
            self.assertFalse(s['shaky'])

    def test_bootstrap_units_are_houses(self):
        # 집 100채(쌍 2개씩이 아니라 1개씩) - 구간이 존재하고 정렬돼 있다
        res = rb.compute(three_band_rows(100, (1.2, 1.1, 1.0)), 300)
        for s in res['stats']:
            self.assertLessEqual(s['lo'], s['median'])
            self.assertGreaterEqual(s['hi'], s['median'])
            self.assertEqual(s['houses'], 100)


class Overlap(unittest.TestCase):
    def test_touching_endpoints_overlap(self):
        self.assertTrue(rb.overlaps({'lo': 0, 'hi': 1}, {'lo': 1, 'hi': 2}))
        self.assertTrue(rb.overlaps({'lo': 0, 'hi': 2}, {'lo': 1, 'hi': 3}))
        self.assertFalse(rb.overlaps({'lo': 0, 'hi': 1}, {'lo': 1.0001, 'hi': 2}))
        self.assertFalse(rb.overlaps({'lo': 3, 'hi': 4}, {'lo': 0, 'hi': 2.9}))

    def test_verdict_direction_and_pairs(self):
        st = [{'median': 0.1, 'lo': 0.0, 'hi': 0.2}, {'median': 0.15, 'lo': 0.1, 'hi': 0.25}, {'median': 0.5, 'lo': 0.4, 'hi': 0.6}]
        v = rb.diff_verdicts(st)
        self.assertEqual([(a, b) for a, b, _o, _d in v], [(0, 1), (1, 2), (0, 2)])
        self.assertEqual([o for _a, _b, o, _d in v], [False, True, True])
        self.assertEqual([d for _a, _b, _o, d in v], [1, 1, 1])


class N4(unittest.TestCase):
    def st(self, m):
        return [{'median': x} for x in m]

    def test_band_edges_lo_exclusive_hi_inclusive(self):
        self.assertEqual([rb.n4_band_of(p) for p in (1, 60000, 60001, 90000, 150000, 250000, 250001)], [0, 0, 1, 1, 2, 3, 4])

    def test_show_when_two_of_three_agree(self):
        # N6 중앙값 앞 거래가 -> N4 가격대 0, 2, 4
        fronts = [[50000], [100000], [300000]]
        c = rb.n4_check(self.st([0.3, 0.2, 0.1]), fronts, [10, 17, 24, 17, 4])
        self.assertEqual(c['map'], [0, 2, 4])
        # (0,1): N6 -1, N4 +1 불일치 / (1,2): N6 -1, N4 -1 일치 / (0,2): N6 -1, N4 -1 일치
        self.assertEqual([p[5] for p in c['pairs']], [False, True, True])
        self.assertEqual((c['comparable'], c['agree'], c['show']), (3, 2, True))

    def test_fold_when_only_one_agrees(self):
        fronts = [[50000], [100000], [300000]]
        c = rb.n4_check(self.st([0.1, 0.2, 0.3]), fronts, [10, 17, 24, 17, 4])
        self.assertEqual([p[5] for p in c['pairs']], [True, False, False])
        self.assertEqual((c['agree'], c['show']), (1, False))

    def test_same_n4_band_not_comparable_and_fold(self):
        fronts = [[50000], [70000], [80000]]   # 0, 1, 1
        c = rb.n4_check(self.st([0.1, 0.2, 0.3]), fronts, [10, 17, 24, 17, 4])
        self.assertEqual([p[2] for p in c['pairs']], [True, False, True])
        self.assertEqual((c['comparable'], c['agree'], c['show']), (2, 2, True))
        fronts = [[50000], [50000], [80000]]   # 0, 0, 1 -> 비교 가능 2쌍
        c = rb.n4_check(self.st([0.1, 0.2, 0.3]), fronts, [10, 17, 24, 17, 4])
        self.assertEqual(c['comparable'], 2)
        fronts = [[50000], [50000], [50000]]   # 비교 가능 0
        c = rb.n4_check(self.st([0.1, 0.2, 0.3]), fronts, [10, 17, 24, 17, 4])
        self.assertEqual((c['comparable'], c['show']), (0, False))

    def test_zero_difference_is_not_agreement(self):
        fronts = [[50000], [70000], [100000]]   # 0, 1, 2
        c = rb.n4_check(self.st([0.1, 0.2, 0.3]), fronts, [10, 10, 10, 17, 4])
        self.assertEqual([p[5] for p in c['pairs']], [False, False, False])
        self.assertFalse(c['show'])

    def test_load_n4_reads_price_keys_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = os.path.join(tmp, 's.json')
            with open(p, 'w', encoding='utf-8') as fh:
                json.dump({'price': [{'key': k, 'change': i} for i, (k, _a, _b) in reversed(list(enumerate(rb.N4_BANDS)))]}, fh)
            self.assertEqual(rb.load_n4(p), [0, 1, 2, 3, 4])


class EndToEnd(unittest.TestCase):
    def write_root(self, tmp, rows):
        os.makedirs(os.path.join(tmp, 'raw', 'sale'))
        with open(os.path.join(tmp, 'raw', 'sale', '11110-202412.json'), 'w', encoding='utf-8') as fh:
            json.dump({'items': rows, 'totalCount': len(rows)}, fh, ensure_ascii=False)

    def run_main(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rb.main(args)
        return buf.getvalue()

    def test_deterministic_and_no_forbidden_words(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_root(tmp, three_band_rows(100, (1.20, 1.10, 1.00)))
            args = ['--root', tmp, '--allow-unpinned', '--expect-pairs', '300', '--n4', os.path.join(tmp, 'none.json')]
            a = self.run_main(args)
            b = self.run_main(args)
        self.assertEqual(a, b)
        for w in rb.FORBIDDEN:
            self.assertNotIn(w, a)
        self.assertIn('B1 = 39900', a)
        self.assertIn('N4 산출이 없어', a)
        self.assertIn('고정 검증: 생략(--allow-unpinned)', a)

    def test_sum_mismatch_prints_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_root(tmp, three_band_rows(100, (1.2, 1.1, 1.0)))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf), self.assertRaises(rb.SumMismatch):
                rb.main(['--root', tmp, '--allow-unpinned', '--expect-pairs', '6324'])
            self.assertEqual(buf.getvalue(), '')

    def test_unpinned_root_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_root(tmp, [])
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                rb.main(['--root', tmp])

    def test_forbidden_guard(self):
        with self.assertRaises(ValueError):
            rb.check_forbidden('값이 전망된다')

    def test_fixed_constants_match_design(self):
        self.assertEqual(rb.INPUT_COMMIT, '39c2481150a68f8862af5b0745889084da232c8b')
        self.assertEqual(rb.RAW_SALE_TREE, '0578a78dc2647aa967adbb309045eb50a430b7e9')
        self.assertEqual((rb.BAND_THRESHOLD, rb.MIN_BANDS, rb.GAP_SPREAD_MAX, rb.BOOT_SEED, rb.JITTER_SEED), (91, 3, 90, 1, 2))
        self.assertEqual((rb.ri.BOOT_N, rb.ri.JITTER_N, rb.ri.JITTER_DROP), (400, 50, 0.10))
        self.assertEqual(rb.EXPECTED_SEOUL_PAIRS, 6324)


if __name__ == '__main__':
    unittest.main()
