/**
 * 건축HUB 주택인허가(HsPmsHubService) 수집기 골격 (#130, #58 단계 A).
 *
 *   BUILDINGHUB_API_KEY=... node scripts/fetch-housing-permits.mjs \
 *     [--bjdong-file research/housing-permits/bjdong-seoul.json] [--out-dir research/housing-permits]
 *
 * - 키(BUILDINGHUB_API_KEY)가 없으면 "생략" 로그만 남기고 종료 코드 0, 네트워크는 쓰지 않는다.
 * - 서울 25개 구 x 법정동을 순서대로(결정성) 돌고 쪽을 끝까지 받는다. 전수 순회가 끝나야만
 *   <out-dir>/folded.json을 쓴다. 한 곳이라도 실패하면 아무것도 쓰지 않고 실패 목록을 남긴다(종료 3).
 * - 일 호출 한도(DAILY_LIMIT 5000 이하, 재시도 포함)에 닿거나 서버가 429·한도 초과 코드(22)를 주면 재시도 없이
 *   그 자리에서 중단한다(종료 3, 쓰지 않음).
 * - --license(포털 페이지의 이용허락범위 문자열)가 "제한 없음"이 아니면 호출 없이 종료 1(소유자 조건 4). 메타에 남긴다.
 * - 접은 결과는 합침 단계(housing-permits-merge.mjs: 셀 사업 수 n<3 -> 기타 구)를 거친 것만 folded.json에 쓴다.
 * - 응답 필드가 가정(housing-permits-spec.mjs)과 다르면 쓰지 않고 종료 1.
 * - 원본은 저장소에 두지 않는다. 쪽 본문의 sha256을 이어 붙인 해시만 folded.json meta에 남기고,
 *   BUILDINGHUB_RAW_DIR(저장소 밖이어야 한다. 안이면 호출 전에 종료 1)을 주면 쪽 본문을 거기에 쓴다.
 *   응답 항목은 받자마자 필요한 필드만 남긴다(projectItem).
 * - 법정동 코드 목록(bjdongCd)은 저장소에 없다. --bjdong-file이 없으면 호출 없이 종료 1.
 *   형태: {"11110": ["10100", ...], ... 25구 전부}. 출처 결정은 미정(PR 본문 참조).
 * - 실제 호출은 이 이슈 범위 밖이다. 시험은 스텁 서버(BUILDINGHUB_API_ENDPOINT)로만 돈다.
 */
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { DISTRICTS } from "./realestate-districts.mjs";
import { assertCoreFields, foldProjects, projectItem, readUnits, ShapeError } from "./housing-permits-fold.mjs";
import { mergeSmallCells } from "./housing-permits-merge.mjs";
import { DAILY_LIMIT, DEFAULT_ENDPOINT, FIELDS, LICENSE, OPERATION, PAGE_SIZE } from "./housing-permits-spec.mjs";

const EXIT_SHAPE = 1;
const EXIT_INCOMPLETE = 3;
const MAX_ATTEMPTS = 3;
const ABORT_AFTER = 20; // 연속 실패가 이만큼이면 더 두드리지 않고 멈춘다
const MAX_PAGES = 1000;
const BODY_PREVIEW_CHARS = 200;

