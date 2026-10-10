import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { budgetRulesHtml } from "../scripts/budget-rules.mjs";
import { escapeHtml } from "../scripts/prerender.mjs";
import { COSTS_RULES } from "../scripts/purchase-costs.mjs";
import { MIN_CASH_RULES } from "../scripts/min-cash.mjs";
import { POLICY_LINES, POLICY_TAIL } from "../scripts/policy-loan.mjs";
import { CAP_RULES_HIGH } from "../scripts/loan-cap.mjs";
import { BUDGET_PAGES } from "../scripts/budget-pages.mjs";

// #66: 예산대 18장에 똑같이 실리던 규칙 문단은 method.html 한 자리에만 있고, 장에는 링크만 남는다.
// 값(금리·거래 수)에 기대는 문장은 데이터에 따라 달라지므로 여기서 단정하지 않는다(#8) - 글자가 고정인 규칙만 본다.

const root = path.resolve(import.meta.dirname, "..");
const RULES = { COSTS_RULES, MIN_CASH_RULES, POLICY_LINES, POLICY_TAIL, CAP_RULES_HIGH };

test("규칙 문단은 데이터가 없어도 method.html 자리에 글자 그대로 구워진다", () => {
  const html = budgetRulesHtml();
  for (const [name, text] of Object.entries(RULES)) {
    assert.ok(html.includes(escapeHtml(text)), `${name}가 규칙 자리에 없다`);
  }
  for (const id of ["loan", "costs", "mincash", "cap", "policy"]) {
    assert.match(html, new RegExp(`id="budget-rules-${id}"`));
  }
});

test("method.html에는 규칙 문단이 한 번씩만 있다", async () => {
  const method = await readFile(path.join(root, "docs/method.html"), "utf8");
  for (const [name, text] of Object.entries(RULES)) {
    const count = method.split(escapeHtml(text)).length - 1;
    assert.equal(count, 1, `${name}가 method.html에 ${count}번 있다`);
  }
});

test("예산대 18장에는 옮긴 규칙 문단이 없고 method.html 링크가 있다", async () => {
  for (const page of BUDGET_PAGES) {
    const html = await readFile(path.join(root, "docs", page.file), "utf8");
    for (const [name, text] of Object.entries(RULES)) {
      assert.ok(!html.includes(escapeHtml(text)), `${page.file}에 ${name}가 또 실렸다`);
    }
    for (const id of ["loan", "costs", "mincash"]) {
      assert.match(html, new RegExp(`href="\\./method\\.html#budget-rules-${id}"`), `${page.file}: ${id} 링크가 없다`);
    }
  }
});
