import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISTRICTS } from "./realestate-districts.ts";
import { readSameNames, readSlotFile } from "./realestate-raw.ts";
import { buildReverseJeonse, windowMonthsOf, windowsOf } from "./reverse-jeonse.ts";

/**
 * 2년 전 계약 보증금 대 지금 신규 전세 데이터(#693 N11): docs/data/reverse-jeonse.json 하나(구 집계만, 단지명·칸 키·건별 값 없음).
 *
 * 등록: update-all.mjs·daily-update.yml 에 줄을 두지 않고 build-complex-ratio.ts 의 main 에서 runRenewalCells 바로 다음에 불린다
 * (cto 착수 조건 7, #693 본문 「파일」 채택). 같은 원본(raw/rent)과 같은 상수를 쓰는 단계이고, build-conversion.ts 는 신고 0건·지표 없음·
 * ECOS 금리 없음에서 일찍 돌아가 금리 수집 공백이 이 파일 갱신을 조용히 멈추기 때문이다.
 * 읽기는 자기 것으로 한다(readSlotFile·readSameNames, DISTRICTS·달 고정 순서) - build-complex-ratio 의 readRaw 는 매매 쪽이 #900 에서 바뀔 자리다.
 * 소프트 실패: 던지지 않는다. 읽기 실패를 포함한 모든 예외는 ::warning 한 줄로 알리고 어제 파일을 그대로 둔다.
 * 파일은 임시 이름에 쓴 뒤 rename 한다 - 중간에 죽어도 반쯤 쓴 파일이 남지 않는다.
 *
 * json rows(창별 줄 수)는 매달 KST 1~3일과 달이 바뀌는 날에만 바뀐다 - 지금 창(M−4~M−2)의 끝 달 M−2 는 refreshMonths
 * (realestate-slots.ts)가 KST 1~3일에만 다시 받고, 2년 전 창의 달은 다시 받지 않는다(planFetch 가 빈 슬롯을 메우는 날은 예외).
 */

const root = path.resolve(import.meta.dirname, "..");
const outFile = process.env.REVERSE_JEONSE_FILE
  ? path.resolve(process.env.REVERSE_JEONSE_FILE)
  : path.join(root, "docs/data/reverse-jeonse.json");

/** 파일 한도. 26행 구 집계라 2KB 안팎이다(jeonse-risk 와 같은 값) - 넘으면 칸 이름 같은 것이 새어 들어온 것으로 보고 쓰지 않는다. */
export const MAX_FILE_BYTES = 8 * 1024;

const usable = (file) => file && file.ok !== false && Array.isArray(file.items);

/**
 * 구별 여섯 슬롯(2년 전 셋·지금 셋)을 읽는다. 읽기는 동시에, 합치기는 DISTRICTS·달 고정 순서다(#572 - 완료 순서가 출력 순서가 되지 않게).
 * 한 슬롯이라도 없거나 ok:false 면 그 구는 missing. 어느 달이 25구 모두에서 비면(쓸 슬롯이 없거나 줄이 0) 던진다 - 부르는 쪽이 경고로 바꾸고 어제 파일을 둔다.
 */
export async function readDistricts(months: string[], { rawDir = undefined, read = readSlotFile, readSame = readSameNames } = {}) {
  const sameByCode = await readSame(rawDir);
  const files = await Promise.all(DISTRICTS.map(({ code }) => Promise.all(months.map((ym) => read("rent", code, ym, rawDir)))));
  months.forEach((ym, i) => {
    if (!files.some((row) => usable(row[i]) && row[i].items.length)) throw new Error(`${ym} 원본이 25구 모두에서 비어 있음`);
  });
  return DISTRICTS.map(({ code, name }, d) => {
    const slots = files[d];
    if (!slots.every(usable)) return { name, missing: true };
    return { name, items: slots.flatMap((file) => file.items), same: sameByCode?.[code] };
  });
}

/** 본문을 임시 이름에 쓰고 바꿔 단다. 한도를 넘으면 쓰지 않고 던진다. */
export async function writePayload(file: string, payload: object, maxBytes = MAX_FILE_BYTES) {
  const body = `${JSON.stringify(payload)}\n`;
  const bytes = Buffer.byteLength(body);
  if (bytes > maxBytes) throw new Error(`${bytes}B > ${maxBytes}B`);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(temp, body);
    await rename(temp, file);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
  return bytes;
}

/** 소프트 실패 진입점. 던지지 않는다 - 무엇이 잘못돼도 ::warning 을 찍고 null 을 돌려주며 어제 파일을 둔다. */
export async function runReverseJeonse({
  now = new Date(),
  file = outFile,
  rawDir = undefined,
  read = readSlotFile,
  readSame = readSameNames,
  maxBytes = MAX_FILE_BYTES,
  log = console.log,
} = {}) {
  const warn = (msg) => log(`::warning::2년 전 계약 대비 신규 전세 데이터: ${msg} - 어제 파일을 그대로 둡니다`);
  try {
    const windows = windowsOf(now);
    const districts = await readDistricts(windowMonthsOf(windows), { rawDir, read, readSame });
    const payload = buildReverseJeonse({ districts, now });
    if (!payload) {
      warn("칸이 없음");
      return null;
    }
    const bytes = await writePayload(file, payload, maxBytes);
    const { seoul, rows } = payload;
    const shown = Object.values<{ fellShare?: number }>(payload.districts).filter((row) => typeof row.fellShare === "number").length;
    log(
      `  2년 전 계약 대비 신규 전세: ${windows.base.join("~")} ↔ ${windows.now.join("~")} · 서울 ${seoul.cells}칸 중 낮은 칸 ${seoul.fellShare ?? "-"}% · 값이 나온 구 ${shown}/${DISTRICTS.length} · 줄 ${rows.base}/${rows.now} · ${bytes}B`
    );
    return payload;
  } catch (err) {
    warn(err?.message ?? String(err));
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runReverseJeonse();
}
