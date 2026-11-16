// #900 측정 공용: 네트워크 차단·키 환경변수 확인, 슬롯 적용/무시 셈, 잎 단위 비교, 다중집합 비교.
// 측정 스크립트(ga-900.mjs·na-900.mjs)가 맨 먼저 import 한다. 빌더 파일은 고치지 않는다(cto 조건 5) - <wt>/scripts 를 그대로 import 한다.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import path from "node:path";
import { readFile } from "node:fs/promises";

// ---- 네트워크 0 (cto 조건 1) -------------------------------------------------------------------------------------
// 나가는 연결을 만드는 입구를 모두 막고 시도 수를 센다. 끝에 「네트워크 호출 0」을 찍고, 0 이 아니면 종료 2(측정 무효).
export const network = { calls: 0, where: [] };
const block = (name) => (...args) => {
  network.calls += 1;
  network.where.push(name);
  throw new Error(`#900 측정 중 네트워크 호출 차단: ${name}`);
};
globalThis.fetch = block("fetch");
for (const [mod, name] of [[http, "http"], [https, "https"]]) {
  mod.request = block(`${name}.request`);
  mod.get = block(`${name}.get`);
}
net.connect = block("net.connect");
net.createConnection = block("net.createConnection");
tls.connect = block("tls.connect");
dns.lookup = block("dns.lookup");

// scripts/ 가 읽는 키 이름 전부(`grep -rhoE 'process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)[A-Z_]*' scripts`, 05a4469e).
export const KEY_VARS = ["MOLIT_API_KEY", "MOLIT_RENT_API_KEY", "BUILDINGHUB_API_KEY", "GITHUB_TOKEN"];

/** 키 환경변수가 하나라도 있으면 멈춘다(cto 조건 1 「키 환경변수 없이」). 이름 끝이 _KEY·_TOKEN·_SECRET 인 변수도 본다. */
export function assertNoKeys() {
  const set = Object.keys(process.env).filter((k) => KEY_VARS.includes(k) || /(_KEY|_TOKEN|_SECRET)$/.test(k));
  if (set.length) {
    console.error(`멈춤: 키 환경변수가 있다 - ${set.join(", ")} (env -i 로 돌린다)`);
    process.exit(3);
  }
  console.log(`키 환경변수 0개 (본 이름: ${KEY_VARS.join(", ")}, 그리고 *_KEY·*_TOKEN·*_SECRET)`);
}

export function finish() {
  console.log(`네트워크 호출 ${network.calls}${network.calls ? ` (${network.where.join(", ")})` : ""}`);
  if (network.calls) process.exit(2);
}

// ---- 작업 트리 ---------------------------------------------------------------------------------------------------
export function wtPaths(wtArg) {
  const wt = path.resolve(wtArg);
  return { wt, RAW: path.join(wt, "raw"), DATA: path.join(wt, "docs/data"), S: (f) => import(path.join(wt, "scripts", f)) };
}

export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

// ---- 슬롯 적용/무시 (cto 조건 1-b) -------------------------------------------------------------------------------
/**
 * 창 안 (구, 달) 슬롯마다 덧씌움 상태. 「적용」 = mergeRecollect 가 합친 값(새 객체)을 돌려줌, 「무시」 = 덧씌움 파일은 있는데 저장 슬롯을
 * 그대로 돌려줌(base 의 observedAt·count 가 다름, 또는 없앨 행이 슬롯에 없음), 「없음」 = 덧씌움 파일 없음.
 * 무시 슬롯은 저장 값을 쓰므로 그 슬롯의 어긋남은 계산상 0 이다(공개 화면도 같은 이유로 저장 값).
 */
export async function slotTable({ S, RAW }, months, label) {
  const { DISTRICTS } = await S("realestate-districts.ts");
  const { readSlotFile } = await S("realestate-raw.ts");
  const { readOverlay, mergeRecollect } = await S("realestate-recollect.ts");
  const out = { label, months: [months[0], months.at(-1), months.length], slots: 0, overlay: 0, applied: 0, ignored: [], missingSlot: 0 };
  for (const ym of months) {
    for (const { code, name } of DISTRICTS) {
      const slot = await readSlotFile("sale", code, ym, RAW);
      if (!slot) {
        out.missingSlot += 1;
        continue;
      }
      out.slots += 1;
      const overlay = await readOverlay(code, ym, RAW);
      if (!overlay) continue;
      out.overlay += 1;
      if (mergeRecollect(slot, overlay) !== slot) {
        out.applied += 1;
        continue;
      }
      const baseMismatch = overlay.base?.observedAt !== slot.observedAt || overlay.base?.count !== slot.count;
      out.ignored.push({ code, name, ym, reason: baseMismatch ? "base 불일치" : "없앨 행이 슬롯에 없음" });
    }
  }
  const ign = out.ignored.length;
  console.log(
    `[슬롯] ${label} ${out.months[0]}~${out.months[1]}(${out.months[2]}달): 슬롯 ${out.slots} · 덧씌움 ${out.overlay} · 적용 ${out.applied} · 무시 ${ign}` +
      ` (무시 비율 ${out.overlay ? ((ign / out.overlay) * 100).toFixed(1) : "-"}%)` +
      (ign ? ` · 무시 목록 ${out.ignored.map((x) => `${x.name}-${x.ym}(${x.reason})`).join(", ")}` : "")
  );
  return out;
}

