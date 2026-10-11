/**
 * 정정 재신고 집계 Release 산출 (#218, 판정 #76).
 *
 * 해제 기록 가운데 같은 계약 기록이 해제되지 않은 채 다시 있는 것(짝이 있는 것)을 세어, GitHub Release 한 건으로 낼
 * 파일들을 임시 폴더에 만든다. 커밋하지 않는다 - 올리는 것은 .github/workflows/correction-release.yml이다.
 *
 * - 숫자는 사이트와 같은 함수(withoutCorrections·correctionStats·registrationStats)에서 낸다. 산식을 여기서 다시 쓰지 않는다
 *   (DIRECTION 체크리스트 10). 비교군만 사이트에 없던 셈이라 cancellation.mjs의 repeatedLiveStats로 한 곳에 둔다.
 * - 입력은 raw/sale/*.json이고 경로는 환경변수 REALESTATE_RAW_DIR로 받는다(#175 결론이 나면 이 경로만 맞춘다).
 *   읽는 필드는 최소 집합뿐이다: sggCd·umdNm·jibun·aptNm·excluUseAr·floor·dealYear·dealMonth·dealDay·dealAmount(계약 키),
 *   cdealType·cdealDay(해제 여부), rgstDate(짝의 등기일). 값은 집계에만 쓰고 출력에는 어떤 행 필드도 싣지 않는다.
 * - 출력 필드는 허용 목록(ALLOWED_*)으로 고정하고, 빌드가 끝나기 전에 assertAllowedShape가 모양을 검사한다.
 *   단위는 서울 전체·25개 구·서울 계약월별이다. 구×계약월 칸은 만들지 않고, 칸의 해제 기록이 MIN_CELL(3) 미만이면
 *   숫자를 비운다(#68·#132와 같은 문턱, clo 조건 3).
 * - 산출: 집계 JSON·CSV, 본문(README.md), check.py와 그 출력(check.out). 파일 이름의 기준일은 입력 중 가장 늦은
 *   수집 시각(observedAt)의 한국 날짜다 - 같은 입력이면 같은 이름·같은 숫자.
 *
 * 쓰는 법(저장소 루트): REALESTATE_RAW_DIR=raw CORRECTION_OUT_DIR=/tmp/x node scripts/build-correction-release.mjs
 * 워크플로 보조: --same <이전.json> <새.json>  숫자가 같으면 0, 다르면 1로 끝난다.
 *               --supersede <이전 본문.md> <새 태그>  이전 본문 맨 위에 '정정됨' 표시를 붙여 stdout으로 낸다.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  correctionStats,
  isCancelled,
  monthKey,
  registrationStats,
  repeatedLiveStats,
  withoutCorrections,
} from "./cancellation.mjs";
import { DISTRICTS } from "./realestate-districts.mjs";
import { RAW_DIR, readSlotFile } from "./realestate-raw.mjs";

const root = path.resolve(import.meta.dirname, "..");

/** 칸의 해제 기록이 이보다 적으면 숫자를 비운다(clo 조건 3). */
export const MIN_CELL = 3;

export const SCHEMA = "correction-twins/1";
export const TAG_PREFIX = "correction-twins-";
/** 원천 이용허락 표시를 마지막으로 확인한 날 - 2026-10-11 legal이 data.go.kr/data/15126469 페이지에서 확인(#175 댓글). */
export const LICENSE_CHECKED = "2026-10-11";
/** 본문이 이전 Release를 가리킬 때 앞에 붙이는 표시. 워크플로가 이 문자열로 표시 여부를 가린다. */
export const SUPERSEDED_MARK = "정정됨 (SUPERSEDED)";

// ---- 출력 필드 허용 목록 ------------------------------------------------------------------------------------------
// 새 필드는 여기 먼저 적어야 나간다. 행 단위 이름(단지·지번·동·층·금액·면적·등기일 등)은 이 목록에도 없다.
export const ALLOWED_TOP = ["schema", "asOf", "collectedAt", "source", "sample", "seoul", "districts", "months", "figuresDigest"];
export const ALLOWED_SOURCE = ["datasetId", "license", "licenseCheckedAt"];
export const ALLOWED_SAMPLE = ["firstContractMonth", "lastContractMonth", "contractMonths", "districtFiles"];
export const ALLOWED_SEOUL = ["cancelRecords", "withTwin", "sharePct", "comparison", "registration"];
export const ALLOWED_COMPARISON = ["liveRecords", "repeatedContracts", "sharePct"];
export const ALLOWED_REGISTRATION = ["matureMonths", "records", "withRegDatePct"];
export const ALLOWED_DISTRICT = ["name", "cancelRecords", "withTwin", "sharePct", "suppressed", "registrationRecords", "withRegDatePct"];
export const ALLOWED_MONTH = ["month", "cancelRecords", "withTwin", "sharePct", "suppressed"];

