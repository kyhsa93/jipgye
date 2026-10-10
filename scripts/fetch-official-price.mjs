/**
 * 공시가격 CSV를 stdin으로 받아 칸으로 접어 raw/official-price/<기준연도>.json을 쓴다 (#68).
 *
 *   unzip -p 공시가격.zip '*.csv' | node scripts/fetch-official-price.mjs \
 *     --sha256 <페이지 기재값> --rows <헤더 제외 행수> --base-year 2025 \
 *     --license "제한 없음" --page-modified "<상세 페이지 수정일>" \
 *     --source-page https://www.data.go.kr/data/<번호>/fileData.do --raw-commit <40자리> [--raw-dir raw]
 *
 * 해시·행수·기준연도·이용허락 문자열은 코드에 없고 입력으로만 받는다(페이지 값을 사람이 옮긴다).
 * 어긋나면 아무것도 쓰지 않고 종료 코드 1. 원본 zip·CSV는 저장소 밖에 둔다(C1).
 * 대상 지번 = --raw-dir 의 sale·rent 원본에 한 번이라도 나온 서울 지번. --raw-dir은 #70 완료 커밋의
 * 체크아웃이어야 하고, 그 커밋 해시를 --raw-commit 으로 적어 메타에 남긴다.
 * zip 자체의 해시는 환경변수 ZIP_SHA256으로 받을 수 있다(페이지 기재값이 zip 해시일 때).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { foldStream } from "./official-price-fold.mjs";
import { parcelKeyOfDeal } from "./official-price-key.mjs";

/** raw/sale·raw/rent 슬롯 파일에서 지번 키 집합을 모은다. */
export async function targetParcels(rawDir) {
  const targets = new Set();
  for (const kind of ["sale", "rent"]) {
    let names;
    try { names = await readdir(path.join(rawDir, kind)); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
      const file = JSON.parse(await readFile(path.join(rawDir, kind, name), "utf8"));
      for (const item of file.items ?? []) {
        const key = parcelKeyOfDeal(item);
        if (key) targets.add(key);
      }
    }
  }
  return targets;
}

async function main() {
  const { values: v } = parseArgs({
    options: {
      sha256: { type: "string" }, rows: { type: "string" }, "base-year": { type: "string" },
      license: { type: "string" }, "page-modified": { type: "string", default: "" }, "source-page": { type: "string", default: "" },
      "raw-commit": { type: "string" }, "raw-dir": { type: "string", default: "raw" },
      "out-dir": { type: "string", default: "raw/official-price" },
    },
  });
  const input = {
    sha256: v.sha256, zipSha256: process.env.ZIP_SHA256 || undefined,
    rows: Number(v.rows), baseYear: Number(v["base-year"]), license: v.license,
    pageModified: v["page-modified"], sourcePage: v["source-page"], rawCommit: v["raw-commit"],
    targets: await targetParcels(v["raw-dir"]),
  };
  const out = await foldStream(process.stdin, input);
  await mkdir(v["out-dir"], { recursive: true });
  const file = path.join(v["out-dir"], `${input.baseYear}.json`);
  await writeFile(file, JSON.stringify(out) + "\n");
  const m = out.meta;
  console.log(`${file}: 칸 ${m.cells}(호 3 미만 ${m.cellsBelowMin}), 지번 ${m.parcels}/${m.targetParcels}, 서울 ${m.seoulRows}/${m.totalRows}행`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`공시가격 접기 실패(아무것도 쓰지 않음): ${e.message}`);
    process.exit(1);
  });
}
