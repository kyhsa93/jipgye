// 단지 카드 페이지 전용 JS(#731 X4 가격 위치 한 줄, #729 X2 비슷한 근처 단지, #730 X3 나란히 보기). 설명은 test/complex-card.test.mjs 머리 주석.
(() => {
  const M = {
    ko: {
      in: "가격(억)",
      line: (n, l, e) => `지난 거래 ${n}건 중 ${l}건이 이 값보다 낮고 ${e}건이 같음`,
      thin: (n) => `신고 ${n}건이라 비움`,
      near: "비슷한 근처 단지",
      wide: (n) => `조건을 풀면 ${n}곳`,
      cmp: "비교",
    },
    en: {
      in: "Price (₩100M)",
      line: (n, l, e) => `Of ${n} past deals, ${l} below this and ${e} equal`,
      thin: (n) => `Blank: only ${n} reported`,
      near: "Similar complexes nearby",
      wide: (n) => `${n} if loosened`,
      cmp: "Compare",
    },
  };
  const m = () => M[locale === "en" ? "en" : "ko"];
  let sale = [];

  const rank = (s, v) =>
    s.length < 3 ? m().thin(s.length) : v > 0 ? m().line(s.length, s.filter((x) => x < v).length, s.filter((x) => x === v).length) : "";

  // X2(#729) 비슷한 근처 단지: 같은 구 complex-price 칸(중앙값·n≥3)에서 면적 ±10㎡·준공 ±10년, 같은 동 먼저, 값 가까운 순 셋.
  const gap = (c, b) => Math.abs(c[1].median - b[1].median);
  const cells = (p, a, f = () => 1) => Object.entries(p.cells[a] ?? {}).filter(([k, v]) => v.median && v.n >= 3 && f(k));
  const top = (p, a) => cells(p, a).sort((x, y) => y[1].n - x[1].n)[0];
  function near(p, apt) {
    const me = p?.meta?.[apt];
    const b = me && top(p, apt);
    if (!b) return [];
    const all = Object.keys(p.cells).filter((a) => a !== apt && p.meta[a] && cells(p, a).length);
    const hit = all
      .filter((a) => Math.abs(p.meta[a].buildYear - me.buildYear) <= 10)
      .map((a) => [a, cells(p, a, (k) => Math.abs(k - b[0]) <= 10).sort((x, y) => gap(x, b) - gap(y, b))[0]])
      .filter((x) => x[1])
      .sort((x, y) => (p.meta[y[0]].dong === me.dong) - (p.meta[x[0]].dong === me.dong) || gap(x[1], b) - gap(y[1], b));
    return hit.length ? hit.slice(0, 3) : all.length;
  }

  function draw() {
    const el = document.getElementById("card-rank");
    const apt = window.cardApt;
    if (!el || !apt) return;
    const p = complexPrices.get(district);
    const r = near(p, apt);
    const h = `<h3>${escapeHtml(m().near)}</h3>`;
    const q = (a) => `?district=${encodeURIComponent(district)}&apt=${encodeURIComponent(a)}`;
    const c = (new URLSearchParams(location.search).get("compare") ?? "").split(",").filter((a, i, s) => a && a !== apt && s.indexOf(a) === i);
    const b = p && top(p, apt);
    const v = b && c.length < 3 ? [[apt, b], ...c.map((a) => [a, cells(p, a).sort((x, y) => Math.abs(x[0] - b[0]) - Math.abs(y[0] - b[0]))[0]])].filter((x) => x[1]) : [];
    document.getElementById("card-near").innerHTML =
      (r.length
        ? `${h}<ul>${r.map(([a, [k, v]]) => `<li><a href="${q(a)}">${escapeHtml(a)}</a> ${escapeHtml(`${k}㎡ ${formatEok(v.median)}`)} <a href="${q(apt)}&compare=${encodeURIComponent(a)}">${escapeHtml(m().cmp)}</a></li>`).join("")}</ul>`
        : r > 0
          ? `${h}<p class="low-sample">${escapeHtml(m().wide(r))}</p>`
          : "") +
      (v[1]
        ? `<h3>${escapeHtml(t("priceHeading")(yearMonthLabel(p.reference)))}</h3><table class="data-table">${v.map(([a, [k, x]]) => `<tr><th scope="row">${escapeHtml(a)}</th><td>${escapeHtml(`${k}㎡`)}</td><td>${escapeHtml(`${formatEok(x.median)} · ${t(x.quartile ? "priceMiddle" : "priceMinMax")} ${formatEok(x.low)} ~ ${formatEok(x.high)} · ${t("complexCount")(x.n)}`)}</td></tr>`).join("")}</table>`
        : "");
    const row = complexAreas(apt, fullDeals.get(district), [], complexPrices.get(district)?.cells?.[apt])[0];
    sale = row?.sale ?? [];
    el.innerHTML = sale.length
      ? `${escapeHtml(`${row.area}㎡`)} ` +
        (sale.length < 3
          ? `<span class="low-sample">${escapeHtml(rank(sale))}</span>`
          : `<label>${escapeHtml(m().in)} <input id="rank-in" type="number" step="any" min="0"></label> <output id="rank-out" aria-live="polite"></output>`)
      : "";
  }

  document.getElementById("complex-card")?.addEventListener("input", (e) => {
    if (e.target?.id !== "rank-in") return;
    document.getElementById("rank-out").textContent = rank(sale, Math.round(Number(e.target.value) * EOK));
  });

  draw.rank = rank;
  draw.near = near;
  window.complexCard = draw;
  draw();
})();
