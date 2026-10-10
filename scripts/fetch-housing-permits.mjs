/**
 * 건축HUB 주택인허가(HsPmsHubService) 수집기 골격 (#130, #58 단계 A).
 *
 *   BUILDINGHUB_API_KEY=... node scripts/fetch-housing-permits.mjs \
 *     [--bjdong-file research/housing-permits/bjdong-seoul.json] [--out-dir research/housing-permits]
 *
 * - 키(BUILDINGHUB_API_KEY)가 없으면 "생략" 로그만 남기고 종료 코드 0, 네트워크는 쓰지 않는다.
 * - 서울 25개 구 x 법정동을 순서대로(결정성) 돌고 쪽을 끝까지 받는다. 전수 순회가 끝나야만
 *   <out-dir>/folded.json을 쓴다. 한 곳이라도 실패하면 아무것도 쓰지 않고 실패 목록을 남긴다(종료 3).
 * - 일 호출 한도(DAILY_LIMIT, 재시도 포함)에 닿으면 그 자리에서 중단한다(종료 3, 쓰지 않음).
 * - 응답 필드가 가정(housing-permits-spec.mjs)과 다르면 쓰지 않고 종료 1.
 * - 원본은 저장소에 두지 않는다. 쪽 본문의 sha256을 이어 붙인 해시만 folded.json meta에 남기고,
 *   BUILDINGHUB_RAW_DIR(저장소 밖)을 주면 쪽 본문을 거기에 쓴다(원본 크기는 cto가 잰다).
 * - 법정동 코드 목록(bjdongCd)은 저장소에 없다. --bjdong-file이 없으면 호출 없이 종료 1.
 *   형태: {"11110": ["10100", ...], ... 25구 전부}. 출처 결정은 미정(PR 본문 참조).
 * - 실제 호출은 이 이슈 범위 밖이다. 시험은 스텁 서버(BUILDINGHUB_API_ENDPOINT)로만 돈다.
 */
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DISTRICTS } from "./realestate-districts.mjs";
import { assertCoreFields, foldProjects, ShapeError } from "./housing-permits-fold.mjs";
import { DAILY_LIMIT, DEFAULT_ENDPOINT, FIELDS, OPERATION, PAGE_SIZE } from "./housing-permits-spec.mjs";

const EXIT_SHAPE = 1;
const EXIT_INCOMPLETE = 3;
const MAX_ATTEMPTS = 3;
const ABORT_AFTER = 20; // 연속 실패가 이만큼이면 더 두드리지 않고 멈춘다
const MAX_PAGES = 1000;
const BODY_PREVIEW_CHARS = 200;

function numberEnv(name, fallback) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * 키 정규화. data.go.kr 키는 인코딩(%2B 등)·디코딩 두 형태로 발급 화면에 나온다. 어느 쪽을 넣어도
 * 같은 디코딩 값으로 맞추고, 요청에서 한 번만 encodeURIComponent 한다(이중 인코딩 방지).
 * 앞뒤 공백·개행·따옴표는 지운다. 빈 값이면 "".
 */
