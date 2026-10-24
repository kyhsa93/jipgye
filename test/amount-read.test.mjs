// 금리 틀의 금액 칸 읽기 줄 (#498, PR-2 of #464). `type="number"` 칸은 쉼표를 못 보여 「300000000 이 몇인가」를 못 읽는다 - 칸 아래에
// `3억원 기준`을 한 줄 적는다(새 문구 0: 사전의 amountHint 재사용). po 판정은 ko 만, cto 판정은 줄이 페이지가 아니라 금액 칸이 있을 때 나온다:
// 틀 하나를 네 장이 공유하고 탭 단추가 네 장 모두에 있어 mortgage·rent-loan 장에서도 「예금·적금」 탭을 누르면 금액 칸이 나온다.
//
// 규칙: 정확하지 않으면 보이지 않는다. 만 단위로 딱 떨어지고 10,000 이상일 때만 N억 M,MMM만원으로 읽고, 아니면 빈 줄이다.
// fmtAmount 는 쓰지 않는다 - 억대 소수 한 자리(toFixed(1))라 125,000,000 이 1.3억원으로 틀리게 읽힌다.
//
// 이 시험은 손으로 만든 DOM(helpers/rates-page.mjs)에서 돈다. 거기서는 getElementById 가 없는 id 에도 노드를 만들어 주므로, 줄이 없는 화면(영어·대출 탭)의
// 널 안전은 getElementById 를 실제 DOM 처럼(구운 마크업에 없으면 null) 바꿔 끼워 따로 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { loadRatesPage } from "./helpers/rates-page.mjs";
import { SITE } from "./helpers/site-root.mjs";

const RATE_PAGES = ["deposit-rates", "saving-rates", "mortgage-rates", "rent-loan-rates"];
const fileOf = (name) => `${SITE}/${name}.html`;

// 입력 → 줄 (a). 줄 글자는 amountHint(ko) = `${won} 기준` 그대로다.
const READINGS = [
  ["300000000", "3억원 기준"],
  ["350000000", "3억 5,000만원 기준"],
  ["125000000", "1억 2,500만원 기준"], // fmtAmount 였다면 1.3억원
  ["123450000", "1억 2,345만원 기준"], // fmtAmount 였다면 1.2억원
  ["100010000", "1억 1만원 기준"],
  ["100000000", "1억원 기준"],
  ["10000", "1만원 기준"],
  ["50000000", "5,000만원 기준"],
  ["12345000000", "123억 4,500만원 기준"],
  ["9999", ""],
  ["", ""],
  ["300005000", ""], // 만 단위가 아니다
  ["15000.5", ""],
  ["0", ""],
  ["-5", ""],
  ["abc", ""],
  ["1e300", ""], // 안전한 정수 밖이라 정확히 읽을 수 없다
];

/** 입력 칸에 값을 넣어 보고 줄 글자가 표와 같은지 본다. 앞 값이 남아 보이는 것을 막으려고 매 사례 앞에 일부러 채운 값으로 되돌린다. */
function assertReadings(byId, label) {
  const input = byId.get("amount-input");
  const line = byId.get("amount-read");
  assert.ok(input && line, `${label}: 금액 칸이나 읽기 줄이 없다`);
  for (const [value, expected] of READINGS) {
    input.value = "200000000";
    input.dispatch("input");
    assert.equal(line.textContent, "2억원 기준", `${label}: 칸을 채웠는데 줄이 안 바뀐다`);
    input.value = value;
    input.dispatch("input");
    assert.equal(line.textContent, expected, `${label}: 「${value}」 → 「${line.textContent}」, 기대 「${expected}」`);
  }
}

/** 구운 마크업 대신 JS 가 채운 칸 마크업에서 줄 글자를 읽는다(첫 그림·탭 전환·언어 전환이 이 마크업을 다시 만든다). */
const lineInMarkup = (byId) => /<span class="amount-read" id="amount-read">([^<]*)<\/span>/.exec(byId.get("controls").innerHTML)?.[1] ?? null;

