// 재계약 vs 이사 비용 계산과 그 결과의 문장·표 줄(#777). 화면(renewal-move.js)과 시험이 이 한 벌을 같이 부른다. 금액은 만원, 금리는 연 %.
// 월 항목은 천 원 정수로 반올림하고 기간 값은 월 값 × 개월 - 「월 × 기간 = 합」이 맞게. 돌려받는 보증금·대출 원금은 비용이 아니다.
(() => {
  const LTV = 0.8; // = scripts/conversion.ts LOAN_LTV
  const TAX = 0.154; // = scripts/interest.ts TAX_RATE
  const n = (v) => (v === "" || v == null ? NaN : Number(v));

  function check(x) {
    const errors = [];
    const need = (field, v, ok) => Number.isFinite(v) ? ok(v) || errors.push({ field, code: "range" }) : errors.push({ field, code: "required" });
    const rate = (v) => v >= 0 && v <= 20;
    const wolse = x.kind === "wolse";
    need("renew", n(x.renew), (v) => v > 0);
    need("deposit", n(x.deposit), (v) => (wolse ? v >= 0 : v > 0));
    if (wolse) need("rent", n(x.rent), (v) => v > 0);
    need("cash", n(x.cash), (v) => v >= 0);
    need("loanRate", n(x.loanRate), rate);
    if (x.opportunity) need("depositRate", n(x.depositRate), rate);
    need("months", n(x.months), (v) => Number.isInteger(v) && v >= 1 && v <= 120);
    // 일회성 비용(P5: 이사비·중개보수 등, 사용자가 넣는 값). 비우면 0, 넣으면 0 이상.
    for (const field of ["oneRenew", "oneMove"]) if (x[field] !== "" && x[field] != null && !(n(x[field]) >= 0)) errors.push({ field, code: "range" });
    return errors;
  }

  // 선택지 하나. 대출은 전세 vs 월세(monthlyCost)와 같이 보증금의 80%에서 자르고, 그래도 모자라면 short 로 알린다.
  // 기회비용 = 보증금에 묶인 내 돈의 세후 예금이자. 내 돈 전체가 두 선택지에서 같아 monthlyCost(남는 돈 이자 차감)와 차이가 같다.
  function side(deposit, rent, x, once) {
    const own = Math.min(x.cash, deposit);
    const short = Math.max(0, Math.round(deposit - own - deposit * LTV));
    const loan = deposit - own - short;
    // 금리를 bp 정수로 바꿔 분자를 정수로 둔다 - 4.23% 같은 값의 부동소수 잡음이 0.5 경계를 넘기지 않게.
    const interestK = Math.round((loan * x.loanBp) / 12000);
    const rentK = Math.round(rent * 10);
    const oppK = x.opportunity ? Math.round((own * x.depositBp * Math.round((1 - TAX) * 1000)) / 12e6) : 0;
    const cashK = interestK + rentK;
    const oneK = Math.round((n(once) || 0) * 10);
    // 일회성 비용은 내 돈(C) 밖에서 낸다고 본다 - C 에서 빼면 대출과 기회비용이 같이 움직인다(data-analyst #777).
    return { deposit, own, loan, short, feasible: short === 0, interestK, rentK, cashK, oppK, oneK, monthK: cashK + oppK, totalK: (cashK + oppK) * x.months + oneK, cashTotalK: cashK * x.months, cashAllK: cashK * x.months + oneK };
  }

  function compare(input) {
    const errors = check(input);
    if (errors.length) return { ok: false, errors };
    const bp = (v) => Math.round((n(v) || 0) * 100);
    const x = { cash: Math.round(n(input.cash)), loanBp: bp(input.loanRate), depositBp: bp(input.depositRate), months: n(input.months), opportunity: !!input.opportunity };
    const renew = side(Math.round(n(input.renew)), 0, x, input.oneRenew);
    const move = side(Math.round(n(input.deposit)), input.kind === "wolse" ? n(input.rent) : 0, x, input.oneMove);
    const ok = renew.feasible && move.feasible;
    const gap = (k) => (ok ? move[k] - renew[k] : null);
    const who = (g) => (g === null || g === 0 ? null : g > 0 ? "renew" : "move");
    return { ok: true, kind: input.kind, comparable: ok, months: x.months, opportunity: x.opportunity, renew, move, gapK: gap("totalK"), cashGapK: gap("cashAllK"), cheaper: who(gap("totalK")), cashCheaper: who(gap("cashAllK")) };
  }

  // 문구 M 은 장의 #mv-answer data-msg(ko)·data-msg-en 을 "|" 로 나눈 47개. 칸 이름은 4~10, 범위 사유는 12~15 -
  // 월세 집 보증금·내 돈은 0 이상(13), 금리는 0~20%(14), 기간은 1~120개월(15), 나머지는 0 초과(12).
  const NAME = { renew: 4, deposit: 5, rent: 6, cash: 7, loanRate: 8, depositRate: 9, months: 10, oneRenew: 80, oneMove: 81 };
  const WHY = { renew: 12, deposit: 12, rent: 12, cash: 13, loanRate: 14, depositRate: 14, months: 15, oneRenew: 13, oneMove: 13 };

  // 결과 → 답 문장(text)과 표(head, rows). 제목 금액 = 합계 줄의 차이라 둘이 어긋나지 않는다. 가정 한도를 넘는 쪽이 있으면 승자를 말하지 않는다.
  function describe(r, M, fmt, kind) {
    const f = (i, ...a) => M[i].replace(/\{(\d)\}/g, (_, j) => a[j]);
    const k = (x) => fmt(x / 10);
    if (!r.ok) {
      const miss = r.errors.filter((e) => e.code == "required");
      return { text: miss.length ? f(3, miss.map((e) => M[NAME[e.field]]).join(", ")) : r.errors.map((e) => f(11, M[NAME[e.field]], M[WHY[e.field] + (e.field == "deposit" && kind == "wolse")])).join(" ") };
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
    return { text, head: ["", M[26] + M[46], M[27] + M[46]], rows, ...(r.comparable && { whatIf: whatIf(r, f, k, who) }) };
  }

  // 조건을 바꾸면(P5): 손익분기(월 비용이 낮은 쪽이 일회성 비용은 높을 때만 순위가 바뀐다)와 기간별 차이. 금리는 칸을 고쳐 다시 본다.
  // 합계는 월 합계 × t + 일회성이라 기간별 차이는 정수 식 그대로다. 손익분기가 없거나 10년(120개월) 밖이면 날짜를 만들지 않는다.
  function whatIf(r, f, k, who) {
    const dm = r.renew.monthK - r.move.monthK; // > 0: 이사 쪽이 매달 덜 든다
    const dk = r.move.oneK - r.renew.oneK; // > 0: 이사 쪽이 처음에 더 든다
    const at = dk / dm;
    const line = (t, g = dk - dm * t) => (g ? f(78, t, who(g > 0 ? "renew" : "move"), k(Math.abs(g))) : f(79, t));
    const [a, b] = dk > 0 ? ["move", "renew"] : ["renew", "move"]; // 나중에 덜 드는 쪽, 처음에 덜 드는 쪽
    const be = !dm || !dk ? "" : Math.sign(dm) != Math.sign(dk) ? f(75) : at > 120 ? f(74) : at % 1 ? f(73, Math.ceil(at), who(a), who(b)) : f(72, at, who(a));
    return (be + f(77) + [12, 24, 36, 48].map((t) => line(t)).join(" · ") + ".").trim();
  }

  globalThis.jipgyeMoveCost = { compare, describe, LTV, TAX };
})();
