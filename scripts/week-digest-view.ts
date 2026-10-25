// 이번 주 새로 신고된 거래(#703 W1)의 화면 문장과 news.html 절 HTML. prerender.ts 가 docs/data/week-digest.json 으로 빌드 때 굽는다 -
// 인라인 스크립트 증가 0(판정). 분야 장 셋(build-news-pages.ts)은 구운 news.html 을 틀로 읽으므로 같은 절이 따라간다.
//
// 정직성 한계(#703 판정): 수집일 ≠ 신고일 ≠ 계약일을 문장에 적는다. 「늘었다/줄었다」는 수집 공백 없는 두 주끼리만(comparable).
// 구는 순위가 아니라 「많았던 구」, 인과 문장·단지명 0.
import { DISTRICTS } from "./realestate-districts.ts";
import { DISTRICT_SLUGS } from "./district-slugs.ts";
import { escapeHtml } from "./html-escape.ts";

const NAME = new Map(DISTRICTS.map(({ code, name }) => [code, name]));
const enDistrict = (code) => {
  const slug = DISTRICT_SLUGS[NAME.get(code)] ?? code;
  return `${slug[0].toUpperCase()}${slug.slice(1)}-gu`;
};
const EN_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (day, lang) => {
  const [, m, d] = day.split("-").map(Number);
  return lang === "ko" ? `${m}/${d}` : `${EN_MONTH[m - 1]} ${d}`;
};
const span = (w, lang) => `${md(w.from, lang)}${lang === "ko" ? "~" : "–"}${md(w.to, lang)}`;
const num = (n) => n.toLocaleString("en-US");
/** 날짜 끝자리의 읽는 소리로 은/는(2이·4사·5오·9구는 받침이 없다). */
const topic = (text) => ("2459".includes(text.at(-1)) ? "는" : "은");

/** 증감 낱말. 공백이 있으면 부르지 않는다. */
export function direction(now, before, lang) {
  if (now === before) return lang === "ko" ? "같다" : "unchanged";
  if (lang === "ko") return now > before ? `늘었다(+${num(now - before)})` : `줄었다(−${num(before - now)})`;
  return now > before ? `up ${num(now - before)}` : `down ${num(before - now)}`;
}

