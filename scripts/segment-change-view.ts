// 갈아타기 「25개 구」 아래 「가격대·연식별 1년 변화」 표(N4 화면, #676)의 글자와 칸. 순수 모듈 - 마크업은 render/entry.jsx 의 segmentChangeHtml 이 그린다.
//
// 숫자는 docs/data/segment-change.json(#685, scripts/segment-change.ts) 그대로다 - 변화·90% 구간은 빌더가 낸 % 소수 1자리, 칸 수는 맞물린 칸.
// 지키는 것(N4 착수 판정 #676 6403175619, #685 판정 6403493330):
// - 차이는 「구별된다」로만 말한다: 빌더의 pairs(district-change pairVerdicts, 90% 구간이 겹치지 않으면 true)가 true 인 쌍만 「구별된다」고 적는다.
//   순위·「더 움직였다」 같은 말은 쓰지 않는다.
// - 평균 회귀 한계: 칸을 기준 시기 중앙값으로 가격대에 넣으므로 기준값이 우연히 높거나 낮았던 칸이 양 끝 가격대에 모인다 - 표 바로 아래에 적는다(보정하지 않음).
// - 금지어(`오를`·`내릴`·`전망`) 0건. 두 언어를 다 굽고 html lang 이 가린다(m-ko·m-en) - 이 장의 인라인 스크립트는 S6 여유가 없다.

type Both = { ko: string; en: string };
type Row = { key: string; ko: string; en: string; cells: number; change: number | null; low: number | null; high: number | null };

export const SEGMENT_HEADING: Both = { ko: "가격대·연식별 1년 변화", en: "1-year change by price band and building age" };
export const SEGMENT_HEAD: Both[] = [
  { ko: "구분", en: "Group" },
  { ko: "1년 변화", en: "Change" },
  { ko: "90% 구간", en: "90% range" },
  { ko: "칸 수", en: "Units" },
];
export const SEGMENT_FORBIDDEN = ["오를", "내릴", "전망"];

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 석 달 묶음 → 「2025년 6~8월」/「Jun–Aug 2025」(해를 넘기면 양쪽에 해). */
function span(months: string[]): Both {
  const a = months[0];
  const b = months[months.length - 1];
  const y = (m: string) => m.slice(0, 4);
  const mo = (m: string) => Number(m.slice(4));
  if (y(a) === y(b)) return { ko: `${y(a)}년 ${mo(a)}~${mo(b)}월`, en: `${MONTHS_EN[mo(a) - 1]}–${MONTHS_EN[mo(b) - 1]} ${y(a)}` };
  return { ko: `${y(a)}년 ${mo(a)}월~${y(b)}년 ${mo(b)}월`, en: `${MONTHS_EN[mo(a) - 1]} ${y(a)}–${MONTHS_EN[mo(b) - 1]} ${y(b)}` };
}
/** 받침이 있으면 「과」, 없으면 「와」(마지막 글자가 한글 음절이 아니면 받침 있음으로 본다 - 구간 이름은 한글로 끝난다). */
const noFinal = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 === 0;
};
const wa = (word: string) => (noFinal(word) ? "와" : "과");
/** 받침이 있으면 「은」, 없으면 「는」. */
const eun = (word: string) => (noFinal(word) ? "는" : "은");
const num = (n: number) => n.toLocaleString("en-US");

/** 한 축(가격대 또는 연식)의 「구별된다」 문장. 값이 있는 줄이 둘 미만이면 null. */
function pairLine(dim: Both, rows: Row[], verdicts: Record<string, boolean> | undefined): Both | null {
  const ok = rows.filter((r) => r.change !== null);
  const all: { a: Row; b: Row; yes: boolean }[] = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) all.push({ a: ok[i], b: ok[j], yes: verdicts?.[`${ok[i].key}-${ok[j].key}`] === true });
  if (!all.length) return null;
  const yes = all.filter((p) => p.yes);
  const no = all.filter((p) => !p.yes);
  const ko = (ps: typeof all) => ps.map(({ a, b }) => `${a.ko}${wa(a.ko)} ${b.ko}`).join(", ");
  const en = (ps: typeof all) => ps.map(({ a, b }) => `${a.en} and ${b.en}`).join("; ");
  if (!no.length) return { ko: `${dim.ko}: ${all.length}쌍 모두 구별됩니다.`, en: `${dim.en}: all ${all.length} pairs can be told apart.` };
  if (!yes.length) return { ko: `${dim.ko}: 구별되는 쌍이 없습니다.`, en: `${dim.en}: no pair can be told apart.` };
  if (yes.length <= no.length) return { ko: `${dim.ko}: ${ko(yes)}만 구별됩니다.`, en: `${dim.en}: only ${en(yes)} can be told apart.` };
  return {
    ko: `${dim.ko}: ${all.length}쌍 가운데 ${yes.length}쌍이 구별되고, ${ko(no)}${eun(no[no.length - 1].b.ko)} 구별되지 않습니다.`,
    en: `${dim.en}: ${yes.length} of ${all.length} pairs can be told apart; ${en(no)} cannot.`,
  };
}

