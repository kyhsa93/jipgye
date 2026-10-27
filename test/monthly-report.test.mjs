import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ATTRIBUTION_LINE, CONTACT_LINE, INPUT_FILES, MIN_CELL, TAG_PREFIX, TITLE_PREFIX,
  buildReport, buildTables, cell, isBlank, isSuppressed, label, loadInputs, na, renderBody, renderCsv, renderTable, renderTitle, reportMonth,
} from "../scripts/monthly-report.ts";
import { ATTRIBUTION } from "../scripts/source-lines.ts";

// #771: 월간 집계 리포트 Release 산출. 값에 따라 갈리는 검사는 두지 않는다(#8) - 결정성·비움 규칙·구조·금지어·워크플로 모양만 본다.
// 입력은 저장소의 docs/data(실제 집계값)다. 값을 고정하지 않고 「같은 입력 → 같은 출력」과 「n<3 칸은 비어 있다」를 모형(Cell.n)으로 확인한다.
const root = path.resolve(import.meta.dirname, "..");
const DATA = path.join(root, "docs/data");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const wf = await read(".github/workflows/monthly-report.yml");
const daily = await read(".github/workflows/daily-update.yml");
const updateAll = await read("scripts/update-all.mjs");
const src = await read("scripts/monthly-report.ts");
const inputs = await loadInputs(DATA);
const month = reportMonth(inputs);
const tag = `${TAG_PREFIX}${month}`;
const body = renderBody(inputs, { month, tag });
const tables = buildTables(inputs);

/** docs/data 의 사본을 임시 폴더에 만들고 mutate(파일이름, json)으로 고친다. 리포트가 읽는 파일만 복사한다. */
async function dataCopy(mutate = () => {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "mr-data-"));
  for (const name of INPUT_FILES) {
    const json = JSON.parse(await readFile(path.join(DATA, name), "utf8"));
    mutate(name, json);
    await writeFile(path.join(dir, name), JSON.stringify(json));
  }
  return dir;
}

// ---- 결정성 ----

