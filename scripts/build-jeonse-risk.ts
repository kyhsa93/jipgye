import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cellRatioEntries } from "./complex-ratio.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { complexPriceFileName } from "./build-complex-price.ts";
import { buildRisk, districtCounts } from "./jeonse-risk.ts";

/**
 * 전세가율 높고 값이 내린 칸 데이터(#690 N8): docs/data/jeonse-risk.json 하나(구 집계만, 칸 이름 없음).
 *
 * 등록: update-all.mjs·daily-update.yml 에 줄을 두지 않고 build-complex-ratio.ts 의 main 끝에서 불린다(cto+cpo 판정) -
 * 같은 원본(최근 여섯 달 raw/sale·raw/rent)을 이미 읽어 둔 단계이고, 두 등록 파일은 다른 열린 작업(#644·N2)이 고치고 있다.
 * 1년 전 값은 같은 Daily 에서 먼저 도는 build-complex-price.ts 가 쓴 complex-price-*.json 에서 읽는다.
 * 소프트 실패: 예외는 ::warning 한 줄로 알리고 어제 파일을 그대로 둔다(complex-ratio 와 Daily 는 계속 간다).
 * 파일은 임시 이름에 쓴 뒤 rename 한다 - 중간에 죽어도 반쯤 쓴 파일이 남지 않는다.
 */

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, "docs/data");
const outFile = process.env.JEONSE_RISK_FILE ? path.resolve(process.env.JEONSE_RISK_FILE) : path.join(dataDir, "jeonse-risk.json");

/** 파일 한도. 26행 집계라 1KB 안팎이다 - 넘으면 칸 이름 같은 것이 새어 들어온 것으로 보고 쓰지 않는다. */
export const MAX_FILE_BYTES = 8 * 1024;

const readJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
};

/** 구별 셈. byDistrict 는 build-complex-ratio 의 readRaw 결과({ 구 이름: { sales, rents } }). */
export async function countDistricts(byDistrict, dir = dataDir) {
  const out = {};
  for (const [name, { sales, rents }] of Object.entries<{ sales: unknown[]; rents: unknown[] }>(byDistrict ?? {})) {
    const slug = DISTRICT_SLUGS[name];
    if (!slug) continue;
    const price = await readJson(path.join(dir, complexPriceFileName(slug)));
    out[name] = districtCounts(cellRatioEntries(sales, rents), price?.cells);
  }
  return out;
}

export async function runJeonseRisk({ byDistrict, months = null, now = new Date(), dir = dataDir, file = outFile, log = console.log }) {
  const warn = (msg) => log(`::warning::전세가율 높은 칸 데이터: ${msg} - 어제 파일을 그대로 둡니다`);
  try {
    const payload = buildRisk({ byDistrict: await countDistricts(byDistrict, dir), now, months });
    if (!payload) {
      warn("칸이 없음");
      return null;
    }
    const body = `${JSON.stringify(payload)}\n`;
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error(`${Buffer.byteLength(body)}B > ${MAX_FILE_BYTES}B`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, body);
    await rename(`${file}.tmp`, file);
    const { seoul } = payload;
    log(`  전세가율 80% 이상 칸: 서울 ${seoul.cells}칸 중 ${seoul.highShare}% · 그중 1년 매매 하락 ${seoul.fellShare}% (${seoul.highFell}/${seoul.highCompared}) · 1년 전 값 채움 ${seoul.compared}/${seoul.cells}`);
    return payload;
  } catch (err) {
    warn(err?.message ?? String(err));
    return null;
  }
}
