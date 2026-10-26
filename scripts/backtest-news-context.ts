import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildContext } from "./news-context.ts";

const dataDir = path.resolve(import.meta.dirname, "../docs/data");
const readJson = async (name) => {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${name}.json`), "utf8"));
  } catch {
    return null;
  }
};

function parseArgs(argv) {
  const days = argv.includes("--days") ? Number(argv[argv.indexOf("--days") + 1]) : null;
  return { days: Number.isFinite(days) ? days : null, showMatched: argv.includes("--matched") };
}

const argLimit = () => {
  const at = process.argv.indexOf("--answers");
  const n = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 20;
};

async function main() {
  const { days, showMatched } = parseArgs(process.argv.slice(2));
  const [history, realestate, recordHigh, cancellation, moveIn, conversion] = await Promise.all(
    ["news-history", "realestate", "record-high", "cancellation", "move-in", "conversion"].map(readJson)
  );

  if (!history?.length) {
    console.error("news-history.json이 없습니다. 뉴스를 한 번이라도 수집한 뒤 실행해주세요.");
    process.exit(1);
  }

  const data = { realestate, recordHigh, cancellation, moveIn, conversion };
  const target = days ? history.slice(-days) : history;

  const byLabel = new Map();
  const seen = new Set();
  const unique = [];
  let total = 0;
  let matched = 0;

  for (const day of target) {
    let dayMatched = 0;
    for (const item of day.items ?? []) {
      total += 1;
      const context = buildContext(item, data);
      if (context.length) {
        matched += 1;
        dayMatched += 1;
        for (const c of context) byLabel.set(c.label, (byLabel.get(c.label) ?? 0) + 1);
      }
      if (!seen.has(item.title)) {
        seen.add(item.title);
        unique.push({ title: item.title, context });
      }
    }
    const count = day.items?.length ?? 0;
    const rate = count ? Math.round((dayMatched / count) * 100) : 0;
    console.log(`${day.date}  ${String(dayMatched).padStart(3)}/${String(count).padStart(3)}  ${rate}%`);
  }

  console.log(`\n합계 ${matched}/${total} (${total ? Math.round((matched / total) * 100) : 0}%), 고유 기사 ${unique.length}건`);

  console.log("\n=== 붙은 종류 ===");
  for (const [label, n] of [...byLabel].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${label}`);
  }

  // 새 답 칩(#694)은 종류별 붙은 기사 수와, 오탐을 눈으로 보도록 기사 제목·칩을 모두 찍는다(--answers 는 고유 기사만, 처음 N건).
  const byKind = new Map();
  for (const u of unique) for (const c of u.context) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  console.log("\n=== 칩 종류별 고유 기사 수 ===");
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${kind}`);

  const answers = unique.filter((u) => u.context.some((c) => c.kind !== "realestate"));
  console.log(`\n=== 새 답 칩이 붙은 고유 기사 ${answers.length}건 (오탐 표본) ===`);
  for (const u of answers.slice(0, argLimit())) {
    console.log(`  ✓ ${u.title}`);
    for (const c of u.context.filter((c) => c.kind !== "realestate")) console.log(`      [${c.kind}] ${c.label} = ${c.value} -> ${c.href}`);
  }

  console.log("\n=== 아무것도 안 붙은 기사 ===");
  for (const u of unique.filter((u) => !u.context.length)) console.log(`  · ${u.title}`);

  if (showMatched) {
    console.log("\n=== 붙은 기사 ===");
    for (const u of unique.filter((u) => u.context.length)) {
      console.log(`  ✓ ${u.title}`);
      console.log(`      ${u.context.map((c) => `${c.label}=${c.value}`).join(" | ")}`);
    }
  } else {
    console.log("\n(붙은 기사까지 보려면 --matched)");
  }
}

main().catch((err) => {
  console.error(`대조 실패: ${err.message}`);
  process.exit(1);
});