test("같은 입력이면 본문·CSV·태그·제목이 바이트까지 같다(두 번 만들고 사본 폴더에서도 만든다)", async () => {
  const dirs = [await mkdtemp(path.join(tmpdir(), "mr-a-")), await mkdtemp(path.join(tmpdir(), "mr-b-")), await mkdtemp(path.join(tmpdir(), "mr-c-"))];
  const copy = await dataCopy();
  const a = await buildReport({ dataDir: DATA, outDir: dirs[0] });
  const b = await buildReport({ dataDir: DATA, outDir: dirs[1] });
  const c = await buildReport({ dataDir: copy, outDir: dirs[2] });
  assert.equal(a.tag, b.tag);
  assert.equal(a.tag, c.tag);
  assert.deepEqual(a.files, b.files);
  assert.deepEqual(a.files, c.files);
  for (const f of [...a.files, "tag.txt", "title.txt"]) {
    const [x, y, z] = await Promise.all(dirs.map((d) => readFile(path.join(d, f), "utf8")));
    assert.equal(x, y, `${f}: 두 번 만든 결과가 다르다`);
    assert.equal(x, z, `${f}: 사본 폴더 입력의 결과가 다르다`);
  }
  // 시계·난수에 기대지 않는다 - 소스에 Date.now·Math.random·new Date() 가 없다.
  assert.doesNotMatch(src, /Date\.now\(|Math\.random\(|new Date\(/);
});

test("호 번호는 week-digest.json asOf 의 달이고 MONTHLY_REPORT_MONTH 로 덮어쓸 수 있으며, 모양이 틀리면 던진다", () => {
  assert.equal(month, String(inputs["week-digest.json"].asOf).slice(0, 7));
  assert.match(month, /^\d{4}-\d{2}$/);
  assert.equal(reportMonth(inputs, "2026-11"), "2026-11");
  assert.throws(() => reportMonth(inputs, "202611"), /호 번호를 정하지 못했다/);
  assert.throws(() => reportMonth({ "week-digest.json": {} }), /호 번호를 정하지 못했다/);
  assert.equal(renderTitle(month), `${TITLE_PREFIX} ${month}`);
  assert.match(tag, /^monthly-report-\d{4}-\d{2}$/);
});

// ---- 비움 규칙(n<3) ----

test("칸 모형: n<3 이면 비고, 값 자체가 건수인 칸은 그 건수가 n 이며, 글자·해당 없음 칸은 비움으로 세지 않는다", () => {
  assert.equal(MIN_CELL, 3);
  assert.ok(isBlank(cell(12.5, 2)) && isSuppressed(cell(12.5, 2)));
  assert.ok(!isBlank(cell(12.5, 3)));
  assert.ok(isBlank(cell(2)) && !isBlank(cell(3)) && isBlank(cell(0)));
  assert.ok(isBlank(cell(null, 100)) && isBlank(cell(undefined, 100)) && isBlank(cell(7, null)));
  // 사이트 문턱(min)이 MIN_CELL 보다 크면 그 값으로 비운다.
  assert.ok(isBlank(cell(10, 4, 5)) && !isBlank(cell(10, 5, 5)));
  assert.ok(!isBlank(label("서울")) && !isSuppressed(label("")));
  assert.ok(isBlank(na()) && !isSuppressed(na()));
});

test("모든 표의 모든 칸: n<3(또는 그 표의 문턱) 이면 본문·CSV 에 비어 있고, 값이 있는 칸은 n 이 문턱 이상이다(실제 docs/data)", () => {
  let suppressed = 0;
  let shown = 0;
  for (const t of tables) {
    const md = renderTable(t).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| ---")).slice(1);
    const csv = renderCsv(t).split("\n").filter((l) => l && !l.startsWith("#")).slice(1);
    assert.equal(md.length, t.rows.length, `표${t.id} 본문 줄 수`);
    assert.equal(csv.length, t.rows.length, `표${t.id} CSV 줄 수`);
    t.rows.forEach((row, ri) => {
      const mdCells = md[ri].slice(2, -2).split(" | ");
      const csvCells = csv[ri].split(",");
      assert.equal(mdCells.length, t.columns.length, `표${t.id} ${ri}째 줄 칸 수`);
      row.forEach((c, ci) => {
        if (isBlank(c)) {
          assert.equal(mdCells[ci], "", `표${t.id} ${ri}째 줄 ${ci}째 칸이 비어야 한다`);
          if (isSuppressed(c)) suppressed += 1;
        } else {
          assert.notEqual(mdCells[ci], "", `표${t.id} ${ri}째 줄 ${ci}째 칸`);
          assert.ok(c.n >= Math.max(MIN_CELL, c.min ?? 0), `표${t.id} ${ri}째 줄 ${ci}째 칸 n=${c.n}`);
          shown += 1;
        }
      });
      // CSV 는 쉼표 없는 숫자라 칸 수가 열 수와 같다(글자 칸에 쉼표가 들어가면 따옴표로 감싸져 split 이 어긋나므로 그 줄은 건너뛴다).
      if (!csv[ri].includes('"')) assert.equal(csvCells.length, t.columns.length, `표${t.id} ${ri}째 줄 CSV 칸 수`);
    });
  }
  assert.ok(shown > 0, "값이 있는 칸이 하나도 없다");
  assert.ok(body.includes(`비웠다(이 호에서 ${suppressed}칸)`), "본문의 비움 칸 수가 모형과 다르다");
});

test("입력을 n<3 으로 바꾸면 그 칸이 비고 다른 칸은 그대로다(전환율 칸·전세→월세 구·주간 건수)", async () => {
  const dir = await dataCopy((name, j) => {
    if (name === "conversion.json") j.cells[0].pairs = 2;
    if (name === "rent-flow.json") j.districts["종로구"].compare.recent.n = 2;
    if (name === "week-digest.json") j.current.cancelDated = 2;
  });
  const mutated = buildTables(await loadInputs(dir));
  const conv = mutated.find((t) => t.id === 4);
  const target = inputs["conversion.json"].cells[0];
  const row = conv.rows.find((r) => r[0].v === target.district);
  const bandIdx = inputs["conversion.json"].bands.findIndex((b) => b.key === target.band);
  assert.ok(isBlank(row[1 + bandIdx * 2]) && isBlank(row[2 + bandIdx * 2]), "조합 2개짜리 전환율 칸이 비지 않았다");
  const original = tables.find((t) => t.id === 4).rows.find((r) => r[0].v === target.district);
  assert.ok(!isBlank(original[1 + bandIdx * 2]), "원본에서는 값이 있어야 비교가 뜻이 있다");

  const flow = mutated.find((t) => t.id === 6).rows.find((r) => r[0].v === "종로구");
  assert.ok(isBlank(flow[6]) && isBlank(flow[7]), "n=2 인 구의 최근 n·월세 비중이 비지 않았다");
  assert.ok(!isBlank(flow[1]), "기준 구간 칸까지 비웠다");

  const week = mutated.find((t) => t.id === 1).rows.find((r) => r[0].v === "해제일이 그 주인 해제(건)");
  assert.ok(isBlank(week[2]) && !isBlank(week[1]));
});

// ---- 구조: 표5 없음·출처 문구·표 머리 ----

test("표5(monthly-cost, ECOS)는 읽지도 싣지도 않는다 - 표 번호 5가 비어 있고 소스가 그 파일을 열지 않는다", () => {
  assert.deepEqual(tables.map((t) => t.id), [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  assert.ok(!INPUT_FILES.includes("monthly-cost.json"));
  assert.doesNotMatch(src, /monthly-cost\.json"|readFile\([^)]*monthly-cost/);
  assert.match(body, /^#### 표5\. \(이 호에 없음\)$/m);
  // ECOS 금리 값(conversion.json 의 loan·deposit)도 싣지 않는다.
  assert.doesNotMatch(src, /\.loan\.rate|\.deposit\.rate|loan\?\.rate|deposit\?\.rate/);
  for (const t of tables) for (const col of t.columns) assert.doesNotMatch(col, /금리|실부담/);
});

test("모든 표 하단에 출처 문구가 있고 그 글자는 source-lines.ts 상수와 같다 - 본문·CSV 양쪽", () => {
  assert.equal(ATTRIBUTION_LINE, ATTRIBUTION.monthlyReport.ko);
  assert.equal(ATTRIBUTION_LINE, "출처: 국토교통부 실거래가(공공데이터포털 API), 가공·집계: 집계");
  const occurrences = body.split(ATTRIBUTION_LINE).length - 1;
  assert.equal(occurrences, tables.length + 1, "표마다 한 번 + 맨 끝 한 번");
  for (const t of tables) {
    const md = renderTable(t);
    assert.ok(md.trimEnd().endsWith(ATTRIBUTION_LINE), `표${t.id} 본문 하단`);
    const csv = renderCsv(t).trimEnd().split("\n");
    assert.equal(csv.at(-1), `# ${ATTRIBUTION_LINE}`, `표${t.id} CSV 하단`);
    assert.equal(csv[1], `# ${t.window}`, `표${t.id} CSV 머리`);
  }
  // 출처 머리 글자는 스크립트에 직접 적지 않는다(test/source-lines.test.mjs 와 같은 규칙).
  assert.doesNotMatch(src, /출처:|(^|[^A-Za-z0-9])Sources?:/);
  assert.match(src, /from "\.\/source-lines\.ts"/);
});

test("표마다 머리에 「비교 구간 …(…)」 한 줄이 있고 구간은 JSON 필드로 찍는다(pm) - 날짜 모양과 문턱 표기", () => {
  for (const t of tables) {
    assert.match(t.window, /^비교 구간 .+\(.+\)$/, `표${t.id}: ${t.window}`);
    assert.match(t.window, /\d{4}-\d{2}/, `표${t.id}: 연-월이 없다`);
    assert.match(t.window, /문턱/, `표${t.id}: 문턱 표기가 없다`);
    assert.ok(renderTable(t).includes(`\n${t.window}\n`), `표${t.id} 본문에 머리가 없다`);
  }
  const s = inputs["segment-change.json"];
  const ym = (x) => `${x.slice(0, 4)}-${x.slice(4)}`;
  assert.ok(tables.find((t) => t.id === 3).window.includes(`${ym(s.periods.base[0])}~${ym(s.periods.base.at(-1))} vs ${ym(s.periods.recent[0])}~${ym(s.periods.recent.at(-1))}`));
  assert.ok(tables.find((t) => t.id === 3).window.includes(`minCells ${s.minCells}`));
  const r = inputs["record-high.json"];
  assert.ok(tables.find((t) => t.id === 10).window.includes(`prior ${r.main.prior} · span ${r.main.span}일 · wait ${r.main.wait}일 · 자치구·가격대 minWithNext ${r.breakdown.minWithNext}`));
  const w = inputs["week-digest.json"];
  assert.ok(tables.find((t) => t.id === 1).window.includes(`comparable ${w.comparable}`));
});

// ---- 금지어·단위 ----

const ROW_FIELDS = ["aptNm", "jibun", "umdNm", "aptDong", "dealAmount", "excluUseAr", "rgstDate", "sggCd", "buyerGbn", "slerGbn", "estateAgentSggNm", "cdealType", "cdealDay", "dealDay", "buildYear", "dealingGbn"];
// 「보증」은 보증금(월세·전세의 돈)이 아닌 보증·후원 표현만 막는다.
const BANNED = [/국토부 공인/, /공인/, /인증/, /보증(?!금)/, /후원/, /호갱노노/, /아실/, /직방/, /네이버/, /경쟁/, /유일/, /최초/, /가장 정확/, /추천/, /투자하/, /매수 추천/, /사세요/, /팔아/, /유망/];

test("본문·CSV·제목에 행 단위 필드 이름, '국토부 공인' 류, 경쟁사 비교, 권유 문장이 없고 단지 이름 열이 없다", () => {
  const texts = [body, renderTitle(month), ...tables.map(renderCsv)];
  for (const text of texts) {
    for (const f of ROW_FIELDS) assert.ok(!text.includes(f), `행 필드 이름 ${f}`);
    for (const re of BANNED) assert.doesNotMatch(text, re, `금지어 ${re}`);
  }
  for (const t of tables) for (const col of t.columns) assert.doesNotMatch(col, /단지|지번|동$|층수|호수/, `표${t.id} 열 ${col}`);
  // 단위 열의 글자는 서울·자치구·가격대·연식·면적대·권역·설정 뿐이다 - 단지 카드 JSON 은 읽지 않는다.
  assert.ok(!INPUT_FILES.some((f) => /^complex-|^deals-|^rents-|^renewal-cells-/.test(f)));
});

test("7절은 「3개월 전망 채점 기록(C5)」이고 'vs 실측' 열이 없으며, 8절 「범위 적중률(C6) 예고」에는 적중률 숫자가 없다(E5 researcher)", () => {
  assert.match(body, /^## 7\. 3개월 전망 채점 기록\(C5\)$/m);
  assert.match(body, /^## 8\. 범위 적중률\(C6\) 예고$/m);
  const t11 = tables.find((t) => t.id === 11);
  assert.ok(t11.title.startsWith("3개월 전망 채점 기록(C5)"));
  for (const col of t11.columns) assert.doesNotMatch(col, /실측|vs/);
  assert.doesNotMatch(body, /vs 실측|성적표/);
  // 「적중률」 뒤에 숫자·%가 붙은 문장이 없다(숫자 없는 예고만).
  const section8 = body.split("## 8. 범위 적중률(C6) 예고")[1].split("\n## ")[0];
  assert.doesNotMatch(section8, /적중률[^\n]*\d+(\.\d+)?\s*%/);
  assert.doesNotMatch(section8, /적중률 \d/);
  assert.match(section8, /2027-01/);
  assert.match(section8, /PREREG\.md/);
  assert.equal((body.match(/적중률/g) || []).length, (section8.match(/적중률/g) || []).length + 1, "「적중률」은 8절 제목과 8절 본문에만 있다");
  const log = inputs["outlook-log.json"];
  assert.equal(t11.rows.length, log.entries.length);
  assert.ok(section8.includes(`등록 전망 ${log.entries.length}건`));
});

test("문의 안내 한 줄이 본문 머리·끝에 있고 Discussions 를 가리키며 연락처를 적지 말라고 한다", () => {
  assert.ok(CONTACT_LINE.includes("https://github.com/kyhsa93/jipgye/discussions"));
  assert.match(CONTACT_LINE, /연락처는 쓰지 말고 소속·용도만/);
  assert.equal(body.split(CONTACT_LINE).length - 1, 2);
  assert.match(body, /^## 문의$/m);
});

// ---- method.html: Release 링크 1줄 + 문의 1줄(한·영), 새 페이지 없음 ----

test("method.html 에 Release 링크와 Discussions 문의 안내가 한·영 각 한 줄씩 있고 출처 머리 글자는 없다", async () => {
  const html = await read("docs/method.html");
  const release = [...html.matchAll(/https:\/\/github\.com\/kyhsa93\/jipgye\/releases\/tag\/monthly-report-\d{4}-\d{2}/g)];
  assert.equal(release.length, 2, "Release 링크는 한·영 각 1");
  const discussions = [...html.matchAll(/https:\/\/github\.com\/kyhsa93\/jipgye\/discussions"/g)];
  assert.equal(discussions.length, 2, "Discussions 링크는 한·영 각 1");
  assert.match(html, /연락처는 쓰지 말고 소속·용도만/);
  assert.match(html, /not contact details/);
  assert.doesNotMatch(html, /출처:/);
  // 새 페이지 없음: docs/ 에 리포트용 HTML 이 없다.
  const pages = (await readdir(path.join(root, "docs"))).filter((f) => /report|monthly/i.test(f));
  assert.deepEqual(pages, []);
});

// ---- 워크플로 ----

test("워크플로: dispatch + 월 1회 cron이고 다른 워크플로와 같은 분에 돌지 않는다", async () => {
  assert.match(wf, /^on:\n  schedule:\n    - cron: "\d+ \d+ \d+ \* \*"\n  workflow_dispatch:/m);
  const cron = wf.match(/cron: "(\d+) (\d+) (\d+) \* \*"/);
  assert.ok(cron, "월 1회(일 필드 고정) cron이어야 한다");
  const others = ["daily-update.yml", "official-price-api.yml", "correction-release.yml", "schedule-watchdog.yml"];
  const taken = [];
  for (const f of others) taken.push(...[...(await read(`.github/workflows/${f}`)).matchAll(/cron: "(\d+) (\d+) /g)].map((m) => `${m[1]} ${m[2]}`));
  assert.ok(!taken.includes(`${cron[1]} ${cron[2]}`), "다른 워크플로와 같은 시각이다");
  assert.ok(wf.includes(`매월 ${cron[3]}일`), "주석의 날이 cron과 같아야 한다");
});

test("워크플로: permissions는 contents: write 하나, 액션은 기존 SHA 고정, 시크릿 없음, 별도 concurrency, 입력은 env", async () => {
  assert.match(wf, /^permissions:\n  contents: write\n(?!  )/m);
  assert.equal((wf.match(/permissions:/g) || []).length, 1);
  const known = new Set([...(await read(".github/workflows/correction-release.yml")).matchAll(/uses: (\S+)/g)].map((m) => m[1]));
  for (const m of wf.matchAll(/uses: (\S+)/g)) {
    assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
    assert.ok(known.has(m[1]), `기존 워크플로에 없는 액션/SHA: ${m[1]}`);
  }
  assert.doesNotMatch(wf, /secrets\.(?!GITHUB_TOKEN)/);
  assert.match(wf, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(wf, /concurrency:\n  group: monthly-report\n  cancel-in-progress: false/);
  const code = wf.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(code, /digest-pipeline/);
  for (const block of wf.split(/\n\s+run: /).slice(1)) {
    const run = block.split(/\n      - /)[0];
    assert.doesNotMatch(run, /\$\{\{/, `run 블록에 직접 보간: ${run.slice(0, 80)}`);
  }
  assert.match(wf, /MONTHLY_REPORT_OUT_DIR: /);
  assert.match(wf, /MONTHLY_REPORT_DATA_DIR: /);
  assert.doesNotMatch(wf, /raw\/(sale|rent)/, "원본 raw 는 받지 않는다");
});

test("워크플로: 일일 파이프라인·update-all 에 없고, 같은 호가 있으면 건너뛰며, gh release create 로 본문과 CSV 를 올린다", () => {
  assert.doesNotMatch(daily, /monthly-report/);
  assert.doesNotMatch(updateAll, /monthly-report/);
  assert.match(wf, /gh release view "\$tag"/);
  // --latest=false: method.html 의 해제 집계 링크(/releases/latest, #226)를 월간호가 가로채지 않게.
  assert.match(wf, /gh release create "\$tag" --target "\$GITHUB_SHA" --latest=false --title "\$\(cat "\$out\/title\.txt"\)" --notes-file "\$out\/\$tag\.md"/);
  assert.match(wf, /"\$out"\/"\$tag"-table-\*\.csv/);
  assert.match(wf, /release not found/);
  assert.doesNotMatch(wf.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n"), /\|\|\s*true/);
});

/** 이름으로 찾은 단계의 run 블록(YAML 들여쓰기 10칸을 걷어 낸 bash 본문). */
function stepRun(name) {
  const lines = wf.split("\n");
  const i = lines.findIndex((l) => l.trimEnd() === `      - name: ${name}`);
  assert.ok(i >= 0, `단계가 없다: ${name}`);
  const r = lines.findIndex((l, j) => j > i && l === "        run: |");
  assert.ok(r > i, `run 블록이 없다: ${name}`);
  const out = [];
  for (let j = r + 1; j < lines.length && (lines[j] === "" || lines[j].startsWith("          ")); j++) out.push(lines[j].slice(10));
  return out.join("\n");
}

// 가짜 gh: release view 는 FAKE 폴더의 표식으로 「있다」(exists-<tag>)·「없다」(release not found)·「못 읽었다」(view-fails) 를 낸다.
const FAKE_GH = `#!/bin/bash
echo "$*" >> "$FAKE_GH_LOG"
d="$FAKE_GH_DIR"
case "$1 $2" in
  "release view")
    if [ -e "$d/view-fails" ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi
    if [ -e "$d/exists-$3" ]; then exit 0; fi
    echo "release not found" >&2; exit 1 ;;
  "release create") exit 0 ;;
  *) echo "예상 밖의 gh 호출: $*" >&2; exit 99 ;;
esac
`;

async function scenario({ exists = [], viewFails = false } = {}) {
  const base = await mkdtemp(path.join(tmpdir(), "mr-wf-"));
  const out = path.join(base, "out");
  const fake = path.join(base, "fake");
  const bin = path.join(base, "bin");
  const runnerTemp = path.join(base, "tmp");
  for (const d of [fake, bin, runnerTemp]) await mkdir(d, { recursive: true });
  const built = await buildReport({ dataDir: DATA, outDir: out });
  await writeFile(path.join(bin, "gh"), FAKE_GH);
  await chmod(path.join(bin, "gh"), 0o755);
  for (const t of exists) await writeFile(path.join(fake, `exists-${t}`), "");
  if (viewFails) await writeFile(path.join(fake, "view-fails"), "");
  const log = path.join(fake, "gh.log");
  await writeFile(log, "");
  const run = (name) =>
    spawnSync("bash", ["-c", stepRun(name)], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, RUNNER_TEMP: runnerTemp, MONTHLY_REPORT_OUT_DIR: out, GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567", FAKE_GH_DIR: fake, FAKE_GH_LOG: log },
    });
  const calls = async () => (await readFile(log, "utf8")).split("\n").filter(Boolean);
  return { built, out, run, calls };
}

const UPLOAD = "Release 올리기 (같은 호가 있으면 건너뜀)";

test("buildRelease 한 바퀴: 본문 .md·표별 CSV·tag.txt·title.txt 가 나오고 파일 수가 표 수와 맞는다", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "mr-out-"));
  const r = await buildReport({ dataDir: DATA, outDir });
  const names = (await readdir(outDir)).sort();
  assert.deepEqual(names, [...r.files, "tag.txt", "title.txt"].sort());
  assert.equal(names.filter((n) => n.endsWith(".csv")).length, r.tables.length);
  assert.equal(await readFile(path.join(outDir, "tag.txt"), "utf8"), `${r.tag}\n`);
  assert.equal(await readFile(path.join(outDir, "title.txt"), "utf8"), `${renderTitle(r.month)}\n`);
  assert.equal(await readFile(path.join(outDir, `${r.tag}.md`), "utf8"), body);
});

test("워크플로 올리기 단계: 없으면 올리고(--target·본문·CSV 전부), 있으면 건너뛰고, 못 읽으면 실패한다(가짜 gh)", async () => {
  const fresh = await scenario();
  const r1 = fresh.run(UPLOAD);
  assert.equal(r1.status, 0, r1.stderr);
  const creates = (await fresh.calls()).filter((c) => c.startsWith("release create"));
  assert.equal(creates.length, 1);
  assert.ok(creates[0].startsWith(`release create ${fresh.built.tag} --target 0123456789abcdef0123456789abcdef01234567 --latest=false --title ${renderTitle(fresh.built.month)} --notes-file `), creates[0]);
  for (const f of fresh.built.files) assert.ok(creates[0].includes(`/${f}`), `자산 ${f}`);

  const exists = await scenario({ exists: [fresh.built.tag] });
  const r2 = exists.run(UPLOAD);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /이미 있다/);
  assert.deepEqual((await exists.calls()).filter((c) => c.startsWith("release create")), []);

  const failing = await scenario({ viewFails: true });
  const r3 = failing.run(UPLOAD);
  assert.notEqual(r3.status, 0, "못 읽었는데 성공으로 끝났다");
  assert.match(r3.stderr, /읽지 못했다/);
  assert.deepEqual((await failing.calls()).filter((c) => c.startsWith("release create")), []);
});

test("산출물 폴더는 커밋 대상이 아니다 - 스크립트는 저장소 안에 기본 산출 경로를 두지 않고 env 로만 받는다", () => {
  assert.match(src, /MONTHLY_REPORT_OUT_DIR\(산출 폴더\)가 필요하다/);
  assert.doesNotMatch(src, /path\.join\(root, "(dist|out|build)/);
  // 사이트와 같은 상수를 쓴다(문턱 이중 정의 없음).
  for (const name of ["DISTRICTS", "REGIONS", "TREND_MIN_SAMPLE", "MIN_CELLS"]) assert.match(src, new RegExp(`\\b${name}\\b`));
});

test("relative-import 와 tsc 대상: 스크립트가 tools/typescript/tsconfig.json include 에 있다", async () => {
  const tsconfig = JSON.parse(await read("tools/typescript/tsconfig.json"));
  assert.ok(tsconfig.include.includes("../../scripts/monthly-report.ts"));
});