// 375px 에서 영어 표가 상자를 넘지 않게 줄 이름을 줄여 쓴다(json 의 en 은 문장 속 이름으로 그대로 쓴다). 키가 없으면 json 의 en.
const EN_SHORT: Record<string, string> = { upTo6: "≤₩600M", over25: ">₩2.5B", under10: "<10 yrs", y10to29: "10–29 yrs", over30: "30+ yrs" };

const PRICE_DIM: Both = { ko: "가격대", en: "Price bands" };
const AGE_DIM: Both = { ko: "연식", en: "Building age" };

export function segmentChangeView(data) {
  if (!Array.isArray(data?.price) || !Array.isArray(data?.age) || !data.periods?.base?.length) return null;
  const rowsOf = (list: Row[]) =>
    list.map((r) => ({
      name: { ko: r.ko, en: EN_SHORT[r.key] ?? r.en },
      cells: r.change === null ? null : [pct(r.change), `${pct(r.low)} ~ ${pct(r.high)}`, num(r.cells)],
      blank: r.change === null ? { ko: `칸이 모자람(${num(r.cells)}칸)`, en: `too few units (${num(r.cells)})` } : null,
    }));
  const base = span(data.periods.base);
  const recent = span(data.periods.recent);
  const ref = data.ageRefYear;
  const intro: Both = {
    ko: `같은 칸(구·단지·전용면적)이 ${base.ko}${wa(base.ko)} ${recent.ko}에 모두 거래된 ${num(data.cells)}칸을 기준 시기 중앙값의 가격대와 ${ref}년 기준 연식으로 나눠, 칸마다 잰 변화의 중앙값입니다.`,
    en: `Units (same district, complex and exclusive area) traded in both ${base.en} and ${recent.en}, ${num(data.cells)} in all, grouped by the price band of their base-period median and by building age as of ${ref}: the median of each unit's change.`,
  };
  const groups = [
    { label: { ko: "가격대(기준 시기 중앙값)", en: "Price band (base-period median)" }, rows: rowsOf(data.price) },
    { label: { ko: `연식(${ref}년 기준)`, en: `Building age (as of ${ref})` }, rows: rowsOf(data.age) },
  ];
  const lines = [pairLine(PRICE_DIM, data.price, data.pairs?.price), pairLine(AGE_DIM, data.age, data.pairs?.age)].filter(Boolean);
  const pairs: Both | null = lines.length
    ? {
        ko: `90% 구간이 겹치지 않을 때만 구별된다고 적습니다. ${lines.map((l) => l.ko).join(" ")}`,
        en: `A pair is called told apart only when the 90% ranges do not overlap. ${lines.map((l) => l.en).join(" ")}`,
      }
    : null;
  // #685 판정: 화면 PR 은 평균 회귀 한계를 표 옆에 적는다.
  const caveat: Both = {
    ko: "칸을 기준 시기 중앙값으로 가격대에 넣어, 기준값이 우연히 높거나 낮았던 칸이 양 끝 가격대에 모입니다(평균 회귀). 그래서 양 끝 가격대의 변화는 그만큼 어긋날 수 있고, 이를 보정하지 않았습니다.",
    en: "Units are banded by their base-period median, so units whose base value was by chance high or low gather in the end bands (regression to the mean). Changes in the end bands can be off for that reason; this is not corrected.",
  };
  const noYear: Both | null = data.noBuildYear
    ? { ko: `준공 연도가 없는 ${num(data.noBuildYear)}칸은 연식에서만 뺐습니다.`, en: `${num(data.noBuildYear)} units without a completion year are left out of the age rows only.` }
    : null;
  // 표 이름에는 숫자를 넣는다(장마다 다른 caption, accessibility 시험).
  const caption: Both = { ko: `가격대 ${data.price.length}줄·연식 ${data.age.length}줄`, en: `${data.price.length} price bands, ${data.age.length} age groups` };
  return { heading: SEGMENT_HEADING, intro, groups, pairs, caveat, noYear, caption };
}
