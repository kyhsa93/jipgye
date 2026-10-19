// 금리 화면 두 장의 렌더 본문에서 같은 문단·같은 문장 쌍이 몇 개인지 센다(#193).
//
//   node scripts/rate-dup.mjs docs/rates.html docs/deposit-rates.html
//
// "렌더 본문"의 정의(바꾸면 기준선이 달라지니 숫자를 인용할 때 같이 적는다):
//  - <head>·<script>·<style>·주석을 지운다. 스크립트 안 문구 사전은 렌더 본문이 아니다.
//  - 모든 화면이 공유하는 틀(<header>·내비게이션·검색창·<footer>)은 뺀다. 틀은 설계상 같다.
//  - 상품 표 본문(<tbody>)은 뺀다. 상품명·금리는 데이터 행이라 두 화면이 같아도 문구 중복이 아니다.
//  - 블록 태그(p·div·h1~h6·li·caption·section 등)에서 문단을 끊고, 인라인 태그(a·span·strong 등)는
//    글자만 남겨 한 문단으로 잇는다. 공백은 하나로 접는다. 숨김(hidden) 영어 문단도 본문에 든다.
//  - 문장은 문단을 ". " "! " "? " 뒤에서 자른다. 너무 짧은 조각(라벨·버튼 글자)은 세지 않는다.
export const MIN_CHARS = 15;

const BLOCK = "p|div|h[1-6]|li|ul|ol|caption|section|table|thead|tr|th|td|label|button|nav|form|br|details|summary";

export function renderedBody(html) {
  let s = html;
  s = s.replace(/<!--(?!\s*\/?prerender:)[\s\S]*?-->/g, " ");
  s = s.replace(/<head[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<header\b[\s\S]*?<\/header>/gi, " ");
  // 1층 내비는 훅 class(page-nav) 뒤에 유틸리티 class 가 붙는다(#282, 유틸리티를 단 금리 틀 4장·허브). class 속성이 훅 하나만 담는다고 가정하지 않는다.
  s = s.replace(/<nav\b[^>]*?\sclass="(?:[^"]*\s)?page-nav(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<form\b[\s\S]*?<\/form>/gi, " ");
  s = s.replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<tbody\b[\s\S]*?<\/tbody>/gi, " ");
  s = s.replace(/<!--\s*\/?prerender:[^>]*-->/g, "");
  s = s.replace(new RegExp(`</?(?:${BLOCK})\\b[^>]*>`, "gi"), "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  return s;
}

export function paragraphs(html) {
  return renderedBody(html)
    .split("\n")
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= MIN_CHARS);
}

export function sentences(html) {
  return paragraphs(html)
    .flatMap((p) => p.split(/(?<=[.!?。])\s+/))
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_CHARS);
}

function sharedPairs(a, b) {
  const counts = new Map();
  for (const t of b) counts.set(t, (counts.get(t) ?? 0) + 1);
  let pairs = 0;
  const shared = [];
  for (const t of a) {
    const n = counts.get(t) ?? 0;
    if (n) {
      pairs += n;
      shared.push(t);
    }
  }
  return { pairs, shared };
}

export function countShared(htmlA, htmlB) {
  const para = sharedPairs(paragraphs(htmlA), paragraphs(htmlB));
  const sent = sharedPairs(sentences(htmlA), sentences(htmlB));
  return {
    paragraphsA: paragraphs(htmlA).length,
    paragraphsB: paragraphs(htmlB).length,
    sharedParagraphs: para.pairs,
    sentencesA: sentences(htmlA).length,
    sentencesB: sentences(htmlB).length,
    sharedSentences: sent.pairs,
    sharedSentenceTexts: sent.shared,
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const { readFile } = await import("node:fs/promises");
  const [fa, fb] = process.argv.slice(2);
  if (!fa || !fb) {
    console.error("사용: node scripts/rate-dup.mjs <화면A.html> <화면B.html>");
    process.exit(2);
  }
  const [a, b] = await Promise.all([readFile(fa, "utf8"), readFile(fb, "utf8")]);
  const r = countShared(a, b);
  console.log(`${fa}: 문단 ${r.paragraphsA}개, 문장 ${r.sentencesA}개`);
  console.log(`${fb}: 문단 ${r.paragraphsB}개, 문장 ${r.sentencesB}개`);
  console.log(`같은 문단 쌍: ${r.sharedParagraphs}`);
  console.log(`같은 문장 쌍: ${r.sharedSentences}`);
}
