// 「같은 집이 다시 팔렸을 때」(반복거래 v0, #170 V8)의 계산. 순수 모듈 - 파일·시계를 읽지 않는다(빌더 build-repeat-sales.ts 가 읽어 넘긴다).
//
// 기준은 research/repeat-sales-2026-10/DESIGN.md 5-1절(개정 2)이고, 이 파일은 같은 폴더의 repeat_index_v0.py(+ count_repeat.py 의 쌍 만들기)를
// 한 줄씩 옮긴 것이다. 숫자·정의·시드는 5-1 ⑧ 로 고정이다 - 여기서 바꾸지 않는다(바꾸려면 DESIGN 에 새 판을 먼저 병합한다).
// 판정(#170 6402863306) ②: 입력 39c24811 을 넣으면 repeat_index_v0.out 1~3절 값과 소수 6자리까지 같아야 한다. 그래서 난수도
// 파이썬 random.Random(MT19937, seed·random·choices·sample·_randbelow)을 그대로 옮겼다 - 구간·흔들림까지 .out 과 같다
// (scripts/dev/verify-repeat-sales-v0.mjs 가 고정 입력으로 대조, 시험은 파이썬이 낸 난수열과 대조).
// 바뀌는 것은 창 하나다: 5-1 ② 「운영은 24개월·신고 기한이 닫힌 달까지(매일 이동, 화면에 창 표기)」. 창을 정하는 것은 windowFor().

// ---------------------------------------------------------------- 고정 값 (5-1 ①·②, count_repeat.py)

export const GU = [
  "11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290", "11305", "11320", "11350", "11380", "11410",
  "11440", "11470", "11500", "11530", "11545", "11560", "11590", "11620", "11650", "11680", "11710", "11740",
];
export const GAP_MIN = 300;
export const GAP_MAX = 730;
export const GU_THRESHOLD = 91;
export const GU_COUNT_THRESHOLD = 13;
export const BOOT_N = 400;
const BOOT_LO = 20;
const BOOT_HI = 379;
export const BOOT_SEED = 1;
const AREA_GROUP = 1;
const OUTLIER_LOG = Math.log(2);
const OUTLIER_FLAG_SHARE = 0.05;
const SIGN_MISMATCH_MAX = 3;
const SPEARMAN_MIN = 0.3;
const GAP_RHO_MAX = 0.5;
const JITTER_DROP = 0.1;
const JITTER_N = 50;
export const JITTER_SEED = 2;
export const RONE_SOURCE = "R-ONE A_2024_00045";
/** 5-1 ③ 사전 등록 창과 입력(출처 기록용, 계산에는 안 쓴다). */
export const REGISTERED = { window: ["202411", "202608"], input: "39c2481150a68f8862af5b0745889084da232c8b" } as const;
/** 5-1 ⑦. 이 모듈이 내는 글자와 화면 절에 0건이어야 한다. */
export const FORBIDDEN = ["오를", "내릴", "전망", "기대 수익"];

// ---------------------------------------------------------------- 파이썬 random 재현

/**
 * CPython random.Random 과 같은 난수열(MT19937 + init_by_array 시드). 쓰는 메서드만 옮겼다:
 * seed(정수) · random() · getrandbits(k≤32) · _randbelow · choices(k, 가중치 없음) · sample(range(n), k).
 */
export class PyRandom {
  mt = new Uint32Array(624);
  mti = 625;

  constructor(seed: number) {
    this.seed(seed);
  }

  /** random.seed(n): |n| 을 32비트 낱말(작은 쪽부터)로 쪼개 init_by_array. 0 이면 [0]. */
  seed(n: number) {
    let a = Math.abs(Math.trunc(n));
    const key: number[] = [];
    do {
      key.push(a % 0x100000000);
      a = Math.floor(a / 0x100000000);
    } while (a > 0);
    this.initByArray(key);
  }

