// 전망 범위 판정 계산(#819). 규칙과 입력은 같은 폴더 PREREG.md 가 정하고, 이 파일은 그 계산을 옮긴 것이다.
//
//   git worktree add --detach <임시 경로> 063414a0f3a674f1bf887ce4b072281dc9cd74c7
//   node research/forecast-band-2026-11/judge.mjs <임시 경로> --judge        격자 전체를 재고 규칙을 적용한다(판정 때만)
//   node research/forecast-band-2026-11/judge.mjs <임시 경로> --q=0.10,0.05  지정한 분위만 재고 고르지 않는다
//   --index=<파일> 을 더하면 해시 확인 없이 그 지수로 돈다(합성 입력으로 계산을 검사할 때만).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const PIN = {
  commit: "063414a0f3a674f1bf887ce4b072281dc9cd74c7",
  "raw/ecos/apt-price-index.json": "805b78b1adbe48fc03a2f2b40f3ed61f9c93a0413867d5e1313628ba068af434",
  "scripts/outlook.ts": "252caa381e180ca262fdcc5d8fe585748d06060b977979884e1f5ce63607170c",
};
const REGIONS = ["200", "240", "250", "230"]; // 서울·서북권·서남권·동남권
const H = 3;
const GRID = Array.from({ length: 20 }, (_, i) => 100 - i * 5); // q = k/1000, 0.100 ~ 0.005
const INPUT = { inside: 384, cells: 596 };

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: { judge: { type: "boolean" }, q: { type: "string" }, index: { type: "string" } },
});
const root = positionals[0] && path.resolve(positionals[0]);
if (!root || (!v.judge && !v.q)) {
  console.error("사용법은 파일 머리를 본다. 판정 전에는 --judge 를 쓰지 않는다(PREREG 5절).");
  process.exit(2);
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
if (!v.index) {
  for (const [file, want] of Object.entries(PIN)) {
    if (file !== "commit" && sha256(path.join(root, file)) !== want) {
      console.error(`입력이 고정값과 다르다: ${file}. ${PIN.commit} 을 꺼낸 트리에서 돌린다.`);
      process.exit(1);
    }
  }
}

const { toSeries, backtest, quantile, COVERAGE_FROM } = await import(path.join(root, "scripts/outlook.ts"));
const index = JSON.parse(readFileSync(v.index ?? path.join(root, "raw/ecos/apt-price-index.json"), "utf8"));

const cells = REGIONS.flatMap((code) => {
  const series = toSeries(index.series[code]);
  const rows = backtest(series, H);
  const at = new Map(series.months.map((month, i) => [month, i]));
  return rows
    .filter((row) => row.origin >= COVERAGE_FROM)
    .map((row) => ({
      origin: row.origin,
      error: row.model,
      past: rows.filter((p) => at.get(p.origin) + H <= at.get(row.origin)).map((p) => p.model).sort((a, b) => a - b),
    }))
    .filter((cell) => cell.past.length);
});

const count = (k, keep = () => true) => {
  const q = k / 1000;
  const part = cells.filter(keep);
  const inside = part.filter((c) => c.error >= quantile(c.past, q) && c.error <= quantile(c.past, 1 - q)).length;
  return { inside, cells: part.length };
};
const percent = ({ inside, cells: n }) => (n ? ((inside / n) * 100).toFixed(1) : "-");
const line = (k) => {
  const all = count(k);
  const later = count(k, (c) => c.origin >= "202201");
  const earlier = count(k, (c) => c.origin < "202201");
  return { all, text: `${(k / 1000).toFixed(3)}  ${all.inside}/${all.cells} = ${percent(all)}%  2022~ ${percent(later)}%  ~2021 ${percent(earlier)}%` };
};

const origins = cells.map((c) => c.origin).sort();
console.log(`입력: ${v.index ?? PIN.commit}, 시점 ${origins[0]}~${origins.at(-1)}, 권역 ${REGIONS.join("·")}, ${H}개월 앞`);

const base = count(100);
if (!v.index && (base.inside !== INPUT.inside || base.cells !== INPUT.cells)) {
  console.error(`q=0.100 이 등록 입력 ${INPUT.inside}/${INPUT.cells} 과 다르다: ${base.inside}/${base.cells}. 판정하지 않는다.`);
  process.exit(1);
}

if (v.q) {
  for (const q of v.q.split(",")) console.log(line(Math.round(Number(q) * 1000)).text);
} else {
  const passes = ({ inside, cells: n }) => inside * 5 >= n * 4;
  console.log("q      전 기간(규칙 입력)  참고 열 둘은 규칙에 쓰지 않는다");
  for (const k of GRID) console.log(line(k).text);
  if (base.inside * 10 >= base.cells * 7) console.log("결과: q=0.100 이 70% 이상이라 사전 기준에 걸리지 않는다. 넓히지 않는다.");
  else {
    const picked = GRID.find((k) => passes(count(k)));
    console.log(picked === undefined ? "결과: 격자 안에 80%를 채우는 분위가 없다. PREREG 3절대로 pm 판정." : `결과: q=${(picked / 1000).toFixed(3)} (P${picked / 10}~P${100 - picked / 10})`);
  }
}
