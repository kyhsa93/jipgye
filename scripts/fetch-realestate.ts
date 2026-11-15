import { XMLParser } from "fast-xml-parser";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { DISTRICTS, districtNames } from "./realestate-districts.ts";
import { readSlots, removeSlotFile } from "./realestate-raw.ts";
import { HOLD_DAYS, pruneHolds, readHolds, reasonText, receiveSlot, writeHolds } from "./realestate-guard.ts";
import { planFetch, planSummary, slotKey } from "./realestate-slots.ts";
import { collectionNow } from "./collection-now.ts";

const SALE_API_URL = process.env.MOLIT_API_ENDPOINT;
const SALE_SERVICE_KEY = process.env.MOLIT_API_KEY;
const RENT_API_URL = process.env.MOLIT_RENT_API_ENDPOINT;
const RENT_SERVICE_KEY = process.env.MOLIT_RENT_API_KEY;

function numberEnv(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const CONCURRENCY = numberEnv("MOLIT_CONCURRENCY", 3) || 3;
const MAX_RETRIES = 3;
const BACKFILL_LIMIT = numberEnv("MOLIT_BACKFILL_LIMIT", 50);
const REQUEST_TIMEOUT_MS = numberEnv("MOLIT_TIMEOUT_MS", 15_000);
const ABORT_AFTER = numberEnv("MOLIT_ABORT_AFTER", 12);
const RETRY_BASE_MS = numberEnv("MOLIT_RETRY_MS", 3000);
const SWEEP_DELAY_MS = numberEnv("MOLIT_SWEEP_DELAY_MS", 45_000);

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function errorDetail(err) {
  const parts = [err?.message ?? String(err)];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    parts.push(cause.code ?? cause.message ?? String(cause));
    cause = cause.cause;
  }
  return parts.filter(Boolean).join(" ← ");
}

// 재수집(#861 recollect-sale.ts)도 같은 호출·해석을 쓴다 - 옮겨 적으면 어긋난다(#820 measure.mjs 는 이것을 옮겨 적어야 했다).
export async function fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth) {
  const otherParams = new URLSearchParams({
    LAWD_CD: districtCode,
    DEAL_YMD: yearMonth,
    numOfRows: "9999",
  });
  const url = `${apiUrl}?serviceKey=${serviceKey}&${otherParams.toString()}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser();
  const parsed = parser.parse(xml);

  const header = parsed?.response?.header;
  if (!header) {
    const errMsg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식";
    throw new Error(errMsg);
  }
  if (Number(header.resultCode) !== 0) {
    throw new Error(header.resultMsg ?? `resultCode ${header.resultCode}`);
  }

  const totalCount = Number(parsed?.response?.body?.totalCount);
  const items = parsed?.response?.body?.items?.item;
  return {
    items: items ? (Array.isArray(items) ? items : [items]) : [],
    totalCount: Number.isInteger(totalCount) ? totalCount : null,
  };
}

async function fetchApi(apiUrl, serviceKey, districtCode, yearMonth) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchApiOnce(apiUrl, serviceKey, districtCode, yearMonth);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(attempt * RETRY_BASE_MS);
    }
  }
  throw lastErr;
}

/**
 * 줄어든 응답을 쓰지 않은 슬롯을 실행 요약에 남긴다(#863). `::warning::` 는 Actions 실행 화면의 경고로, GITHUB_STEP_SUMMARY 는 그 실행의 요약 표로 간다.
 * 구 이름·달·종류·건수만 적는다 - 응답 원문·키·URL 은 없다.
 */
export function guardLines(notes) {
  const ordered = [...notes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const actionOf = ({ result }) =>
    result.released
      ? `${HOLD_DAYS} 수집일 보류 뒤에도 같아 반영`
      : result.hold
        ? `보류 ${result.hold.days.length}/${HOLD_DAYS} 수집일째 - 슬롯을 쓰지 않음`
        : "반영하지 않음";
  const warnings = ordered.map(
    (note) => `::warning::실거래 원본 ${note.name} ${note.yearMonth} ${note.label}: ${reasonText(note.result.verdict)} - ${actionOf(note)}`
  );
  const summary = [
    "### 실거래 수집: 줄어든 응답 (#863)",
    "",
    "| 슬롯 | 이유 | 처리 |",
    "|---|---|---|",
    ...ordered.map((note) => `| ${note.name} ${note.yearMonth} ${note.label} (\`${note.key}\`) | ${reasonText(note.result.verdict)} | ${actionOf(note)} |`),
    "",
  ];
  return { warnings, summary };
}

