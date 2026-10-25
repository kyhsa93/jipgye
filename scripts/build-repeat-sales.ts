// docs/data/repeat-sales.json 을 만든다: 갈아타기 화면 「같은 집이 다시 팔렸을 때」 절(#170 V8)의 숫자. 계산은 scripts/repeat-sales.ts.
//
// 매일 돈다: 5-1 ② 의 운영 창은 「24개월·신고 기한이 닫힌 달까지, 매일 이동」이다. 창은 이번 달(KST)에서만 정해서
// 같은 달 안에서는 원본이 늦은 신고로 바뀔 때만 값이 바뀐다. 2026-10 의 창(202411~202608)이 사전 등록 창이라, 그 달 출력은 repeat_index_v0.out 과 같다.
//
// 등록(PR #684 판정 조건, #662 와 같은 모양): update-all.mjs·daily-update.yml 에 따로 줄을 두지 않고 build-district-change.ts 끝에서
// runRepeatSales() 로 불린다 - 같은 장(갈아타기)·같은 원본(raw/sale)의 빌더다. 소프트 실패: 던지지 않고 ::warning 한 줄을 찍은 뒤 어제 파일을 둔다.
// 파일은 임시 이름에 쓴 뒤 rename 한다(중간에 죽어도 반쯤 쓴 파일이 남지 않는다).
//
//   node scripts/build-repeat-sales.ts                       오늘 창으로 docs/data/repeat-sales.json (손으로 돌릴 때 - 실패하면 종료 1)
//   node scripts/build-repeat-sales.ts --window=202411-202608  창을 고정(대조용 - scripts/dev/verify-repeat-sales-v0.mjs)
// 환경: REPEAT_SALES_FILE(출력 경로), REALESTATE_RAW_DIR(원본 폴더, realestate-raw.ts 와 같다).
//
// 출처 기록(provenance)은 입력을 다시 찾을 수 있게 남긴다: raw/sale 의 git 트리 해시와 R-ONE 파일의 git blob 해시를 git 없이 같은 방법으로 낸다
// (.out 0절의 「HEAD:raw/sale」·「R-ONE 파일 blob」과 같은 값). 시각은 적지 않는다 - 같은 입력이면 같은 바이트.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { compute, FORBIDDEN, JITTER_SEED, BOOT_SEED, loadRone, payload, REGISTERED, RONE_SOURCE, windowFor } from "./repeat-sales.ts";
import { DISTRICT_INDEX_FILE } from "./fetch-district-index.ts";
import { RAW_DIR } from "./realestate-raw.ts";
import { yearMonthOf } from "./realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.REPEAT_SALES_FILE ? path.resolve(process.env.REPEAT_SALES_FILE) : path.join(root, "docs/data/repeat-sales.json");

const sha1 = (buf: Buffer) => createHash("sha1").update(buf).digest();
/** `git hash-object` 와 같은 값. */
const blobId = (data: Buffer) => sha1(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]));

/** 평평한 폴더(일반 파일만)의 git 트리 해시. 이름 순, 모드 100644 - `git rev-parse HEAD:raw/sale` 과 같은 값이다. */
function treeId(entries: { name: string; data: Buffer }[]) {
  const body = Buffer.concat(
    [...entries]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((e) => [Buffer.from(`100644 ${e.name}\0`), blobId(e.data)])
  );
  return sha1(Buffer.concat([Buffer.from(`tree ${body.length}\0`), body])).toString("hex");
}

export async function build({ rawDir = RAW_DIR, roneFile = DISTRICT_INDEX_FILE, window = windowFor(yearMonthOf(new Date())) } = {}) {
  const dir = path.join(rawDir, "sale");
  const names = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const files = await Promise.all(names.map(async (name) => ({ name, data: await readFile(path.join(dir, name)) })));
  // count_repeat.load_rows: 정렬된 파일 순, 파일 안 items 순서(같은 날·같은 금액의 순서를 정한다).
  const rows = files.flatMap((f) => JSON.parse(f.data.toString("utf8")).items ?? []);
  const roneData = await readFile(roneFile);
  const rone = loadRone(JSON.parse(roneData.toString("utf8")));
  const roneLatest = Math.max(...[...rone.values()].flatMap((s) => [...s.keys()]));
  return payload(compute(rows, rone, window), window, {
    // 연구 폴더 이름은 경로 글자로 적지 않는다(collector-output-paths 시험: 수집이 가리키는 경로는 docs/data·raw 뿐).
    method: "repeat-sales-2026-10 DESIGN.md 5-1 (개정 2), repeat_index_v0.py",
    registered: { window: REGISTERED.window.join("-"), input: REGISTERED.input, out: "repeat_index_v0.out" },
    saleTree: treeId(files),
    saleFiles: files.length,
    rone: RONE_SOURCE,
    roneBlob: blobId(roneData).toString("hex"),
    roneLatest: String(roneLatest),
    seeds: { boot: BOOT_SEED, jitter: JITTER_SEED, prng: "python random.Random (MT19937)" },
  });
}

function parseWindow(argv: string[]) {
  const arg = argv.find((a) => a.startsWith("--window="));
  if (!arg) return undefined;
  const m = /^--window=(\d{6})-(\d{6})$/.exec(arg);
  if (!m) throw new Error(`--window 은 YYYYMM-YYYYMM 모양이다: ${arg}`);
  return [m[1], m[2]] as [string, string];
}

/** 계산하고 금지어를 본 뒤 임시 이름에 써서 rename. 실패하면 던진다(임시 파일은 지운다). */
async function writeOnce({ window = undefined, file = outFile, ...opts } = {}) {
  const data = await build({ ...opts, ...(window ? { window } : {}) });
  const text = `${JSON.stringify(data)}\n`;
  const hits = FORBIDDEN.filter((w) => text.includes(w));
  if (hits.length) throw new Error(`금지어가 출력에 있다: ${hits.join(", ")}`);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, text);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  const c = data.checks;
  return (
    `  같은 집 쌍: 창 ${data.window.from}~${data.window.to}, 서울 ${data.seoul?.n ?? 0}쌍, 값을 낸 구 ${c.published}/25, ` +
    `킬 스위치 ${c.kill ? "발동" : "미발동"}(스피어만 ${c.rho}), ${Buffer.byteLength(text)}B`
  );
}

/**
 * 소프트 실패 진입점(build-district-change.ts 가 부른다). 던지지 않는다 - 무엇이 잘못돼도 ::warning 을 찍고 어제 파일을 둔다.
 * 돌려주는 값: { ok, warning } (시험·로그용).
 */
export async function runRepeatSales({ log = console.log, ...opts }: { log?: (m: string) => void; rawDir?: string; roneFile?: string; window?: [string, string]; file?: string } = {}) {
  try {
    log(await writeOnce(opts));
    return { ok: true, warning: null };
  } catch (err) {
    const warning = `::warning::같은 집 쌍 데이터: ${err?.message ?? err} - 어제 파일을 그대로 둡니다`;
    log(warning);
    return { ok: false, warning };
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  writeOnce({ window: parseWindow(process.argv.slice(2)) })
    .then((line) => console.log(line))
    .catch((err) => {
      console.error(`같은 집 쌍 빌드 실패: ${err.message}`);
      process.exit(1);
    });
}
