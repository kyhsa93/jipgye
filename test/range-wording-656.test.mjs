// 지난 거래의 폭을 가리키는 말 (#656 V9 판정): 예산대 열여덟 장의 단지 후보 줄과 method.html 이 「기준 시세」·바닥 「가운데 절반」 대신
// 「지난 거래 가운데 절반」·「지난 거래 최저~최고(고침)」을 쓰고, 「다음 거래가 들어올 범위가 아니다」를 말한다. 계산(complex-price.ts)과 숫자는 그대로다.
// 나가는 사이트(build/site)를 읽는 시험이라 배포 게이트에 든다(site-root 헬퍼).
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { SITE_DIR, sitePath } from "./helpers/site-root.mjs";

const budgetFiles = readdirSync(SITE_DIR).filter((f) => /^budget-\d+eok\.html$/.test(f)).sort();
const read = (f) => readFileSync(sitePath(f), "utf8");

test("예산대 장이 열여덟 장이다", () => {
  assert.equal(budgetFiles.length, 18);
});

test("예산대 단지 후보 줄: 새 라벨만 쓰고 옛 라벨(기준 시세·바닥 가운데 절반·바닥 최저~최고)은 없다", () => {
  let lines = 0;
  for (const f of budgetFiles) {
    const html = read(f);
    assert.doesNotMatch(html, /기준 시세/, `${f}: 「기준 시세」`);
    for (const m of html.matchAll(/<span class=["']meta["']>([^<]*)<\/span>/g)) {
      if (!/ · \d+건$/.test(m[1])) continue;
      lines += 1;
      assert.match(m[1], /^지난 거래 (가운데 절반|최저~최고\(고침\)) [^~]+~[^·]+ · \d+건$/, `${f}: ${m[1]}`);
    }
    const bare = html.replace(/지난 거래 가운데 절반/g, "").replace(/지난 거래 최저~최고\(고침\)/g, "");
    assert.doesNotMatch(bare, /가운데 절반|최저~최고/, `${f}: 옛 라벨이 남았다`);
  }
  assert.ok(lines > 0, "후보 줄이 하나도 없다 - 시험이 빈손이다");
});

test("method.html: 중앙값 치우침·지난 거래 폭 문단(ko)과 같은 뜻의 en 문단, 옛 말은 없다", () => {
  const html = read("method.html");
  assert.ok(html.includes("이렇게 고친 <strong>중앙값</strong>이 한쪽으로 치우쳤는지는 이미 지난 거래로 쟀습니다."));
  assert.ok(!html.includes("이렇게 고친 범위가 맞는지는"));
  assert.ok(html.includes("5건 이상이면 지난 거래 가운데 절반(사분위), 3~4건이면 지난 거래 최저~최고(고침)를 적습니다."));
  assert.ok(html.includes("이 폭은 지난 거래가 퍼진 모양이지 다음 거래가 들어올 범위가 아닙니다. 거래 5건의 가운데 절반은 시장이 그대로여도 다음 거래를 셋에 하나꼴로만 담고(건수가 많을수록 절반에 가까워짐), 값이 오르는 동안에는 다음 거래가 폭 위에 놓이기 쉽습니다."));
  assert.ok(html.includes("이 폭이 다음 거래를 실제로 얼마나 담았는지는 2026-11 부터 매달 얼려 두었다가, 2027-01 부터 채점해 서울 단위로 싣습니다."));
  assert.ok(html.includes("How much of the next deals this spread actually caught is frozen monthly from 2026-11 and scored from 2027-01, reported at Seoul level."));
  assert.ok(html.includes("Whether the adjusted <strong>median</strong> leans one way was checked on deals already done:"));
  assert.ok(!html.includes("The adjustment was checked on deals already done"));
  assert.ok(html.includes("Five or more deals give the middle half of past deals (quartiles), three or four give past deals low&ndash;high (adjusted),"));
  assert.ok(html.includes("This is how past deals spread, not where the next deal will land. The middle half of five deals catches the next one only about one time in three even in a flat market (closer to half with more deals), and in a rising market the next deal tends to land above it."));
  assert.doesNotMatch(html, /기준 시세/);
  // 바닥 「가운데 절반」(앞에 지난 거래의·거래 5건의 가 없는 것)·「middle half」(of past/five deals 가 없는 것)은 남지 않는다.
  assert.doesNotMatch(html.replace(/지난 거래 가운데 절반|거래 5건의 가운데 절반/g, ""), /가운데 절반/);
  assert.doesNotMatch(html.replace(/middle half of (past|five) deals/g, ""), /middle half/);
});

test("실측 숫자는 그대로: method 의 검증 숫자는 한 글자도 안 바뀌었다", () => {
  const html = read("method.html");
  for (const kept of ["서울 전체로 +0.3%", "자치구별로 &minus;2.2%~+1.9%", "범위를 낼 수 있는 거래 73.2%", "+0.4% across Seoul", "&minus;1.9% to +1.8% by district"]) {
    assert.ok(html.includes(kept), kept);
  }
});