test("(a) 예금·적금 탭 모두에서 입력이 줄이 된다 - 3억·3.5억·125,000,000(1.3 이 아님)·9,999·빈 값·300,005,000", async () => {
  for (const name of ["deposit-rates", "saving-rates"]) {
    const { byId, clickTab } = await loadRatesPage({ file: fileOf(name) });
    const first = name === "deposit-rates" ? "deposit" : "saving";
    assertReadings(byId, `${name} ${first} 탭`);
    clickTab(first === "deposit" ? "saving" : "deposit");
    assertReadings(byId, `${name} ${first === "deposit" ? "saving" : "deposit"} 탭`);
  }
});

test("(a) 첫 그림(기본 금액·주소 금액)과 탭 전환은 입력 없이도 줄을 채운다", async () => {
  const deposit = await loadRatesPage({ file: fileOf("deposit-rates") });
  assert.equal(lineInMarkup(deposit.byId), "1,000만원 기준", "예치금 기본값(10,000,000)");
  deposit.clickTab("saving");
  assert.equal(lineInMarkup(deposit.byId), "30만원 기준", "적금 기본값(300,000)");

  const url = await loadRatesPage({ file: fileOf("deposit-rates"), search: "?amt=350000000" });
  assert.equal(lineInMarkup(url.byId), "3억 5,000만원 기준", "주소 금액으로 시작한 첫 그림");
  const odd = await loadRatesPage({ file: fileOf("deposit-rates"), search: "?amt=300005000" });
  assert.equal(lineInMarkup(odd.byId), "", "만 단위가 아닌 주소 금액은 빈 줄");
});

test("(b) 영어에는 줄이 없다 - span·aria-describedby 0, 입력해도 오류 0(널 안전)", async () => {
  for (const name of ["deposit-rates", "saving-rates"]) {
    const { byId, clickTab, sandbox } = await loadRatesPage({ file: fileOf(name), locale: "en" });
    // 실제 DOM 처럼: 마크업에 없는 id 는 null.
    const original = sandbox.document.getElementById;
    sandbox.document.getElementById = (id) => (id === "amount-read" && !byId.get("controls").innerHTML.includes('id="amount-read"') ? null : original.call(sandbox.document, id));
    for (const tab of ["deposit", "saving"]) {
      clickTab(tab === "deposit" ? "saving" : "deposit"); // 다시 그려 리스너를 새 getElementById 로 묶는다
      clickTab(tab);
      const controls = byId.get("controls").innerHTML;
      assert.ok(controls.includes('id="amount-input"'), `${name} ${tab}: 영어 금액 칸이 없다`);
      assert.ok(!controls.includes("amount-read") && !controls.includes("aria-describedby"), `${name} ${tab}: 영어 화면에 읽기 줄·aria-describedby 가 있다`);
      const input = byId.get("amount-input");
      for (const value of ["300000000", "350000000", "9999", "", "abc"]) {
        input.value = value;
        assert.doesNotThrow(() => input.dispatch("input"), `${name} ${tab}: 영어에서 「${value}」 입력이 오류를 던진다`);
      }
      input.value = "20000000";
      input.dispatch("input");
      assert.equal(sandbox.__state.amounts[tab], 20_000_000, `${name} ${tab}: 영어에서 입력이 상태에 안 닿는다`);
    }
  }
});

test("(c) 대출 장도 금액 칸이 나올 때 줄이 나오고, 대출 탭으로 돌아가면 사라진다", async () => {
  for (const [name, loanTab] of [["mortgage-rates", "mortgage"], ["rent-loan-rates", "rentLoan"]]) {
    const { byId, clickTab, sandbox } = await loadRatesPage({ file: fileOf(name) });
    sandbox.document.getElementById = ((original) => (id) => (id === "amount-read" && !byId.get("controls").innerHTML.includes('id="amount-read"') ? null : original.call(sandbox.document, id)))(sandbox.document.getElementById);
    clickTab(loanTab);
    assert.ok(!byId.get("controls").innerHTML.includes("amount-read"), `${name}: 대출 탭인데 줄이 있다`);
    clickTab("deposit");
    assert.equal(lineInMarkup(byId), "1,000만원 기준", `${name}: 예금 탭에 줄이 안 나온다`);
    assertReadings(byId, `${name} 예금 탭`);
    clickTab("saving");
    assert.equal(lineInMarkup(byId), "30만원 기준", `${name}: 적금 탭에 줄이 안 나온다`);
    clickTab(loanTab);
    const controls = byId.get("controls").innerHTML;
    assert.ok(!controls.includes("amount-read") && !controls.includes("amount-input") && !controls.includes("aria-describedby"), `${name}: 대출 탭으로 돌아왔는데 줄이 남았다`);
  }
});

