import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BANDS } from "./cancel-by-price.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import {
  breakdown,
  breakdownNote,
  breakdownTableHtml,
  byCell,
  controlSentence,
  grid,
  gridTableHtml,
  leadSentence,
  measure,
  survivalSentence,
  toDeal,
} from "./record-high.ts";
import { RAW_DIR } from "./realestate-raw.ts";
import { buildWeekDigest } from "./build-week-digest.ts";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.RECORD_HIGH_FILE
  ? path.resolve(process.env.RECORD_HIGH_FILE)
  : path.join(root, "docs/data/record-high.json");

export function buildPayload({ items, now }) {
  const deals = items.map(toDeal).filter(Boolean);
  if (!deals.length) return null;
  const cells = byCell(deals);
  // 끝은 원본에 있는 마지막 계약일이다. 오늘로 잡으면 아직 신고가 덜 들어온 며칠이 "다음 거래 없음"으로 읽힌다.
  // 스프레드 금지: 원본 전체를 받아 호출 스택이 건수에 비례해 터진다(#97).
  const end = deals.reduce((m, d) => Math.max(m, d.time), -Infinity);
  const main = measure(cells, end);
  const robust = grid(cells, end);
  const both = (fn) => ({ ko: fn("ko"), en: fn("en") });
  // 자치구·가격대별(N3). 서울 칸(main·robust·문장)은 위 그대로이고 여기서는 키만 더한다.
  const split = breakdown(cells, end, { districts: DISTRICT_ROWS, bands: BANDS });

  return {
    updatedAt: now.toISOString(),
    end: new Date(end).toISOString().slice(0, 10),
    deals: deals.length,
    main,
    robust,
    lead: both((l) => leadSentence(main, robust, l)),
    control: both((l) => controlSentence(main, l)),
    survival: both((l) => survivalSentence(main, l)),
    breakdownNote: both((l) => breakdownNote(split, l)),
    tables: {
      robust: both((l) => gridTableHtml(robust, l)),
      districts: both((l) => breakdownTableHtml(split.districts, main, "district", l)),
      bands: both((l) => breakdownTableHtml(split.bands, main, "band", l)),
    },
    breakdown: split,
  };
}

/** 자치구 행 이름. 영어는 슬러그를 「Gangnam-gu」 꼴로. */
const DISTRICT_ROWS = DISTRICTS.map(({ code, name }) => {
  const slug = DISTRICT_SLUGS[name] ?? code;
  return { code, ko: name, en: `${slug[0].toUpperCase()}${slug.slice(1)}-gu` };
});

/** 원본 전부. 신고가를 가르려면 그 칸의 지난 거래가 길게 있어야 한다 - 창을 자르지 않는다. */
async function readAll() {
  const dir = path.join(RAW_DIR, "sale");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const items = [];
  for (const name of files) {
    const file = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    if (file?.ok !== false && Array.isArray(file?.items)) items.push(...file.items);
  }
  return items;
}

async function main() {
  await weekDigestSoft();
  const payload = buildPayload({ items: await readAll(), now: new Date() });
  if (!payload) {
    console.log("  신고가 다음 거래: 원본이 없어 건너뜀");
    return;
  }
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(payload, null, 2));
  const m = payload.main;
  console.log(
    `  신고가 다음 거래: 신고가 ${m.records}건(다음 거래 없음 ${m.none}%), 다음 ≥ 신고가 ${m.record}% vs 아무 거래 ${m.all}%, ` +
      `문턱 조합 ${payload.robust.filter((r) => r.counted && r.holds).length}/${payload.robust.filter((r) => r.counted).length} 유지`
  );
}

/**
 * 이번 주 새 신고(#703 W1)를 같은 단계에서 만든다 - 따로 등록하지 않는다(판정: update-all.mjs·daily-update.yml 무수정).
 * soft-fail: 던지면 경고만 남기고 신고가 산출물은 그대로 만든다. 이 파일의 산출물이 W1 때문에 빠지면 안 된다.
 */
async function weekDigestSoft() {
  try {
    await buildWeekDigest();
  } catch (err) {
    console.warn(`  이번 주 새 신고: 실패해 건너뜀(신고가는 계속) - ${(err as Error).message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
