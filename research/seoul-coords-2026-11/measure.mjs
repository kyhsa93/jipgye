// 서울 열린데이터 단지 좌표·역 위치 채움률, 값 형식, 실거래 겹침 측정(#847). 호출량·이용 조건·표시는 같은 폴더 README.md.
//
//   node research/seoul-coords-2026-11/measure.mjs plan     호출 없음. 호출 계획과 실거래 분모를 찍는다
//   node research/seoul-coords-2026-11/measure.mjs guard --attempt N --done N --early-stops N --resume no|yes   호출 없음. 재실행 거부
//   node research/seoul-coords-2026-11/measure.mjs fetch --out <저장소 밖 폴더>   API 호출. 저장소에 쓰지 않고 집계만 남긴다
//
// 서울 API는 평문 HTTP이고 키가 URL 경로에 들어간다. 그래서 kapt-fill의 호출부를 옮기지 않고 새로 썼다.
// - 키는 SEOUL_OPENDATA_API_KEY에서 한 번 읽고 환경에서 지운다. 다른 키로 넘어가지 않고 .env도 읽지 않는다.
// - URL은 callOnce 안에서만 만든다. 로그·예외·요약·아티팩트에 쓰지 않는다. 오류는 분류·코드·HTTP 상태만 남긴다.
// - 리다이렉트를 따라가지 않는다(따라가면 키가 다른 곳으로 간다). 3xx면 멈춘다.
// - 재시도 없음. 한 번에 1,000건 이하. 호출 상한은 서비스별로 지킨다.
// - 쓰기 전에 출력 문자열에서 키를 찾는다. 나오면 아무 값도 쓰지 않고 멈춘다.
// 응답의 단지별 행·좌표·거리·연락처는 메모리에서 세는 데만 쓰고 파일에 쓰지 않는다.
// --base-url·--delay-ms·--deadline-ms·--now는 시험의 스텁 서버에만 쓴다. 주소가 루프백이 아니면 거부한다.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { complexKey, sameNames } from "../../scripts/complex-id.ts";
import { areaGroups, marketDeal, MIN_DEALS, windowStart } from "../../scripts/complex-price.ts";
import { DISTRICTS } from "../../scripts/realestate-districts.ts";

const HERE = import.meta.dirname;
const REPO_ROOT = path.resolve(HERE, "../..");

// 규격은 data.seoul.go.kr 각 데이터셋 Open API 탭(openApiView.do, 2026-11-03 확인)에서 옮겼다. 호출로 확인하지 않았다.
export const API_BASE = "http://openapi.seoul.go.kr:8088";
export const KEY_ENV = "SEOUL_OPENDATA_API_KEY";
export const SERVICE = { apt: "OpenAptInfo", station: "subwayStationMaster" };

// 표시(clo-847 ②, 이용약관 제10조③). 요약이 실리는 곳마다 같은 글을 쓴다.
export const ATTRIBUTION = {
  statement: "서울특별시 공공데이터를 사용한 결과",
  computedBy: "수치는 집계가 계산",
  license: "공공누리 1유형 : 출처표시 (상업적 이용 및 변경 가능)",
  licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
  datasets: [
    { name: "서울시 공동주택 아파트 정보", id: "OA-15818", service: SERVICE.apt, provider: "서울특별시", url: "https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do" },
    { name: "서울시 역사마스터 정보", id: "OA-21232", service: SERVICE.station, provider: "서울특별시", url: "https://data.seoul.go.kr/dataList/OA-21232/S/1/datasetView.do" },
  ],
};

// ── 호출 예산. 일반 키의 일 상한은 공개 문서에 없다. 그래서 기대값(3+1회)에 가깝게 작게 잡는다. ──
export const PAGE_SIZE = 1000; // ERROR-336: 한 번에 최대 1000건
export const MAX_CALLS = { [SERVICE.apt]: 5, [SERVICE.station]: 2 };
export const EXPECTED_ROWS = { [SERVICE.apt]: 2893, [SERVICE.station]: 784 }; // 위키 「단지 탐색」 값. 실제 값은 첫 응답의 list_total_count가 정한다
export const MAX_EARLY_STOPS = 2;

const PACE_MS = 1000;
const TIMEOUT_MS = 30_000;
const DEADLINE_MS = 5 * 60_000;
export const EXIT_STOPPED = 6;
export const EXIT_LEAK = 5;
export const ARTIFACT = { done: "seoul-coords", earlyStop: "seoul-coords-early-stop" };
export const STARTED_MARKER = "fetch-started.json";
export const RESULT_FILES = ["summary.json", "result.out"];

// 넉넉한 서울 사각형. 경계 판정이 아니라 좌표가 엉뚱한지 보는 데만 쓴다.
export const SEOUL_BOX = { lonMin: 126.7, lonMax: 127.3, latMin: 37.4, latMax: 37.75 };
const SHAPE_MAX = 80;
const DISTANCE_EDGES = [100, 250, 500, 750, 1000, 1500, 2000, 3000];
const DISTRICT_EDGES = [2000, 5000, 10000];
const PLACEHOLDERS = new Set(["", "-", "--", "없음", "해당없음", "해당 없음", "null", "NULL", "N/A", "n/a"]);

// 값 자체를 세도 되는 열거형, 모양만 세는 열. 이름·연락처·관리번호·자유 글은 어느 쪽에도 넣지 않는다(채운 수만 센다).
const VALUE_FIELDS = ["CTPV_ADDR", "SGG_ADDR", "CMPX_CLSF", "USE_YN", "SE_CD"];
const SHAPE_FIELDS = ["APT_CD", "APT_STDG_ADDR", "APT_RDN_ADDR", "EMD_ADDR", "DADDR", "RDN_ADDR", "ROAD_DADDR", "TNOHSH", "USE_APRV_YMD", "REG_YMD", "MDFCN_YMD"];
const STATION_VALUE_FIELDS = ["ROUTE"];
const STATION_SHAPE_FIELDS = ["BLDN_ID", "BLDN_NM"];