function numberEnv(name, fallback, env = process.env) {
  const raw = String(env[name] ?? "").trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * 키 정규화. data.go.kr 키는 인코딩(%2B 등)·디코딩 두 형태로 발급 화면에 나온다. 어느 쪽을 넣어도
 * 같은 디코딩 값으로 맞추고, 요청에서 한 번만 encodeURIComponent 한다(이중 인코딩 방지).
 * 앞뒤 공백·개행·따옴표는 지운다. 빈 값이면 "".
 */
/** 일 호출 한도. 기본 DAILY_LIMIT(5000)이고 환경변수로는 그보다 낮게만 줄일 수 있다(소유자 조건 5). */
export function dailyLimit(env = process.env) {
  return Math.min(numberEnv("BUILDINGHUB_DAILY_LIMIT", DAILY_LIMIT, env), DAILY_LIMIT);
}

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
/** 시험 호출 모드의 호출 수 상한(--max-calls)에 닿음. 일 한도(LimitError)와 달리 의도한 끝이라 정상 종료다. */
class TrialCapError extends Error {}

/**
 * data.go.kr 공통 오류 22 = LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR(서비스 요청제한횟수 초과).
 * 코드 자리가 JSON 헤더(resultCode)와 XML 공통 헤더(returnReasonCode)에서 다르고, 앞자리 0이 붙기도 해서
 * 숫자로 견주고, 메시지에 이름이 있으면 코드와 무관하게 한도 신호로 본다.
 */
function isLimitCode(code, message) {
  return Number(code) === 22 || /LIMITED_NUMBER_OF_SERVICE_REQUESTS|REQUESTS_EXCEEDS/i.test(String(message ?? ""));
}
class IncompleteError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * RAW_DIR은 저장소 밖이어야 한다(소유자 조건 1·원본은 저장소 밖). 아직 없는 폴더도 가장 가까운 기존 조상을
 * realpath로 풀어 견주므로 심볼릭 링크로 저장소 안을 가리켜도 막힌다. 저장소 루트 자신도 안으로 본다.
 */
async function assertOutsideRepo(dir) {
  const repoRoot = await realpath(path.resolve(import.meta.dirname, ".."));
  let probe = path.resolve(dir);
  const rest = [];
  for (;;) {
    try { probe = await realpath(probe); break; } catch {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      rest.unshift(path.basename(probe));
      probe = parent;
    }
  }
  const resolved = path.join(probe, ...rest);
  const rel = path.relative(repoRoot, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new ShapeError(`BUILDINGHUB_RAW_DIR가 저장소 안이다: 원본은 저장소 밖에 둔다(${resolved})`);
  }
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

/**
 * 중단·종료 때 남기는 진행 줄. 개수와 위치(구 코드·쪽 번호)뿐이다 - 키·사업 관리번호·응답 값은 넣지 않는다(#141).
 * 호출 한도 줄에는 시험 상한이 있으면 그 상한을 쓴다.
 */
function progressLine(ctx) {
  const where = ctx.where ? ` · 마지막 호출 위치 구 ${ctx.where.sigungu} 쪽 ${ctx.where.pageNo}` : "";
  return `진행: 처리한 동 ${ctx.dongsDone}/${ctx.dongsTotal} · 쪽 ${ctx.pages} · 호출 ${ctx.calls}/${ctx.trialCap ?? ctx.limit} · 누적 항목 ${ctx.items}${where}`;
}

/** 쪽 하나. 호출 한 번(재시도 별도)의 결과 {items, totalCount, text}. */
async function requestPage(ctx, sigungu, bjdong, pageNo) {
  if (ctx.trialCap !== null && ctx.calls >= ctx.trialCap) throw new TrialCapError(`시험 호출 상한 ${ctx.trialCap}건에 닿아 중단`);
  if (ctx.calls >= ctx.limit) throw new LimitError(`일 호출 한도 ${ctx.limit}건에 닿아 중단`);
  ctx.calls += 1;
  ctx.where = { sigungu, pageNo };
  const query = new URLSearchParams({
    sigunguCd: sigungu, bjdongCd: bjdong, pageNo: String(pageNo), numOfRows: String(ctx.pageSize), _type: "json",
  });
  const url = `${ctx.endpoint}/${OPERATION}?serviceKey=${encodeURIComponent(API_KEY)}&${query}`;
  // redirect: "error" - 다른 주소로 따라가지 않는다(쿼리의 serviceKey가 새지 않게). 리다이렉트는 일반 실패로 센다.
  const res = await fetch(url, { signal: AbortSignal.timeout(ctx.timeoutMs), redirect: "error" });
  const text = await res.text();
  // 사업 관리번호 필드가 보이는 본문은 데이터 응답이라 공개 로그에 미리보기를 싣지 않는다(#141).
  const diagnostic = () =>
    `http ${res.status} · content-type ${res.headers.get("content-type")} · ` +
    (text.includes(FIELDS.id)
      ? "본문은 데이터 응답으로 보여 생략"
      : `본문 앞 ${BODY_PREVIEW_CHARS}자: ${mask(text).slice(0, BODY_PREVIEW_CHARS).replace(/\s+/g, " ")}`);
  // 429는 재시도하지 않고 바로 멈춘다(소유자 조건 5). 다시 두드리면 한도 초과를 키운다.
  if (res.status === 429) throw new LimitError(`HTTP 429 - 호출 제한 응답, 즉시 중단 — ${diagnostic()}`);
  if (!res.ok) throw new Error(`HTTP 오류 — ${diagnostic()}`);
  let parsed;
  try { parsed = parseBody(text); } catch { parsed = null; }
  if (!parsed) throw new Error(`JSON·XML이 아닌 응답 — ${diagnostic()}`);

  const header = parsed?.response?.header;
  if (!header) {
    const common = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    const msg = common?.errMsg ?? "알 수 없는 응답 형식";
    if (isLimitCode(common?.returnReasonCode, msg)) throw new LimitError(`한도 초과 응답(${common?.returnReasonCode}), 즉시 중단 — ${diagnostic()}`);
    throw new Error(`${msg} — ${diagnostic()}`);
  }
  if (isLimitCode(header.resultCode, header.resultMsg)) throw new LimitError(`한도 초과 응답(${header.resultCode}), 즉시 중단 — ${diagnostic()}`);
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
      if (err instanceof LimitError || err instanceof TrialCapError || err instanceof ShapeError) throw err;
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
    ctx.items += page.items.length;
    ctx.maxPageItems = Math.max(ctx.maxPageItems, page.items.length);
    if (pageNo === 1) ctx.totalCountSum += page.totalCount;
    if (page.items.length > 0) ctx.districtsWithData.add(sigungu);
    for (const item of page.items) for (const key of Object.keys(item ?? {})) ctx.responseFields.add(key); // 이름만(B4)
    assertCoreFields(page.items);
    // 위치(구·쪽 번호)만 적는다. 사업 관리번호·읽지 못한 값은 공개 로그에 남기지 않는다(#141).
    page.items.forEach((item, index) => {
      if (readUnits(item[FIELDS.units]) === null) throw new ShapeError(`호수를 읽을 수 없음: 구 ${sigungu} 쪽 ${pageNo} ${index + 1}번째 항목 (${FIELDS.units} 값이 숫자가 아니거나 음수)`);
    });
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
    // push(...배열)은 인자가 13만 개를 넘으면 스택이 터진다(재현됨) - 하나씩 넣는다. 필요한 필드만 남긴다.
    for (const item of page.items) items.push(projectItem(item, ctx.inputTimeField));
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
      license: { type: "string", default: "" },
      "page-modified": { type: "string", default: "" },
      "collected-at": { type: "string", default: "" },
      "input-time-field": { type: "string", default: "" },
      // 시험 호출(#141): 둘 중 하나라도 주면 아무것도 저장하지 않고 개수 요약만 남긴다.
      "only-district": { type: "string" },
      "max-calls": { type: "string" },
    },
  });
  // 이용허락범위는 응답에 없고 포털 페이지 속성이라, 사람이 읽은 문자열을 입력으로 받아 견준다(소유자 조건 4).
  // 호출 전에 멈춘다 - 제한이 있으면 한 건도 부르지 않는다.
  if (v.license.trim() !== LICENSE.text) {
    throw new ShapeError(`이용허락범위가 "${LICENSE.text}"이 아니다(받은 값 ${JSON.stringify(v.license)}): 호출하지 않는다. 소유자 결정 요청 대상`);
  }
  if (v["input-time-field"] && !/^[A-Za-z][A-Za-z0-9_]*$/.test(v["input-time-field"])) throw new ShapeError("--input-time-field는 영문·숫자 필드 이름이어야 한다");
  const collectedAt = v["collected-at"] || new Date().toISOString();
  if (Number.isNaN(Date.parse(collectedAt))) throw new ShapeError(`--collected-at이 시각이 아니다: ${collectedAt}`);
  const bjdong = await loadBjdong(v["bjdong-file"]);
  // 시험 호출 입력 검증 - 호출 전에. 주어졌는데 비었거나 틀리면 전체 수집으로 넘어가지 않고 멈춘다.
  const trial = v["only-district"] !== undefined || v["max-calls"] !== undefined;
  const districts = DISTRICTS.filter((d) => v["only-district"] === undefined || d.code === v["only-district"].trim());
  if (v["only-district"] !== undefined && (!/^\d{5}$/.test(v["only-district"].trim()) || districts.length !== 1)) {
    throw new ShapeError("--only-district는 서울 25구 중 하나의 5자리 시군구 코드여야 한다");
  }
  if (v["max-calls"] !== undefined && !/^[1-9]\d{0,5}$/.test(v["max-calls"].trim())) throw new ShapeError("--max-calls는 1 이상의 정수여야 한다");
  const limit = dailyLimit();
  // 시험 상한은 일 한도를 낮추기만 한다(소유자 조건 5). 일 한도 이상이면 상한은 없는 것과 같고 일 한도가 막는다.
  const maxCalls = v["max-calls"] === undefined ? null : Number(v["max-calls"].trim());
  // 시험 모드는 원본을 만들지 않는다 - RAW_DIR이 주어져도 무시한다.
  const rawDir = trial ? null : String(process.env.BUILDINGHUB_RAW_DIR ?? "").trim() || null;
  if (rawDir) {
    await assertOutsideRepo(rawDir);
    await mkdir(rawDir, { recursive: true });
  }

  const ctx = {
    endpoint: endpointFromEnv(),
    limit, trialCap: maxCalls !== null && maxCalls < limit ? maxCalls : null,
    pageSize: numberEnv("BUILDINGHUB_PAGE_SIZE", PAGE_SIZE) || PAGE_SIZE,
    timeoutMs: numberEnv("BUILDINGHUB_TIMEOUT_MS", 15_000),
    retryMs: numberEnv("BUILDINGHUB_RETRY_MS", 3000),
    calls: 0, pages: 0, items: 0, maxPageItems: 0, totalCountSum: 0, dongsDone: 0, dongsTotal: districts.reduce((n, d) => n + bjdong[d.code].length, 0), where: null, rawDir, rawHash: createHash("sha256"),
    inputTimeField: v["input-time-field"] || null, responseFields: new Set(), districtsWithData: new Set(),
  };

  const all = [];
  const failures = [];
  let dongCount = 0;
  let failedInARow = 0;
  let aborted = false;
  let capped = false;
  try {
    walk: for (const { code, name } of districts) {
      for (const dong of [...bjdong[code]].map(String).sort()) {
        dongCount += 1;
        try {
          for (const item of await collectDong(ctx, code, dong)) all.push(item); // spread 금지(스택)
          failedInARow = 0;
          ctx.dongsDone += 1;
        } catch (err) {
          if (err instanceof TrialCapError) { capped = true; break walk; }
          if (err instanceof LimitError || err instanceof ShapeError) throw err;
          failures.push(`${name}(${code}) ${dong}: ${describeError(err)}`);
          failedInARow += 1;
          if (failedInARow >= ABORT_AFTER) { aborted = true; break walk; }
        }
      }
    }
  } catch (err) {
    // 일 한도·429·응답 모양 오류로 멈춘 자리에서 얼마나 왔는지 남긴다(#141, 값 없이 개수만).
    warn(progressLine(ctx));
    throw err;
  }

  if (failures.length > 0) {
    warn(progressLine(ctx));
    warn(`수집 실패 ${failures.length}건${aborted ? ` (연속 ${ABORT_AFTER}건 실패로 중단, 남은 법정동은 부르지 않음)` : ""} — 아무것도 쓰지 않음`);
    for (const line of failures.slice(0, 50)) warn(`  ${line}`);
    if (failures.length > 50) warn(`  … 외 ${failures.length - 50}건`);
    throw new IncompleteError("전수 순회 실패");
  }

  if (trial) {
    // 시험 호출: 저장하지 않는다(folded.json·measure.json·원본 없음). 개수 요약만 남긴다. 상한에 닿은 부분 수집은
    // 날짜·취소 필드가 일부 비는 게 정상이라 접기 검사를 생략하고, 끝까지 받은 경우만 메모리에서 접어 필드 가정을 확인한다.
    let fold = "접기 검사 생략(상한에 닿은 부분 수집)";
    if (!capped) {
      try {
        const m = foldProjects(all, { inputTimeField: ctx.inputTimeField }).meta;
        fold = `접기 검사 통과(메모리만): 입력 ${m.input} · 사업 ${m.projects} · 중복 ${m.duplicates} · 취소 ${m.cancelled}`;
      } catch (err) {
        warn(progressLine(ctx));
        throw err;
      }
    }
    say(`시험 호출 요약(저장 없음): 구 ${districts.length}개(${districts.map((d) => d.code).join(",")}) · 상태 ${capped ? "완료 아님(호출 상한 도달)" : "완료"}`);
    say(progressLine(ctx));
    say(`요청 쪽 크기 ${ctx.pageSize} · 한 쪽 최대 수신 항목 ${ctx.maxPageItems} · 동별 totalCount 합 ${ctx.totalCountSum}`);
    say(`응답 필드 이름: ${[...ctx.responseFields].sort().join(", ")}`);
    say(fold);
    return;
  }

  // 접기 -> 합침 -> 쓰기. 합침 전 결과(구·달별 n<3 칸이 있는 것)는 변수로만 있고 어디에도 쓰지 않는다.
  const merged = mergeSmallCells(foldProjects(all, { inputTimeField: ctx.inputTimeField }));
  const out = {
    meta: {
      ...merged.meta, operation: OPERATION, districts: DISTRICTS.length, dongs: dongCount, pages: ctx.pages, calls: ctx.calls,
      updatedAt: new Date(collectedAt).toISOString(),
      license: { text: v.license.trim(), expected: LICENSE.text, checkedOn: LICENSE.checkedOn, pageModified: v["page-modified"] },
      districtsWithData: [...ctx.districtsWithData].sort(),
      responseFields: [...ctx.responseFields].sort(),
      rawSha256: ctx.rawHash.digest("hex"),
      ...(merged.inputLag ? { inputLag: merged.inputLag } : {}),
    },
    series: merged.series,
    unknown: merged.unknown,
    cancelledPermit: merged.cancelledPermit,
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
