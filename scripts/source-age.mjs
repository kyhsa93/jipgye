/**
 * 수집 신선도 - 사이트가 각 소스를 마지막으로 갱신한 지 며칠이 지났나 (#72).
 *
 * 읽기 전용이다. 게이트가 아니고 `npm test`에 날짜 의존 검사를 넣지 않는다(#8: 날짜에 따라 갈리는
 * 검사는 그날 배포를 멈춘다). 이 파일의 시험은 오늘 날짜를 인자로 받아 고정 입력으로만 돈다.
 *
 * 기준:
 * - 경과 = 오늘(KST 날짜) - 소스의 마지막 갱신일(KST 날짜), 일 단위 버림. `full` 실행이 하루 한 번
 *   (KST 08:07)이라 1일 경과는 정상이다. 그래서 상태줄 문턱은 2일(--statusline), 이슈 댓글 문턱은 3일.
 * - 갱신일은 docs/data/*.json 의 `updatedAt`. `updatedAt`이 없는 파일(히스토리·메타)은 소스가 아니다.
 * - 이름에 `-<구>` 접미사가 붙은 묶음(deals-mapo 등)은 한 소스로 보고 가장 오래된 값을 쓴다.
 * - 실거래 원본은 raw/sale·raw/rent 에서 가장 최근 달(yearMonth) 슬롯 파일들의 `observedAt` 중 최신.
 *
 * 사용:
 *   node scripts/source-age.mjs                 전체 표(경과일 큰 순) + 요약 한 줄
 *   node scripts/source-age.mjs --statusline    경과 >= 2일일 때만 한 줄 출력, 아니면 아무것도 안 찍는다
 *   node scripts/source-age.mjs --today=2026-10-10 --data=docs/data --raw=raw   (시험·재현용)
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

/** 낡았다고 말하는 문턱(일). docs/nav.js의 STALE_DAYS와 같아야 하고, test/updated-stamp.test.mjs가 묶는다 (#111). */
export const STALE_DAYS = 2;

/** ISO 시각(UTC) -> KST 달력 날짜 YYYY-MM-DD. 파싱 못 하면 null. */
export function kstDateOf(iso) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + KST_MS).toISOString().slice(0, 10);
}

/** ISO 시각(UTC) -> KST 달력 날짜의 일 번호. 파싱 못 하면 null. */
export function kstDayNumber(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t + KST_MS) / DAY_MS);
}

/** 오늘(KST 날짜 YYYY-MM-DD)의 일 번호. */
function dayOfDate(ymd) {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`날짜 형식이 아니다: ${ymd}`);
  return Math.floor(t / DAY_MS);
}

export function todayKst(now = new Date()) {
  return new Date(now.getTime() + KST_MS).toISOString().slice(0, 10);
}

/** 파일명에서 구 접미사를 뗀 소스 이름. 같은 접두어 파일이 5개 이상일 때만 묶음으로 본다. */
function groupNames(files) {
  const base = files.map((f) => f.replace(/\.json$/, ""));
  const count = new Map();
  for (const b of base) {
    const m = b.match(/^(.+)-[a-z]+$/);
    if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1);
  }
  return base.map((b) => {
    const m = b.match(/^(.+)-[a-z]+$/);
    return m && count.get(m[1]) >= 5 ? m[1] : b;
  });
}

/** docs/data 의 소스들. [{ name, file, updatedAt, members }] */
export function readDataSources(dataDir) {
  const files = readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort();
  const names = groupNames(files);
  const bySource = new Map();
  files.forEach((f, i) => {
    let updatedAt;
    try {
      updatedAt = JSON.parse(readFileSync(join(dataDir, f), "utf8"))?.updatedAt;
    } catch {
      return;
    }
    if (typeof updatedAt !== "string" || kstDayNumber(updatedAt) === null) return;
    const cur = bySource.get(names[i]);
    if (!cur) bySource.set(names[i], { name: names[i], file: f, updatedAt, members: 1 });
    else {
      cur.members += 1;
      if (Date.parse(updatedAt) < Date.parse(cur.updatedAt)) {
        cur.file = f;
        cur.updatedAt = updatedAt;
      }
    }
  });
  return [...bySource.values()];
}

/** raw/sale·raw/rent: 가장 최근 달 슬롯 파일들의 observedAt 중 최신. */
export function readRawSources(rawDir) {
  const out = [];
  for (const kind of ["sale", "rent"]) {
    const dir = join(rawDir, kind);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => /^\d+-\d{6}\.json$/.test(f));
    if (!files.length) continue;
    const latestMonth = files.map((f) => f.slice(-11, -5)).sort().pop();
    let best = null;
    for (const f of files.filter((x) => x.endsWith(`${latestMonth}.json`))) {
      let observedAt;
      try {
        observedAt = JSON.parse(readFileSync(join(dir, f), "utf8"))?.observedAt;
      } catch {
        continue;
      }
      if (typeof observedAt !== "string" || kstDayNumber(observedAt) === null) continue;
      if (!best || Date.parse(observedAt) > Date.parse(best.updatedAt)) best = { name: `raw/${kind}`, file: `raw/${kind}/${f}`, updatedAt: observedAt, members: 1 };
    }
    if (best) out.push(best);
  }
  return out;
}

/** 경과일을 붙여 큰 순(같으면 이름 순)으로. */
export function computeAges(sources, today) {
  const t = dayOfDate(today);
  return sources
    .map((s) => ({ ...s, ageDays: Math.max(0, t - kstDayNumber(s.updatedAt)) }))
    .sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}

/** 한 줄 요약. 예: `경과 최대 2일: cancellation.json`. 경과 0~1일이면 정상이라고 적는다. */
export function summarize(ages, minDays = STALE_DAYS) {
  if (!ages.length) return "소스 없음";
  const max = ages[0].ageDays;
  if (max < minDays) return `경과 최대 ${max}일 - 이상 없음`;
  const stale = ages.filter((a) => a.ageDays === max).map((a) => a.file);
  return `경과 최대 ${max}일: ${stale.join(", ")}`;
}

export function collect({ today = todayKst(), dataDir, rawDir } = {}) {
  const sources = [...readDataSources(dataDir), ...(rawDir ? readRawSources(rawDir) : [])];
  return computeAges(sources, today);
}

function main(argv) {
  const arg = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const today = arg("today") ?? todayKst();
  const ages = collect({ today, dataDir: arg("data") ?? join(root, "docs/data"), rawDir: arg("raw") ?? join(root, "raw") });
  if (argv.includes("--statusline")) {
    // 이상이 없으면 아무것도 찍지 않는다(상태줄이 비어 보이게).
    if (ages.length && ages[0].ageDays >= STALE_DAYS) console.log(`집계 ${summarize(ages)}`);
    return;
  }
  console.log(`오늘(KST) ${today}`);
  for (const a of ages) console.log(`${String(a.ageDays).padStart(3)}일  ${a.name}  ${a.file}  ${a.updatedAt}${a.members > 1 ? `  (묶음 ${a.members}개 중 가장 오래된 값)` : ""}`);
  console.log(summarize(ages));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
