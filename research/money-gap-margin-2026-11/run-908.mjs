// 한 (입력, 횟수, 씨앗)의 모든 쌍 금액 간격을 반올림 전 값과 순서통계량까지 out/ 에 쓴다. 인자: <입력 이름> <R> <seed>
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { moneyFull, prepCells } from "./fast-908.mjs";
const [name, R, seed] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const inp = JSON.parse(await readFile(new URL(`./input-908-${name}.json`, import.meta.url), "utf8"));
const byD = new Map(inp.byDistrict); const lv = new Map(inp.levels);
// 빌드의 moneyPairs 와 같은 쌍: 칸 변화가 MIN_CELLS(30) 이상인 구(값을 낸 줄)끼리, 코드 순.
const ok = inp.districts.map((d) => d.code).filter((c) => (byD.get(c) ?? []).length >= 30).sort();
const P = new Map(ok.map((c) => [c, prepCells(lv.get(c))]));
const out = {};
for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) out[`${ok[i]}-${ok[j]}`] = moneyFull(P.get(ok[i]), P.get(ok[j]), R, seed);
await mkdir(new URL("./out/", import.meta.url), { recursive: true });
await writeFile(new URL(`./out/${name}-${R}-${seed}.json`, import.meta.url), JSON.stringify(out));