const keysOf = (obj) => Object.keys(obj ?? {}).sort();
function assertKeys(label, obj, allowed) {
  const extra = keysOf(obj).filter((k) => !allowed.includes(k));
  if (extra.length) throw new Error(`${label}에 허용 목록에 없는 필드가 있다: ${extra.join(", ")}`);
}

/** 출력 모양이 허용 목록 안인지 본다. 값이 아니라 키만 본다 - 데이터에 기대지 않는 구조 검사다. */
export function assertAllowedShape(figures) {
  assertKeys("최상위", figures, ALLOWED_TOP);
  assertKeys("source", figures.source, ALLOWED_SOURCE);
  assertKeys("sample", figures.sample, ALLOWED_SAMPLE);
  assertKeys("seoul", figures.seoul, ALLOWED_SEOUL);
  assertKeys("seoul.comparison", figures.seoul?.comparison, ALLOWED_COMPARISON);
  assertKeys("seoul.registration", figures.seoul?.registration, ALLOWED_REGISTRATION);
  for (const row of figures.districts ?? []) assertKeys("districts[]", row, ALLOWED_DISTRICT);
  for (const row of figures.months ?? []) assertKeys("months[]", row, ALLOWED_MONTH);
  return true;
}

// ---- 입력 ----------------------------------------------------------------------------------------------------------

const FILE_PATTERN = /^(\d{5})-(\d{6})\.json$/;
const kstDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/**
 * raw/sale의 파일 전부를 읽는다(check.py와 같은 입력). 자치구는 DISTRICTS 순서로 담아 출력 순서가 디스크 순서에
 * 기대지 않게 한다. 기준일·수집 시각은 파일의 observedAt 중 가장 늦은 것이다.
 */
export async function readSales(dir = RAW_DIR) {
  let names = [];
  try {
    names = (await readdir(path.join(dir, "sale"))).filter((n) => FILE_PATTERN.test(n));
  } catch {
    throw new Error(`매매 원본 폴더를 읽지 못했다: ${path.join(dir, "sale")} (REALESTATE_RAW_DIR 확인)`);
  }
  if (!names.length) throw new Error("매매 원본 파일이 없다");

  const wanted = new Set(DISTRICTS.map((d) => d.code));
  const byDistrict = {};
  let observedAt = "";
  let files = 0;
  for (const { code, name } of DISTRICTS) {
    const items = [];
    for (const fileName of names.filter((n) => n.startsWith(`${code}-`)).sort()) {
      const [, , yearMonth] = FILE_PATTERN.exec(fileName);
      const file = await readSlotFile("sale", code, yearMonth, dir);
      if (file?.ok === false || !Array.isArray(file?.items)) continue;
      files += 1;
      if (file.observedAt && file.observedAt > observedAt) observedAt = file.observedAt;
      items.push(...file.items);
    }
    if (items.length) byDistrict[name] = items;
  }
  const unknown = names.filter((n) => !wanted.has(FILE_PATTERN.exec(n)[1]));
  if (unknown.length) throw new Error(`서울 25개 구 밖의 파일이 있다: ${unknown.length}개`);
  return { byDistrict, observedAt, files };
}

// ---- 셈 ------------------------------------------------------------------------------------------------------------

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** 칸 하나. 해제 기록이 MIN_CELL 미만이면 숫자를 모두 비운다. */
function cell(cancelRecords, withTwin) {
  const suppressed = cancelRecords < MIN_CELL;
  return suppressed
    ? { cancelRecords: null, withTwin: null, sharePct: null, suppressed: true }
    : { cancelRecords, withTwin, sharePct: pct(withTwin, cancelRecords), suppressed: false };
}

/**
 * 집계를 낸다. 순서는 사이트(build-cancellation.mjs buildPayload)와 같다: 구마다 withoutCorrections로 정정 쪽을 가르고,
 * 정정을 뺀 기록 전체로 익은 달을 정해(registrationStats) correctionStats에 넘긴다.
 */
