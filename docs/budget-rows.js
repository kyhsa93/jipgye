// 근거표 한 구의 줄(#871 PR-B). 장 전용 외부 JS(#681 경로, 배포 사본 gzip ≤2KB) - buy-by-budget.html 이 budget-table.js 보다 먼저 defer 로 읽는다.
// 책임은 「계산·줄 글자」다(cto 착수 판정 3): 받은 reco-<구>.json 하나에서 값대·면적대에 드는 칸을 골라 줄 HTML 을 만든다. 받기·폼·건수는 budget-table.js 몫이다.
// 줄 모양은 scripts/budget-table.ts 의 구운 예시 줄과 같은 글자다 - 시험(test/budget-table-js.test.mjs)이 같은 고정 데이터로 두 쪽 <tr> 을 글자 그대로 맞댄다.
// 계산은 over_band 하나뿐이고 식은 budget-table.ts overBand 와 같다(cto 조건 E). 「n일 전」은 데이터의 stale_deal 값이다 - 시계를 읽지 않는다.
// 문구는 #bt-rows 의 data-msg(ko)·data-msg-en, "|" 로 나눈 목록이고 열 머리는 data-cols(-en)다. 이 파일은 고르기만 한다(#681).
// 필드는 파일 머리의 이름 목록으로 찾는다(빌더가 순서를 바꿔도 맞다). 모양이 다르면 던지고, 부르는 쪽이 그 구 자리에 실패 문구를 둔다.
window.btRows = (f, b, a, first, en, cap) => {
  if (f.schemaVersion != 1) throw 0;
  const el = document.getElementById("bt-rows");
  const M = el.getAttribute(en ? "data-msg-en" : "data-msg").split("|");
  const t = (i, ...x) => M[i].replace(/\{(\d)\}/g, (_, k) => x[k]);
  const e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = (x) => x.toLocaleString("ko-KR");
  // scripts/realestate-format.ts formatEok 와 같은 식.
  const w = (v) => {
    v = Math.round(v);
    if (en) return "₩" + (v / 100).toLocaleString("en-US", { maximumFractionDigits: 0 }) + "M";
    const o = Math.floor(v / 1e4);
    const m = v % 1e4;
    return !o ? n(m) + "만원" : !m ? o + "억원" : o + "억 " + n(m) + "만원";
  };
  const P = (p, k) => p[f.apartmentFields.indexOf(k)];
  const list = [];
  for (const p of f.apartments)
    for (const c of P(p, "cells")) {
      const g = (k) => {
        const v = c[f.cellFields.indexOf(k)];
        if (v === undefined) throw 0;
        return v;
      };
      const s = g("areaSqm");
      if (Math.floor(g("median") / 1e4) == b && (a == "all" || (s < 60 ? "under-60" : s <= 85 ? "60-85" : "over-85") == a)) list.push([P(p, "name"), P(p, "dong"), s, P(p, "id"), p, g]);
    }
  // 줄 순서는 단지명(가나다) → 동 → 면적 → id 하나뿐이다(cpo 답 5, budget-table.ts rowOrder).
  list.sort((x, y) => x[0].localeCompare(y[0], "ko") || x[1].localeCompare(y[1], "ko") || x[2] - y[2] || (x[3] < y[3] ? -1 : x[3] > y[3] ? 1 : 0));
  const d = f.district;
  const rows = list.map(([nm, dg, s, , p, g]) => {
    const by = P(p, "buildYear");
    const al = [...new Set(P(p, "aliases").map((k) => String(k).split("|").at(-1).trim()))].filter((x) => x && x != nm);
    // 실거래 검색 카드 링크: 구·단지·동만 싣는다(완료 조건 5). 별칭이 있으면 그 이름 링크도(cto 5-(i)).
    const links = [nm, ...al]
      .map((x, i) => `<a href="${e(`./deal-search.html?district=${encodeURIComponent(d)}&apt=${encodeURIComponent(x)}${dg ? `&dong=${encodeURIComponent(dg)}` : ""}`)}">${i ? e(x) + " →" : M[12]}</a>`)
      .join(" · ");
    const ck = g("checks")
      .filter((x) => Array.isArray(x) && ["few_deals", "stale_deal", "reg_line"].includes(x[0]))
      .map(([k, v]) => t(k == "few_deals" ? 8 : k == "stale_deal" ? 9 : 10, v, v / 10));
    if (g("high") >= (b + 1) * 1e4) ck.push(M[11]);
    const td = [
      `${e(nm.endsWith(`(${dg})`) || !dg ? nm : `${nm} (${dg})`)}${by ? " · " + t(0, by) : ""}<br><small>${links}</small>`,
      `${s}㎡`,
      `${w(g("median"))}<br><small>${t(1, w(g("low")), w(g("high")), n(g("n")))} · ${t(2, w(g("rawMedian")))}</small>`,
      t(3, w(g("lastAmount")), g("lastDate"), g("lastFloor")),
      `${w(g("extraCost"))}<br><small>${t(4, w(g("totalCost")))}</small>`,
      // 생애최초 체크는 이 두 열만 바꾼다(po 명세 ①). 기본은 일반 값이다(cpo 답 3).
      w(g(first ? "loanCapFirstTime" : "loanCapGeneral")),
      w(g(first ? "cashFirstTime" : "cashGeneral")),
      `${{ enough: M[6], partial: M[7] }[g("sampleGrade")] ?? "-"}<br><small>${t(5, n(g("deals12m")))}</small>`,
      e(ck.join(" · ") || "-"),
    ];
    return `<tr>${td.map((x) => `<td>${x}</td>`).join("")}</tr>`;
  });
  const head = el.getAttribute(en ? "data-cols-en" : "data-cols").split("|").map((c) => `<th>${c}</th>`).join("");
  return `<div class="table-scroll"><table class="rate-table"><caption>${e(cap)}</caption><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
};
