// 이번 주 새로 신고된 거래(#703 W1) → docs/data/week-digest.json. 계산은 week-digest.ts(순수), 여기는 원본을 읽고 쓰기만 한다.
//
// 따로 등록하지 않는다: Daily 「실거래 수집」 단계의 build-record-high.ts 가 main() 맨 앞에서 이 함수를 soft-fail 로 부른다(#703 판정 -
// update-all.mjs·daily-update.yml 무수정, #644 와 등록 경로가 겹치지 않게). 여기서 던져도 신고가 산출물과 수집 커밋은 그대로 나간다.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { KINDS, RAW_DIR, itemKey } from "./realestate-raw.ts";
import { buildDigest, uniqueArrivals } from "./week-digest.ts";

const root = path.resolve(import.meta.dirname, "..");
const outFile = () =>
  process.env.WEEK_DIGEST_FILE ? path.resolve(process.env.WEEK_DIGEST_FILE) : path.join(root, "docs/data/week-digest.json");

/** 원본 전부를 파일 단위로. 파일 이름 순으로 읽어 같은 입력이면 같은 출력이다. */
async function readSlots(dir = RAW_DIR) {
  const slots = [];
  for (const kind of KINDS) {
    const names = (await readdir(path.join(dir, kind)).catch(() => [])).filter((f) => f.endsWith(".json")).sort();
    for (const name of names) {
      const file = JSON.parse(await readFile(path.join(dir, kind, name), "utf8"));
      if (file?.ok === false || !Array.isArray(file?.items)) continue;
      slots.push({ kind, district: file.district ?? name.slice(0, 5), items: file.items, arrivals: file.arrivals ?? null });
    }
  }
  return slots;
}

export async function buildWeekDigest({ now = new Date(), dir = RAW_DIR, out = outFile() } = {}) {
  const slots = await readSlots(dir);
  const rows = uniqueArrivals(slots, itemKey);
  const saleItems = slots.filter((s) => s.kind === "sale").flatMap((s) => s.items);
  const digest = buildDigest({ rows, saleItems, now });
  if (!digest) {
    console.log("  이번 주 새 신고: 도착 기록이 없어 건너뜀");
    return null;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(digest, null, 2)}\n`);
  const c = digest.current;
  console.log(
    `  이번 주 새 신고(${c.from}~${c.to}): 매매 ${c.sale}·전세 ${c.jeonse}·월세 ${c.wolse}, 신고가 ${c.records}/${c.judged}, ` +
      `해제 ${c.cancelDated}, ${digest.comparable ? "비교 가능" : `수집 공백 ${digest.gaps.join(",")} - 비교 억제`}`
  );
  return digest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  buildWeekDigest().catch((err) => {
    console.error(`이번 주 새 신고 생성 실패: ${err.message}`);
    process.exit(1);
  });
}
