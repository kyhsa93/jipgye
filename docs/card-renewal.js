// 단지 카드 갱신 구간(#717). 설명은 test/card-renewal.test.mjs 머리 주석.
(() => {
  const F = {}; // 파일 | null(404) | 0(실패) | undefined(받는 중)
  const M = {
    ko: {
      h: "갱신 계약 구간",
      line: (n, rr, a, b, c) => `갱신 ${n}건(사용 표시가 있는 계약 ${rr}건): 상한 근처 ${a}%·초과 ${b}%·동결 ${c}%`,
      thin: (n) => `표본 부족(n=${n})`,
      none: (s) => `평형마다 갱신 신고가 ${s}건 미만이라 표본 부족입니다.`,
      go: "재계약 확인기",
      more: (k) => `나머지 평형 ${k}개`,
      note: (w) => `${w} 갱신으로 신고된 전세 계약을 이전 보증금 대비 신고값으로 나눴습니다(상한 근처 4.5~5%, 초과 5% 넘음, 동결 = 보증금 그대로). 월세가 섞인 갱신은 환산하지 않고 뺍니다. 요구권은 한 번만 쓸 수 있습니다(주택임대차보호법 제6조의3).`,
      fail: "갱신 구간을 불러오지 못했습니다.",
    },
    en: {
      h: "Renewal bands",
      line: (n, rr, a, b, c) => `${n} renewals (${rr} marked as using the renewal right): near the 5% cap ${a}% · above 5% ${b}% · frozen ${c}%`,
      thin: (n) => `Too few (n=${n})`,
      none: (s) => `Too few renewals filed (under ${s} per size).`,
      go: "Renewal checker",
      more: (k) => `${k} more sizes`,
      note: (w) => `${w}. Jeonse contracts filed as renewals, by the filed deposit against the previous one (near the cap 4.5–5%, above = over 5%, frozen = same deposit). Renewals mixed with monthly rent are left out, not converted. The right can be used only once (Housing Lease Protection Act, Article 6-3).`,
      fail: "Could not load renewal bands.",
    },
  };
  const ym = (m) => `${m.slice(0, 4)}.${m.slice(4)}`;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const a = (q, text) => `<a href="${escapeHtml(`./renewal-vs-new.html?${new URLSearchParams(q)}`)}">${escapeHtml(text)}</a>`;

  async function load(gu) {
    F[gu] = undefined;
    F[gu] = await loadJson(`renewal-cells-${gu}`).catch(() => 0);
    draw();
  }

  function draw() {
    const el = document.getElementById("card-renewal");
    const apt = window.cardApt;
    const gu = cache.search?.slugs?.[district];
    if (!el || !apt || !gu) return;
    if (!(gu in F)) return load(gu);
    const f = F[gu];
    const m = M[locale === "en" ? "en" : "ko"];
    el.innerHTML = "";
    if (f === 0)
      return window.loadState.showFailure(el, {
        message: m.fail,
        retryLabel: t("retry"),
        retryId: "load-retry-renewal-card",
        wrap: (inner) => `<p class="empty">${inner}</p>`,
        onRetry: () => (delete F[gu], draw()),
      });
    if (!f) return;
    const { show, ratio } = f.min;
    const p = (k, n) => Math.round((k * 100) / n);
    const li = Object.entries(f.cells?.[apt] ?? {})
      .map(([area, c]) => [area, c, sum(c.slice(0, 10))])
      .filter((r) => r[2] >= show)
      .sort((x, y) => y[2] - x[2] || y[0] - x[0])
      .map(([area, c, n]) => {
        const b = (i) => c[i] + c[i + 5];
        return `<li>${a({ gu, apt, area }, `${area}㎡`)} ${escapeHtml(n < ratio ? m.thin(n) : m.line(n, sum(c.slice(0, 5)), p(b(3), n), p(b(4), n), p(b(1), n)))}</li>`;
      });
    el.innerHTML =
      `<h3>${escapeHtml(m.h)}</h3>` +
      (li.length ? `<ul>${li.slice(0, 2).join("")}</ul>` + (li.length > 2 ? `<details class="fold"><summary>${escapeHtml(m.more(li.length - 2))}</summary><ul>${li.slice(2).join("")}</ul></details>` : "") : `<p class="content-notice">${escapeHtml(m.none(show))} ${a({ gu, apt }, m.go)}</p>`) +
      `<p class="content-notice">${escapeHtml(m.note(`${ym(f.window[0])}~${ym(f.window[1])}`))}</p>`;
  }

  window.cardRenewal = draw;
  draw();
})();
