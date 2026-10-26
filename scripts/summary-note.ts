import { escapeHtml } from "./html-escape.ts";

// AI 요약 상자의 분야별 글 도우미(#350 → #745 PR6). 순수 모듈 - render/entry.jsx(JSX)가 구울 때 쓰고, 뉴스 틀 renderSummary 가 같은 글을 그린다.
//
// 검증 폴백(summary.json 의 categories[].fallbackReason): 요약 봇이 분야 요약을 검증에서 걸러 헤드라인 목록으로 갈아 끼운 날이다.
// 그 헤드라인 목록을 요약처럼 보이지 않게 분야 줄을 「요약 검증 실패: 제목만 표시(이유)」로 바꾸고, 제목은 아래 근거 기사 목록(펼친 채)이 보인다.
// 근거 기사(sourcesMarkup, 빌드 때만 - 화면 스크립트는 다시 그리지 않는다, S6): categories[].items(제목·링크·언론사)에 news.json 의 발행 시각을 링크로 찾아 붙인다(한국 시각 날짜).
//
// 분야 줄의 구운 쪽은 한국어다. 원본 문구는 뉴스 틀 문자열 표(T.ko.failed·T.ko.reasons)이고,
// 이 상수가 그 한국어와 글자까지 같은지는 test/summary-note.test.mjs 가 대조한다.

export const FAILED_KO = "요약 검증 실패: 제목만 표시";
export const REASONS_KO = { "generation-failed": "생성 실패", "unverified-number": "원문에 없는 숫자", "unverified-entity": "원문에 없는 이름" };

/** 폴백 분야의 한 줄. 모르는 이유 코드는 코드 그대로 괄호에 적는다. */
export const failedLineKo = (reason) => `${FAILED_KO}(${REASONS_KO[reason] ?? reason})`;

/** 근거 기사 접기 머리(분야 이름·건수). 빌드 때만 굽는다 - 두 언어를 다 굽고 html lang 이 가린다. */
export const sourcesKo = (name, n) => `${name} 근거 기사 ${n}건`;
export const sourcesEn = (name, n) => `${name}: ${n} source article${n === 1 ? "" : "s"}`;

/** ISO 시각 → 한국 시각 날짜(YYYY-MM-DD). 읽을 수 없으면 빈 글자.  */
export const kstDate = (iso) => {
  const d = new Date(Date.parse(iso) + 324e5);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

/** 근거 기사 한 건의 출처 줄: 언론사 · 발행일. news 는 news.json(없어도 된다). */
export const sourceMeta = (item, news) =>
  [item?.source == null ? "" : String(item.source), kstDate(news?.items?.find((n) => n.link === item?.link)?.publishedAt)].filter(Boolean).join(" · ");

/** 요약 상자에 보이는 분야: 한 줄(lineKo)이 있고, 분야 장이면 그 분야만. 뉴스 틀 renderSummary 의 shown 과 같은 조건이다. */
export const summaryShown = (data, category = null) => {
  const all = (data?.categories ?? []).filter((c) => c.lineKo);
  return category ? all.filter((c) => c.key === category) : all;
};

/**
 * 요약 아래 근거 기사(#745 PR6): 분야마다 접힌 목록(제목·원문 링크·언론사·발행일). 검증에서 걸러진 분야는 펼친 채 굽는다.
 * 머리는 두 언어를 굽고 html lang 이 가린다(#summary-src .m-ko/.m-en). 근거가 없으면 빈 글자(자리표시가 빈다).
 * 지난 기록(?date=)에서는 화면 스크립트가 #summary-src 를 가린다 - 구운 근거는 오늘 요약의 것이다.
 */
export function sourcesMarkup(summary, category = null, news = null) {
  const s = (v) => escapeHtml(v == null ? "" : String(v));
  return summaryShown(summary, category)
    .filter((c) => Array.isArray(c.items) && c.items.length)
    .map(
      (c) =>
        `<details class="summary-src"${c.fallbackReason ? " open" : ""}><summary>` +
        `<span class="m-ko">${s(sourcesKo(c.name ?? "", c.items.length))}</span><span class="m-en">${s(sourcesEn(c.nameEn ?? c.name ?? "", c.items.length))}</span></summary><ul>` +
        c.items
          .map((i) => `<li><a href="${s(i?.link)}" target="_blank" rel="noopener">${s(i?.title)}</a> <span class="news-meta">${s(sourceMeta(i, news))}</span></li>`)
          .join("") +
        `</ul></details>`
    )
    .join("");
}
