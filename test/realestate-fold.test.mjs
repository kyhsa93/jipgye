// #338 - 시세 틀 47장: 데이터 요청이 실패하면 추이 구획 자리 예약(.trend-reserve)이 빈 채로 725px 남던 것을, 화면 밖 몫만 접는다.
//
// 접는 일은 foldReserve() 하나이고, 실패가 확정된 세 자리에서만 부른다: 바깥 catch(경로 A: realestate.json 이 실패) ·
// 추이 응답이 !ok(경로 B) · 추이 요청이 reject(경로 B, 연결 실패). 정상·지연 경로는 한 줄도 안 지나간다.
// 접을 때는 화면 안에 들어오는 만큼(innerHeight - 윗변)만 남긴다 - 그래야 아래 구획이 선 안으로 올라오지 않아 이동이 0이다.
// 전면 철거(display: none)는 윗변이 접힘선 안인 4장에서 section#district-section 을 0.0112~0.1928 만큼 밀어 반려됐다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { stripInlineScriptComments } from "../scripts/strip-inline-comments.ts";
import { loadRealestatePage } from "./helpers/realestate-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const scriptOf = (html) => [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((m) => m[1]).pop();

const files = (await readdir(path.join(root, SITE))).filter((f) => f.endsWith(".html")).sort();
const pages = [];
for (const f of files) {
  const html = await read(`${SITE}/${f}`);
  if (html.includes('id="trend-section"')) pages.push({ file: f, script: scriptOf(html) });
}

const DEF = /function foldReserve\(\) \{\n {2}const box = trendSection\.nextElementSibling;\n {2}const room = innerHeight - box\.getBoundingClientRect\(\)\.top;\n {2}if \(room < box\.offsetHeight\) box\.style\.cssText = `height:\$\{Math\.max\(room, 0\)\}px;overflow:hidden`;\n\}\n\n/;
const OUTER = "  } catch (error) {\n    reportLoadFailure(error);\n    foldReserve();\n";
const TREND_SITES = "        renderTrend();\n      } else {\n        foldReserve();\n      }\n    } catch {\n      foldReserve();\n    }\n";
// 접는 줄을 걷어 낸 모양 - 이 PR 이 스크립트에 더한 바이트를 되재는 데 쓴다.
const withoutFold = (script) =>
  script
    .replace(DEF, "")
    .replace("      } else {\n        foldReserve();\n      }\n", "      }\n")
    .replace("    } catch {\n      foldReserve();\n    }\n", "    } catch {\n    }\n")
    .replace("    reportLoadFailure(error);\n    foldReserve();\n", "    reportLoadFailure(error);\n");

test("추이 구획이 있는 장은 47장이고 전부 foldReserve 를 4번(정의 1 + 호출 3) 갖는다 (#338)", () => {
  assert.equal(pages.length, 47, `추이 구획이 있는 장이 ${pages.length}장이다 - 47장이어야 이 PR 의 범위와 같다`);
  for (const { file, script } of pages) {
    assert.equal(script.match(/foldReserve/g)?.length, 4, `${SITE}/${file}: foldReserve 가 정의 1 + 호출 3 이 아니다 - 호출이 정상·지연 경로로 새거나 세 자리 중 하나가 빠졌다`);
  }
});

test("호출은 실패가 확정된 세 자리에만 있다: 바깥 catch · 추이 !ok · 추이 안쪽 catch (#338)", async () => {
  const template = scriptOf(stripInlineScriptComments(await read("scripts/realestate-template.html")));
  for (const [name, script] of [["scripts/realestate-template.html", template], ...pages.map((p) => [`${SITE}/${p.file}`, p.script])]) {
    assert.match(script, DEF, `${name}: foldReserve 정의가 계약한 모양이 아니다`);
    assert.ok(script.includes(OUTER), `${name}: 경로 A - 바깥 catch 에서 reportLoadFailure 바로 뒤에 foldReserve() 가 없다`);
    assert.ok(script.includes(TREND_SITES), `${name}: 경로 B - 추이 !ok 의 else 와 안쪽 catch 에 foldReserve() 가 없다`);
    // 세 호출 모두 실패 갈래 안이다: 정상 경로(try 의 본문)에는 foldReserve 가 없다.
    const main = script.slice(script.indexOf("async function main()"));
    const tryBody = main.slice(main.indexOf("  try {"), main.indexOf("  } catch (error) {"));
    assert.equal(tryBody.match(/foldReserve/g)?.length, 2, `${name}: 정상 경로(try 본문)에 foldReserve 가 ${tryBody.match(/foldReserve/g)?.length}번 - 추이 실패 갈래 둘뿐이어야 한다`);
    assert.ok(!/finally/.test(main), `${name}: finally 를 쓰면 정상 경로도 지나간다`);
  }
});

