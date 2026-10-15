import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canonLines } from "../lib/canon.mjs";
import { DESIGN_ATTRS } from "../../../scripts/design-attrs.mjs";

// 내용 비교 모드(`--no-class-style`)의 변이 시험 (#277 완료 조건 2-b).
//
// 왜 전용 변이표인가. 범위 2가 더하는 것은 **새 모드**인데, 루트의 parity 시험은 조각을 보고 #274의 불변 검사는
// 기본 모드를 본다 — 새 모드를 세는 자가 따로 없으면 "구현만 되고 아무것도 안 잡은 채" 병합된다
// (PR #314 첫 판 가드가 돌연변이 27/27을 통과한 자리다). 그래서 **종료 코드**로 센다.
//
// 재는 법. `bin/compare.mjs <A> <B>`는 같으면 0, 다르면 1이다. 변이 하나마다 임시 폴더 둘(원본·변이)을 만들어
// 그 CLI를 돌리고 **종료 코드**를 본다(출력 문구가 아니다). 입력은 test/fixtures/rates.html 고정 사본 하나뿐이고
// 오늘의 docs/는 읽지 않는다 — 데일리 데이터가 매일 바뀌면 변이가 헛돈다(#8 부류).
//
// 표(이 파일이 기계로 세는 것):
//   통과해야 하는 변이 ①class 값 ②style 값            → 새 모드 0 · **기본 모드 1**(기본 모드가 안 변했다는 증거)
//   불합격해야 하는 변이 ①텍스트 한 글자 ②숫자 한 자리 ③링크 href ④태그 이름 ⑤새 태그로 감싸기
//                        ⑥요소 삭제 ⑦속성에 든 글자 ⑧텍스트 노드 안 공백 삭제 → 새 모드 **1**
//   그리고 ⑨id (cpo 보완 2026-10-15)                   → 새 모드 **1**
//     ⑨가 없으면 "class·style만 지운다"가 시험으로 안 선다 — id까지 지우는 정규화도 ①~⑧을 전부 통과한다.
//     id는 DIRECTION.md 369행이 지키는 JS 훅이라, 정규화가 그걸 지우면 체인 전체의 불변 검사가 무력해진다.
const BIN = path.join(import.meta.dirname, "../bin/compare.mjs");
const RATES = await readFile(path.join(import.meta.dirname, "fixtures/rates.html"), "utf8");

const bases = [];
after(() => Promise.all(bases.map((d) => rm(d, { recursive: true, force: true }))));

/** from이 정확히 한 번 있어야 바꾼다 — 고정 사본이 바뀌어 변이가 헛돌면 시험이 먼저 멈춘다. */
function mutate(html, from, to) {
  assert.equal(html.split(from).length - 1, 1, `변이 대상이 정확히 한 번 있어야 한다: ${from.slice(0, 60)}`);
  return html.replace(from, to);
}

/** 원본 한 장과 변이 한 장을 각각 자기 폴더에 쓴다(CLI가 폴더 둘을 받는다). */
async function pair(mutated) {
  const base = await mkdtemp(path.join(os.tmpdir(), "golden-content-"));
  bases.push(base);
  const a = path.join(base, "a");
  const b = path.join(base, "b");
  await Promise.all([mkdir(a), mkdir(b)]);
  await Promise.all([writeFile(path.join(a, "rates.html"), RATES), writeFile(path.join(b, "rates.html"), mutated)]);
  return { a, b };
}

/** bin/compare.mjs의 종료 코드. 0·1이 아니면(예: 사용법 오류 2) 그 자리에서 멈춘다. */
function exitCode(a, b, { contentMode }) {
  const args = contentMode ? [BIN, a, b, "--no-class-style"] : [BIN, a, b];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.ok(r.status === 0 || r.status === 1, `compare.mjs가 0·1이 아닌 ${r.status}로 끝났다: ${r.stderr}`);
  return r.status;
}

/** 변이 하나를 두 모드로 돌려 기대한 종료 코드와 맞댄다. */
async function expectExit(mutated, { content, base }, why) {
  const { a, b } = await pair(mutated);
  assert.equal(exitCode(a, b, { contentMode: true }), content, `새 모드(--no-class-style): ${why}`);
  assert.equal(exitCode(a, b, { contentMode: false }), base, `기본 모드: ${why}`);
}