// ---- 비교 --------------------------------------------------------------------------------------------------------
/** 객체를 잎(문자열·숫자·불·null)까지 펴서 경로 → 값. 배열은 인덱스로. */
export function leaves(value, prefix = "", out = new Map()) {
  if (value === null || typeof value !== "object") {
    out.set(prefix, value);
    return out;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
  if (!entries.length) out.set(prefix, Array.isArray(value) ? "[]" : "{}");
  for (const [k, v] of entries) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** 빼는 경로: 정규식 목록(경로 전체에 맞춘다). */
export function leafDiff(before, after, skip = []) {
  const a = leaves(JSON.parse(JSON.stringify(before ?? null)));
  const b = leaves(JSON.parse(JSON.stringify(after ?? null)));
  const skipped = (p) => skip.some((re) => re.test(p));
  const diffs = [];
  for (const p of new Set([...a.keys(), ...b.keys()])) {
    if (skipped(p)) continue;
    const x = a.has(p) ? a.get(p) : undefined;
    const y = b.has(p) ? b.get(p) : undefined;
    if (Object.is(x, y)) continue;
    // 글자 = 한쪽이라도 문자열(빈 배열·빈 객체 표시 "[]"·"{}" 포함, 1단계). 숫자 = 양쪽 다 숫자(2단계 서식 판정).
    // 기타 = 그 밖 전부(불·null, 숫자↔null·없음처럼 한쪽에만 있는 잎 포함) - 2단계에서 화면 코드가 그 키를 읽으면 「바뀜」(PREREG 5절 v2).
    const kind = typeof x === "string" || typeof y === "string" ? "글자" : typeof x === "number" && typeof y === "number" ? "숫자" : "기타";
    diffs.push({ path: p, kind, before: x, after: y });
  }
  return diffs;
}

export const UPDATED_AT = [/(^|\.)updatedAt$/];

/** 공개 파일 재현 대조: 다시 만든 값이 커밋된 공개 파일과 updatedAt 말고 같은가. 다르면 차이 앞 5개를 찍고 false. */
export function sameAsPublished(label, rebuilt, published, skip = UPDATED_AT) {
  const d = leafDiff(published, rebuilt, skip);
  console.log(`[재현] ${label}: 공개 파일과 ${d.length ? `다름 ${d.length}곳 - ${d.slice(0, 5).map((x) => `${x.path} ${JSON.stringify(x.before)}→${JSON.stringify(x.after)}`).join(" | ")}` : "같음(updatedAt 제외)"}`);
  return d.length === 0;
}

/** 다중집합 비교: 나간 것(before 에만)·들어온 것(after 에만) 수. 원소는 JSON 글자로 센다. outRows·inRows 는 건수만큼 되풀이한 글자 목록. */
export function multisetDiff(before, after) {
  const count = new Map();
  for (const x of before) {
    const k = JSON.stringify(x);
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  for (const x of after) {
    const k = JSON.stringify(x);
    count.set(k, (count.get(k) ?? 0) - 1);
  }
  let out = 0;
  let inn = 0;
  const outRows = [];
  const inRows = [];
  for (const [k, c] of count) {
    if (c > 0) {
      out += c;
      for (let i = 0; i < c; i += 1) outRows.push(k);
    } else if (c < 0) {
      inn += -c;
      for (let i = 0; i < -c; i += 1) inRows.push(k);
    }
  }
  return { out, in: inn, outRows, inRows };
}

// ---- 회차·적용 0 (PREREG 6절 v2, cpo 보완 3) ------------------------------------------------------------------------
/** 이 측정의 덧씌움 회차(raw/recollect/round-202611.json, PREREG 1절 고정). */
export const ROUND = "202611";

/** 판정 기록 꼬리: 회차와 적용/덧씌움 슬롯 수. 「아니오 확정」·「전환하지 않음」·「판정 불가」 기록에 늘 붙인다. */
export const roundTag = (slots) => `round ${ROUND} · 적용 ${slots.applied}/덧씌움 ${slots.overlay} 슬롯`;

/**
 * 적용 슬롯이 0 이면 잰 것이 없다(무시 슬롯은 두 읽기가 같은 객체라 어긋남이 저절로 0). 그 경로·빌더는 지표와 상관없이
 * 「이번 회차 판정 불가(적용 0)」로 적고 pm 에 올린다 - 「전환하지 않음」·「아니오 확정」으로 적지 않는다.
 */
export const NO_APPLIED = "이번 회차 판정 불가(적용 0) → pm";

/** 측정 단계 표시. 결과 줄은 이 머리 뒤에만 찍는다. */
export const head = (text) => console.log(`\n== ${text} ==`);
