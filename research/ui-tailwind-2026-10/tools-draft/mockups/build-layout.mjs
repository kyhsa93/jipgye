#!/usr/bin/env node
// 2층(index 레이아웃 방향 1장)을 만든다: out/<시안>/docs 사본의 index.html 구조·순서를 바꾸고 css/<시안>-layout.css를 덧붙인다.
//   node tools/build-layout.mjs a b c   → out/<시안>-layout/docs, layout-changes.json(바꾼 목록)
// 바꾸는 것은 index.html과 style.css 둘뿐이다. 글자·속성·링크·제목·id·스크립트는 그대로 두고 **요소를 옮기거나 감싸는 것만** 한다.
// 옮기는 일은 문자열 한 번 찾기(replaceOnce)로 한다 — 못 찾거나 두 번 나오면 멈춘다.
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";

const M = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function once(html, needle, label) {
  const i = html.indexOf(needle);
  if (i < 0) throw new Error(`못 찾음: ${label}`);
  if (html.indexOf(needle, i + 1) >= 0) throw new Error(`두 번 나옴: ${label}`);
  return i;
}
/** [startNeedle … endNeedle] 구간(끝 포함)을 잘라 낸다. 반환: [남은 html, 잘라 낸 조각] */
function cut(html, startNeedle, endNeedle, label) {
  const s = once(html, startNeedle, `${label} 시작`);
  const e = html.indexOf(endNeedle, s);
  if (e < 0) throw new Error(`못 찾음: ${label} 끝`);
  const piece = html.slice(s, e + endNeedle.length);
  return [html.slice(0, s) + html.slice(e + endNeedle.length), piece];
}
const insertBefore = (html, needle, piece, label) => { const i = once(html, needle, label); return html.slice(0, i) + piece + html.slice(i); };
const insertAfter = (html, needle, piece, label) => { const i = once(html, needle, label); return html.slice(0, i + needle.length) + piece + html.slice(i + needle.length); };

const SCHEDULE = `      <div class="update-schedule" id="update-schedule"></div>\n`;
const FOOTER_OPEN = `  <footer class="site-footer">\n`;

/** 갱신 주기 안내를 머리에서 바닥글로 옮긴다(A·C). */
function moveScheduleToFooter(html, changes) {
  let piece;
  [html, piece] = cut(html, SCHEDULE, SCHEDULE.slice(-1), "갱신 주기"); // 한 줄
  html = insertAfter(html, FOOTER_OPEN, `    <div class="update-schedule" id="update-schedule"></div>\n`, "바닥글 여는 태그");
  changes.push({ what: "갱신 주기 안내(`#update-schedule`, 스크립트가 채우는 한 줄)를 머리(header)에서 바닥글 첫 줄로 옮김", why: "머리를 워드마크 줄 + 갱신 한 줄로 줄인다", kind: "순서(텍스트 순서 바뀜)" });
  return html;
}

/** AI 요약과 뉴스 두 구획을 한 겹 감싼다(넓은 화면 2단). */
function wrapSummaryNews(html, changes) {
  html = insertBefore(html, `  <section id="summary-section">`, `  <div class="split">\n`, "요약 구획");
  html = insertBefore(html, `  <section id="archive-section">`, `  </div>\n\n`, "지난 기록 구획");
  changes.push({ what: "`#summary-section`(AI 요약)과 `#news-section`(뉴스)을 `div.split` 한 겹으로 감쌈", why: "넓은 화면에서 아래 절반을 \"AI 요약 | 뉴스\" 2단으로 놓아 빈 오른쪽을 채운다. 순서는 그대로", kind: "감싸기(순서 불변)" });
  return html;
}

