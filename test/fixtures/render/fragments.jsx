// render-loader·render-parity 시험용 진입 파일. 실제 이식은 scripts/render/entry.jsx에 들어간다(#240~).
// summaryHtml의 쌍둥이: legacy(`prerender.mjs`의 summaryHtmlLegacy)와 같은 입력에서 같은 바이트를 내야 한다.
export const fragments = {
  summaryHtml(summary) {
    const highlights = (summary?.highlights ?? []).filter((h) => h.textKo);
    const categories = (summary?.categories ?? []).filter((c) => c.lineKo);
    if (!highlights.length && !categories.length) return null;
    return (
      <>
        {highlights.map((h) => (
          <p key={h.title}>
            <strong>{h.title}</strong> {h.textKo}
          </p>
        ))}
        {categories.map((c) => (
          <p key={c.name}>
            <strong>{c.name}</strong> {c.lineKo}
          </p>
        ))}
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
