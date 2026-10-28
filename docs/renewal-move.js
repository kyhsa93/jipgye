// 재계약 vs 이사 비교 절(#777). 장 전용 외부 JS, gzip ≤2KB(#681) - 문구는 #mv-answer 의 data-msg(ko)·data-msg-en, "|" 로 나눈 47개.
// 계산은 move-cost.js 한 벌. 재계약 보증금은 위 확인기 칸(#check-old·#check-ask)을 그대로 읽는다. 입력은 URL에 싣지 않는다.
(() => {
  const LAG = 4; // = scripts/check-data-progress.ts MONTHLY_LAG.jeonse_loan_rate + 1 (시험이 대조): 이보다 오래된 금리는 알린다
  const $ = (id) => document.getElementById(id);
  const ids = ["mv-heading", "mv-kind-label", "mv-dep-label", "mv-rent-label", "mv-cash-label", "mv-rate-label", "mv-months-label", "mv-cash-help", "mv-opp-label", "mv-drate-label", "mv-caption", "mv-legal", "mv-source"];
  const ko = ids.map((id) => $(id).textContent);
  const cap = $("mv-caption");
  const st = { r: 1, d: 1 };
  const en = () => document.documentElement.getAttribute("lang") == "en";
  const fmt = (x) => Number(x).toLocaleString(en() ? "en-US" : "ko-KR", { maximumFractionDigits: 1 });
  const v = (id) => String($(id).value ?? "").trim();
  const ym = (m) => `${m.slice(0, 4)}-${m.slice(4)}`;
  const mon = (y, m) => y * 12 + +m;
  function render() {
    const M = $("mv-answer").getAttribute(en() ? "data-msg-en" : "data-msg").split("|");
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, j) => a[j]);
    // 표를 갈아 끼워도 caption 요소는 그대로 남긴다(#300) - innerHTML 로 지우면 다음 렌더가 그 요소를 못 찾는다.
    const out = (t, h = "") => (($("mv-answer").textContent = t), ($("mv-table").innerHTML = h), $("mv-table").prepend(cap));
    ids.forEach((id, i) => ($(id).textContent = en() ? $(id).getAttribute("data-en") : ko[i]));
    const kind = v("mv-kind") || "jeonse";
    $("mv-kind").innerHTML = `<option value="jeonse">${M[37]}</option><option value="wolse">${M[38]}</option>`;
    $("mv-kind").value = kind;
    $("mv-rent-field").hidden = kind != "wolse";
    const old = Math.round(+v("check-old"));
    const ask = v("check-ask");
    $("mv-renew").textContent = +ask > 0 ? (old > 0 ? f(0, fmt(old), fmt(+ask)) : f(1, fmt(+ask))) : "";
    $("mv-cash-fill").hidden = !(old > 0);
    $("mv-cash-fill").textContent = f(45, fmt(old));
    const opp = !!$("mv-opp").checked;
    const c = st.c;
    let note = st.err ? M[44] : "";
    if (c) {
      note = st.r ? f(39, ym(c.loan.month)) : M[40];
      if (opp) note += st.d ? f(41, ym(c.deposit.month)) : M[42];
      const at = new Date(Date.parse(c.updatedAt) + 324e5).toISOString();
      const seen = [c.loan.month, c.deposit.month].sort()[0];
      if (mon(at.slice(0, 4), at.slice(5, 7)) - mon(seen.slice(0, 4), seen.slice(4)) > LAG) note += f(43, ym(seen));
    }
    $("mv-rate-note").textContent = note;
    if (!(+ask > 0)) return out(M[2]);
    const C = jipgyeMoveCost;
    const r = C.compare({ renew: ask, kind, deposit: v("mv-dep"), rent: v("mv-rent"), cash: v("mv-cash"), loanRate: v("mv-rate"), depositRate: v("mv-drate"), months: v("mv-months"), opportunity: opp });
    const d = C.describe(r, M, fmt, kind);
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
  ["check-old", "check-ask", "mv-dep", "mv-rent", "mv-cash", "mv-months", "mv-rate", "mv-drate"].forEach((id) => $(id).addEventListener("input", () => (id == "mv-rate" && (st.r = 0), id == "mv-drate" && (st.d = 0), render())));
  ["mv-kind", "mv-opp", "lang-toggle"].forEach((id) => $(id).addEventListener(id == "lang-toggle" ? "click" : "change", render));
  $("mv-cash-fill").addEventListener("click", () => (($("mv-cash").value = Math.round(+v("check-old"))), render()));
  render();
})();
