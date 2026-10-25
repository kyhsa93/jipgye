import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

// 소개 장의 저장 고지와 지우기 (#654 후속 ②): 「내 조건 기억」이 localStorage 에 적는 것을 알리고 지울 수단을 둔다.
// search.js 는 한도(+5,000 B)가 거의 없어 건드리지 않고, 단추 몇 줄을 소개 장 인라인 스크립트에 둔다.
const root = path.resolve(import.meta.dirname, "..");
const html = await readFile(path.join(root, "docs/about.html"), "utf8");
const block = (lang) => new RegExp(`<div data-lang="${lang}"[^>]*>([\\s\\S]*?)\\n  </div>`).exec(html)[1];
const script = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)[1];
const buttons = (lang) => [...block(lang).matchAll(/<button type="button" data-clear[^>]*>[^<]*<\/button>/g)].map((m) => m[0]);

test("소개에 저장 고지가 한국어·영어 둘 다 있다 - 무엇을·어디에·왜 (#654)", () => {
  const ko = block("ko");
  const en = block("en");
  assert.match(ko, /<h2>이 브라우저에 저장하는 것<\/h2>/);
  for (const word of ["구", "면적", "예산", "지금 사는 구", "이 브라우저에만", "보내지 않습니다", "질문 링크"]) assert.ok(ko.includes(word), `한국어 고지에 「${word}」가 없다`);
  assert.match(en, /<h2>What this browser stores<\/h2>/);
  for (const word of ["district", "unit size", "budget", "current district", "this browser only", "sent nowhere", "question links"]) assert.ok(en.includes(word), `영어 고지에 「${word}」가 없다`);
  assert.equal(buttons("ko").length, 1);
  assert.equal(buttons("en").length, 1);
  assert.match(buttons("ko")[0], />지우기<\/button>$/);
  assert.match(buttons("en")[0], />Clear<\/button>$/);
  assert.ok(!/alert\(/.test(script), "alert() 를 쓰지 않는다");
});

/** 인라인 스크립트를 가짜 문서에 올린다. 단추는 소개 장 HTML 에서 읽은 data-done/data-fail 을 그대로 가진다. */
function run(lang, { throws = false } = {}) {
  const items = new Map([["myConditions", '{"district":"마포구"}'], ["theme", "dark"], ["lang", lang]]);
  const storage = {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => items.set(k, String(v)),
    removeItem: (k) => items.delete(k),
  };
  const tag = buttons(lang)[0];
  const status = { textContent: "" };
  const button = { dataset: { done: attr(tag, "data-done"), fail: attr(tag, "data-fail") }, nextElementSibling: status, onclick: null, addEventListener() {} };
  const el = () => ({ textContent: "", addEventListener() {}, classList: { toggle() {} }, getAttribute: () => lang });
  const ctx = {
    document: {
      querySelectorAll: (sel) => (sel === "[data-clear]" ? [button] : []),
      querySelector: () => el(),
      getElementById: () => el(),
      documentElement: { setAttribute() {}, removeAttribute() {} },
    },
  };
  const guard = { get: () => { throw new Error("storage blocked"); } };
  if (throws) {
    Object.defineProperty(ctx, "localStorage", guard);
    ctx.window = Object.defineProperty({}, "localStorage", guard);
  } else {
    ctx.localStorage = storage;
    ctx.window = { localStorage: storage };
  }
  vm.createContext(ctx);
  try {
    vm.runInContext(script, ctx);
  } catch (e) {
    // 저장소가 막히면 아래 테마 읽기에서 죽는다(이 시험이 지키는 것은 그 앞에 단 단추).
    assert.ok(throws, `저장소가 멀쩡한데 스크립트가 죽었다: ${e.message}`);
  }
  return { items, status, click: () => button.onclick(), button };
}

for (const lang of ["ko", "en"]) {
  test(`지우기 단추가 myConditions 만 지우고 짧은 확인 글을 보인다 - ${lang} (#654)`, () => {
    const page = run(lang);
    assert.equal(page.status.textContent, "", "누르기 전에는 확인 글이 없다");
    page.click();
    assert.equal(page.items.has("myConditions"), false, "myConditions 가 남았다");
    assert.equal(page.items.get("theme"), "dark", "테마까지 지웠다");
    assert.equal(page.items.get("lang"), lang, "언어까지 지웠다");
    assert.equal(page.status.textContent, page.button.dataset.done);
    assert.ok(page.status.textContent.length > 0 && page.status.textContent.length < 20);
  });

  test(`저장소가 막혀도 지우기는 예외 없이 실패 글을 보인다 - ${lang} (#654)`, () => {
    const page = run(lang, { throws: true });
    assert.doesNotThrow(() => page.click());
    assert.equal(page.status.textContent, page.button.dataset.fail);
    assert.notEqual(page.button.dataset.fail, page.button.dataset.done);
  });
}
