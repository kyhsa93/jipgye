import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  byCell,
  controlSentence,
  grid,
  gridTableHtml,
  leadSentence,
  measure,
  survivalSentence,
  toDeal,
} from "./record-high.mjs";
import { RAW_DIR } from "./realestate-raw.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.RECORD_HIGH_FILE
  ? path.resolve(process.env.RECORD_HIGH_FILE)
  : path.join(root, "docs/data/record-high.json");

export function buildPayload({ items, now }) {
  const deals = items.map(toDeal).filter(Boolean);
  if (!deals.length) return null;
  const cells = byCell(deals);
  // 끝은 원본에 있는 마지막 계약일이다. 오늘로 잡으면 아직 신고가 덜 들어온 며칠이 "다음 거래 없음"으로 읽힌다.
  // 스프레드 금지: 원본 전체를 받아 호출 스택이 건수에 비례해 터진다(#97).
  const end = deals.reduce((m, d) => Math.max(m, d.time), -Infinity);
  const main = measure(cells, end);
  const robust = grid(cells, end);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });

  return {
    updatedAt: now.toISOString(),
    end: new Date(end).toISOString().slice(0, 10),
    deals: deals.length,
    main,
    robust,
    lead: both((l) => leadSentence(main, robust, l)),
    control: both((l) => controlSentence(main, l)),
    survival: both((l) => survivalSentence(main, l)),
    tables: { robust: both((l) => gridTableHtml(robust, l)) },
  };
}

/** 원본 전부. 신고가를 가르려면 그 칸의 지난 거래가 길게 있어야 한다 - 창을 자르지 않는다. */
async function readAll() {
  const dir = path.join(RAW_DIR, "sale");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const items = [];
  for (const name of files) {
    const file = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    if (file?.ok !== false && Array.isArray(file?.items)) items.push(...file.items);
  }
  return items;
}

async function main() {
  const payload = buildPayload({ items: await readAll(), now: new Date() });
  if (!payload) {
    console.log("  신고가 다음 거래: 원본이 없어 건너뜀");
    return;
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  const m = payload.main;
  console.log(
    `  신고가 다음 거래: 신고가 ${m.records}건(다음 거래 없음 ${m.none}%), 다음 ≥ 신고가 ${m.record}% vs 아무 거래 ${m.all}%, ` +
      `문턱 조합 ${payload.robust.filter((r) => r.counted && r.holds).length}/${payload.robust.filter((r) => r.counted).length} 유지`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
