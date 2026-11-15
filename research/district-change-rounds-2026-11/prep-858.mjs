// 원본에서 칸 변화·칸 수준을 한 번 만들어 저장하고, 공개 district-change.json 을 그대로 재현하는지 확인한다.
// 측정 때(main c50948f3, ROUNDS 400 · MONEY_ROUNDS 200) 기준이다. #858 병합 뒤 빌더는 2,000번·고른 금액 횟수를 써서 「재현 일치」는 false 가 나오고, input-858.json 은 그대로 만들어진다.
import { writeFile, readFile } from "node:fs/promises";
const R = new URL("../../scripts/", import.meta.url).href;
const dc = await import(R + "district-change.ts");
const bd = await import(R + "build-district-change.ts");
const { readSameNames } = await import(R + "realestate-raw.ts");
const { DISTRICTS } = await import(R + "realestate-districts.ts");
const { INDEX_FILE } = await import(R + "fetch-price-index.ts");
const { DISTRICT_INDEX_FILE } = await import(R + "fetch-district-index.ts");
const rj = async (f) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } };
const t0 = Date.now();
const [{ items }, sameNames, official, survey] = await Promise.all([bd.readAll(), readSameNames(), rj(INDEX_FILE), rj(DISTRICT_INDEX_FILE)]);
const t1 = Date.now();
const now = new Date("2026-11-15T02:43:24.257Z");
const tp = Date.now();
const payload = bd.buildPayload({ items, now, official, survey, sameNames });
const tb = Date.now() - tp;
const pub = JSON.parse(await readFile(new URL("../../docs/data/district-change.json", import.meta.url), "utf8"));
const strip = (p) => JSON.stringify({ ...p, updatedAt: null });
console.log("read ms", t1 - t0, "buildPayload ms", tb, "items", items.length);
console.log("재현 일치:", strip(payload) === strip(pub));
for (const k of ["rows", "pairs", "money", "lead"]) console.log(" ", k, JSON.stringify(payload[k]) === JSON.stringify(pub[k]));
const deals = items.map((i) => dc.toDeal(i, sameNames)).filter(Boolean);
const byD = dc.cellChanges(deals, payload.periods);
const lv = dc.cellLevels(deals, payload.periods);
await writeFile(new URL("./input-858.json", import.meta.url), JSON.stringify({ periods: payload.periods, districts: DISTRICTS, byDistrict: [...byD], levels: [...lv] }));
