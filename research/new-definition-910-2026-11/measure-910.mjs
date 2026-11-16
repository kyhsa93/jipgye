// #910 계수: 지금 워크트리의 scripts/ 로 A1·A2·A3·B6 산출물을 다시 만든다(산출 커밋 0).
// 실행: node measure-910.mjs <worktree> <outdir>   (outdir/rents 는 앞서 build-realestate 가 DEAL_FILES_DIR 로 쓴 곳)
import path from "node:path";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
const wt = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
const S = (f) => import(`${wt}/scripts/${f}`);
const { readRaw, buildPayload } = await S("build-complex-ratio.ts");
const { cellRatioEntries } = await S("complex-ratio.ts");
const { recentMonths } = await S("realestate-source.ts");
const { countDistricts } = await S("build-jeonse-risk.ts");
const { buildRisk } = await S("jeonse-risk.ts");
const { generate } = await S("build-recommendation.ts");
const preview = await S("build-rent-preview.ts");
const { DISTRICT_PAGES, DISTRICT_SLUGS } = await S("district-slugs.ts");
const { rentFileName } = await S("deal-files.ts");
const RAW = `${wt}/raw`, DATA = `${wt}/docs/data`;
await mkdir(out, { recursive: true });

// A1·A2: Daily 의 complex-ratio 실행 시각(공개 파일 updatedAt)
const nowA = new Date("2026-11-16T02:45:01.520Z");
const months = recentMonths(nowA, 6);
const byDistrict = await readRaw(months, RAW);
const a1 = buildPayload({ byDistrict, now: nowA });
const cells = {};
for (const [name, { sales, rents, same }] of Object.entries(byDistrict)) cells[name] = cellRatioEntries(sales, rents, same);
const a2 = buildRisk({ byDistrict: await countDistricts(byDistrict, DATA), now: nowA, months: [months[0], months.at(-1)] });
await writeFile(`${out}/a1.json`, JSON.stringify(a1));
await writeFile(`${out}/a1-cells.json`, JSON.stringify(cells));
await writeFile(`${out}/a2.json`, JSON.stringify(a2));

// A3: reco 실행 시각
const nowR = new Date("2026-11-16T02:45:08.412Z");
const recoDir = `${out}/reco`;
await mkdir(recoDir, { recursive: true });
await copyFile(`${DATA}/outlook.json`, `${recoDir}/outlook.json`);
const reco = await generate({ now: nowR, dataDir: recoDir, rawDir: RAW });
await writeFile(`${out}/a3.json`, JSON.stringify(reco.files));

// B6: build-realestate 가 다시 만든 rents 위에서
const byD = {};
for (const d of DISTRICT_PAGES) {
  const j = await readFile(`${out}/rents/${rentFileName(DISTRICT_SLUGS[d.name])}`, "utf8").then(JSON.parse).catch(() => null);
  if (j) byD[d.name] = j;
}
const b6 = preview.buildPayload({ byDistrict: byD, now: new Date("2026-11-16T02:45:08.203Z") });
await writeFile(`${out}/b6.json`, JSON.stringify(b6));
console.log("ok", months.join(","), "A1 seoul", JSON.stringify(a1.seoul), "A2 seoul", JSON.stringify(a2.seoul), "reco", reco.reference, "B6", b6.jeonse.total, b6.wolse.total);
