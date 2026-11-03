// 측정 전 확인(#820, PREREG 9절). 호출 없음. 커밋 1d5c8b83의 raw·docs/data에서 재현한다. 날이 지나면 공개값이 움직여 비교가 어긋난다.
//   node research/slot-freeze-2026-11/offline-check.mjs
// 1. buildFiles 재계산이 공개 complex-price와 같은가. 2. 저장 슬롯을 그대로 넣은 compare가 변화 0인가.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFiles } from "../../scripts/build-complex-price.ts";
import { DISTRICTS } from "../../scripts/realestate-districts.ts";
import { recentMonths } from "../../scripts/realestate-source.ts";
import { plannedSlots } from "./measure.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

const published = new Map();
let updatedAt;
for (const name of readdirSync(path.join(root, "docs/data")).filter((f) => /^complex-price-.*\.json$/.test(f))) {
  const doc = read(`docs/data/${name}`);
  updatedAt ??= doc.updatedAt;
  for (const [apt, areas] of Object.entries(doc.cells)) for (const [area, cell] of Object.entries(areas)) if (cell.median) published.set(`${name}\u0000${apt}\u0000${area}`, cell.median);
}
const now = new Date(updatedAt);
const itemsByDistrict = {};
for (const { code } of DISTRICTS) {
  itemsByDistrict[code] = recentMonths(now, 7).flatMap((m) => {
    try {
      return read(`raw/sale/${code}-${m}.json`).items;
    } catch {
      return [];
    }
  });
}
const built = buildFiles({ itemsByDistrict, index: read("raw/ecos/apt-price-index.json"), outlook: read("docs/data/outlook.json"), now });
let cells = 0;
let same = 0;
for (const [slug, file] of Object.entries(built.files)) {
  for (const [apt, areas] of Object.entries(file.cells)) {
    for (const [area, cell] of Object.entries(areas)) {
      if (!cell.median) continue;
      cells += 1;
      if (published.get(`complex-price-${slug}.json\u0000${apt}\u0000${area}`) === cell.median) same += 1;
    }
  }
}
console.log(`칸: 공개 ${published.size}, 재계산 ${cells}, 중앙값 같음 ${same} (updatedAt ${updatedAt})`);

const work = mkdtempSync(path.join(tmpdir(), "slot-freeze-identity-"));
try {
  mkdirSync(path.join(work, "got/sale"), { recursive: true });
  const slots = plannedSlots().map((s) => {
    cpSync(path.join(root, `raw/sale/${s.code}-${s.yearMonth}.json`), path.join(work, `got/sale/${s.code}-${s.yearMonth}.json`));
    return { ...s, ok: true };
  });
  writeFileSync(path.join(work, "got/fetch-log.json"), JSON.stringify({ startedAt: updatedAt, commit: null, calls: 0, slots }));
  const script = path.join(import.meta.dirname, "measure.mjs");
  process.stdout.write(execFileSync(process.execPath, [script, "compare", "--refetched", path.join(work, "got"), "--out", path.join(work, "res")], { encoding: "utf8" }));
  const pub = read("docs/data/cancellation.json").seoul;
  console.log(`공개 서울: 해제율 ${pub.cancelledShare}, 미등기 ${pub.registration.staleShare}, 등기 중간값 ${pub.registration.medianDays}일, 익은 달 끝 ${pub.registration.matureMonths.at(-1)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
