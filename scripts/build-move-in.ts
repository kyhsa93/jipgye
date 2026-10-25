import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MOVE_IN_DIR } from "./fetch-move-in.ts";
import { districtByHalf, moveInDistrictTableHtml, moveInDistrictsText, moveInLead, moveInTableHtml, parseCsv, summarize } from "./move-in.ts";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.MOVE_IN_FILE ? path.resolve(process.env.MOVE_IN_FILE) : path.join(root, "docs/data/move-in.json");

export function buildPayload({ csv, meta, now }) {
  const rows = parseCsv(csv);
  const s = summarize(rows);
  if (!s) return null;
  const byDistrict = districtByHalf(rows);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  return {
    updatedAt: now.toISOString(),
    basis: meta?.basis ?? null,
    source: meta?.name ?? null,
    seoul: s,
    lead: both((l) => moveInLead(s, meta?.basis, l)),
    table: both((l) => moveInTableHtml(s, l)),
    districts: both((l) => moveInDistrictsText(s, l)),
    // 구×반기(#677): 숫자(byDistrict)와 그것으로 굽은 표 조각(districtTable). 화면은 districts 줄 대신 표를 고른다 - districts 는 모양 불변으로 남긴다.
    byDistrict,
    districtTable: both((l) => moveInDistrictTableHtml(byDistrict, meta?.basis, l)),
  };
}

/** 숫자·글자만 든 짧은 배열을 한 줄로 접는다(구×반기 숫자가 줄마다 하나씩 퍼져 json 이 부푸는 것을 막는다). 다른 필드의 모양은 안 건드린다. */
export const stringify = (payload) =>
  JSON.stringify(payload, null, 2).replace(/\[\n(?:\s+(?:-?\d+|"[^"\n]*"),?\n)+\s*\]/g, (m) => `[${m.slice(1, -1).trim().replace(/,\n\s+/g, ", ").replace(/\s+/g, " ")}]`);

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
  await writeFile(outFile, stringify(payload));
  console.log(`  입주예정물량: 서울 ${payload.seoul.complexes}개 단지 ${payload.seoul.units.toLocaleString("ko-KR")}세대 (${payload.basis} 기준)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
