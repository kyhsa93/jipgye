// 데이터 진척 감시(#657 V11): 고정 입력과 고정 시각으로만 돈다. 실제 docs/data·raw 나 시계를 읽지 않는다(#8 교훈).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ALERT_HOURS, BUSINESS_FAIL_DAYS, BUSINESS_WARN_DAYS, CHECK_HOURS, ISSUE_GROUPS, MONTHLY_LAG, NO_ISSUE_GROUPS, UPDATED_AT_EXCLUDED, builderAgeChecks, collectChecks, collectStatus, dateOf, groupOf, main, monthlyCheck,
  reportPayload, unregisteredDataFiles, weekdaysBetween,
} from "../scripts/check-data-progress.ts";
import { MAX_NEW_ISSUES, TITLE_PREFIX, listOpenIssueTitles, parseReport, planIssues, readMarker, runReport } from "../scripts/report-data-progress.ts";
import { ECOS_SERIES, RONE_SERIES } from "../scripts/fetch-indicators.ts";
import { DISTRICTS } from "../scripts/realestate-districts.ts";
import { shiftMonth } from "../scripts/realestate-slots.ts";

const root = path.resolve(import.meta.dirname, "..");
const months = (last, n) => Array.from({ length: n }, (_, i) => [shiftMonth(last, i - n + 1), 1]);

/** 시각 한 벌. 기본은 2026-10-26(월) 기준으로 모두 정상. */
const OCT = {
  month: "202610", newest: "2026-10-25T16:00:00Z", older: "2026-10-25T04:00:00Z", asOf: "10/23", fx: "2026-10-23", observedAt: "2026-10-25T23:30:00Z", updatedAt: "2026-10-25T23:30:00Z",
  progress: { lastProgressAt: "2026-10-25T21:00:00Z", zeroProgressRuns: 0, doneParcels: 2094, targetParcels: 6764 },
};
/** 원장을 재는 11월 초 사본: 원장 말고는 아무것도 안 울게 시각을 뒤 시각으로 둔다(공시가격은 수집 완료). */
const NOV = {
  month: "202611", newest: "2026-11-05T01:00:00Z", older: "2026-11-05T00:00:00Z", asOf: "2026-11-02", fx: "2026-11-02", observedAt: "2026-11-05T01:00:00Z", updatedAt: "2026-11-05T01:00:00Z",
  progress: { lastProgressAt: "2026-10-25T21:00:00Z", zeroProgressRuns: 0, doneParcels: 6764, targetParcels: 6764 },
};
const seriesOf = (month, over = {}) => ({ series: { ...Object.fromEntries(Object.entries(MONTHLY_LAG).map(([k, lag]) => [k, months(shiftMonth(month, -lag), 30)])), ...over } });

/** 모두 정상인 저장소 사본. over 로 파일 하나씩 바꾼다. */
function fixture(over = {}, base = OCT) {
  const dir = mkdtempSync(path.join(tmpdir(), "data-progress-"));
  const put = (rel, obj) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), JSON.stringify(obj));
  };
  const files = {
    "docs/data/news.json": { updatedAt: base.updatedAt, items: [{ publishedAt: base.newest }, { publishedAt: base.older }] },
    "docs/data/market.json": { updatedAt: base.updatedAt, kospi: { asOf: base.asOf }, usdKrw: { asOf: base.asOf }, usdKrwDaily: [["2026-10-22", 1], [base.fx, 1]] },
    "raw/indicators/series.json": seriesOf(base.month),
    "raw/indicators/rone-districts.json": { series: { 11110: months(shiftMonth(base.month, -1), 30), 11140: months(shiftMonth(base.month, -1), 30) } },
    "raw/ecos/apt-price-index.json": { series: { 200: months(shiftMonth(base.month, -3), 30) } },
    "raw/move-in/meta.json": { basis: "2026-06-30" },
    "raw/official-price/status/progress.json": base.progress,
    ...over,
  };
  for (const [rel, obj] of Object.entries(files)) if (obj !== null) put(rel, obj);
  if (!("raw/sale" in over)) {
    for (const kind of ["sale", "rent"]) {
      for (let i = 0; i < 24; i += 1) {
        for (const { code } of DISTRICTS) put(`raw/${kind}/${code}-${shiftMonth(base.month, -i)}.json`, { observedAt: i === 0 ? base.observedAt : "2026-09-01T00:00:00Z" });
      }
    }
  }
  return dir;
}
const at = (iso) => new Date(iso);
const by = (checks, source) => checks.find((c) => c.source === source);
const run = (dir, now) => {
  const lines = [];
  const code = main([`--root=${dir}`, `--now=${now}`], { log: (m) => lines.push(m) });
  return { code, text: lines.join("\n") };
};

