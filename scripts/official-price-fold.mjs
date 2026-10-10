/**
 * 공시가격 CSV(data.go.kr 3073746)를 칸으로 접는다 (#68). 원본은 호 단위 행이고, 이 모듈이
 * 만드는 것은 칸·층 통계뿐이다 - 원본 행도 호 식별 값도 결과에 들어가지 않는다(소유자 조건 C1).
 *
 * 실패하면 던진다. 호출한 쪽은 던져진 동안 아무것도 쓰지 않는다(쓰기는 맨 끝, 한 번).
 * 오류 메시지에는 헤더 이름과 줄 번호만 담는다 - 원본 행 내용은 로그에 새지 않게(C1).
 */
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { parcelKey, cellKey, sigunguOf, joinJibun, normalizeJibun, areaKey } from "./official-price-key.mjs";

/** 칸·층 값을 남기는 최소 호수 (C2). 층 차원에서 호 1~2개면 중앙값이 곧 개별 호 값이다. */
export const MIN_HOUSEHOLDS = 3;
/** 이용허락범위 문자열 (C3). 이게 아니면 멈춘다. */
export const REQUIRED_LICENSE = "제한 없음";
/** 상세 페이지 주소 형식. 연도마다 상세 페이지가 다를 수 있어(2025 쪽 페이지는 미확인) 번호를 코드에 박지 않고 입력으로 받는다. */
export const SOURCE_PAGE_RE = /^https:\/\/www\.data\.go\.kr\/data\/(\d+)\/fileData\.do$/;
/** 접힌 파일이 이를 넘으면 닫지 않고 pm에 올린다 (#68 완료 조건 4). */
export const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

/**
 * 헤더 이름 매칭 (열 순서에 기대지 않는다). 소유자 샘플이 없어 이름은 후보다 - 첫 실제 dispatch가
 * "알 수 없는 헤더"로 실패하면 그 출력이 곧 열 이름 확인이고, 그 문자열을 여기 고정한다.
 * 필수 열은 별칭 중 하나가 있어야 하고, 어느 쪽에도 없는 헤더가 하나라도 있으면 실패한다.
 */
export const REQUIRED_COLUMNS = {
  code: ["시군구코드", "법정동코드"],
  dong: ["법정동명", "읍면동명"],
  area: ["전용면적", "전용면적(㎡)"],
  floor: ["층", "층수"],
  price: ["공시가격", "공시가격(원)"],
  baseYear: ["기준연도", "공시기준연도"],
};
/** 지번은 한 열 또는 본번·부번 두 열. */
export const JIBUN_COLUMNS = { single: ["지번"], main: ["본번"], sub: ["부번"] };
/** 읽지 않지만 있어도 되는 헤더 (식별 값 열도 읽지 않고 버린다). */
export const IGNORED_COLUMNS = [
  "시도명", "시군구명", "읍면", "동리", "특수지명", "동명", "단지명", "호명", "호", "건축물대장PK",
  "공시기준일", "기준월", "공동주택구분", "건물명", "대지면적", "산구분", "특수지코드",
];

const clean = (s) => String(s).replace(/^﻿/, "").replace(/\s+/g, "");

/** 헤더 줄 -> 논리 열 위치. 필수 열이 없거나 알 수 없는 헤더가 있으면 던진다. */
export function mapHeader(names) {
  const headers = names.map(clean);
  const idx = new Map();
  headers.forEach((h, i) => { if (!idx.has(h)) idx.set(h, i); });
  if (idx.size !== headers.length) throw new Error("헤더에 같은 이름이 두 번 나온다");

  const pick = (aliases) => {
    const hit = aliases.find((a) => idx.has(clean(a)));
    return hit === undefined ? -1 : idx.get(clean(hit));
  };
  const cols = {};
  const missing = [];
  for (const [logical, aliases] of Object.entries(REQUIRED_COLUMNS)) {
    cols[logical] = pick(aliases);
    if (cols[logical] < 0) missing.push(`${logical}(${aliases.join("|")})`);
  }
  cols.jibun = pick(JIBUN_COLUMNS.single);
  cols.main = pick(JIBUN_COLUMNS.main);
  cols.sub = pick(JIBUN_COLUMNS.sub);
  if (cols.jibun < 0 && cols.main < 0) missing.push(`jibun(${JIBUN_COLUMNS.single}|${JIBUN_COLUMNS.main}+${JIBUN_COLUMNS.sub})`);
  if (missing.length) throw new Error(`필수 열이 헤더에 없다: ${missing.join(", ")}. 실제 헤더: ${headers.join(",")}`);

  const known = new Set([
    ...Object.values(REQUIRED_COLUMNS).flat(),
    ...Object.values(JIBUN_COLUMNS).flat(),
    ...IGNORED_COLUMNS,
  ].map(clean));
  const unknown = headers.filter((h) => !known.has(h));
  if (unknown.length) throw new Error(`알 수 없는 헤더: ${unknown.join(", ")}. 실제 헤더: ${headers.join(",")}`);
  return cols;
}

