// 단지 카드 페이지 전용 JS(#731 X4 가격 위치 한 줄, #729 X2 가 이어 쓴다). 설명은 test/complex-card.test.mjs 머리 주석.
(() => {
  const M = {
    ko: {
      in: "가격(억)",
      line: (n, l, e) => `지난 거래 ${n}건 중 ${l}건이 이 값보다 낮고 ${e}건이 같음`,
      thin: (n) => `신고 ${n}건이라 비움`,
    },
    en: {
      in: "Price (₩100M)",
      line: (n, l, e) => `Of ${n} past deals, ${l} below this and ${e} equal`,
      thin: (n) => `Blank: only ${n} reported`,
    },
  };
  const m = () => M[locale === "en" ? "en" : "ko"];
  let sale = [];

  const rank = (s, v) =>
    s.length < 3 ? m().thin(s.length) : v > 0 ? m().line(s.length, s.filter((x) => x < v).length, s.filter((x) => x === v).length) : "";

  function draw() {
    const el = document.getElementById("card-rank");
    const apt = window.cardApt;
    if (!el || !apt) return;
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
  window.complexCard = draw;
  draw();
})();