/** 문장 한 벌(ko 또는 en). 화면 글자는 전부 여기 있다 - 시험이 이것만 본다. */
export function digestText(d, lang) {
  const ko = lang === "ko";
  const c = d.current;
  const p = d.previous;
  const cards = [
    ["sale", ko ? "매매" : "Sales"],
    ["jeonse", ko ? "전세" : "Jeonse"],
    ["wolse", ko ? "월세" : "Monthly rent"],
  ].map(([k, label]) => ({
    label,
    value: ko ? `${num(c[k])}건` : num(c[k]),
    sub: d.comparable
      ? ko
        ? `직전 7일 ${num(p[k])}건${c[k] === p[k] ? "과" : "보다"} ${direction(c[k], p[k], lang)}`
        : `${direction(c[k], p[k], lang)} from ${num(p[k])} the 7 days before`
      : ko
        ? `직전 7일 ${num(p[k])}건`
        : `${num(p[k])} the 7 days before`,
  }));
  // 날짜 목록은 gaps 그대로. 영어는 「A and B」「A, B and C」.
  const gapDates = d.gaps.map((g) => md(g, lang));
  const gapList = ko ? gapDates.join("·") : gapDates.length > 1 ? `${gapDates.slice(0, -1).join(", ")} and ${gapDates.at(-1)}` : gapDates[0];
  const gap = d.comparable
    ? null
    : ko
      ? `${gapList}${topic(gapList)} 수집하지 못한 날이다. 빠진 날의 신고가 다음 날 한꺼번에 잡히므로, 지난 7일과 늘고 준 것은 비교하지 않는다.`
      : `We couldn't collect on ${gapList}. Filings missed on a gap day show up in a lump the next day, so we don't compare with the previous 7 days.`;
  const share = c.directShare == null ? null : `${c.directShare}%`;
  // 「신고」(filing)와 「신고가」(record high)가 겹쳐 읽히지 않게 「역대 최고가를 넘은 건」으로 쓴다(#713 판정). k/n 그대로.
  const facts = ko
    ? `새로 들어온 매매 중 역대 최고가를 넘은 건 ${num(c.records)}건(판단할 수 있던 ${num(c.judged)}건 중) · 이 7일에 해제된 ${num(c.cancelDated)}건${share ? ` · 직거래 ${share}` : ""}`
    : `New sales above the previous high: ${num(c.records)} of the ${num(c.judged)} we could judge · ${num(c.cancelDated)} cancelled in these 7 days${share ? ` · ${share} direct deals` : ""}`;
  const districts = c.districts.length
    ? ko
      ? `매매 새 신고가 많았던 구: ${c.districts.map((x) => NAME.get(x) ?? x).join("·")}`
      : `Districts with many new sales filings: ${c.districts.map(enDistrict).join(", ")}`
    : null;
  // 계약월은 오래된 달부터(「9월 286·10월 701」). 머리말 뒤는 가장 많은 달을 말한다 - 「대부분」은 절반을 넘을 때만 쓴다(숫자가 바뀌어도 거짓이 되지 않게).
  const monthName = (m) => (ko ? `${Number(m.slice(4))}월` : EN_MONTH[Number(m.slice(4)) - 1]);
  const monthText = (counts) =>
    Object.entries(counts)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-3)
      .map(([m, n]) => `${monthName(m)} ${num(n)}`)
      .join(ko ? "·" : ", ");
  const sm = Object.entries(c.months.sale as Record<string, number>);
  const total = sm.reduce((t, [, n]) => t + n, 0);
  const [topMonth, topCount] = sm.reduce((a, b) => (b[1] > a[1] ? b : a), ["", -1]);
  const most = total > 0 && topCount * 2 > total;
  const months = ko
    ? `신고일은 계약일과 다르다 — ${most ? `새로 들어온 매매는 대부분 ${monthName(topMonth)} 계약이다` : "새로 들어온 매매는 여러 달 계약이 섞여 있다"}: ${monthText(c.months.sale)} (전월세 ${monthText(c.months.rent)})`
    : `Filing date is not contract date — ${most ? `most new sales were signed in ${monthName(topMonth)}` : "new sales mix contracts from several months"}: ${monthText(c.months.sale)} (rentals ${monthText(c.months.rent)})`;
  const note = ko
    ? `${span(c, lang)} 수집에 새로 보인 신고(수집일 기준, 같은 내용 줄은 1건) · 직전 7일 ${span(p, lang)}`
    : `Filings first seen in collections ${span(c, lang)} (by collection date; identical rows count once) · previous 7 days ${span(p, lang)}`;
  return { heading: ko ? "이번 주 새로 신고된 거래" : "New filings this week", note, cards, gap, facts, districts, months };
}

/** 절 안쪽 HTML. 두 언어를 다 굽고 html lang 이 가린다(m-ko·m-en) - 스크립트에 번역 표를 더하지 않는다. */
export function digestHtml(d) {
  if (!d?.current) return "";
  const [ko, en] = [digestText(d, "ko"), digestText(d, "en")];
  // 문단 한 쌍. 영어 쪽 null 은 없다(ko 가 null 이면 en 도 null).
  const para = (part, a, b) =>
    a == null ? "" : `<p class="stat-note m-ko" data-part="${part}">${escapeHtml(a)}</p><p class="stat-note m-en" data-part="${part}">${escapeHtml(b)}</p>`;
  const both = (a, b) => `<span class="m-ko">${escapeHtml(a)}</span><span class="m-en">${escapeHtml(b)}</span>`;
  const cards = ko.cards
    .map(
      (k, i) =>
        `<div class="stat-card"><span class="stat-label">${both(k.label, en.cards[i].label)}</span>` +
        `<span class="stat-value">${both(k.value, en.cards[i].value)}</span>` +
        `<span class="stat-sub">${both(k.sub, en.cards[i].sub)}</span></div>`
    )
    .join("");
  return (
    `<h2 id="week-digest-heading">${both(ko.heading, en.heading)}</h2>` +
    para("note", ko.note, en.note) +
    `<div class="stat-cards">${cards}</div>` +
    para("gap", ko.gap, en.gap) +
    para("facts", ko.facts, en.facts) +
    para("districts", ko.districts, en.districts) +
    para("months", ko.months, en.months)
  );
}
