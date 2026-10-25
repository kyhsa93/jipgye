// 반전세 전환 계산기(#673). 장 전용 외부 JS, gzip ≤2KB(#681) - 문구는 #cv-answer 의 data-msg(ko)·data-msg-en, "|" 로 나눈 14개.
// 시장: conversion.json 칸(단지쌍 MIN 미만이면 서울). 상한: min(10, 기준금리+2). 월세 = 금액×율÷12. 입력은 URL에 싣지 않는다.
(() => {
  const MIN = 3; // = scripts/conversion.ts MIN_PAIRS(시험이 대조)
  const $ = (id) => document.getElementById(id);
  const ids = ["cv-heading", "cv-gu-label", "cv-band-label", "cv-dep-label", "cv-amt-label", "cv-legal", "cv-source"];
  const ko = ids.map((id) => $(id).textContent);
  const d = {};
  const en = () => document.documentElement.getAttribute("lang") == "en";
  const n = (x, f = 0) => (Math.round(x * 10) / 10).toLocaleString(en() ? "en-US" : "ko-KR", { minimumFractionDigits: f, maximumFractionDigits: 1 });
  const ym = (m) => m.slice(0, 4) + "." + m.slice(4);
  const fill = (id, o) => {
    const el = $(id);
    const v = el.value;
    el.innerHTML = o.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    return (el.value = o.some(([k]) => k == v) ? v : "");
  };

  function render() {
    const M = $("cv-answer").getAttribute(en() ? "data-msg-en" : "data-msg").split("|");
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, k) => a[k]);
    ids.forEach((id, i) => ($(id).textContent = en() ? $(id).getAttribute("data-en") : ko[i]));
    const c = d.c;
    const out = (t) => ($("cv-answer").textContent = t);
    out(d.err ? M[3] : "");
    if (!c) return;
    const gu = fill("cv-gu", [["", M[0]], ...Object.keys(c.slugs).map((k) => [k, k])]);
    const band = fill("cv-band", [["", M[1]], ...c.bands.map((b, i) => [b.key, M[11 + i]])]);
    const amt = Math.round(+$("cv-amt").value);
    const dep = Math.round(+$("cv-dep").value);
    if (!(amt > 0)) return;
    if (dep > 0 && amt > dep) return out(M[4]);
    const cell = c.cells.find((x) => x.district == gu && x.band == band && x.pairs >= MIN);
    const p = cell || c.seoul;
    if (!(p.pairs >= MIN)) return;
    const w = (r) => n((amt * r) / 1200, 1);
    let t = (cell || !(gu || band) ? "" : M[gu && band ? 5 : 6]) +
      f(7, cell ? `${gu} ${M[11 + c.bands.findIndex((b) => b.key == band)]}` : M[2], p.rate, n(p.pairs), `${ym(c.months[0])}~${ym(c.months.at(-1))}`, w(p.rate));
    const base = parseFloat(d.m?.baseRate?.value);
    let x = "";
    if (base >= 0) {
      const cap = Math.min(10, Math.round((base + 2) * 100) / 100);
      const e = String(d.m.baseRate.effectiveFrom ?? "");
      t += f(8, cap, base.toFixed(2), en() ? e.replace(/(\d+)년 (\d+)월 (\d+)일/, "$1-$2-$3") : e, w(cap));
      if (p.rate > cap) x = f(9, w(cap));
    }
    out(t + "." + x + (dep > 0 ? f(10, n(dep), n(dep - amt)) : ""));
  }

  const get = (f) => fetch(`./data/${f}.json?_=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([get("conversion"), get("market")]).then(([c, m]) => {
    d.c = c?.cells?.length && c.seoul ? c : null;
    d.err = !d.c;
    d.m = m;
    render();
  });
  ["cv-gu", "cv-band", "cv-dep", "cv-amt"].forEach((id, i) => $(id).addEventListener(i < 2 ? "change" : "input", render));
  $("lang-toggle").addEventListener("click", render);
  render();
})();