/**
 * 한 줄 CSV 파싱 (큰따옴표 감쌈, `""` 이스케이프). 줄 안에 개행이 없다는 게 페이지 기재라
 * 여는 따옴표가 줄 끝까지 닫히지 않으면 던진다.
 */
export function parseCsvLine(line) {
  const out = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    if (line[i] === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= n) throw new Error("닫히지 않은 따옴표");
        if (line[i] === '"') {
          if (line[i + 1] === '"') { value += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        value += line[i];
        i += 1;
      }
      out.push(value);
      if (i < n && line[i] !== ",") throw new Error("따옴표 뒤에 쉼표가 아닌 글자");
    } else {
      let j = line.indexOf(",", i);
      if (j < 0) j = n;
      out.push(line.slice(i, j));
      i = j;
    }
    if (i >= n) break;
    i += 1; // 쉼표
    if (i === n) { out.push(""); break; }
  }
  return out;
}

export function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** 이 모듈이 내보낼 수 있는 키의 전부 (C4). 여기 없는 키가 나오면 assertDerived가 실패시킨다. */
export const ALLOWED_KEYS = {
  top: ["meta", "cells", "parcels"],
  meta: [
    "source", "baseYear", "license", "pageModified", "rawCommit", "sourceSha256", "sha256Of",
    "totalRows", "seoulRows", "targetParcels", "targetParcelsFound", "cells", "cellsBelowMin", "parcels", "minHouseholds",
  ],
  cell: ["s", "d", "j", "a", "n", "m", "f"],
  floor: ["l", "n", "m"],
  parcel: ["s", "d", "j", "n"],
};

const exactKeys = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) throw new Error(`허용 외 필드 ${where}.${k}`);
  }
};

/**
 * 접힌 결과가 약속을 지키는지 본다 - 쓰기 직전에 부르고, 낙제 시험과 커밋된 파일 검사도 같은 함수를 쓴다.
 * 허용 외 필드(호·동·단지 식별 값 유입), 호 n<MIN 칸·층, 문자열이 아닌 좌표, 호 단위 행을 막는다.
 */
export function assertDerived(out) {
  if (!out || typeof out !== "object" || Array.isArray(out)) throw new Error("접힌 결과가 객체가 아니다");
  exactKeys(out, ALLOWED_KEYS.top, "top");
  exactKeys(out.meta ?? {}, ALLOWED_KEYS.meta, "meta");
  if (!Array.isArray(out.cells) || !Array.isArray(out.parcels)) throw new Error("cells·parcels가 배열이 아니다");
  const min = out.meta?.minHouseholds ?? MIN_HOUSEHOLDS;
  if (min < MIN_HOUSEHOLDS) throw new Error(`minHouseholds ${min} < ${MIN_HOUSEHOLDS}`);
  const isInt = (v) => Number.isInteger(v);
  for (const c of out.cells) {
    exactKeys(c, ALLOWED_KEYS.cell, "cells[]");
    if (!isInt(c.n) || c.n < MIN_HOUSEHOLDS) throw new Error(`칸 호수 ${c.n} < ${MIN_HOUSEHOLDS}`);
    if (!isInt(c.m)) throw new Error("칸 중앙값이 정수가 아니다");
    for (const k of ["s", "d", "j", "a"]) if (typeof c[k] !== "string") throw new Error(`칸 ${k}가 문자열이 아니다`);
    for (const f of c.f ?? []) {
      exactKeys(f, ALLOWED_KEYS.floor, "cells[].f[]");
      if (!isInt(f.n) || f.n < MIN_HOUSEHOLDS) throw new Error(`층 호수 ${f.n} < ${MIN_HOUSEHOLDS}`);
      if (!isInt(f.l) || !isInt(f.m)) throw new Error("층 값이 정수가 아니다");
    }
  }
  for (const p of out.parcels) {
    exactKeys(p, ALLOWED_KEYS.parcel, "parcels[]");
    if (!isInt(p.n) || p.n < 1) throw new Error("지번 호수가 양의 정수가 아니다");
  }
}

