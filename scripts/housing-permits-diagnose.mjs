/**
 * 건축HUB 응답 진단 (#147, #133 data-engineer 명세, PREREG 명확화 2의 입력). 순수 계산 - 네트워크도 파일도 안 쓴다.
 *
 * 출력은 **개수·비율·연도 히스토그램·코드성 범주 값뿐**이다. 관리번호·사업명·주소·지번·날짜 원문은 어떤 형태로도
 * 내지 않는다(소유자 조건 1·#141 마스킹과 같은 규칙). 값은 add()에서 곧바로 개수로 줄이고 들고 있지 않는다 -
 * 들고 있는 것은 카운터와, 중복 검사용 해시 집합(해시 자체는 출력하지 않고 크기만 낸다)이다.
 *
 * 공개 범위를 정한 규칙:
 *  - 칸(연도·범주)의 건수가 3 미만이면 "기타"로 합쳐 칸 이름을 내지 않는다(소유자 조건 2의 정신, cpo 교차검증).
 *    연도 최소·최대도 이 규칙을 따라 3 이상인 칸 안에서만 낸다 - 건수 1~2인 연도가 기타에 숨는 것과 같은 이유다.
 *  - 범주 값은 허용 목록(CATEGORY_FIELDS: 코드 필드 셋)만 낸다. 이름(…Nm)·주소·번지·관리번호 필드는 범주를 내지 않는다.
 *    허용 목록 안에서도 값이 코드 꼴(영문숫자 12자 이하)이 아니면 건수가 얼마든 값을 내지 않고 "코드 형식 아님"으로 센다 -
 *    필드 이름 가정이 틀려 자유 문장이 들어와도 새지 않게 하는 안전장치다.
 *  - complete 해소 지표(PREREG 5절 「complete 필드 해소 규칙」)는 지표만 낸다. 어느 필드를 고른다는 판정은 하지 않는다.
 *    분모가 100 미만이면 비율 대신 "판정 불가(분모 부족)"를 낸다. 날짜로 읽지 못한 값은 분자·분모에서 뺀다.
 *
 * 필드 이름은 응답 명세(30개 키)의 실제 이름을 직접 쓴다. spec의 FIELDS 매핑은 PREREG 5절과 같은 이름으로 맞춰져 있다(#133).
 */
import { createHash } from "node:crypto";
import { MAX_KEYS, parseDay } from "./housing-permits-fold.mjs";

/** PREREG가 고정한 기준일(2026-10-10). 실행일에 따라 바뀌지 않는다. 부등호는 `>`다. */
const CUTOFF = 20261010;
const CUTOFF_TEXT = "2026-10-10";
/** 칸 건수가 이보다 작으면 기타로 합친다. */
const MIN_CELL = 3;
/** complete 해소 지표의 분모 하한(PREREG 5절 4항). */
const MIN_DENOMINATOR = 100;

const KEY_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const CODE_SHAPE = /^[A-Za-z0-9]{1,12}$/;
/** 채움률에서 따로 세는 키의 상한. 넘는 키는 "<비정형 키>"와 같이 개수로만 센다. */
const MAX_TRACKED_KEYS = 200;

const DATE_FIELDS = ["apprvDay", "stcnsDay", "stcnsSchedDay", "useInsptDay", "useInsptSchedDay", "crtnDay", "demolStrtDay", "demolEndDay", "demolExtngDay"];
const DEMOL_DAY_FIELDS = ["demolStrtDay", "demolEndDay", "demolExtngDay"];
const DEMOL_ANY_FIELDS = [...DEMOL_DAY_FIELDS, "demolExtngGbCd"];
const USEINSPT_FIELDS = ["useInsptDay", "useInsptSchedDay"];
/** 값 자체를 내도 되는 코드성 필드. 코드표 항목이라 사업을 가리키지 않는다(판단 근거는 PR 본문). */
const CATEGORY_FIELDS = ["demolExtngGbCd", "purpsCd", "strctCd"];
const ORDER_PAIRS = [["apprvDay", "stcnsDay"], ["stcnsDay", "useInsptDay"], ["stcnsDay", "useInsptSchedDay"]];
const PK = "mgmHsrgstPk";
const COMBO_FIELDS = ["sigunguCd", "bjdongCd", "bun", "ji", "bldNm"];
const UNITS = "totHhldCnt";

const text = (value) => String(value ?? "").trim();
const isBlank = (value) => { const s = text(value); return s === "" || s === "0" || s === "00000000"; };

/** 8자리 숫자이고 달력에 있는 날짜면 YYYYMMDD 수, 아니면 null(공백·0·자리표시·형식 오류 전부). */
function readDay(value) {
  const s = text(value);
  if (!/^\d{8}$/.test(s) || parseDay(s) === null) return null;
  return Number(s);
}

const hash = (parts) => createHash("sha256").update(parts.map(text).join("\u0000")).digest("hex");
const ratio = (n, d) => `${n}/${d}`;
const percent = (n, d) => `${((n / d) * 100).toFixed(1)}%`;