export function normalizeServiceKey(raw) {
  let key = String(raw ?? "").trim().replace(/^["']|["']$/g, "").trim();
  if (/%[0-9a-f]{2}/i.test(key)) {
    try { key = decodeURIComponent(key); } catch { /* 디코딩 불가면 있는 그대로 */ }
  }
  return key;
}

const RAW_KEY = String(process.env.BUILDINGHUB_API_KEY ?? "");
const API_KEY = normalizeServiceKey(RAW_KEY);

// 출력되는 모든 문자열은 찍기 전에 키(원문·정규화·인코딩 꼴)를 ***로 바꾼다. 자르는 것은 그 뒤다 -
// 자르기를 먼저 하면 경계에 걸친 키의 앞부분이 남는다(PR #109와 같은 원칙).
function mask(text) {
  let out = String(text ?? "");
  const forms = [RAW_KEY.trim(), API_KEY, encodeURIComponent(API_KEY), encodeURIComponent(RAW_KEY.trim())]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const form of new Set(forms)) out = out.split(form).join("***");
  return out;
}
const say = (msg) => console.log(`[fetch-housing-permits] ${mask(msg)}`);
const warn = (msg) => console.error(`[fetch-housing-permits] ${mask(msg)}`);

class LimitError extends Error {}
class IncompleteError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endpointFromEnv() {
  const endpoint = (String(process.env.BUILDINGHUB_API_ENDPOINT ?? "").trim() || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const url = new URL(endpoint);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new ShapeError("endpoint는 https여야 한다(키가 평문으로 나간다)");
  return endpoint;
}

function describeError(err) {
  const parts = [err?.message ?? String(err)];
  let cause = err?.cause;
  for (let depth = 0; cause && depth < 3; depth += 1) {
    parts.push(cause.code ?? cause.message ?? String(cause));
    cause = cause.cause;
  }
  return parts.filter(Boolean).join(" ← ");
}

function parseBody(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  if (trimmed.startsWith("<")) return new XMLParser({ parseTagValue: false, parseAttributeValue: false }).parse(trimmed);
  return null;
}

/** 쪽 하나. 호출 한 번(재시도 별도)의 결과 {items, totalCount, text}. */
async function requestPage(ctx, sigungu, bjdong, pageNo) {
  if (ctx.calls >= ctx.limit) throw new LimitError(`일 호출 한도 ${ctx.limit}건에 닿아 중단`);
  ctx.calls += 1;
  const query = new URLSearchParams({
    sigunguCd: sigungu, bjdongCd: bjdong, pageNo: String(pageNo), numOfRows: String(ctx.pageSize), _type: "json",
  });
  const url = `${ctx.endpoint}/${OPERATION}?serviceKey=${encodeURIComponent(API_KEY)}&${query}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(ctx.timeoutMs) });
  const text = await res.text();
  const diagnostic = () =>
    `http ${res.status} · content-type ${res.headers.get("content-type")} · 본문 앞 ${BODY_PREVIEW_CHARS}자: ` +
    mask(text).slice(0, BODY_PREVIEW_CHARS).replace(/\s+/g, " ");
  if (!res.ok) throw new Error(`HTTP 오류 — ${diagnostic()}`);
  let parsed;
  try { parsed = parseBody(text); } catch { parsed = null; }
  if (!parsed) throw new Error(`JSON·XML이 아닌 응답 — ${diagnostic()}`);

  const header = parsed?.response?.header;
  if (!header) {
    const msg = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "알 수 없는 응답 형식";
    throw new Error(`${msg} — ${diagnostic()}`);
  }
  if (Number(header.resultCode) !== 0) throw new Error(header.resultMsg ?? `resultCode ${header.resultCode}`);

  const body = parsed.response.body ?? {};
  const totalCount = Number(body.totalCount);
  if (!Number.isInteger(totalCount) || totalCount < 0) throw new ShapeError("알 수 없는 응답 필드: totalCount");
  const rawItems = body.items?.item;
  const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
  return { items, totalCount, text };
}

async function requestPageWithRetry(ctx, sigungu, bjdong, pageNo) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestPage(ctx, sigungu, bjdong, pageNo);
    } catch (err) {
      if (err instanceof LimitError || err instanceof ShapeError) throw err;
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * ctx.retryMs);
    }
  }
  throw lastErr;
}

async function collectDong(ctx, sigungu, bjdong) {
  const items = [];
  let total = Infinity;
  for (let pageNo = 1; items.length < total; pageNo += 1) {
    if (pageNo > MAX_PAGES) throw new Error(`쪽이 ${MAX_PAGES}을 넘음`);
    const page = await requestPageWithRetry(ctx, sigungu, bjdong, pageNo);
    ctx.pages += 1;
    assertCoreFields(page.items);
    for (const item of page.items) {
      if (String(item[FIELDS.sigungu]).trim() !== sigungu) {
        throw new ShapeError(`알 수 없는 응답 필드: ${FIELDS.sigungu}=${item[FIELDS.sigungu]} (요청 ${sigungu})`);
      }
    }
    ctx.rawHash.update(createHash("sha256").update(page.text).digest("hex") + "\n");
    if (ctx.rawDir) {
      const file = path.join(ctx.rawDir, `${sigungu}-${bjdong}-${String(pageNo).padStart(4, "0")}.json`);
      await writeFile(file, mask(page.text));
    }
    total = page.totalCount;
    if (page.items.length === 0 && items.length < total) throw new Error(`쪽 ${pageNo}이 비었는데 totalCount ${total}에 못 미침(${items.length})`);
    items.push(...page.items);
  }
  return items;
}

async function loadBjdong(file) {
  let table;
  try {
    table = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new ShapeError(`법정동 코드 목록을 읽을 수 없음: ${file} (출처 미정 — PR #130 본문 참조)`);
  }
  for (const { code, name } of DISTRICTS) {
    const dongs = table[code];
    if (!Array.isArray(dongs) || dongs.length === 0 || !dongs.every((d) => /^\d{5}$/.test(String(d)))) {
      throw new ShapeError(`법정동 코드 목록에 ${name}(${code})이 없거나 5자리 코드가 아님`);
    }
  }
  return table;
}

async function main() {
  if (!API_KEY) {
    warn("BUILDINGHUB_API_KEY 없음, 생략");
    return;
  }
  const { values: v } = parseArgs({
    options: {
      "bjdong-file": { type: "string", default: "research/housing-permits/bjdong-seoul.json" },
      "out-dir": { type: "string", default: "research/housing-permits" },
    },
  });
  const bjdong = await loadBjdong(v["bjdong-file"]);
  const rawDir = String(process.env.BUILDINGHUB_RAW_DIR ?? "").trim() || null;
  if (rawDir) await mkdir(rawDir, { recursive: true });

  const ctx = {
    endpoint: endpointFromEnv(),
    limit: numberEnv("BUILDINGHUB_DAILY_LIMIT", DAILY_LIMIT),
    pageSize: numberEnv("BUILDINGHUB_PAGE_SIZE", PAGE_SIZE) || PAGE_SIZE,
    timeoutMs: numberEnv("BUILDINGHUB_TIMEOUT_MS", 15_000),
    retryMs: numberEnv("BUILDINGHUB_RETRY_MS", 3000),
    calls: 0, pages: 0, rawDir, rawHash: createHash("sha256"),
  };

  const all = [];
  const failures = [];
  let dongCount = 0;
  let failedInARow = 0;
  let aborted = false;
  walk: for (const { code, name } of DISTRICTS) {
    for (const dong of [...bjdong[code]].map(String).sort()) {
      dongCount += 1;
      try {
        all.push(...(await collectDong(ctx, code, dong)));
        failedInARow = 0;
      } catch (err) {
        if (err instanceof LimitError || err instanceof ShapeError) throw err;
        failures.push(`${name}(${code}) ${dong}: ${describeError(err)}`);
        failedInARow += 1;
        if (failedInARow >= ABORT_AFTER) { aborted = true; break walk; }
      }
    }
  }

  if (failures.length > 0) {
    warn(`수집 실패 ${failures.length}건${aborted ? ` (연속 ${ABORT_AFTER}건 실패로 중단, 남은 법정동은 부르지 않음)` : ""} — 아무것도 쓰지 않음`);
    for (const line of failures.slice(0, 50)) warn(`  ${line}`);
    if (failures.length > 50) warn(`  … 외 ${failures.length - 50}건`);
    throw new IncompleteError("전수 순회 실패");
  }

  const folded = foldProjects(all);
  const out = {
    meta: { ...folded.meta, operation: OPERATION, districts: DISTRICTS.length, dongs: dongCount, pages: ctx.pages, calls: ctx.calls, rawSha256: ctx.rawHash.digest("hex") },
    series: folded.series,
    unknown: folded.unknown,
  };
  await mkdir(v["out-dir"], { recursive: true });
  const file = path.join(v["out-dir"], "folded.json");
  await writeFile(`${file}.tmp`, JSON.stringify(out) + "\n");
  await rename(`${file}.tmp`, file);
  say(`${file}: 사업 ${out.meta.projects}건(중복 ${out.meta.duplicates}, 취소 ${out.meta.cancelled}) · 호출 ${ctx.calls}/${ctx.limit}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    warn(describeError(err));
    process.exitCode = err instanceof ShapeError ? EXIT_SHAPE : err instanceof LimitError || err instanceof IncompleteError ? EXIT_INCOMPLETE : EXIT_SHAPE;
  });
}