test("접는 대상 trendSection.nextElementSibling 은 47장 모두 빈 칸 셋을 가진 .trend-reserve 다 (#338)", async () => {
  const template = await read("scripts/realestate-template.html");
  for (const [name, html] of [["scripts/realestate-template.html", template], ...(await Promise.all(pages.map(async (p) => [`${SITE}/${p.file}`, await read(`${SITE}/${p.file}`)])))]) {
    const open = html.indexOf('<section id="trend-section"');
    assert.ok(open >= 0, `${name}: 추이 구획 여는 태그를 못 찾았다`);
    const close = html.indexOf("</section>", open);
    assert.match(html.slice(close + "</section>".length, close + 200), /^\s*<div class="trend-reserve tw:mb-10 tw:1024:mb-16">\s*<div class="[^"]+">\s*<div class="trend-reserve-card"><\/div>/, `${name}: 추이 구획 바로 뒤 형제가 .trend-reserve 가 아니다 - 접는 줄이 엉뚱한 상자를 접거나 null 에서 던진다(실패 때 다시 시도 단추가 안 그려진다)`);
  }
});

test("새 훅을 만들지 않는다: dataset·id·data-*·class 를 쓰지 않고 틀의 .trend-reserve 를 JS 가 읽지도 않는다 (#338)", () => {
  for (const { file, script } of pages) {
    assert.ok(!/dataset/.test(script), `${SITE}/${file}: dataset 을 쓴다 - 새 data-* 훅이다`);
    assert.ok(!/classList\.(add|toggle)\(["']trend/.test(script), `${SITE}/${file}: 추이 예약에 class 를 단다`);
    assert.ok(!/querySelector\(["'][^"']*trend-reserve/.test(script) && !/getElementsByClassName\(["']trend-reserve/.test(script), `${SITE}/${file}: .trend-reserve 를 JS 가 class 로 읽는다 - hook-classes.json 이 바뀐다`);
    const fold = script.match(DEF)[0];
    assert.ok(fold.includes("trendSection.nextElementSibling"), `${SITE}/${file}: 접는 대상을 trendSection.nextElementSibling 으로 잡지 않는다`);
  }
});

test("S6 의도한 차이: 장당 +360B 이하, 47장 합 16,920B 이하, 외부 JS 0 (#338)", () => {
  let total = 0;
  for (const { file, script } of pages) {
    const added = Buffer.byteLength(script) - Buffer.byteLength(withoutFold(script));
    assert.ok(added > 0, `${SITE}/${file}: 접는 줄을 걷어 냈는데 바이트가 안 줄었다 - 걷는 모양이 틀렸다`);
    assert.ok(added <= 360, `${SITE}/${file}: 접는 줄이 ${added}B - cto 한도 360B/장을 넘었다(넘으면 병합 전에 cto 가 다시 판정한다)`);
    assert.doesNotMatch(script, /\/\/|\/\*/, `${SITE}/${file}: 접는 줄에 주석이 구워져 나갔다`);
    total += added;
  }
  assert.ok(total <= 16_920, `47장 합 ${total}B - cto 한도 16,920B 를 넘었다`);
});

test("틀의 foldReserve 는 구운 47장에 한 글자도 다르지 않게 실려 있다 (#338)", async () => {
  const template = scriptOf(stripInlineScriptComments(await read("scripts/realestate-template.html")));
  const def = template.match(DEF)[0];
  for (const { file, script } of pages) assert.ok(script.includes(def), `${SITE}/${file}: 틀의 foldReserve 와 다르다 - 틀을 고치고 굽지 않았다`);
});

// ---- 동작 ----
// 예약 상자 스텁. offsetHeight 는 접은 뒤의 높이를 따라간다(진짜 상자처럼).
const reserve = (top, height = 725) => {
  const box = {
    style: { cssText: "" },
    rectReads: 0,
    getBoundingClientRect() {
      this.rectReads += 1;
      return { top };
    },
  };
  Object.defineProperty(box, "offsetHeight", {
    get: () => {
      const m = /height:(-?[\d.]+)px/.exec(box.style.cssText);
      return m ? Math.max(Number(m[1]), 0) : height;
    },
  });
  return box;
};
const metrics = (offset = 0) => ({
  sale: { avgPricePerPyeong10k: 4400 + offset, transactionCount: 50 },
  saleNational84: { avgPricePerPyeong10k: 4100 + offset, transactionCount: 30 },
  jeonse: { avgDepositPerPyeong10k: 2500 + offset, transactionCount: 40 },
  wolse: { avgDeposit10k: 22000 + offset, avgMonthlyRent10k: 96, transactionCount: 35 },
});
const REALESTATE = { period: "202608", updatedAt: "2026-08-15T00:00:00.000Z", overall: metrics(), districts: [{ code: "11680", name: "강남구", ...metrics(500) }] };
const TREND = { weeks: ["2026-08-03", "2026-08-10"], overall: { "2026-08-03": metrics(-20), "2026-08-10": metrics() }, districts: { 강남구: { "2026-08-03": metrics(480), "2026-08-10": metrics(500) } } };

const open = async ({ top, innerHeight = 823, height, file = `${SITE}/realestate.html`, fail = [], reject = [], budget } = {}) => {
  const box = reserve(top, height);
  const gate = async (name) => {
    if (reject.includes(name)) throw new TypeError("Failed to fetch");
  };
  const data = { realestate: REALESTATE, trend: TREND, budget, complexRatio: undefined };
  if (fail.includes("realestate")) delete data.realestate;
  if (fail.includes("realestate-trend")) delete data.trend;
  if (fail.includes("budget-deals")) delete data.budget;
  const page = await loadRealestatePage({ ...data, file, gate, baked: { "trend-section": { nextElementSibling: box } }, globals: { innerHeight } });
  return { box, page };
};

test("경로 A(realestate.json 이 404): 윗변이 접힘선 안이면 화면 안 몫만 남기고, 밖이면 0 으로 접는다 (#338)", async () => {
  const inside = await open({ top: 730, fail: ["realestate"] });
  assert.equal(inside.box.style.cssText, "height:93px;overflow:hidden", "윗변 730 · 창 823 이면 93px 만 남겨야 한다");
  const outside = await open({ top: 1651, fail: ["realestate"] });
  assert.equal(outside.box.style.cssText, "height:0px;overflow:hidden", "윗변이 접힘선 아래면 높이 0 으로 접어야 한다(음수 높이를 쓰지 않는다)");
});

test("경로 A(realestate.json 요청이 reject): 같은 규칙으로 접는다 (#338)", async () => {
  const { box } = await open({ top: 776, reject: ["realestate"] });
  assert.equal(box.style.cssText, "height:47px;overflow:hidden");
});

test("경로 B(realestate-trend.json 이 404): 접는다 - 추이 응답이 !ok 인 갈래 (#338)", async () => {
  const { box, page } = await open({ top: 730, fail: ["realestate-trend"] });
  assert.equal(box.style.cssText, "height:93px;overflow:hidden");
  assert.match(page.tableHtml(), /overall-row/, "경로 B 에서는 표가 그려져 있어야 한다(realestate.json 은 성공했다)");
  const far = await open({ top: 5439, fail: ["realestate-trend"] });
  assert.equal(far.box.style.cssText, "height:0px;overflow:hidden");
});

test("경로 B(realestate-trend.json 요청이 reject): 접는다 - 추이 요청의 안쪽 catch 갈래 (#338)", async () => {
  const { box } = await open({ top: 730, reject: ["realestate-trend"] });
  assert.equal(box.style.cssText, "height:93px;overflow:hidden");
  const far = await open({ top: 1651, reject: ["realestate-trend"] });
  assert.equal(far.box.style.cssText, "height:0px;overflow:hidden");
});

test("키 큰 화면(창이 예약보다 높음)에서는 접지 않는다 - 접으면 아래 구획이 선 안으로 올라온다 (#338)", async () => {
  for (const fail of [["realestate"], ["realestate-trend"]]) {
    const { box } = await open({ top: 582, innerHeight: 1400, fail });
    assert.equal(box.style.cssText, "", `창 1400 · 윗변 582 · 예약 725 인데 ${box.style.cssText} 로 바꿨다`);
  }
  // 경계: room == 예약 높이면 접지 않는다(room < 높이 일 때만). 한 칸 모자라면 접는다.
  const edge = await open({ top: 98, innerHeight: 823, fail: ["realestate"] });
  assert.equal(edge.box.style.cssText, "", "room 725 == 높이 725 인데 접었다");
  const under = await open({ top: 99, innerHeight: 823, fail: ["realestate"] });
  assert.equal(under.box.style.cssText, "height:724px;overflow:hidden");
});

test("정상 경로·다른 요청의 실패는 예약을 건드리지도 재지도 않는다 (#338)", async () => {
  const normal = await open({ top: 730 });
  assert.equal(normal.box.style.cssText, "");
  assert.equal(normal.box.rectReads, 0, "정상 경로에서 예약 상자의 위치를 읽었다 - 정상 경로를 한 줄도 안 지나가야 한다");
  // complex-ratio.json 실패는 추이와 상관없다(스크립트가 삼킨다).
  const ratio = await open({ top: 730, fail: ["complex-ratio"] });
  assert.equal(ratio.box.rectReads, 0);
  // 예산 장에서 budget-deals.json 이 실패해도 추이 예약은 그대로다.
  const budget = await open({ top: 5439, file: `${SITE}/budget-7eok.html`, fail: ["budget-deals"] });
  assert.equal(budget.box.style.cssText, "", "budget-deals.json 실패에서 추이 예약을 접었다");
  assert.equal(budget.box.rectReads, 0);
});

test("다시 시도: 또 실패해도 접힌 높이를 늘리지 않고, 접은 상태에서 다시 부르면 그대로다 (#338)", async () => {
  const { box, page } = await open({ top: 730, fail: ["realestate"] });
  assert.equal(box.style.cssText, "height:93px;overflow:hidden");
  const retry = page.byId("load-retry");
  assert.ok(retry.listeners.click?.length, "다시 시도 단추에 핸들러가 없다");
  retry.dispatch("click", { currentTarget: retry });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(box.style.cssText, "height:93px;overflow:hidden", "다시 시도가 또 실패했는데 접은 높이가 바뀌었다");
});