/** 칸별 건수 -> 3 이상 칸 목록(이름순)과 기타 합. */
function bucket(counts) {
  const shown = [];
  let other = 0;
  for (const [name, n] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (n >= MIN_CELL) shown.push([name, n]);
    else other += n;
  }
  return { shown, other };
}

export function createDiagnostics() {
  let total = 0;
  let oddKeys = 0;
  const fill = new Map(); // 키 -> 채워진 건수
  const dates = Object.fromEntries(DATE_FIELDS.map((f) => [f, { readable: 0, after: 0, years: new Map() }]));
  const useInspt = Object.fromEntries(USEINSPT_FIELDS.map((f) => [f, { aNum: 0, bNum: 0 }]));
  let bDen = 0;
  const order = ORDER_PAIRS.map(([a, b]) => ({ a, b, den: 0, num: 0 }));
  const pks = new Map(); // 해시 -> {n, first, differs, max, maxN}. 출력하지 않는다
  let pkBlank = 0;
  const combos = new Set();
  const categories = Object.fromEntries(CATEGORY_FIELDS.map((f) => [f, { counts: new Map(), blank: 0, odd: 0 }]));
  const units = { zero: 0, blank: 0, odd: 0, positive: 0, sum: 0 };
  const demol = { any: 0, sameMonth: Object.fromEntries(DEMOL_DAY_FIELDS.map((f) => [f, { den: 0, num: 0 }])) };
  let emptyDongs = 0;

  function add(item) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return;
    total += 1;

    for (const [key, value] of Object.entries(item)) {
      if (!KEY_NAME.test(key) || (!fill.has(key) && fill.size >= MAX_TRACKED_KEYS)) { if (!fill.has(key)) oddKeys += 1; continue; }
      fill.set(key, (fill.get(key) ?? 0) + (isBlank(value) ? 0 : 1));
    }

    const day = Object.fromEntries(DATE_FIELDS.map((f) => [f, readDay(item[f])]));
    for (const f of DATE_FIELDS) {
      const d = day[f];
      if (d === null) continue;
      dates[f].readable += 1;
      if (d > CUTOFF) dates[f].after += 1;
      const year = String(Math.floor(d / 10000));
      dates[f].years.set(year, (dates[f].years.get(year) ?? 0) + 1);
    }

    // complete 해소 지표: (a)는 그 필드가 읽힌 건이 분모, (b)는 stcnsDay와 두 필드가 모두 읽힌 건이 분모.
    for (const f of USEINSPT_FIELDS) if (day[f] !== null && day[f] > CUTOFF) useInspt[f].aNum += 1;
    if (day.stcnsDay !== null && day.useInsptDay !== null && day.useInsptSchedDay !== null) {
      bDen += 1;
      for (const f of USEINSPT_FIELDS) if (day.stcnsDay <= day[f]) useInspt[f].bNum += 1;
    }

    for (const o of order) {
      if (day[o.a] === null || day[o.b] === null) continue;
      o.den += 1;
      if (day[o.a] <= day[o.b]) o.num += 1;
    }

    const pk = text(item[PK]);
    if (pk === "") pkBlank += 1;
    else {
      const h = hash([pk]);
      const crtn = text(item.crtnDay);
      const g = pks.get(h);
      if (!g) pks.set(h, { n: 1, first: crtn, differs: false, max: crtn, maxN: 1 });
      else {
        g.n += 1;
        if (crtn !== g.first) g.differs = true;
        if (crtn > g.max) { g.max = crtn; g.maxN = 1; } else if (crtn === g.max) g.maxN += 1;
      }
    }
    combos.add(hash(COMBO_FIELDS.map((f) => item[f])));

    for (const f of CATEGORY_FIELDS) {
      const c = categories[f];
      const v = text(item[f]);
      if (v === "") c.blank += 1;
      else if (!CODE_SHAPE.test(v)) c.odd += 1;
      else c.counts.set(v, (c.counts.get(v) ?? 0) + 1);
    }

    const u = text(item[UNITS]).replace(/,/g, "");
    const n = Number(u);
    if (u === "") units.blank += 1;
    else if (!Number.isFinite(n) || n < 0) units.odd += 1;
    else if (n === 0) units.zero += 1;
    else { units.positive += 1; units.sum += n; }

    if (DEMOL_ANY_FIELDS.some((f) => !isBlank(item[f]))) demol.any += 1;
    for (const f of DEMOL_DAY_FIELDS) {
      if (day[f] === null || day.apprvDay === null) continue;
      demol.sameMonth[f].den += 1;
      if (Math.floor(day[f] / 100) === Math.floor(day.apprvDay / 100)) demol.sameMonth[f].num += 1;
    }
  }

  /** 응답에서 totalCount가 0인 법정동(폐지 동 코드 응답이 0건인지 오류인지 가르는 데 쓴다. 오류는 수집 실패로 따로 센다). */
  function noteEmptyDong() { emptyDongs += 1; }

  /** 출력 줄. mask는 수집기의 키 마스킹(출력 직전에 적용 - 마스킹 먼저, 자르기는 그 뒤라는 원칙). */
  function lines(mask = (s) => s) {
    const out = [];
    const fillCells = [...fill.entries()].map(([k, n]) => [String(mask(k)), n]).filter(([k]) => KEY_NAME.test(k)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    // 이름은 상한(MAX_KEYS)까지만 낸다. 실제 응답은 30개 키라 다 나오고, 키가 부풀려진 응답에서도 출력이 커지지 않는다.
    const cells = fillCells.map(([k, n]) => `${k} ${ratio(n, total)}`);
    const more = cells.length > MAX_KEYS ? ` · … 외 ${cells.length - MAX_KEYS}개` : "";
    out.push(`진단 채움률(항목 ${total}건, 공백·"0"·"00000000"은 빈 것): ${cells.slice(0, MAX_KEYS).join(" · ") || "(없음)"}${more}${oddKeys > 0 ? ` · <비정형 키> ${oddKeys}개` : ""}`);

    for (const f of DATE_FIELDS) {
      const d = dates[f];
      const { shown, other } = bucket(d.years);
      const years = shown.map(([y]) => y).sort();
      const span = years.length > 0 ? `연도 최소 ${years[0]} 최대 ${years[years.length - 1]}(3건 이상 칸 안에서)` : "연도 최소·최대 없음(3건 이상 칸 없음)";
      out.push(`진단 날짜 ${f}: 날짜로 읽힘 ${d.readable} · 못 읽음 ${total - d.readable}(공백·0·형식 오류 포함) · ${span} · ${CUTOFF_TEXT} 이후 ${d.after} · 연도별 ${shown.map(([y, n]) => `${y} ${n}건`).join(" · ") || "(없음)"} · 기타 ${other}건(칸 건수 ${MIN_CELL} 미만 합)`);
    }

    // 지표만 낸다. 분모 100 미만은 비율을 내지 않는다.
    for (const f of USEINSPT_FIELDS) {
      const aDen = dates[f].readable;
      const a = useInspt[f].aNum;
      out.push(`진단 complete 해소 지표 ${f} (a) ${aDen < MIN_DENOMINATOR ? `판정 불가(분모 부족) · 실행일 ${CUTOFF_TEXT} 이후(>) 분자 ${a} / 분모 ${aDen}` : `실행일 ${CUTOFF_TEXT} 이후(>) ${ratio(a, aDen)} (${percent(a, aDen)})`} · 분모는 날짜로 읽힌 건 · 제외 ${total - aDen}`);
      const b = useInspt[f].bNum;
      out.push(`진단 complete 해소 지표 ${f} (b) ${bDen < MIN_DENOMINATOR ? `판정 불가(분모 부족) · stcnsDay <= 이 필드 분자 ${b} / 분모 ${bDen}` : `stcnsDay <= 이 필드 ${ratio(b, bDen)} (${percent(b, bDen)})`} · 분모는 stcnsDay와 두 useInspt 필드가 모두 날짜로 읽힌 건 · 제외 ${total - bDen}`);
    }

    out.push(`진단 순서(둘 다 날짜로 읽힌 건 중 앞<=뒤): ${order.map((o) => `${o.a}<=${o.b} ${ratio(o.num, o.den)}`).join(" · ")}`);

    const groups = [...pks.values()].filter((g) => g.n >= 2);
    const pkRows = total - pkBlank;
    out.push(
      `진단 키: ${PK} 고유 ${pks.size} · 중복 ${pkRows - pks.size} · 빈 값 ${pkBlank} · 조합 키 후보(${COMBO_FIELDS.join("·")} 해시) 고유 ${combos.size}` +
      ` · 중복 PK 묶음 ${groups.length} · crtnDay가 서로 다른 묶음 ${groups.filter((g) => g.differs).length} · 최대 crtnDay 동률 묶음 ${groups.filter((g) => g.maxN >= 2).length}`,
    );

    for (const f of CATEGORY_FIELDS) {
      const c = categories[f];
      const { shown, other } = bucket(c.counts);
      out.push(`진단 범주 ${f}: ${shown.map(([v, n]) => `${String(mask(v))} ${n}건`).join(" · ") || "(없음)"} · 빈 값 ${c.blank}건 · 코드 형식 아님 ${c.odd}건 · 기타 ${other}건(칸 건수 ${MIN_CELL} 미만 합)`);
    }

    out.push(`진단 호수 ${UNITS}: 값 0 ${units.zero}건 · 공백 ${units.blank}건 · 숫자 아님·음수 ${units.odd}건 · 양수 ${units.positive}건 · 양수 합 ${units.sum}`);
    out.push(
      `진단 demol* 하나라도 채워진 건 ${ratio(demol.any, total)} · ` +
      DEMOL_DAY_FIELDS.map((f) => `${f} 허가 달과 같은 달 ${ratio(demol.sameMonth[f].num, demol.sameMonth[f].den)}`).join(" · "),
    );
    out.push(`진단 빈 응답(0건) 동 ${emptyDongs}개`);
    return out;
  }

  return { add, noteEmptyDong, lines };
}
