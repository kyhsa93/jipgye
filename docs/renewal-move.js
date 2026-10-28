// 재계약 vs 이사 비교 절(#777). 장 전용 외부 JS, gzip ≤2KB(#681) - 문구는 #mv-answer 의 data-msg(ko)·data-msg-en, "|" 로 나눈 89개.
// 계산은 move-cost.js 한 벌. 재계약 보증금은 위 확인기 칸(#check-old·#check-ask)을 그대로 읽는다. 입력은 URL에 싣지 않는다.
(() => {
  const $ = (id) => document.getElementById(id);
  const ids = $("move").getAttribute("data-i18n").split(" "); // 언어를 따라 글자를 바꾸는 요소(ko 는 구운 글자, en 은 data-en)
  const ko = ids.map((id) => $(id).textContent);
  const cap = $("mv-caption");
  const st = { src: "" }; // src: 비교할 집 금액이 참고값이면 "c"(단지 기준)·"d"(자치구 참고)
  const en = () => document.documentElement.getAttribute("lang") == "en";
  const fmt = (x) => Number(x).toLocaleString(en() ? "en-US" : "ko-KR", { maximumFractionDigits: 1 });
  // 숫자로 읽히지 않는 글자(badInput)는 브라우저가 value 를 비운다 - 빈칸이 아니라 잘못된 값("?")으로 읽는다(#792, 모든 칸).
  const v = (id) => ($(id).validity?.badInput ? "?" : String($(id).value ?? "").trim());
  const ym = (m) => `${m.slice(0, 4)}-${m.slice(4)}`;
  const bad = (id) => $(id).validity?.badInput;
  // 계측(#777 P4, audit/ga4-setup.md). 보내는 값은 정해진 낱말뿐이고 금액·금리·단지명은 서명(메모리)에만 둔다.
  const WAIT = 800; // = analytics.js SEARCH_DEBOUNCE_MS(시험이 대조): 같은 입력이 이만큼 머물러야 한 번으로 센다
  const A = () => window.analytics;
  const start = () => st.s || ((st.s = 1), A()?.event?.("compare_start", { calculator_type: "renewal_move" }));
  function measure(r, sig) {
    clearTimeout(st.ut);
    clearTimeout(st.rt);
    const rc = window.renewalCheck || {};
    const ok = r?.ok && r.comparable;
    const scope = !rc.row ? "inputs_only" : /^b:/.test(rc.area) ? "district_band" : "matched_complex";
    // 결과가 아니면 null 대신 마지막으로 센 서명을 넘긴다 - null 은 analytics.js 의 「마지막 서명」을 지워, 칸을 비웠다 같은 값을 다시 넣으면 또 센다.
    A()?.result?.("renewal_move", ok ? sig + scope : st.ls ?? null, ok && { result_scope: scope, result_outcome: r.cheaper ?? "even", result_round: st.n ? "repeat" : "first" });
    if (ok) st.rt = setTimeout(() => ((st.n = 1), (st.ls = sig + scope)), WAIT);
    // 비교 불가: 잘못된 입력·80% 가정 초과. 칸이 비어 있는 것(입력 중)은 세지 않고, 같은 사유는 장 하나에 한 번.
    const why = r && (r.ok ? !r.comparable && "cash_short" : r.errors.some((e) => e.code == "range") && "invalid_input");
    if (why && !st.u?.[why]) st.ut = setTimeout(() => (((st.u ||= {})[why] = 1), A()?.event?.("calculator_unavailable", { calculator_type: "renewal_move", unavailable_reason: why })), WAIT);
  }

  function render() {
    const M = $("mv-answer").getAttribute(en() ? "data-msg-en" : "data-msg").split("|");
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, j) => a[j]);
    // 표를 갈아 끼워도 caption 요소는 그대로 남긴다(#300) - innerHTML 로 지우면 다음 렌더가 그 요소를 못 찾는다.
    const out = (t, h = "") => (($("mv-answer").textContent = t), ($("mv-table").innerHTML = h), $("mv-table").prepend(cap));
    ids.forEach((id, i) => ($(id).textContent = en() ? $(id).getAttribute("data-en") : ko[i]));
    const kind = v("mv-kind") || "jeonse";
    if (st.l !== en()) {
      st.l = en(); // 선택지는 언어가 바뀔 때만 다시 쓴다
      $("mv-kind").innerHTML = `<option value="jeonse">${M[37]}</option><option value="wolse">${M[38]}</option>`;
      $("mv-kind").value = kind;
    }
    $("mv-rent-field").hidden = kind != "wolse";
    const old = Math.round(+v("check-old"));
    // 요구 보증금은 확인기 칸(#check-ask) 하나가 원본이고 ① 칸(#mv-ask)은 그 거울이다 - 같은 값을 두 번 넣게 하지 않는다(#792).
    const ask = bad("mv-ask") ? "?" : v("check-ask");
    if (!bad("mv-ask") && v("mv-ask") != v("check-ask")) $("mv-ask").value = v("check-ask");
    $("mv-renew").textContent = +ask > 0 ? (old > 0 ? f(0, fmt(old), fmt(+ask)) : f(1, fmt(+ask))) : "";
    $("mv-cash-fill").hidden = !(old > 0);
    $("mv-cash-fill").textContent = f(45, fmt(old));
    const opp = !!$("mv-opp").checked;
    const c = st.c;
    const C = jipgyeMoveCost;
    const r = ask !== "" && C.compare({ renew: ask, kind, deposit: v("mv-dep"), rent: v("mv-rent"), cash: v("mv-cash"), loanRate: v("mv-rate"), depositRate: v("mv-drate"), months: v("mv-months"), opportunity: opp, oneRenew: v("mv-once-renew"), oneMove: v("mv-once-move") });
    const d = r && C.describe(r, M, fmt, kind);
    // 칸 옆 안내(잘못된 값·금리 줄)·참고값 단추·근거 줄은 renewal-move-basis.js 가 같은 문맥으로 그린다 - 계산 결과(r·d)도 넘긴다.
    window.renewalMoveBasis?.({ M, f, fmt, ym, v, kind, c, st, render, start, opp, r, d });
    if (!r) return out(M[2]), measure(null), ($("mv-what-if").textContent = "");
    measure(r, JSON.stringify([ask, kind, v("mv-dep"), v("mv-rent"), v("mv-cash"), v("mv-rate"), v("mv-drate"), v("mv-months"), opp, v("mv-once-renew"), v("mv-once-move")]));
    $("mv-what-if").textContent = d.whatIf || "";
    const cell = (x, h) => (h ? `<th scope="${h}">${x}</th>` : `<td>${x}</td>`);
    out(d.text, d.rows && `<thead><tr><td>${d.head[0]}</td>${cell(d.head[1], "col")}${cell(d.head[2], "col")}</tr></thead><tbody>` +
      d.rows.map(([l, a, b]) => `<tr>${cell(l, "row")}${cell(a)}${cell(b)}</tr>`).join("") + "</tbody>");
  }

  fetch(`./data/conversion.json?_=${Date.now()}`).then((x) => (x.ok ? x.json() : null)).catch(() => null).then((c) => {
    st.c = c?.loan?.month && c.deposit?.month ? c : null;
    st.err = !st.c;
    if (st.c && !v("mv-rate")) $("mv-rate").value = c.loan.rate;
    if (st.c && !v("mv-drate")) $("mv-drate").value = c.deposit.rate;
    render();
  });
  ["check-old", "check-ask", "mv-dep", "mv-rent", "mv-cash", "mv-months", "mv-rate", "mv-drate", "mv-once-move", "mv-once-renew"].forEach((id) => $(id).addEventListener("input", () => (/mv-(dep|rent)/.test(id) && (st.src = ""), /^mv/.test(id) && start(), render())));
  window.renewalMove = render;
  // ① 칸에 넣으면 확인기 칸에 옮겨 적고 확인기를 다시 그린다(확인기가 이 절을 다시 그린다).
  $("mv-ask").addEventListener("input", () => (bad("mv-ask") || ($("check-ask").value = v("mv-ask")), start(), window.renderCheck ? renderCheck() : render()));
  ["mv-kind", "mv-opp", "lang-toggle"].forEach((id) => $(id).addEventListener(id == "lang-toggle" ? "click" : "change", () => (id != "lang-toggle" && start(), render())));
  $("mv-cash-fill").addEventListener("click", () => (($("mv-cash").value = Math.round(+v("check-old"))), start(), render()));
  render();
})();
