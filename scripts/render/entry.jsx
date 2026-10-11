// 이식된 조각의 목록 (#237). 이름은 prerender.mjs의 `*Html()` 함수 이름 그대로, 값은 같은 인자를 받아 React 요소를 돌려주는 함수다.
// 데이터가 없을 때는 legacy처럼 null을 돌려준다(그러면 자리표시가 legacy와 같은 방식으로 비게 된다).
// 여기서 `scripts/renderer.mjs`·`scripts/prerender.mjs`를 불러오면 안 된다(로더가 막는다). 계산은 순수 모듈에서 가져온다.
//
// 이식된 것: ratesHtml·ratesHeadHtml (#240, 금리 4개 상품군), summaryHtml·marketHtml·newsContextHtml·newsHtml·newsSummaryHtml·
// newsListHtml·newsKospiHtml·newsRealestateStatsHtml (#241 PR 1, 문장·목록 8개), conversionLeadHtml·cancelLeadHtml·cancelMonthLeadHtml·
// renewalLeadHtml·renewalCapLeadHtml·renewalWolseLeadHtml·conversionDistrictLinksHtml·cancelDistrictLinksHtml·renewalDistrictLinksHtml·
// floorDistrictLinksHtml (#241 PR 2, 리드·링크 10개). #241 나머지와 #242~#243이 이어서 채운다.
import { slugLinkEntries, slugLinkHref } from "../district-links.mjs";
import { indexNewsItems } from "../news-items.mjs";
import { RATES_ROWS, isSavingCategory, netInterestText, rate, rateRange, selectRateRows } from "../rates-table.mjs";

// legacy `escapeHtml(value)`의 값 변환(`String(value ?? "")`). React는 문자열·숫자만 글자로 내고 false·null·객체·배열은 비우거나 다르게 내거나 던지므로,
// legacy가 `escapeHtml`을 거치던 자리는 전부 이 함수를 거친다(비문자열 값이 "[object Object]"·"false"로 나오는 것까지 같게 맞춘다).
const str = (value) => String(value ?? "");

// legacy의 `escapeHtml(value ?? "")`는 String()으로 바꿔 쓴다 - React는 숫자 아닌 값(false·객체)을 글자로 내지 않으므로 같게 맞춘다.
const ProductCell = ({ product }) => (
  <td>
    <div className="product-name">{String(product.name ?? "-")}</div>
    <div className="product-company">{String(product.company ?? "")}</div>
  </td>
);

function ratesHead(category = "deposit") {
  return isSavingCategory(category) ? (
    <tr>
      <th scope="col">상품</th>
      <th scope="col">기본금리</th>
      <th scope="col">최고금리</th>
      <th scope="col">세후 이자</th>
    </tr>
  ) : (
    <tr>
      <th scope="col">상품</th>
      <th scope="col">금리 유형</th>
      <th scope="col">금리(최저~최고)</th>
      <th scope="col">평균</th>
    </tr>
  );
}

function ratesRows(rates, { category = "deposit", limit = RATES_ROWS } = {}) {
  const rows = selectRateRows(rates, category, limit);
  if (!rows) return null;

  const saving = isSavingCategory(category);
  return (
    <>
      {rows.map(({ product, option }, i) =>
        saving ? (
          <tr key={i}>
            <ProductCell product={product} />
            <td data-label="기본금리">{rate(option.rate)}</td>
            <td className="rate-strong" data-label="최고금리">
              {rate(option.maxRate ?? option.rate)}
            </td>
            <td className="net-interest" data-label="세후 이자">
              {netInterestText(option, category)}
            </td>
          </tr>
        ) : (
          <tr key={i}>
            <ProductCell product={product} />
            <td data-label="금리 유형">{String(option.rateType ?? "-")}</td>
            <td data-label="금리(최저~최고)">{rateRange(option.min, option.max)}</td>
            <td className="rate-low" data-label="평균">
              {rate(option.avg)}
            </td>
          </tr>
        )
      )}
    </>
  );
}

// ---- 문장·목록 조각 (#241 PR 1) ----

// 첫 화면 AI 요약: 하이라이트 → 분야 줄. 글이 빈 항목은 거른다(legacy와 같은 truthy 검사).
function summary(data) {
  const highlights = (data?.highlights ?? []).filter((h) => h.textKo);
  const categories = (data?.categories ?? []).filter((c) => c.lineKo);
  if (!highlights.length && !categories.length) return null;
  return (
    <>
      {highlights.map((h, i) => (
        <p key={`h${i}`}>
          <strong>{str(h.title)}</strong> {str(h.textKo)}
        </p>
      ))}
      {categories.map((c, i) => (
        <p key={`c${i}`}>
          <strong>{str(c.name)}</strong> {str(c.lineKo)}
        </p>
      ))}
    </>
  );
}

// 시장 지표 표: 환율 → 기준금리. 셀 값은 legacy에서 마크업 조각 문자열이었던 것(증감의 <span>)까지 JSX 요소로 쓴다.
function market(data) {
  if (!data) return null;
  const rows = [];
  if (typeof data.usdKrw?.value === "number") {
    const change = data.usdKrw.change ? <span title="전일 수집분 대비">{str(data.usdKrw.change)}</span> : "-";
    rows.push(["원/달러 환율", `${data.usdKrw.value.toFixed(2)}원`, change]);
  }
  if (data.baseRate?.value) {
    rows.push(["기준금리", `${str(data.baseRate.value)}%`, str(data.baseRate.effectiveFrom ?? "-")]);
  }
  if (!rows.length) return null;
  return (
    <>
      {rows.map(([name, value, change]) => (
        <tr key={name}>
          <td>{name}</td>
          <td data-label="값">{value}</td>
          <td data-label="증감">{change}</td>
        </tr>
      ))}
    </>
  );
}

