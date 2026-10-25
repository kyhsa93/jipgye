// 이식된 조각의 목록 (#237). 이름은 prerender.ts의 `*Html()` 함수 이름 그대로, 값은 같은 인자를 받아 React 요소를 돌려주는 함수다.
// 데이터가 없을 때는 legacy처럼 null을 돌려준다(그러면 자리표시가 legacy와 같은 방식으로 비게 된다). legacy가 null이 아니라 빈 문자열("")을 내는 조각(자치구 문장 묶음·예산대 잎 8개)은 빈 조각으로 ""를 낸다 - 둘은 자리표시 치환에서 다르다.
// 여기서 `scripts/renderer.mjs`·`scripts/prerender.ts`를 불러오면 안 된다(로더가 막는다). 계산은 순수 모듈에서 가져온다.
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
import { BUDGET_MORE_LINKS, bodyShape, budgetAnswers, budgetRuleHref, candidatesShape, capNote, costsNote, dealShape, loanNote, minCashNote, policyNote, whereText } from "../budget-fragments.ts";
import { budgetFactSentences } from "../budget-facts.ts";
import { districtSentences } from "../district-summary.ts";
import { factSentences } from "../district-facts.ts";
import { linksBlockShape, slugLinkEntries, slugLinkHref } from "../district-links.ts";
import { cancelDistricts, cancelMonths, conversionTable, floorDistricts, renewalDistricts, renewalWolseDistricts } from "../district-tables.ts";
import { FALLBACK_NOTE_KO, hasFallback } from "../summary-note.ts";
import { SUMMARY_CATEGORIES_LABEL_KO, SUMMARY_HIGHLIGHTS_LABEL_KO, summaryMetaKo } from "../summary-box.ts";
import { metricCell, topDistricts } from "../realestate-rows.ts";
import { overallCards } from "../realestate-overall.ts";
import { headLabels, realestateTable } from "../realestate-table.ts";
import { renewalSentences } from "../renewal-facts.ts";

// legacy `escapeHtml(value)`의 값 변환(`String(value ?? "")`). React는 문자열·숫자만 글자로 내고 false·null·객체·배열은 비우거나 다르게 내거나 던지므로,
// legacy가 `escapeHtml`을 거치던 자리는 전부 이 함수를 거친다(비문자열 값이 "[object Object]"·"false"로 나오는 것까지 같게 맞춘다).
const str = (value) => String(value ?? "");

// ---- 문장·목록 조각 (#241 PR 1) ----

// 첫 화면 AI 요약 상자: legacy summaryHtmlLegacy 와 같은 마크업·구조·글(index.html renderSummary 가 그리는 모양, #352).
// 하이라이트 구획(있을 때) → 분류 라벨 + 줄 div → 검증 폴백 안내(#350) → `.summary-meta`. 분류가 없으면 legacy 처럼 null.
function summary(data) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  if (!categories.length) return null;
  const highlights = Array.isArray(data?.highlights) ? data.highlights : [];
  return (
    <>
      {highlights.length ? (
        <>
          <div className="summary-highlights">
            <div className="summary-section-label">{SUMMARY_HIGHLIGHTS_LABEL_KO}</div>
            {highlights.map((h, i) => (
              <div className="summary-highlight" key={`h${i}`}>
                <a href={str(h.link)} target="_blank" rel="noopener">
                  {str(h.title)}
                </a>
                <span className="summary-link-source">{` · ${str(h.source)}`}</span>
                <div className="summary-highlight-text">{str(h.textKo)}</div>
              </div>
            ))}
          </div>
          <div className="summary-section-label">{SUMMARY_CATEGORIES_LABEL_KO}</div>
        </>
      ) : null}
      {categories.map((c, i) => (
        <div className="summary-category" key={`c${i}`}>
          <div className="summary-category-label">{str(c.name)}</div>
          <div className="summary-category-line">{str(c.lineKo)}</div>
        </div>
      ))}
      {hasFallback(categories) ? <div className="summary-fallback-note">{FALLBACK_NOTE_KO}</div> : null}
      <span className="summary-meta">{summaryMetaKo(data)}</span>
    </>
  );
}

