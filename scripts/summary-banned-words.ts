// AI 요약에 실으면 안 되는 낱말 (#945, #639 후속). 사이트 약속(#639 PR-2 po·cpo·legal 판정 2026-10-26)은 「「실시간」·LIVE 문구는
// 사이트 어디에도 없다」(범위: 우리 글 — #945 H1)이고, 2026-11-18 금리 요약에 모델이 지어낸 「… 실시간으로 움직이는 것으로 나타났다.」 한 문장이 배포 게이트
// (test/fx-screens.test.mjs)를 막았다(Deploy run 44239714050). 목록은 여기 한 곳이고 요약기(scripts/summarize-news.ts)와 시험이 같이 import 한다 -
// 둘로 갈라지면 요약기가 통과시킨 문장을 게이트가 막거나 그 반대가 된다.
//
// 쓰는 범위(legal 조건, #945 댓글): 요약 문장(한국어)과 그 영어 번역에만 쓴다. 기사 제목(title·titleEn)을 다루는 경로는 이 모듈을 import 하지 않는다 -
// 제목은 출처·링크가 붙은 인용이라 고치거나 숨기지 않는다. 처리는 문장을 통째로 떼는 것뿐이고 낱말을 지우거나 바꾸지 않는다
// (낱말만 지우면 모델이 쓴 문장이 사람이 고친 문장이 된다).
//
// LIVE 는 대소문자를 가린다 - 배지 꼴 「LIVE」만 막고 영어 문장의 동사 live 는 막지 않는다(#96 이후 게이트의 `\bLIVE\b` 와 같다).
// real-time 은 문장 첫머리 「Real-time」도 있어 대소문자를 가리지 않고, 붙여 쓴 realtime 도 같은 뜻이라 함께 막는다.
export const BANNED_PATTERNS: ReadonlyArray<{ word: string; re: RegExp }> = [
  { word: "실시간", re: /실시간/ },
  { word: "real-time", re: /real[- ]?time/i },
  { word: "LIVE", re: /\bLIVE\b/ },
];

/** 글에 든 금지어(목록의 word). 없으면 빈 배열. */
export function bannedWordsIn(text: string): string[] {
  return BANNED_PATTERNS.filter(({ re }) => re.test(text)).map(({ word }) => word);
}

// 뗀 문장 바로 뒤 문장이 앞 문장을 가리키며 시작하면(「이는 …」) 가리키던 것이 사라져 뜻이 어긋난다 - 같이 뗀다(legal 권고, #945).
// 사슬로 이어지면 계속 뗀다. 2026-11-18 금리 줄에서는 넷째 문장 뒤가 「오늘 발표된 …」이라 해당하지 않는다.
const REFERS_BACK = /^(?:이는|이러한|이에)(?=\s|[,.])/;

/**
 * shouldDrop 이 참인 문장을 통째로 뗀다(뒤따르는 「이는 …」 문장 포함). 문장 경계는 요약기 completeSentences 와 같은 「종결부호 + 공백」이다.
 * 뗄 것이 없으면 받은 글을 그대로(바이트 그대로) 돌려준다 - 다시 이어 붙이지 않는다. 다 떼어지면 text 는 null 이다.
 * 판정을 인자로 받는 것은 금지어 말고 다른 떼기(예: 원문에 없는 전망 군말, #945 범위 밖 후속)가 같은 문장 경계·같은 「이는」 규칙을 쓰게 하려는 것이다.
 */
export function dropSentences(text: string, shouldDrop: (sentence: string) => boolean): { text: string | null; dropped: string[] } {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  if (!sentences.some(shouldDrop)) return { text, dropped: [] };
  const kept: string[] = [];
  const dropped: string[] = [];
  let previousDropped = false;
  for (const sentence of sentences) {
    const drop = shouldDrop(sentence) || (previousDropped && REFERS_BACK.test(sentence));
    (drop ? dropped : kept).push(sentence);
    previousDropped = drop;
  }
  return { text: kept.length ? kept.join(" ") : null, dropped };
}

/** 금지어(BANNED_PATTERNS)가 든 문장을 통째로 뗀다. 요약기가 생성한 한국어 문단·한 문장·핵심 줄에 쓴다(#945). */
export function dropBannedSentences(text: string): { text: string | null; dropped: string[] } {
  return dropSentences(text, (sentence) => bannedWordsIn(sentence).length > 0);
}
