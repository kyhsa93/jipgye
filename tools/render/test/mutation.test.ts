// 변이 시험(#325 완료 조건 1-b). **고정 fixture로 돌고 CI 상시다** — 실제 `docs/`를 읽지 않으므로
// 데일리 커밋에도 오늘 날짜에도 흔들리지 않는다(#8에서 데인 자리, R3).
//
// ⚠️ **합격선은 "종료 코드가 0이 아니다"다.** 출력 문구로 재지 않는다 — 문구는 고치면 되지만 종료 코드는
// CI가 읽는 것이다. 그리고 **기준 fixture는 0으로 끝나야 한다**(아래 대조군). 그 둘이 짝이어야
// "아무것도 보고하지 않는 도구"와 "전부 실패시키는 도구"가 **둘 다** 막힌다.
//
// ⚠️ **env 게이트를 달지 않는다.** Chrome을 못 찾으면 건너뛰는 것이 아니라 실패다(#274 체인 공통 규칙 1번).
// 건너뛴 시험은 `pass` 하한에 0을 보태므로, 게이트를 달면 "브라우저가 없어서 안 돌았다"가 초록으로 끝난다.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findChrome } from "../lib/chrome.ts";
import { BASE, MUTATIONS, makeMutant } from "./helpers/mutate.ts";

const run = promisify(execFile);
const BIN = path.resolve(import.meta.dirname, "../bin/check.ts");

/** 도구를 **프로세스로** 돌린다. 반환: { code, out }. 라이브러리를 직접 부르면 종료 코드를 못 잰다. */
async function check(dir, args = []) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, dir, ...args], { maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    return { code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const argsFor = (m) => {
  const a = ["--js", m.js ? "on" : "off", "--lang", m.lang ?? "ko"];
  if (m.baseline) a.push("--baseline", BASE);
  return a;
};

test("Chrome이 이 기기에 있다 — 없으면 아래 변이 시험은 전부 뜻이 없다", () => {
  const found = findChrome();
  assert.ok(found, "Chrome을 못 찾았다. CHROME_PATH로 알려 주거나 설치한다 — 건너뛰지 않는다(#325 장치 4).");
});

// 대조군. 이것이 없으면 "무조건 1로 끝나는 도구"가 변이 시험 전부를 통과한다.
for (const [label, args] of [
  ["한국어·스크립트 끔", ["--js", "off", "--lang", "ko"]],
  ["한국어·스크립트 켬", ["--js", "on", "--lang", "ko"]],
  ["영어·스크립트 켬", ["--js", "on", "--lang", "en"]],
  ["기준끼리 견줌(검사 ①)", ["--js", "off", "--lang", "ko", "--baseline", BASE]],
]) {
  test(`대조군: 기준 fixture는 위반 0건으로 끝난다 — ${label}`, async () => {
    const r = await check(BASE, args);
    assert.equal(r.code, 0, `기준 fixture가 종료 코드 ${r.code}로 끝났다:\n${r.out}`);
    assert.match(r.out, /합계: 위반 0건/);
  });
}

for (const [name, m] of Object.entries(MUTATIONS)) {
  test(`변이 「${name}」에서 도구가 0이 아닌 코드로 끝난다 (검사: ${m.check})`, async () => {
    const dir = await makeMutant(name);
    try {
      const r = await check(dir, argsFor(m));
      assert.notEqual(r.code, 0, `변이 「${name}」인데 종료 코드가 0이다 — 도구가 못 본다:\n${r.out}`);
      assert.equal(r.code, 1, `위반이 아니라 도구 오류(코드 ${r.code})로 끝났다:\n${r.out}`);
      assert.ok(r.out.includes(m.check), `변이 「${name}」이 걸린 검사가 「${m.check}」가 아니다:\n${r.out}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("변이 「영어 모드에서만」은 한국어로 돌면 안 걸린다 — 영어 축이 실제로 돈다는 증거", async () => {
  const dir = await makeMutant("영어 모드에서만");
  try {
    const ko = await check(dir, ["--js", "on", "--lang", "ko"]);
    assert.equal(ko.code, 0, `한국어에서도 걸렸다 — 영어 전용 변이가 아니다:\n${ko.out}`);
    const en = await check(dir, ["--js", "on", "--lang", "en"]);
    assert.equal(en.code, 1, `영어에서 안 걸렸다:\n${en.out}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("변이 「대비」는 네 모드 가운데 dark 한 갈래에서만 걸린다 — 모드 축이 실제로 돈다는 증거", async () => {
  const dir = await makeMutant("대비");
  try {
    const r = await check(dir, ["--js", "off", "--lang", "ko"]);
    assert.equal(r.code, 1);
    const modes = [...r.out.matchAll(/대비 \[375px·([a-z-]+)\]/g)].map((x) => x[1]);
    assert.ok(modes.length > 0, `대비 위반이 한 줄도 안 나왔다:\n${r.out}`);
    assert.deepEqual([...new Set(modes)], ["dark"], `dark 말고 다른 모드에서도 걸렸다: ${[...new Set(modes)].join(", ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("변이가 실제로 파일을 바꾼다 — 찾을 자리가 없으면 그 자리에서 던진다", async () => {
  // 패치가 조용히 안 걸리면 변이 시험이 **기준을 재면서 통과**한다. 그 길을 helper가 막는 것을 확인한다.
  const { MUTATIONS: table } = await import("./helpers/mutate.ts");
  const saved = table["가로 넘침"].find;
  table["가로 넘침"].find = "이 문자열은 fixture에 없다";
  try {
    await assert.rejects(() => makeMutant("가로 넘침"), /찾을 자리가 0곳/);
  } finally {
    table["가로 넘침"].find = saved;
  }
});

test("체인 공통 규칙 1번의 검사 ①~⑤에 각각 최소 한 변이가 걸린다", () => {
  // 항목이 구현만 되고 아무것도 안 잡는 상태를 막는다(#325 완료 조건 1-b).
  const covered = new Set(Object.values(MUTATIONS).map((m) => m.check));
  for (const need of ["가시 텍스트", "가로 넘침", "대화형 요소 크기", "입력칸 글자 크기", "대비", "건너뛰기 링크"]) {
    assert.ok(covered.has(need), `검사 「${need}」에 걸리는 변이가 없다`);
  }
  // ⑤(영어 모드)는 검사 이름이 아니라 **축**이라 따로 센다.
  assert.ok(Object.values(MUTATIONS).some((m) => m.lang === "en"), "영어 모드에서만 나는 변이가 없다");
});
