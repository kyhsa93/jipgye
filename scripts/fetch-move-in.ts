import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 공동주택 입주예정물량(한국부동산원·부동산114, 공공데이터포털 파일데이터 15111714) - #60.
 *
 * 앞으로 2년 30세대 이상 공동주택의 입주 예정 추정치다. 반기마다 새 파일로 바뀐다(다음 예정 2027-02-26).
 * 키 없이 받는다: 데이터 화면에서 현재 파일의 상세 키(uddi)를 읽고, 다운로드 요청으로 첨부 파일 번호를
 * 받은 뒤 CSV를 내려받는다. 파일 이름의 날짜(_20260630)가 추정 기준 시점이다.
 *
 * 과거 기준 시점 파일이 없어 예측 모델에는 넣지 않는다(검증할 수 없다). 화면에 사실로만 싣는다.
 * 하나라도 실패하면 어제 파일을 그대로 둔다.
 */

const root = path.resolve(import.meta.dirname, "..");
export const MOVE_IN_DIR = process.env.MOVE_IN_DIR ? path.resolve(process.env.MOVE_IN_DIR) : path.join(root, "raw/move-in");
const PAGE = "https://www.data.go.kr/data/15111714/fileData.do";
const META_URL = "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do";
const FILE_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do";

export function detailKeyFrom(html) {
  return /fn_fileDataDown\('15111714',\s*'(uddi:[0-9a-f-]+)'/.exec(html ?? "")?.[1] ?? null;
}

export function basisFrom(name) {
  const m = /_(\d{4})(\d{2})(\d{2})\s*$/.exec(name ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export async function fetchMoveIn({ fetchImpl = fetch } = {}) {
  const page = await fetchImpl(PAGE);
  if (!page.ok) throw new Error(`화면 http ${page.status}`);
  const detail = detailKeyFrom(await page.text());
  if (!detail) throw new Error("파일 상세 키를 못 찾았다");

  const body = new URLSearchParams({ publicDataDetailPk: detail, publicDataPk: "15111714", atchFileId: "", fileDetailSn: "1", publicDataTyCode: "PR0051" });
  const metaRes = await fetchImpl(META_URL, { method: "POST", body });
  const meta = JSON.parse(await metaRes.text());
  if (!meta?.status || !meta.atchFileId) throw new Error("첨부 파일 번호를 못 받았다");
  const name = meta.dataSetFileDetailInfo?.dataNm ?? "";

  const file = await fetchImpl(`${FILE_URL}?atchFileId=${meta.atchFileId}&fileDetailSn=${meta.fileDetailSn ?? 1}&insertDataPrcus=N`);
  if (!file.ok) throw new Error(`파일 http ${file.status}`);
  const csv = new TextDecoder("utf-8").decode(await file.arrayBuffer()).replace(/^﻿/, "");
  if (!csv.startsWith("입주예정월,")) throw new Error("CSV 머리가 다르다 - 다른 파일을 받았다");
  return { csv, meta: { name, basis: basisFrom(name) } };
}

async function main() {
  try {
    const { csv, meta } = await fetchMoveIn();
    const csvFile = path.join(MOVE_IN_DIR, "move-in.csv");
    const before = await readFile(csvFile, "utf8").catch(() => null);
    await mkdir(MOVE_IN_DIR, { recursive: true });
    if (before !== csv) await writeFile(csvFile, csv);
    await writeFile(path.join(MOVE_IN_DIR, "meta.json"), `${JSON.stringify(meta)}\n`);
    console.log(`  입주예정물량: ${meta.name} (${csv.split("\n").length - 1}줄)${before === csv ? " 변경 없음" : " 갱신"}`);
  } catch (error) {
    console.error(`  입주예정물량 수집 실패(어제 파일로 간다): ${error.message}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
