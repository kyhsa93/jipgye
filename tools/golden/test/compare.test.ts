import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBytes, compareDirs, diffLines, formatReport, treeHash } from "../lib/compare.ts";

const page = (body) => `<!doctype html><html><head><title>t</title></head><body>${body}</body></html>`;

async function dirWith(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "golden-cmp-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

test("diffLines: 같으면 빈 배열, 다르면 바뀐 자리만", () => {
  assert.deepEqual(diffLines(["a", "b"], ["a", "b"]), []);
  const h = diffLines(["a", "b", "c", "d"], ["a", "B", "c", "d", "e"]);
  assert.equal(h.length, 2);
  assert.deepEqual([h[0].removed, h[0].added], [["b"], ["B"]]);
  assert.deepEqual([h[1].removed, h[1].added], [[], ["e"]]);
});

test("compareDirs: 쌍 일치·불일치·한쪽에만 있는 장을 센다", async () => {
  const a = await dirWith({ "x.html": page("<p>1</p>"), "y.html": page("<p>2</p>"), "sub/z.html": page("<p>3</p>"), "only-a.html": page("a"), "data/a.json": "{}" });
  const b = await dirWith({ "x.html": page("<!--c--><p>1</p>"), "y.html": page("<p>2x</p>"), "sub/z.html": page("<p>3</p>"), "only-b.html": page("b"), "data/a.json": "{ }" });
  try {
    const r = await compareDirs(a, b);
    assert.equal(r.total, 5, "json은 세지 않는다");
    assert.equal(r.equal, 2, "주석만 다른 x와 같은 z");
    assert.deepEqual(r.failing.map((p) => `${p.file}:${p.status}`), ["only-a.html:onlyA", "only-b.html:onlyB", "y.html:diff"]);
    const text = formatReport(r);
    assert.match(text, /2\/5장 일치, 불일치 3장/);
    assert.match(text, /- y\.html: diff/);
    assert.match(text, /\+ +"2x"/);
  } finally {
    await Promise.all([rm(a, { recursive: true }), rm(b, { recursive: true })]);
  }
});

test("compareBytes·treeHash: 모든 파일을 바이트로 견준다(주석만 달라도 다르다)", async () => {
  const a = await dirWith({ "x.html": page("<p>1</p>"), "d.json": "{}" });
  const b = await dirWith({ "x.html": page("<!--c--><p>1</p>"), "d.json": "{}" });
  const c = await dirWith({ "x.html": page("<p>1</p>"), "d.json": "{}" });
  try {
    const ab = await compareBytes(a, b);
    assert.deepEqual(ab.diffs, [{ file: "x.html", status: "diff" }]);
    assert.equal(ab.same, 1);
    assert.equal((await compareBytes(a, c)).diffs.length, 0);
    assert.equal(await treeHash(a), await treeHash(c));
    assert.notEqual(await treeHash(a), await treeHash(b));
  } finally {
    await Promise.all([a, b, c].map((d) => rm(d, { recursive: true })));
  }
});