export function computeFigures(byDistrict) {
  const cleaned = {};
  const corrections = [];
  for (const [name, items] of Object.entries(byDistrict)) {
    const r = withoutCorrections(items);
    cleaned[name] = r.items;
    corrections.push(...r.corrections.map((c) => ({ ...c, district: name })));
  }
  const all = Object.values(byDistrict).flat();
  const reported = all.filter(isCancelled).length;
  const registration = registrationStats(Object.values(cleaned).flat());
  const matureMonths = registration?.matureMonths ?? [];
  const seoulStats = correctionStats(reported, corrections, matureMonths);
  if (!seoulStats) throw new Error("해제 기록이 없다");

  // 비교군: 해제되지 않은 기록끼리 같은 키(서울 전체, 키에 구가 들어 있어 구별로 세어도 합이 같다).
  const repeated = repeatedLiveStats(all);

  const districts = Object.entries(byDistrict).map(([name, items]) => {
    const own = corrections.filter((c) => c.district === name);
    const cancelRecords = items.filter(isCancelled).length;
    const stats = correctionStats(cancelRecords, own, matureMonths);
    const registrationRecords = stats?.matured ?? 0;
    return {
      name,
      ...cell(cancelRecords, own.length),
      registrationRecords: registrationRecords >= MIN_CELL ? registrationRecords : null,
      withRegDatePct: registrationRecords >= MIN_CELL ? stats.registeredShare : null,
    };
  });

  const monthKeys = [...new Set(all.filter(isCancelled).map(monthKey))].sort();
  const months = monthKeys.map((month) => {
    const cancelRecords = all.filter((i) => isCancelled(i) && monthKey(i) === month).length;
    const withTwin = corrections.filter((c) => monthKey(c.item) === month).length;
    return { month, ...cell(cancelRecords, withTwin) };
  });

  const contractMonths = [...new Set(all.map(monthKey))].sort();
  return {
    sample: {
      firstContractMonth: contractMonths[0],
      lastContractMonth: contractMonths.at(-1),
      contractMonths: contractMonths.length,
    },
    seoul: {
      cancelRecords: seoulStats.reported,
      withTwin: seoulStats.corrections,
      sharePct: seoulStats.share,
      comparison: { liveRecords: repeated.liveRecords, repeatedContracts: repeated.repeated, sharePct: repeated.share },
      registration: { matureMonths, records: seoulStats.matured, withRegDatePct: seoulStats.registeredShare },
    },
    districts,
    months,
  };
}

const digestOf = (figures) =>
  createHash("sha256")
    .update(JSON.stringify({ sample: figures.sample, seoul: figures.seoul, districts: figures.districts, months: figures.months }))
    .digest("hex")
    .slice(0, 16);

export function buildFigures({ byDistrict, observedAt, files }) {
  const computed = computeFigures(byDistrict);
  if (!observedAt) throw new Error("원본 파일에 수집 시각(observedAt)이 없어 기준일을 정할 수 없다");
  const collectedAt = kstDay(observedAt);
  const figures = {
    schema: SCHEMA,
    asOf: collectedAt,
    collectedAt,
    source: { datasetId: "15126469", license: "제한 없음", licenseCheckedAt: LICENSE_CHECKED },
    sample: { ...computed.sample, districtFiles: files },
    seoul: computed.seoul,
    districts: computed.districts,
    months: computed.months,
  };
  figures.figuresDigest = digestOf(figures);
  assertAllowedShape(figures);
  return figures;
}

// ---- CSV -----------------------------------------------------------------------------------------------------------

export const CSV_HEADER = "scope,name,cancel_records,with_twin,share_pct,suppressed,registration_records,with_reg_date_pct";
const cellText = (v) => (v === null || v === undefined ? "" : String(v));

export function toCsv(figures) {
  const rows = [CSV_HEADER];
  const s = figures.seoul;
  rows.push(["seoul", "서울 전체", s.cancelRecords, s.withTwin, s.sharePct, 0, s.registration.records, s.registration.withRegDatePct].map(cellText).join(","));
  for (const d of figures.districts) {
    rows.push(["district", d.name, d.cancelRecords, d.withTwin, d.sharePct, d.suppressed ? 1 : 0, d.registrationRecords, d.withRegDatePct].map(cellText).join(","));
  }
  for (const m of figures.months) {
    rows.push(["month", m.month, m.cancelRecords, m.withTwin, m.sharePct, m.suppressed ? 1 : 0, "", ""].map(cellText).join(","));
  }
  return `${rows.join("\n")}\n`;
}