test("(d) 접근성: aria-describedby 가 같은 마크업의 id 를 가리키고 aria-live·role 은 없다 - 줄은 칸과 같은 innerHTML 에 들어 새 이동 요소가 없다", async () => {
  for (const name of RATE_PAGES) {
    const { byId, clickTab } = await loadRatesPage({ file: fileOf(name) });
    clickTab("deposit");
    for (const tab of ["deposit", "saving"]) {
      clickTab(tab === "deposit" ? "saving" : "deposit");
      clickTab(tab);
      const controls = byId.get("controls").innerHTML;
      const target = /id="amount-input"[^>]*aria-describedby="([^"]+)"/.exec(controls)?.[1];
      assert.equal(target, "amount-read", `${name} ${tab}: 금액 칸이 줄을 aria-describedby 로 가리키지 않는다`);
      assert.equal(controls.split(`id="${target}"`).length - 1, 1, `${name} ${tab}: 가리키는 id 가 마크업에 정확히 하나 있어야 한다`);
      const span = /<span class="amount-read"[^>]*>/.exec(controls)[0];
      assert.ok(!/aria-live|role=/.test(span) && !controls.includes("aria-live"), `${name} ${tab}: 줄에 aria-live·role 이 있다(po 합격선: 없음)`);
    }
  }
});

test("(d) 틀: 새 리스너 0 - 금액 칸의 input 리스너는 여전히 하나이고 갱신은 그 리스너의 return 앞에서 한다", async () => {
  for (const name of RATE_PAGES) {
    const { byId } = await loadRatesPage({ file: fileOf(name), search: "?tab=deposit" });
    assert.equal(byId.get("amount-input").listeners.input.length, 1, `${name}: 금액 칸 input 리스너가 하나가 아니다`);
  }
  // 칸이 비었거나 0 이하·NaN 이면 리스너가 return 하므로 갱신이 그 앞에 있어야 줄이 비워진다 - (a)의 "빈 값"·"0"·"abc" 사례가 이것을 건다.
  const { byId } = await loadRatesPage({ file: fileOf("deposit-rates") });
  const input = byId.get("amount-input");
  input.value = "300000000";
  input.dispatch("input");
  input.value = "";
  input.dispatch("input");
  assert.equal(byId.get("amount-read").textContent, "", "빈 값인데 이전 줄이 남았다(갱신이 return 뒤에 있다)");
});

test("(e) 변이 사본: readAmount 가 fmtAmount 로 읽으면 (a) 가 걸린다(3.5억 → 3.5억원, 125,000,000 → 1.3억원)", async () => {
  const mutate = (script) => {
    const head = "function readAmount(won) {";
    assert.ok(script.includes(head), "readAmount 를 못 찾았다");
    return script.replace(head, `${head} return fmtAmount(won) ? T.ko.amountHint(fmtAmount(won)) : "";`);
  };
  const { byId } = await loadRatesPage({ file: fileOf("deposit-rates"), mutate });
  assert.throws(() => assertReadings(byId, "변이"), /3\.5억원/, "fmtAmount 로 읽는 사본이 (a) 를 통과한다");
  const input = byId.get("amount-input");
  input.value = "125000000";
  input.dispatch("input");
  assert.equal(byId.get("amount-read").textContent, "1.3억원 기준", "변이 사본이 125,000,000 을 1.3억원으로 읽는 것을 못박는다(진짜 코드는 1억 2,500만원)");
});
