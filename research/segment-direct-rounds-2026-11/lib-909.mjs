// #909 측정 공용: 네트워크 차단·키 환경변수 확인(cto 조건 9), 후보·씨앗·기준(사전 고정), 빌더와 같은 반올림.
// 측정 스크립트가 맨 먼저 import 한다. 빌더 파일은 고치지 않는다 - 측정 작업 트리의 scripts/ 를 그대로 import 한다.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";

// ---- 네트워크 0 ---------------------------------------------------------------------------------------------------
// 나가는 연결을 만드는 입구를 모두 막고 시도 수를 센다. 0 이 아니면 종료 2(측정 무효, PREREG 「무효·멈춤」 7).
export const network = { calls: 0, where: [] };
const block = (name) => () => {
  network.calls += 1;
  network.where.push(name);
  throw new Error(`#909 측정 중 네트워크 호출 차단: ${name}`);
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

// scripts/ 가 읽는 키 이름 전부(`grep -rhoE 'process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)[A-Z_]*' scripts`, 0916d6bf).
export const KEY_VARS = ["MOLIT_API_KEY", "MOLIT_RENT_API_KEY", "BUILDINGHUB_API_KEY", "GITHUB_TOKEN"];

/** 키 환경변수가 하나라도 있으면 종료 3. 이름 끝이 _KEY·_TOKEN·_SECRET 인 변수도 본다. quiet 면 0개일 때 찍지 않는다. */
export function assertNoKeys({ quiet = false } = {}) {
  const set = Object.keys(process.env).filter((k) => KEY_VARS.includes(k) || /(_KEY|_TOKEN|_SECRET)$/.test(k));
  if (set.length) {
    console.error(`멈춤: 키 환경변수가 있다 - ${set.join(", ")} (env -i 로 돌린다)`);
    process.exit(3);
  }
  if (!quiet) console.log(`키 환경변수 0개 (본 이름: ${KEY_VARS.join(", ")}, 그리고 *_KEY·*_TOKEN·*_SECRET)`);
}

/** 프로세스 끝 줄. 0 이 아니면 종료 2. */
export function finish(tag) {
  console.log(`[${tag}] 네트워크 호출 ${network.calls}${network.calls ? ` (${network.where.join(", ")})` : ""}`);
  if (network.calls) process.exit(2);
}

// ---- 사전 고정(PREREG S1~S5) ---------------------------------------------------------------------------------------
export const CANDIDATES = [400, 1000, 2000, 4000];
export const SEEDS = Array.from({ length: 20 }, (_, k) => 20261001 + 7919 * k);
export const BASE = { rounds: 100000, seed: 1 };
export const CURRENT = { rounds: 400, seed: 20261001 };
export const BUDGET_S = 7.7;
/** #858 문턱의 쌍 비율(S1): 중앙값 ≤ ⌊P·1/276⌋, 최댓값 ≤ ⌊P·3/276⌋. */
export const segLimits = (P) => ({ median: Math.floor((P * 1) / 276), max: Math.floor((P * 3) / 276) });
/** S2: 구간마다 D ≤ 2 (20개 중). */
export const DIRECT_MAX = 2;
/** CI 환산(기록만, S3): 11-16 Daily segment 400번 1.18초, #858 러너/이 머신 배율. */
export const CI = { segment400s: 1.18, ratio: [1.36, 1.91] };

// ---- 빌더와 같은 반올림 ---------------------------------------------------------------------------------------------
/** district-change.ts pct (segment 끝값, 0.1%p). */
export const pct = (logChange) => Math.round(Math.expm1(logChange) * 1000) / 10;
/** direct-deals.ts round1 (직거래 끝값, 0.1). */
export const round1 = (value) => Math.round(value * 10) / 10;

/** district-change.ts pairVerdicts 와 같은 규칙(반올림 값, 엄격한 >). 같은 차원 안의 행만 넘긴다. */
export function pairsWithin(rows) {
  const ok = rows.filter((r) => r.low !== null);
  const out = {};
  for (let i = 0; i < ok.length; i += 1) for (let j = i + 1; j < ok.length; j += 1) {
    const [a, b] = [ok[i], ok[j]];
    out[`${a.code}-${b.code}`] = a.low > b.high || b.low > a.high;
  }
  return out;
}

/** 중앙값(짝수면 가운데 둘 평균)·최댓값·범위. */
export function stat(values) {
  const s = [...values].sort((p, q) => p - q);
  const n = s.length;
  const median = n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
  return { n, median, max: n ? s[n - 1] : null, min: n ? s[0] : null };
}
