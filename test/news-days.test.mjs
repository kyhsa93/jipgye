import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitByDay, writeNewsDays } from "../scripts/build-news-days.ts";
import { NEWS_PAGES } from "../scripts/build-news-pages.ts";
import { loadNewsPage } from "./helpers/news-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

// 날짜별 뉴스 파일 (#706, P1). 사이트 빌드(render-pipeline 의 build-news-days)가 data/news-day/YYYY-MM-DD.json 을 만들고, news.html?date= 는
// 그 파일 하나만 받는다. 없으면 기존 history 두 파일로 되돌아간다. 값이 아니라 모양(파일 있음·내용 같음·어느 주소를 받는가)만 본다.
const root = path.resolve(import.meta.dirname, "..");
const readData = (name) => readFile(path.join(root, `docs/data/${name}.json`), "utf8").then(JSON.parse);
const until = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};

const item = (n) => ({ title: `기사 ${n}`, link: `https://example.com/${n}`, publishedAt: "2026-09-01T00:00:00.000Z", source: "테스트 경제" });
const newsEntry = (date, n) => ({ date, items: [item(n)] });
const summaryEntry = (date) => ({ date, model: "m", summary: { ko: `- 부동산: ${date} 요약`, en: "- Real estate: summary" }, categories: [{ key: "realestate", name: "부동산", nameEn: "Real Estate", lineKo: `${date} 요약`, lineEn: "summary", sources: [] }], highlights: [] });

// --- 분할(순수) ---------------------------------------------------------------------------------------------------------------