/** dispatch 입력 검사. 하나라도 어긋나면 던진다 - 스트림을 읽기 전에 부른다. */
export function checkInputs(input) {
  if ((input.license ?? "").trim() !== REQUIRED_LICENSE) {
    throw new Error(`이용허락범위가 "${REQUIRED_LICENSE}"이 아니다: "${input.license ?? ""}"`);
  }
  // 수정일·상세 페이지는 연도마다(2025 파일 포함) 메타에 남는 값이라 비면 멈춘다 (clo C3 권고). 형식은 정하지 않는다 - 페이지 표기 그대로.
  if (!(input.pageModified ?? "").trim()) throw new Error("상세 페이지 수정일 입력이 비었다");
  if (!SOURCE_PAGE_RE.test((input.sourcePage ?? "").trim())) throw new Error("상세 페이지 주소가 https://www.data.go.kr/data/<번호>/fileData.do 형식이 아니다");
  if (!/^[0-9a-f]{64}$/i.test(input.sha256 ?? "")) throw new Error("sha256 입력이 64자리 16진수가 아니다");
  if (!Number.isInteger(input.baseYear) || input.baseYear < 2000) throw new Error("기준연도 입력이 올바르지 않다");
  if (!Number.isInteger(input.rows) || input.rows <= 0) throw new Error("행수 입력이 올바르지 않다");
  if (!/^[0-9a-f]{40}$/.test(input.rawCommit ?? "")) throw new Error("rawCommit이 40자리 커밋 해시가 아니다");
  if (!(input.targets instanceof Set) || input.targets.size === 0) throw new Error("대상 지번이 비었다");
}

/**
 * 스트림(Buffer 조각의 async iterable)을 읽어 접는다.
 * input: { sha256, zipSha256?, rows, baseYear, license, pageModified, sourcePage, rawCommit, targets:Set<parcelKey> }
 * 반환: 쓸 객체(assertDerived 통과 후). 해시·행수·기준연도·열 구성이 어긋나면 던진다.
 */
