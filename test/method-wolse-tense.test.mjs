// #889 - #862 2·3단계(#885, #888)로 서울·자치구 값에는 어느 날에도 7일 증감을 싣지 않는다. 그런데 method #wolse-change 절과 소개(about)의
// 아파트 시세 줄이 증감이 아직 실리는 것처럼 현재형으로 남아 있었다. 이 파일은 pm 판정(#889 issuecomment-6891993122) 조건 6의 범위만 본다:
// method 목차 두 줄, #wolse-change·#wolse-change-en 절(h2부터 다음 h2 앞까지), about 아파트 시세 두 줄.
// 「고친 오류」 목록(2026-11-05·10-01 항목)은 날짜가 붙은 정정 기록이라 대상에서 뺀다 - 영어 10-01 항목의 "it now uses …"는 그때의 기록이다(조건 5).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => readFile(path.join(root, rel), "utf8");
const count = (hay, needle) => hay.split(needle).length - 1;

const LANGS = [
  {
    lang: "국",
    id: "wolse-change",
    title: "월세 증감을 보증금과 월세를 묶은 ㎡당 값으로 잰 까닭",
    oldTitle: "월세 증감은 보증금과 월세를 묶은 ㎡당 값으로 잽니다",
    // 조건 2 - 첫 두 문장은 이슈 본문, 마지막 문장은 pm 문안(저장된 칸은 3.3㎡당 만원이다, scripts/realestate-metrics.ts).
    lead: '<p>지금은 서울·자치구 값에 7일 증감을 싣지 않습니다(<a href="#arrival-change">위 절</a>). 아래는 월세 증감을 싣던 때 쓴 방법과 잰 결과입니다. 이 값은 3.3㎡당 만원 단위로 데이터 파일의 <code class="tw:text-sm">wolse.avgConvertedPerPyeong10k</code>에 남습니다.</p>',
    // 조건 3 - 증감이 지금 실리는 것처럼 읽히던 현재형. 과거형으로 바꾼 뒤 이 조각은 절 안에 없어야 한다.
    present: ["전용면적</strong>으로 잽니다", "오래됐으면 붙이지 않습니다", "부를 수 없어서입니다"],
    past: ["전용면적</strong>으로 쟀습니다", "오래됐으면 붙이지 않았습니다", "부를 수 없어서였습니다"],
  },
  {
    lang: "영",
    id: "wolse-change-en",
    title: "Why monthly-rent change was measured on deposit and rent combined, per ㎡",
    oldTitle: "Monthly-rent change is measured on deposit and rent combined, per ㎡",
    lead: '<p>Seoul and district figures now carry no 7-day change (<a href="#arrival-change-en">section above</a>). What follows is the method used while a monthly-rent change was shown, and what it measured. The value remains in the data file as <code class="tw:text-sm">wolse.avgConvertedPerPyeong10k</code>, per 3.3㎡ in units of KRW 10,000.</p>',
    present: ["So there is one change badge", "No change is shown when the baseline is more than fourteen days old"],
    past: ["So there was one change badge", "No change was shown when the baseline was more than fourteen days old"],
  },
];

function section(html, id) {
  const start = html.indexOf(`<h2 id="${id}">`);
  assert.ok(start >= 0, `method: <h2 id="${id}">를 못 찾았다 - id는 「고친 오류」 10-01 항목의 링크가 가리키므로 그대로 둔다`);
  const end = html.indexOf("<h2", start + 1);
  assert.ok(end > start, `method: #${id} 뒤의 다음 h2를 못 찾았다`);
  return html.slice(start, end);
}

test("method 월세 증감 절은 목차·제목이 과거의 방법으로 읽히고 현재형 증감 문장이 없다 (#889)", async () => {
  const method = await read("docs/method.html");
  for (const { lang, id, title, oldTitle, lead, present, past } of LANGS) {
    const toc = `<li><a href="#${id}">${title}</a></li>`;
    assert.equal(count(method, toc), 1, `${lang}: 목차 줄이 「${title}」이 아니다`);
    const body = section(method, id);
    assert.ok(body.startsWith(`<h2 id="${id}">${title}</h2>`), `${lang}: #${id} 제목이 「${title}」이 아니다`);
    assert.equal(count(toc + body, oldTitle), 0, `${lang} 목차·#${id} 절: 옛 현재형 제목 「${oldTitle}」이 남았다`);
    for (const s of present) assert.equal(count(body, s), 0, `${lang} #${id}: 현재형 증감 문장 「${s}」이 남았다`);
    for (const s of past) assert.equal(count(body, s), 1, `${lang} #${id}: 과거형 「${s}」이 없다`);
    // 새 문단은 절의 첫 문단이고 파일 전체에 한 번만 있다.
    assert.equal(count(method, lead), 1, `${lang}: 조건 2의 새 문단이 정확히 한 번 있어야 한다`);
    const firstP = body.slice(body.indexOf("<p>"), body.indexOf("</p>") + "</p>".length);
    assert.equal(firstP, lead, `${lang} #${id}: 첫 문단이 조건 2의 새 문단이 아니다`);
  }
});

test("소개의 아파트 시세 줄은 증감을 기능으로 적지 않는다 (#889)", async () => {
  const about = await read("docs/about.html");
  const ko = about.match(/<li><strong>아파트 시세<\/strong>[^\n]*<\/li>/)?.[0];
  const en = about.match(/<li><strong>Apartment prices<\/strong>[^\n]*<\/li>/)?.[0];
  assert.ok(ko && en, "소개: 아파트 시세 줄(국·영)을 못 찾았다");
  assert.equal(count(ko, "전주 대비 증감"), 0, "소개 국: 「전주 대비 증감」이 남았다");
  assert.equal(count(en, "week-on-week change"), 0, '소개 영: "week-on-week change"가 남았다');
  // 조건 4 - 수치와 다른 기능은 그대로 두고 증감 문구만 뺀 pm 문안.
  assert.ok(ko.endsWith("3.3㎡당 평균 가격, 84㎡ 환산가, 1년 추이. 갱신 계약이 시세보다 싼지도 함께.</li>"), `소개 국: pm 문안과 다르다 - ${ko}`);
  assert.ok(en.endsWith("with the 84m² equivalent and a one-year trend — plus whether renewals are signing below the going rate.</li>"), `소개 영: 문안과 다르다 - ${en}`);
});
