import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { loadIndexPage } from "./helpers/index-page.mjs";

// 머리 버튼 셋(공유·테마·언어)의 aria-label이 페이지 언어를 따른다 (#112).
// 두 층을 본다: ① 정적 HTML(첫 화면, 스크립트가 돌기 전·돌지 않을 때 스크린리더가 읽는 값),
// ② 언어 전환 클릭 뒤(html lang이 바뀌면 nav.js가 세 버튼을 다시 맞춘다).
// 예순여덟 장이 각자 인라인 전환 핸들러를 갖고 있어 장마다 고치지 않고 nav.js 한 곳에서 따라간다 -
// 그 전제(모든 장이 nav.js를 불러오고, 전환 때 html lang을 바꾼다)를 ③에서 소스로 확인한다.

const root = path.resolve(import.meta.dirname, "..");
const docs = path.join(root, "docs");
const pages = async () =>
  Promise.all(
    (await readdir(docs))
      .filter((f) => f.endsWith(".html"))
      .sort()
      .map(async (f) => ({ file: f, html: await readFile(path.join(docs, f), "utf8") }))
  );

const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;

const buttonLabel = (html, id) =>
  new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`).exec(html)?.[0].match(/\baria-label="([^"]*)"/)?.[1] ?? null;

test("정적 HTML: lang이 ko면 영어 aria-label이 없고 en이면 한국어가 없다", async () => {
  const bad = [];
  const seen = { "theme-toggle": 0, "lang-toggle": 0, "share-button": 0 };
  for (const { file, html } of await pages()) {
    const lang = /<html lang="([a-z]+)"/.exec(html)?.[1];
    for (const id of Object.keys(seen)) {
      const label = buttonLabel(html, id);
      if (label === null) continue;
      seen[id] += 1;
      if (lang === "ko" && LATIN.test(label)) bad.push(`${file} #${id} "${label}"`);
      if (lang === "en" && HANGUL.test(label)) bad.push(`${file} #${id} "${label}"`);
    }
  }
  assert.ok(seen["theme-toggle"] > 60 && seen["lang-toggle"] > 60, `버튼을 못 찾았다 ${JSON.stringify(seen)} - 검사가 헛돈다`);
  assert.ok(seen["share-button"] >= 2, "정적 공유 버튼을 못 찾았다");
  assert.equal(bad.length, 0, `언어와 어긋난 aria-label ${bad.length}개: ${bad.slice(0, 5).join(" | ")}`);
});

// nav.js를 가짜 문서에서 돌린다. MutationObserver는 html의 lang 변경만 흉내 낸다.
async function runNav(initialLang) {
  const source = await readFile(path.join(docs, "nav.js"), "utf8");
  const els = new Map();
  const button = (id, label) => {
    const attrs = { "aria-label": label };
    return {
      id,
      className: "icon-toggle",
      type: "",
      firstChild: { textContent: "" },
      setAttribute: (k, v) => (attrs[k] = v),
      getAttribute: (k) => attrs[k] ?? null,
      addEventListener() {},
      set innerHTML(_) {},
    };
  };
  // 정적 HTML이 ko로 박아 둔 값에서 시작한다.
  els.set("theme-toggle", button("theme-toggle", "테마 전환"));
  els.set("lang-toggle", button("lang-toggle", "언어 전환"));
  const children = [els.get("theme-toggle"), els.get("lang-toggle")];
  const actions = {
    querySelector: () => children[0],
    insertBefore: (el) => {
      children.unshift(el);
      els.set(el.id, el);
    },
    get firstChild() {
      return children[0];
    },
  };
  let lang = initialLang;
  const observers = [];
  const documentElement = {
    getAttribute: (k) => (k === "lang" ? lang : null),
    setAttribute(k, v) {
      if (k !== "lang") return;
      lang = v;
      for (const cb of observers) cb([{ type: "attributes", attributeName: "lang" }]);
    },
  };
  const sandbox = {
    document: {
      documentElement,
      querySelectorAll: () => [],
      querySelector: (sel) => (sel === ".header-actions" ? actions : null),
      getElementById: (id) => els.get(id) ?? null,
      createElement: () => button("", ""),
    },
    window: { addEventListener() {} },
    MutationObserver: class {
      constructor(cb) {
        observers.push(cb);
      }
      observe() {}
    },
  };
  vm.runInNewContext(source, sandbox);
  const labels = () => ({
    share: els.get("share-button")?.getAttribute("aria-label"),
    theme: els.get("theme-toggle").getAttribute("aria-label"),
    lang: els.get("lang-toggle").getAttribute("aria-label"),
  });
  return { labels, switchTo: (next) => documentElement.setAttribute("lang", next) };
}

test("언어 전환 뒤: ko -> en 에서 세 버튼이 영어로 맞는다", async () => {
  const page = await runNav("ko");
  assert.deepEqual(page.labels(), { share: "공유", theme: "테마 전환", lang: "언어 전환" });
  page.switchTo("en");
  assert.deepEqual(page.labels(), { share: "Share", theme: "Toggle theme", lang: "Switch language" });
});

test("언어 전환 뒤: en -> ko 에서 세 버튼이 한국어로 돌아온다", async () => {
  const page = await runNav("en");
  assert.deepEqual(page.labels(), { share: "Share", theme: "Toggle theme", lang: "Switch language" });
  page.switchTo("ko");
  assert.deepEqual(page.labels(), { share: "공유", theme: "테마 전환", lang: "언어 전환" });
});

test("모든 장이 nav.js를 불러오고, 전환하면 html lang을 바꾼다", async () => {
  const bad = [];
  for (const { file, html } of await pages()) {
    if (!/<script src="\.\/nav\.js"/.test(html)) bad.push(`${file}: nav.js 없음`);
    if (!/documentElement\.(setAttribute\("lang"|lang\s*=)/.test(html)) bad.push(`${file}: html lang을 안 바꾼다`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 5).join(" | "));
});

test("첫 화면: 언어 버튼을 누르면 html lang이 바뀐다 (nav.js가 따라갈 신호)", async () => {
  const page = await loadIndexPage({ fetch: async () => ({ ok: false, json: async () => ({}) }) });
  const calls = [];
  page.app.document.documentElement.setAttribute = (k, v) => calls.push([k, v]);
  page.byId("lang-toggle").dispatch("click");
  assert.deepEqual(calls.filter(([k]) => k === "lang").at(-1), ["lang", "en"]);
});
