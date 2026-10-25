import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSlotFile } from "./realestate-raw.ts";
import { RETENTION_MONTHS, WINDOW_MONTHS as NEW_MONTHS } from "./realestate-slots.ts";
import { recentMonths } from "./realestate-source.ts";
import { districtCells, THRESHOLDS } from "./renewal-cells.ts";

/**
 * 재계약 확인기 데이터(#652 V3): docs/data/renewal-cells-{slug}.json 25개.
 *
 * 등록: 이 빌더는 update-all.mjs·daily-update.yml 에 따로 줄을 두지 않고 build-complex-ratio.ts 의 main 첫머리에서 불린다 -
 * 같은 원본(raw/rent)을 읽는 같은 「실거래 수집」 단계의 빌더이고, 두 등록 파일은 동시에 열린 PR(#644)이 고치고 있어서다
 * (cto 판정 대상, PR 본문 「일탈」). 그래서 이 파일의 실패는 complex-ratio 를 멈추지 않는다(소프트 실패):
 * 예외는 ::warning 한 줄로 알리고 어제 파일을 그대로 둔다. 파일은 임시 이름에 쓴 뒤 rename 한다 - 중간에 죽어도 반쯤 쓴 파일이 남지 않는다.
 */

const root = path.resolve(import.meta.dirname, "..");
const dataDir = process.env.RENEWAL_CELLS_DIR ? path.resolve(process.env.RENEWAL_CELLS_DIR) : path.join(root, "docs/data");

/** 갱신 창(판정 3: 최근 24개월 - 원본 보관 한도와 같다). */
export const WINDOW_MONTHS = RETENTION_MONTHS;

/** 구 파일 한도(판정 7). 넘으면 그 구는 쓰지 않고 어제 파일을 둔다 - 화면 전송량 약속이 데이터 성장으로 조용히 깨지지 않게. */
export const MAX_FILE_BYTES = 40 * 1024;
/** 같은 판정의 전송량 한도(gzip). 2026-10-25 원본에서 가장 큰 구(강남)가 29.8KB·gzip 8.6KB 다. */
export const MAX_GZIP_BYTES = 10 * 1024;

export const renewalCellsFileName = (slug: string) => `renewal-cells-${slug}.json`;

/** 쓸 수 있는 파일 이름 전부(허용 목록). 이 밖의 이름은 쓰지 않는다. */
export const ALLOWED_FILES = new Set(Object.values(DISTRICT_SLUGS).map(renewalCellsFileName));

const itemsOf = (files) => files.filter((f) => f?.ok !== false && Array.isArray(f?.items)).flatMap((f) => f.items);

/** 자치구별 파일 본문. DISTRICTS 순서 - 완료 순서가 출력 순서가 되지 않게. */
export function buildFiles({ rentsByDistrict, newByDistrict = {}, months, now }) {
  const files = {};
  for (const { code, name } of DISTRICTS) {
    const slug = DISTRICT_SLUGS[name];
    const rents = rentsByDistrict[code];
    if (!slug || !rents?.length) continue;
    const { cells, fallback } = districtCells(rents, newByDistrict[code] ?? []);
    if (!Object.keys(cells).length) continue;
    files[slug] = { updatedAt: now.toISOString(), window: [months[0], months.at(-1)], min: THRESHOLDS, cells, fallback };
  }
  return files;
}

/** 한 파일을 임시 이름에 쓰고 바꿔 단다. 허용 목록 밖 이름·한도 초과는 던진다(부르는 쪽이 경고로 바꾼다). */
export async function writeCellsFile(dir: string, slug: string, payload: object) {
  const name = renewalCellsFileName(slug);
  if (!ALLOWED_FILES.has(name)) throw new Error(`허용 목록 밖 파일 이름: ${name}`);
  const body = `${JSON.stringify(payload)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_FILE_BYTES) throw new Error(`${name} ${bytes}B > ${MAX_FILE_BYTES}B`);
  const gz = gzipSync(body).length;
  if (gz > MAX_GZIP_BYTES) throw new Error(`${name} gzip ${gz}B > ${MAX_GZIP_BYTES}B`);
  const target = path.join(dir, name);
  const temp = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temp, body);
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
  return bytes;
}

async function readDistricts(months: string[], dir?: string) {
  const out = {};
  await Promise.all(
    DISTRICTS.map(async ({ code }) => {
      out[code] = itemsOf(await Promise.all(months.map((m) => readSlotFile("rent", code, m, dir))));
    })
  );
  return out;
}

/**
 * 소프트 실패 진입점. 던지지 않는다 - 무엇이 잘못돼도 ::warning 을 찍고 그 구(또는 전체)의 어제 파일을 둔다.
 * 돌려주는 값: { written: {slug: bytes}, warnings: [문장] } (시험·로그용).
 */
// newMonths: 신규 전세 중앙값의 창. build-complex-ratio 가 자기 창(MONTHS, 시세 화면과 같은 여섯 달)을 넘긴다 - 판정 3 「complex-ratio 의 같은 평형 신규 전세」.
export async function runRenewalCells({ now = new Date(), dir = dataDir, rawDir = undefined, newMonths: newCount = NEW_MONTHS, log = console.log } = {}) {
  const written = {};
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    log(`::warning::재계약 확인기 데이터: ${msg} - 어제 파일을 그대로 둡니다`);
  };
  try {
    const months = recentMonths(now, WINDOW_MONTHS);
    const newMonths = months.slice(-newCount);
    const rentsByDistrict = await readDistricts(months, rawDir);
    const newByDistrict = {};
    for (const [code, items] of Object.entries<unknown[]>(rentsByDistrict)) {
      newByDistrict[code] = items.filter((item: { dealYear?: unknown; dealMonth?: unknown }) => {
        const ym = `${item?.dealYear}${String(item?.dealMonth ?? "").padStart(2, "0")}`;
        return newMonths.includes(ym);
      });
    }
    const files = buildFiles({ rentsByDistrict, newByDistrict, months, now });
    if (!Object.keys(files).length) {
      warn("갱신 짝이 하나도 없음");
      return { written, warnings };
    }
    await mkdir(dir, { recursive: true });
    for (const [slug, payload] of Object.entries<object>(files)) {
      try {
        written[slug] = await writeCellsFile(dir, slug, payload);
      } catch (err) {
        warn(`${slug}: ${err?.message ?? err}`);
      }
    }
    const total = Object.values<number>(written).reduce((a, b) => a + b, 0);
    log(`  재계약 확인기: ${Object.keys(written).length}개 구, 합 ${total}B (가장 큰 구 ${Math.max(0, ...Object.values<number>(written))}B)`);
  } catch (err) {
    warn(err?.message ?? String(err));
  }
  return { written, warnings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runRenewalCells();
}