// ---- 본문 ----------------------------------------------------------------------------------------------------------

const ko = (n) => n.toLocaleString("ko-KR");
const en = (n) => n.toLocaleString("en-US");
const monthRange = (a, b) => `${a.replace(/^(\d{4})-(\d{2})$/, "$1.$2")}~${b.replace(/^(\d{4})-(\d{2})$/, "$1.$2")}`;

/**
 * Release 본문(한·영). 문장 규칙(#76 clo 조건 4~6, pm 판정):
 * - 짝이 있다는 것은 키가 같다는 것을 센 것이다. 신고 사유를 본 것이 아니므로 '정정이다'로 단정하지 않는다.
 * - 비교군 비율과 표본 기간을 같이 둔다. 등기율은 '짝에 등기일이 있는 비율' 하나만 정의한다(사이트 익은 달 기준).
 * - 투자·구매 권유, 특정 단지·중개사 거론 없음. 금지어는 test/correction-release.test.mjs가 막는다.
 * 사이트 lead(correctionSentence)와 같은 '해제 표시 없이 다시 있다'는 구조이되, Release용으로 따로 쓴 문장이다.
 */
export function renderBody(figures, { tag } = {}) {
  const s = figures.seoul;
  const reg = s.registration;
  const sample = figures.sample;
  const range = monthRange(sample.firstContractMonth, sample.lastContractMonth);
  const matureFirst = reg.matureMonths[0];
  const matureLast = reg.matureMonths.at(-1);
  const matureRange = reg.matureMonths.length ? monthRange(matureFirst, matureLast) : "-";
  const hidden = figures.districts.filter((d) => d.suppressed).length + figures.months.filter((m) => m.suppressed).length;
  const name = tag ?? `${TAG_PREFIX}${figures.asOf}`;

  const koSection = `# 서울 아파트 매매 해제 기록 가운데 해제되지 않은 채 다시 있는 기록 — 집계 (기준일 ${figures.asOf})

계약월 ${range}(${ko(sample.contractMonths)}개월) 서울 25개 구의 아파트 매매 신고 기록에서, 해제 기록 ${ko(s.cancelRecords)}건 가운데 ${ko(s.withTwin)}건(${s.sharePct}%)은 같은 계약 기록(구·동·지번·단지·전용면적·층·계약일·금액)이 해제되지 않은 채 다시 있습니다. 해제되지 않은 기록끼리 같은 계약 기록이 둘 이상인 경우를 비교군으로 세면 ${ko(s.comparison.repeatedContracts)}건으로, 해제되지 않은 기록 ${ko(s.comparison.liveRecords)}건의 ${s.comparison.sharePct}%입니다.

이 숫자는 기록이 서로 같다는 것을 센 것입니다. 신고 사유는 공개되지 않아 확인하지 않았고, 이 자료는 그 기록들이 왜 다시 있는지를 말하지 않습니다.

## 등기율 정의 (하나만)

- 등기율 = 짝 기록에 등기일이 있는 비율. 해제 기록의 짝(해제되지 않은 채 다시 있는 같은 계약 기록)에 등기일이 적혀 있는 것의 비율입니다.
- 분모는 익은 달(그 달 계약의 80% 이상이 등기일을 가진 달, 사이트의 \`registrationStats\` 기준)에 계약된 짝 있는 해제 기록입니다. 익은 달은 ${reg.matureMonths.length}개월(${matureRange})이고 분모는 ${ko(reg.records)}건입니다.
- 이 정의의 값은 ${reg.withRegDatePct === null ? "분모가 없어 비어 있습니다" : `${reg.withRegDatePct}%`}입니다.
- 첨부한 \`check.out\`의 마지막 줄은 계약월 2026년 3월까지만 센 일회성 값이라 위 정의와 기준이 다릅니다. 두 값을 같은 지표로 견주지 마십시오. \`check.out\`의 둘째·셋째 줄은 이 본문의 해제 기록 수·짝 비율·비교군과 같은 값입니다.

## 집계 단위와 비공개

- 단위는 서울 전체, 25개 구, 서울 계약월별입니다. 구×계약월 칸은 만들지 않았습니다.
- 칸의 해제 기록이 ${MIN_CELL}건 미만이면 숫자를 비웠습니다(이 Release에서 ${hidden}칸). 행 단위 기록·단지·지번·동·층·금액은 담지 않았습니다.

## 첨부

- \`${TAG_PREFIX}${figures.asOf}.json\`·\`.csv\`: 위 집계(같은 값).
- \`check.py\`·\`check.out\`: 저장소의 \`research/correction-twins/check.py\`와 이 기준일 입력에서의 출력입니다. 파이썬 표준 라이브러리만 씁니다.
- 숫자는 사이트와 같은 함수(\`scripts/cancellation.mjs\`의 \`withoutCorrections\`·\`correctionStats\`)에서 냈습니다. 산출 스크립트는 \`scripts/build-correction-release.mjs\`입니다.

## 갱신

- 월 1회 다시 셉니다(수동 실행도 가능). 숫자가 달라지면 새 Release를 올리고, 이전 Release 본문 맨 위에 "${SUPERSEDED_MARK}" 표시와 새 Release 링크를 남깁니다. 숫자가 같으면 새로 올리지 않습니다.
- 원천(국토교통부)이 기록을 수정하면 숫자가 달라질 수 있습니다. 이 Release의 이름 \`${name}\`의 날짜가 기준일입니다.

## 출처

출처: 국토교통부 아파트 매매 실거래가 공개시스템(공공데이터포털 15126469), 수집 시각 ${figures.collectedAt}. 이 자료는 원천을 집계·가공한 값이며 국토교통부가 후원·보증하지 않습니다. 이 자료의 숫자는 가공값이고 원천의 원값이 아닙니다. 공공데이터포털 해당 페이지의 이용허락범위는 "${figures.source.license}"(${figures.source.licenseCheckedAt} 확인)입니다.
`;

  const enSection = `# Seoul apartment sale cancellation records that also appear without a cancellation mark — aggregate (as of ${figures.asOf})

In the apartment-sale filings of Seoul's 25 districts (contract months ${range}, ${en(sample.contractMonths)} months), ${en(s.withTwin)} of ${en(s.cancelRecords)} cancellation records (${s.sharePct}%) have the same contract record (district, neighbourhood, lot number, complex, floor area, floor, contract date, amount) again without a cancellation mark. As a comparison group, ${en(s.comparison.repeatedContracts)} contract records appear two or more times among records without a cancellation mark, which is ${s.comparison.sharePct}% of the ${en(s.comparison.liveRecords)} such records.

These figures count records that match each other. The reason for a filing is not published and was not checked, and this release does not say why those records appear again.

## Registration rate (one definition)

- Registration rate = the share of twin records that carry a registration date. A twin is the same contract record appearing without a cancellation mark.
- The denominator is cancellation records with a twin whose contract month is a mature month (a month in which at least 80% of contracts carry a registration date, per the site's \`registrationStats\`). There are ${reg.matureMonths.length} mature months (${matureRange}) and ${en(reg.records)} records in the denominator.
- Under this definition the value is ${reg.withRegDatePct === null ? "empty because the denominator is empty" : `${reg.withRegDatePct}%`}.
- The last line of the attached \`check.out\` is a one-off figure for contract months up to March 2026 only, so its basis differs from the definition above. Do not compare the two as the same measure. The second and third lines of \`check.out\` match the cancellation-record count, the twin share and the comparison group in this text.

## Units and withheld cells

- Units are Seoul as a whole, the 25 districts, and Seoul by contract month. District-by-month cells were not produced.
- Where a cell has fewer than ${MIN_CELL} cancellation records the numbers are left empty (cells withheld in this release: ${hidden}). No record-level data, complex names, lot numbers, neighbourhoods, floors or amounts are included.

## Attachments

- \`${TAG_PREFIX}${figures.asOf}.json\` and \`.csv\`: the aggregates above (same values).
- \`check.py\` and \`check.out\`: \`research/correction-twins/check.py\` from the repository and its output on this as-of input. It uses only the Python standard library.
- The numbers come from the same functions the site uses (\`withoutCorrections\` and \`correctionStats\` in \`scripts/cancellation.mjs\`). The build script is \`scripts/build-correction-release.mjs\`.

## Updates

- Recounted once a month (a manual run is also possible). If the figures change, a new release is published and the previous release body gets a "${SUPERSEDED_MARK}" notice with a link to the new one at the top. If the figures are the same, no new release is made.
- If the source agency (Ministry of Land, Infrastructure and Transport) amends its records, the figures can change. The date in this release's name \`${name}\` is the as-of date.

## Source

Source: Ministry of Land, Infrastructure and Transport apartment sale transaction disclosure system (data.go.kr 15126469), collected ${figures.collectedAt}. These are aggregated and processed values derived from the source and are not endorsed or guaranteed by the Ministry. The numbers here are processed values, not the source's original values. The data.go.kr page lists the license scope as "No restrictions" (checked ${figures.source.licenseCheckedAt}).
`;

  return `${koSection}\n---\n\n${enSection}`;
}

