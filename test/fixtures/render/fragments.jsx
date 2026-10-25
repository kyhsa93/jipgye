// render-loader 시험용 진입 파일. 실제 이식은 scripts/render/entry.jsx에 들어간다(#240~).
// 로더가 JSX 를 컴파일해 조각 목록을 돌려주는지, 렌더러가 요소를 문자열로 그리는지 보는 최소 조각 셋이다.
export const fragments = {
  // 링크 목록. 데이터가 없으면 null, 글자는 React 가 이스케이프한다.
  listHtml(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return null;
    return (
      <>
        {items.map((item, i) => (
          <div key={i}>
            <a href={String(item.link ?? "")} target="_blank" rel="noopener">
              {String(item.title ?? "")}
            </a>
          </div>
        ))}
      </>
    );
  },
  // 조각이 던지면 그 오류가 그대로 올라와야 한다(삼키지 않는다).
  newsHtml() {
    throw new Error("의도한 조각 실패");
  },
  // 데이터 없음(null)은 null 이다.
  marketHtml: () => null,
};
