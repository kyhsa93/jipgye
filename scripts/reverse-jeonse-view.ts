// 전망 장 「2년 전 계약 보증금과 지금 신규 전세」 절(#693 N11 PR2)의 글자와 표 조각. 순수 모듈 - 파일·시계를 읽지 않는다.
//
// 숫자는 docs/data/reverse-jeonse.json(scripts/reverse-jeonse.ts, PR1 #919) 그대로다. 달·문턱·줄 정의도 json 의 windows·min·baseRows 를 읽는다 -
// 화면에 박은 달·문턱이 다음 달 json 과 어긋나지 않게(cto 조건 5 (e), 완료 조건 3).
// 빌드 때 두 언어를 다 굽는다(cto 조건 11 - 새 fetch 0). 문장은 틀의 lang 구역 두 벌(장의 언어 전환이 hidden 을 옮긴다), 표 칸은 bilingualCells 가 합친다.
// 지키는 것(#693 본문·cpo 4단계 메모):
// - 2년 전 쪽 값을 「시세」라 부르지 않는다 - 「2년 전 계약 보증금(신규·갱신 포함)」이다(pm 판정 ①). 「역전세」 같은 판정어도 쓰지 않는다.
// - 「개별 계약 판정 아님」을 절 안에 적는다(완료 조건 4). 단지 이름은 json 에 없어 나올 수도 없다.
// - 격차가 null 인 행은 빈칸·「−」가 아니라 「하락 칸이 20칸 미만이라 격차를 내지 않음」(완료 조건 2 넷째 줄). 20 은 json min.cells.
//   서울 행도 같은 문구다(서울 하락 칸이 20 미만인 달). 칸 문턱 미달 구의 「표본 부족」과 다른 문구다.
// - 서울 격차의 % 와 금액은 따로 구한 중간값이라 한 문장에 묶지 않는다(같은 칸의 값이 아닐 수 있다).
// - 「하락 비율이 나온 구 n/25」 옆에 표본 부족 구와 원본이 빠진 구의 수를 같이 적는다 - 원본이 빠진 구가 표본 부족 속에 숨지 않게.
// - 「중앙값」이 아니라 「중간값」(test/plain-terms.test.mjs MEDIAN_PAGES).

import { districtNameEn } from "./district-slugs.ts";
import { escapeHtml } from "./html-escape.ts";

type Both = { ko: string; en: string };
type Gap = { pct: number; amount: number } | null;
type Row = { cells?: number; short?: boolean; missing?: boolean; fell?: number; fellShare?: number; gap?: Gap };

/** 화면에서 method 새 절로 가는 링크(완료 조건 5 - 두 창의 달 정의를 적는 자리). */
export const REVERSE_JEONSE_METHOD = { ko: "./method.html#reverse-jeonse", en: "./method.html#reverse-jeonse-en" } as const;

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const count = (n: number) => n.toLocaleString("en-US");
const signed = (v: number) => `${v > 0 ? "+" : ""}${v}`;
const pct = (v: number) => `${signed(v)}%`;
/** 만원 → 「-3,316만원」 / 「-₩33.2M」. */
const won: Record<"ko" | "en", (v: number) => string> = {
  ko: (v) => `${v < 0 ? "-" : v > 0 ? "+" : ""}${count(Math.abs(v))}만원`,
  en: (v) => `${v < 0 ? "-" : v > 0 ? "+" : ""}₩${(Math.abs(v) / 100).toFixed(1)}M`,
};

/** [첫 달, 끝 달](YYYYMM) → 「2024년 12월~2025년 2월」/「Dec 2024–Feb 2025」(해가 같으면 해를 한 번). */
export function spanText([first, last]: string[]): Both {
  const y = (m: string) => m.slice(0, 4);
  const mo = (m: string) => Number(m.slice(4, 6));
  if (y(first) === y(last)) return { ko: `${y(first)}년 ${mo(first)}~${mo(last)}월`, en: `${MONTHS_EN[mo(first) - 1]}–${MONTHS_EN[mo(last) - 1]} ${y(first)}` };
  return { ko: `${y(first)}년 ${mo(first)}월~${y(last)}년 ${mo(last)}월`, en: `${MONTHS_EN[mo(first) - 1]} ${y(first)}–${MONTHS_EN[mo(last) - 1]} ${y(last)}` };
}

