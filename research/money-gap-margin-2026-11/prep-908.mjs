// 입력 하나(A 또는 B)의 칸 변화·칸 수준을 만들어 input-908-<이름>.json 에 쓴다. 인자: <이름> <확인 방식 full|money200>
// 실행하는 작업 트리: 코드는 main 8eb314f7, raw/·docs/data/ 는 그 입력의 커밋(PREREG.md 「입력」).
// now 는 그 트리의 docs/data/district-change.json updatedAt 이다(공개 파일을 만든 실행과 같은 시점).
// 확인: full - 이 코드로 다시 만든 rows·pairs·money·lead 가 공개 파일과 모두 같아야 한다(입력 A, 8eb314f7 코드가 만든 파일).
//       money200 - 공개 파일이 #912 전 코드(금액 200번)로 만들어졌으므로 moneyRounds 200 의 money 만 견준다(입력 B).
// 하나라도 다르면 멈춘다(측정하지 않는다).
import { writeFile, readFile } from "node:fs/promises";
const R = new URL("../../scripts/", import.meta.url).href;
const dc = await import(R + "district-change.ts");
const bd = await import(R + "build-district-change.ts");
const { readSameNames } = await import(R + "realestate-raw.ts");
const { DISTRICTS } = await import(R + "realestate-districts.ts");
const { INDEX_FILE } = await import(R + "fetch-price-index.ts");
const { DISTRICT_INDEX_FILE } = await import(R + "fetch-district-index.ts");
const [name, check] = [process.argv[2], process.argv[3]];
if (!name || !["full", "money200"].includes(check)) throw new Error("인자: <이름> full|money200");
if (dc.MONEY_ROUNDS !== 4000) throw new Error(`MONEY_ROUNDS ${dc.MONEY_ROUNDS} - PREREG 무효(4000 이어야 한다)`);
const rj = async (f) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; } };
const pub = JSON.parse(await readFile(new URL("../../docs/data/district-change.json", import.meta.url), "utf8"));
const now = new Date(pub.updatedAt);
const [{ items }, sameNames, official, survey] = await Promise.all([bd.readAll(), readSameNames(), rj(INDEX_FILE), rj(DISTRICT_INDEX_FILE)]);
const payload = bd.buildPayload({ items, now, official, survey, sameNames, ...(check === "money200" ? { moneyRounds: 200 } : {}) });
const keys = check === "full" ? ["periods", "rows", "pairs", "money", "lead"] : ["periods", "money"];
const same = Object.fromEntries(keys.map((k) => [k, JSON.stringify(payload[k]) === JSON.stringify(pub[k])]));
console.log(`입력 ${name}: now ${pub.updatedAt} items ${items.length} 확인(${check})`, JSON.stringify(same));
if (!Object.values(same).every(Boolean)) throw new Error("공개 파일 재현 실패 - 측정하지 않는다");
const deals = items.map((i) => dc.toDeal(i, sameNames)).filter(Boolean);
const byD = dc.cellChanges(deals, payload.periods);
const lv = dc.cellLevels(deals, payload.periods);
await writeFile(new URL(`./input-908-${name}.json`, import.meta.url), JSON.stringify({ name, now: pub.updatedAt, periods: payload.periods, districts: DISTRICTS, byDistrict: [...byD], levels: [...lv] }));
