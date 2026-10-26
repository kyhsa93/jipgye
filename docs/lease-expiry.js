// 전월세 만기 달력(#674 N2). 장 전용 외부 JS, gzip ≤2KB(#681 예외) - 문구는 #ex-answer 의 data-msg(ko)·data-msg-en, "|" 로 나눈 12개.
// 자료: lease-expiry.json(scripts/lease-expiry.ts). 칸 null = 5건 미만. 앞 석 달(partial)은 「일부만 집계」와 잡힌 몫. 고른 구는 URL에 싣지 않는다.
(() => {
  const $ = (id) => document.getElementById(id);
  const ids = ["ex-heading", "ex-gu-label", "ex-note", "ex-legal", "ex-source"];
  const ko = ids.map((id) => $(id).textContent);
  let d;
  let err;
  const en = () => document.documentElement.getAttribute("lang") == "en";
  const n = (x) => (x == null ? "-" : x.toLocaleString(en() ? "en-US" : "ko-KR"));
  const ym = (m) => m.slice(0, 4) + "." + m.slice(4);

  function render() {
    const M = $("ex-answer").getAttribute(en() ? "data-msg-en" : "data-msg").split("|");
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, k) => a[k]);
    ids.forEach((id, i) => ($(id).textContent = en() ? $(id).getAttribute("data-en") : ko[i]));
    $("ex-answer").textContent = err ? M[7] : "";
    if (!d) return;
    const sel = $("ex-gu");
    const v = sel.value;
    sel.innerHTML = [["", M[0]], ...Object.keys(d.districts).map((k) => [k, k])].map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    sel.value = d.districts[v] ? v : "";
    const r = d.districts[sel.value] || d.seoul;
    const p = d.partial.length;
    const max = Math.max(...r.t.map((x) => x || 0)) || 1;
    let best = -1;
    r.t.forEach((x, i) => i >= p && x != null && (best < 0 || x > r.t[best]) && (best = i));
    const sum = r.t.reduce((a, x) => a + (x || 0), 0);
    if (best >= 0) $("ex-answer").textContent = f(8, sel.value || M[0], ym(d.months[0]), ym(d.months.at(-1)), n(sum), ym(d.months[best]), n(r.t[best]));
    $("ex-table").innerHTML =
      `<caption class="sr-only">${$("ex-heading").textContent} (${ym(d.months[0])}~${ym(d.months.at(-1))})</caption><thead><tr>${[1, 2, 3, 4, 5].map((i) => `<th scope="col" style="white-space:normal">${M[i]}</th>`).join("")}</tr></thead><tbody>` +
      d.months
        .map(
          (m, i) =>
            `<tr><th scope="row">${ym(m)}${i < p ? `<br><span class="low-sample" style="white-space:normal">${M[6]}</span>` : ""}</th><td>${n(r.t[i])}<span aria-hidden="true" style="display:block;height:4px;background:currentColor;opacity:.45;width:${Math.round(((r.t[i] || 0) / max) * 100)}%"></span></td><td>${n(r.j[i])}</td><td>${n(r.w[i])}</td><td>${n(r.u[i])}</td></tr>`
        )
        .join("") +
      "</tbody>";
    const sep = en() ? ", " : "·";
    $("ex-partial").textContent =
      (d.capture.every((c) => c != null) ? f(9, d.partial.map(ym).join(sep), d.capture.map((c) => c + "%").join(sep)) : "") +
      (r.missing ? f(10, r.missing.length) : "") +
      (["t", "j", "w", "u"].some((k) => r[k].includes(null)) ? f(11) : "");
  }

  fetch(`./data/lease-expiry.json?_=${Date.now()}`)
    .then((x) => (x.ok ? x.json() : null))
    .catch(() => null)
    .then((x) => {
      d = x?.months?.length && x.seoul ? x : null;
      err = !d;
      render();
    });
  $("ex-gu").addEventListener("change", render);
  $("lang-toggle").addEventListener("click", render);
  render();
})();
