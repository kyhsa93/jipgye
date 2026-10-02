import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MOVE_IN_DIR } from "./fetch-move-in.mjs";
import { moveInDistrictsText, moveInLead, moveInTableHtml, parseCsv, summarize } from "./move-in.mjs";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.MOVE_IN_FILE ? path.resolve(process.env.MOVE_IN_FILE) : path.join(root, "docs/data/move-in.json");

export function buildPayload({ csv, meta, now }) {
  const s = summarize(parseCsv(csv));
  if (!s) return null;
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  return {
    updatedAt: now.toISOString(),
    basis: meta?.basis ?? null,
    source: meta?.name ?? null,
    seoul: s,
    lead: both((l) => moveInLead(s, meta?.basis, l)),
    table: both((l) => moveInTableHtml(s, l)),
    districts: both((l) => moveInDistrictsText(s, l)),
  };
}

async function main() {
  const [csv, meta] = await Promise.all([
    readFile(path.join(MOVE_IN_DIR, "move-in.csv"), "utf8").catch(() => null),
    readFile(path.join(MOVE_IN_DIR, "meta.json"), "utf8").then(JSON.parse).catch(() => null),
  ]);
  const payload = csv ? buildPayload({ csv, meta, now: new Date() }) : null;
  if (!payload) {
    console.log("  입주예정물량: 원본이 없어 건너뜀(어제 파일 유지)");
    return;
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  console.log(`  입주예정물량: 서울 ${payload.seoul.complexes}개 단지 ${payload.seoul.units.toLocaleString("ko-KR")}세대 (${payload.basis} 기준)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
