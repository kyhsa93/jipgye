// 정리 시험(#263)이 쓰는 고정 가짜 저장소. 실제 docs/·raw/는 읽지 않는다 — 렌더 단계 스크립트 몇 줄과 작은 HTML뿐이다.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FILES = {
  "scripts/step1.mjs": `import { readFile, writeFile } from "node:fs/promises";
const f = new URL("../docs/a.html", import.meta.url);
const n = Number((await readFile(f, "utf8")).match(/count=(\\d+)/)[1]);
await writeFile(f, \`<p>count=\${n + 1}</p>\`);
`,
  // 시작을 알리고 오래 기다린다 — 신호 시험이 "렌더 도중"을 만드는 데 쓴다.
  "scripts/sleep.mjs": `import { writeFile } from "node:fs/promises";
await writeFile(new URL("../docs/started", import.meta.url), "1");
await new Promise((r) => setTimeout(r, 60000));
`,
  "scripts/boom.mjs": 'throw new Error("펑");\n',
  "docs/a.html": "<p>count=0</p>",
};

export const git = (dir, ...a) => spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });

/** 가짜 저장소 하나. 커밋을 더하려면 commit(repo, "msg")로 파일을 바꾼 새 SHA를 만든다. */
export async function fakeRepo(root = os.tmpdir()) {
  const dir = await mkdtemp(path.join(root, "golden-fake-"));
  for (const [rel, text] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export async function commit(dir, n) {
  await writeFile(path.join(dir, "docs/a.html"), `<p>count=${n}</p>`);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", `c${n}`);
  return git(dir, "rev-parse", "HEAD").stdout.trim();
}