const LAYOUTS = {
  a(html, changes) {
    html = moveScheduleToFooter(html, changes);
    html = wrapSummaryNews(html, changes);
    changes.push({ what: "(1층에서 이미 전 장에 적용) 1층 내비(`nav.page-nav`)를 560px 이하에서 가로 스크롤 한 줄 대신 4칸 균등 격자로", why: "320폭·영어 모드에서 넷째 항목이 잘리지 않는다 — DOM을 바꾸지 않고 되므로 세 시안 공통 1층에 넣었다", kind: "CSS만(1층)" });
    changes.push({ what: "머리: 워드마크 + 단추 셋 한 줄, 그 아래 한 줄 소개와 갱신 시각", why: "머리 높이를 줄여 질문 입구를 위로", kind: "CSS만" });
    return html;
  },
  b(html, changes) {
    // 1) 추이 카드 묶음(지역 선택 + 부동산 추이 격자 + 그 단서 두 줄)을 시세 구획에서 떼어 맨 위로.
    let controls, grid, notes, marketGrid, callout, question, market;
    [html, controls] = cut(html, `    <div class="realestate-history-controls">`, `</select>\n    </div>\n`, "지역 선택");
    [html, grid] = cut(html, `    <div class="history-grid" id="realestate-history-grid"></div>\n`, `\n`, "부동산 추이 격자");
    [html, notes] = cut(html, `    <div class="summary-meta" id="realestate-history-note"></div>\n`, `<div class="summary-meta" id="realestate-meta"></div>\n`, "추이 단서");
    [html, marketGrid] = cut(html, `    <div class="history-grid" id="history-grid"></div>\n`, `\n`, "금리·환율 추이 격자");
    [html, callout] = cut(html, `  <aside class="method-callout">`, `</aside>\n`, "안내 문단");
    [html, question] = cut(html, `  <h2 class="question-heading" id="question-heading">`, `  </nav>\n`, "질문 입구");
    [html, market] = cut(html, `  <section id="market-section">`, `  </section>\n`, "금리·환율 구획");
    const dashTop = `  <div class="dash">\n  <div class="dash-cards">\n${controls}${grid}${notes}  </div>\n\n  <div class="dash-question">\n${question}  </div>\n\n`;
    html = insertBefore(html, `  <section id="realestate-section">`, dashTop, "시세 구획");
    // 시세 구획 닫는 태그 뒤에 금리·환율 추이 카드, 오른쪽 단(금리·환율 표 + 안내 문단)을 넣고 dash를 닫는다.
    const reEnd = once(html, `  <section id="realestate-section">`, "시세 구획(2)");
    const close = html.indexOf(`  </section>\n`, reEnd);
    html = html.slice(0, close + `  </section>\n`.length) + `\n  <div class="dash-mcards">\n${marketGrid}  </div>\n\n  <div class="dash-side">\n${market}${callout}  </div>\n  </div>\n` + html.slice(close + `  </section>\n`.length);
    changes.push({ what: "부동산 추이 카드 묶음을 맨 위로: 지역 선택(`.realestate-history-controls`)·부동산 추이 격자(`#realestate-history-grid`)·추이 단서 두 줄(`#realestate-history-note`·`#realestate-meta`)을 시세 구획에서 떼어 새 `div.dash-cards`에 모음(검색창 바로 아래, 질문 입구 앞)", why: "값·최고·최저를 가진 카드를 첫 화면에. 폰은 2열", kind: "순서(텍스트 순서 바뀜)" });
    changes.push({ what: "금리와 환율 추이 격자(`#history-grid`)를 금리·환율 구획에서 떼어 새 `div.dash-mcards`에 둠(문서 순서는 시세 구획 뒤, 금리·환율 표 앞)", why: "넓은 화면에서 부동산 카드 아래 줄에 놓아 2×2를 만든다. 폰에서는 질문 입구를 더 밀지 않게 시세표 뒤에 둔다", kind: "순서 + 감싸기" });
    changes.push({ what: "질문 입구(`h2#question-heading` + `nav#question-nav`)를 `div.dash-question`으로 감쌈. 문서 순서는 부동산 추이 카드 뒤, 시세표 앞", why: "넓은 화면 오른쪽 4단 / 폰은 카드 다음", kind: "감싸기 + 순서" });
    changes.push({ what: "금리·환율 구획(`#market-section`: 제목·표·금리 비교 링크)과 안내 문단(`aside.method-callout`)을 `div.dash-side`로 묶어 맨 뒤에 둠. 안내 문단은 검색창 아래 → 금리·환율 구획 뒤로 내려감", why: "넓은 화면 오른쪽 4단(질문 입구 아래)", kind: "순서(텍스트 순서 바뀜)" });
    changes.push({ what: "위 다섯(부동산 카드·질문·시세 구획·금리와 환율 카드·오른쪽 단)을 `div.dash`로 감쌈", why: "넓은 화면 12단 격자(왼쪽 8 : 오른쪽 4)", kind: "감싸기" });
    html = wrapSummaryNews(html, changes);
    return html;
  },
  c(html, changes) {
    html = moveScheduleToFooter(html, changes);
    changes.push({ what: "질문 입구: 2열 카드 → 한 줄에 질문 하나씩의 목록, 묶음 제목은 소제목", why: "문장으로 읽히는 입구", kind: "CSS만" });
    changes.push({ what: "안내 문단: 15px 인용 상자 → 본문 크기(17px)의 \"읽는 법\" 리드", why: "사이트가 파는 것(표본을 밝힌다)을 본문 크기로", kind: "CSS만" });
    changes.push({ what: "(1층에서 이미 전 장에 적용) 넓은 화면에서 읽는 단 44rem을 가운데에, 표·차트 격자만 60rem까지", why: "브리프 3절 C의 index 레이아웃 방향 — DOM을 바꾸지 않고 되므로 1층에 넣었다", kind: "CSS만(1층)" });
    return html;
  },
};

const report = {};
for (const v of process.argv.slice(2)) {
  const src = path.join(M, "out", v, "docs");
  const dst = path.join(M, "out", `${v}-layout`, "docs");
  await rm(path.join(M, "out", `${v}-layout`), { recursive: true, force: true });
  await mkdir(path.join(M, "out", `${v}-layout`), { recursive: true });
  try { execFileSync("cp", ["-Rc", src, dst]); } catch { execFileSync("cp", ["-R", src, dst]); }
  const changes = [];
  const before = await readFile(path.join(src, "index.html"), "utf8");
  const after = LAYOUTS[v](before, changes);
  await writeFile(path.join(dst, "index.html"), after);
  const css = (await readFile(path.join(src, "style.css"), "utf8")) + (await readFile(path.join(M, "css", `${v}-layout.css`), "utf8"));
  await writeFile(path.join(dst, "style.css"), css);
  report[v] = { changes, indexBytes: { before: Buffer.byteLength(before), after: Buffer.byteLength(after) }, styleBytes: Buffer.byteLength(css) };
  console.log(`${v}-layout: index.html ${Buffer.byteLength(before)} → ${Buffer.byteLength(after)} 바이트, style.css ${Buffer.byteLength(css)} 바이트, 바꾼 것 ${changes.length}가지`);
}
let all = {};
try { all = JSON.parse(await readFile(path.join(M, "measure", "layout-changes.json"), "utf8")); } catch {}
await mkdir(path.join(M, "measure"), { recursive: true });
await writeFile(path.join(M, "measure", "layout-changes.json"), JSON.stringify({ ...all, ...report }, null, 1));
