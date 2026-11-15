// #882(#175 제한 2·3): Release 두 생성기의 원천 사본 안내와 raw/README.md.
// 문구는 legal #882 판정(issuecomment-6890669399) 2절 원문이다. 상수(scripts/source-lines.ts RAW_COPY_NOTE)를 거치지 않고 여기 글자로 다시 적어,
// 상수가 legal 판정 없이 바뀌면 이 시험이 문다. 값(칸 수 등)에 따라 갈리는 검사는 두지 않는다(#8) - 숫자 자리는 \d+ 로 받는다.
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFigures, readSales, renderBody as renderCorrection } from "../scripts/build-correction-release.ts";
import { TAG_PREFIX, loadInputs, renderBody as renderMonthly, reportMonth } from "../scripts/monthly-report.ts";
import { readSameNames, readSlots } from "../scripts/realestate-raw.ts";
import { HOLDS_FILE, writeHolds } from "../scripts/realestate-guard.ts";

const root = path.resolve(import.meta.dirname, "..");
const FIXTURE_RAW = path.join(root, "test/fixtures/correction-twins/raw");

const LEGAL = {
  ko: "이 Release의 본문과 첨부는 집계만 담습니다. 행 단위 기록·단지·지번·법정동·층·금액은 이 Release에 없습니다. 원천(국토교통부 실거래 자료)의 행 단위 사본은 저장소 [`raw/`](https://github.com/kyhsa93/jipgye/tree/main/raw)에 수집한 때의 원천 응답 그대로(수집 시각 같은 수집 기록만 더해) 있습니다. 출처·이용허락·정정 요청 경로는 `raw/README.md`에 있습니다.",
  koPlain: "이 Release 의 본문과 첨부는 집계만 담는다. 행·단지 단위 값은 이 Release 에 없다. 원천(국토교통부 실거래 자료)의 행 단위 사본은 저장소 [`raw/`](https://github.com/kyhsa93/jipgye/tree/main/raw)에 수집한 때의 원천 응답 그대로(수집 시각 같은 수집 기록만 더해) 있다. 출처·이용허락·정정 요청 경로는 `raw/README.md` 에 있다.",
  en: "This release's text and attachments contain aggregates only; no record-level data, complex names, lot numbers, neighbourhoods, floors or amounts are included in this release. Record-level copies of the source data (MOLIT real transaction filings) are kept in the repository's [`raw/`](https://github.com/kyhsa93/jipgye/tree/main/raw) folder as the source returned them at collection time, with only collection records such as timestamps added. Sources, licence terms and how to request corrections are in `raw/README.md`.",
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("정정 Release 본문: 절 제목 「집계 단위와 비운 칸」, 칸 비움 글머리 바로 다음 줄이 legal 원천 사본 안내(ko·en), 지운 문장은 없다 (#882)", async () => {
  const body = renderCorrection(buildFigures(await readSales(FIXTURE_RAW)));
  const [ko, en] = body.split("\n---\n");
  assert.match(ko, /^## 집계 단위와 비운 칸$/m);
  assert.doesNotMatch(ko, /집계 단위와 비공개/);
  assert.match(ko, new RegExp(`이 Release에서 \\d+칸\\)\\. [^\\n]*이는 작은 표본의 비율이 눈에 띄지 않게 하려는 기준입니다\\.\\n- ${esc(LEGAL.ko)}\\n- 최근 계약월은`));
  assert.doesNotMatch(ko, /금액은 담지 않았습니다/);
  assert.match(en, /^## Units and withheld cells$/m);
  assert.match(en, new RegExp(`from standing out\\.\\n- ${esc(LEGAL.en)}\\n- Recent contract months`));
  assert.equal(en.split("No record-level data").length, 1, "en 의 지운 문장");
});

test("월간 리포트 본문: 단위 글머리에서 「행·단지 단위 값은 없다.」를 지우고 바로 다음 줄이 legal 원천 사본 안내(koPlain) (#882)", async () => {
  const inputs = await loadInputs(path.join(root, "docs/data"));
  const month = reportMonth(inputs);
  const body = renderMonthly(inputs, { month, tag: `${TAG_PREFIX}${month}` });
  assert.match(body, new RegExp(`\\n- 단위는 서울 전체·자치구·가격대·연식·면적대·권역이다\\. 표본이 [^\\n]*\\(이 호에서 \\d+칸\\)\\.\\n- ${esc(LEGAL.koPlain)}\\n- 입력: `));
  assert.equal(body.split("행·단지 단위 값은 없다").length, 1, "지운 문장");
  assert.equal(body.split(LEGAL.koPlain).length, 2, "안내는 한 번");
});

test("raw/ 맨 위의 README.md 는 슬롯 읽기(readSlots·readSameNames·readSales)에 잡히지 않는다 - 읽는 쪽은 raw/<종류>/ 만 돈다 (#882 완료 조건 3)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "raw-readme-"));
  try {
    await cp(FIXTURE_RAW, dir, { recursive: true });
    const before = [await readSlots(dir), await readSameNames(dir), buildFigures(await readSales(dir))];
    await writeFile(path.join(dir, "README.md"), await readFile(path.join(root, "raw/README.md"), "utf8"));
    const after = [await readSlots(dir), await readSameNames(dir), buildFigures(await readSales(dir))];
    assert.deepEqual(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("raw/ 맨 위의 realestate-holds.json(보류 상태)도 슬롯 읽기(readSlots·readSameNames·readSales)에 잡히지 않는다 (#894 할 일 3)", async () => {
  // README.md 와 달리 이 파일은 수집기가 raw/ 맨 위에 쓰고(scripts/realestate-guard.ts writeHolds) 다시 읽는다. 슬롯 읽기만 raw/<종류>/ 를 돈다.
  // 보류 키는 픽스처에 있는 슬롯이다 - 보류 중에도 슬롯 파일은 이전 판 그대로 읽힌다(raw/README.md #894 단락).
  const dir = await mkdtemp(path.join(tmpdir(), "raw-holds-"));
  try {
    await cp(FIXTURE_RAW, dir, { recursive: true });
    const before = [await readSlots(dir), await readSameNames(dir), buildFigures(await readSales(dir))];
    const entry = { days: ["2026-11-01"], reason: "half", saved: 390, received: 77 };
    assert.equal(await writeHolds({ "sale:11110:202604": entry }, dir), true);
    assert.match(await readFile(path.join(dir, HOLDS_FILE), "utf8"), /"sale:11110:202604"/, "보류 파일이 raw/ 맨 위에 있다");
    const after = [await readSlots(dir), await readSameNames(dir), buildFigures(await readSales(dir))];
    assert.deepEqual(after, before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
