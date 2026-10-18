import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// index 머리의 갱신 안내(#update-schedule)는 시각을 말하지 않는다 (#298).
// 옛 문구는 "08·12·16·20시경 / 아침에"라고 적었지만 정기 실행은 GitHub 쪽 지연으로 안내한 시각의 앞뒤 1시간 안에
// 시작한 적이 없었다(2026-10-07~12 실행 21건 중 0건, #294). 우리가 지킬 수 없는 시각 약속은 적지 않고, 횟수만 말한 뒤
// 실제 기준은 화면의 갱신 시각에 맡긴다. 이 시험은 문구 전체를 못박지 않는다 - 시각이 되돌아오는 길만 막는다.
//
// 범위는 index 한 장이다. 금리 네 장(scripts/rates-template.html)의 같은 종류 문구는 #369 가 따로 닫았다(test/rates-schedule-notice.test.mjs).

const root = path.resolve(import.meta.dirname, "..");

// 한국어: "8시", "20시경", "오전 8시" · 시계 모양 "08:00" · "아침". 영어: "08:00", "8 AM", "morning".
const CLOCK = [
  [/\d{1,2}\s*시/, "N시"],
  [/\d{1,2}:\d{2}/, "HH:MM"],
  [/아침/, "아침"],
  [/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i, "N AM/PM"],
  [/morning|o'clock/i, "morning/o'clock"],
];

test("index 의 갱신 안내 문자열표(ko·en)에는 시각이 없다 (#298)", async () => {
  const html = await readFile(path.join(root, "docs/index.html"), "utf8");
  const found = [...html.matchAll(/updateSchedule: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.equal(found.length, 2, `docs/index.html: updateSchedule 문자열이 ${found.length}개다 - 한국어·영어 둘이어야 한다`);
  for (const [i, label] of ["ko", "en"].entries()) {
    const text = found[i];
    assert.ok(text.length > 0, `${label} updateSchedule 이 비었다`);
    for (const [re, name] of CLOCK) {
      assert.ok(!re.test(text), `${label} updateSchedule 에 시각(${name})이 있다: "${text}" - 실행 시각은 지킬 수 없는 약속이다(#298)`);
    }
  }
  // 첫째가 한국어, 둘째가 영어인지(표 순서가 바뀌어 라벨이 어긋나지 않았는지).
  assert.match(found[0], /[가-힣]/, "첫째 updateSchedule 이 한국어가 아니다");
  assert.doesNotMatch(found[1], /[가-힣]/, "둘째 updateSchedule 에 한글이 있다");
});

test("시각 모양 검사는 옛 문구 둘을 실제로 잡는다 (#298)", () => {
  const old = [
    "뉴스·AI 요약은 하루 4회(08·12·16·20시경), 시장지표·부동산은 아침에 갱신됩니다.",
    "News and the AI summary refresh 4×/day (08:00, 12:00, 16:00, 20:00 KST); market and real estate each morning.",
  ];
  for (const text of old) assert.ok(CLOCK.some(([re]) => re.test(text)), `옛 문구를 못 잡는다: ${text}`);
  const now = [
    "뉴스·AI 요약은 하루 네 번, 시장지표·부동산은 하루 한 번 갱신됩니다. 실제 기준은 아래 갱신 시각을 보세요.",
    "News and the AI summary refresh four times a day; market and real estate once a day. See the time below.",
  ];
  for (const text of now) assert.ok(!CLOCK.some(([re]) => re.test(text)), `새 문구가 걸린다: ${text}`);
});
