import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 금리 네 장 머리의 갱신 안내(#update-schedule)는 시각을 말하지 않는다 (#369).
// 옛 문구는 "매일 오전 8시(KST) 갱신" / "Updated daily at 8 AM KST"였다. 금리는 daily-update 의 full 실행(cron KST 08:07)에서 모으는데
// 정기 실행은 GitHub 쪽 지연으로 예정보다 2.7~7.4시간 늦게 시작했다(2026-10-07~12, #294). 우리가 지킬 수 없는 시각 약속은 적지 않고,
// 횟수만 말한 뒤 실제 기준은 바닥글의 갱신 시각에 맡긴다. index 에서 같은 일을 먼저 했다(#298, test/update-schedule-notice.test.mjs).
// 이 시험은 문구 전체를 못박지 않는다 - 시각이 되돌아오는 길만 막는다.
//
// 대상은 틀(scripts/rates-template.html)과 거기서 구운 네 장이다. 구운 장은 틀의 문자열표를 그대로 담으므로 둘이 어긋나면 재굽기를 빠뜨린 것이다.

const root = path.resolve(import.meta.dirname, "..");
const FILES = [
  "scripts/rates-template.html",
  "docs/deposit-rates.html",
  "docs/saving-rates.html",
  "docs/mortgage-rates.html",
  "docs/rent-loan-rates.html",
];

// 한국어: "8시", "오전 8시", "오후" · 시계 모양 "08:00" · "아침". 영어: "08:00", "8 AM", "morning".
const CLOCK = [
  [/\d{1,2}\s*시/, "N시"],
  [/오전|오후/, "오전/오후"],
  [/\d{1,2}:\d{2}/, "HH:MM"],
  [/아침/, "아침"],
  [/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i, "N AM/PM"],
  [/\b(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i, "AM/PM"],
  [/morning|o'clock/i, "morning/o'clock"],
];

const updateSchedules = (html) => [...html.matchAll(/updateSchedule: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

test("금리 틀과 구운 네 장의 갱신 안내 문자열표(ko·en)에는 시각이 없다 (#369)", async () => {
  for (const file of FILES) {
    const found = updateSchedules(await readFile(path.join(root, file), "utf8"));
    assert.equal(found.length, 2, `${file}: updateSchedule 문자열이 ${found.length}개다 - 한국어·영어 둘이어야 한다`);
    for (const [i, label] of ["ko", "en"].entries()) {
      const text = found[i];
      assert.ok(text.length > 0, `${file} ${label} updateSchedule 이 비었다`);
      for (const [re, name] of CLOCK) {
        assert.ok(!re.test(text), `${file} ${label} updateSchedule 에 시각(${name})이 있다: "${text}" - 실행 시각은 지킬 수 없는 약속이다(#369)`);
      }
    }
    // 첫째가 한국어, 둘째가 영어인지(표 순서가 바뀌어 라벨이 어긋나지 않았는지).
    assert.match(found[0], /[가-힣]/, `${file}: 첫째 updateSchedule 이 한국어가 아니다`);
    assert.doesNotMatch(found[1], /[가-힣]/, `${file}: 둘째 updateSchedule 에 한글이 있다`);
  }
});

test("구운 네 장의 갱신 안내는 틀과 글자까지 같다 (#369)", async () => {
  const template = updateSchedules(await readFile(path.join(root, FILES[0]), "utf8"));
  for (const file of FILES.slice(1)) {
    assert.deepEqual(updateSchedules(await readFile(path.join(root, file), "utf8")), template, `${file}: 틀과 다르다 - node scripts/build-rate-pages.ts 로 다시 굽는다`);
  }
});

test("시각 모양 검사는 옛 문구 둘을 실제로 잡는다 (#369)", () => {
  const old = ["매일 오전 8시(KST) 갱신", "Updated daily at 8 AM KST"];
  for (const text of old) assert.ok(CLOCK.some(([re]) => re.test(text)), `옛 문구를 못 잡는다: ${text}`);
  // 정규식 하나씩도 제 몫을 한다: 어느 모양이 빠져도 이 표가 알린다.
  const shapes = ["오후 3시", "20시경", "08:00", "아침에 갱신", "9 PM", "each morning"];
  for (const text of shapes) assert.ok(CLOCK.some(([re]) => re.test(text)), `시각 모양을 못 잡는다: ${text}`);
  const now = ["하루 한 번 갱신됩니다. 기준은 아래 갱신 시각.", "Updated once a day. See the time below."];
  for (const text of now) assert.ok(!CLOCK.some(([re]) => re.test(text)), `새 문구가 걸린다: ${text}`);
});
