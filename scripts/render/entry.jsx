// 이식된 조각의 목록 (#237). 이름은 prerender.ts의 `*Html()` 함수 이름 그대로, 값은 같은 인자를 받아 React 요소를 돌려주는 함수다.
// 데이터가 없을 때는 null을 돌려준다(그러면 자리표시가 비게 된다). 말할 것이 없어도 null이 아니라 빈 문자열("")을 내는 조각(자치구 문장 묶음·예산대 잎 8개)은 빈 조각으로 ""를 낸다 - 둘은 자리표시 치환에서 다르다.
// 여기서 `scripts/prerender.ts`를 불러오면 안 된다(로더가 막는다). 계산은 순수 모듈에서 가져온다.
//
// 이식된 것: (ratesHtml·ratesHeadHtml 은 #240 에서 이식했다가 금리 4장과 함께 지웠다 - #577 B2) summaryHtml·marketHtml·newsContextHtml·newsHtml·newsSummaryHtml·
// newsListHtml·newsKospiHtml·newsRealestateStatsHtml (#241 PR 1, 문장·목록 8개), conversionLeadHtml·cancelLeadHtml·cancelMonthLeadHtml·
// renewalLeadHtml·renewalCapLeadHtml·renewalWolseLeadHtml·conversionDistrictLinksHtml·cancelDistrictLinksHtml·renewalDistrictLinksHtml·
// floorDistrictLinksHtml (#241 PR 2, 리드·링크 10개), realestateHtml (#241 PR 3, 첫 화면 실거래 요약),
// districtSummaryHtml·districtRenewalHtml·districtFactsHtml·districtLinksHtml·conversionTableHtml·cancelDistrictsHtml·cancelMonthsHtml·
// renewalDistrictsHtml·renewalWolseDistrictsHtml·floorDistrictsHtml (#242 PR 1, 자치구 문장·링크 4개와 표 6개), realestateHeadHtml·realestateTableHtml (#242 PR 2, 시세표 머리글·표),
// realestateOverallHtml (#242 PR 3, 시세 요약 카드), budgetAnswersHtml·budgetMoreHtml·budgetMinCashHtml·budgetPolicyHtml·budgetCapHtml·budgetCostsHtml·budgetFactsHtml·budgetLoanHtml
// (#243 PR A, 예산대 잎 조각 8개), budgetCandidatesHtml·budgetBodyHtml (#243 PR B, 후보 단지와 합성 - 이것으로 prerender.ts의 조각 44개가 모두 이식됐다).
import { DISTRICT_PAGES } from "../district-slugs.ts";
import { BUDGET_MORE_LINKS, areaLine, areasShape, bodyShape,budgetAnswers, budgetRuleHref, candidatesShape, capNote, costsNote, dealShape, loanNote, minCashNote, policyNote, whereText } from "../budget-fragments.ts";
import { budgetFactSentences } from "../budget-facts.ts";
import { districtSentences } from "../district-summary.ts";
import { RESALE_LINK, districtResaleSentence, factSentences } from "../district-facts.ts";
import { DISTRICTS } from "../realestate-districts.ts";
import { rentFlowSentences } from "../rent-flow.ts";
import { MOVE_IN_DISTRICT_LINK, districtMoveInSentence } from "../move-in.ts";
import { linksBlockShape, slugLinkEntries, slugLinkHref } from "../district-links.ts";
import { cancelDistricts, cancelMonths, conversionTable, floorDistricts, renewalDistricts, renewalWolseDistricts } from "../district-tables.ts";
import { FALLBACK_NOTE_KO, hasFallback } from "../summary-note.ts";
import { metricCell, topDistricts } from "../realestate-rows.ts";
import { overallCards } from "../realestate-overall.ts";
import { headLabels, realestateTable } from "../realestate-table.ts";
import { renewalSentences } from "../renewal-facts.ts";
import { BANDS_HEAD, REPEAT_HEAD, REPEAT_LINK, repeatSalesView } from "../repeat-sales-view.ts";

// 옛 문자열 렌더의 `escapeHtml(value)`가 하던 값 변환(`String(value ?? "")`). React는 문자열·숫자만 글자로 내고 false·null·객체·배열은 비우거나 다르게 내거나 던지므로,
// 옛 문자열 렌더가 `escapeHtml`을 거치던 자리는 전부 이 함수를 거친다(비문자열 값이 "[object Object]"·"false"로 나오는 것까지 같게 맞춘다).
const str = (value) => String(value ?? "");

// ---- 문장·목록 조각 (#241 PR 1) ----

// 환율 값·기준일(#639 PR-2). 환율은 ECOS 일 계열(731Y001)이고 asOf 는 코스피와 같은 "10/23" 모양이다. 옛 수집기가 쓴 asOf 는
// RFC 날짜 글("Fri, 23 Oct …")이라 이 모양이 아니면 기준일이 없는 것으로 본다(옛 값에 「기준」을 붙이거나 매매기준율이라 부르지 않는다).
const fxNum = (value) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fxAsOf = (fx) => (typeof fx?.asOf === "string" && /^\d{1,2}\/\d{1,2}$/.test(fx.asOf) ? fx.asOf : null);