test("지우는 속성 목록은 class·style 둘뿐이다(셋째가 생기면 cto 판정 — #277 완료 조건 2-a)", () => {
  assert.deepEqual([...DESIGN_ATTRS], ["class", "style"]);
  // 목록이 실제로 덤프에 먹는지: class·style만 사라지고 id·data-*·aria-*·title은 남는다.
  const html = `<p class="a" style="color:red" id="x" data-k="v" aria-label="L" title="T">글</p>`;
  const lines = canonLines(html, { ignoreDesignAttrs: true }).join("\n");
  assert.ok(!lines.includes("class="), "class가 남았다");
  assert.ok(!lines.includes("style="), "style이 남았다");
  for (const keep of ["id=", "data-k=", "aria-label=", "title="]) assert.ok(lines.includes(keep), `${keep}가 사라졌다`);
  // 기본 모드는 손대지 않았다.
  assert.ok(canonLines(html).join("\n").includes("class="), "기본 모드에서 class가 사라졌다");
});

test("대조군: 같은 입력은 두 모드 모두 종료 0", async () => {
  await expectExit(RATES, { content: 0, base: 0 }, "같은 입력인데 다르다고 했다");
});

// ---- 통과해야 하는 변이 ①② (새 모드 0 · 기본 모드 1) ----

test("통과 변이 ①: class 값만 바꾼다 → 새 모드 0, 기본 모드 1", async () => {
  const mutated = mutate(RATES, '<p class="rates-bridge" id="rates-bridge" data-lang="ko">', '<p class="rates-bridge tw:mt-4 tw:text-sm" id="rates-bridge" data-lang="ko">');
  await expectExit(mutated, { content: 0, base: 1 }, "class 값만 바꾼 변이");
});

test("통과 변이 ②: style 값만 바꾼다 → 새 모드 0, 기본 모드 1", async () => {
  const mutated = mutate(RATES, '<div style="margin-top:6px;">', '<div style="margin-top:24px;">');
  await expectExit(mutated, { content: 0, base: 1 }, "style 값만 바꾼 변이");
});

// ---- 불합격해야 하는 변이 ①~⑧ (새 모드 1). 여기서 종료 0이 나오면 정규화가 너무 넓은 것이다. ----

test("불합격 변이 ①: 본문 텍스트 한 글자", async () => {
  await expectExit(mutate(RATES, "<h2>모을 때</h2>", "<h2>모을 땐</h2>"), { content: 1, base: 1 }, "텍스트 한 글자");
});

test("불합격 변이 ②: 본문 숫자 한 자리", async () => {
  await expectExit(mutate(RATES, "10억 원 예산 기준으로", "11억 원 예산 기준으로"), { content: 1, base: 1 }, "숫자 한 자리");
});

test("불합격 변이 ③: 링크 href", async () => {
  const mutated = mutate(RATES, '<a href="./about.html" id="footer-about">소개</a>', '<a href="./about" id="footer-about">소개</a>');
  await expectExit(mutated, { content: 1, base: 1 }, "링크 href");
});

test("불합격 변이 ④: 태그 이름(제목 계층)", async () => {
  await expectExit(mutate(RATES, "<h2>모을 때</h2>", "<h3>모을 때</h3>"), { content: 1, base: 1 }, "태그 이름");
});

test("불합격 변이 ⑤: 한 요소를 새 태그로 감싸기", async () => {
  await expectExit(mutate(RATES, "<h2>모을 때</h2>", "<div><h2>모을 때</h2></div>"), { content: 1, base: 1 }, "새 태그로 감싸기");
});

test("불합격 변이 ⑥: 요소 삭제", async () => {
  await expectExit(mutate(RATES, '<a href="./method.html" id="footer-method">숫자를 만드는 방법</a>', ""), { content: 1, base: 1 }, "요소 삭제");
});

test("불합격 변이 ⑦: 속성에 든 글자(aria-label)", async () => {
  await expectExit(mutate(RATES, 'aria-label="테마 전환"', 'aria-label="테마 바꾸기"'), { content: 1, base: 1 }, "속성에 든 글자");
});

test("불합격 변이 ⑧: 텍스트 노드 안 공백 삭제", async () => {
  const from = '<div id="footer-source">출처: 금융감독원 금융상품통합비교공시.</div>';
  const to = '<div id="footer-source">출처: 금융감독원금융상품통합비교공시.</div>';
  await expectExit(mutate(RATES, from, to), { content: 1, base: 1 }, "텍스트 노드 안 공백 삭제");
});

test("불합격 변이 ⑨: id(JS 훅) — 정규화가 class·style 밖으로 넘치면 여기서 종료 0이 난다", async () => {
  const from = '<div id="footer-source">출처: 금융감독원 금융상품통합비교공시.</div>';
  const to = '<div id="footer-origin">출처: 금융감독원 금융상품통합비교공시.</div>';
  await expectExit(mutate(RATES, from, to), { content: 1, base: 1 }, "id(DIRECTION.md 369행의 JS 훅)");
});
