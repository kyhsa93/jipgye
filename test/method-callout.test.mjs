import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadIndexPage } from "./helpers/index-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const indexHtml = () => readFile(path.join(root, `${SITE}/index.html`), "utf8");

// 안내를 다는 화면. 첫 화면과 시세 계열 전부 - 검색으로 들어오는 사람도,
// 심사자도 대개 자치구 페이지에 먼저 떨어지고, 거기가 "표본이 모자라 비워 둔
// 칸"을 실제로 보게 되는 화면이다.
const CALLOUT_PAGES = async () => {
  const { readdir } = await import("node:fs/promises");
  const all = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html"));
  return all.filter(
    (f) =>
      f === "index.html" ||
      f === "realestate.html" ||
      f.startsWith("apartment-") ||
      f.startsWith("district-") ||
      f.startsWith("budget-")
  );
};

// 이 사이트가 대형 부동산 앱과 다른 점은 사실상 집계 기준을 밝힌다는 것 하나다.
// 그게 푸터 링크 한 줄로만 있으면 아무도 안 본다.
test("첫 화면에서 집계 기준으로 가는 길이 데이터보다 앞에 있다", async () => {
  const html = await indexHtml();
  const callout = html.indexOf('class="method-callout');
  const firstData = html.search(/<section id="/);

  assert.notEqual(callout, -1, "집계 기준 안내가 첫 화면에 없다");
  assert.ok(callout < firstData, "집계 기준 안내가 첫 데이터 섹션보다 뒤에 있다");
  assert.match(html.slice(callout, firstData), /href="\.\/method\.html"/, "method.html로 가지 않는다");
});

test("푸터 링크는 그대로 둔다", async () => {
  // 나머지 예순한 장은 여전히 푸터로만 닿는다.
  assert.match(await indexHtml(), /id="footer-method"/, "푸터 링크까지 걷어냈다");
});

test("시세 계열 전부가 같은 안내를 갖는다", async () => {
  const pages = await CALLOUT_PAGES();
  assert.ok(pages.length >= 47, `안내를 달 화면이 ${pages.length}장뿐이다`);

  for (const file of pages) {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    const callout = html.indexOf('class="method-callout');
    const firstData = html.search(/<section id="(market|overall)-section"/);
    assert.notEqual(callout, -1, `${SITE}/${file}에 집계 기준 안내가 없다`);
    assert.ok(callout < firstData, `${SITE}/${file}: 안내가 첫 데이터 섹션보다 뒤에 있다`);
    assert.match(html.slice(callout, firstData), /href="\.\/method\.html(#four-weeks(-en)?)?"/, `${SITE}/${file}: method.html로 가지 않는다`);
  }
});

// 안내 링크의 목적지는 이 셋뿐이다(#462). 시세 29장은 한국어 #four-weeks·영어 #four-weeks-en 으로 바로 가고,
// 예산대 18장과 index 는 method.html 맨 위다. 링크는 아래 calloutLinks 한 곳에서 읽는다.
const ALLOWED_HREFS = new Set(["./method.html", "./method.html#four-weeks", "./method.html#four-weeks-en"]);
const calloutLinks = (html) => {
  const start = html.indexOf('class="method-callout');
  const block = html.slice(start, html.indexOf("</aside>", start));
  return [...block.matchAll(/<a href="([^"]*)"([^>]*)>([^<]*)<\/a>/g)].map((m) => ({ href: m[1], attrs: m[2].trim(), text: m[3] }));
};

test("안내 링크의 href 는 허용 집합 셋뿐이고 시세 29장만 4주 문단으로 바로 간다 (#462)", async () => {
  const pages = await CALLOUT_PAGES();
  let sise = 0;
  let budget = 0;
  for (const file of pages) {
    const links = calloutLinks(await readFile(path.join(root, SITE, file), "utf8"));
    for (const l of links) assert.ok(ALLOWED_HREFS.has(l.href), `${SITE}/${file}: 허용 밖 href ${l.href}`);
    if (file === "index.html") {
      assert.deepEqual(links.map((l) => l.href), ["./method.html"], `${file}: index 는 링크 하나, 맨 위`);
    } else if (file.startsWith("budget-")) {
      budget += 1;
      assert.deepEqual(links.map((l) => [l.href, l.attrs]), [["./method.html", 'class="m-ko"'], ["./method.html", 'class="m-en"']], `${file}: 예산대는 두 링크 모두 맨 위`);
    } else {
      sise += 1;
      assert.deepEqual(
        links.map((l) => [l.href, l.attrs, l.text]),
        [
          ["./method.html#four-weeks", 'class="m-ko"', "숫자를 만드는 방법 →"],
          ["./method.html#four-weeks-en", 'class="m-en"', "How these numbers are made →"],
        ],
        `${file}: 시세 장은 한국어 #four-weeks · 영어 #four-weeks-en 쌍이어야 한다`
      );
    }
  }
  assert.equal(sise, 29, `시세 장이 ${sise}장이다 - 29장이어야 한다`);
  assert.equal(budget, 18, `예산대 장이 ${budget}장이다 - 18장이어야 한다`);
});

test("안내 링크가 가리키는 앵커가 method.html 에 있다 (#462)", async () => {
  const method = await readFile(path.join(root, SITE, "method.html"), "utf8");
  for (const id of ["four-weeks", "four-weeks-en"]) assert.match(method, new RegExp(`id="${id}"`), `method.html 에 #${id} 가 없다`);
});

test("시세·예산대 장은 안내 링크 글자를 스크립트가 쓰지 않는다 - 쌍이 구워져 있고 html lang 이 가린다 (#462)", async () => {
  for (const file of await CALLOUT_PAGES()) {
    if (file === "index.html") continue;
    const html = await readFile(path.join(root, SITE, file), "utf8");
    assert.ok(!html.includes("method-callout-link") && !html.includes("methodCalloutLink"), `${file}: 안내 링크 갱신 스크립트가 남았다`);
  }
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  assert.match(css, /html:lang\(en\) \.method-callout \.m-ko,\s*html:not\(:lang\(en\)\) \.method-callout \.m-en \{\s*display: none;/, "언어별 링크 가림 규칙이 없다");
});

test("시세 화면은 빈칸이 왜 비었는지를 먼저 말한다", async () => {
  // 표를 처음 본 사람이 가장 먼저 묻는 것이 "왜 이 구는 값이 없나"다.
  const html = await readFile(path.join(root, `${SITE}/realestate.html`), "utf8");
  const text = /<p id="method-callout-text"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
  assert.match(text, /5건/, "표본 기준을 안 밝힌다");
  assert.match(text, /4주/, "네 주 겹쳐 세는 것을 안 밝힌다");
});

test("안내가 데이터 앞을 막지 않는다", async () => {
  for (const file of ["index.html", "realestate.html"]) {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    const text = /<p id="method-callout-text"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? "";
    assert.ok(text.length > 0, `${SITE}/${file}: 안내 문구가 비었다`);
  // 3단계에서 시세표를 열한 행에서 다섯 행으로 접어 요약까지의 길을 줄여 놨다.
  // 이 안내가 길어지면 그때 번 자리를 도로 까먹는다. 지금 91자, 모바일 세 줄.
    assert.ok(text.length <= 120, `${SITE}/${file}: 안내가 ${text.length}자다 - 첫 화면을 도로 잡아먹는다`);
  }
});

const load = (storage) =>
  loadIndexPage({
    storage,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });

test("한국어 화면은 한국어로, 영어 화면은 영어로 말한다", async () => {
  const ko = await load();
  // #575: 태그라인과 겹치던 첫 문장(신고된 실거래)을 지웠다 - 남은 표본·신고 기한 문장으로 언어를 본다.
  assert.match(ko.byId("method-callout-text").textContent, /신고 기한이 30일/);
  assert.match(ko.byId("method-callout-link").textContent, /숫자를 만드는 방법/);

  const en = await load({ lang: "en" });
  assert.match(en.byId("method-callout-text").textContent, /30-day window/);
  assert.match(en.byId("method-callout-link").textContent, /How these numbers are made/);
  assert.ok(
    !/신고 기한/.test(en.byId("method-callout-text").textContent),
    "영어 화면에 한국어가 남았다"
  );
});

test("어느 화면에서든 안내는 120자 안이다 - 질문 화면도 데이터 앞을 막지 않게 (#47)", async () => {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html"));
  let seen = 0;
  for (const file of files) {
    const html = await readFile(path.join(root, SITE, file), "utf8");
    const text = /<p id="method-callout-text"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
    if (text === undefined) continue;
    seen += 1;
    assert.ok(text.length <= 120, `${SITE}/${file}: 안내가 ${text.length}자다`);
  }
  assert.ok(seen >= 52, `안내를 단 화면이 ${seen}장뿐이다 - 검사가 아무것도 안 본다`);
});

test("상자 모양은 역할마다 하나다 - 안내는 막대 없이, 카드·근거는 테두리만, 답만 막대 (#47)", async () => {
  const css = await readFile(path.join(root, "src/css/legacy.css"), "utf8");
  const rule = (sel) => new RegExp(`\\n${sel.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  assert.doesNotMatch(rule(".method-callout"), /border-left|accent-weak/, "안내가 답처럼 보인다");
  assert.doesNotMatch(rule(".complex-card"), /border-left/);
  assert.doesNotMatch(rule(".budget-loan"), /border-left|accent-weak/);
  assert.match(rule(".budget-answers"), /border-left: 3px solid var\(--accent\)/, "답이 답처럼 안 보인다");
});