/** 이전 Release 본문 맨 위에 붙일 표시. 이미 붙어 있으면 그대로 돌려준다(워크플로를 다시 돌려도 중복되지 않게). */
export function supersede(prevBody, newTag) {
  if (String(prevBody).includes(SUPERSEDED_MARK)) return prevBody;
  const link = `https://github.com/kyhsa93/jipgye/releases/tag/${newTag}`;
  return `> **${SUPERSEDED_MARK}** — 이 Release의 숫자는 새 Release \`${newTag}\`(${link})의 숫자로 바뀌었습니다. 아래 본문은 이 기준일의 값으로만 읽으십시오.\n> This release's figures have been superseded by \`${newTag}\` (${link}). Read the text below only as the figures of its own as-of date.\n\n${prevBody}`;
}

// ---- 산출 ----------------------------------------------------------------------------------------------------------

export async function buildRelease({ rawDir = RAW_DIR, outDir, python = "python3" }) {
  const figures = buildFigures(await readSales(rawDir));
  const tag = `${TAG_PREFIX}${figures.asOf}`;
  await mkdir(outDir, { recursive: true });

  await writeFile(path.join(outDir, `${tag}.json`), `${JSON.stringify(figures, null, 2)}\n`);
  await writeFile(path.join(outDir, `${tag}.csv`), toCsv(figures));
  await writeFile(path.join(outDir, "README.md"), renderBody(figures, { tag }));
  await writeFile(path.join(outDir, "tag.txt"), `${tag}\n`);

  // check.py는 저장소 파일 그대로 복사하고, 그 출력은 같은 입력 경로로 지금 돌려 받는다(python3 표준 라이브러리만).
  const checkPy = path.join(root, "research/correction-twins/check.py");
  await copyFile(checkPy, path.join(outDir, "check.py"));
  const out = execFileSync(python, ["-I", checkPy], { env: { ...process.env, REALESTATE_RAW_DIR: path.resolve(rawDir) }, encoding: "utf8" });
  await writeFile(path.join(outDir, "check.out"), out);

  return { figures, tag };
}

