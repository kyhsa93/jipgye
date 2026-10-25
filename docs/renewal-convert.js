// 반전세 전환 계산기(#673 N1, #convert). 인라인 +400B 한도 밖이라 이 장만 싣는다. 입력은 URL에 싣지 않는다.
// 시장 값: conversion.json 칸(단지쌍 MIN 미만이면 서울 값). 법정 상한: min(10, 기준금리+2). 월세 = 금액×율÷12, 0.1만원 반올림.
(() => {
  const MIN = 3; // scripts/conversion.ts MIN_PAIRS 와 같다(시험이 대조).
  const $ = (id) => document.getElementById(id);
  const S = {
    ko: ["서울 전체", "고르지 않음", "서울", 0, "전환율 자료를 불러오지 못했습니다.", "돌릴 금액이 현재 보증금보다 큽니다.", "고른 칸은 단지쌍이 3쌍 미만이라 서울 값입니다. ",
      (w, r, n, s, a) => `${w} 시장 전환율 ${r}%(${n}쌍, ${s} 신규 계약) → 월 ${a}만원`, (y, b, e, a) => `, 법정 상한 ${y}%(기준금리 ${b}%, ${e}부터) → 월 ${a}만원`, (c, d) => ` 보증금 ${c}만원 → ${d}만원.`],
    en: ["All Seoul", "Any", "Seoul", ["under 60m²", "60–85m²", "85m² and up"], "Could not load the conversion data.", "The amount to convert is larger than the current deposit.", "That pick has fewer than 3 complex pairs, so Seoul's figure is used. ",
      (w, r, n, s, a) => `${w}: market rate ${r}% (${n} pairs, new leases ${s}) → ${a} (10k won) a month`, (y, b, e, a) => `; statutory cap ${y}% (base rate ${b}% from ${e}) → ${a} a month`, (c, d) => ` Deposit ${c} → ${d} (10k won).`],
  };
  const ids = ["cv-heading", "cv-gu-label", "cv-band-label", "cv-dep-label", "cv-amt-label", "cv-legal", "cv-source"];
  const ko = ids.map((id) => $(id).textContent);
  const d = {};
  const en = () => document.documentElement.getAttribute("lang") === "en";
  const n = (x) => (Math.round(x * 10) / 10).toLocaleString(en() ? "en-US" : "ko-KR");
  const ym = (m) => `${m.slice(0, 4)}.${m.slice(4)}`;
  const fill = (id, opts) => {
    const el = $(id);
    const prev = el.value;
    el.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    el.value = opts.some(([v]) => v === prev) ? prev : "";
    return el.value;
  };

  function render() {
    const [all, any, seoul, bands, err, over, thin, mkt, capT, depT] = S[en() ? "en" : "ko"];
    ids.forEach((id, i) => ($(id).textContent = en() ? $(id).getAttribute("data-en") : ko[i]));
    const c = d.c;
    const out = (t) => ($("cv-answer").textContent = t);
    out(d.err ? err : "");
    if (!c) return;
    const label = (i) => (bands || [])[i] ?? c.bands[i].label;
    const gu = fill("cv-gu", [["", all], ...Object.keys(c.slugs).map((k) => [k, k])]);
    const band = fill("cv-band", [["", any], ...c.bands.map((b, i) => [b.key, label(i)])]);
    const amt = Math.round(+$("cv-amt").value);
    const dep = Math.round(+$("cv-dep").value);
    if (!(amt > 0)) return;
    if (dep > 0 && amt > dep) return out(over);
    const cell = c.cells.find((x) => x.district === gu && x.band === band && x.pairs >= MIN);
    const p = cell ?? c.seoul;
    if (!(p.pairs >= MIN)) return;
    const where = cell ? `${gu} ${label(c.bands.findIndex((b) => b.key === band))}` : seoul;
    let t = (cell || !(gu || band) ? "" : thin) + mkt(where, p.rate, n(p.pairs), `${ym(c.months[0])}~${ym(c.months.at(-1))}`, n((amt * p.rate) / 1200));
    const base = parseFloat(d.m?.baseRate?.value);
    if (base >= 0) {
      const cap = Math.min(10, Math.round((base + 2) * 100) / 100);
      const e = String(d.m.baseRate.effectiveFrom ?? "");
      t += capT(cap, base.toFixed(2), en() ? e.replace(/(\d+)년 (\d+)월 (\d+)일/, "$1-$2-$3") : e, n((amt * cap) / 1200));
    }
    out(`${t}.${dep > 0 ? depT(n(dep), n(dep - amt)) : ""}`);
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