// 첫 화면 돈의 값 한 줄(#575 PR2): legacy marketHtmlLegacy 와 같은 글 - 기준금리 → 환율, " · " 로 잇는다.
function market(data) {
  if (!data) return null;
  const parts = [];
  if (data.baseRate?.value) parts.push(`한국은행 기준금리 ${str(data.baseRate.value)}%`);
  if (typeof data.usdKrw?.value === "number") {
    parts.push(`원/달러 환율 ${data.usdKrw.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}원`);
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

// 첫 화면 뉴스 자리: 뉴스 화면으로 가는 한 줄(#575 PR2). legacy newsHtmlLegacy 와 같은 마크업.
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

// 다른 자치구 링크 묶음. 머리글·상자의 분기와 id는 linksBlockShape(legacy의 linksBlockHtml과 같은 규칙), 경로는 slugLinkHref다.
// 경로는 DISTRICT_PAGES(코드가 정한 slug)로 만든 `./district-<slug>.html`이라 `javascript:`로 시작할 수 없다(React 19 차단 차이의 대상이 아니다).
// 링크가 하나도 없는 분기(block이 null)는 DISTRICT_PAGES가 상수라 지금은 닿지 않는 방어 코드다.
function districtLinks(current = null, heading = "다른 지역") {
  const block = linksBlockShape("district-links", heading, DISTRICT_PAGES.length);
  if (!block) return sentenceBlock([]);
  return (
    <>
      <h3 className="district-links-heading" id={block.headingId}>
        {str(block.heading)}
      </h3>
      <div className="district-links" id={block.boxId}>
        {DISTRICT_PAGES.map(({ name, slug }) =>
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

// legacy의 caption은 `style="caption-side:top;text-align:left;padding-bottom:8px;"`로 끝에 `;`가 있다(틀의 화면 스크립트가 만드는 글자와 같다). React는 style 객체를 `;`로 이어 쓰기만 하고
// 끝에 `;`를 달지 못하며, 값 문자열에 `;`를 달면 개발 빌드가 stderr로 경고한다(`/;\s*$/` 검사, react-dom 19.3.0). 경고 검사는 값을 문자열로 읽고(hint "string") 출력은 `"" + 값`(hint "default")으로
// 이어 붙이므로, 두 읽기를 달리 돌려주는 값으로 경고 없이 같은 글자를 낸다. React를 올려 이 동작이 바뀌면 caption 바이트나 stderr가 달라져 parity 시험이 바로 실패한다.
const withTrailingSemicolon = (text) => ({ [Symbol.toPrimitive]: (hint) => (hint === "string" ? text : `${text};`) });

// 전환율 표.
function conversionTableJsx(conversion, band) {
  const table = conversionTable(conversion, band);
  if (!table) return null;
  return (
    <>
      <caption className="cost-label" style={{ captionSide: "top", textAlign: "left", paddingBottom: withTrailingSemicolon("8px") }}>
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
const OverallCard = ({ card }) => (
  <div className="overall-card">
    <div className="label">{card.label}</div>
    <div className="value">{segsText(card.value)}</div>
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

// 문단 끝의 규칙 링크(#66). 앞 공백은 legacy의 budgetRuleLink가 글자로 들고 있다 - JSX는 {" "}로 낸다. 주소는 모듈(budgetRuleHref)이 정한 `./method.html#budget-rules-<id>`이고
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
function budgetAnswersJsx(band, loanBasis = null) {
  const answers = budgetAnswers(band, loanBasis);
  if (!answers) return blank;
  return (
    <section className="budget-answers" data-prerendered="">
      <h2>{answers.heading}</h2>
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
function budgetBodyJsx(band, periodList, loanBasis = null, mortgageSeries = null, complexFiles = null, capStats = null, policyCounts = null, finderHtml = "") {
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
      {budgetAnswersJsx(band, loanBasis)}
      {shape.districts.length ? (
        <div className="budget-districts">
          거래가 많은 지역: {shape.districts.flatMap((d, i) => [i ? " · " : "", str(d.name), " ", d.count])}
        </div>
      ) : null}
      {budgetWhereJsx(band)}
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

export const fragments = {
  summaryHtml: summary,
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
  districtLinksHtml: districtLinks,
  conversionTableHtml: conversionTableJsx,
  cancelDistrictsHtml: cancelDistrictsJsx,
  cancelMonthsHtml: cancelMonthsJsx,
  renewalDistrictsHtml: renewalDistrictsJsx,
  renewalWolseDistrictsHtml: renewalWolseDistrictsJsx,
  floorDistrictsHtml: floorDistrictsJsx,
};