// 첫 화면 돈의 값 한 줄(#575 PR2): 기준금리 → 환율, " · " 로 잇는다. 환율에는 기준일을 붙인다(#639 PR-2).
function market(data) {
  if (!data) return null;
  const parts = [];
  if (data.baseRate?.value) parts.push(`한국은행 기준금리 ${str(data.baseRate.value)}%`);
  if (typeof data.usdKrw?.value === "number") {
    const at = fxAsOf(data.usdKrw);
    parts.push(`원/달러 환율 ${fxNum(data.usdKrw.value)}원${at ? `(${at} 기준)` : ""}`);
  }
  return parts.length ? <>{parts.join(" · ")}</> : null;
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

// 뉴스 한 건(뉴스 화면 목록). 미리보기 줄을 싣던 첫 화면 다섯 건은 뉴스 화면으로 옮겼다(#575 PR2).
const NewsItem = ({ item }) => (
  <li className="news-item">
    <a href={str(item.link)} target="_blank" rel="noopener">
      {str(item.title)}
    </a>
    <div className="news-meta">{str(item.source)}</div>
    <NewsContext context={item.context} />
  </li>
);

// 첫 화면 뉴스 자리: 뉴스 화면으로 가는 한 줄(#575 PR2).
function newsIndex(news) {
  const n = Array.isArray(news?.items) ? news.items.length : 0;
  if (!n) return null;
  return (
    <a href="./news.html" id="news-link" data-n={String(n)}>
      {`오늘 뉴스 ${n}건·AI 요약 →`}
    </a>
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
      {hasFallback(shown) ? <div className="summary-note">{FALLBACK_NOTE_KO}</div> : null}
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

// 증시 뉴스 장의 시장 카드. 코스피 카드(종가 기준일이 있으면 라벨에 적는다) 옆에 원/달러 환율 카드(#639 PR-2).
// 환율 카드는 ECOS 매매기준율이라 기준일이 "10/23" 모양일 때만 낸다(옛 수집기의 값에는 「매매기준율」이라 부를 수 없다). 영어는 m-en 으로 같이 굽고 html lang 이 가린다.
const Bi = ({ ko, en }) => (
  <>
    <span className="m-ko">{ko}</span>
    <span className="m-en">{en}</span>
  </>
);

function newsKospi(data) {
  const k = data?.kospi;
  const fx = data?.usdKrw;
  const at = typeof fx?.value === "number" ? fxAsOf(fx) : null;
  if (!k?.value && !at) return null;
  return (
    <>
      {k?.value ? (
        <div className="stat-card">
          <span className="stat-label">{str(k.asOf ? `코스피 ${k.asOf} 종가` : "코스피")}</span>
          <span className="stat-value">{str(k.value)}</span>
          {k.change ? <span className="stat-sub">{str(`전 거래일 대비 ${k.change}`)}</span> : null}
        </div>
      ) : null}
      {at ? (
        <div className="stat-card">
          <span className="stat-label">
            <Bi ko={`원/달러 환율 ${at} 매매기준율`} en={`USD/KRW ${at} reference rate`} />
          </span>
          <span className="stat-value">{fxNum(fx.value)}</span>
          {fx.change ? (
            <span className="stat-sub">
              <Bi ko={`전 영업일 대비 ${str(fx.change)}`} en={`vs previous business day ${str(fx.change)}`} />
            </span>
          ) : null}
        </div>
      ) : null}
    </>
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

// ---- 첫 화면 실거래 요약 (#241 PR 3) ----

// 표 한 칸. 칸의 모양(없음·표본 부족·값)과 글자는 realestate-rows.mjs가 정하고(legacy와 같은 함수), 여기서는 마크업만 입힌다.
// 표본 부족은 값을 내지 않고 "표본 N건"이라 적는다(DIRECTION 해자 2). 건수는 legacy가 문자열에 그대로 끼우던 것이라 템플릿으로 끼운다
// (undefined·null·false도 "undefined"·"null"·"false"로 나온다 - React가 비워 버리지 않게).
// 공백은 {" "}로 낸다 - JSX는 줄 끝 공백을 지운다.
const MetricCell = ({ kind, metric, overall }) => {
  const cell = metricCell(kind, metric, overall);
  if (cell.type === "none") return "-";
  if (cell.type === "low") {
    return (
      <span className="low-sample" title={`신고 ${cell.count}건이라 평균을 내기엔 표본이 부족합니다`}>
        {`표본 ${cell.count}건`}
      </span>
    );
  }
  return (
    <>
      {cell.text}
      {cell.change ? (
        <>
          {" "}
          <span className="change">{`${cell.change.sign}${cell.change.text}`}</span>
        </>
      ) : null}
      {cell.count ? (
        <>
          {" "}
          <span className="count">{cell.count}</span>
        </>
      ) : null}
    </>
  );
};

const RealestateRow = ({ name, data, overall }) => (
  <tr>
    <td>{str(name)}</td>
    <td data-label="매매">
      <MetricCell kind="sale" metric={data.sale} overall={overall} />
    </td>
    <td data-label="전세">
      <MetricCell kind="jeonse" metric={data.jeonse} overall={overall} />
    </td>
    <td data-label="월세">
      <MetricCell kind="wolse" metric={data.wolse} overall={overall} />
    </td>
  </tr>
);

// 서울 전체 한 줄 + 매매 평당가 상위 자치구(정렬·자름은 topDistricts, legacy와 같은 함수).
function realestate(data) {
  if (!data?.overall) return null;
  return (
    <>
      <RealestateRow name="서울 전체" data={data.overall} overall />
      {topDistricts(data).map((d, i) => (
        <RealestateRow key={i} name={d.name} data={d} />
      ))}
    </>
  );
}

// ---- 자치구 문장·링크 4개와 표 6개 (#242 PR 1) ----

// 자치구 페이지의 문장 묶음. 문장은 모듈이 한국어·영어로 만들어 주고(legacy와 같은 함수), 여기서는 공백으로 이어 한 덩어리로 낸다.
// 문장이 하나도 없으면 legacy는 null이 아니라 빈 문자열을 낸다(자리표시가 빈다 - null과 ""는 자리표시 치환에서 다르다). 이어 붙인 글자는 항상 문자열이라 str()이 필요 없다.
const sentenceBlock = (sentences) => <>{sentences.length ? sentences.join(" ") : ""}</>;

function districtSummary(realestate, district, locale = "ko", spread = null) {
  if (!district) return sentenceBlock([]);
  const entry = (realestate?.districts ?? []).find((d) => d.name === district);
  return sentenceBlock(districtSentences(entry, realestate, locale, spread));
}

const districtRenewal = (facts, locale = "ko") => sentenceBlock(renewalSentences(facts, locale));
const districtFacts = (facts, locale = "ko") => sentenceBlock(factSentences(facts, locale));
const districtRentFlow = (name, flow, locale = "ko") => sentenceBlock(rentFlowSentences(name, flow, locale));
// 입주 예정 한 줄(#677): 문장은 move-in.ts, 끝에 price-outlook 구×반기 표로 가는 링크 하나. 구·집계가 없으면 빈 조각.
const districtMoveIn = (name, moveIn, locale = "ko") => {
  const text = districtMoveInSentence(name, moveIn, locale);
  if (!text) return <></>;
  return (
    <>
      {text} <a href={MOVE_IN_DISTRICT_LINK.href}>{MOVE_IN_DISTRICT_LINK[locale === "en" ? "en" : "ko"]}</a>
    </>
  );
};
// 같은 집 재거래 한 줄(#716 G1): 인자는 (자치구 이름, repeat-sales.json 전체, locale). 문장은 district-facts.ts, 끝에 갈아타기 쌍 표 링크 하나.
// 구 이름이 없거나 집계가 접혔으면 빈 조각.
const districtResale = (name, data, locale = "ko") => {
  const code = DISTRICTS.find((d) => d.name === name)?.code;
  const text = districtResaleSentence(code, data, locale);
  if (!text) return <></>;
  return (
    <>
      {text} <a href={RESALE_LINK.href}>{RESALE_LINK[locale === "en" ? "en" : "ko"]}</a>
    </>
  );
};

// 다른 자치구 링크 묶음. 머리글·상자의 분기와 id는 linksBlockShape, 경로는 slugLinkHref다.
// 경로는 DISTRICT_PAGES(코드가 정한 slug)로 만든 `./district-<slug>.html`이라 `javascript:`로 시작할 수 없다(React 19 차단 차이의 대상이 아니다).
// 링크가 하나도 없는 분기(block이 null)는 DISTRICT_PAGES가 상수라 지금은 닿지 않는 방어 코드다.
// order(자치구 이름 배열)가 있으면 그 순서가 먼저이고 나머지는 원래 순서로 뒤에 선다 - 예산대 장이 그 예산대 거래가 많은 구부터 놓는다(V12 #658).
function districtLinks(current = null, heading = "다른 지역", order = null) {
  const block = linksBlockShape("district-links", heading, DISTRICT_PAGES.length);
  if (!block) return sentenceBlock([]);
  const rank = (name) => {
    const i = order ? order.indexOf(name) : -1;
    return i < 0 ? Infinity : i;
  };
  const pages = order ? [...DISTRICT_PAGES].sort((a, b) => rank(a.name) - rank(b.name)) : DISTRICT_PAGES;
  return (
    <>
      <h3 className="district-links-heading" id={block.headingId}>
        {str(block.heading)}
      </h3>
      <div className="district-links" id={block.boxId}>
        {pages.map(({ name, slug }) =>
          name === current ? (
            <a key={name} href={slugLinkHref(slug)} aria-current="page">
              {name}
            </a>
          ) : (
            <a key={name} href={slugLinkHref(slug)}>
              {name}
            </a>
          )
        )}
      </div>
    </>
  );
}

// 표 한 칸의 "표본 부족" 스팬. 값이 아니라 모자란다고 적는다(DIRECTION 해자 2). 표본 부족인지는 district-tables.mjs가 정한다.
const LowSample = ({ children }) => <span className="low-sample">{children}</span>;
const GapCell = ({ gap }) => (gap.low ? <LowSample>표본 부족</LowSample> : gap.text);

// 전환율 표.
function conversionTableJsx(conversion, band) {
  const table = conversionTable(conversion, band);
  if (!table) return null;
  return (
    <>
      <caption className="cost-label" style={{ captionSide: "top", textAlign: "left", paddingBottom: "8px" }}>
        {table.caption}
      </caption>
      <thead>
        <tr>
          <th scope="col">자치구</th>
          <th scope="col">전환율</th>
          <th scope="col">전세</th>
          <th scope="col">월세</th>
          <th scope="col">단지</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            <td>{str(row.district)}</td>
            <td>{row.rate}</td>
            <td>{row.jeonse}</td>
            <td>{row.rent}</td>
            <td>{row.pairs}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function cancelDistrictsJsx(cancellation) {
  const rows = cancelDistricts(cancellation);
  if (!rows) return null;
  return (
    <>
      <thead>
        <tr>
          <th scope="col">자치구</th>
          <th scope="col">신고</th>
          <th scope="col">해제</th>
          <th scope="col">해제율</th>
          <th scope="col">미등기</th>
          <th scope="col">미등기율</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{str(row.district)}</td>
            <td>{row.deals}</td>
            <td>{row.cancelled}</td>
            <td>{row.cancelledShare}</td>
            <td>{row.stale}</td>
            <td>{row.staleShare}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function cancelMonthsJsx(cancellation) {
  const rows = cancelMonths(cancellation);
  if (!rows) return null;
  return (
    <>
      <thead>
        <tr>
          <th scope="col">계약월</th>
          <th scope="col">계약</th>
          <th scope="col">등기 완료</th>
          <th scope="col">완료율</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={row.spot ? "spot" : undefined}>
            <td>{str(row.month)}</td>
            <td>{row.filed}</td>
            <td>{row.registered}</td>
            <td>{row.share}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function renewalDistrictsJsx(renewal) {
  const rows = renewalDistricts(renewal);
  if (!rows) return null;
  return (
    <>
      <thead>
        <tr>
          <th scope="col">자치구</th>
          <th scope="col">갱신 − 신규</th>
          <th scope="col">시세보다 싼 비율</th>
          <th scope="col">맞물린 계약</th>
          <th scope="col">상한 미달</th>
          <th scope="col">요구권 행사</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{str(row.district)}</td>
            <td>
              <GapCell gap={row.gap} />
            </td>
            <td>{row.cheaper}</td>
            <td>{row.matched}</td>
            <td>{row.capMiss}</td>
            <td>{row.rightUsed}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function renewalWolseDistrictsJsx(renewal) {
  const table = renewalWolseDistricts(renewal);
  if (!table) return null;
  return (
    <>
      <thead>
        <tr>
          <th scope="col">자치구</th>
          <th scope="col">{table.rateHeading}</th>
          <th scope="col">{table.endsHeading}</th>
          <th scope="col">시세보다 싼 비율</th>
          <th scope="col">맞물린 계약</th>
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            <td>{str(row.district)}</td>
            <td>
              <GapCell gap={row.gap} />
            </td>
            <td>{row.range}</td>
            <td>{row.cheaper}</td>
            <td>{row.matched}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

function floorDistrictsJsx(floor) {
  const rows = floorDistricts(floor);
  if (!rows) return null;
  return (
    <>
      <thead>
        <tr>
          <th scope="col">자치구</th>
          <th scope="col">1층 − 3층 이상</th>
          <th scope="col">맞물린 칸</th>
          <th scope="col">서울과 다른가</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{str(row.district)}</td>
            <td>{row.median}</td>
            <td>{row.cells}</td>
            <td>{row.lowText === null ? "다르다" : <LowSample>{row.lowText}</LowSample>}</td>
          </tr>
        ))}
      </tbody>
    </>
  );
}

// ---- 시세표 머리글·표 (#242 PR 2) ----

// 칸(조각 배열)의 마크업. 조각의 종류와 글자는 realestate-table.mjs가 정하고(legacy와 같은 함수), 여기서는 요소만 입힌다: 종류마다 span의 class가 있고, title이 있으면 그 span의 title이다.
// 표본 부족은 값을 내지 않고 모자란다고 적는다(`low` 조각 → `low-sample`, DIRECTION 해자 2). 글자는 전부 모듈이 만든 문자열이라 str()이 필요 없다(이름 칸만 받은 값 그대로다).
const RE_PART_CLASS = { strong: "price-strong", count: "count", ratio: "ratio", low: "low-sample", stale: "prev-tag" };
const ReCell = ({ parts }) => (
  <>
    {parts.map((p, i) =>
      p.type === "text" ? (
        p.text
      ) : (
        <span key={i} className={p.type === "change" ? `change ${p.dir}` : RE_PART_CLASS[p.type]} title={p.title ?? undefined}>
          {p.text}
        </span>
      )
    )}
  </>
);

// 이름 칸: 자치구면 그 자치구 페이지로 가는 링크(경로는 모듈의 상수 `./district-…`라 `javascript:`가 될 수 없다, #244), 서울 전체는 글자만. 이름은 legacy가 escapeHtml(값 ?? "")하던 자리라 str()이다.
const ReName = ({ name }) => (name.href ? <a href={name.href}>{str(name.text)}</a> : str(name.text));

// 낡음 태그(row.stale)는 이름 칸 안에 이름 바로 뒤에 붙는다(앞 공백을 조각이 들고 있다).
const ReRow = ({ row }) => (
  <tr className={row.overall ? "overall-row" : ""}>
    <td>
      <ReName name={row.name} />
      <ReCell parts={row.stale} />
    </td>
    {row.cells.map((cell, i) => (
      <td key={i} data-label={cell.label}>
        <ReCell parts={cell.parts} />
      </td>
    ))}
  </tr>
);

const ReDistrictRow = ({ row }) => (
  <tr>
    <td>{row.label}</td>
    {row.cells.map((cell, i) => (
      <td key={i} data-label={cell.label}>
        <ReCell parts={cell.parts} />
      </td>
    ))}
  </tr>
);

function realestateHead(kind = null, district = null) {
  return (
    <tr>
      {headLabels(kind, district).map((label, i) => (
        <th key={i} scope="col">
          {label}
        </th>
      ))}
    </tr>
  );
}

// 시세표: 데이터가 없으면 legacy처럼 null이다(자리표시를 비운다).
function realestateTableJsx(realestate, kind = null, district = null) {
  const table = realestateTable(realestate, kind, district);
  if (!table) return null;
  return (
    <>
      {table.rows.map((row, i) => (table.byDistrict ? <ReDistrictRow key={i} row={row} /> : <ReRow key={i} row={row} />))}
    </>
  );
}

// ---- 시세 요약 카드 (#242 PR 3) ----

// 카드의 라벨·값·부가 글자는 realestate-overall.mjs가 정하고(legacy와 같은 함수), 여기서는 요소(클래스 포함)만 입힌다. 글자는 전부 모듈이 만든 문자열이라 str()이 필요 없다 -
// 조각(seg)마다 legacy가 이스케이프하던 자리(esc)와 그대로 끼우던 자리가 있지만, React는 어느 쪽이든 텍스트로 낸다(raw 자리에는 `& < > "`가 들 수 없다 - 숫자 서식 글자뿐이다).
// 값·부가 글자는 조각을 한 문자열로 이어서 내 텍스트 노드 하나로 둔다(legacy가 한 덩어리로 이어 붙이는 것과 같다).
const segsText = (segs) => segs.map((seg) => seg.text).join("");
// 값 칸만 표본 부족 이유(`low` 조각, #264)를 `<span class="low-sample">`로 입힌다. 이유 조각은 값 칸의 유일한 조각이다(title 없음).
const OverallValue = ({ segs }) => (segs[0].low ? <span className="low-sample">{segsText(segs)}</span> : segsText(segs));
const OverallCard = ({ card }) => (
  <div className="overall-card">
    <div className="label">{card.label}</div>
    <div className="value">
      <OverallValue segs={card.value} />
    </div>
    {card.sub ? <div className="sub">{segsText(card.sub)}</div> : null}
  </div>
);

// 시세 요약: 서울 전체도(자치구면 그 자치구도) 없으면 legacy처럼 null이다(자리표시를 비운다).
function realestateOverallJsx(realestate, kind = null, district = null, spread = null) {
  const cards = overallCards(realestate, kind, district, spread);
  if (!cards) return null;
  return (
    <>
      {cards.map((card, i) => (
        <OverallCard key={i} card={card} />
      ))}
    </>
  );
}

// ---- 예산대 잎 조각 8개 (#243 PR A) ----

// 이 조각들은 빈 결과를 null이 아니라 빈 문자열("")로 낸다(합성 조각 budgetBodyHtml만 null이다 - 아래 PR B). 자리표시 치환에서 null은 틀의 내용을 그대로 두고 ""는 비운다(applyPrerender) - 둘은 다르다.
// 빈 결과는 빈 조각 하나(<>{""}</>)로 그려 react.mjs가 ""로 낸다(sentenceBlock([])과 같다).
const blank = <>{""}</>;

// 문단 끝의 규칙 링크(#66). 앞 공백은 옛 legacy budgetRuleLink가 글자로 들고 있던 것이다 - JSX는 {" "}로 낸다. 주소는 모듈(budgetRuleHref)이 정한 `./method.html#budget-rules-<id>`이고
// id는 코드가 정한 상수 다섯이라 `javascript:`가 될 수 없다(React 19 차단 차이의 대상이 아니다, #244).
const RuleLink = ({ link }) => (
  <>
    {" "}
    <a className="budget-rule-link" href={budgetRuleHref(link.id)}>
      {link.text}
    </a>
  </>
);

// 문장 + 규칙 링크 한 문단. 문장·링크 글자는 전부 모듈이 만든 문자열이라 str()이 필요 없다. 속성은 JSX 순서대로 나가므로 className 다음에 data-prerendered=""(맨 속성은 React가 못 낸다, #259).
// 문단이 없으면(note가 null) legacy처럼 빈 문자열이다.
const budgetNote = (className, note) =>
  note ? (
    <p className={className} data-prerendered="">
      {note.sentence}
      {note.link ? <RuleLink link={note.link} /> : null}
    </p>
  ) : (
    blank
  );

// "한눈에": 줄마다 라벨·값(글자 값이면 answer-text)·부가 글자(비면 줄 없음). 예산대가 없으면 legacy처럼 빈 문자열이다.
// 제목 아래 기준 칩(#411 확장, 모듈 basisChips). 금리 칩의 data-rate-month 는 머리 도장(updated-stamp.ts crossStampHtml)이 읽어 「금리(8월분)」을 만든다 - 칩과 도장이 한 값이다.
function budgetAnswersJsx(band, loanBasis = null, context = {}) {
  const answers = budgetAnswers(band, loanBasis, context);
  if (!answers) return blank;
  return (
    <section className="budget-answers" data-prerendered="">
      <h2>{answers.heading}</h2>
      <p className="answer-basis">
        {/* 칩 사이 공백 한 칸: 화면은 flex gap 이 띄우고, 복사·읽기 모드 글자가 「신고분보정」처럼 붙지 않게 한다 */}
        {answers.chips.flatMap((chip, i) => [
          i ? " " : null,
          <span key={chip.kind} data-rate-month={chip.month}>
            {chip.text}
          </span>,
        ])}
      </p>
      <ul>
        {answers.lines.map((line, i) => (
          <li key={i}>
            <span className="answer-label">{line.label}</span>
            <strong className={line.text ? "answer-value answer-text" : "answer-value"}>{line.value}</strong>
            {line.note ? <span className="answer-note">{line.note}</span> : null}
          </li>
        ))}
      </ul>
      <p className="answer-more">근거와 예외는 아래 문단의 링크(→)에 있습니다.</p>
    </section>
  );
}

// 다음 질문으로 가는 길. 인자를 읽지 않는다(legacy도 읽지 않는다). 주소는 모듈의 상대 경로 상수 다섯이다.
const budgetMoreJsx = () => (
  <section className="budget-more-links" data-prerendered="">
    <h3>매물을 보러 가기 전에</h3>
    <ul>
      {BUDGET_MORE_LINKS.map(([href, text]) => (
        <li key={href}>
          <a href={href}>{text}</a>
        </li>
      ))}
    </ul>
  </section>
);

// 돈 문단 다섯: 문장 + 규칙 링크. 합성 조각(budgetBodyJsx)도 이 함수들을 그대로 부른다.
const budgetMinCashJsx = (band) => budgetNote("budget-loan budget-mincash", minCashNote(band));
const budgetPolicyJsx = (band, policyCounts) => budgetNote("budget-loan budget-policy", policyNote(band, policyCounts));
const budgetCapJsx = (band, capStats) => budgetNote("budget-loan budget-cap", capNote(band, capStats));
const budgetCostsJsx = (band) => budgetNote("budget-loan budget-costs", costsNote(band));
const budgetLoanJsx = (band, loanBasis) => budgetNote("budget-loan", loanNote(band, loanBasis));

// 예산대 페이지가 자기 이야기를 하는 문단(ko·en 두 벌을 빌드가 굽는다). 문장 묶음 한 덩어리 - 문장이 없으면 빈 문자열(sentenceBlock).
const budgetFacts = (band, locale = "ko") => sentenceBlock(budgetFactSentences(band?.facts, locale));

// ---- 후보 단지·합성 (#243 PR B) ----

// "어디로 가는가" 한 문장. 문장이 없으면 legacy처럼 빈 문자열이다(말할 것이 없는 예산대). 글자는 모듈(whereText)이 만든 문자열이라 str()이 필요 없다.
const budgetWhereJsx = (band) => {
  const text = whereText(band);
  return text ? (
    <p className="budget-where" data-prerendered="">
      {text}
    </p>
  ) : (
    blank
  );
};

// 단지 후보 절. 예산대나 단지 파일이 없으면 빈 문자열, 후보가 없으면 안내 한 문장. 단지 이름(row.apt)은 legacy가 escapeHtml(값 ?? "")하던 입력 그대로의 자리라 str()이다.
// 나머지 글자(주소 포함)는 모듈(candidatesShape)이 만든 문자열이다. 주소는 코드가 정한 `./deal-search.html?…`라 `javascript:`가 될 수 없다(React 19 차단 차이의 대상이 아니다, #244) -
// 단지·구 이름은 encodeURIComponent를 거쳐 쿼리에만 들어간다. `&`는 React가 속성값에서 `&amp;`로 내 legacy의 `&amp;`와 같다.
function budgetCandidatesJsx(band, complexFiles) {
  const shape = candidatesShape(band, complexFiles);
  if (!shape) return blank;
  if (shape.empty !== undefined) {
    return (
      <section className="budget-candidates" data-prerendered="">
        <h3>이 예산대의 단지 후보</h3>
        <p>{shape.empty}</p>
      </section>
    );
  }
  return (
    <section className="budget-candidates" data-prerendered="">
      <h3>이 예산대의 단지 후보</h3>
      <p>{shape.intro}</p>
      <div className="budget-districts">{shape.bandCounts}</div>
      <div className="budget-districts">{shape.districts}</div>
      <ul className="budget-deals">
        {shape.rows.map((row, i) => (
          <li key={i} className="budget-deal">
            <a className="apt" href={row.href}>
              {str(row.apt)}
            </a>
            <span className="meta">{row.facts}</span>
            <span className="amount">{row.amount}</span>
            <span className="meta">{row.meta}</span>
          </li>
        ))}
      </ul>
      <p className="budget-more">
        <a href={shape.moreHref}>{shape.moreText}</a>
      </p>
    </section>
  );
}

// 거래 한 줄. 네 칸의 글자는 모두 모듈(dealShape)이 만든 문자열이다.
const BudgetDeal = ({ deal }) => {
  const { place, spec, when, price } = dealShape(deal);
  return (
    <li className="budget-deal">
      <span className="place">{place}</span>
      <span className="spec">{spec}</span>
      <span className="when">{when}</span>
      <span className="price">{price}</span>
    </li>
  );
};

// 예산대 본문 합성: 거래 요약 → 한눈에 → 지역 줄 → 어디로 가는가 → 예산으로 찾기(제목+칩) → 후보 단지 → 돈 문단(근거) → 다음 질문 → 거래 목록. JSX는 prerender.ts의 래퍼를 부를 수 없으므로 하위 조각을 JSX 함수로 직접 잇는다
// (그래서 후보 단지가 JSX로 있어야 이 조각을 옮길 수 있었다). 순서는 prerender.ts의 budgetBodyHtmlLegacy와 같다(#460). 예산대가 없으면 null이다 - 합성 조각만 null이고 잎은 ""다(잎의 반환값이 이어 붙는 자리에 "null" 글자가 박히지 않게).
// 하위 조각의 호출 순서는 legacy와 같다(입력이 이상할 때 던지는 자리가 같아야 한다). 거래 목록은 맨 뒤라 이상한 거래(null 등)는 하위 조각을 다 부른 뒤에 던진다.
// finderHtml은 빌드가 만든 마크업 문자열(제목+칩)이라 그대로 낸다. 비면 이 절은 없다.
// areaLines(V12 #658)는 빌드가 areasShape·areaLine(budget-fragments.ts)으로 만든 글자 배열이다 - 「단지 후보가 많은 구」 한 줄씩. 비면 이 절은 없다(인자를 안 넘기던 호출은 전과 같다).
function budgetBodyJsx(band, periodList, loanBasis = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null, finderHtml = "", areaLines = []) {
  const shape = bodyShape(band, periodList);
  if (!shape) return null;
  return (
    <>
      <p className="budget-summary">
        {shape.summary}
        {shape.periods ? (
          <>
            {" "}
            <span className="when">{shape.periods}</span>
          </>
        ) : null}
      </p>
      {budgetAnswersJsx(band, loanBasis, { periodList, complexFiles })}
      {shape.districts.length ? (
        <div className="budget-districts">
          거래가 많은 지역: {shape.districts.flatMap((d, i) => [i ? " · " : "", str(d.name), " ", d.count])}
        </div>
      ) : null}
      {budgetWhereJsx(band)}
      {areaLines?.length ? (
        <div className="budget-areas" data-prerendered="">
          <p>단지 후보가 많은 구:</p>
          <ul>
            {areaLines.map((line, i) => (
              <li key={i}>{str(line)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {finderHtml ? <div data-prerendered="" dangerouslySetInnerHTML={{ __html: finderHtml }} /> : null}
      {budgetCandidatesJsx(band, complexFiles)}
      {budgetLoanJsx(band, loanBasis)}
      {budgetCostsJsx(band)}
      {budgetMinCashJsx(band)}
      {budgetCapJsx(band, capStats)}
      {budgetPolicyJsx(band, policyCounts)}
      {budgetMoreJsx()}
      <ul className="budget-deals">
        {band.deals.map((deal, i) => (
          <BudgetDeal key={i} deal={deal} />
        ))}
      </ul>
    </>
  );
}

// 갈아타기 「다른 자와 견주면」 안의 같은 집 쌍 절(#170 V8 R1). 글자·칸은 repeat-sales-view.ts, 두 언어를 굽고 html lang 이 가린다(Bi).
// 표 이름은 손으로 단다(sr-only) - 자동 caption 은 m-ko·m-en 머리글을 이어 붙여 읽는다. 출처 줄은 자리표시로 두고 applyPrerender 가 꽂는다.
function repeatSalesJsx(data) {
  const v = repeatSalesView(data);
  if (!v) return null;
  const more = (
    <>
      <a className="m-ko" href="./method.html#repeat-sales">{REPEAT_LINK.ko}</a>
      <a className="m-en" href="./method.html#repeat-sales-en">{REPEAT_LINK.en}</a>
    </>
  );
  if (v.fold) {
    return (
      <p className="lead" id="repeat-fold">
        <Bi ko={v.fold.ko} en={v.fold.en} /> {more}
      </p>
    );
  }
  return (
    <>
      <h3>
        <Bi ko={v.heading.ko} en={v.heading.en} />
      </h3>
      <p className="lead">
        <Bi ko={v.intro.ko} en={v.intro.en} />
      </p>
      <div className="table-scroll">
        <table className="rate-table outlook-table">
          <caption className="sr-only">
            <Bi ko={v.caption.ko} en={v.caption.en} />
          </caption>
          <thead>
            <tr>
              {REPEAT_HEAD.map((h, i) => (
                <th key={i} scope="col">
                  <Bi ko={h.ko} en={h.en} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>
                  {r.n}
                  {r.many ? <LowSample><Bi ko=" 이상치 많음" en=" many outliers" /></LowSample> : null}
                </td>
                {r.cells ? (
                  r.cells.map((c, k) => <td key={k}>{c}</td>)
                ) : (
                  <td colSpan={4}>
                    <LowSample>
                      <Bi ko={r.blank.ko} en={r.blank.en} />
                    </LowSample>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {v.gap ? (
        <p className="content-notice">
          <Bi ko={v.gap.ko} en={v.gap.en} />
        </p>
      ) : null}
      <p className="content-notice">
        <Bi ko={v.order.ko} en={v.order.en} /> {more}
        <br />
        <Bi ko="{{src:repeatSales.ko}}" en="{{src:repeatSales.en}}" />
      </p>
      {repeatBandsJsx(v.bands)}
    </>
  );
}

// 같은 절의 둘째 표: 앞 거래가 3분의 1(N6, 판정 #170 6403691545). 글자는 repeat-sales-view.ts 의 repeatBandsView. 출처는 위 절의 출처 줄과 같다(같은 쌍).
function repeatBandsJsx(b) {
  if (!b) return null;
  if (b.fold) {
    return (
      <p className="content-notice" id="repeat-bands-fold">
        <Bi ko={b.fold.ko} en={b.fold.en} />
      </p>
    );
  }
  // 렌더 HTML 예산(+1.5KB, 두 언어)에 맞춰 표 제목(굵게)과 표 위 문단을 보이는 caption 하나로 굽고(제목 요소·sr-only 이름·문단을 따로 두지 않는다),
  // 머리글은 언어별 줄 하나씩(셀마다 span 을 두지 않는다) 굽는다.
  const Head = ({ lang }) => (
    <span className={`m-${lang}`}>
      <strong>{b.title[lang]}</strong> {b.lead[lang]}
    </span>
  );
  return (
    <>
      <div className="table-scroll">
        <table className="rate-table outlook-table">
          <caption>
            <Head lang="ko" />
            <Head lang="en" />
          </caption>
          <thead>
            {["ko", "en"].map((lang) => (
              <tr key={lang} className={`m-${lang}`}>
                {BANDS_HEAD.map((h, i) => (
                  <th key={i} scope="col">
                    {h[lang]}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <Bi ko={r.name.ko} en={r.name.en} />
                  <br />
                  {r.bound}
                </td>
                {r.cells.map((c, k) => (
                  <td key={k}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const fragments = {
  marketHtml: market,
  realestateHtml: realestate,
  realestateHeadHtml: realestateHead,
  realestateTableHtml: realestateTableJsx,
  realestateOverallHtml: realestateOverallJsx,
  budgetAnswersHtml: budgetAnswersJsx,
  budgetMoreHtml: budgetMoreJsx,
  budgetMinCashHtml: budgetMinCashJsx,
  budgetPolicyHtml: budgetPolicyJsx,
  budgetCapHtml: budgetCapJsx,
  budgetCostsHtml: budgetCostsJsx,
  budgetFactsHtml: budgetFacts,
  budgetCandidatesHtml: budgetCandidatesJsx,
  budgetBodyHtml: budgetBodyJsx,
  budgetLoanHtml: budgetLoanJsx,
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
  districtSummaryHtml: districtSummary,
  districtRenewalHtml: districtRenewal,
  districtFactsHtml: districtFacts,
  districtRentFlowHtml: districtRentFlow,
  districtMoveInHtml: districtMoveIn,
  districtResaleHtml: districtResale,
  districtLinksHtml: districtLinks,
  conversionTableHtml: conversionTableJsx,
  cancelDistrictsHtml: cancelDistrictsJsx,
  cancelMonthsHtml: cancelMonthsJsx,
  renewalDistrictsHtml: renewalDistrictsJsx,
  renewalWolseDistrictsHtml: renewalWolseDistrictsJsx,
  floorDistrictsHtml: floorDistrictsJsx,
  repeatSalesHtml: repeatSalesJsx,
};