// 기사 아래 맥락 칩. 칩이 없으면 legacy는 null이 아니라 빈 문자열을 내므로(자리표시가 빈다) 컴포넌트가 null을 그려 ""가 되게 한다.
const NewsContext = ({ context }) =>
  !context?.length ? null : (
    <div className="news-context">
      {context.map((c, i) => (
        <a key={i} className="context-chip" href={str(c.href)}>
          <span className="context-label">{str(c.label)}</span>
          <span className="context-value">{str(c.value)}</span>
          {c.note ? <span className="context-note">{str(c.note)}</span> : null}
        </a>
      ))}
    </div>
  );

// 뉴스 한 건. 첫 화면(newsHtml)만 미리보기 줄을 더 싣는다.
const NewsItem = ({ item, preview = false }) => (
  <li className="news-item">
    <a href={str(item.link)} target="_blank" rel="noopener">
      {str(item.title)}
    </a>
    <div className="news-meta">{str(item.source)}</div>
    {preview && item.preview ? <div className="news-preview">{str(item.preview)}</div> : null}
    <NewsContext context={item.context} />
  </li>
);

function newsIndex(news) {
  const all = news?.items ?? [];
  if (!all.length) return null;
  const items = indexNewsItems(all);
  return (
    <>
      {items.map((item, i) => (
        <NewsItem key={i} item={item} preview />
      ))}
      {all.length > items.length ? (
        <li className="news-more">
          <a href="./news.html">뉴스 전체 {all.length}건 보기 →</a>
        </li>
      ) : null}
    </>
  );
}

function newsSummary(data, category = null) {
  const all = (data?.categories ?? []).filter((c) => c.lineKo);
  const shown = category ? all.filter((c) => c.key === category) : all;
  if (!shown.length) return null;
  return (
    <>
      {shown.map((c, i) => (
        <p key={i}>
          <strong>{str(c.name)}</strong> {str(c.lineKo)}
        </p>
      ))}
    </>
  );
}

function newsList(news, category = null) {
  const all = news?.items ?? [];
  const items = category ? all.filter((item) => item.category === category) : all;
  if (!items.length) return null;
  return (
    <>
      {items.map((item, i) => (
        <NewsItem key={i} item={item} />
      ))}
    </>
  );
}

// 증시 뉴스 장의 코스피 카드. 종가 기준일이 있으면 라벨에 적는다.
function newsKospi(data) {
  const k = data?.kospi;
  if (!k?.value) return null;
  return (
    <div className="stat-card">
      <span className="stat-label">{str(k.asOf ? `코스피 ${k.asOf} 종가` : "코스피")}</span>
      <span className="stat-value">{str(k.value)}</span>
      {k.change ? <span className="stat-sub">{str(`전 거래일 대비 ${k.change}`)}</span> : null}
    </div>
  );
}

function newsRealestateStats(news) {
  const stats = news?.realestateStats ?? [];
  if (!stats.length) return null;
  return (
    <>
      {stats.map((s, i) => (
        <a key={i} className="stat-card" href={str(s.href)}>
          <span className="stat-label">{str(s.label)}</span>
          <span className="stat-value">{str(s.value)}</span>
          {s.note ? <span className="stat-sub">{str(s.note)}</span> : null}
        </a>
      ))}
    </>
  );
}

// ---- 리드·링크 조각 (#241 PR 2) ----

// 빌더가 만든 한 문단(leadKo 등). 글이 비면(falsy) legacy처럼 null이다. 글이 truthy인 비문자열(true·{}·[1,2]·[])은 legacy가 String()으로 내므로 str()을 거친다
// (빈 배열은 ""를 내는데 null이 아니라 빈 문자열이다 - legacy도 escapeHtml("")이라 같다).
const lead = (text) => (text ? <>{str(text)}</> : null);

// 전환·해제·재계약·층 네 화면의 자치구 링크. 항목 이름은 객체 키라 항상 문자열이므로 str()이 필요 없고, 경로는 legacy와 같은 모듈(district-links.mjs)이 만든다.
// 경로가 `./district-…`로 시작하므로 `javascript:` href가 될 수 없다(React 19 차단 차이의 대상이 아니다, #244).
function slugLinks(data) {
  const entries = slugLinkEntries(data);
  if (!entries.length) return null;
  return (
    <>
      {entries.map(([name, slug]) => (
        <a key={name} href={slugLinkHref(slug)}>
          {name}
        </a>
      ))}
    </>
  );
}

export const fragments = {
  ratesHeadHtml: ratesHead,
  ratesHtml: ratesRows,
  summaryHtml: summary,
  marketHtml: market,
  newsContextHtml: (context) => <NewsContext context={context} />,
  newsHtml: newsIndex,
  newsSummaryHtml: newsSummary,
  newsListHtml: newsList,
  newsKospiHtml: newsKospi,
  newsRealestateStatsHtml: newsRealestateStats,
  conversionLeadHtml: (conversion) => lead(conversion?.seoul?.leadKo),
  cancelLeadHtml: (cancellation) => lead(cancellation?.seoul?.leadKo),
  cancelMonthLeadHtml: (cancellation) => lead(cancellation?.seoul?.registrationLead?.ko),
  renewalLeadHtml: (renewal) => lead(renewal?.lead?.ko),
  renewalCapLeadHtml: (renewal) => lead(renewal?.capLead?.ko),
  renewalWolseLeadHtml: (renewal) => lead(renewal?.wolseLead?.ko),
  conversionDistrictLinksHtml: slugLinks,
  cancelDistrictLinksHtml: slugLinks,
  renewalDistrictLinksHtml: slugLinks,
  floorDistrictLinksHtml: slugLinks,
};