async function main() {
  const [mode, a, b] = process.argv.slice(2);
  if (mode === "--same") {
    const [prev, next] = await Promise.all([a, b].map(async (f) => JSON.parse(await readFile(f, "utf8"))));
    const same = prev.figuresDigest && prev.figuresDigest === next.figuresDigest;
    console.log(same ? "숫자가 같다" : "숫자가 다르다");
    process.exit(same ? 0 : 1);
  }
  if (mode === "--supersede") {
    process.stdout.write(supersede(await readFile(a, "utf8"), b));
    return;
  }

  const outDir = process.env.CORRECTION_OUT_DIR;
  if (!outDir) throw new Error("CORRECTION_OUT_DIR(산출 폴더)가 필요하다");
  const { figures, tag } = await buildRelease({ rawDir: RAW_DIR, outDir: path.resolve(outDir) });
  console.log(`${tag}: 해제 기록 ${figures.seoul.cancelRecords}건 중 짝 있음 ${figures.seoul.withTwin}건 (${figures.seoul.sharePct}%), 비교군 ${figures.seoul.comparison.sharePct}%, 구 ${figures.districts.length}개, 월 ${figures.months.length}개, 비공개 칸 ${figures.districts.filter((d) => d.suppressed).length + figures.months.filter((m) => m.suppressed).length}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error(`Release 산출 실패: ${err.message}`);
    process.exit(1);
  });
}