test("정상 사본: 2026-10-26(월) 14:29 KST 에는 전부 ok, 종료 0, 경고 줄 없음", () => {
  const dir = fixture();
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.deepEqual(checks.filter((c) => c.level !== "ok").map((c) => c.source), []);
    const { code, text } = run(dir, "2026-10-26T05:29:00Z");
    assert.equal(code, 0);
    assert.doesNotMatch(text, /::warning::|::error::/, "정상일 때는 매일 새 소음이 없다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("주말 지연: 금요일 값은 월·화 새벽까지 조용하고, 목요일(사이 평일 3)에 경고, 다음 주 수요일(7)에 실패", () => {
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-26"), 0); // 금 -> 월
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-27"), 1); // 화 새벽(오늘 run 전)
  assert.equal(weekdaysBetween("2026-10-23", "2026-10-29"), BUSINESS_WARN_DAYS);
  assert.equal(weekdaysBetween("2026-10-23", "2026-11-04"), BUSINESS_FAIL_DAYS);
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "market/kospi").level;
    assert.equal(level("2026-10-26T17:29:00Z"), "ok"); // 화 02:29 KST
    assert.equal(level("2026-10-28T05:29:00Z"), "ok"); // 수 14:29 - 단발 실패(평일 2)는 조용
    assert.equal(level("2026-10-29T05:29:00Z"), "warn");
    assert.equal(level("2026-11-03T05:29:00Z"), "warn"); // 평일 6
    assert.equal(level("2026-11-04T05:29:00Z"), "fail"); // 평일 7
    // 가장 긴 휴장(평일 5일, 2025-10-03~09)에 단발 실패가 겹쳐도(6) 실패로 울지 않는다(#667 cto)
    assert.equal(weekdaysBetween("2025-10-02", "2025-10-10"), 5);
    assert.equal(weekdaysBetween("2025-10-02", "2025-10-11"), 6);
    assert.ok(6 < BUSINESS_FAIL_DAYS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("하루 주기(뉴스): 가장 새 기사 36h 넘으면 경고, 60h 넘으면 실패해 종료 1", () => {
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "news").level;
    assert.equal(level("2026-10-27T03:59:00Z"), "ok"); // 35.98h
    assert.equal(level("2026-10-27T04:01:00Z"), "warn");
    assert.equal(level("2026-10-28T04:01:00Z"), "fail");
    const { code, text } = run(dir, "2026-10-28T04:01:00Z");
    assert.equal(code, 1);
    assert.match(text, /::error::데이터가 멈췄다: news/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("월 주기: 정상 지연 L 이하 조용, L+1 경고, L+2 실패. 빈 달은 경고", () => {
  assert.equal(monthlyCheck("x", months("202608", 5), 2, "202610").level, "ok");
  assert.equal(monthlyCheck("x", months("202607", 5), 2, "202610").level, "warn");
  assert.equal(monthlyCheck("x", months("202606", 5), 2, "202610").level, "fail");
  assert.equal(monthlyCheck("x", [["202601", 1], ["202603", 1], ["202609", 1]], 2, "202610").level, "warn");
  // 해가 바뀌어도 달 수로 센다
  assert.equal(monthlyCheck("x", months("202611", 3), 2, "202701").level, "ok");
  // 사본에서: 기준금리가 두 달 더 늦으면 실패, 자치구 25개 중 하나만 늦어도 그 소스가 늦다
  const dir = fixture({
    "raw/indicators/series.json": { series: { ...Object.fromEntries(Object.entries(MONTHLY_LAG).map(([k, lag]) => [k, months(shiftMonth("202610", -lag), 30)])), base_rate: months("202606", 30) } },
    "raw/indicators/rone-districts.json": { series: { 11110: months("202609", 30), 11140: months("202607", 30) } },
  });
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.equal(by(checks, "series/base_rate").level, "fail");
    assert.equal(by(checks, "rone-districts").level, "warn");
    assert.match(by(checks, "rone-districts").detail, /2계열 중 가장 늦은 것: 마지막 달 202607/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("주기 표는 수집기의 계열 목록과 같다(계열을 더하면 여기서 소리 난다)", () => {
  assert.deepEqual(Object.keys(MONTHLY_LAG).sort(), [...Object.keys(ECOS_SERIES), ...Object.keys(RONE_SERIES)].sort());
});

test("파일 없음: 뉴스·시장·계열 파일이 없으면 실패, 공시가격 상태 파일이 없으면 경고만", () => {
  const dir = fixture({ "docs/data/news.json": null, "docs/data/market.json": null, "raw/ecos/apt-price-index.json": null, "raw/official-price/status/progress.json": null });
  try {
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    for (const s of ["news", "market/kospi", "market/usdKrw", "apt-price-index"]) assert.equal(by(checks, s).level, "fail", s);
    assert.equal(by(checks, "official-price").level, "warn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("실거래 원본: 슬롯이 빠지면 경고(감소), 도착이 멈추면 영업일 문턱으로", () => {
  const dir = fixture();
  try {
    rmSync(path.join(dir, "raw/sale/11110-202509.json"));
    const checks = collectChecks({ root: dir, now: at("2026-10-26T05:29:00Z") });
    assert.equal(by(checks, "raw/sale").level, "warn");
    assert.match(by(checks, "raw/sale").detail, /슬롯 599\/600\(빠진 슬롯 1\)/);
    assert.equal(by(checks, "raw/rent").level, "ok");
    assert.equal(by(collectChecks({ root: dir, now: at("2026-11-05T05:29:00Z") }), "raw/rent").level, "fail"); // 10-26 도착 뒤 평일 7일
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("공시가격: 진척 0 이 2일 이어지면 경고, 3일이 넘어도 실패는 내지 않는다(그 워크플로가 낸다, #660)", () => {
  const p = { lastProgressAt: "2026-10-22T21:53:51.000Z", zeroProgressRuns: 3, doneParcels: 2094, targetParcels: 6764 };
  const dir = fixture({ "raw/official-price/status/progress.json": p });
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "official-price").level;
    assert.equal(level("2026-10-24T05:29:00Z"), "ok"); // 1일
    assert.equal(level("2026-10-25T05:29:00Z"), "warn"); // 2일
    assert.equal(level("2026-10-30T05:29:00Z"), "warn"); // 7일 - 여전히 경고
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("월간 원장: 첫 달(2026-11) 전에는 안 보고, 3일 0시(KST) 뒤 없으면 경고, 54h 넘으면 실패, 있으면 ok", () => {
  const dir = fixture();
  try {
    const level = (now) => by(collectChecks({ root: dir, now: at(now) }), "ledger")?.level;
    assert.equal(level("2026-10-26T05:29:00Z"), undefined);
    assert.equal(level("2026-11-02T05:29:00Z"), "ok"); // 기한 전
    assert.equal(level("2026-11-03T05:29:00Z"), "warn");
    assert.equal(level("2026-11-05T05:29:00Z"), "fail"); // 3일 0시 KST + 62.5h
    mkdirSync(path.join(dir, "ledger"));
    writeFileSync(path.join(dir, "ledger/2026-11.jsonl.gz"), "");
    assert.equal(level("2026-11-05T05:29:00Z"), "ok");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("날짜 읽기: 해 없는 M/D 는 오늘보다 늦지 않은 해, ISO·RFC 도 읽는다", () => {
  assert.equal(dateOf("10/23", "2026-10-26"), "2026-10-23");
  assert.equal(dateOf("12/31", "2027-01-02"), "2026-12-31");
  assert.equal(dateOf("2026-10-23", "2026-10-26"), "2026-10-23");
  assert.equal(dateOf("Sun, 25 Oct 2026 00:02:31 +0000", "2026-10-26"), "2026-10-25");
  assert.equal(dateOf("", "2026-10-26"), null);
});

test("method 수집 상태 줄: 마지막 수집 성공·10-01 이후 수집이 빠진 날을 두 언어로(공시가격 진척 없음), 데이터 없으면 null", () => {
  const history = ["2026-09-02", "2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"].map((date) => ({ date }));
  const s = collectStatus(history);
  assert.equal(s.ko, '<p>수집 상태: 마지막 수집 성공 10-05 · 10-01 이후 수집이 빠진 날 1일</p>');
  assert.equal(s.en, '<p>Collection: last successful run 10-05 · 1 day without collection since 10-01</p>');
  assert.equal(collectStatus([]), null);
  assert.equal(collectStatus(undefined), null);
});

test("워치독 워크플로는 데이터 진척 스텝을 두고, 앞 스텝이 실패해도 돈다", () => {
  const text = readFileSync(path.join(root, ".github/workflows/schedule-watchdog.yml"), "utf8");
  assert.match(text, /if: \$\{\{ !cancelled\(\) \}\}\n\s+run: node scripts\/check-data-progress\.ts\n/);
});

// ---- #657 경고의 출구: 판정 -> 이슈. 데이터는 사본, GitHub API 는 스텁이다(네트워크 없음) ----

/** 열린 이슈 목록을 쪽으로 나눠 주고 POST 를 받아 적는 스텁. 만든 이슈는 다음 목록에 나온다. */
function stubGitHub({ pages = [[]], failListPage = null, failCreate = false } = {}) {
  const posts = [];
  const gets = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === "POST") {
      if (failCreate) return new Response("{}", { status: 403, statusText: "Forbidden" });
      const body = JSON.parse(init.body);
      posts.push(body);
      pages[pages.length - 1].push({ title: body.title });
      return new Response(JSON.stringify({ html_url: `https://stub/issues/${posts.length}` }), { status: 201 });
    }
    gets.push(url);
    const page = Number(new URL(url).searchParams.get("page"));
    if (page === failListPage) return new Response("{}", { status: 502, statusText: "Bad Gateway" });
    const link = page < pages.length ? `<${url.replace(/page=\d+$/, `page=${page + 1}`)}>; rel="next"` : "";
    return new Response(JSON.stringify(pages[page - 1]), { status: 200, headers: { link } });
  };
  return { fetchImpl, posts, gets };
}

/** 틱 하나: 사본 판정 -> report 한 줄 -> 이슈. */
async function tick(dir, now, gh = stubGitHub()) {
  const lines = [];
  let json;
  const code = main([`--root=${dir}`, `--now=${now}`], { log: (m) => lines.push(m), writeReport: (j) => { json = j; } });
  const r = await runReport({ text: json, repo: "o/r", token: "t", fetchImpl: gh.fetchImpl, log: (m) => lines.push(m) });
  return { code, text: lines.join("\n"), posts: gh.posts, gets: gh.gets, ...r };
}
const NOW = "2026-10-26T05:29:00Z";
const report = (...checks) => JSON.stringify({ version: 1, now: NOW, checks });
const warn = (source, level = "warn") => ({ source, cadence: "x", level, last: null, detail: "d" });
const issue = (title, extra = {}) => ({ title, ...extra });
const runStub = (text, gh, opts = {}) => runReport({ text, repo: "o/r", token: "t", fetchImpl: gh.fetchImpl, log: opts.log ?? (() => {}), marker: opts.marker ?? false });

test("이슈(공시가격): 진척 0 이 2일이면 official-price 1건, 1일이면 0건, progress.json 없음은 1건, 수집 완료면 0건 (#657 완료 조건 1)", async () => {
  const stalled = { lastProgressAt: "2026-10-24T05:00:00Z", zeroProgressRuns: 2, doneParcels: 2094, targetParcels: 6764 };
  const dir = fixture({ "raw/official-price/status/progress.json": stalled });
  const missing = fixture({ "raw/official-price/status/progress.json": null });
  const complete = fixture({ "raw/official-price/status/progress.json": { ...stalled, lastProgressAt: "2026-10-01T00:00:00Z", doneParcels: 6764 } });
  try {
    const two = await tick(dir, "2026-10-26T05:29:00Z");
    assert.deepEqual(two.posts.map((p) => p.title), [`${TITLE_PREFIX}official-price`]);
    assert.deepEqual(two.posts[0].labels, ["audit", "bug"]);
    assert.match(two.posts[0].body, /official-price/);
    assert.match(two.posts[0].body, /경고 2일/, "본문에 문턱");
    assert.match(two.posts[0].body, /2026-10-24T05:00:00Z/, "본문에 마지막 값");
    assert.match(two.posts[0].body, /node scripts\/check-data-progress\.ts --now=2026-10-26T05:29:00\.000Z/, "본문에 재현 명령");
    assert.equal(two.code, 0, "경고는 run 을 빨갛게 하지 않는다");
    assert.equal((await tick(dir, "2026-10-26T04:59:00Z")).posts.length, 0, "1.99일 = 1일");
    assert.deepEqual((await tick(missing, NOW)).created, ["official-price"]);
    assert.equal((await tick(complete, NOW)).posts.length, 0);
  } finally { for (const d of [dir, missing, complete]) rmSync(d, { recursive: true, force: true }); }
});

test("이슈(원장): 기한 뒤 파일이 없으면 경고이고 0건, 54h 를 넘으면 실패이고 0건, 파일이 있으면 조용하다 (#657 완료 조건 2)", async () => {
  const dir = fixture({}, NOV);
  try {
    const warned = await tick(dir, "2026-11-03T05:29:00Z");
    assert.match(warned.text, /::warning::데이터 진척 확인: ledger/);
    assert.equal(warned.code, 0);
    assert.equal(warned.posts.length, 0);
    assert.equal(warned.gets.length, 0, "후보가 없으면 목록도 안 읽는다");
    const failed = await tick(dir, "2026-11-05T05:29:00Z");
    assert.match(failed.text, /::error::데이터가 멈췄다: ledger/);
    assert.equal(failed.code, 1);
    assert.equal(failed.posts.length, 0);
    mkdirSync(path.join(dir, "ledger"));
    writeFileSync(path.join(dir, "ledger/2026-11.jsonl.gz"), "");
    const quiet = await tick(dir, "2026-11-05T05:29:00Z");
    assert.doesNotMatch(quiet.text, /::warning::|::error::/);
    assert.equal(quiet.posts.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("이슈(계열): 한 계열 지연이면 series 1건, 15개 전부 지연이어도 1건, 중간 빈 달은 즉시 1건, 앞쪽 잘림은 경고가 안 난다 (#657 완료 조건 3)", async () => {
  const late = Object.fromEntries(Object.entries(MONTHLY_LAG).map(([k, lag]) => [k, months(shiftMonth("202610", -lag - 1), 30)]));
  const hole = months("202608", 30).filter(([m]) => m !== "202603");
  const dirs = {
    one: fixture({ "raw/indicators/series.json": seriesOf("202610", { base_rate: late.base_rate }) }),
    all: fixture({ "raw/indicators/series.json": { series: late } }),
    hole: fixture({ "raw/indicators/series.json": seriesOf("202610", { base_rate: hole }) }),
    cut: fixture({ "raw/indicators/series.json": seriesOf("202610", { base_rate: months("202608", 3) }) }),
  };
  try {
    assert.deepEqual((await tick(dirs.one, NOW)).created, ["series"]);
    const all = await tick(dirs.all, NOW);
    assert.equal(all.posts.length, 1, "15개를 합쳐 1건(ECOS 정지 때 15건이 열리면 안 된다)");
    assert.equal(all.posts[0].title, `${TITLE_PREFIX}series`);
    assert.equal(all.posts[0].body.split("\n").filter((l) => l.startsWith("| `series/")).length, 15, "본문에 15개가 다 있다");
    const holes = await tick(dirs.hole, NOW);
    assert.deepEqual(holes.created, ["series"]);
    assert.match(holes.posts[0].body, /빈 달 1개/);
    // 받아들인 대가(#657 D7): 계열 앞이 잘려 30달이 3달이 돼도 울리지 않는다.
    const cut = await tick(dirs.cut, NOW);
    assert.equal(cut.posts.length, 0);
    assert.doesNotMatch(cut.text, /::warning::/);
  } finally { for (const d of Object.values(dirs)) rmSync(d, { recursive: true, force: true }); }
});

test("이슈(슬롯): raw 슬롯 하나가 빠지면 raw 즉시 1건, 600/600 이면 0건 (#657 완료 조건 4)", async () => {
  const dir = fixture();
  try {
    const full = await tick(dir, NOW);
    assert.equal(full.posts.length, 0);
    assert.match(full.text, /슬롯 600\/600/);
    rmSync(path.join(dir, "raw/sale/11110-202509.json"));
    const short = await tick(dir, NOW);
    assert.deepEqual(short.created, ["raw"]);
    assert.match(short.posts[0].body, /빠진 슬롯 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("중복: 같은 제목이 열려 있으면 0건, 그 이슈가 둘째 쪽에 있어도 0건 (#657 완료 조건 5)", async () => {
  const text = report(warn("series/base_rate"));
  const first = stubGitHub({ pages: [[issue(`${TITLE_PREFIX}series`)]] });
  assert.deepEqual(await runStub(text, first), { created: [], open: ["series"], deferred: [] });
  assert.equal(first.posts.length, 0);
  const others = Array.from({ length: 100 }, (_, i) => issue(`다른 이슈 ${i}`));
  const second = stubGitHub({ pages: [others, [issue(`${TITLE_PREFIX}series`)]] });
  assert.equal((await runStub(text, second)).open.length, 1);
  assert.equal(second.gets.length, 2, "끝쪽까지 읽는다");
  assert.equal(second.posts.length, 0);
});

test("중복: 제목이 일부만 같은 이슈와, 제목이 같은 PR 은 막지 않는다 (#657 완료 조건 5)", async () => {
  const gh = stubGitHub({ pages: [[issue(`${TITLE_PREFIX}series 추가 조사`), issue(`참고 ${TITLE_PREFIX}series`), issue(`${TITLE_PREFIX}series`, { pull_request: { url: "x" } })]] });
  assert.deepEqual((await runStub(report(warn("series/base_rate")), gh)).created, ["series"]);
  assert.equal(gh.posts.length, 1);
});

test("중복: 목록을 못 읽으면(첫 쪽이든 둘째 쪽이든) 0건이고 실패다 (#657 완료 조건 5)", async () => {
  const text = report(warn("series/base_rate"));
  const first = stubGitHub({ failListPage: 1 });
  await assert.rejects(runStub(text, first), /열린 이슈 목록을 못 읽었다: GitHub API 502/);
  assert.equal(first.posts.length, 0);
  const second = stubGitHub({ pages: [[], []], failListPage: 2 });
  await assert.rejects(runStub(text, second), /열린 이슈 목록을 못 읽었다/);
  assert.equal(second.posts.length, 0);
  // 이슈 만들기가 막혀도(저장소 설정 등) 조용히 넘어가지 않는다.
  await assert.rejects(runStub(text, stubGitHub({ failCreate: true })), /이슈를 못 열었다: GitHub API 403/);
});

test("상한: 8개 묶음이 동시에 경고면 새 이슈 3건(코드 목록 순서), 남은 묶음은 ::warning:: 이고 다음 틱에 열린다 (#657 완료 조건 6)", async () => {
  const dir = fixture({
    "raw/official-price/status/progress.json": null,
    "docs/data/market.json": { updatedAt: OCT.updatedAt, kospi: { asOf: "10/20" }, usdKrw: { asOf: "10/20" }, usdKrwDaily: [["2026-10-20", 1]] },
    "raw/indicators/series.json": seriesOf("202610", { base_rate: months("202607", 30) }),
    "raw/indicators/rone-districts.json": { series: { 11110: months("202607", 30) } },
    "raw/ecos/apt-price-index.json": { series: { 200: months("202606", 30) } },
    "raw/move-in/meta.json": { basis: "2026-01-20" },
    "research/housing-permits/folded.json": { meta: { updatedAt: "2026-09-01T00:00:00Z" } },
  });
  try {
    rmSync(path.join(dir, "raw/sale/11110-202509.json"));
    assert.equal(MAX_NEW_ISSUES, 3);
    const gh = stubGitHub();
    const one = await tick(dir, NOW, gh);
    assert.deepEqual(one.created, ["official-price", "raw", "series"]);
    assert.deepEqual(one.deferred, ["market", "rone-districts", "apt-price-index", "move-in", "housing-permits"]);
    assert.equal(gh.posts.length, 3);
    for (const g of one.deferred) assert.match(one.text, new RegExp(`::warning::틱당 새 이슈 상한 3건을 넘어 다음 틱으로 미룬다: ${g}`));
    // 열린 것은 상한을 먹지 않는다: 둘째 틱에 다음 셋, 셋째 틱에 남은 둘.
    const two = await tick(dir, NOW, gh);
    assert.deepEqual(two.created, ["market", "rone-districts", "apt-price-index"]);
    const three = await tick(dir, NOW, gh);
    assert.deepEqual(three.created, ["move-in", "housing-permits"]);
    assert.deepEqual(three.deferred, []);
    assert.equal((await tick(dir, NOW, gh)).created.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("대상 밖: 경고가 없으면 0건, news·F2·ledger 경고만 있으면 0건이고 목록도 안 읽는다 (#657 완료 조건 7)", async () => {
  for (const checks of [[], [warn("news")], [warn("docs/data/rates")], [warn("docs/data/rents-*", "fail")], [warn("ledger")], [warn("news"), warn("ledger"), warn("docs/data/x")]]) {
    const gh = stubGitHub();
    assert.deepEqual(await runStub(report(...checks), gh), { created: [], open: [], deferred: [] });
    assert.deepEqual([gh.posts.length, gh.gets.length], [0, 0]);
  }
});

test("대상 밖: 묶음에 실패 판정만 있으면 열지 않고, 경고가 하나라도 있으면 그 실패까지 본문에 싣는다 (#657)", async () => {
  const only = stubGitHub();
  assert.deepEqual((await runStub(report(warn("series/base_rate", "fail")), only)).created, []);
  const plan = planIssues(parseReport(report(warn("series/base_rate", "fail"), warn("series/ktb3"))));
  assert.deepEqual(plan.map((p) => p.group), ["series"]);
  assert.match(plan[0].body, /series\/base_rate/);
  assert.match(plan[0].body, /series\/ktb3/);
});

test("코드 목록: 코드 목록에 없는 소스가 나오면 report 가 멈추고, 지금 나오는 소스는 전부 목록 안이다 (#657 완료 조건 7)", async () => {
  const gh = stubGitHub();
  await assert.rejects(runStub(report(warn("new-source/x")), gh), /코드 목록에 없는 소스다: new-source\/x/);
  assert.equal(gh.posts.length, 0);
  assert.deepEqual(ISSUE_GROUPS, ["official-price", "raw", "series", "market", "rone-districts", "apt-price-index", "move-in", "housing-permits"]);
  assert.deepEqual(NO_ISSUE_GROUPS, ["news", "ledger", "docs"]);
  assert.equal(ISSUE_GROUPS.filter((g) => NO_ISSUE_GROUPS.includes(g)).length, 0);
  // 조건부로 나오는 둘(housing-permits, ledger)까지 다 나오는 사본.
  const dir = fixture({ "research/housing-permits/folded.json": { meta: { updatedAt: "2026-10-20T00:00:00Z" } } }, NOV);
  try {
    const checks = collectChecks({ root: dir, now: at("2026-11-03T05:29:00Z") });
    const sources = checks.map((c) => c.source).filter((s) => !s.startsWith("docs/"));
    assert.equal(sources.length, 26, "소스 26개");
    for (const c of checks) assert.ok([...ISSUE_GROUPS, ...NO_ISSUE_GROUPS].includes(groupOf(c.source)), `코드 목록에 없다: ${c.source}`);
    assert.deepEqual([...new Set(sources.map(groupOf))].sort(), [...ISSUE_GROUPS, "news", "ledger"].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("watch 결과: 못 읽으면 report 가 실패한다(비었음·JSON 아님·모양 다름), 경고 없음(checks: [])은 실패가 아니다 (#657 완료 조건 8)", () => {
  const script = path.join(root, "scripts/report-data-progress.ts");
  const call = (value) => spawnSync(process.execPath, [script], { encoding: "utf8", env: { PATH: process.env.PATH, GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t", PROGRESS_REPORT: value, ISSUE_TEST: "" } });
  for (const bad of ["", "   ", "{not json", "{}", '{"version":2,"now":"x","checks":[]}', '{"version":1,"now":"x","checks":[{"source":"raw/sale","level":"ok","detail":"d"}]}']) {
    const r = call(bad);
    assert.equal(r.status, 1, `값: ${bad}`);
    assert.match(r.stdout, /^::error::데이터 진척 이슈 단계가 돌지 못했다/m);
  }
  const ok = call(report());
  assert.equal(ok.status, 0, "후보가 없으면 네트워크 없이 끝난다");
  assert.match(ok.stdout, /새 이슈 0건/);
});

test("watch 결과: 실패로 끝나는 틱에도 GITHUB_OUTPUT 에 판정이 남아 report 가 읽는다, 검사가 죽으면 안 남는다 (#657)", () => {
  const dir = fixture({ "docs/data/news.json": null, "raw/official-price/status/progress.json": null });
  const out = path.join(dir, "output");
  try {
    const script = path.join(root, "scripts/check-data-progress.ts");
    const env = { PATH: process.env.PATH, GITHUB_OUTPUT: out };
    const r = spawnSync(process.execPath, [script, `--root=${dir}`, `--now=${NOW}`], { encoding: "utf8", env });
    assert.equal(r.status, 1, "news 파일 없음 = 실패");
    const lines = readFileSync(out, "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "한 줄");
    assert.ok(lines[0].startsWith("report="));
    const parsed = parseReport(lines[0].slice("report=".length));
    assert.deepEqual(planIssues(parsed).map((p) => p.group), ["official-price"], "실패가 있어도 경고는 이슈로 간다");
    rmSync(out);
    assert.equal(spawnSync(process.execPath, [script, `--root=${dir}`, "--now=bad"], { encoding: "utf8", env }).status, 2);
    assert.throws(() => readFileSync(out), /ENOENT/, "죽으면 출력이 없고 report 가 그것을 실패로 친다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("시험 표지: dispatch 의 dispatch-test 만 켜지고, 첫 틱 1건·둘째 틱 0건이다. 정기 실행과 모르는 값은 안 켜진다 (#657 완료 조건 12)", async () => {
  assert.equal(readMarker({ GITHUB_EVENT_NAME: "workflow_dispatch", ISSUE_TEST: "dispatch-test" }), true);
  assert.equal(readMarker({ GITHUB_EVENT_NAME: "workflow_dispatch", ISSUE_TEST: "none" }), false);
  assert.equal(readMarker({ GITHUB_EVENT_NAME: "schedule", ISSUE_TEST: "" }), false);
  assert.equal(readMarker({ GITHUB_EVENT_NAME: "schedule" }), false);
  assert.equal(readMarker({ GITHUB_EVENT_NAME: "schedule", ISSUE_TEST: "dispatch-test" }), false);
  assert.throws(() => readMarker({ GITHUB_EVENT_NAME: "workflow_dispatch", ISSUE_TEST: "x; rm -rf" }), /ISSUE_TEST 값을 모른다/);
  const gh = stubGitHub();
  assert.deepEqual((await runStub(report(), gh, { marker: true })).created, ["dispatch-test"]);
  assert.match(gh.posts[0].title, /데이터 진척 경고: dispatch-test$/);
  assert.match(gh.posts[0].body, /시험 표지/);
  assert.deepEqual(await runStub(report(), gh, { marker: true }), { created: [], open: ["dispatch-test"], deferred: [] });
  assert.equal(gh.posts.length, 1);
});

test("열린 이슈 목록: 토큰을 싣고 열린 이슈를 100개씩 읽는다", async () => {
  let seen;
  await listOpenIssueTitles({ repo: "o/r", token: "tok", fetchImpl: async (url, init) => { seen = { url, auth: init.headers.Authorization }; return new Response("[]", { status: 200 }); } });
  assert.equal(seen.url, "https://api.github.com/repos/o/r/issues?state=open&per_page=100&page=1");
  assert.equal(seen.auth, "Bearer tok");
});

// ---- #657 F2 빌더 산출물 나이 ----

function dataDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "builder-age-"));
  for (const [name, value] of Object.entries(files)) writeFileSync(path.join(dir, `${name}.json`), typeof value === "string" ? value : JSON.stringify(value));
  return dir;
}
const T0 = Date.parse("2026-10-10T00:00:00Z");
const hoursAgo = (h) => new Date(T0 - h * 3600 * 1000).toISOString();
const age = (dir, name) => builderAgeChecks(dir, T0).find((c) => c.source === `docs/data/${name}`);

test("F2: updatedAt 이 30h 를 넘으면 경고(이슈 대상 아님), 54h 를 넘으면 실패, 경계 정각은 조용하다 (#657 완료 조건 10)", async () => {
  assert.deepEqual([CHECK_HOURS, ALERT_HOURS], [30, 54]);
  const dir = dataDir({ a: { updatedAt: hoursAgo(30) }, b: { updatedAt: hoursAgo(30.1) }, c: { updatedAt: hoursAgo(54) }, d: { updatedAt: hoursAgo(54.1) } });
  try {
    assert.deepEqual(["a", "b", "c", "d"].map((n) => age(dir, n).level), ["ok", "warn", "warn", "fail"]);
    assert.equal(planIssues(parseReport(reportPayload(builderAgeChecks(dir, T0), new Date(T0)))).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("F2: 없거나 읽을 수 없으면 실패다(제외 목록 밖) - 키 없음·숫자·글자·시간대 없음·깨진 JSON, 제외 목록은 나이를 안 잰다 (#657 완료 조건 10)", () => {
  const dir = dataDir({
    none: { x: 1 }, number: { updatedAt: 1 }, word: { updatedAt: "어제" }, nozone: { updatedAt: "2026-10-09T00:00:00" }, dateonly: { updatedAt: "2026-10-09" }, broken: "{", list: [1],
    "market-history": [], "news-history": [], "realestate-history": [], "summary-history": [], "outlook-log": { entries: [] },
  });
  try {
    for (const n of ["none", "number", "word", "nozone", "dateonly", "broken", "list"]) {
      assert.equal(age(dir, n).level, "fail", n);
      assert.match(age(dir, n).detail, /updatedAt 이 없거나 읽을 수 없다/);
    }
    assert.deepEqual(builderAgeChecks(dir, T0).filter((c) => UPDATED_AT_EXCLUDED.some((x) => c.source.endsWith(x))), []);
    assert.deepEqual(UPDATED_AT_EXCLUDED, ["market-history", "news-history", "realestate-history", "summary-history", "outlook-log"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("F2: 묶음(rents-* 등)은 가장 오래된 값으로 보고, 하나라도 못 읽으면 묶음이 실패다 (#657 완료 조건 10)", () => {
  const names = ["gangnam", "gangseo", "guro", "jung", "mapo"];
  const dir = dataDir(Object.fromEntries(names.map((n, i) => [`rents-${n}`, { updatedAt: hoursAgo(i === 2 ? 40 : 1) }])));
  const broken = dataDir(Object.fromEntries(names.map((n, i) => [`rents-${n}`, i === 1 ? {} : { updatedAt: hoursAgo(1) }])));
  try {
    const checks = builderAgeChecks(dir, T0);
    assert.equal(checks.length, 1);
    assert.equal(checks[0].source, "docs/data/rents-*");
    assert.equal(checks[0].level, "warn");
    assert.match(checks[0].detail, /40\.0시간 전\(묶음 5개 중 rents-guro\.json\)/);
    assert.equal(builderAgeChecks(broken, T0)[0].level, "fail");
    assert.match(builderAgeChecks(broken, T0)[0].detail, /rents-gangseo\.json/);
  } finally { for (const d of [dir, broken]) rmSync(d, { recursive: true, force: true }); }
});

test("F2: 모두 늙어도 ::error:: 는 1줄이고 소스 수와 상위 5개만 적는다, 30h 경고도 1줄이다 (#657 완료 조건 10)", () => {
  const stale = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`docs/data/f${i}.json`, { updatedAt: new Date(Date.parse(NOW) - (100 + i) * 3600 * 1000).toISOString() }]));
  const warned = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`docs/data/f${i}.json`, { updatedAt: new Date(Date.parse(NOW) - 40 * 3600 * 1000).toISOString() }]));
  const a = fixture(stale);
  const b = fixture(warned);
  try {
    const { code, text } = run(a, NOW);
    assert.equal(code, 1);
    const errors = text.split("\n").filter((l) => l.startsWith("::error::"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /소스 150개 - f149\(249\.0h\), f148\(248\.0h\), f147\(247\.0h\), f146\(246\.0h\), f145\(245\.0h\) 외 145개/);
    const quiet = run(b, NOW);
    assert.equal(quiet.code, 0);
    assert.equal(quiet.text.split("\n").filter((l) => l.startsWith("::warning::빌더")).length, 1);
    assert.doesNotMatch(quiet.text, /::error::/);
  } finally { for (const d of [a, b]) rmSync(d, { recursive: true, force: true }); }
});

test("F2: 등록 안 된 새 파일이 docs/data 에 있으면 이 시험이 실패한다(이름만 본다, 값·날짜는 안 본다) (#657 완료 조건 10)", () => {
  const files = readdirSync(path.join(root, "docs/data")).filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0);
  assert.deepEqual(unregisteredDataFiles(files), [], "새 파일이면 check-data-progress.ts 의 BUILDER_OUTPUTS(updatedAt 을 낸다) 또는 UPDATED_AT_EXCLUDED(판정자 승인) 중 하나에 넣는다");
  assert.deepEqual(unregisteredDataFiles([...files, "new-thing.json"]), ["new-thing"]);
});