/** 격차를 내지 않는 행의 문구. 숫자는 json min.cells(완료 조건 2). */
export const noGapText = (cells: number): Both => ({
  ko: `하락 칸이 ${cells}칸 미만이라 격차를 내지 않음`,
  en: `Fewer than ${cells} falling units, so no gap is given`,
});
/** 칸 문턱 미달 구(표본 부족) - 격차 없음 문구와 다르게 둔다. */
export const shortText = (cells: number): Both => ({ ko: `표본 부족(견준 칸 ${cells}칸 미만)`, en: `Too few units (under ${cells})` });
export const MISSING_TEXT: Both = { ko: "원본이 빠져 셈하지 않음", en: "Source data missing, not counted" };

/** 하락 비율이 나온 구·표본 부족 구·원본이 빠진 구의 수. 「하락 비율이 나온 구」는 칸 문턱을 넘은 구다(완료 조건 2). */
export function districtCounts(districts: Record<string, Row>) {
  const rows = Object.values(districts ?? {});
  return {
    total: rows.length,
    shown: rows.filter((r) => typeof r.fellShare === "number").length,
    short: rows.filter((r) => r.short).length,
    missing: rows.filter((r) => r.missing).length,
  };
}

/** 표본 부족·원본 빠짐 구의 수를 괄호 하나로(없으면 빈 글자). 원본이 빠진 구가 표본 부족 속에 숨지 않게 따로 센다. */
function restText(c: ReturnType<typeof districtCounts>): Both {
  const parts = [
    c.short ? { ko: `표본 부족 ${c.short}곳`, en: `${c.short} with too few units` } : null,
    c.missing ? { ko: `원본이 빠진 구 ${c.missing}곳`, en: `${c.missing} with source data missing` } : null,
  ].filter(Boolean) as Both[];
  if (!parts.length) return { ko: "", en: "" };
  return { ko: `(${parts.map((p) => p.ko).join(", ")})`, en: ` (${parts.map((p) => p.en).join(", ")})` };
}

/** 서울 행 옆 「하락 비율이 나온 구 n/25」(완료 조건 2). */
export function countsText(c: ReturnType<typeof districtCounts>): Both {
  const rest = restText(c);
  return { ko: `하락 비율이 나온 구 ${c.shown}/${c.total}${rest.ko}`, en: `Districts with a share shown: ${c.shown}/${c.total}${rest.en}` };
}

/** 행 하나의 칸 셋(견준 칸·하락 칸·격차). 표본 부족·원본 빠짐은 칸을 합친다. */
function rowCells(row: Row, min: number, lang: "ko" | "en") {
  if (row.missing) return `<td colspan="3">${MISSING_TEXT[lang]}</td>`;
  if (row.short) return `<td>${count(row.cells)}</td><td colspan="2">${shortText(min)[lang]}</td>`;
  const fell = lang === "ko" ? `${count(row.fell)}칸(${row.fellShare}%)` : `${count(row.fell)} (${row.fellShare}%)`;
  const gap = row.gap ? `${pct(row.gap.pct)}<div class="sub">${won[lang](row.gap.amount)}</div>` : noGapText(min)[lang];
  return `<td>${count(row.cells)}</td><td>${fell}</td><td>${gap}</td>`;
}

function tableHtml(data, lang: "ko" | "en") {
  const min = data.min.cells;
  const ko = lang === "ko";
  const head = ko ? ["자치구", "견준 칸", "하락 칸(비율)", "하락 칸 격차(중간값)"] : ["District", "Units compared", "Falling units (share)", "Gap in falling units (median)"];
  const seoulName = `${ko ? "서울" : "All Seoul"}<div class="sub">${countsText(districtCounts(data.districts))[lang]}</div>`;
  const rows = [
    `<tr><th scope="row">${seoulName}</th>${rowCells(data.seoul, min, lang)}</tr>`,
    ...Object.entries<Row>(data.districts).map(([name, row]) => `<tr><th scope="row">${ko ? name : districtNameEn(name)}</th>${rowCells(row, min, lang)}</tr>`),
  ];
  return `<thead><tr>${head.map((x) => `<th scope="col">${x}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
}

/** json 이 화면에 쓸 모양인지. 아니면 null 을 돌려 틀의 빈 자리를 그대로 둔다. */
const usable = (data) =>
  Array.isArray(data?.windows?.base) && Array.isArray(data?.windows?.now) && Number.isFinite(data?.min?.cells) && Number.isFinite(data?.min?.perSide) && data?.seoul && data?.districts;

/**
 * 절의 세 조각: lead(문장 두 벌)·table(표 칸 두 벌 {ko, en} - 합치기는 prerender 의 bilingualCells)·note(단서 두 벌, method 링크).
 * 문장은 escapeHtml 을 거친 글자다(json 의 숫자·달만 들어가지만 틀에 HTML 로 꽂히므로).
 */
