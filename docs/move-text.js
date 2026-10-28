// 재계약 vs 이사 비교 결과의 문장·표 줄(#777, #792 에서 move-cost.js 의 계산과 나눔 — 이 장 여섯째 장 전용 JS, group-ceo 판정 A).
// 순수 함수만 둔다. move-cost.js 뒤에 읽혀 jipgyeMoveCost 에 describe 를 붙인다 - 화면과 시험이 같은 한 벌을 부른다.
(() => {
  // 문구 M 은 장의 #mv-answer data-msg(ko)·data-msg-en 을 "|" 로 나눈 89개. 칸 이름은 4~10, 범위 사유는 12~15 -
  // 월세 집 보증금·내 돈은 0 이상(13), 금리는 0~20%(14), 기간은 1~120개월(15), 나머지는 0 초과(12).
  const NAME = { renew: 4, deposit: 5, rent: 6, cash: 7, loanRate: 8, depositRate: 9, months: 10, oneRenew: 80, oneMove: 81, renewRate: 89, moveRate: 90 };
  const WHY = { renew: 12, deposit: 12, rent: 12, cash: 13, loanRate: 14, depositRate: 14, months: 15, oneRenew: 13, oneMove: 13, renewRate: 14, moveRate: 14 };

  // 결과 → 답 문장(text)과 표(head, rows). 제목 금액 = 합계 줄의 차이라 둘이 어긋나지 않는다. 가정 한도를 넘는 쪽이 있으면 승자를 말하지 않는다.
  function describe(r, M, fmt, kind) {
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, j) => a[j]);
    const k = (x) => fmt(x / 10);
    if (!r.ok) {
      const miss = r.errors.filter((e) => e.code == "required");
      const line = (e) => f(11, M[NAME[e.field]], M[WHY[e.field] + (e.field == "deposit" && kind == "wolse")]);
      const bad = r.errors.filter((e) => e.code == "range");
      // err: 잘못된 값마다 그 칸 가까이 둘 문장(화면이 칸 묶음 아래에 놓는다).
      return { text: miss.length ? f(3, miss.map((e) => M[NAME[e.field]]).join(", ")) : bad.map(line).join(" "), err: bad.map((e) => [e.field, line(e)]) };
    }
    const N = r.months;
    const basis = M[r.opportunity ? 19 : 20];
    const who = (x) => M[x == "renew" ? 17 : 18];
    const sides = [r.renew, r.move];
    const text = r.comparable
      ? (r.gapK ? f(16, N, who(r.cheaper), k(Math.abs(r.gapK)), basis) : f(21, N, basis)) +
        f(22, k(r.renew.cashK), k(r.move.cashK), N) +
        (r.opportunity && r.cashCheaper != r.cheaper ? (r.cashCheaper ? f(23, who(r.cashCheaper), k(Math.abs(r.cashGapK))) : M[24]) : "")
      : sides.map((s, i) => (s.feasible ? "" : f(25, M[26 + i], fmt(s.short)))).filter(Boolean).join(" ");
    const once = r.renew.oneK || r.move.oneK;
    const lines = [[28, (s) => fmt(s.deposit)], [29, (s) => fmt(s.own)], [30, (s) => fmt(s.loan)], [31, (s) => k(s.interestK)], [32, (s) => k(s.rentK)], [33, (s) => k(s.cashK)], [34, (s) => k(s.cashTotalK)], [76, (s) => k(s.oneK)], [35, (s) => k(s.oppK * N)], [36, (s) => k(s.totalK)]];
    const rows = lines.filter(([i]) => (i != 35 || r.opportunity) && (i != 76 || once)).map(([i, g], j) => [f(i, N), ...sides.map((s) => (j < 2 || s.feasible ? g(s) : "-"))]);
    const head = ["", M[26] + M[46], M[27] + M[46]];
    // 표 마크업(화면이 그대로 넣는다). 글자는 모두 장의 문구와 숫자라 따로 이스케이프하지 않는다.
    const cell = (x, h) => (h ? `<th scope="${h}">${x}</th>` : `<td>${x}</td>`);
    const html = `<thead><tr><td>${head[0]}</td>${cell(head[1], "col")}${cell(head[2], "col")}</tr></thead><tbody>` + rows.map(([l, a, b]) => `<tr>${cell(l, "row")}${cell(a)}${cell(b)}</tr>`).join("") + "</tbody>";
    return { text, head, rows, html, ...(r.comparable && { whatIf: whatIf(r, f, k, who, basis) }) };
  }

  // 조건을 바꾸면(P5): 손익분기(월 비용이 낮은 쪽이 일회성 비용은 높을 때만 순위가 바뀐다)와 기간별 차이. 금리는 칸을 고쳐 다시 본다.
  // 합계는 월 합계 × t + 일회성이라 기간별 차이는 정수 식 그대로다. 손익분기가 없거나 10년(120개월) 밖이면 날짜를 만들지 않는다.
  function whatIf(r, f, k, who, basis) {
    const dm = r.renew.monthK - r.move.monthK; // > 0: 이사 쪽이 매달 덜 든다
    const dk = r.move.oneK - r.renew.oneK; // > 0: 이사 쪽이 처음에 더 든다
    const at = dk / dm;
    const line = (t, g = dk - dm * t) => (g ? f(78, t, who(g > 0 ? "renew" : "move"), k(Math.abs(g))) : f(79, t));
    const [a, b] = dk > 0 ? ["move", "renew"] : ["renew", "move"]; // 나중에 덜 드는 쪽, 처음에 덜 드는 쪽
    const be = !dm || !dk ? "" : Math.sign(dm) != Math.sign(dk) || at < 1 ? f(75) : at > 120 ? f(74) : at % 1 ? f(73, Math.ceil(at), who(a), who(b)) : f(72, at, who(a));
    // 끝에 제목과 같은 기준(현금 지출 + 예금이자 / 현금 지출)을 붙인다 - 바로 위 「현금 지출만 보면」 줄과 엇갈려 읽히지 않게(po #777 P5).
    return (be + f(77) + [12, 24, 36, 48].map((t) => line(t)).join(" · ") + ` (${basis}).`).trim();
  }

  Object.assign(globalThis.jipgyeMoveCost, { describe });
})();
