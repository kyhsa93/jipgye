// 예산대 18장(docs/budget-3eok.html ~ budget-20eok.html)이 같은 규칙 문단을 얼마나
// 나눠 싣는지 재는 읽기 전용 도구. 게이트가 아니고 npm test에도 넣지 않는다 -
// 페이지가 바뀌면 값이 바뀌는 게 맞고, 값에 따라 통과·실패가 갈리는 검사는
// 두지 않는다(#8). 정의는 이슈 #66 본문 「측정 정의」에 못 박힌 것이다.
//
//   node scripts/prose-share.mjs [docs폴더] [--both]
//
// 정의(pm, 2026-10-10)
// - 텍스트: <!-- -->·<script>·<style>·<svg> 제거 -> 태그 제거 -> &...; 엔티티를 공백으로 -> 공백 분리.
// - 숫자 가리기: [0-9]가 하나라도 든 토큰(단위·쉼표 포함)을 '#'으로 바꾼다.
// - 창: 연속 8단어의 집합(장별 set).
// - 고유율: 그룹 안에서 문서빈도 1인 창 수의 합 / 창 수의 합.
// - 공통 산문: 문서빈도가 과반(⌈n/2⌉, 18장이면 9장) 이상인 창 수의 합 / 창 수의 합.
//
// cmo가 2026-10-04에 쓴 sh.py(kyhsa93.github.io 전략 회의 cmo-work)는 같은 텍스트
// 처리에 숫자 가리기가 없고 공통 산문 정의가 따로 없다. --both는 그 방식(숫자 안
// 가림)도 한 줄 더 낸다. 두 값을 나란히 놓으려는 것이지 판정에 쓰라는 것이 아니다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WINDOW = 8;
const FIRST = 3;
const LAST = 20;

export function words(html, { maskNumbers }) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const list = text.split(/\s+/).filter(Boolean);
  return maskNumbers ? list.map((w) => (/[0-9]/.test(w) ? "#" : w)) : list;
}

export function windows(list) {
  const set = new Set();
  for (let i = 0; i + WINDOW <= list.length; i += 1) set.add(list.slice(i, i + WINDOW).join("\u0001"));
  return set;
}

// pages: Map(장 이름 -> html). 결과는 입력 순서와 무관하다(이름순으로 센다).
export function measure(pages, { maskNumbers }) {
  const names = [...pages.keys()].sort();
  const sets = new Map(names.map((n) => [n, windows(words(pages.get(n), { maskNumbers }))]));
  const df = new Map();
  for (const set of sets.values()) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
  const majority = Math.ceil(names.length / 2);
  const rows = names.map((name) => {
    const set = sets.get(name);
    let unique = 0;
    let common = 0;
    for (const w of set) {
      const n = df.get(w);
      if (n === 1) unique += 1;
      if (n >= majority) common += 1;
    }
    return { name, windows: set.size, unique, common };
  });
  const total = rows.reduce((a, r) => a + r.windows, 0);
  const sum = (key) => rows.reduce((a, r) => a + r[key], 0);
  return {
    maskNumbers,
    majority,
    pages: rows,
    commonShare: total ? sum("common") / total : 0,
    uniqueShare: total ? sum("unique") / total : 0,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function formatLine(m) {
  // 최저 장: 장별 고유율이 가장 낮은 장(같으면 이름순 먼저).
  const rate = (r) => (r.windows ? r.unique / r.windows : 0);
  const low = m.pages.reduce((a, r) => (rate(r) < rate(a) ? r : a), m.pages[0]);
  const label = m.maskNumbers ? "고유율(숫자 가림)" : "고유율(숫자 안 가림)";
  return `공통 산문 ${pct(m.commonShare)} · ${label} ${pct(m.uniqueShare)} · 최저 장 ${low.name} ${pct(rate(low))}`;
}

async function main() {
  const args = process.argv.slice(2);
  const both = args.includes("--both");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const dir = dirArg ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");
  const pages = new Map();
  for (let n = FIRST; n <= LAST; n += 1) {
    const name = `budget-${n}eok.html`;
    pages.set(name, await readFile(path.join(dir, name), "utf8"));
  }
  console.log(formatLine(measure(pages, { maskNumbers: true })));
  if (both) console.log(formatLine(measure(pages, { maskNumbers: false })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
