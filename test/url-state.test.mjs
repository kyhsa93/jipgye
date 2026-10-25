import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { loadNewsPage } from "./helpers/news-page.mjs";
import { NEWS_PAGES } from "../scripts/build-news-pages.ts";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");

const until = async (check) => {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
};
const read = (rel) => readFile(path.join(root, rel), "utf8");
const readData = (name) => read(`docs/data/${name}.json`).then(JSON.parse);
// 뉴스 화면을 저장소의 실제 기록으로 연다. 지난 기록은 #575 PR2 에서 메인(index.html?date=)에서 뉴스 화면(news.html?date=)으로 옮겼다.
const loadNewsWithData = async (search, override = {}) => {
  const [news, summary, newsHistory, summaryHistory] = await Promise.all(["news", "summary", "news-history", "summary-history"].map(readData));
  return loadNewsPage({ search, news, summary, history: { news: newsHistory, summary: summaryHistory, ...override } });
};

// 메인의 뉴스 거르기·검색어 주소(?cat=·?q=)와 그 기록 방식(pushState/replaceState)은 메인 뉴스 칸과 함께 없어졌다(#575 PR2) -
// 거르기는 뉴스 화면의 분야 장 넷이 맡는다. 남는 것은 옛 지난 기록 주소다.
test("예전 지난 기록 주소(index.html?date=)는 같은 날짜로 뉴스 화면에 보낸다 (#575 PR2)", async () => {
  assert.deepEqual((await loadIndexPage({ search: "?date=2026-09-01" })).replaced(), ["./news.html?date=2026-09-01"]);
  assert.deepEqual((await loadIndexPage()).replaced(), [], "날짜가 없으면 메인에 머문다");
});

test("부동산 표도 머리글로 정렬한다", async () => {
  const html = await read(`${SITE}/index.html`);
  for (const key of ["name", "sale", "jeonse", "wolse"]) {
    assert.ok(html.includes(`data-re-sort="${key}"`), `${key} 정렬 머리글이 없다`);
  }
  assert.ok(html.includes('aria-sort'), "정렬 상태를 알리지 않는다");
});

// 하루씩 넘기는 단추(←·→)는 옮기면서 뺐다 - 날짜 칸과 이동 단추가 스크립트 없이 같은 장에 ?date= 를 붙여 연다(#575 PR2).
test("뉴스 화면의 지난 기록 폼은 스크립트 없이 제 장에 ?date= 로 간다 (#575 PR2)", async () => {
  for (const file of ["news.html", ...NEWS_PAGES.map((p) => p.file)]) {
    const html = await read(`${SITE}/${file}`);
    const form = html.match(/<form class="archive-date-jump" id="archive-date-jump">([\s\S]*?)<\/form>/)?.[1];
    assert.ok(form, `${file}에 지난 기록 폼이 없다(action 이 붙으면 분야 장이 전체 장으로 간다)`);
    assert.match(form, /<input type="date" id="archive-date-input" name="date" required>/, `${file}: 날짜 칸이 date 로 보내지 않는다`);
    assert.match(form, /<button type="submit" id="archive-date-go">/, `${file}: 이동 단추가 없다`);
  }
  assert.doesNotMatch(await read(`${SITE}/index.html`), /archive-date-jump/, "메인에 지난 기록 폼이 남았다");
});

test("뉴스 페이지도 읽은 기사를 표시한다", async () => {
  const html = await read(`${SITE}/news.html`);
  assert.ok(html.includes('const READ_NEWS_KEY = "readNews"'), "읽음 저장소가 메인과 다르다");
  assert.ok(html.includes("markNewsRead(link.getAttribute"), "클릭을 읽음으로 기록하지 않는다");
  assert.ok((await read("src/css/legacy.css")).includes(".news-item.read"), "읽은 기사 스타일이 없다");
});

test("기록이 없는 날짜는 오류가 아니라 기록 없음으로 알린다", async () => {
  const missing = await loadNewsWithData("?date=2026-01-01");
  await until(() => String(missing.newsListHtml()).includes("기록이 없습니다"));
  const newsHtml = String(missing.newsListHtml());
  assert.ok(newsHtml.includes("그날 기록이 없습니다."), `기록 없음 안내가 아니다: ${newsHtml.slice(0, 80)}`);
  assert.ok(!newsHtml.includes("불러오지 못했습니다"), "기록 없음을 로드 실패로 말한다");
  assert.equal(missing.notice(), null, "기록 없음에 로드 실패 알림을 띄운다");

  const kept = (await readData("news-history")).findLast((entry) => entry.items?.length)?.date;
  assert.ok(kept, "뉴스 기록이 하나도 없어 '있는 날'을 고를 수 없다");

  const present = await loadNewsWithData(`?date=${kept}`);
  await until(() => String(present.newsListHtml()).includes("news-item"));
  assert.ok(String(present.newsListHtml()).includes("news-item"), "있는 기록을 못 그린다");
  assert.equal(present.byId("archive-date-input").value, kept, "보고 있는 날짜를 날짜 칸에 채우지 않는다");
});

test("일부 섹션만 기록이 없는 날짜도 오류라고 말하지 않는다", async () => {
  const onlyNews = (await readData("news-history")).findLast((entry) => entry.items?.length)?.date;
  assert.ok(onlyNews, "뉴스 기록이 하나도 없어 이 상태를 만들 수 없다");
  const summaryWithout = (await readData("summary-history")).filter((entry) => entry.date !== onlyNews);

  const page = await loadNewsWithData(`?date=${onlyNews}`, { summary: summaryWithout });
  await until(() => String(page.newsListHtml()).includes("news-item"));

  const summary = String(page.byId("summary-box").innerHTML);
  assert.ok(String(page.newsListHtml()).includes("news-item"), "그날 뉴스는 있는데 안 그린다");
  assert.ok(summary.includes("기록이 없습니다"), `기록 없음 안내가 아니다: ${summary.slice(0, 80)}`);
  assert.equal(page.notice(), null, "기록 없음을 로드 실패로 말한다");
});

