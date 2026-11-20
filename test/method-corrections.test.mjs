import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { words, windows } from "../scripts/prose-share.ts";
import { CLOSED_ISSUES, MERGED_PRS, EXCLUDED, RETIRED } from "../scripts/check-corrections-refs.ts";
import { SITE } from "./helpers/site-root.mjs";

// #159: method.html의 「고친 오류」 한 절. 법무 조건(이슈 댓글 7개)을 구조·금지어로 못 박는다.
// 이슈·PR이 실제로 닫혔고 병합됐는지는 네트워크가 필요해 scripts/check-corrections-refs.ts(수동)가 본다.
// 여기서는 값에 따라 갈리는 검사를 두지 않는다(#8).
// #913: 상한은 열 건이다. 새 항목이 들어오면 내용과 상관없이 날짜가 가장 오래된 항목부터 내리고, 같은 날짜는 목록 아래부터 내린다.
// 그래서 새 항목은 그 날짜 묶음의 맨 위에 넣는다. 내린 항목의 번호는 CLOSED_ISSUES·MERGED_PRS 에서 빼서 RETIRED 로 옮긴다(EXCLUDED 아님).
// 날짜 규칙은 「내린 항목 규칙」 시험이 보고, 같은 날짜 안의 순서는 정적 시험으로 강제할 수 없어 정정 PR마다 diff 로 확인한다.

const root = path.resolve(import.meta.dirname, "..");
const method = () => readFile(path.join(root, "docs/method.html"), "utf8");