export function reverseJeonseView(data) {
  if (!usable(data)) return null;
  const base = spanText(data.windows.base);
  const now = spanText(data.windows.now);
  const seoul: Row = data.seoul;
  const min = data.min.cells;
  const compared: Both = {
    ko: `신고 기한(계약 후 30일)이 닫힌 최근 3개월(${now.ko})의 신규 전세 보증금을, 같은 단지·같은 면적대의 2년 전 계약 보증금(신규·갱신 포함, ${base.ko} 계약)과 견줬습니다.`,
    en: `New jeonse deposits from the latest three months whose 30-day filing window has closed (${now.en}) are set against deposits signed two years earlier in the same complex and unit size (new and renewed contracts, signed ${base.en}).`,
  };
  const share: Both = seoul.short
    ? { ko: `서울 전체에서 견줄 수 있는 칸이 ${count(seoul.cells)}칸뿐이라 ${shortText(min).ko}으로 값을 내지 않습니다.`, en: `Only ${count(seoul.cells)} units in Seoul can be compared, so no figure is given (under ${min}).` }
    : {
        ko: `서울에서 견줄 수 있는 ${count(seoul.cells)}칸 가운데 지금 신규 전세 보증금의 중간값이 2년 전 계약 보증금의 중간값보다 낮은 칸(하락 칸)은 ${count(seoul.fell)}칸, ${seoul.fellShare}%입니다.`,
        en: `Of ${count(seoul.cells)} comparable units in Seoul, ${count(seoul.fell)} (${seoul.fellShare}%) have a lower median new deposit now than the median deposit two years ago (falling units).`,
      };
  const gap: Both | null = seoul.short
    ? null
    : seoul.gap
      ? {
          ko: `하락 칸에서 보증금이 줄어든 비율의 중간값은 ${pct(seoul.gap.pct)}입니다. 줄어든 금액의 중간값은 ${won.ko(seoul.gap.amount)}입니다.`,
          en: `In those units, the median change is ${pct(seoul.gap.pct)}. The median change in money is ${won.en(seoul.gap.amount)}.`,
        }
      : { ko: `서울 하락 칸 격차 — ${noGapText(min).ko}.`, en: `Seoul gap — ${noGapText(min).en}.` };
  const c = districtCounts(data.districts);
  const districts: Both = { ko: `하락 비율이 나온 구는 ${c.shown}/${c.total}입니다${restText(c).ko}.`, en: `${countsText(c).en}.` };
  const lead: Both = {
    ko: [compared.ko, share.ko, gap?.ko, districts.ko].filter(Boolean).join(" "),
    en: [compared.en, share.en, gap?.en, districts.en].filter(Boolean).join(" "),
  };
  const note: Both = {
    ko:
      `구 단위로 모은 값이라 개별 계약의 판정이 아닙니다. 2년 전 쪽에는 갱신 계약(인상 5% 상한)과 계약구분이 비어 있는 계약이 섞여 있고 칸마다 그 비율이 달라, 같은 집의 보증금이 그만큼 바뀌었다는 뜻이 아닙니다. ` +
      `격차의 비율과 금액은 따로 구한 중간값이라 같은 칸의 값이 아닐 수 있습니다. 칸은 각 시기 ${data.min.perSide}건 이상인 것만 견주고, 견준 칸이 ${min}칸 미만인 구는 값을 비우며, 하락 칸이 ${min}칸 미만이면 격차를 내지 않습니다. ` +
      `두 시기는 정확히 24개월 간격이 아닙니다.`,
    en:
      `These are district aggregates, not a verdict on any single contract. The earlier side mixes renewals (capped at a 5% rise) and contracts with no type given, in shares that differ by unit, so a gap does not mean that one home's deposit moved by that much. ` +
      `The rate and the money gap are separate medians and need not come from the same unit. A unit is compared only with ${data.min.perSide} or more contracts in each period; districts with fewer than ${min} units are left blank, and no gap is given with fewer than ${min} falling units. ` +
      `The two periods are not exactly 24 months apart.`,
  };
  const link: Both = { ko: "두 시기를 고른 방법 →", en: "How the two periods are chosen →" };
  return {
    lead: { ko: escapeHtml(lead.ko), en: escapeHtml(lead.en) },
    table: { ko: tableHtml(data, "ko"), en: tableHtml(data, "en") },
    note: {
      ko: `${escapeHtml(note.ko)} <a href="${REVERSE_JEONSE_METHOD.ko}">${link.ko}</a>`,
      en: `${escapeHtml(note.en)} <a href="${REVERSE_JEONSE_METHOD.en}">${link.en}</a>`,
    },
  };
}
