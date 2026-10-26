// 갈아타기 화면 「같은 집이 다시 팔렸을 때」 절(#170 V8 R1)의 글자와 칸. 순수 모듈 - 마크업은 render/entry.jsx 의 repeatSalesHtml 이 그린다.
//
// 문장은 판정(#170 6402863306) 2·3번을 그대로 옮긴 것이다(문장 다듬기는 po 몫이라 여기서 고치지 않는다). 두 언어를 다 굽고 html lang 이
// 가린다(m-ko·m-en) - 이 장의 인라인 스크립트는 S6 기준선까지 여유가 없어 번역 표를 더하지 않는다.
// 지키는 것: '편향'이라 부르지 않는다(원인은 재지 않았다), 연율화·시장 지수는 '아니다'로만 쓴다, 순위·「더 올랐다」를 쓰지 않는다(구 코드순),
// 5-1 ⑦ 금지어 0건. 접힘(5-1 ④·판정 5번): 킬 스위치가 발동하거나 값을 낼 수 있는 구가 13곳 미만이면 표 없이 한 줄.
import { districtNames } from "./realestate-districts.ts";

type Both = { ko: string; en: string };

/** 빌더가 낸 % (소수 1자리, p 배열). 로그 값에서 다시 내지 않는다 - 6자리 로그에서는 반올림 경계가 갈린다. */
const pct = (v: number | null) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
const monthKo = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(4))}월`;
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthEn = (ym: string) => `${MONTHS_EN[Number(ym.slice(4)) - 1]} ${ym.slice(0, 4)}`;

export const REPEAT_HEADING: Both = { ko: "같은 집이 다시 팔렸을 때", en: "When the same home sold again" };
export const REPEAT_LINK: Both = { ko: "어떻게 셌나 →", en: "How it was counted →" };
export const REPEAT_HEAD: Both[] = [
  { ko: "자치구", en: "District" },
  { ko: "쌍 수", en: "Pairs" },
  { ko: "중간값", en: "Median" },
  { ko: "90% 구간", en: "90% range" },
  { ko: "간격 중간값(일)", en: "Median gap (days)" },
  { ko: "부동산원(같은 쌍)", en: "REB (same pairs)" },
];

export function repeatSalesView(data) {
  if (!data?.rows?.length || !data.window) return null;
  const { from, to } = data.window;
  const span = { ko: `${monthKo(from)}~${monthKo(to)}`, en: `${monthEn(from)}–${monthEn(to)}` };
  const c = data.checks ?? {};
  if (c.kill || !c.enough) {
    const fold: Both = c.kill
      ? {
          ko: `${REPEAT_HEADING.ko}: ${span.ko} 계약 쌍은 사전에 정한 점검(한국부동산원 조사와의 최소 정합)을 넘지 못해 값을 싣지 않습니다.`,
          en: `${REPEAT_HEADING.en}: pairs contracted ${span.en} failed the pre-set check against the Korea Real Estate Board survey, so no figures are shown.`,
        }
      : {
          ko: `${REPEAT_HEADING.ko}: ${span.ko} 계약 쌍으로 값을 낼 수 있는 구가 ${c.published ?? 0}곳이라 사전에 정한 13곳에 못 미쳐 값을 싣지 않습니다.`,
          en: `${REPEAT_HEADING.en}: only ${c.published ?? 0} districts had enough pairs contracted ${span.en}, short of the pre-set 13, so no figures are shown.`,
        };
    return { fold };
  }
  const intro: Both = {
    ko: `${span.ko} 계약 기준, 같은 집(단지·면적·층)이 300~730일 간격으로 두 번 중개거래된 쌍의 가격 변화 중간값입니다. 시장 지수가 아니고 연율화하지 않았으며, 다시 팔린 집만 들어옵니다.`,
    en: `Contracts ${span.en}: the median price change across pairs in which the same home (complex, area, floor) sold twice through a broker, 300–730 days apart. It is not a market index, it is not annualised, and only homes that sold again are included.`,
  };
  const s = data.seoul;
  const all = data.compared === 25 && data.higher === 25;
  const gap: Both | null =
    s?.p && data.compared
      ? {
          ko:
            `${all ? "모든 구에서" : `${data.compared}개 구 가운데 ${data.higher}개 구에서`} 한국부동산원 지수의 같은 기간 변화보다 큽니다` +
            `(서울 전체 쌍 ${pct(s.p[0])}, 같은 쌍 기간의 부동산원 ${pct(s.p[1])}). 원인은 재지 않았습니다 — 다시 팔린 집의 구성, 직거래 제외, 지수 산정 방식 차이가 후보입니다.`,
          en:
            `${all ? "In every district" : `In ${data.higher} of ${data.compared} districts`} it is larger than the Korea Real Estate Board index change over the same periods ` +
            `(all Seoul pairs ${pct(s.p[0])}; the Board over the same pair periods ${pct(s.p[1])}). The cause has not been measured — the mix of homes that resold, the exclusion of direct deals and differences in how the index is built are candidates.`,
        }
      : null;
  // 표는 구 코드순이다. E(간격 상관 |ρ| ≥ 0.5)가 걸리면 구끼리 견주지 말라는 한 줄을 더한다 - 이 절에는 원래 구 사이 비교 문구가 없다.
  const order: Both = c.dropCompare
    ? { ko: "표는 구 코드 순이고 순위가 아닙니다. 구마다 쌍의 간격 구성이 값과 함께 움직여 구끼리 견주지 않습니다.", en: "Rows are in district-code order, not a ranking. Pair spacing moves with the values across districts, so districts are not compared with each other." }
    : { ko: "표는 구 코드 순이고 순위가 아닙니다.", en: "Rows are in district-code order, not a ranking." };
  const rows = data.rows.map((r) => ({
    name: districtNames.get(r.gu) ?? r.gu,
    n: r.n,
    many: r.out === 1,
    blank:
      r.st === "thin"
        ? { ko: `쌍이 모자람(${r.n}쌍)`, en: `too few pairs (${r.n})` }
        : r.st === "shaky"
          ? { ko: "흔들림이 커 비움", en: "too unstable, left blank" }
          : null,
    cells: r.st === "ok" ? [pct(r.p[0]), `${pct(r.p[1])} ~ ${pct(r.p[2])}`, String(r.gap), pct(r.p[3])] : null,
  }));
  // 표 이름에는 숫자를 넣는다(장마다 다른 caption, accessibility 시험).
  const caption: Both = { ko: `같은 집 쌍 ${rows.length}개 구`, en: `Same-home pairs, ${rows.length} districts` };
  return { heading: REPEAT_HEADING, intro, gap, order, rows, caption, bands: repeatBandsView(data.bands) };
}

// ---------------------------------------------------------------- 둘째 표: 앞 거래가 3분의 1 (N6, 판정 #170 6403691545)
//
// 문구는 판정 그대로: 표 제목, 행 「낮은 쪽·가운데·높은 쪽 3분의 1」(「싼 집·비싼 집」이라 부르지 않는다), 표 위 한 줄 「같은 칸 방식과 방향이 같다」,
// 차이 문장은 구간이 겹치지 않는 쌍만(빌더의 say ≠ 0) 적고 바로 옆에 평균 회귀 한계(보정하지 않음)를 붙인다. 「시장 지수가 아니다·다시 팔린 집만」은 v0 문구를 다시 쓴다.
// 접음(빌더 fold): 5-2 ② 미달·흔들림, N4 산출 없음, ⑦ 방향 불일치면 표 없이 한 줄.

export const BANDS_TITLE: Both = { ko: "앞 거래가 기준 3분의 1씩 나눈 같은 집 재거래 변화", en: "Same-home resales by thirds of earlier price" };
export const BAND_NAMES: Both[] = [
  { ko: "낮은 쪽 3분의 1", en: "Lower third" },
  { ko: "가운데 3분의 1", en: "Middle third" },
  { ko: "높은 쪽 3분의 1", en: "Upper third" },
];
// 첫 칸은 행 이름 + 경계(언어와 무관한 기호, 만원)라 머리글 하나로 둘을 덮는다 - 렌더 HTML 예산(+1.5KB) 안에 두 언어를 굽는다.
export const BANDS_HEAD: Both[] = [
  { ko: "앞 거래가(만원)", en: "Earlier (₩10k)" },
  { ko: "쌍 수", en: "Pairs" },
  { ko: "중간값", en: "Median" },
  { ko: "90% 구간", en: "90% range" },
];
// 차이 문장의 이름. 「3분의 1」은 표에 있어 문장에서는 줄이고, 크고 작음은 언어와 무관한 부등호로 적는다(예산).
const SHORT: Both[] = [{ ko: "낮은 쪽", en: "lower" }, { ko: "가운데", en: "middle" }, { ko: "높은 쪽", en: "upper" }];
/** BAND_PAIRS(repeat-sales.ts)와 같은 순서: 낮은–가운데, 가운데–높은, 낮은–높은. */
const PAIRS = [[0, 1], [1, 2], [0, 2]];
const FOLD_WHY: Record<string, Both> = {
  thin: { ko: "쌍이 모자라거나 값이 흔들려", en: "a third had too few pairs or was unstable" },
  noN4: { ko: "같은 칸 방식(가격대·연식별 1년 변화)과 대조하지 못해", en: "it could not be checked against the same-unit method (1-year change by price band and building age)" },
  n4: { ko: "같은 칸 방식(가격대·연식별 1년 변화)과 방향이 맞지 않아", en: "its direction did not match the same-unit method (1-year change by price band and building age)" },
};
const won = (v: number) => v.toLocaleString("en-US");

export function repeatBandsView(b) {
  if (!b?.rows?.length || !Array.isArray(b.b)) return null;
  if (b.fold || b.rows.some((r) => r.st)) {
    const why = FOLD_WHY[b.fold] ?? FOLD_WHY.thin;
    return { fold: { ko: `${BANDS_TITLE.ko} 표는 ${why.ko} 사전에 정한 점검을 넘지 못해 싣지 않습니다.`, en: `The table of ${BANDS_TITLE.en.toLowerCase()} is not shown: ${why.en}, so it did not pass the pre-set checks.` } };
  }
  // 경계는 언어와 무관한 기호로 적는다(앞 거래가 만원, 낮은 쪽 ≤ B1 < 가운데 ≤ B2 < 높은 쪽).
  const bounds = [`≤${won(b.b[0])}`, `≤${won(b.b[1])}`, `>${won(b.b[1])}`];
  const rows = b.rows.map((r, k) => ({ name: BAND_NAMES[k], bound: bounds[k], cells: [won(r.n), pct(r.p[0]), `${pct(r.p[1])} ~ ${pct(r.p[2])}`] }));
  // 「가운데 > 낮은 쪽」: 뒤 가격대(j)의 값이 앞(i)보다 크면 >. 말할 수 없는 쌍(say 0)은 적지 않는다.
  const said = PAIRS.map(([i, j], k) => ({ i, j, dir: b.say?.[k] ?? 0 })).filter((x) => x.dir);
  // 평균 회귀 한계는 양 끝(낮은 쪽–높은 쪽, say[2])의 차이를 말할 때만 붙인다(#697 판정).
  const ends = (b.say?.[2] ?? 0) !== 0;
  const list = (lang: keyof Both) => said.map(({ i, j, dir }) => `${SHORT[j][lang]} ${dir > 0 ? ">" : "<"} ${SHORT[i][lang]}`).join(" · ");
  // 표 위 한 문단(판정: 표 위에 「방향이 같다」 한 줄, 차이 문장 바로 옆에 평균 회귀 한계). 말할 쌍이 없으면 차이·한계 문장 없이 첫 줄만.
  const lead: Both = {
    ko:
      "같은 칸 방식(가격대·연식별 1년 변화)과 방향이 같습니다. 시장 지수가 아니고, 다시 팔린 집만 들어옵니다." +
      (said.length ? ` 구간이 겹치지 않아 구별되는 쌍: ${list("ko")}.${ends ? " 양 끝의 차이는 평균 회귀로 커 보일 수 있습니다(보정하지 않음)." : ""}` : ""),
    en:
      "Same direction as the same-unit method (1-year change by price band and age). Not a market index; resold homes only." +
      (said.length ? ` Told apart (ranges do not overlap): ${list("en")}.${ends ? " Gaps at the ends can look larger through regression to the mean (not corrected)." : ""}` : ""),
  };
  return { title: BANDS_TITLE, lead, rows };
}