test("무엇을 못 받았는지 이름을 말한다", async () => {
  const { readFile } = await import("node:fs/promises");

  const loadWithFailure = (failing) =>
    loadIndexPage({
      fetch: async (url) => {
        const name = String(url).split("/data/")[1]?.split(".json")[0];
        if (!name) throw new TypeError("Failed to fetch");
        if (name === failing) return { ok: false, status: 404, json: async () => ({}) };
        try {
          return { ok: true, json: async () => JSON.parse(await readFile(path.join(root, `docs/data/${name}.json`), "utf8")) };
        } catch {
          return { ok: false, status: 404, json: async () => ({}) };
        }
      },
    });

  // 메인이 받는 오늘 자료는 둘이다 - 뉴스·AI 요약은 뉴스 화면으로 옮겼다(#575 PR2, 뉴스 화면의 실패 알림은 load-failure 시험이 본다).
  for (const [file, label] of [["market", "시장지표"], ["realestate", "부동산"]]) {
    const page = await loadWithFailure(file);
    await until(() => String(page.byId("load-error-text").textContent).includes(label));
    const text = page.byId("load-error-text").textContent;
    assert.ok(text.includes(label), `${file} 실패인데 배너가 "${text}"다`);
    assert.ok(!text.includes("을(를)"), `조사가 자동으로 안 붙는다: ${text}`);
  }

  // 실패 이유("HTTP 404")는 방문자에게 보이지 않는다(#296 (다)). 무엇이 실패했는지는 위 이름이 말한다.
  const withReason = await loadWithFailure("market");
  await until(() => String(withReason.byId("load-error-text").textContent).includes("시장지표"));
  assert.ok(
    !/HTTP|\b\d{3}\b/.test(withReason.byId("load-error-text").textContent),
    `실패 이유가 방문자에게 보인다: ${withReason.byId("load-error-text").textContent}`
  );
});

test("데이터가 다 있으면 어떤 경우에도 오류 배너가 뜨지 않는다", async () => {
  const html = await read(`${SITE}/index.html`);
  assert.ok(
    html.includes('["market", "realestate"].filter((key) => !cache[key])'),
    "배너가 여전히 플래그로 뜬다"
  );
  assert.ok(html.includes("showLoadError(missing.length > 0"), "배너 조건이 화면 상태와 무관하다");
  assert.ok(
    html.includes('textContent = show ? text : ""'),
    "감출 때 문구를 비우지 않는다"
  );
});

test("감춰야 할 요소가 CSS 때문에 계속 보이지 않는다", async () => {
  const css = await read("src/css/legacy.css");
  assert.match(css, /\[hidden\] \{\s*display: none !important;\s*\}/, "감춤 보호 규칙이 없다");

  const files = [
    `${SITE}/index.html`,
    `${SITE}/news.html`,
    ...NEWS_PAGES.map((p) => `${SITE}/${p.file}`),
  ];

  for (const file of files) {
    assert.ok(
      (await read(file)).includes('href="./style.css"'),
      `${file}이 스타일시트를 부르지 않아 감춤 규칙이 닿지 않는다`
    );
  }
});

// 메인은 이제 늘 오늘 화면이다(지난 기록은 뉴스 화면, #575 PR2) - 부동산 섹션을 접는 갈래가 없다.
test("메인은 부동산 섹션을 그린다", async () => {
  const today = await loadIndexPage({ fetch: async (url) => {
    const name = String(url).split("/data/")[1].split(".json")[0];
    try {
      return { ok: true, json: async () => await readData(name) };
    } catch {
      return { ok: false, status: 404, json: async () => ({}) };
    }
  } });
  await until(() => String(today.byId("realestate-grid").innerHTML).includes("<tr"));
  assert.equal(today.byId("realestate-section").hidden, false, "오늘 화면에서 부동산이 사라졌다");
});

test("부동산 기록은 지난 기록에 넣지 않는다", async () => {
  for (const file of ["index.html", "news.html"]) {
    assert.doesNotMatch(await read(`${SITE}/${file}`), /["`]realestate-history["`]/, `${file}이 쓰지 않는 부동산 기록을 받는다`);
  }
});

// 메인의 뉴스 자리는 뉴스 화면으로 가는 한 줄이다(#575 PR2). 다섯 건·AI 요약은 news.html 에만 있다.
test("메인 뉴스 자리는 오늘 기사 수를 단 링크 한 줄이고 언어를 따라 바뀐다", async () => {
  const html = await read(`${SITE}/index.html`);
  const n = (await readData("news")).items.length;
  assert.match(html, new RegExp(`<a href="\\./news\\.html" id="news-link" data-n="${n}">오늘 뉴스 ${n}건·AI 요약 →</a>`));
  assert.doesNotMatch(html, /class="news-item"|id="summary-box"/, "메인에 기사·요약 상자가 남았다");

  const en = await loadIndexPage({ storage: { lang: "en" } });
  en.byId("news-link").dataset.n = "24";
  en.app.renderNewsLink();
  assert.equal(en.byId("news-link").textContent, "Today's 24 headlines and AI summary →");
});
