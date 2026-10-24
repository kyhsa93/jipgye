#!/usr/bin/env node
// 골든 `--json` 결과로 예외 목록(expect.json)을 만든다 (#548). 세션 스크래치패드에 있던 golden-expect.py 를 저장소로 옮긴 것.
//
// 쓰는 법: node scripts/dev/golden-expect.mjs <gold.json> <판정댓글URL> <out.json> [--pattern P1] [--refs "#410·#413"] [--patterns <patterns.md>]
//   - 이유 문구는 인자로 받지 않는다 — `.claude/patterns.md` 의 해당 패턴 절(`## P1 …`) 안 「이유 문구」 줄(`- <check id>: <문구>`)에서 읽는다.
//     문구 안의 `{refs}` 는 --refs 로, `{bytes}` 는 그 장의 순증 바이트로 바뀐다.
//   - `confirmedBy` 는 판정 댓글 URL 하나(한 댓글에 cto·po·cmo 서명 3줄)를 세 번 적은 모양이다.
//   - s6 예산: s6-inline-bytes 순증이 장마다 ≤ +400 B 여야 한다(P1 예산, cto 판정 #548). 넘는 장이 있으면 expect 를 쓰지 않고
//     「전체 판정」을 찍고 종료 2 — 패턴 위임이 아니라 전체 판정으로 올린다.
//   - 하드 실패 id 가 inline-script·s6-inline-bytes 뿐이 아니면(새 하드 실패 id) 마찬가지로 「전체 판정」, 종료 2.
// inline-script 항목이 모든 장에서 같으면 `"page":"*"` 한 줄, 아니면 장별.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const S6_BUDGET_BYTES = 400;
const DEFAULT_PATTERNS = path.resolve(import.meta.dirname, "..", "..", ".claude", "patterns.md");

// patterns.md 에서 `## <id>` 절(다음 `## ` 앞까지)의 「- <check id>: <문구>」 줄을 { checkId: 문구 } 로 읽는다.
export function readReasons(patternsText, patternId) {
  const lines = patternsText.split("\n");
  const head = new RegExp(`^## ${patternId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) throw new Error(`패턴 ${patternId} 절(\`## ${patternId} …\`)을 patterns.md 에서 찾지 못했다.`);
  const reasons = {};
  for (const l of lines.slice(start + 1)) {
    if (/^## /.test(l)) break;
    const m = l.match(/^- (inline-script|s6-inline-bytes): (.+)$/);
    if (m) reasons[m[1]] = m[2].trim();
  }
  for (const id of ["inline-script", "s6-inline-bytes"]) {
    if (!reasons[id]) throw new Error(`패턴 ${patternId} 절에 「- ${id}: <이유 문구>」 줄이 없다.`);
  }
  return reasons;
}

// 순증 바이트: `56220B (+358)` → 358. 줄어든 장(`(-12)`)이나 증감이 없으면 0.
export function addedBytes(added) {
  const m = String(added?.[0] ?? "").match(/\(\+(\d+)\)/);
  return m ? Number(m[1]) : 0;
}

// gold: 골든 --json 결과({ failing: [{ file, findings: [{ id, missing, added }] }] }).
// 반환: { ok: true, exceptions } 또는 { ok: false, lines } (전체 판정 사유).
export function buildExceptions(gold, { url, reasons, refs = "" }) {
  const confirmedBy = `po ${url} · cmo ${url} · cto ${url}`;
  const fill = (text, bytes) => text.replaceAll("{refs}", refs).replaceAll("{bytes}", String(bytes)).replace(/\s+/g, " ").trim();
  const groups = new Map();
  const s6 = [];
  const other = [];
  const over = [];
  for (const r of gold.failing ?? []) {
    for (const x of r.findings) {
      if (x.id === "inline-script") {
        const key = JSON.stringify([x.missing, x.added]);
        if (!groups.has(key)) groups.set(key, { missing: x.missing, added: x.added, pages: [] });
        groups.get(key).pages.push(r.file);
      } else if (x.id === "s6-inline-bytes") {
        const bytes = addedBytes(x.added);
        if (bytes > S6_BUDGET_BYTES) over.push({ page: r.file, bytes });
        s6.push({ page: r.file, check: "s6-inline-bytes", missing: x.missing, added: x.added, reason: fill(reasons["s6-inline-bytes"], bytes), confirmedBy });
      } else {
        other.push(`${r.file} ${x.id}`);
      }
    }
  }
  if (over.length > 0 || other.length > 0) {
    const lines = ["전체 판정: 패턴 위임이 아니라 전체 판정으로 올린다 — expect 를 쓰지 않았다."];
    if (over.length > 0) {
      const max = Math.max(...over.map((o) => o.bytes));
      lines.push(`  S6 예산 초과(한도 +${S6_BUDGET_BYTES} B): ${over.length}장, 최대 +${max} B — ${over.slice(0, 5).map((o) => `${o.page} +${o.bytes}`).join(", ")}${over.length > 5 ? " …" : ""}`);
    }
    if (other.length > 0) lines.push(`  등록되지 않은 하드 실패 id: ${other.slice(0, 5).join(", ")}${other.length > 5 ? " …" : ""} — 예외로 덮지 말고 보고`);
    return { ok: false, lines };
  }
  const ex = [];
  const inline = [...groups.values()];
  if (inline.length === 1 && inline[0].pages.length > 1) {
    ex.push({ page: "*", check: "inline-script", missing: inline[0].missing, added: inline[0].added, reason: fill(reasons["inline-script"], 0), confirmedBy });
  } else {
    for (const g of inline) for (const p of g.pages) ex.push({ page: p, check: "inline-script", missing: g.missing, added: g.added, reason: fill(reasons["inline-script"], 0), confirmedBy });
  }
  return { ok: true, exceptions: [...ex, ...s6] };
}

function main(argv) {
  const pos = [];
  const opt = { pattern: "P1", refs: "", patterns: DEFAULT_PATTERNS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--pattern") opt.pattern = argv[++i];
    else if (argv[i] === "--refs") opt.refs = argv[++i] ?? "";
    else if (argv[i] === "--patterns") opt.patterns = argv[++i];
    else pos.push(argv[i]);
  }
  const [goldPath, url, out] = pos;
  if (!goldPath || !url || !out || pos.length !== 3 || !opt.pattern) {
    console.error('사용법: node scripts/dev/golden-expect.mjs <gold.json> <판정댓글URL> <out.json> [--pattern P1] [--refs "#410·#413"] [--patterns <patterns.md>]');
    process.exit(2);
  }
  let r;
  try {
    const reasons = readReasons(readFileSync(opt.patterns, "utf8"), opt.pattern);
    r = buildExceptions(JSON.parse(readFileSync(goldPath, "utf8")), { url, reasons, refs: opt.refs });
  } catch (e) {
    console.error(`golden-expect 실패: ${e.message}`);
    process.exit(2);
  }
  if (!r.ok) {
    for (const l of r.lines) console.error(l);
    process.exit(2);
  }
  writeFileSync(out, `${JSON.stringify({ exceptions: r.exceptions }, null, 1)}\n`);
  console.log(`예외 ${r.exceptions.length}줄 → ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main(process.argv.slice(2));
