// render-loader·render-parity 시험용 진입 파일. 실제 이식은 scripts/render/entry.jsx에 들어간다(#240~).
// summaryHtml의 쌍둥이: legacy(`prerender.mjs`의 summaryHtmlLegacy)와 같은 입력에서 같은 바이트를 내야 한다.
import { FALLBACK_NOTE_KO, hasFallback } from "../../../scripts/summary-note.ts";
import { SUMMARY_CATEGORIES_LABEL_KO, SUMMARY_HIGHLIGHTS_LABEL_KO, summaryMetaKo } from "../../../scripts/summary-box.ts";

// (#352 부터 이 쌍둥이도 index 요약 상자 모양이다 - entry.jsx 의 summary 와 같은 구조를 줄여 적었다.)
export const fragments = {
  summaryHtml(summary) {
    const categories = Array.isArray(summary?.categories) ? summary.categories : [];
    if (!categories.length) return null;
    const highlights = Array.isArray(summary?.highlights) ? summary.highlights : [];
    return (
      <>
        {highlights.length ? (
          <>
            <div className="summary-highlights">
              <div className="summary-section-label">{SUMMARY_HIGHLIGHTS_LABEL_KO}</div>
              {highlights.map((h, i) => (
                <div className="summary-highlight" key={i}>
                  <a href={String(h.link ?? "")} target="_blank" rel="noopener">
                    {String(h.title ?? "")}
                  </a>
                  <span className="summary-link-source">{` · ${String(h.source ?? "")}`}</span>
                  <div className="summary-highlight-text">{String(h.textKo ?? "")}</div>
                </div>
              ))}
            </div>
            <div className="summary-section-label">{SUMMARY_CATEGORIES_LABEL_KO}</div>
          </>
        ) : null}
        {categories.map((c, i) => (
          <div className="summary-category" key={i}>
            <div className="summary-category-label">{String(c.name ?? "")}</div>
            <div className="summary-category-line">{String(c.lineKo ?? "")}</div>
          </div>
        ))}
        {hasFallback(categories) ? <div className="summary-fallback-note">{FALLBACK_NOTE_KO}</div> : null}
        <span className="summary-meta">{summaryMetaKo(summary)}</span>
      </>
    );
  },
  // 조각이 던지면 그 오류가 그대로 올라와야 한다(삼켜 legacy로 넘기지 않는다).
  newsHtml() {
    throw new Error("의도한 조각 실패");
  },
  // 데이터 없음(null)은 legacy와 같이 null이다.
  marketHtml: () => null,
};
