#!/usr/bin/env node
// 렌더 기반 검사(#274): 구운 폴더 둘을 헤드리스 Chrome으로 열어 CSS가 숨긴 글자·좁은 폭 가로 넘침·첫 초점을 견준다.
// invariants(DOM)가 못 보는 쪽이다. 하드 실패가 없으면 종료 0, 있으면 1. Chrome이 없으면 종료 2.
//   node bin/rendered.mjs <기준 폴더> <후보 폴더> [--pages a.html,b.html] [--widths 320,375,1280] [--max-items N] [--json <파일>]
// 두 폴더는 invariants와 같이 **같은 입력·같은 BUILD_NOW로 구운 것**이어야 한다(bin/render.mjs --out으로 만든다).
// 의존 없음: 이 머신의 Chrome(CHROME_PATH로 지정 가능)과 Node 내장 WebSocket(Node 22 이상).
import { writeFile } from "node:fs/promises";
import { launchChrome } from "../lib/chrome.mjs";
import { compareRendered, DEFAULT_WIDTHS, formatRenderedReport } from "../lib/rendered.mjs";

const argv = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
  else rest.push(argv[i]);
}
const [a, b] = rest;
if (!a || !b) {
  console.error("사용: node bin/rendered.mjs <기준 폴더> <후보 폴더> [--pages a.html,b.html] [--widths 320,375,1280] [--max-items N] [--json <파일>]");
  process.exit(2);
}
let chrome;
try {
  chrome = await launchChrome();
  const result = await compareRendered(a, b, {
    chrome,
    pages: opt.pages ? opt.pages.split(",").filter(Boolean) : null,
    widths: opt.widths ? opt.widths.split(",").map(Number) : DEFAULT_WIDTHS,
  });
  console.log(formatRenderedReport(result, { maxItems: Number(opt["max-items"] ?? 8) }));
  if (opt.json) await writeFile(opt.json, JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
} catch (e) {
  console.error(e.stack ?? e.message);
  process.exitCode = 2;
} finally {
  await chrome?.close();
}