test("splitByDay: 두 기록의 날짜 합집합을 오름차순으로, 항목은 한 글자도 바꾸지 않고 담는다", () => {
  const n = [newsEntry("2026-09-02", 2), newsEntry("2026-09-01", 1)];
  const s = [summaryEntry("2026-09-03"), summaryEntry("2026-09-01")];
  const out = splitByDay(n, s);
  assert.deepEqual(out.map((d) => d.day), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  assert.equal(out[0].body.news, n[1], "뉴스 항목이 그대로가 아니다");
  assert.equal(out[0].body.summary, s[1], "요약 항목이 그대로가 아니다");
  assert.deepEqual(out[1].body.summary, {}, "요약만 없는 날은 {} 이어야 한다(news.html 이 기록 없음으로 그리는 값 그대로)");
  assert.deepEqual(out[2].body.news, {}, "뉴스만 없는 날은 {} 이어야 한다");
  assert.ok(out.every(({ day, body }) => body.date === day));
});

test("splitByDay: 날짜 모양이 아닌 항목은 건너뛰고(파일 이름이 된다), 같은 날짜는 첫 항목이 이긴다 - 기존 find 와 같다", () => {
  const first = newsEntry("2026-09-01", 1);
  const out = splitByDay([newsEntry("../etc/passwd", 9), { items: [] }, null, first, newsEntry("2026-09-01", 2), newsEntry("2026-9-1", 3)], []);
  assert.deepEqual(out.map((d) => d.day), ["2026-09-01"]);
  assert.equal(out[0].body.news, first);
});

// --- 파일 쓰기 ---------------------------------------------------------------------------------------------------------------

test("writeNewsDays: 날짜마다 파일 하나, 내용은 원본 항목과 같고, 지난 실행의 낡은 파일은 지운다", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "news-days-"));
  try {
    const data = path.join(tmp, "data");
    mkdirSync(data);
    writeFileSync(path.join(data, "news-history.json"), JSON.stringify([newsEntry("2026-09-01", 1), newsEntry("2026-09-02", 2)]));
    writeFileSync(path.join(data, "summary-history.json"), JSON.stringify([summaryEntry("2026-09-02")]));
    const out = path.join(tmp, "out");
    const stale = path.join(out, "data/news-day/2025-01-01.json");
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, "{}");

    const r = writeNewsDays({ out, dataDir: data });
    const dir = path.join(out, "data/news-day");
    assert.deepEqual(readdirSync(dir), ["2026-09-01.json", "2026-09-02.json"], "낡은 파일이 남았거나 날짜 파일이 빠졌다");
    assert.equal(r.files, 2);
    const day2 = JSON.parse(readFileSync(path.join(dir, "2026-09-02.json"), "utf8"));
    assert.deepEqual(day2, { date: "2026-09-02", news: newsEntry("2026-09-02", 2), summary: summaryEntry("2026-09-02") });
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "2026-09-01.json"), "utf8")).summary, {});
    assert.equal(r.bytes, readdirSync(dir).reduce((a, f) => a + readFileSync(path.join(dir, f)).length, 0), "바이트 합이 파일과 다르다");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("writeNewsDays: 기록 파일이 없으면 던지지 않고 있는 쪽만으로 쓴다 (하루 파일은 없어도 되는 최적화다)", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "news-days-"));
  try {
    const data = path.join(tmp, "data");
    mkdirSync(data);
    writeFileSync(path.join(data, "news-history.json"), JSON.stringify([newsEntry("2026-09-01", 1)]));
    const out = path.join(tmp, "out");
    assert.equal(writeNewsDays({ out, dataDir: data }).files, 1);
    assert.equal(writeNewsDays({ out, dataDir: path.join(tmp, "없는-폴더") }).files, 0);
    assert.deepEqual(readdirSync(path.join(out, "data/news-day")), []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("writeNewsDays: 같은 입력이면 같은 바이트 - 결정적이다", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "news-days-"));
  try {
    const data = path.join(tmp, "data");
    mkdirSync(data);
    writeFileSync(path.join(data, "news-history.json"), JSON.stringify([newsEntry("2026-09-02", 2), newsEntry("2026-09-01", 1)]));
    writeFileSync(path.join(data, "summary-history.json"), JSON.stringify([summaryEntry("2026-09-01")]));
    const run = (name) => {
      writeNewsDays({ out: path.join(tmp, name), dataDir: data });
      const dir = path.join(tmp, name, "data/news-day");
      return readdirSync(dir).map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
    };
    assert.deepEqual(run("a"), run("b"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- 나가는 사이트 (배포 게이트) ----------------------------------------------------------------------------------------------

test("나가는 사이트에 두 기록의 모든 날짜가 하루 파일로 있고 내용이 원본 항목과 같다", async () => {
  const [newsHistory, summaryHistory] = await Promise.all([readData("news-history"), readData("summary-history")]);
  const dates = [...new Set([...newsHistory, ...summaryHistory].map((e) => e.date))];
  assert.ok(dates.length > 0, "기록이 하나도 없다");
  const files = readdirSync(path.join(SITE, "data/news-day")).sort();
  assert.deepEqual(files, dates.map((d) => `${d}.json`).sort(), "날짜 파일 목록이 두 기록의 날짜 합집합과 다르다 - node scripts/build-news-days.ts");
  for (const date of dates) {
    const day = JSON.parse(await readFile(path.join(SITE, `data/news-day/${date}.json`), "utf8"));
    assert.deepEqual(day.news, newsHistory.find((e) => e.date === date) ?? {}, `${date} 뉴스가 원본과 다르다`);
    assert.deepEqual(day.summary, summaryHistory.find((e) => e.date === date) ?? {}, `${date} 요약이 원본과 다르다`);
  }
});

test("하루 파일 하나는 gzip -9 추정 20KB 이하다 (#706 판정 한도)", async () => {
  const { gzipSync } = await import("node:zlib");
  const dir = path.join(SITE, "data/news-day");
  for (const f of readdirSync(dir)) {
    const gz = gzipSync(readFileSync(path.join(dir, f)), { level: 9 }).length;
    assert.ok(gz <= 20 * 1024, `${f}: gzip ${gz}B 가 20KB 를 넘는다`);
  }
});

test("전체 장과 분야 장 넷이 같은 하루 파일 경로를 쓴다", async () => {
  for (const file of ["news.html", ...NEWS_PAGES.map((p) => p.file)]) {
    const html = await readFile(path.join(SITE, file), "utf8");
    assert.equal((html.match(/news-day\/\$\{encodeURIComponent\(date\)\}/g) ?? []).length, 1, `${file}: 하루 파일 받는 곳이 하나여야 한다`);
    assert.ok(html.includes("`${name}-history`"), `${file}: 하루 파일이 없을 때의 history 폴백이 사라졌다`);
  }
});

// --- news.html 동작 -----------------------------------------------------------------------------------------------------------

async function openWith({ search, files }) {
  const [news, summary, newsHistory, summaryHistory] = await Promise.all(["news", "summary", "news-history", "summary-history"].map(readData));
  const served = { news, summary, "news-history": newsHistory, "summary-history": summaryHistory };
  const calls = [];
  const fetch = async (url) => {
    const name = String(url).split("/data/")[1].split(".json")[0];
    calls.push(name);
    const body = name.startsWith("news-day/") ? files[name.slice("news-day/".length)] : served[name];
    if (!body) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  };
  const page = await loadNewsPage({ search, news, summary, fetch });
  return { page, calls, newsHistory, summaryHistory };
}

test("?date= 에 하루 파일이 있으면 그 파일 하나만 받고 history 는 받지 않는다", async () => {
  const day = {
    date: "2026-09-01",
    news: newsEntry("2026-09-01", 7),
    summary: summaryEntry("2026-09-01"),
  };
  const { page, calls } = await openWith({ search: "?date=2026-09-01", files: { "2026-09-01": day } });
  assert.ok(await until(() => String(page.newsListHtml()).includes("기사 7")), `하루 파일의 기사를 못 그린다: ${String(page.newsListHtml()).slice(0, 80)}`);
  assert.deepEqual(calls, ["news-day/2026-09-01"], "하루 파일 말고 다른 것을 받았다");
  assert.ok(String(page.byId("summary-box").innerHTML).includes("2026-09-01 요약"), "하루 파일의 요약을 못 그린다");
  assert.equal(page.notice(), null);
});

test("하루 파일의 한쪽이 {} 이면 그쪽만 기록 없음으로 그린다 (오류 알림 아님)", async () => {
  const { page, calls } = await openWith({ search: "?date=2026-09-01", files: { "2026-09-01": { date: "2026-09-01", news: newsEntry("2026-09-01", 7), summary: {} } } });
  assert.ok(await until(() => String(page.newsListHtml()).includes("기사 7")));
  assert.deepEqual(calls, ["news-day/2026-09-01"]);
  assert.ok(String(page.byId("summary-box").innerHTML).includes("기록이 없습니다"));
  assert.equal(page.notice(), null);
});

test("하루 파일이 없으면 기존 history 두 파일로 되돌아가 같은 날을 그린다 (폴백)", async () => {
  const [newsHistory] = await Promise.all([readData("news-history")]);
  const kept = newsHistory.findLast((e) => e.items?.length)?.date;
  assert.ok(kept, "뉴스 기록이 하나도 없다");
  const { page, calls } = await openWith({ search: `?date=${kept}`, files: {} });
  assert.ok(await until(() => String(page.newsListHtml()).includes("news-item")), "폴백이 기사를 못 그린다");
  assert.equal(calls[0], `news-day/${kept}`, "하루 파일부터 시도해야 한다");
  assert.deepEqual(calls.slice(1).sort(), ["news-history", "summary-history"], "폴백이 history 두 파일을 받지 않았다");
  assert.equal(page.byId("archive-date-input").value, kept);
  assert.equal(page.notice(), null);
});

test("기록이 없는 날짜는 하루 파일도 history 에도 없어 기록 없음 안내로 끝난다", async () => {
  const { page } = await openWith({ search: "?date=2026-01-01", files: {} });
  assert.ok(await until(() => String(page.newsListHtml()).includes("기록이 없습니다")));
  assert.equal(page.notice(), null);
});

test("모양이 이상한 ?date= 도 하루 파일 주소의 경로를 벗어나지 못한다 (인코딩) - 없는 파일이라 history 폴백으로 끝난다", async () => {
  for (const bad of ["../../x", "2026-9-1", "2026-09-01/../x", "a?b#c"]) {
    const { calls, page } = await openWith({ search: `?date=${encodeURIComponent(bad)}`, files: {} });
    await new Promise((r) => setTimeout(r, 20));
    const days = calls.filter((c) => c.startsWith("news-day/"));
    assert.deepEqual(days, [`news-day/${encodeURIComponent(bad)}`], `${JSON.stringify(bad)}: 하루 파일 주소가 인코딩된 한 칸이 아니다`);
    assert.ok(!days[0].slice("news-day/".length).includes("/"), `${JSON.stringify(bad)}: 경로를 벗어난다`);
    assert.ok(calls.includes("news-history") && calls.includes("summary-history"), `${JSON.stringify(bad)}: 폴백이 없다`);
    assert.equal(page.notice(), null);
  }
});

test("오늘 화면(?date= 없음)은 전과 같다 - news·summary 둘만 받고 하루 파일·history 는 받지 않는다", async () => {
  const { page, calls } = await openWith({ search: "", files: {} });
  assert.ok(await until(() => String(page.newsListHtml()).includes("news-item")));
  assert.deepEqual(calls.sort(), ["news", "summary"]);
});
