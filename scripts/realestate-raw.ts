import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sameNames } from "./complex-id.ts";
import { slotKey } from "./realestate-slots.ts";

export const RAW_DIR = process.env.REALESTATE_RAW_DIR
  ? path.resolve(process.env.REALESTATE_RAW_DIR)
  : path.resolve(import.meta.dirname, "../raw");

export const KINDS = ["sale", "rent"];

const FILE_PATTERN = /^(\d{5})-(\d{6})\.json$/;

export const rawPath = (kind, code, yearMonth, dir = RAW_DIR) =>
  path.join(dir, kind, `${code}-${yearMonth}.json`);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

const sortKey = (item) => JSON.stringify(item);

export const itemKey = (item) => createHash("sha1").update(sortKey(item)).digest("hex").slice(0, 12);

const kstDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));

function serialize({ items, arrivals, ...meta }) {
  const head = JSON.stringify({ ...meta, arrivals: arrivals ?? {} }).slice(0, -1);
  const body = items.length ? `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]` : "[]";
  return `${head},"items":${body}}\n`;
}

function serializeWithoutArrivals({ items, ...meta }) {
  const head = JSON.stringify(meta).slice(0, -1);
  const body = items.length ? `[\n${items.map((item) => JSON.stringify(item)).join(",\n")}\n]` : "[]";
  return `${head},"items":${body}}\n`;
}

export function buildSlotFile({ kind, code, yearMonth, items, totalCount, ok = true, resultCode = 0, observedAt, previousObservedAt = null }) {
  const rows = (items ?? []).map(canonical).sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  return {
    kind,
    district: code,
    yearMonth,
    ok,
    resultCode,
    count: rows.length,
    totalCount: Number.isInteger(totalCount) ? totalCount : rows.length,
    observedAt,
    previousObservedAt,
    items: rows,
  };
}

export async function readSlotFile(kind, code, yearMonth, dir = RAW_DIR) {
  try {
    return JSON.parse(await readFile(rawPath(kind, code, yearMonth, dir), "utf-8"));
  } catch {
    return null;
  }
}

function trackArrivals(payload, previous) {
  if (!previous) return { arrivals: {}, added: 0 };

  const known = new Set((previous.items ?? []).map(itemKey));
  const before = previous.arrivals ?? {};
  const day = kstDay(payload.observedAt);

  const arrivals = {};
  let added = 0;

  for (const item of payload.items) {
    const key = itemKey(item);
    if (before[key]) arrivals[key] = before[key];
    else if (!known.has(key)) {
      arrivals[key] = day;
      added += 1;
    }
  }

  return { arrivals, added };
}

export async function writeSlotFile(payload, dir = RAW_DIR) {
  const { kind, district, yearMonth } = payload;
  const file = rawPath(kind, district, yearMonth, dir);
  const previous = await readSlotFile(kind, district, yearMonth, dir);

  const same =
    previous &&
    previous.ok === payload.ok &&
    previous.count === payload.count &&
    previous.totalCount === payload.totalCount &&
    serializeWithoutArrivals({ ...previous, arrivals: null, observedAt: null, previousObservedAt: null }) ===
      serializeWithoutArrivals({ ...payload, arrivals: null, observedAt: null, previousObservedAt: null });

  if (same) return { changed: false, added: 0 };

  const { arrivals, added } = trackArrivals(payload, previous);
  const record = { ...payload, previousObservedAt: previous?.observedAt ?? null, arrivals };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serialize(record));

  return { changed: true, added };
}

export async function removeSlotFile(kind, code, yearMonth, dir = RAW_DIR) {
  await rm(rawPath(kind, code, yearMonth, dir), { force: true });
}

export async function readSlots(dir = RAW_DIR) {
  const slots = {};

  for (const kind of KINDS) {
    let names = [];
    try {
      names = await readdir(path.join(dir, kind));
    } catch {
      continue;
    }

    for (const name of names) {
      const matched = FILE_PATTERN.exec(name);
      if (!matched) continue;

      const [, code, yearMonth] = matched;
      const file = await readSlotFile(kind, code, yearMonth, dir);
      slots[slotKey(kind, code, yearMonth)] = file
        ? { ok: file.ok !== false, count: file.count, totalCount: file.totalCount }
        : { ok: false };
    }
  }

  return slots;
}

/**
 * 구별로 둘 이상의 동에 나타나는 단지명: { 구 코드: Set }. 보관 중인 슬롯 전부(매매+전월세)를 본다 - 어떤 빌더가 언제 불러도 같은 원본이면
 * 같은 답이어야 파일끼리 키가 맞으므로 시각을 받지 않는다(이유는 complex-id.ts 머리 주석). 받다가 실패한 슬롯은 줄이 없어 세지 않는다.
 */
export async function readSameNames(dir = RAW_DIR) {
  const seen = new Map();
  const out = {};
  for (const kind of KINDS) {
    const names = await readdir(path.join(dir, kind)).catch(() => []);
    for (const name of names.sort()) {
      const matched = FILE_PATTERN.exec(name);
      if (!matched) continue;
      const file = await readSlotFile(kind, matched[1], matched[2], dir);
      if (file?.ok === false || !Array.isArray(file?.items)) continue;
      if (!seen.has(matched[1])) seen.set(matched[1], new Map());
      out[matched[1]] ??= new Set();
      sameNames(file.items, seen.get(matched[1]), out[matched[1]]);
    }
  }
  return out;
}