  private initGenrand(s: number) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.mti = 624;
  }

  private initByArray(key: number[]) {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) >>> 0) + key[j] + j;
      i++;
      j++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) >>> 0) - i;
      i++;
      if (i >= 624) {
        mt[0] = mt[623];
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private next() {
    const mt = this.mt;
    if (this.mti >= 624) {
      for (let kk = 0; kk < 624; kk++) {
        const y = (mt[kk] & 0x80000000) | (mt[(kk + 1) % 624] & 0x7fffffff);
        mt[kk] = mt[(kk + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.mti = 0;
    }
    let y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this.next() >>> 5;
    const b = this.next() >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  }

  getrandbits(k: number) {
    return k >= 32 ? this.next() : this.next() >>> (32 - k);
  }

  randbelow(n: number) {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** random.choices(population, k=k) 의 뽑힌 자리들(가중치 없음: floor(random() * n)). */
  choiceIndexes(n: number, k: number) {
    const out = new Array(k);
    for (let i = 0; i < k; i++) out[i] = Math.floor(this.random() * n);
    return out;
  }

  /** random.sample(range(n), k). 파이썬과 같은 갈래(작은 n 은 목록 교환, 큰 n 은 집합 거르기)라 난수 소비가 같다. */
  sample(n: number, k: number) {
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    const out = new Array(k);
    if (n <= setsize) {
      const pool = Array.from({ length: n }, (_, i) => i);
      for (let i = 0; i < k; i++) {
        const j = this.randbelow(n - i);
        out[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i++) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        out[i] = j;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- 쌍 (count_repeat.py to_trades·build_houses, repeat_index_v0.py pair_units)

type Trade = { sgg: string; umd: string; apt: string; area: number; floor: string; day: number; ym: number; amount: number; order: number };
type Pair = { log: number; gap: number; ymA: number; ymB: number };

/** 파이썬 문자열 비교(코드 포인트 순). 서로게이트 쌍이 없으면 JS 의 < 와 같다. */
function cmpStr(a: string, b: string) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(i);
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

const blankToEmpty = (v: unknown) => (v == null || String(v).trim() === "" ? "" : String(v));

/** int(str(dealAmount).replace(',', '').strip()) */
const amountOf = (v: unknown) => {
  const t = String(v).replaceAll(",", "").trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error(`dealAmount 를 정수로 읽을 수 없다: ${v}`);
  return Number(t);
};

/** 파이썬 int(floor) 가 받는 모양(앞뒤 공백·부호·밑줄 묶음)만 수로 본다. 못 읽으면 null(정렬 맨 뒤). */
function floorInt(floor: string) {
  const t = floor.trim();
  return /^[+-]?\d+(_\d+)*$/.test(t) ? Number(t.replaceAll("_", "")) : null;
}

/** count_repeat.to_trades: 해제(cdealType 'O') 제거 → 중개거래만 → 창 안 계약월. 25구 밖 코드는 파이썬처럼 멈춘다. */
export function toTrades(rows: any[], window: readonly [string, string]) {
  const lo = Number(window[0]);
  const hi = Number(window[1]);
  const out: Trade[] = [];
  rows.forEach((r, order) => {
    if (r.cdealType === "O") return;
    if (r.dealingGbn !== "중개거래") return;
    const y = Number(r.dealYear);
    const m = Number(r.dealMonth);
    const ym = y * 100 + m;
    if (!(lo <= ym && ym <= hi)) return;
    const sgg = String(r.sggCd);
    if (!GU.includes(sgg)) throw new Error(`25구 밖의 sggCd: ${sgg}`);
    out.push({
      sgg,
      umd: blankToEmpty(r.umdNm),
      apt: blankToEmpty(r.aptNm),
      area: Number(r.excluUseAr),
      floor: r.floor == null ? "" : String(r.floor),
      day: Date.UTC(y, m - 1, Number(r.dealDay)) / 86_400_000,
      ym,
      amount: amountOf(r.dealAmount),
      order,
    });
  });
  return out;
}

/** count_repeat.area_labels: 작은 면적부터, 묶음 첫 면적과 1 이상 벌어지면 새 묶음. 이름은 거래가 가장 많은 면적(같으면 작은 쪽). */
function areaLabels(areas: number[]) {
  const counts = new Map<number, number>();
  for (const a of areas) counts.set(a, (counts.get(a) ?? 0) + 1);
  const label = new Map<number, number>();
  let group: number[] = [];
  const close = () => {
    if (!group.length) return;
    const name = [...group].sort((x, y) => counts.get(y) - counts.get(x) || x - y)[0];
    for (const a of group) label.set(a, name);
    group = [];
  };
  for (const a of [...counts.keys()].sort((x, y) => x - y)) {
    if (group.length && a - group[0] >= AREA_GROUP) close();
    group.push(a);
  }
  close();
  return label;
}

type HouseKey = { sgg: string; umd: string; apt: string; name: number; floor: string; fl: number | null };

function cmpHouse(a: HouseKey, b: HouseKey) {
  return (
    cmpStr(a.sgg, b.sgg) ||
    cmpStr(a.umd, b.umd) ||
    cmpStr(a.apt, b.apt) ||
    a.name - b.name ||
    // floor_sort_key: (0, int, 원문) < (1, 원문)
    (a.fl === null ? 1 : 0) - (b.fl === null ? 1 : 0) ||
    (a.fl !== null && b.fl !== null ? a.fl - b.fl : 0) ||
    cmpStr(a.floor, b.floor)
  );
}

/** count_repeat.build_houses: 집 키(구·동·단지·면적 묶음·층) 오름차순, 집 안은 계약일·금액·입력 순서. */
export function buildHouses(trades: Trade[]) {
  const byComplex = new Map<string, number[]>();
  const ck = (t: Trade) => `${t.sgg}\u0000${t.umd}\u0000${t.apt}`;
  for (const t of trades) {
    const k = ck(t);
    if (!byComplex.has(k)) byComplex.set(k, []);
    byComplex.get(k).push(t.area);
  }
  const labels = new Map([...byComplex].map(([k, a]) => [k, areaLabels(a)]));
  const houses = new Map<string, { key: HouseKey; list: Trade[] }>();
  for (const t of trades) {
    const name = labels.get(ck(t)).get(t.area);
    const k = `${ck(t)}\u0000${name}\u0000${t.floor}`;
    if (!houses.has(k)) houses.set(k, { key: { sgg: t.sgg, umd: t.umd, apt: t.apt, name, floor: t.floor, fl: floorInt(t.floor) }, list: [] });
    houses.get(k).list.push(t);
  }
  return [...houses.values()]
    .sort((a, b) => cmpHouse(a.key, b.key))
    .map(({ key, list }) => ({ key, list: list.sort((a, b) => a.day - b.day || a.amount - b.amount || a.order - b.order) }));
}

/** 인접한 두 거래, 간격 300~730일(양끝 포함). 쌍마다 로그 비율·간격·두 계약월. */
function housePairs(list: Trade[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i];
    const b = list[i + 1];
    const gap = b.day - a.day;
    if (GAP_MIN <= gap && gap <= GAP_MAX) out.push({ log: Math.log(b.amount / a.amount), gap, ymA: a.ym, ymB: b.ym });
  }
  return out;
}

/** A: |ln| > ln 2 를 뺀 뒤 구별 [집별 쌍 목록...](집 키 순), 그리고 구별 제외 전·제외 쌍 수. */
export function pairUnits(houses: { key: HouseKey; list: Trade[] }[]) {
  const units = new Map<string, Pair[][]>();
  const before = new Map<string, number>();
  const excluded = new Map<string, number>();
  for (const { key, list } of houses) {
    const recs = housePairs(list);
    if (!recs.length) continue;
    const g = key.sgg;
    const kept = recs.filter((p) => !(Math.abs(p.log) > OUTLIER_LOG));
    before.set(g, (before.get(g) ?? 0) + recs.length);
    excluded.set(g, (excluded.get(g) ?? 0) + recs.length - kept.length);
    if (kept.length) {
      if (!units.has(g)) units.set(g, []);
      units.get(g).push(kept);
    }
  }
  return { units, before, excluded };
}

// ---------------------------------------------------------------- 통계

function median(values: ArrayLike<number>) {
  const s = Float64Array.from(values).sort();
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 뽑힌 집들의 쌍 로그를 모두 모아(중복 포함) 중앙값. */
function logsMedian(units: Pair[][]) {
  let n = 0;
  for (const u of units) n += u.length;
  const buf = new Float64Array(n);
  let i = 0;
  for (const u of units) for (const p of u) buf[i++] = p.log;
  return median(buf);
}

function bootInterval(units: Pair[][], rnd: PyRandom) {
  const boots = new Float64Array(BOOT_N);
  for (let b = 0; b < BOOT_N; b++) boots[b] = logsMedian(rnd.choiceIndexes(units.length, units.length).map((i) => units[i]));
  boots.sort();
  return [boots[BOOT_LO], boots[BOOT_HI]];
}

function jitterRange(units: Pair[][], rng: PyRandom) {
  const h = units.length;
  const drop = Math.floor(h * JITTER_DROP);
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < JITTER_N; r++) {
    const gone = new Set(rng.sample(h, drop));
    const m = logsMedian(units.filter((_, i) => !gone.has(i)));
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  return hi - lo;
}

function ranks(xs: number[]) {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1]] === xs[order[i]]) j++;
    for (let k = i; k <= j; k++) r[order[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

/** 스피어만(평균 순위의 피어슨). 둘 미만이거나 분산 0 이면 null. */
export function spearman(xs: number[], ys: number[]) {
  if (xs.length < 2) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

const sign = (x: number) => (x > 0 ? 1 : 0) - (x < 0 ? 1 : 0);

// ---------------------------------------------------------------- R-ONE (C)

/** {구: {계약월(수): 지수}}. 계열이 5-1 ③ 의 것이 아니면 멈춘다. */
export function loadRone(d: any) {
  if (d?.source !== RONE_SOURCE) throw new Error(`R-ONE 계열이 ${RONE_SOURCE} 이 아니다: ${d?.source}`);
  const out = new Map<string, Map<number, number>>();
  for (const [g, rows] of Object.entries(d.series ?? {})) out.set(g, new Map((rows as any[]).map(([m, v]) => [Number(m), Number(v)])));
  return out;
}

/** 쌍마다 ln(R[뒤]/R[앞]). 뒤 계약월이 계열 최신 달보다 늦거나 앞·뒤 달이 없으면 비교에서만 뺀다. */
function roneLogs(pairs: Pair[], series: Map<number, number> | undefined) {
  if (!series?.size) return { vals: [], dropped: pairs.length };
  const latest = Math.max(...series.keys());
  const vals: number[] = [];
  let dropped = 0;
  for (const p of pairs) {
    if (p.ymB > latest || !series.has(p.ymA) || !series.has(p.ymB)) dropped++;
    else vals.push(Math.log(series.get(p.ymB) / series.get(p.ymA)));
  }
  return { vals, dropped };
}

// ---------------------------------------------------------------- 계산 (repeat_index_v0.compute·checks)

export function compute(rows: any[], rone: Map<string, Map<number, number>>, window: readonly [string, string]) {
  const { units, before, excluded } = pairUnits(buildHouses(toTrades(rows, window)));
  const flat = (u: Pair[][]) => u.flat();
  const rnd = new PyRandom(BOOT_SEED); // 5-1 ③: 구 반복(sggCd 오름차순) 직전에 한 번
  const table = new Map<string, any>();
  for (const g of [...units.keys()].sort()) {
    const [lo, hi] = bootInterval(units.get(g), rnd);
    table.set(g, { median: logsMedian(units.get(g)), lo, hi, width: hi - lo, gapMedian: median(flat(units.get(g)).map((p) => p.gap)) });
  }
  const out = GU.map((g) => {
    const b = before.get(g) ?? 0;
    const x = excluded.get(g) ?? 0;
    const u = units.get(g) ?? [];
    const n = flat(u).length;
    const { vals, dropped } = u.length ? roneLogs(flat(u), rone.get(g)) : { vals: [], dropped: 0 };
    const stat = table.get(g) ?? null;
    const r = median(vals);
    return {
      gu: g, before: b, excluded: x, n, houses: u.length, qualified: n >= GU_THRESHOLD, stat,
      manyOutliers: b > 0 && x / b > OUTLIER_FLAG_SHARE,
      rone: r, roneN: vals.length, roneDropped: dropped,
      diff: stat && r !== null ? stat.median - r : null,
      jitter: null as number | null, shaky: false,
    };
  });
  const rng = new PyRandom(JITTER_SEED); // F: 별도 난수, 구 sggCd 오름차순·회차 순
  for (const r of out) {
    if (!r.qualified) continue;
    r.jitter = jitterRange(units.get(r.gu), rng);
    r.shaky = r.jitter > r.stat.width;
  }
  rnd.seed(BOOT_SEED); // 서울 참고 값 직전에 다시
  const seoulUnits = [...units.keys()].sort().flatMap((g) => units.get(g));
  let seoul = null;
  if (seoulUnits.length) {
    const [lo, hi] = bootInterval(seoulUnits, rnd);
    const all: number[] = [];
    let dropped = 0;
    for (const g of [...units.keys()].sort()) {
      const res = roneLogs(flat(units.get(g)), rone.get(g));
      all.push(...res.vals);
      dropped += res.dropped;
    }
    seoul = { n: flat(seoulUnits).length, houses: seoulUnits.length, median: logsMedian(seoulUnits), lo, hi, rone: median(all), roneN: all.length, roneDropped: dropped };
  }
  return { rows: out, seoul };
}

export function checks(rows: ReturnType<typeof compute>["rows"]) {
  const q = rows.filter((r) => r.qualified);
  const mismatch = q
    .filter((r) => r.rone !== null && (r.stat.lo > 0 || r.stat.hi < 0) && sign(r.stat.median) !== sign(r.rone))
    .map((r) => r.gu);
  const qr = q.filter((r) => r.rone !== null);
  const rho = spearman(qr.map((r) => r.stat.median), qr.map((r) => r.rone));
  const killSign = mismatch.length >= SIGN_MISMATCH_MAX;
  const killRho = rho === null || rho < SPEARMAN_MIN; // 계산할 수 없으면 정합을 보이지 못한 것으로 본다
  const gapRho = spearman(q.map((r) => r.stat.median), q.map((r) => r.stat.gapMedian));
  const published = q.filter((r) => !r.shaky).map((r) => r.gu);
  const enough = published.length >= GU_COUNT_THRESHOLD;
  return {
    qualified: q.length, mismatch, killSign, rho, killRho, kill: killSign || killRho, gapRho,
    dropCompare: gapRho !== null && Math.abs(gapRho) >= GAP_RHO_MAX,
    shaky: q.filter((r) => r.shaky).map((r) => r.gu), published, enough,
    manyOutliers: rows.filter((r) => r.manyOutliers).map((r) => r.gu),
    pass: enough && !(killSign || killRho),
  };
}

// ---------------------------------------------------------------- 창 (5-1 ②)

const monthIndex = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(4, 6)) - 1;
const fromIndex = (i: number) => `${Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`;

/**
 * 운영 창: 원본 24개월(이번 달 포함, 수집기 창과 같다)의 첫 달 ~ 신고 기한(계약 후 30일)이 닫힌 마지막 달.
 * 닫힌 달은 갈아타기와 같은 규칙(이번 달 −2, build-district-change.ts)이다. 2026-10 이면 202411~202608 = 사전 등록 창(5-1 ③)과 같다.
 */
export function windowFor(thisMonth: string): [string, string] {
  const i = monthIndex(thisMonth);
  return [fromIndex(i - 23), fromIndex(i - 2)];
}

// ---------------------------------------------------------------- 내보내는 JSON

const r6 = (x: number | null) => (x === null ? null : Number(x.toFixed(6)));
const r4 = (x: number | null) => (x === null ? null : Number(x.toFixed(4)));
/** 화면의 % (expm1 × 100, 소수 1자리). 반올림 전 값에서 낸다 - 6자리로 자른 로그에서 다시 내면 .out 의 % 와 경계에서 갈린다(11740 구간 하한 +23.8% 가 +23.7% 로). */
const pct1 = (x: number | null) => (x === null ? null : Number((Math.expm1(x) * 100).toFixed(1)));

/**
 * docs/data/repeat-sales.json 의 몸통. 값은 .out 과 같은 로그 척도 소수 6자리(.out 1·2절의 그 숫자)와, 화면에 쓰는 % 소수 1자리 p
 * ([중앙값, 구간 하한, 구간 상한, 부동산원 쌍맞춤], 서울은 [중앙값, 부동산원]) - .out 의 % 칸과 같다.
 * 값을 비우는 구(91쌍 미만·흔들림)는 쌍 수와 사유만 싣는다 - 비운 값은 내보내지 않는다.
 */
export function payload(result: ReturnType<typeof compute>, window: readonly [string, string], provenance: Record<string, unknown>) {
  const c = checks(result.rows);
  const rows = result.rows.map((r) => {
    const st = !r.qualified ? "thin" : r.shaky ? "shaky" : "ok";
    const base: Record<string, unknown> = { gu: r.gu, n: r.n, st };
    if (r.manyOutliers) base.out = 1;
    if (st !== "ok") return base;
    return { ...base, m: r6(r.stat.median), lo: r6(r.stat.lo), hi: r6(r.stat.hi), gap: r.stat.gapMedian, r: r6(r.rone), p: [pct1(r.stat.median), pct1(r.stat.lo), pct1(r.stat.hi), pct1(r.rone)] };
  });
  const withDiff = result.rows.filter((r) => r.diff !== null);
  const s = result.seoul;
  return {
    window: { from: window[0], to: window[1], gap: [GAP_MIN, GAP_MAX] },
    rows,
    seoul: s ? { n: s.n, m: r6(s.median), lo: r6(s.lo), hi: r6(s.hi), r: r6(s.rone), p: [pct1(s.median), pct1(s.rone)] } : null,
    // 판정(#170) ③ 문장의 근거: 쌍 중앙값이 부동산원 쌍맞춤보다 큰 구 수 / 둘 다 있는 구 수(값을 비운 구 포함 - .out 1절 「차이」).
    higher: withDiff.filter((r) => r.diff > 0).length,
    compared: withDiff.length,
    checks: {
      qualified: c.qualified, mismatch: c.mismatch.length, rho: r4(c.rho), kill: c.kill, gapRho: r4(c.gapRho), dropCompare: c.dropCompare,
      shaky: c.shaky, published: c.published.length, enough: c.enough, manyOutliers: c.manyOutliers,
    },
    provenance,
  };
}
