// method.html 「고친 오류」(#159)가 링크하는 이슈·PR이 실제로 있고, 이슈는 닫혔고 PR은 병합됐는지
// gh로 확인하는 수동 점검. 네트워크가 필요해 npm test에 넣지 않는다(시험은 번호 목록의 구조만 본다).
//
//   node scripts/check-corrections-refs.mjs
//
// 번호 목록의 원본은 여기다. test/method-corrections.test.mjs가 화면의 링크와 이 목록이 같은지 대조한다.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLOSED_ISSUES = [6, 28, 29, 65, 183];
export const MERGED_PRS = [189];
// 싣지 않기로 한 것: #80(개인정보 건, 소유자 확인 선행), 이용허락·출처 건(공시가격·건축HUB)은 정정이 아니다.
export const EXCLUDED = [80];

const gh = (args) => JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const n of CLOSED_ISSUES) {
    const r = gh(["issue", "view", String(n), "--json", "number,state,title"]);
    const ok = r.state === "CLOSED";
    if (!ok) bad += 1;
    console.log(`${ok ? "ok " : "BAD"} issue #${n} ${r.state} ${r.title}`);
  }
  for (const n of MERGED_PRS) {
    const r = gh(["pr", "view", String(n), "--json", "number,state,title"]);
    const ok = r.state === "MERGED";
    if (!ok) bad += 1;
    console.log(`${ok ? "ok " : "BAD"} pr #${n} ${r.state} ${r.title}`);
  }
  process.exitCode = bad ? 1 : 0;
}