// 절 = 제목(id)부터 다음 <h2>까지.
const sectionOf = (html, id) => {
  const start = html.indexOf(`<h2 id="${id}">`);
  assert.notEqual(start, -1, `${id} 절이 없다`);
  const end = html.indexOf("<h2", start + 5);
  return { start, end, text: html.slice(start, end) };
};
const items = (sec) => [...sec.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const dateOf = (li) => li.match(/<strong>(\d{4}-\d{2}-\d{2})<\/strong>/)?.[1];
const linksTo = (kind, n) => new RegExp(`jipgye/${kind === "issues" ? "issues" : "pull"}/${n}"`);

// #913 (e): 특정 항목 시험의 갈래. 그 항목이 한·영 모두 화면에 있으면 내용 검사로 넘기고, 둘 다 없으면 번호가 RETIRED 에 있어야 한다.
// 한쪽에만 있으면 실패다. 어느 갈래든 단언 없이 지나가지 않는다.
const pickOrRetired = (html, kind, n) => {
  const ko = items(sectionOf(html, "corrections").text).find((li) => linksTo(kind, n).test(li));
  const en = items(sectionOf(html, "corrections-en").text).find((li) => linksTo(kind, n).test(li));
  assert.equal(Boolean(ko), Boolean(en), `#${n} 항목이 한·영 한쪽에만 있다`);
  if (!ko) assert.ok(RETIRED.some((r) => r[kind].includes(n)), `#${n} 항목이 화면에 없으면 RETIRED 의 ${kind} 에 있어야 한다`);
  return ko ? { ko, en } : null;
};

const KO_BANNED = ["사고", "유출", "부풀려", "잘못된 정보를 제공", "피해", "책임", "항상", "절대", "완전", "오류 0건"];
const EN_BANNED = ["always", "never", "complete", "leak", "breach", "damage", "liab", "fault", "blame", "zero errors", "inflat"];
// #80은 싣지 않는다. 그 건의 구체어(검색어·이벤트·URL 파라미터·키)도 이 절에 없어야 한다.
const PRIVACY_TERMS = ["검색어", "page_location", "search_term", "개인정보", "analytics", "분석 도구", "search event"];

test("한·영 두 절이 있고 항목 수가 같으며 10건 이하다", async () => {
  const html = await method();
  const ko = items(sectionOf(html, "corrections").text);
  const en = items(sectionOf(html, "corrections-en").text);
  assert.ok(ko.length >= 1 && ko.length <= 10, `한국어 ${ko.length}건`);
  assert.equal(en.length, ko.length);
});

// #229: 예금자보호 한도 정정 항목. 항목 수·날짜 형식·근거 링크·문장 수·금지어는 위의 일반 시험이 모든 항목에 건다.
// 여기서는 이 항목이 있으면 정정된 값을 말하는지(없으면 RETIRED 에 있는지, #913), 서두의 건수 표기가 항목 수와 맞는지만 본다.
// 날짜 값 자체는 머지일에 따라 달라지므로 검사하지 않는다(#8).
test("예금자보호 한도 정정 항목(#229)이 한·영에 있거나 내렸고 서두 건수가 항목 수와 맞다", async () => {
  const html = await method();
  const ko = sectionOf(html, "corrections").text;
  const en = sectionOf(html, "corrections-en").text;
  const hit = pickOrRetired(html, "issues", 229);
  if (hit) {
    for (const w of ["예금자보호", "금융회사별 1억원", "금리 수치와 집계는 그대로"]) assert.ok(hit.ko.includes(w), `한국어 항목에 ${w}`);
    for (const w of ["deposit-protection", "KRW 100 million per financial institution", "rate figures and counts are unchanged"]) {
      assert.ok(hit.en.includes(w), `영어 항목에 ${w}`);
    }
  }
  // #913 (b): 서두는 「열 건」이라 말하고 상한에 닿아 있으므로 항목 수가 정확히 10이어야 서두와 맞다.
  assert.match(ko.slice(0, ko.indexOf("<ul")), /열 건을 최근 것부터/);
  assert.match(en.slice(0, en.indexOf("<ul")), /ten corrections, newest first/);
  assert.equal(items(ko).length, 10, "서두 「열 건」과 한국어 항목 수");
  assert.equal(items(en).length, 10, "서두 「ten corrections」와 영어 항목 수");
});

// #862 2단계(PR #885): 세는 방법을 고친 정정이라 11-05 항목(표시 쪽 조치)을 고쳐 쓰지 않고 새 항목으로 둔다(pm 11-15).
// 수치는 PR #885 의 11-15 재생 값이다(cpo 교차검증) - method.html 의 고정 문장만 보므로 데일리 값에 따라 갈리지 않는다(#8).
// #913: 더 최근 항목이 들어오면 맨 앞이 아니게 되므로 자리 대신 링크로 찾고, 내려가면 RETIRED 에 있어야 한다.
test("신고 건수 정정 항목(PR #885)이 한·영에 있으면 화면 이름·수치·지난 기록을 적고, 없으면 내린 목록에 있다", async () => {
  const html = await method();
  const hit = pickOrRetired(html, "prs", 885);
  if (!hit) return;
  const { ko, en } = hit;
  for (const li of [ko, en]) assert.match(li, /jipgye\/pull\/885"/);
  for (const w of ["2026-11-15", "&lsquo;이번 주 새로 신고된 거래&rsquo;", "4,309행 중 766행(17.8%)", "1,079건(3.3㎡당 5,379만원)에서 1,022건(5,387만원)", "1,024건에서 913건", "지난 기록은 고치지 않았습니다"]) {
    assert.ok(ko.includes(w), `한국어 항목에 ${w}`);
  }
  for (const w of ["&ldquo;New filings this week&rdquo;", "766 of the 4,309 sale rows", "(17.8%)", "from 1,079 filings", "to 1,022", "from 1,024 to 913", "past records were not revised"]) {
    assert.ok(en.includes(w), `영어 항목에 ${w}`);
  }
  for (const w of ["주간 정리", "오염", "왜곡", "진짜", "corrupt", "distort", "real "]) assert.ok(!ko.includes(w) && !en.includes(w), w);
});

// #821·#843: 동명 단지 정정 항목. 수치는 11-03 공개 파일 기준(since 05-04)이라 그날 칸 수·벽산 금호동1가 범위를 못 박는다.
// 화면 데이터가 아니라 method.html 의 고정 문장만 보므로 데일리 값에 따라 갈리지 않는다(#8).
// #913: 항목이 내려가도 #switch-house 두 문장은 절 밖이라 조건 없이 본다.
test("동명 단지 정정 항목(#821·#843)이 한·영에 있거나 내렸고 #switch-house 가 같은 기준을 적는다", async () => {
  const html = await method();
  const hit = pickOrRetired(html, "issues", 821);
  if (hit) {
    const { ko, en } = hit;
    for (const li of [ko, en]) {
      assert.match(li, /jipgye\/issues\/821"/);
      assert.match(li, /jipgye\/issues\/843"/);
    }
    for (const w of ["벽산", "84㎡", "18.0~20.0억", "10.2~10.8억", "3,049개 중 64개", "44.3%&rarr;44.4%", "11.1%&rarr;11.0%", "276쌍 중 3쌍", "나눈 효과로 보지 않습니다"]) {
      assert.ok(ko.includes(w), `한국어 항목에 ${w}`);
    }
    for (const w of ["Byeoksan 84㎡", "KRW 1.80&ndash;2.00 billion", "KRW 1.02&ndash;1.08 billion", "64 of 3,049 cells", "from 44.3% to 44.4%", "from 11.1% to 11.0%", "3 of 276", "not read as an effect of the split"]) {
      assert.ok(en.includes(w), `영어 항목에 ${w}`);
    }
  } else {
    assert.ok(RETIRED.some((r) => r.issues.includes(843)), "#821 항목을 내렸으면 #843 도 RETIRED 에 있어야 한다");
  }
  assert.ok(sectionOf(html, "switch-house").text.includes("이름이 같아도 둘 이상의 동에 있으면 동별로 다른 단지로 셉니다."));
  assert.ok(sectionOf(html, "switch-house-en").text.includes("Complexes sharing a name across more than one dong are counted separately per dong."));
});

// #929: 실거래 검색 서울 전체 미리보기 건수 문장 정정. 값은 그대로 두고 문장만 고친 꼴(#183 선례)이라 「수는 그대로」와
// 고친 문장의 범위(신규만·빈칸 제외·「전부」는 자치구 목록만)를 적는지 본다. 수치는 2026-11-16 고정 문장이라 데일리 값에 갈리지 않는다(#8).
test("미리보기 건수 문장 정정 항목(#929)이 한·영에 있으면 고친 범위와 그대로 둔 값을 적고, 없으면 내린 목록에 있다", async () => {
  const html = await method();
  const hit = pickOrRetired(html, "issues", 929);
  if (!hit) return;
  const { ko, en } = hit;
  for (const w of ["./deal-search.html", "2026-08-29", "8,185건", "10,759건", "17,497건", "18,752건", "수는 그대로", "&lsquo;신규&rsquo;인 신고만", "계약구분이 빈 신고는", "자치구를 고른 목록에만"]) {
    assert.ok(ko.includes(w), `한국어 항목에 ${w}`);
  }
  for (const w of ["./deal-search.html", "2026-08-29", "8,185 jeonse", "10,759 monthly-rent", "17,497 and 18,752", "The number itself is unchanged", "&lsquo;new&rsquo; contract type", "blank types drop out of it too", "list with a district chosen"]) {
    assert.ok(en.includes(w), `영어 항목에 ${w}`);
  }
});

// #862 1단계: 근거는 PR 이다(#862 는 2단계까지 열려 있다). 지난 값을 그대로 둔다고 적는다.
test("서울 매매 표본 정정 항목이 한·영에 있으면 지난 값을 그대로 둔다고 적고, 없으면 내린 목록에 있다", async () => {
  const html = await method();
  const hit = pickOrRetired(html, "prs", 864);
  if (!hit) return;
  const { ko, en } = hit;
  for (const w of ["313건", "지난 값은 그대로", "5% 이상", "전 면적 환산"]) assert.ok(ko.includes(w), `한국어 항목에 ${w}`);
  for (const w of ["313 filings", "Past figures are left as published", "5% of the sample", "all-size average"]) assert.ok(en.includes(w), `영어 항목에 ${w}`);
  for (const li of [ko, en]) assert.match(li, /jipgye\/pull\/\d+"/);
});

// #862 조건 5: 「신고 기준」 정의가 이번 사실과 맞고, 새 절이 문턱·사후 판단·재계산·못 잡는 것·구 줄의 공백을 적는다. 단정(어느 값이 맞다)과 단지 이름은 없다.
test("method: 신고 기준 정의와 쏠림 절이 한·영에 있다", async () => {
  const html = await method();
  assert.ok(!html.includes("한 번 집계한 주는 나중에 바뀌지 않습니다"));
  assert.ok(!html.includes("a week once counted never changes"));
  // 2단계(조건 6): 그런 행은 이제 처음 본 날의 신고로 센다.
  assert.match(html, /등기일&middot;해제&middot;동만 붙거나 행이 응답에서 빠졌다 돌아오면, 새 신고로 세지 않고 처음 본 날의 신고로 셉니다/);
  assert.match(html, /is not counted as a new filing but as a filing from the day it was first seen/);
  const ko = sectionOf(html, "arrival-concentration").text;
  const en = sectionOf(html, "arrival-concentration-en").text;
  for (const w of ["신고 기준이면", "계약 기준이면", "5% 이상이면서 10행 이상", "대표값은 바꾸지 않습니다", "본 뒤에 정한 값 판단", "신고 기준 44일 중 11일", "계약 기준 5일 중 2일", "자치구 매매 줄에도", "195 구-일"]) {
    assert.ok(ko.includes(w), `한국어 절에 ${w}`);
  }
  for (const w of ["on the reported basis", "on the contract basis", "at least 10 rows", "headline figure is not replaced", "judgment made after seeing", "11 of 44 reported-basis days", "2 of 5 contract-basis days", "District sale rows use the same threshold", "195 district-days"]) {
    assert.ok(en.includes(w), `영어 절에 ${w}`);
  }
  // 3단계(pm 11-15): 쏠림 절은 「증감을 내지 않는다」가 아니라 「건수와 뺀 값을 함께 적는다」이고, 증감은 어느 기준 날에도 없다.
  assert.ok(ko.includes("몰리면 그 건수와 뺀 값을 함께 적습니다") && ko.includes("7일 증감은 신고 기준&middot;계약 기준 어느 날에도 싣지 않습니다"), "한국어 쏠림 절 3단계");
  assert.ok(en.includes("their count and the figure without them are shown") && en.includes("No 7-day change is shown on reported-basis or contract-basis days"), "영어 쏠림 절 3단계");
  for (const w of ["몰리면 증감을 내지 않습니다", "견줄 날의 표본이 그랬을 때도", "the change is withheld</h2>", "comparison date's sample"]) assert.ok(!ko.includes(w) && !en.includes(w), w);
  // 1단계의 「구 줄에는 단서가 없다(늦어도 11-20)」는 2단계에서 사실이 아니다.
  for (const w of ["2026-11-20", "단서가 없습니다", "carry no such note"]) assert.ok(!ko.includes(w) && !en.includes(w), w);
  for (const w of ["오염", "왜곡", "진짜", "corrupt", "distort", "real price"]) assert.ok(!ko.includes(w) && !en.includes(w), w);
  assert.ok(html.includes('href="#arrival-concentration"') && html.includes('href="#arrival-concentration-en"'), "목차");
});

// #862 2단계(조건 8): 7일 증감을 내린 정의와 이유 - 규칙, 서울 40일·구 44일 값, 서울은 값을 본 뒤 정한 규칙이고 구는 재기 전에 적은 규칙이라는 점.
// 3단계(pm 11-15): 계약 기준으로 물러난 날도 내린다 - 60일 중 6일, 실린 4일 중 3일은 정의가 다른 기록과 견줬고 계약 대 계약은 10-26 하루. 「이 판단 밖」 문장은 없어야 한다.
test("method: 신고 기준 7일 증감을 내린 절이 한·영에 있다", async () => {
  const html = await method();
  const ko = sectionOf(html, "arrival-change").text;
  const en = sectionOf(html, "arrival-change-en").text;
  for (const w of ["서울 전체와 자치구", "90% 구간 반폭의 중간값보다 크다", "40일", "2.49% 대 &plusmn;5.62%", "1.84% 대 &plusmn;3.62%", "2.76% 대 &plusmn;4.22%", "본 뒤 정한 것이라 미리 정해 둔 규칙이 아닙니다",
    "재기 전에 적어 두고", "1.55% 대 &plusmn;3.65%", "1.49% 대 &plusmn;2.89%", "1.64% 대 &plusmn;3.29%", "계약 기준으로 물러난 날", "지난 기록은 고치지 않습니다",
    "60일 중 6일", "4일 중 3일은 정의가 다른 기록과 견준 것", "10-26 하루뿐", "그 사실을 본 뒤 정했습니다"]) {
    assert.ok(ko.includes(w), `한국어 절에 ${w}`);
  }
  for (const w of ["Seoul-wide or district", "median half-width of a 90% interval", "40 reported-basis days", "2.49% against &plusmn;5.62%", "not fixed in advance",
    "written down before measuring", "1.55% against &plusmn;3.65%", "fallen back to the contract basis", "Past records are not revised",
    "6 of the 60 recorded days", "3 compared against a record with a different definition", "only one, 10-26", "made after seeing those facts"]) {
    assert.ok(en.includes(w), `영어 절에 ${w}`);
  }
  // 바꾼 단언(#862 3단계): 예전에는 「계약 기준으로 물러난 날은 이 판단 밖이라 증감을 그대로 적습니다」가 있어야 했다.
  for (const w of ["이 판단 밖", "outside this judgment", "keep their change"]) assert.ok(!ko.includes(w) && !en.includes(w), w);
  assert.ok(html.includes('href="#arrival-change"') && html.includes('href="#arrival-change-en"'), "목차");
});

test("절 머리는 면책 문단 하나이고 목록 앞에 있다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const { text } = sectionOf(html, id);
    const head = text.slice(0, text.indexOf("<ul"));
    assert.equal((head.match(/<p>/g) || []).length, 1, `${id}: 목록 앞 문단은 하나`);
  }
  const ko = sectionOf(html, "corrections").text;
  assert.match(ko, /정부 원본을 가공해/);
  assert.match(ko, /모든 오류를 여기에 적는 것은 아닙니다/);
  assert.match(ko, /원본을 확인해/);
  assert.match(ko, /최근 것부터/);
  // #913: 내림 규칙과 근거의 보존을 같은 문단 안에서 말한다(legal 확정 문안).
  assert.match(ko, /내용과 상관없이 날짜가 가장 오래된 항목부터 내리며/);
  assert.match(ko, /저장소에 그대로 남습니다/);
  assert.doesNotMatch(ko, /날짜 순/);
  const en = sectionOf(html, "corrections-en").text;
  assert.match(en, /this site's counting method/);
  assert.match(en, /the entry with the oldest date comes off the list whatever its content/);
  assert.match(en, /stay in this site's repository/);
  assert.doesNotMatch(en, /\bwe\b|mistake/i, "영어 면책 주어는 사이트이고 we·mistake를 쓰지 않는다");
});

test("항목마다 날짜·근거 링크가 있고 두 문장 이하이며 날짜는 내림차순이다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const list = items(sectionOf(html, id).text);
    const dates = list.map((li) => li.match(/<strong>(\d{4}-\d{2}-\d{2})<\/strong>/)?.[1]);
    assert.ok(dates.every(Boolean), `${id}: 날짜가 없는 항목`);
    assert.deepEqual([...dates].sort().reverse(), dates, `${id}: 날짜가 내림차순이 아니다`);
    for (const li of list) {
      assert.match(li, /github\.com\/kyhsa93\/jipgye\/(issues|pull)\/\d+/, `${id}: 근거 링크 없음`);
      // 근거 링크 괄호와 소수점을 걷고 문장 끝(마침표 뒤 공백·끝)을 센다.
      const prose = li
        .replace(/\(<a [\s\S]*$/, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/g, " ")
        .replace(/\d+\.\d+/g, "N");
      const count = (prose.match(/\.(?=\s|$)/g) || []).length;
      assert.ok(count >= 1 && count <= 2, `${id}: 문장이 ${count}개다: ${li.slice(0, 60)}`);
    }
  }
});

test("근거 링크는 번호 목록(닫힌 이슈·병합된 PR)과 정확히 같고 #80은 없다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    const { text } = sectionOf(html, id);
    const issues = [...text.matchAll(/jipgye\/issues\/(\d+)/g)].map((m) => Number(m[1]));
    const prs = [...text.matchAll(/jipgye\/pull\/(\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual([...new Set(issues)].sort((a, b) => a - b), CLOSED_ISSUES, `${id}: 이슈 목록`);
    assert.deepEqual(prs, MERGED_PRS, `${id}: PR 목록`);
    for (const n of EXCLUDED) assert.ok(!text.includes(`#${n}`) && !text.includes(`/${n}"`), `${id}: #${n}`);
  }
});

// #913 (c): 내린 항목(RETIRED)이 서두의 날짜 규칙대로인지. 목록 자체의 모양과 화면 항목과의 관계만 보고 값에 따라 갈리지 않는다(#8).
test("내린 항목 규칙: RETIRED 는 날짜가 가장 오래된 것부터 내린 기록이고 EXCLUDED 와 섞이지 않는다", async () => {
  const html = await method();
  assert.ok(Array.isArray(RETIRED), "RETIRED 는 배열이다");
  const nums = (r) => [...r.issues, ...r.prs];
  for (const r of RETIRED) {
    assert.match(String(r.date), /^\d{4}-\d{2}-\d{2}$/, `RETIRED 날짜 형식: ${r.date}`);
    assert.ok(Array.isArray(r.issues) && Array.isArray(r.prs), `${r.date}: issues·prs 는 배열이다`);
    assert.ok(nums(r).length >= 1 && nums(r).every(Number.isInteger), `${r.date}: 번호가 1개 이상이고 정수다`);
    for (const n of nums(r)) assert.ok(!EXCLUDED.includes(n), `#${n}: RETIRED 와 EXCLUDED 에 함께 있다`);
  }
  const retiredDates = RETIRED.map((r) => r.date);
  assert.deepEqual([...retiredDates].sort(), retiredDates, "RETIRED 는 내린 차례대로 날짜 오름차순이다");
  for (const id of ["corrections", "corrections-en"]) {
    const list = items(sectionOf(html, id).text);
    const dates = list.map(dateOf);
    assert.ok(dates.length >= 1 && dates.every(Boolean), `${id}: 화면 항목 날짜`);
    const oldest = [...dates].sort()[0];
    for (const d of retiredDates) assert.ok(d <= oldest, `${id}: RETIRED ${d} 가 화면에 남은 가장 오래된 날짜 ${oldest} 보다 늦다`);
    if (RETIRED.length) assert.equal(list.length, 10, `${id}: 내린 항목이 있으면 화면은 상한 열 건이 차 있어야 한다`);
    // 보강(clo 수용, issuecomment-6895037364): 내린 번호가 화면 링크에 남아 있다면 그것은 내린 뒤에 들어온 새 정정뿐이라 날짜가 더 늦다.
    // 같은 날짜 묶음 안에서 다른 항목을 내리고 이 번호를 적은 경우(기록이 실제와 다름)를 잡는다.
    for (const r of RETIRED) {
      for (const [kind, ns] of [["issues", r.issues], ["prs", r.prs]]) {
        for (const n of ns) {
          for (const li of list.filter((x) => linksTo(kind, n).test(x))) {
            assert.ok(dateOf(li) > r.date, `${id}: RETIRED #${n}(${r.date}) 이 화면 항목(${dateOf(li)})에 남아 있다`);
          }
        }
      }
    }
  }
});

test("쓰지 않을 말과 개인정보 건의 구체어가 없다", async () => {
  const html = await method();
  const ko = sectionOf(html, "corrections").text.replace(/<[^>]+>/g, " ");
  const en = sectionOf(html, "corrections-en").text.replace(/<[^>]+>/g, " ").toLowerCase();
  for (const w of KO_BANNED) assert.ok(!ko.includes(w), `한국어 절에 금지어: ${w}`);
  for (const w of EN_BANNED) assert.ok(!en.includes(w), `영어 절에 금지어: ${w}`);
  for (const w of PRIVACY_TERMS) {
    assert.ok(!ko.includes(w) && !en.includes(w.toLowerCase()), `개인정보 건 구체어: ${w}`);
  }
});

// #913: 항목을 숫자(2.1%) 대신 근거 링크로 찾는다. 내려가면 RETIRED 에 있어야 한다.
test("해제율 옛 값은 '당시 표본'으로 표시되고 지금 값과 섞이지 않는다", async () => {
  const html = await method();
  const hit = pickOrRetired(html, "issues", 28);
  if (!hit) return;
  const { ko, en } = hit;
  assert.match(ko, /당시 표본/);
  assert.match(ko, /전체 거래 대비 해제 비율/);
  assert.match(en, /share of all transactions/);
  assert.match(en, /sample at that time/);
  for (const li of [ko, en]) assert.doesNotMatch(li, /78\.9|5,668|4,472/, "지금 값을 이 절에 옮겨 적지 않는다");
});

test("스타일 태그·새 페이지 없이 method.html 안의 정적 절이다", async () => {
  const html = await method();
  for (const id of ["corrections", "corrections-en"]) {
    assert.doesNotMatch(sectionOf(html, id).text, /<style|<script|prerender:/);
  }
});

// growth 규칙(AdSense 중복): 이 절의 연속 8단어(숫자 가림)가 다른 장·method.html의 다른 자리에 없다.
test("절의 문장은 docs/*.html 어디에도 같은 8단어 창으로 없다", async () => {
  const html = await method();
  const own = new Set();
  const spans = [];
  for (const id of ["corrections", "corrections-en"]) {
    const s = sectionOf(html, id);
    spans.push(s);
    for (const w of windows(words(s.text, { maskNumbers: true }))) own.add(w);
  }
  assert.ok(own.size > 100, "창이 너무 적다");
  // 항목끼리도 같은 문장 틀을 쓰지 않는다: 한 창이 두 항목에 있으면 안 된다.
  for (const id of ["corrections", "corrections-en"]) {
    const seen = new Map();
    for (const [i, li] of items(sectionOf(html, id).text).entries()) {
      for (const w of windows(words(li, { maskNumbers: true }))) {
        assert.ok(!seen.has(w) || seen.get(w) === i, `${id}: 항목 ${seen.get(w)}와 ${i}가 같은 문장 틀을 쓴다`);
        seen.set(w, i);
      }
    }
  }
  let rest = html;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) rest = rest.slice(0, s.start) + rest.slice(s.end);
  const others = [["method.html(절 밖)", rest]];
  for (const f of (await readdir(path.join(root, SITE))).filter((n) => n.endsWith(".html") && n !== "method.html")) {
    others.push([f, await readFile(path.join(root, SITE, f), "utf8")]);
  }
  for (const [name, text] of others) {
    const w = windows(words(text, { maskNumbers: true }));
    const hit = [...own].filter((x) => w.has(x));
    assert.equal(hit.length, 0, `${name}와 같은 문장: ${hit[0]?.split("\u0001").join(" ")}`);
  }
});

// #217: 해제 문단(정정 재신고)에는 날마다 바뀌는 비율을 손으로 박지 않는다 - 그날 값은 cancelled-deals 첫 문단(correctionStats)이 싣는다.
// 값에 따라 갈리는 검사가 아니라 '숫자가 없다'는 구조 검사다(#8).
test("method 해제 문단은 정정 재신고 비율 숫자를 박지 않는다", async () => {
  const html = await method();
  const ko = html.match(/<p>해제를 세기 전에[\s\S]*?<\/p>/)?.[0];
  const en = html.match(/<p>Before cancellations are counted[\s\S]*?<\/p>/)?.[0];
  assert.ok(ko && en, "해제 문단 한·영이 있다");
  for (const p of [ko, en]) assert.ok(!/\d+(?:\.\d+)?%|넷에 셋|Three in four/.test(p), p.slice(0, 80));
});

// #223: method 해제 문단도 같은 단정을 하지 않는다(#76 clo 조건 5).
test("method 해제 문단은 '정정이다' 단정을 하지 않는다 — 한·영", async () => {
  const html = await method();
  const ko = html.match(/<p>해제를 세기 전에[\s\S]*?<\/p>/)?.[0];
  const en = html.match(/<p>Before cancellations are counted[\s\S]*?<\/p>/)?.[0];
  assert.ok(ko && en, "해제 문단 한·영이 있다");
  for (const re of [/깨진 계약이 아니라/, /신고를 고친 것입니다/, /not a broken deal/i, /a correction to the filing/i]) {
    assert.ok(!re.test(ko) && !re.test(en), `단정 문구: ${re}`);
  }
  assert.match(ko, /공개되지 않아/);
  assert.match(en, /Reasons are not published/);
});

// #226: 해제 문단 곁에 정정 재신고 집계 Release로 가는 링크 한 줄(한·영). 값에 따라 갈리는 검사가 아니라 형태 검사다(#8).
// 일부러 두지 않는 것: 해제 문단의 나머지 문장이 변경 전과 같은지 고정하는 시험 - 문장 갈림을 다루는 별건(#228)이
// 같은 문단 문장을 고칠 수 있어 그 이슈를 막게 된다. 한 줄이 독립 문단이라 문단 안 문장이 늘지 않는다는 것은
// "링크 문단이 한 문장이고 해제 문단 바로 뒤에 있다"로 본다. 대상 존재는 네트워크 없이 못 보므로 시험하지 않는다(첫 Release 게시로 확인, #218).
const RELEASE_URL = "https://github.com/kyhsa93/jipgye/releases/latest";
const langBlock = (html, lang) => {
  const start = html.indexOf(`<div data-lang="${lang}"`);
  assert.notEqual(start, -1, `data-lang=${lang} 블록이 없다`);
  const next = html.indexOf('<div data-lang="', start + 10);
  return html.slice(start, next === -1 ? undefined : next);
};
// #771: 월간 리포트 Release 링크(releases/tag/monthly-report-YYYY-MM)가 출처 절에 따로 한 줄 있다. 호마다 Release 가 따로이고 이전 호를 대체하지
// 않으므로 날짜 태그를 가리키는 것이 맞다(correction-twins 와 다르다). 여기서는 해제 Release(/releases/latest) 링크만 센다 - test/monthly-report.test.mjs 가 그 줄을 본다.
const MONTHLY_REPORT_URL = /^https:\/\/github\.com\/kyhsa93\/jipgye\/releases\/tag\/monthly-report-\d{4}-\d{2}$/;
const releasePara = (block) => {
  const links = [...block.matchAll(/<a [^>]*href="https:\/\/github\.com\/kyhsa93\/jipgye\/releases[^"]*"[^>]*>/g)].filter((m) => !MONTHLY_REPORT_URL.test(m[0].match(/href="([^"]*)"/)[1]));
  assert.equal(links.length, 1, `Release 링크가 ${links.length}개다`);
  const at = links[0].index;
  const from = block.lastIndexOf("<p>", at);
  const to = block.indexOf("</p>", at) + 4;
  return { tag: links[0][0], para: block.slice(from, to), from };
};

test("해제 문단 곁에 한·영 Release 링크가 정확히 /releases/latest 하나씩 있다", async () => {
  const html = await method();
  for (const lang of ["ko", "en"]) {
    const { tag } = releasePara(langBlock(html, lang));
    assert.equal(tag.match(/href="([^"]*)"/)[1], RELEASE_URL, `${lang}: 링크 대상`);
    // 사이트 외부 링크 관례(고친 오류 절과 같다).
    assert.match(tag, /target="_blank"/, `${lang}: target`);
    assert.match(tag, /rel="noopener"/, `${lang}: rel`);
  }
});

test("method.html 전체에 utm 파라미터와 날짜 태그가 없다(고친 오류 절 포함)", async () => {
  const html = await method();
  assert.doesNotMatch(html, /utm_/i);
  assert.ok(!html.includes("correction-twins-"), "날짜가 박힌 태그(correction-twins-)를 가리키면 다음 갱신부터 대체된 Release를 가리킨다");
  // 링크 대상은 해제 Release(/releases/latest)와 월간 리포트 Release(#771, 호 태그) 둘뿐이다 - 각각 한·영 한 번씩.
  const all = [...html.matchAll(/https:\/\/github\.com\/kyhsa93\/jipgye\/releases[^"'\s<)]*/g)].map((m) => m[0]);
  assert.deepEqual(all.filter((u) => !MONTHLY_REPORT_URL.test(u)), [RELEASE_URL, RELEASE_URL], "한·영 한 번씩만");
  assert.equal(all.filter((u) => MONTHLY_REPORT_URL.test(u)).length, 2, "월간 리포트 링크는 한·영 한 번씩");
});

test("Release 링크는 독립된 한 문장 문단이고 정정 재신고 해제 문단 바로 뒤에 있다 - 한·영", async () => {
  const html = await method();
  const heads = { ko: "<p>해제를 세기 전에", en: "<p>Before cancellations are counted" };
  for (const lang of ["ko", "en"]) {
    const block = langBlock(html, lang);
    const { para, from } = releasePara(block);
    const prose = para.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ");
    assert.equal((prose.match(/[.。](?=\s|$)/g) || []).length, 1, `${lang}: 링크 문단은 한 문장이다: ${prose}`);
    // 상한은 언어별이다: 영어는 같은 뜻이 글자 수로 더 길다(Release와 같은 구조의 영어 문장이 약 130자). 한 문장·독립 문단 조건은 그대로다.
    const maxLen = lang === "ko" ? 100 : 140;
    assert.ok(prose.length < maxLen, `${lang}: 링크 한 줄이 길다(${prose.length}자, 상한 ${maxLen})`);
    // 바로 앞 문단이 정정 재신고 해제 문단이다(그 문단 안에 링크가 들어간 것이 아니다).
    const prev = block.slice(0, from).trimEnd();
    assert.ok(prev.endsWith("</p>"), `${lang}: 앞이 문단이 아니다`);
    assert.ok(prev.slice(prev.lastIndexOf("<p>")).startsWith(heads[lang]), `${lang}: 해제 문단 바로 뒤가 아니다`);
    assert.ok(!prev.slice(prev.lastIndexOf("<p>")).includes("releases/latest"), `${lang}: 링크가 해제 문단 안에 있다`);
    // 금지어·단정 문구(#221 목록과 같다).
    const banned = lang === "ko" ? KO_BANNED : EN_BANNED;
    const text = lang === "ko" ? prose : prose.toLowerCase();
    for (const w of banned) assert.ok(!text.includes(w), `${lang}: 금지어 ${w}`);
    for (const re of [/정정이다/, /정정입니다/, /고쳤/, /고친 것/, /고쳐 쓴/, /깨진 계약이 아니라/, /신고를 고/, /not a broken deal/i, /a correction to the filing/i, /is a correction/i, /are corrections/i]) {
      assert.ok(!re.test(prose), `${lang}: 단정 ${re}`);
    }
  }
});

// legal(#226): 링크 대상 Release는 "정정 재신고" 라벨을 일부러 쓰지 않는다(제목: "해제되지 않은 채 다시 있는 기록").
// 사이트와 Release의 어휘 갈림은 #228의 주제이므로 이 줄에서 하나 더 늘리지 않는다. 라벨은 해제 문단 쪽에 이미 있다.
test("Release 링크 줄에는 '정정 재신고'·'corrected re-filings' 라벨이 없다 - 한·영", async () => {
  const html = await method();
  const labels = { ko: [/정정\s*재신고/], en: [/corrected\s+re-?filings?/i, /correction twins?/i] };
  for (const lang of ["ko", "en"]) {
    const { para } = releasePara(langBlock(html, lang));
    const prose = para.replace(/<[^>]+>/g, " ");
    for (const re of labels[lang]) assert.ok(!re.test(prose), `${lang}: 링크 줄에 라벨 ${re}`);
  }
});

test("Release 링크 문장은 docs/*.html 어디에도 같은 8단어 창으로 없다", async () => {
  const html = await method();
  const own = new Set();
  const paras = [];
  for (const lang of ["ko", "en"]) {
    const { para } = releasePara(langBlock(html, lang));
    paras.push(para);
    for (const w of windows(words(para, { maskNumbers: true }))) own.add(w);
  }
  assert.ok(own.size >= 1, "창이 없다(영어 문장이 8단어 이상이어야 한다)");
  let rest = html;
  for (const para of paras) rest = rest.replace(para, "");
  const others = [["method.html(링크 문단 밖)", rest]];
  for (const f of (await readdir(path.join(root, SITE))).filter((n) => n.endsWith(".html") && n !== "method.html")) {
    others.push([f, await readFile(path.join(root, SITE, f), "utf8")]);
  }
  for (const [name, text] of others) {
    const w = windows(words(text, { maskNumbers: true }));
    const hit = [...own].filter((x) => w.has(x));
    assert.equal(hit.length, 0, `${name}와 같은 문장: ${hit[0]?.split("\u0001").join(" ")}`);
  }
});
