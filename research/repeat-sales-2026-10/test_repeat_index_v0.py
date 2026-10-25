"""repeat_index_v0.py 시험 - 합성 입력만 쓴다. 실데이터 raw/는 열지 않는다.

    python3 -I research/repeat-sales-2026-10/test_repeat_index_v0.py

`npm test`는 test/repeat-index-v0.test.mjs가 이 파일을 돌린다. 항목은 DESIGN 5-1의 A~F·판정·고정 검증이다.
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
spec = importlib.util.spec_from_file_location('repeat_index_v0', os.path.join(HERE, 'repeat_index_v0.py'))
ri = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ri)


def row(day, amount, *, gu='11110', apt='A단지', floor='5', area=84.0):
    return {'sggCd': gu, 'umdNm': '가동', 'aptNm': apt, 'excluUseAr': area, 'floor': floor,
            'dealYear': day.year, 'dealMonth': day.month, 'dealDay': day.day,
            'dealAmount': f'{amount:,}', 'dealingGbn': '중개거래'}


def house_rows(gu, i, ratio, *, start=D.date(2024, 12, 1), gap=400, base=100000):
    """집 하나에 쌍 하나(간격 gap일, 비율 ratio)."""
    return [row(start, base, gu=gu, apt=f'단지{i}'), row(start + D.timedelta(days=gap), round(base * ratio), gu=gu, apt=f'단지{i}')]


def gu_rows(gu, n, ratios, **kw):
    out = []
    for i in range(n):
        out += house_rows(gu, i, ratios[i % len(ratios)], **kw)
    return out


def flat_rone(gu_list, slope):
    """구마다 매달 slope 비율로 움직이는 합성 R-ONE(202401~202609)."""
    months = [y * 100 + m for y in (2024, 2025, 2026) for m in range(1, 13) if y * 100 + m <= 202609]
    return {g: {ym: 100 * (1 + slope[g]) ** k for k, ym in enumerate(months)} for g in gu_list}


class Outlier(unittest.TestCase):
    def test_boundary_ln2_kept_and_beyond_excluded(self):
        rows = house_rows('11110', 0, 2.0) + house_rows('11110', 1, 2.01) + house_rows('11110', 2, 0.5) + house_rows('11110', 3, 0.49)
        units, before, excl = ri.pair_units(ri.cr.build_houses(ri.cr.to_trades(rows)))
        self.assertEqual(before['11110'], 4)
        self.assertEqual(excl['11110'], 2)
        self.assertEqual(len(units['11110']), 2)

    def test_threshold_applies_after_exclusion(self):
        # 제외 전 92쌍, 이상치 2쌍 -> n_g 90: 문턱 미달
        rows = gu_rows('11110', 90, [1.05]) + [r for i in range(2) for r in house_rows('11110', 500 + i, 3.0)]
        out, _ = ri.compute(rows, flat_rone(ri.GU, {g: 0.003 for g in ri.GU}))
        r = out[0]
        self.assertEqual((r['before'], r['excluded'], r['n_g'], r['qualified']), (92, 2, 90, False))

    def test_many_outliers_flag_over_5pct(self):
        rows = gu_rows('11110', 94, [1.05]) + [x for i in range(6) for x in house_rows('11110', 900 + i, 3.0)]
        out, _ = ri.compute(rows, flat_rone(ri.GU, {g: 0.003 for g in ri.GU}))
        self.assertTrue(out[0]['many_outliers'])  # 6/100 > 5%
        rows = gu_rows('11110', 95, [1.05]) + [x for i in range(5) for x in house_rows('11110', 900 + i, 3.0)]
        out, _ = ri.compute(rows, flat_rone(ri.GU, {g: 0.003 for g in ri.GU}))
        self.assertFalse(out[0]['many_outliers'])  # 5/100 = 5%, 넘지 않음


class Rone(unittest.TestCase):
    def test_pair_matched_and_late_pairs_dropped_from_comparison_only(self):
        s = {ym: 100.0 + i for i, ym in enumerate([202412, 202501, 202601, 202602])}
        units = [[ri.Pair(0.1, 400, 202412, 202601), ri.Pair(0.2, 400, 202501, 202603)]]
        med, n, dropped = ri.rone_match(units, s)
        self.assertEqual((n, dropped), (1, 1))
        self.assertAlmostEqual(med, math.log(102 / 100))

    def test_missing_series_marks_fallback(self):
        rone = flat_rone([g for g in ri.GU if g != '11110'], {g: 0.003 for g in ri.GU})
        out, _ = ri.compute(gu_rows('11110', 5, [1.05]), rone)
        self.assertTrue(out[0]['rone_fallback'])
        self.assertIsNone(out[0]['rone'])


class Stats(unittest.TestCase):
    def test_spearman(self):
        self.assertAlmostEqual(ri.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1.0)
        self.assertAlmostEqual(ri.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1.0)
        self.assertEqual(ri.ranks([5, 1, 5, 2]), [3.5, 1, 3.5, 2])
        self.assertIsNone(ri.spearman([1, 1, 1], [1, 2, 3]))


def fake_rows(specs):
    """specs: [(gu, median, lo, hi, rone, gap_median, shaky)] -> checks()가 읽는 행."""
    return [{'gu': g, 'qualified': True, 'rone': rn, 'shaky': sh, 'many_outliers': False,
             'stat': {'median': m, 'lo': lo, 'hi': hi, 'width': hi - lo, 'gap_median': gm}}
            for g, m, lo, hi, rn, gm, sh in specs]


class KillSwitch(unittest.TestCase):
    def base(self, n=13):
        return [(f'g{i:02d}', 0.01 * (i + 1), 0.005 * (i + 1), 0.02 * (i + 1), 0.01 * (i + 1), 400 + (i * 37) % 13, False)
                for i in range(n)]

    def test_pass_when_aligned(self):
        c = ri.checks(fake_rows(self.base()))
        self.assertTrue(c['pass'])
        self.assertAlmostEqual(c['rho'], 1.0)

    def test_sign_mismatch_counts_only_when_interval_excludes_zero(self):
        s = self.base()
        # 세 구의 R-ONE 부호를 뒤집되 그중 하나는 우리 구간이 0을 포함 -> 2곳만 센다
        for k in (0, 1):
            g, m, lo, hi, rn, gm, sh = s[k]
            s[k] = (g, m, lo, hi, -rn, gm, sh)
        g, m, lo, hi, rn, gm, sh = s[2]
        s[2] = (g, m, -0.01, hi, -rn, gm, sh)
        c = ri.checks(fake_rows(s))
        self.assertEqual(len(c['mismatch']), 2)
        self.assertFalse(c['kill_sign'])
        g, m, lo, hi, rn, gm, sh = s[3]
        s[3] = (g, m, lo, hi, -rn, gm, sh)
        c = ri.checks(fake_rows(s))
        self.assertTrue(c['kill_sign'])
        self.assertFalse(c['pass'])

    def test_low_rank_corr_kills(self):
        s = self.base()
        rev = [x[4] for x in s][::-1]
        s = [(g, m, lo, hi, rev[i], gm, sh) for i, (g, m, lo, hi, rn, gm, sh) in enumerate(s)]
        c = ri.checks(fake_rows(s))
        self.assertTrue(c['kill_rho'])
        self.assertFalse(c['pass'])

    def test_shaky_reduces_published_count(self):
        s = self.base()
        g, m, lo, hi, rn, gm, sh = s[0]
        s[0] = (g, m, lo, hi, rn, gm, True)
        c = ri.checks(fake_rows(s))
        self.assertEqual(len(c['published']), 12)
        self.assertFalse(c['enough'])
        self.assertFalse(c['pass'])

    def test_gap_correlation_drops_comparison_only(self):
        s = [(g, m, lo, hi, rn, 300 + i, sh) for i, (g, m, lo, hi, rn, gm, sh) in enumerate(self.base())]
        c = ri.checks(fake_rows(s))
        self.assertTrue(c['drop_compare'])
        self.assertTrue(c['pass'])


class Jitter(unittest.TestCase):
    def test_drops_floor_10pct_and_50_runs(self):
        units = [[ri.Pair(0.05, 400, 202412, 202601)] for _ in range(19)]  # 10% 내림 = 1채
        self.assertEqual(ri.jitter_range(units, ri.random.Random(2)), 0)

    def test_shaky_rule_uses_full_width(self):
        rows = gu_rows('11110', 95, [1.05])
        out, _ = ri.compute(rows, flat_rone(ri.GU, {g: 0.003 for g in ri.GU}))
        r = out[0]
        self.assertEqual(r['jitter'], 0)  # 모두 같은 값: 폭 0, 흔들림 0 -> 0 > 0 아님
        self.assertFalse(r['shaky'])


class EndToEnd(unittest.TestCase):
    def write_root(self, tmp, rows, rone):
        os.makedirs(os.path.join(tmp, 'raw', 'sale'))
        os.makedirs(os.path.join(tmp, 'raw', 'indicators'))
        with open(os.path.join(tmp, 'raw', 'sale', '11110-202412.json'), 'w', encoding='utf-8') as fh:
            json.dump({'items': rows, 'totalCount': len(rows)}, fh, ensure_ascii=False)
        with open(os.path.join(tmp, ri.RONE_FILE), 'w', encoding='utf-8') as fh:
            json.dump({'source': ri.RONE_SOURCE, 'series': {g: [[str(k), v] for k, v in sorted(s.items())] for g, s in rone.items()}}, fh)

    def run_main(self, args):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            ri.main(args)
        return buf.getvalue()

    def test_deterministic_and_no_forbidden_words(self):
        rows = []
        slope = {g: 0.001 * (i + 1) for i, g in enumerate(ri.GU)}
        for i, g in enumerate(ri.GU[:14]):
            rows += gu_rows(g, 92, [1 + slope[g] * 13 * k for k in (0.6, 0.8, 1.0, 1.2, 1.4)])
        with tempfile.TemporaryDirectory() as tmp:
            self.write_root(tmp, rows, flat_rone(ri.GU, slope))
            a = self.run_main(['--root', tmp, '--allow-unpinned'])
            b = self.run_main(['--root', tmp, '--allow-unpinned'])
        self.assertEqual(a, b)
        for w in ri.FORBIDDEN:
            self.assertNotIn(w, a)
        self.assertIn('판정: 통과', a)
        self.assertIn('쌍이 모자람(0쌍)', a)

    def test_unpinned_root_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_root(tmp, [], {})
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                ri.main(['--root', tmp])

    def test_forbidden_guard(self):
        with self.assertRaises(ValueError):
            ri.check_forbidden('값이 전망된다')


if __name__ == '__main__':
    unittest.main()
