// #728 complex-chart.test.mjs
(() => {
  const F = {};
  const ym = (s) => s.slice(0, 4) * 12 + +s.slice(4);
  const at = (x) => `${x[0].slice(0, 4)}.${x[0].slice(4)} ${formatEok(x[1])}`;
  const ok = (s) => s.filter((x) => x[2] > 2);
  function draw() {
    const el = document.getElementById("card-chart");
    const gu = cache.search?.slugs?.[district];
    if (!el || !window.cardApt || !gu) return;
    if (!(gu in F)) return (F[gu] = 0), loadJson(`complex-history-${gu}`).then((f) => (F[gu] = f), () => 0).then(draw);
    const f = F[gu];
    const [a, s] = Object.entries(f?.cells?.[window.cardApt] ?? {}).sort((x, y) => ok(y[1]).length - ok(x[1]).length)[0] ?? [];
    const p = ok(s ?? []);
    const v = p.map((x) => x[1]);
    const lo = Math.min(...v);
    const m = locale === "en" ? ["24-month sale trend", "monthly median", "months", "blank"] : ["24개월 매매 추이", "월 중앙값", "달", "비움"];
    el.innerHTML = s
      ? `<h3>${m[0]}</h3>` +
        (p[1]
          ? `<svg viewBox="0 0 232 60" width="232" aria-hidden="true"><polyline points="${p.map((x) => [(ym(x[0]) - ym(f.from)) * 10 + 2, (58 - ((x[1] - lo) / (Math.max(...v) - lo || 1)) * 56) | 0]).join(" ")}" fill="none" stroke="currentColor"/></svg><p class="content-notice">${a}㎡ ${m[1]}, n≥3 ${m[2]} ${p.length}: ${at(p[0])} → ${at(p.at(-1))}</p>`
          : `<p class="low-sample">${a}㎡ ${m[3]}: n≥3 ${m[2]} ${p.length}</p>`)
      : "";
  }
  (window.complexChart = draw)();
})();