const DISTRICT_BY_NAME = new Map(DISTRICTS.map((d) => [d.name, d.code]));
const isLoopback = (url) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (v) => String(v ?? "").trim();
const isFilled = (v) => !PLACEHOLDERS.has(text(v));
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(2)}%` : "-");

function count(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** 빈도표. 자르지 않는다. #823은 상위 40만 남겨 밖의 값을 못 읽은 쪽으로 세야 했다. */
export function hist(map) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return { distinct: rows.length, total: rows.reduce((a, r) => a + r[1], 0), rows };
}

// ── 값 읽기 ──

/** 글자를 지운 값의 모양. 글자 묶음→가, 숫자 묶음→9, 구분자·공백은 남긴다. 한글 밖의 글자(영문·한자)도 지운다. */
export function shapeOf(value) {
  return text(value).replace(/\d+/g, "9").replace(/\p{L}+/gu, (m) => (/^[A-Za-z]+$/.test(m) ? "A" : "가")).slice(0, SHAPE_MAX);
}

/** 좌표 값의 자리 모양: 정수 자릿수.소수 자릿수. 소수 3자리면 약 100m 격자라 거리 값의 뜻이 달라진다. */
export function coordShape(value) {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text(value));
  return m ? `${m[1]}${m[2].length}.${(m[3] ?? "").length}` : shapeOf(value);
}

/**
 * 좌표 한 쌍을 값 범위로 가른다. 경위도인지 투영(TM 등)인지까지만 알 수 있다. 경위도의 측지계(WGS84·Bessel, 서울에서 약 300m 차이)는 값으로 못 가른다.
 * x는 경도 자리(XCRD·LOT), y는 위도 자리(YCRD·LAT). 자리가 뒤바뀐 값은 swapped로 세고 거리에는 뒤집어 쓴다.
 */
export function readCoord(x, y) {
  const filledX = isFilled(x);
  const filledY = isFilled(y);
  if (!filledX && !filledY) return { kind: "empty" };
  if (!filledX || !filledY) return { kind: "partial" };
  const nx = Number(text(x));
  const ny = Number(text(y));
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return { kind: "nonNumeric" };
  if (nx === 0 || ny === 0) return { kind: "zero" };
  const isLon = (v) => v >= 124 && v <= 132;
  const isLat = (v) => v >= 33 && v <= 39;
  let kind = "other";
  let lon = null;
  let lat = null;
  if (isLon(nx) && isLat(ny)) [kind, lon, lat] = ["lonlat", nx, ny];
  else if (isLat(nx) && isLon(ny)) [kind, lon, lat] = ["swapped", ny, nx];
  else if (Math.abs(nx) >= 10000 && Math.abs(ny) >= 10000) kind = "projected";
  if (lon === null) return { kind };
  const inSeoul = lon >= SEOUL_BOX.lonMin && lon <= SEOUL_BOX.lonMax && lat >= SEOUL_BOX.latMin && lat <= SEOUL_BOX.latMax;
  return { kind, lon, lat, inSeoul };
}

export function metersBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** 지번 정규화(kapt-fill과 같은 규칙). 본번 앞 0과 부번 0을 없앤다. 숫자 지번이 아니면 null. */
export function normalizeJibun(raw) {
  const m = /^(산)?\s*0*(\d+)(?:-0*(\d*))?-?$/.exec(text(raw));
  if (!m) return null;
  return `${m[1] ?? ""}${m[2]}${m[3] && Number(m[3]) ? `-${m[3]}` : ""}`;
}

/** 법정동주소에서 [법정동, 지번] 목록(kapt-fill과 같은 규칙). 지번이 쉼표로 여럿일 수 있고 뒤쪽은 동을 생략할 수 있다. */
export function parseParcels(address) {
  const out = [];
  let dong = null;
  for (const part of text(address).split(",")) {
    const full = /(?:\S+구)\s+(\S+)\s+(산?\s?\d+(?:-\d*)?)(?=\s|번지|$)/.exec(part);
    const bare = /^\s*(산?\s?\d+(?:-\d*)?)(?=\s|번지|$)/.exec(part);
    if (full) dong = full[1];
    const jibun = normalizeJibun((full ? full[2] : (bare?.[1] ?? "")).replace(/\s/g, ""));
    if (dong && jibun) out.push({ dong, jibun });
  }
  return out;
}

/** 도로명주소에서 {구 코드, 도로명, 본번, 부번}. 구 이름이 없으면 null. 도로명의 띄어쓰기는 지운다(「테헤란로 14길」=「테헤란로14길」). */
export function parseRoad(address) {
  const tokens = text(address).replace(/\([^)]*\)?/g, " ").split(",")[0].trim().split(/\s+/);
  let at = -1;
  tokens.forEach((token, i) => {
    if (DISTRICT_BY_NAME.has(token)) at = i;
  });
  if (at < 0) return null;
  const rest = tokens.slice(at + 1).join(" ");
  const spaced = /^(.+?)\s+(\d+)(?:-(\d+))?(?=\s|$)/.exec(rest);
  const joined = /^(\S+?[로길])(\d+)(?:-(\d+))?(?=\s|$)/.exec(rest);
  const m = spaced ?? joined;
  if (!m) return null;
  return { district: DISTRICT_BY_NAME.get(tokens[at]), road: m[1].replace(/\s/g, ""), bon: Number(m[2]), bu: Number(m[3] ?? 0) };
}

export const roadKey = ({ district, road, bon, bu }) => `${district}|${road}|${bon}|${bu || ""}`;

/** 전월세 원본 한 줄의 도로명 키. 도로명 칸이 비었으면 null. */
export function rentRoadKey(item) {
  const raw = text(item.roadnm);
  if (!raw) return null;
  const road = raw.replace(/\s+\d+(?:-\d+)?\s*$/, "").replace(/\s/g, "");
  const tail = /\s(\d+)(?:-(\d+))?\s*$/.exec(raw);
  const bon = Number(item.roadnmbonbun) || Number(tail?.[1]) || 0;
  const bu = Number(item.roadnmbubun) || Number(tail?.[2]) || 0;
  if (!road || !bon) return null;
  return roadKey({ district: String(item.sggCd), road, bon, bu });
}

/** 이름 경로의 정규화. 공백·괄호 안·「아파트」를 지우고 영문을 소문자로. 같은 구·동 안에서 글자가 똑같을 때만 붙는다. */
export function normalizeName(raw) {
  return text(raw).replace(/\([^)]*\)/g, "").replace(/아파트/g, "").replace(/\s/g, "").toLowerCase();
}

// ── 실거래 원본 ──

const unitKey = (parcel, name) => `${parcel}\u0000${name}`;

/**
 * 실거래를 (구, 동, 지번, 단지명) 단위로 접고, 오늘 기준 183일 창의 n≥3 칸을 만든다.
 * 칸 묶음은 빌더(scripts/build-complex-price.ts)와 같다: marketDeal → 칸 키(#821) → areaGroups.
 * 24개월 합계는 #823과 견주려고 kapt-fill foldDeals와 같은 분모로 센다.
 */
export function foldSale(root, now) {
  const dir = path.join(root, "raw", "sale");
  const since = windowStart(now);
  const units = new Map();
  const totals = { rows: 0, live: 0, market: 0, keys: 0, cells: 0, unparsedJibun: 0 };
  const inWindow = new Map();
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    for (const item of JSON.parse(readFileSync(path.join(dir, name), "utf8")).items ?? []) {
      totals.rows += 1;
      if (text(item.cdealType)) continue;
      totals.live += 1;
      const jibun = normalizeJibun(item.jibun);
      if (!jibun) totals.unparsedJibun += 1;
      const district = String(item.sggCd);
      const dong = text(item.umdNm);
      const parcel = `${district}|${dong}|${jibun ?? `?${text(item.jibun)}`}`;
      const apt = text(item.aptNm);
      const key = unitKey(parcel, apt);
      if (!units.has(key)) units.set(key, { key, parcel, district, dong, name: apt, nameKey: `${district}|${dong}|${normalizeName(apt)}`, live: 0, market: 0, deals: [], cells: 0 });
      const unit = units.get(key);
      unit.live += 1;
      const deal = marketDeal(item);
      if (!deal) continue;
      unit.market += 1;
      totals.market += 1;
      unit.deals.push(deal);
      if (deal.date >= since) {
        if (!inWindow.has(district)) inWindow.set(district, []);
        inWindow.get(district).push({ deal, key });
      }
    }
  }
  for (const unit of units.values()) {
    unit.cells = new Set(areaGroups(unit.deals).values()).size;
    totals.keys += 1;
    totals.cells += unit.cells;
    delete unit.deals;
  }
  return { units, totals, since, inWindow };
}

/** 구별로 둘 이상의 동에 나타나는 단지명(readSameNames와 같은 규칙: 매매+전월세 보관분 전부). 전월세 도로명 다리도 같이 만든다. */
export function foldRent(root) {
  const byUnit = new Map();
  const byParcel = new Map();
  const seen = new Map();
  const same = {};
  const stats = { rows: 0, roadFilled: 0 };
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  for (const kind of ["sale", "rent"]) {
    const dir = path.join(root, "raw", kind);
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const items = JSON.parse(readFileSync(path.join(dir, name), "utf8")).items ?? [];
      const code = name.slice(0, 5);
      if (!seen.has(code)) seen.set(code, new Map());
      same[code] ??= new Set();
      sameNames(items, seen.get(code), same[code]);
      if (kind !== "rent") continue;
      for (const item of items) {
        stats.rows += 1;
        const road = rentRoadKey(item);
        if (!road) continue;
        stats.roadFilled += 1;
        const parcel = `${item.sggCd}|${text(item.umdNm)}|${normalizeJibun(item.jibun) ?? `?${text(item.jibun)}`}`;
        add(byUnit, unitKey(parcel, text(item.aptNm)), road);
        add(byParcel, parcel, road);
      }
    }
  }
  return { byUnit, byParcel, same, stats };
}

/** 그날 n≥3 칸: 구·칸 키·면적 묶음. 칸마다 거래가 나온 실거래 단위 목록을 든다. */
export function windowCells(inWindow, same) {
  const cells = [];
  for (const [district, rows] of inWindow) {
    const byApt = new Map();
    for (const row of rows) {
      const apt = complexKey(row.deal.apt, row.deal.dong, same[district]);
      if (!byApt.has(apt)) byApt.set(apt, []);
      byApt.get(apt).push(row);
    }
    for (const aptRows of byApt.values()) {
      const label = areaGroups(aptRows.map((r) => r.deal));
      const groups = new Map();
      for (const row of aptRows) {
        const name = label.get(row.deal.area);
        if (!groups.has(name)) groups.set(name, { district, n: 0, units: new Set() });
        const group = groups.get(name);
        group.n += 1;
        group.units.add(row.key);
      }
      for (const group of groups.values()) if (group.n >= MIN_DEALS) cells.push(group);
    }
  }
  return cells;
}

/** K-apt 엑셀 2026-09-25분(저장소 안). 서울 코드가 K-apt 지번을 거치는 참고 경로에만 쓴다. 없으면 빈 지도. */
function loadKaptExcel(root) {
  const file = path.join(root, "research/buyer-search-timing-2026-10/cache/kapt-seoul.json");
  const parcels = new Map();
  if (!existsSync(file)) return parcels;
  for (const row of JSON.parse(readFileSync(file, "utf8"))) {
    const code = text(row["단지코드"]);
    const district = DISTRICT_BY_NAME.get(text(row["시군구"]));
    if (!code || !district) continue;
    if (!parcels.has(code)) parcels.set(code, []);
    for (const p of parseParcels(row["법정동주소"])) parcels.get(code).push(`${district}|${p.dong}|${p.jibun}`);
  }
  return parcels;
}

// ── 서울 행 → 경로별 색인 ──

export const PATH_NAMES = ["jibunStd", "jibunDaddr", "jibun", "roadKapt", "roadSeoul", "road", "name", "kaptExcelJibun", "chainJibunRoad", "chainJibunRoadName"];

/** 서울 단지 행으로 경로별 색인을 만든다. 어느 칸에 무엇이 들었는지 몰라 주소 칸 조합마다 따로 세운다. */
export function buildIndex(rows, kaptParcels = new Map()) {
  const apts = new Map();
  const maps = { jibunStd: new Map(), jibunDaddr: new Map(), roadKapt: new Map(), roadSeoul: new Map(), name: new Map(), kaptExcelJibun: new Map() };
  const parsed = { noCode: 0, repeatedCode: 0, district: 0, jibunStd: 0, jibunDaddr: 0, roadKapt: 0, roadSeoul: 0, name: 0, kaptExcelCode: 0 };
  const add = (map, key, code) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(code);
  };
  rows.forEach((row, i) => {
    let code = text(row.APT_CD);
    if (!code) {
      parsed.noCode += 1;
      code = `row:${i}`;
    }
    if (apts.has(code)) parsed.repeatedCode += 1;
    const coord = readCoord(row.XCRD, row.YCRD);
    const known = apts.get(code);
    if (!known || (!known.coord.inSeoul && coord.inSeoul)) apts.set(code, { code, coord, useYes: text(row.USE_YN) === "Y", district: DISTRICT_BY_NAME.get(text(row.SGG_ADDR)) ?? null });
    const district = DISTRICT_BY_NAME.get(text(row.SGG_ADDR)) ?? parseRoad(row.APT_RDN_ADDR)?.district ?? null;
    if (district) parsed.district += 1;

    const standard = district ? parseParcels(row.APT_STDG_ADDR) : [];
    if (standard.length) parsed.jibunStd += 1;
    for (const p of standard) add(maps.jibunStd, `${district}|${p.dong}|${p.jibun}`, code);

    const composed = district ? parseParcels(`${text(row.SGG_ADDR)} ${text(row.EMD_ADDR)} ${text(row.DADDR)}`) : [];
    if (composed.length) parsed.jibunDaddr += 1;
    for (const p of composed) add(maps.jibunDaddr, `${district}|${p.dong}|${p.jibun}`, code);

    const roadKapt = parseRoad(row.APT_RDN_ADDR);
    if (roadKapt) {
      parsed.roadKapt += 1;
      add(maps.roadKapt, roadKey(roadKapt), code);
    }
    const roadSeoul = parseRoad(`${text(row.SGG_ADDR)} ${text(row.RDN_ADDR)} ${text(row.ROAD_DADDR)}`);
    if (roadSeoul) {
      parsed.roadSeoul += 1;
      add(maps.roadSeoul, roadKey(roadSeoul), code);
    }
    const name = normalizeName(row.APT_NM);
    if (district && name && isFilled(row.EMD_ADDR)) {
      parsed.name += 1;
      add(maps.name, `${district}|${text(row.EMD_ADDR)}|${name}`, code);
    }
    const excel = kaptParcels.get(code);
    if (excel) {
      parsed.kaptExcelCode += 1;
      for (const parcel of excel) add(maps.kaptExcelJibun, parcel, code);
    }
  });
  return { apts, maps, parsed };
}

/** 실거래 단위 하나가 경로마다 어느 서울 코드에 닿는가. 사슬은 앞 단계가 비었을 때만 다음으로 간다. */
export function resolver(index, rent) {
  const union = (...sets) => new Set(sets.flatMap((s) => (s ? [...s] : [])));
  const roadsOf = (unit) => rent.byUnit.get(unit.key) ?? rent.byParcel.get(unit.parcel) ?? new Set();
  const viaRoad = (map, unit) => union(...[...roadsOf(unit)].map((k) => map.get(k)));
  const { maps } = index;
  const base = {
    jibunStd: (u) => union(maps.jibunStd.get(u.parcel)),
    jibunDaddr: (u) => union(maps.jibunDaddr.get(u.parcel)),
    roadKapt: (u) => viaRoad(maps.roadKapt, u),
    roadSeoul: (u) => viaRoad(maps.roadSeoul, u),
    name: (u) => union(maps.name.get(u.nameKey)),
    kaptExcelJibun: (u) => union(maps.kaptExcelJibun.get(u.parcel)),
  };
  base.jibun = (u) => union(base.jibunStd(u), base.jibunDaddr(u));
  base.road = (u) => union(base.roadKapt(u), base.roadSeoul(u));
  base.chainJibunRoad = (u) => {
    const first = base.jibun(u);
    return first.size ? first : base.road(u);
  };
  base.chainJibunRoadName = (u) => {
    const first = base.chainJibunRoad(u);
    return first.size ? first : base.name(u);
  };
  return base;
}

/** 여러 코드가 걸린 곳의 좌표 폭. 같은 지번의 코드들이 사실상 같은 자리면 역 거리는 어느 코드로 재도 같다. #823은 여러 코드 지번이 겹침을 6%p 깎았다. */
export function spreadBucket(codes, apts) {
  const coords = [...codes].map((c) => apts.get(c)?.coord);
  if (coords.some((c) => !c?.inSeoul)) return "missingCoord";
  let widest = 0;
  for (let i = 0; i < coords.length; i += 1) for (let j = i + 1; j < coords.length; j += 1) widest = Math.max(widest, metersBetween(coords[i], coords[j]));
  return widest <= 100 ? "within100m" : widest <= 300 ? "within300m" : "wider";
}

function emptyCounts() {
  return { keys: 0, cells: 0, live: 0, market: 0 };
}

function addCounts(slot, unit) {
  slot.keys += 1;
  slot.cells += unit.cells;
  slot.live += unit.live;
  slot.market += unit.market;
}

/** 경로마다 거래 겹침(24개월, #823과 같은 분모)과 그날 n≥3 칸 겹침(PREREG 실3의 분모)을 센다. */
export function measureOverlap(sale, cells, index, rent) {
  const resolve = resolver(index, rent);
  const { apts } = index;
  const units = [...sale.units.values()];
  const deals = {};
  const onCells = {};
  for (const name of PATH_NAMES) {
    const out = { attached: emptyCounts(), unique: emptyCounts(), uniqueWithCoord: emptyCounts(), ambiguous: emptyCounts(), ambiguousSpread: { within100m: emptyCounts(), within300m: emptyCounts(), wider: emptyCounts(), missingCoord: emptyCounts() } };
    const codesOf = new Map();
    for (const unit of units) {
      const codes = resolve[name](unit);
      codesOf.set(unit.key, codes);
      if (!codes.size) continue;
      addCounts(out.attached, unit);
      if (codes.size > 1) {
        addCounts(out.ambiguous, unit);
        addCounts(out.ambiguousSpread[spreadBucket(codes, apts)], unit);
        continue;
      }
      addCounts(out.unique, unit);
      if (apts.get([...codes][0])?.coord.inSeoul) addCounts(out.uniqueWithCoord, unit);
    }
    deals[name] = out;

    const cellSlot = { attached: 0, unique: 0, uniqueWithCoord: 0, uniqueWithCoordUseYes: 0, ambiguous: 0, ambiguousSpread: { within100m: 0, within300m: 0, wider: 0, missingCoord: 0 }, byDistrict: {} };
    for (const cell of cells) {
      const codes = new Set();
      for (const key of cell.units) for (const code of codesOf.get(key) ?? []) codes.add(code);
      const row = (cellSlot.byDistrict[cell.district] ??= { cells: 0, uniqueWithCoord: 0 });
      row.cells += 1;
      if (!codes.size) continue;
      cellSlot.attached += 1;
      if (codes.size > 1) {
        cellSlot.ambiguous += 1;
        cellSlot.ambiguousSpread[spreadBucket(codes, apts)] += 1;
        continue;
      }
      cellSlot.unique += 1;
      const apt = apts.get([...codes][0]);
      if (!apt?.coord.inSeoul) continue;
      cellSlot.uniqueWithCoord += 1;
      row.uniqueWithCoord += 1;
      if (apt.useYes) cellSlot.uniqueWithCoordUseYes += 1;
    }
    onCells[name] = cellSlot;
  }
  return { deals, cells: onCells };
}

// ── 집계 ──

/** 분위수. 최솟값·최댓값은 단지 하나의 값이라 남기지 않고, 끝은 구간표로 본다. */
export function quantiles(numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const at = (q) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  return { n: sorted.length, p01: at(0.01), p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9), p99: at(0.99) };
}

function buckets(numbers, edges) {
  const out = Object.fromEntries([...edges.map((e) => `<=${e}`), `>${edges.at(-1)}`].map((k) => [k, 0]));
  for (const n of numbers) {
    const edge = edges.find((e) => n <= e);
    out[edge === undefined ? `>${edges.at(-1)}` : `<=${edge}`] += 1;
  }
  return out;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** 필드별 채운 수와, 허용한 필드의 값표·모양표. 응답 키는 이름 꼴일 때만 적는다. */
function fieldTables(rows, valueFields, shapeFields) {
  const filled = new Map();
  const values = Object.fromEntries(valueFields.map((f) => [f, new Map()]));
  const shapes = Object.fromEntries(shapeFields.map((f) => [f, new Map()]));
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      const name = /^[A-Za-z0-9_.]{1,40}$/.test(field) ? field : "(이름 꼴이 아님)";
      if (!filled.has(name)) filled.set(name, 0);
      if (isFilled(value)) count(filled, name);
    }
    for (const f of valueFields) if (isFilled(row[f])) count(values[f], text(row[f]).slice(0, 40));
    for (const f of shapeFields) if (isFilled(row[f])) count(shapes[f], shapeOf(row[f]));
  }
  return {
    filled: hist(filled).rows,
    values: Object.fromEntries(valueFields.map((f) => [f, hist(values[f])])),
    shapes: Object.fromEntries(shapeFields.map((f) => [f, hist(shapes[f])])),
  };
}

function coordTables(rows, xField, yField) {
  const kinds = new Map();
  const shapeX = new Map();
  const shapeY = new Map();
  let inSeoul = 0;
  for (const row of rows) {
    const coord = readCoord(row[xField], row[yField]);
    count(kinds, coord.kind);
    if (coord.inSeoul) inSeoul += 1;
    if (isFilled(row[xField])) count(shapeX, coordShape(row[xField]));
    if (isFilled(row[yField])) count(shapeY, coordShape(row[yField]));
  }
  return { kinds: hist(kinds), inSeoulBox: inSeoul, box: SEOUL_BOX, [`${xField}Shapes`]: hist(shapeX), [`${yField}Shapes`]: hist(shapeY) };
}

/** 서울 사각형 안에 좌표가 있는 역의 호선표. 호선 범위(1~8호선만인지 등)가 여기서 드러난다. */
function routesInBox(stationRows) {
  const routes = new Map();
  for (const row of stationRows) if (readCoord(row.LOT, row.LAT).inSeoul) count(routes, isFilled(row.ROUTE) ? text(row.ROUTE).slice(0, 40) : "(비어 있음)");
  return routes;
}

/** 같은 좌표에 몰린 단지. 동 중심 좌표로 찍은 값이면 여기서 드러난다. 좌표 자체는 남기지 않는다. */
function coordDuplicates(apts) {
  const exact = new Map();
  const near = new Map();
  for (const { coord } of apts) {
    if (!coord.inSeoul) continue;
    count(exact, `${coord.lon}|${coord.lat}`);
    count(near, `${coord.lon.toFixed(4)}|${coord.lat.toFixed(4)}`);
  }
  const groups = [...exact.values()].filter((n) => n > 1);
  return { located: [...exact.values()].reduce((a, n) => a + n, 0), distinctExact: exact.size, distinctAt4Decimals: near.size, sharedGroups: groups.length, sharedComplexes: groups.reduce((a, n) => a + n, 0), largestGroup: Math.max(0, ...exact.values()) };
}

/** 좌표가 자기 구 안쪽에 있어 보이는가. 경계 파일이 없어 구 중앙값으로 어림한다. 중앙값 자체는 남기지 않는다. */
function districtConsistency(apts) {
  const byDistrict = new Map();
  for (const apt of apts) {
    if (!apt.coord.inSeoul || !apt.district) continue;
    if (!byDistrict.has(apt.district)) byDistrict.set(apt.district, []);
    byDistrict.get(apt.district).push(apt.coord);
  }
  const centers = [...byDistrict].map(([district, coords]) => ({ district, lon: median(coords.map((c) => c.lon)), lat: median(coords.map((c) => c.lat)) }));
  const distances = [];
  let ownNearest = 0;
  for (const [district, coords] of byDistrict) {
    const own = centers.find((c) => c.district === district);
    for (const coord of coords) {
      distances.push(metersBetween(coord, own));
      const nearest = centers.reduce((a, c) => (metersBetween(coord, c) < metersBetween(coord, a) ? c : a));
      if (nearest.district === district) ownNearest += 1;
    }
  }
  return { compared: distances.length, ownCenterIsNearest: ownNearest, fromOwnCenterMeters: buckets(distances, DISTRICT_EDGES) };
}

/** 가장 가까운 역까지 직선거리(m). 분위수와 구간표만 남긴다. 「도보 n분」이 아니다. */
function stationDistances(apts, stations) {
  const usable = stations.filter((c) => c.lon !== undefined);
  const distances = new Map();
  if (!usable.length) return { usableStations: 0, distances };
  for (const apt of apts) {
    if (!apt.coord.inSeoul) continue;
    distances.set(apt.code, Math.min(...usable.map((s) => metersBetween(apt.coord, s))));
  }
  return { usableStations: usable.length, distances };
}

/** 응답 전체를 집계로 접는다. 돌려주는 값에 단지별 행·좌표·개별 거리가 들어가지 않는다. */
export function summarize({ aptRows, stationRows, aptTotal, stationTotal, sale, rent, cells, kaptParcels }) {
  const index = buildIndex(aptRows, kaptParcels);
  const apts = [...index.apts.values()];
  const stationCoords = stationRows.map((row) => readCoord(row.LOT, row.LAT));
  const nearest = stationDistances(apts, stationCoords);
  const overlap = measureOverlap(sale, cells, index, rent);
  const resolve = resolver(index, rent);

  // n≥3 칸마다 경로 하나(지번→도로명)로 코드 하나에 풀린 칸의 역 거리.
  const cellDistances = [];
  for (const cell of cells) {
    const codes = new Set();
    for (const key of cell.units) for (const code of resolve.chainJibunRoad(sale.units.get(key))) codes.add(code);
    if (codes.size !== 1) continue;
    const distance = nearest.distances.get([...codes][0]);
    if (distance !== undefined) cellDistances.push(distance);
  }
  const distances = [...nearest.distances.values()];
  const kaptExcelCodes = kaptParcels.size;

  return {
    frame: {
      aptTotal, aptRows: aptRows.length, stationTotal, stationRows: stationRows.length,
      distinctCodes: apts.length, windowSince: sale.since,
    },
    apt: {
      fields: fieldTables(aptRows, VALUE_FIELDS, SHAPE_FIELDS),
      coords: coordTables(aptRows, "XCRD", "YCRD"),
      duplicates: coordDuplicates(apts),
      districtConsistency: districtConsistency(apts),
      parsed: index.parsed,
      kaptExcelOverlap: { excelCodes: kaptExcelCodes, seoulCodesInExcel: index.parsed.kaptExcelCode, note: "K-apt 엑셀 2026-09-25분" },
    },
    stations: {
      fields: fieldTables(stationRows, STATION_VALUE_FIELDS, STATION_SHAPE_FIELDS),
      coords: coordTables(stationRows, "LOT", "LAT"),
      distinctNames: new Set(stationRows.filter((row) => isFilled(row.BLDN_NM)).map((row) => text(row.BLDN_NM))).size,
      routesInSeoulBox: hist(routesInBox(stationRows)),
    },
    straightLineToNearestStation: {
      meaning: "단지 좌표와 역사 좌표 사이 직선거리(m). 출입구가 아니라 역사 좌표이고 도보 시간이 아니다",
      usableStations: nearest.usableStations,
      complexes: { quantiles: quantiles(distances), buckets: buckets(distances, DISTANCE_EDGES) },
      cellsByChainJibunRoad: { quantiles: quantiles(cellDistances), buckets: buckets(cellDistances, DISTANCE_EDGES) },
    },
    overlap: {
      denominators: { ...sale.totals, cellsNge3: cells.length },
      rentBridge: rent.stats,
      paths: overlap.deals,
      cellsNge3: overlap.cells,
    },
  };
}

// ── 호출 ──

export class StopRun extends Error {
  constructor(kind, info = {}) {
    super(kind);
    this.kind = kind;
    this.info = info;
  }
}

/** 응답을 판정한다. 메시지 원문은 돌려주지 않는다(서버가 주소를 되비칠 수 있다). 코드는 꼴을 확인한 것만 남긴다. */
export function classify(httpStatus, body, service) {
  let parsed = null;
  let format = "other";
  try {
    parsed = JSON.parse(body);
    format = "json";
  } catch {
    if (/^\s*</.test(body)) format = "xml";
  }
  const block = parsed?.[service] ?? parsed;
  const rawCode = block?.RESULT?.CODE ?? block?.["RESULT.CODE"] ?? block?.CODE ?? /\b(?:INFO|ERROR)-\d{3}\b/.exec(body)?.[0] ?? null;
  const code = /^(?:INFO|ERROR)-\d{3}$/.test(String(rawCode)) ? String(rawCode) : null;
  const base = { httpStatus, format, code };
  if (httpStatus === 401 || httpStatus === 403) return { ...base, kind: "auth" };
  if (httpStatus === 429) return { ...base, kind: "quota" };
  if (code === "INFO-100") return { ...base, kind: "auth" };
  if (code === "INFO-200") return { ...base, kind: "nodata" };
  if (code && /^ERROR-3\d\d$/.test(code)) return { ...base, kind: "spec" };
  if (code && /^ERROR-[56]\d\d$/.test(code)) return { ...base, kind: "server" };
  if (httpStatus !== 200) return { ...base, kind: "http" };
  if (code !== "INFO-000" || !Array.isArray(block?.row)) return { ...base, kind: "other" };
  return { ...base, kind: "ok", rows: block.row, total: Number(block.list_total_count) };
}

/** 예외에서 남겨도 되는 이름. 메시지는 쓰지 않는다(주소가 섞일 수 있다). */
export const safeErrorName = (err) => {
  const name = String(err?.cause?.code ?? err?.name ?? "Error");
  return /^[A-Za-z_]{1,40}$/.test(name) ? name : "Error";
};

/** 호출부. 주소는 callOnce 지역 변수로만 있고 어디에도 넘기지 않는다. 재시도 없음. 리다이렉트를 따라가지 않는다. */
function makeClient({ base, key, delayMs, deadlineAt }) {
  const calls = { [SERVICE.apt]: 0, [SERVICE.station]: 0 };
  const outcomes = new Map();
  const limitHeaders = new Map();
  let lastStart = 0;

  async function callOnce(service, start, end) {
    if (end - start + 1 > PAGE_SIZE) throw new StopRun("over-page-size", { service });
    if (calls[service] >= MAX_CALLS[service]) throw new StopRun("budget", { service });
    if (Date.now() >= deadlineAt) throw new StopRun("deadline", { service });
    const wait = lastStart + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    calls[service] += 1;
    let verdict;
    try {
      const url = `${base}/${encodeURIComponent(key)}/json/${service}/${start}/${end}/`;
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
      for (const [name, value] of res.headers) {
        if (/rate|limit|quota/i.test(name) && /^[\d.,\s]{1,40}$/.test(value)) limitHeaders.set(name.slice(0, 40), value.trim());
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        verdict = { kind: "redirect", httpStatus: res.status, code: null, format: "none" };
      } else {
        verdict = classify(res.status, await res.text(), service);
      }
    } catch (err) {
      verdict = { kind: "network", httpStatus: null, code: null, format: "none", network: safeErrorName(err) };
    }
    count(outcomes, `${service}:${verdict.kind}:${verdict.code ?? verdict.httpStatus ?? verdict.network}`);
    if (verdict.kind !== "ok") throw new StopRun(verdict.kind, { service, code: verdict.code, httpStatus: verdict.httpStatus, network: verdict.network ?? null, format: verdict.format });
    return verdict;
  }

  return { callOnce, calls, outcomes, limitHeaders };
}

/** 한 서비스 전부. 첫 응답의 건수로 쪽수를 정하고, 상한을 넘으면 더 부르지 않고 멈춘다(잘라서 하한을 내지 않는다). */
export async function fetchAll(client, service) {
  const first = await client.callOnce(service, 1, PAGE_SIZE);
  const total = first.total;
  if (!Number.isInteger(total) || total <= 0) throw new StopRun("no-total", { service });
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages > MAX_CALLS[service]) throw new StopRun("over-budget", { service, total, pages });
  const rows = [...first.rows];
  for (let page = 2; page <= pages; page += 1) {
    const res = await client.callOnce(service, (page - 1) * PAGE_SIZE + 1, Math.min(page * PAGE_SIZE, total));
    if (res.total !== total) throw new StopRun("total-changed", { service, total, now: Number.isInteger(res.total) ? res.total : null });
    rows.push(...res.rows);
  }
  if (rows.length !== total) throw new StopRun("incomplete", { service, total, got: rows.length });
  return { rows, total };
}

/** 재실행 거부. 하나라도 어긋나면 이유를 돌려준다. 값을 읽지 못한 경우(숫자가 아님)도 거부다. */
export function guardReason({ attempt, done, earlyStops, resume, resultExists }) {
  const nat = (v) => /^\d+$/.test(String(v ?? ""));
  if (!nat(attempt) || !nat(done) || !nat(earlyStops)) return `확인값을 읽지 못했다(attempt=${attempt}, done=${done}, early=${earlyStops})`;
  if (Number(attempt) !== 1) return `재실행이다(시도 ${attempt}). 호출 예산 밖이라 거부한다`;
  if (resultExists) return "결과 파일이 이미 저장소에 있다. 측정이 끝나 거부한다";
  if (Number(done) !== 0) return `아티팩트 ${ARTIFACT.done} 수가 0이 아니다(${done}). 이미 호출한 실행이 있어 거부한다`;
  if (Number(earlyStops) >= MAX_EARLY_STOPS) return `조기 중단이 ${earlyStops}회다. 상한 ${MAX_EARLY_STOPS}회라 거부한다`;
  if (Number(earlyStops) > 0 && resume !== "yes") return `조기 중단 ${earlyStops}회가 있다. 원인을 고치고 clo 댓글을 새로 받은 뒤 resume_after_early_stop=yes로만 돌린다`;
  return null;
}

/** 출력에 키가 있는가. 원문·URL 인코딩, 영숫자만 남긴 꼴의 12자 조각까지 찾는다. */
export function leaksKey(output, key) {
  if (output.includes(key) || output.includes(encodeURIComponent(key))) return true;
  const alnum = (s) => s.replace(/[^A-Za-z0-9]/g, "");
  const decoded = alnum(output.replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
  const plain = alnum(key);
  const width = Math.min(12, plain.length);
  if (!width) return false;
  for (let i = 0; i + width <= plain.length; i += 1) if (decoded.includes(plain.slice(i, i + width))) return true;
  return false;
}

const kstDate = (date) => new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

function attributionLines(retrievedAt) {
  const sources = ATTRIBUTION.datasets.map((d) => `${d.name}(${d.id}, ${d.url})`).join(", ");
  return [
    `${ATTRIBUTION.statement}. ${ATTRIBUTION.computedBy}.`,
    `출처: ${sources}. ${ATTRIBUTION.license}(${ATTRIBUTION.licenseUrl}). 조회일 ${retrievedAt}.`,
  ];
}

function resultLines(summary) {
  const lines = attributionLines(summary.attribution.retrievedAt);
  lines.push(`호출 ${summary.calls[SERVICE.apt]}+${summary.calls[SERVICE.station]} (${SERVICE.apt} 상한 ${MAX_CALLS[SERVICE.apt]}, ${SERVICE.station} 상한 ${MAX_CALLS[SERVICE.station]}, 재시도 없음)`);
  if (summary.stop) lines.push(`멈춤: ${summary.stop.kind} ${JSON.stringify(summary.stop.info)}`);
  const r = summary.result;
  if (!r) return lines;
  const { apt, stations, overlap, straightLineToNearestStation: s, frame } = r;
  const kinds = (t) => t.kinds.rows.map(([k, n]) => `${k} ${n}`).join(", ");
  lines.push(`단지 ${frame.aptRows}/${frame.aptTotal}행, 고유 코드 ${frame.distinctCodes}. 역 ${frame.stationRows}/${frame.stationTotal}행`);
  lines.push(`단지 좌표: ${kinds(apt.coords)}, 서울 사각형 안 ${apt.coords.inSeoulBox}. 고유 ${apt.duplicates.distinctExact}, 공유 묶음 ${apt.duplicates.sharedGroups}(${apt.duplicates.sharedComplexes}단지, 최대 ${apt.duplicates.largestGroup})`);
  lines.push(`역 좌표: ${kinds(stations.coords)}, 서울 사각형 안 ${stations.coords.inSeoulBox}`);
  lines.push(`주소 해석(행): 지번(표준) ${apt.parsed.jibunStd}, 지번(동+나머지) ${apt.parsed.jibunDaddr}, 도로명(kapt) ${apt.parsed.roadKapt}, 도로명(서울) ${apt.parsed.roadSeoul}, 이름 ${apt.parsed.name}, K-apt 엑셀 코드 ${apt.parsed.kaptExcelCode}`);
  const t = overlap.denominators;
  lines.push(`분모: 거래 ${t.live}, 단지 키 ${t.keys}, 칸 ${t.cells}, 그날 n≥3 칸 ${t.cellsNge3} (창 ${frame.windowSince}~)`);
  for (const name of PATH_NAMES) {
    const d = overlap.paths[name];
    const c = overlap.cellsNge3[name];
    lines.push(`${name}: 거래 하나로 풀림 ${d.unique.live}/${t.live} (${pct(d.unique.live, t.live)}), 좌표까지 ${d.uniqueWithCoord.live} (${pct(d.uniqueWithCoord.live, t.live)}), 여러 코드 ${d.ambiguous.live} / n≥3 칸 좌표까지 ${c.uniqueWithCoord}/${t.cellsNge3} (${pct(c.uniqueWithCoord, t.cellsNge3)}), 여러 코드 ${c.ambiguous}(100m 안 ${c.ambiguousSpread.within100m})`);
  }
  const q = s.complexes.quantiles;
  if (q) lines.push(`가장 가까운 역까지 직선(단지 ${q.n}): p10 ${q.p10}m, p50 ${q.p50}m, p90 ${q.p90}m, p99 ${q.p99}m. 역 ${s.usableStations}곳. 도보 시간이 아니다`);
  return lines;
}

function fail(code, message) {
  console.error(message);
  return code;
}

async function cmdFetch(opts) {
  const raw = process.env[KEY_ENV];
  delete process.env[KEY_ENV];
  const key = text(raw);
  if (!key) return fail(2, `${KEY_ENV}가 없어 호출하지 않는다`);
  if (key.toLowerCase() === "sample") return fail(2, "sample 키로는 측정하지 않는다(5건 제한)");
  if (!opts.out) return fail(2, "--out이 없다");
  const outDir = path.resolve(opts.out);
  for (const root of [REPO_ROOT, opts.root]) {
    if (!path.relative(root, outDir).startsWith("..")) return fail(2, "--out은 저장소 밖이어야 한다(쓰기 0)");
  }
  const testOnly = opts.delayMs !== undefined || opts.deadlineMs !== undefined || opts.now !== undefined;
  if ((opts.baseUrl || testOnly) && !isLoopback(opts.baseUrl ?? "")) return fail(2, "--base-url·시험용 인자는 루프백 주소에만 쓴다");

  const now = opts.now ? new Date(opts.now) : new Date();
  const sale = foldSale(opts.root, now);
  const rent = foldRent(opts.root);
  const cells = windowCells(sale.inWindow, rent.same);
  const kaptParcels = loadKaptExcel(opts.root);
  const client = makeClient({
    base: opts.baseUrl ?? API_BASE,
    key,
    delayMs: opts.delayMs ?? PACE_MS,
    deadlineAt: Date.now() + (opts.deadlineMs ?? DEADLINE_MS),
  });
  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  // 호출을 시작한 실행은 어떻게 끝나도 이 표시가 아티팩트로 남아 다음 dispatch를 막는다.
  const started = `${JSON.stringify({ startedAt, commit: process.env.GITHUB_SHA ?? null })}\n`;
  writeFileSync(path.join(outDir, STARTED_MARKER), started);

  let stop = null;
  let result = null;
  try {
    const apt = await fetchAll(client, SERVICE.apt);
    const station = await fetchAll(client, SERVICE.station);
    try {
      result = summarize({ aptRows: apt.rows, stationRows: station.rows, aptTotal: apt.total, stationTotal: station.total, sale, rent, cells, kaptParcels });
    } catch (err) {
      stop = { kind: "summarize-failed", info: { name: safeErrorName(err) } };
    }
  } catch (err) {
    if (!(err instanceof StopRun)) throw err;
    stop = { kind: err.kind, info: err.info };
  }

  const summary = {
    issue: 847,
    attribution: { ...ATTRIBUTION, retrievedAt: kstDate(new Date(startedAt)) },
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? null,
    calls: client.calls,
    maxCalls: MAX_CALLS,
    retries: 0,
    stop,
    outcomes: hist(client.outcomes),
    // 공개 문서로 못 정한 것을 이 실행에서 드러난 만큼 적는다.
    unverified: {
      generalKeyDailyLimit: "공개 문서에 값 없음(실시간 지하철 1,000건만 적혀 있다). 이번 호출 수에서 받은 코드는 outcomes, 한도 꼴 헤더는 limitHeaders. 상한 값 자체는 이 측정으로 알 수 없다",
      limitHeaders: Object.fromEntries(client.limitHeaders),
      coordinateSystem: "값 범위로 경위도·투영까지만 가른다(apt.coords.kinds, stations.coords.kinds). 경위도의 측지계(WGS84·Bessel)는 값으로 못 가른다",
    },
    result,
  };
  const lines = resultLines(summary);
  const artifact = result ? ARTIFACT.done : ARTIFACT.earlyStop;
  const outputs = {
    "summary.json": `${JSON.stringify(summary, null, 1)}\n`,
    "result.out": `${lines.join("\n")}\n`,
    "artifact-name": `${artifact}\n`,
  };

  // 쓰기 전에 검사한다. 노출이면 값을 하나도 쓰지 않고 멈추고, 다음 dispatch도 막는다.
  if (Object.values(outputs).some((content) => leaksKey(content, key))) {
    writeFileSync(path.join(outDir, "artifact-name"), `${ARTIFACT.done}\n`);
    writeFileSync(path.join(outDir, "key-exposure-stop.json"), `${JSON.stringify({ stoppedAt: new Date().toISOString(), action: "소유자에게 키 재발급 요청" })}\n`);
    return fail(EXIT_LEAK, "출력에서 키가 발견되어 아무 값도 쓰지 않고 멈췄다. 소유자에게 키 재발급을 요청한다");
  }
  for (const [name, content] of Object.entries(outputs)) writeFileSync(path.join(outDir, name), content);
  for (const line of lines) console.log(line);
  if (stop?.kind === "auth") console.log("인증 오류로 멈췄다. 다시 시도하지 않는다. 소유자에게 키 등록을 요청한다");
  return result ? 0 : EXIT_STOPPED;
}

function cmdPlan(opts) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const sale = foldSale(opts.root, now);
  const rent = foldRent(opts.root);
  const cells = windowCells(sale.inWindow, rent.same);
  for (const service of Object.values(SERVICE)) {
    console.log(`${service}: 위키 ${EXPECTED_ROWS[service]}행이면 ${Math.ceil(EXPECTED_ROWS[service] / PAGE_SIZE)}회, 상한 ${MAX_CALLS[service]}회(${MAX_CALLS[service] * PAGE_SIZE}행까지). 재시도 없음`);
  }
  console.log(`한 번 실행 상한 ${Object.values(MAX_CALLS).reduce((a, b) => a + b, 0)}회, 조기 중단 ${MAX_EARLY_STOPS}회까지 합쳐 최대 ${(MAX_EARLY_STOPS + 1) * Object.values(MAX_CALLS).reduce((a, b) => a + b, 0)}회`);
  console.log(`실거래 분모(raw/sale): ${JSON.stringify(sale.totals)}`);
  console.log(`전월세 도로명 다리(raw/rent): ${JSON.stringify(rent.stats)}`);
  console.log(`그날 n≥3 칸: ${cells.length} (창 ${sale.since}~, 기준 ${now.toISOString().slice(0, 10)})`);
  return 0;
}

function cmdGuard(opts) {
  const resultExists = RESULT_FILES.some((f) => existsSync(path.join(HERE, f)));
  const reason = guardReason({ attempt: opts.attempt, done: opts.done, earlyStops: opts.earlyStops, resume: opts.resume, resultExists });
  if (reason) return fail(1, reason);
  console.log("재실행 거부 통과");
  return 0;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" }, root: { type: "string" }, now: { type: "string" },
      attempt: { type: "string" }, done: { type: "string" }, "early-stops": { type: "string" }, resume: { type: "string" },
      "base-url": { type: "string" }, "delay-ms": { type: "string" }, "deadline-ms": { type: "string" },
    },
  });
  const num = (v) => (v === undefined ? undefined : Number(v));
  const opts = {
    out: values.out, root: path.resolve(values.root ?? REPO_ROOT), now: values.now,
    attempt: values.attempt, done: values.done, earlyStops: values["early-stops"], resume: values.resume,
    baseUrl: values["base-url"], delayMs: num(values["delay-ms"]), deadlineMs: num(values["deadline-ms"]),
  };
  const [cmd] = positionals;
  if (cmd === "plan") return cmdPlan(opts);
  if (cmd === "guard") return cmdGuard(opts);
  if (cmd === "fetch") return cmdFetch(opts);
  return fail(2, "plan | guard | fetch");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => {
      // 원문에 주소가 섞일 수 있어 종류만 찍는다.
      console.error(`예상 못 한 오류: ${safeErrorName(err)}`);
      process.exitCode = 1;
    },
  );
}
