// 행정표준코드관리시스템 「법정동코드 전체자료」 txt(cp949, 탭 구분: 코드·이름·존재/폐지)에서
// 서울 25구의 현존 법정동 뒤 5자리를 뽑아 bjdong-seoul.json을 만든다(#136).
// 사용: node research/housing-permits/import-bjdong.mjs <전체자료.txt> <출력.json>
// 받은 파일은 신뢰하지 않는다 - 줄을 정규식으로만 읽고, 형식이 다르면 멈춘다.
import { readFile, writeFile } from "node:fs/promises";
import { DISTRICTS } from "../../scripts/realestate-districts.mjs";

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error("사용: import-bjdong.mjs <전체자료.txt> <출력.json>");
const text = new TextDecoder("euc-kr").decode(await readFile(src));
const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
if (!/^법정동코드\t법정동명\t폐지여부$/.test(lines[0])) throw new Error(`머리줄이 가정과 다름: ${lines[0]}`);

const byGu = new Map(DISTRICTS.map((d) => [d.code, new Set()]));
let skippedAbolished = 0;
for (const line of lines.slice(1)) {
  const m = /^(\d{10})\t([^\t]+)\t(존재|폐지)$/.exec(line);
  if (!m) throw new Error(`알 수 없는 줄: ${line.slice(0, 40)}`);
  const [, code, , state] = m;
  const gu = code.slice(0, 5);
  const dong = code.slice(5);
  if (!byGu.has(gu) || dong === "00000") continue; // 서울 25구 밖, 또는 구 자체 행
  if (state === "폐지") { skippedAbolished += 1; continue; }
  byGu.get(gu).add(dong);
}
const result = {};
for (const { code, name } of DISTRICTS) {
  const dongs = [...byGu.get(code)].sort();
  if (dongs.length === 0) throw new Error(`${name}(${code})에 현존 법정동이 없음`);
  result[code] = dongs;
}
await writeFile(out, JSON.stringify(result, null, 1) + "\n");
console.log(`구 ${DISTRICTS.length}, 현존 동 ${Object.values(result).flat().length}, 제외한 폐지 ${skippedAbolished}`);
