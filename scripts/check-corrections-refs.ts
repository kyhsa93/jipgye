// method.html 「고친 오류」(#159)가 링크하는 이슈·PR이 실제로 있고, 이슈는 닫혔고 PR은 병합됐는지
// gh로 확인하는 수동 점검. 네트워크가 필요해 npm test에 넣지 않는다(시험은 번호 목록의 구조만 본다).
//
//   node scripts/check-corrections-refs.ts
//
// 번호 목록의 원본은 여기다. test/method-corrections.test.mjs가 화면의 링크와 이 목록이 같은지 대조한다.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLOSED_ISSUES = [6, 28, 29, 65, 183, 229, 781, 821, 843];
// #862 는 3단계까지 열려 있어 CLOSED_ISSUES 에 넣을 수 없다 - 그 정정 항목들의 근거는 1단계 PR(#864)·2단계 PR(#885)이다. 화면 순서(최근 것부터)와 같다.
export const MERGED_PRS = [885, 864, 189];
// 싣지 않기로 한 것: #80(개인정보 건, 소유자 확인 선행), 이용허락·출처 건(공시가격·건축HUB)은 정정이 아니다.
export const EXCLUDED = [80];
// #913 날짜 규칙으로 내린 항목, 내용으로 싣지 않기로 한 EXCLUDED와 다르다. 원소는 { date: "YYYY-MM-DD", issues: [..], prs: [..] }, 내린 차례대로.
// 항목을 내릴 때 그 번호를 CLOSED_ISSUES·MERGED_PRS 에서 빼서 여기로 옮긴다(화면의 다른 항목이 같은 번호를 쓰면 남긴다).
// 서두가 「내린 항목의 근거 이슈와 PR은 저장소에 그대로 남습니다」라고 말하므로 아래 루프가 이 번호들도 닫힘·병합을 계속 확인한다(clo Q5).
export const RETIRED = [];

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
  for (const { issues, prs } of RETIRED) {
    for (const n of issues) {
      const r = gh(["issue", "view", String(n), "--json", "number,state,title"]);
      const ok = r.state === "CLOSED";
      if (!ok) bad += 1;
      console.log(`${ok ? "ok " : "BAD"} issue #${n} ${r.state} ${r.title}`);
    }
    for (const n of prs) {
      const r = gh(["pr", "view", String(n), "--json", "number,state,title"]);
      const ok = r.state === "MERGED";
      if (!ok) bad += 1;
      console.log(`${ok ? "ok " : "BAD"} pr #${n} ${r.state} ${r.title}`);
    }
  }
  process.exitCode = bad ? 1 : 0;
}