export async function foldStream(stream, input) {
  checkInputs(input);
  const hash = createHash("sha256");
  const decoder = new StringDecoder("utf8");
  let cols = null;
  let carry = "";
  let lineNo = 0;
  let totalRows = 0;
  let seoulRows = 0;
  const parcelRows = new Map(); // parcelKey -> 호수
  const cells = new Map(); // cellKey -> { all:number[], floors: Map<층, number[]> }

  const onLine = (line) => {
    lineNo += 1;
    if (line === "" ) return; // 파일 끝 빈 줄
    let f;
    // 첫 줄 앞의 BOM은 따옴표 앞에 붙어 오므로 파싱 전에 벗긴다(헤더 매칭이 깨지지 않게).
    if (lineNo === 1) line = line.replace(/^\uFEFF/, "");
    try { f = parseCsvLine(line); } catch (e) { throw new Error(`${lineNo}번째 줄 파싱 실패: ${e.message}`); }
    if (!cols) {
      cols = mapHeader(f);
      cols.width = f.length;
      return;
    }
    if (f.length !== cols.width) throw new Error(`${lineNo}번째 줄 열 수 ${f.length} != 헤더 ${cols.width}`);
    totalRows += 1;
    if (Number(f[cols.baseYear].trim()) !== input.baseYear) {
      throw new Error(`${lineNo}번째 줄 기준연도가 입력 ${input.baseYear}과 다르다`);
    }
    const sgg = sigunguOf(f[cols.code]);
    if (!sgg) throw new Error(`${lineNo}번째 줄 시군구 코드를 읽을 수 없다`);
    if (!sgg.startsWith("11")) return; // 서울 밖은 버린다
    seoulRows += 1;
    const jibun = cols.jibun >= 0 ? normalizeJibun(f[cols.jibun]) : joinJibun(f[cols.main], cols.sub >= 0 ? f[cols.sub] : "");
    const dong = f[cols.dong].trim();
    const pKey = parcelKey(sgg, dong, jibun);
    if (!pKey || !input.targets.has(pKey)) return;
    parcelRows.set(pKey, (parcelRows.get(pKey) ?? 0) + 1);
    const price = Number(String(f[cols.price]).replace(/,/g, ""));
    const aKey = areaKey(f[cols.area]);
    if (!aKey || !(price > 0)) return; // 호수에는 셌고 값이 없는 행은 칸에 못 넣는다
    const key = cellKey(sgg, dong, jibun, f[cols.area]);
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { all: [], floors: new Map() }));
    cell.all.push(price);
    const floor = Number(f[cols.floor]);
    if (Number.isInteger(floor)) {
      const list = cell.floors.get(floor) ?? [];
      list.push(price);
      cell.floors.set(floor, list);
    }
  };

  const feed = (text) => {
    carry += text;
    let at;
    while ((at = carry.indexOf("\n")) >= 0) {
      const line = carry.slice(0, at).replace(/\r$/, "");
      carry = carry.slice(at + 1);
      onLine(line);
    }
  };
  for await (const chunk of stream) {
    hash.update(chunk);
    feed(decoder.write(chunk));
  }
  feed(decoder.end());
  if (carry) onLine(carry.replace(/\r$/, ""));

  if (!cols) throw new Error("헤더 줄이 없다");
  const csvSha = hash.digest("hex");
  const want = input.sha256.toLowerCase();
  let sha256Of;
  if (csvSha === want) sha256Of = "csv";
  else if (input.zipSha256 && input.zipSha256.toLowerCase() === want) sha256Of = "zip";
  else throw new Error(`SHA-256 불일치: 입력 ${want}, 받은 CSV ${csvSha}${input.zipSha256 ? `, 받은 zip ${input.zipSha256}` : ""}`);
  if (totalRows !== input.rows) throw new Error(`행수 불일치: 입력 ${input.rows}, 읽은 ${totalRows}`);

  const outCells = [];
  let below = 0;
  for (const [key, cell] of [...cells].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (cell.all.length < MIN_HOUSEHOLDS) { below += 1; continue; } // 값을 버리고 칸 수만 센다 (C2)
    const [s, d, j, a] = key.split("|");
    const f = [...cell.floors]
      .filter(([, v]) => v.length >= MIN_HOUSEHOLDS)
      .sort(([x], [y]) => x - y)
      .map(([l, v]) => ({ l, n: v.length, m: median(v) }));
    const c = { s, d, j, a, n: cell.all.length, m: median(cell.all) };
    if (f.length) c.f = f;
    outCells.push(c);
  }
  const outParcels = [...parcelRows]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, n]) => { const [s, d, j] = key.split("|"); return { s, d, j, n }; });

  const out = {
    meta: {
      source: `data.go.kr/data/${input.sourcePage.trim().match(SOURCE_PAGE_RE)[1]}`,
      baseYear: input.baseYear,
      license: input.license.trim(),
      pageModified: input.pageModified.trim(),
      rawCommit: input.rawCommit,
      sourceSha256: want,
      sha256Of,
      totalRows,
      seoulRows,
      targetParcels: input.targets.size,
      targetParcelsFound: parcelRows.size,
      cells: outCells.length,
      cellsBelowMin: below,
      parcels: outParcels.length,
      minHouseholds: MIN_HOUSEHOLDS,
    },
    cells: outCells,
    parcels: outParcels,
  };
  assertDerived(out);
  const size = Buffer.byteLength(JSON.stringify(out));
  if (size > MAX_OUTPUT_BYTES) throw new Error(`접힌 파일 ${size}바이트가 20MB를 넘는다 - 닫지 말고 pm에 올릴 것`);
  return out;
}
