// 집계 장에 광고 스크립트를 싣지 않는다는 결정의 배포 게이트 (#818). 로더 제거와 다른 커밋에 둔다 - 제거 커밋만 되돌리면 이 시험이 남아 실패한다.
// analytics.test.mjs 를 뒤집은 것만으로는 못 막는 길이 있다: 코드와 시험을 통째로 되돌리는 것, 빌드 HTML 에 script 를 직접 넣는 것.
// 그래서 소스가 아니라 나가는 사이트(build/site)를 훑는다. site-root.mjs 를 import 하므로 `npm run test:site` 대상이다(deploy.yml 게이트).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { SITE_DIR, sitePath } from "./helpers/site-root.mjs";

const REINSTATE =
  "다시 넣는 경우는 #597·#489 재검토 뒤에만이다. 단순 되돌리기 금지 - 소유자 확인, 광고 요청에 실리는 주소 값 처리, about·처리방침 문구 재대조를 함께 한다(#818).";

const files = readdirSync(SITE_DIR, { recursive: true })
  .map(String)
  .filter((f) => /\.(html|js)$/.test(f));
const htmlFiles = files.filter((f) => f.endsWith(".html"));
const read = (f) => readFileSync(sitePath(f), "utf8");

const SITE_ORIGIN = "https://kyhsa93.github.io";
const SITE_BASE = "/jipgye/";
const ANCHOR = /<a\b[^>]*>/gi;
const HREF = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const REL_NOREFERRER = /\srel\s*=\s*(?:"[^"]*\bnoreferrer\b[^"]*"|'[^']*\bnoreferrer\b[^']*')/i;

/** 장 안의 `<a>` 중 같은 출처인데 /jipgye/ 바깥으로 가는 것. 절대·프로토콜 생략·루트 상대·`../` 표기를 모두 잡는다. */
function outsideLinks(html, file) {
  const base = `${SITE_ORIGIN}${SITE_BASE}${file}`;
  const out = [];
  for (const [tag] of html.matchAll(ANCHOR)) {
    const m = HREF.exec(tag);
    if (!m) continue;
    let url;
    try {
      url = new URL(m[1] ?? m[2], base);
    } catch {
      continue;
    }
    if (url.origin === SITE_ORIGIN && !url.pathname.startsWith(SITE_BASE)) out.push(tag);
  }
  return out;
}

test("나가는 장·스크립트에 광고 로더가 없다 (#818)", () => {
  assert.ok(files.includes("index.html") && files.includes("analytics.js"), `훑을 파일을 못 찾았다: ${SITE_DIR}`);
  const bad = files.filter((f) => /pagead2|googlesyndication|adsbygoogle/.test(read(f)));
  assert.deepEqual(bad, [], `광고 로더가 들어왔다. ${REINSTATE}`);
});

test("같은 출처 바깥 경로로 가는 링크는 noreferrer 다 - 앞 장 주소를 넘기지 않는다 (#818)", () => {
  const bad = [];
  for (const f of htmlFiles) for (const tag of outsideLinks(read(f), f)) if (!REL_NOREFERRER.test(tag)) bad.push(`${f}: ${tag}`);
  assert.deepEqual(bad, [], `noreferrer 가 빠졌다. 광고 스크립트를 다시 넣는 일과 함께라면: ${REINSTATE}`);
  // 양성 대조: 링크 표기가 바뀌어 위 검사가 빈손으로 끝나는 것을 막는다. 장 수에는 묶지 않는다 - 종료 안내 5장은 삭제 예정이다(#581).
  for (const f of ["index.html", "about.html"]) assert.ok(outsideLinks(read(f), f).length >= 1, `${f}에서 방침 링크를 못 찾았다 - 이 시험이 허공을 친다`);
});

// 로더 제거로 줄어든 몫을 다른 코드에 쓰지 않는다. 늘리려면 이 수를 고치는 이유를 PR 에 적는다.
const ANALYTICS_MAX_BYTES = 4989;
test("analytics.js 크기 상한 - 병합본 크기로 고정 (#818)", () => {
  const size = readFileSync(sitePath("analytics.js")).length;
  assert.ok(size <= ANALYTICS_MAX_BYTES, `analytics.js ${size}B > 상한 ${ANALYTICS_MAX_BYTES}B. 로더가 돌아온 것이라면: ${REINSTATE}`);
});