async function main() {
  const endpoints = {
    sale: { url: SALE_API_URL, key: SALE_SERVICE_KEY, label: "매매" },
    rent: { url: RENT_API_URL, key: RENT_SERVICE_KEY, label: "전월세" },
  };
  const kinds = Object.keys(endpoints).filter((kind) => endpoints[kind].url && endpoints[kind].key);

  if (kinds.length === 0) {
    console.error("[fetch-realestate] MOLIT_API_KEY/MOLIT_RENT_API_KEY 둘 다 없음, 생략");
    return;
  }

  const now = collectionNow("REALESTATE_NOW");
  const observedAt = now.toISOString();

  const plan = planFetch({
    now,
    districts: DISTRICTS,
    kinds,
    slots: await readSlots(),
    backfillLimit: BACKFILL_LIMIT,
  });
  console.log(`[fetch-realestate] 원본 슬롯 ${planSummary(plan)}`);

  const holds = await readHolds();
  const guardNotes = new Map();
  let changedSlots = 0;
  let arrived = 0;
  let failedInARow = 0;
  let givenUp = false;

  async function fetchSlot(slot) {
    if (givenUp) return null;

    const { url, key, label } = endpoints[slot.kind];
    try {
      const response = await fetchApi(url, key, slot.code, slot.yearMonth);
      // 줄어든 응답은 판정(realestate-guard.ts)이 막거나 보류한다. 반영할 때만 지금까지와 같은 buildSlotFile → writeSlotFile 로 쓴다.
      const written = await receiveSlot({ ...slot, response, observedAt, holds });
      const noteKey = slotKey(slot.kind, slot.code, slot.yearMonth);
      if (written.verdict.reason) {
        guardNotes.set(noteKey, { key: noteKey, name: districtNames.get(slot.code) ?? slot.code, yearMonth: slot.yearMonth, label, result: written });
      } else {
        guardNotes.delete(noteKey);
      }
      if (written.changed) {
        changedSlots += 1;
        arrived += written.added;
      }
      failedInARow = 0;
      return true;
    } catch (err) {
      console.error(
        `[fetch-realestate] ${districtNames.get(slot.code) ?? slot.code} ${slot.yearMonth} ${label} 조회 실패:` +
          ` ${errorDetail(err)}`
      );
      failedInARow += 1;
      if (failedInARow >= ABORT_AFTER) givenUp = true;
      return false;
    }
  }

  const results = await mapWithConcurrency(plan.fetch, CONCURRENCY, fetchSlot);

  if (givenUp) {
    const skipped = results.filter((result) => result === null).length;
    console.error(
      `[fetch-realestate] ${ABORT_AFTER}개 연속 실패로 중단했습니다.` +
        ` 남은 ${skipped}개 슬롯은 다음 실행에서 받습니다`
    );
  }

  const failedSlots = givenUp ? [] : plan.fetch.filter((_, i) => !results[i]);
  if (failedSlots.length > 0) {
    console.log(
      `[fetch-realestate] ${failedSlots.length}개 슬롯 실패,` +
        ` ${Math.round(SWEEP_DELAY_MS / 1000)}초 쉬고 재시도 스윕 시작`
    );
    await sleep(SWEEP_DELAY_MS);
    const retried = await mapWithConcurrency(failedSlots, CONCURRENCY, fetchSlot);
    const stillFailed = failedSlots.filter((_, j) => !retried[j]);
    if (stillFailed.length > 0) {
      console.error(`[fetch-realestate] 재시도 후에도 실패한 슬롯 ${stillFailed.length}개`);
    } else {
      console.log("[fetch-realestate] 재시도 스윕으로 전부 복구됨");
    }
  }

  for (const slot of plan.expired) {
    await removeSlotFile(slot.kind, slot.code, slot.yearMonth);
  }

  // 보류 상태는 회차 끝에 한 번 쓴다(raw/realestate-holds.json, 보류가 없으면 파일이 없다). 이번에 받을 차례가 아니었던 슬롯의 보류는 지운다.
  pruneHolds(holds, new Set(plan.fetch.map((slot) => slotKey(slot.kind, slot.code, slot.yearMonth))));
  await writeHolds(holds);
  if (guardNotes.size > 0) {
    const { warnings, summary } = guardLines([...guardNotes.values()]);
    for (const line of warnings) console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
  }

  console.log(
    `[fetch-realestate] 원본 저장 — 갱신 ${changedSlots}슬롯 · 새 거래 ${arrived.toLocaleString("ko-KR")}건` +
      (plan.expired.length ? ` · 만료 ${plan.expired.length}슬롯 삭제` : "")
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
