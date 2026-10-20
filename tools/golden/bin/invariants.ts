#!/usr/bin/env node
// 불변 조건 비교(#274): 디자인이 바뀌어도 변하면 안 되는 것만 견준다. 하드 실패가 없으면 종료 0, 있으면 1(소프트는 목록만 낸다).
// 쓰는 법이 틀렸거나(예외 목록의 형식이 틀린 것 포함) 렌더가 실패하면 2, 디스크 여유가 모자라면 3.
//
//   node bin/invariants.ts --render --repo <저장소> [--base <SHA>] [--head <SHA>|--src <디렉터리>] [--build-now <ISO>]
//        기준(merge-base)과 후보를 **같은 BUILD_NOW로 렌더해** 견준다. PR 증빙은 이 모양으로 낸다.
//          --base       기본: `git merge-base origin/main HEAD`
//          --head/--src 기본: --src <저장소>(미커밋 변경을 포함한 작업 트리 스냅숏)
//          --build-now  기본: 기준 커밋의 커밋 시각
//        훅 클래스는 목록 파일에 **후보 소스에서 다시 뽑은 것**을 더해 쓰고(목록이 낡아도 판정이 새지 않게), 목록이 후보 소스와
//        어긋난 것(hook-list)과 기준 소스에서는 훅이었는데 후보에서 빠진 이름(hook-list-dropped)을 보고에 소프트로 같이 낸다.
//   node bin/invariants.ts <기준> <후보>
//        이미 구운 폴더(또는 --snapshot이 낸 JSON) 둘을 견준다. 둘이 같은 입력·같은 BUILD_NOW로 구운 것인지는 부르는 쪽 책임이다 —
//        다른 날 데이터로 구운 폴더끼리 견주면 데이터 때문에 텍스트가 갈린다(#8 부류).
//   node bin/invariants.ts --snapshot <폴더> [--out <파일>] [--table]
//        폴더의 불변 사실을 JSON으로 뜬다(--table이면 장별 표). 지문(sha256)을 stderr에 적는다.
//   node bin/invariants.ts --hooks-check --repo <저장소>     훅 클래스 목록(hook-classes.json)이 소스와 맞는지 본다(어긋나면 1).
//   node bin/invariants.ts --hooks-write --repo <저장소>     소스에서 다시 뽑아 목록 파일을 쓴다. 소스가 는 경우에만 쓴다 —
//        줄어서 어긋났으면 다시 만들지 말고 왜 줄었는지부터 본다(test/HOOKCOUNT 하한이 줄어든 채 굳는 것을 막는다).
//
//   비교 공통
//     --expect <파일>   의도한 차이(예외 목록 JSON). 모양은 README "의도한 차이". 목록에 글자 그대로 있는 항목만 하드에서 빠진다.
//     --json <파일>     결과 전체를 JSON으로 쓴다(예외 목록에 옮겨 적을 항목 문자열이 잘리지 않고 들어 있다).
//     --hooks a,b       목록 파일·후보 JS에서 못 뽑은 훅 클래스를 보탠다.
//     --max-items N     보고서에 항목당 보일 줄 수(기본 8).
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DiskSpaceError, installSignalHandlers, isTerminating } from "../lib/cleanup.ts";
import {
  applyExceptions,
  collectHookClasses,
  compareSnapshots,
  formatHookList,
  formatInvariantsReport,
  formatSnapshotTable,
  HOOK_LIST_FILE,
  hookListDrift,
  hookListFindings,
  loadSnapshot,
  readHookList,
  snapshotDir,
  snapshotHash,
  withSiteFindings,
} from "../lib/invariants.ts";
import { preparePristine, renderIsolated } from "../lib/render.ts";

const USAGE = `사용:
  node bin/invariants.ts --render --repo <저장소> [--base <SHA>] [--head <SHA>|--src <디렉터리>] [--build-now <ISO>]
  node bin/invariants.ts <기준 폴더|스냅숏.json> <후보 폴더|스냅숏.json>
  node bin/invariants.ts --snapshot <폴더> [--out <파일>] [--table]
  node bin/invariants.ts --hooks-check|--hooks-write --repo <저장소>
  비교 공통: [--expect <예외 목록.json>] [--json <파일>] [--hooks a,b] [--max-items N]`;

const FLAGS = new Set(["render", "table", "hooks-check", "hooks-write"]);
const argv = process.argv.slice(2);
const opt = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (k.startsWith("--") && FLAGS.has(k.slice(2))) opt[k.slice(2)] = true;
  else if (k.startsWith("--")) opt[k.slice(2)] = argv[++i];
  else rest.push(k);
}
const usage = () => {
  console.error(USAGE);
  process.exit(2);
};

/** 쓰는 법이 틀린 것(종료 2, 스택 없이 한 줄). */
class UsageError extends Error {}

/** site는 폴더 단위로 보탤 항목(훅 목록 상태), hooks는 목록 파일 밖에서 보탤 훅 클래스다. */
async function report(snapA, snapB, { site = [], hooks = [] } = {}) {
  let result = compareSnapshots(snapA, snapB, { hookList: (await readHookList()).all, extraHooks: [...hooks, ...(opt.hooks ? opt.hooks.split(",").filter(Boolean) : [])] });
  if (site.length) result = withSiteFindings(result, site);
  if (opt.expect) {
    // 형식이 틀린 예외 목록(JSON이 아니다, reason·confirmedBy가 없다, check를 통째로 면제한다)은 사용법 오류다.
    try {
      const list = JSON.parse(await readFile(opt.expect, "utf8"));
      const exceptions = list.exceptions ?? list;
      if (!Array.isArray(exceptions)) throw new Error("exceptions가 배열이 아닙니다");
      result = applyExceptions(result, exceptions);
    } catch (e) {
      throw new UsageError(`예외 목록(--expect ${opt.expect})을 받을 수 없습니다: ${e.message}`);
    }
  }
  console.log(formatInvariantsReport(result, { maxItems: Number(opt["max-items"] ?? 8) }));
  if (opt.json) await writeFile(opt.json, `${JSON.stringify(result, null, 1)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

if (opt["hooks-check"] || opt["hooks-write"]) {
  if (!opt.repo) usage();
  const collected = await collectHookClasses(path.resolve(opt.repo));
  if (opt["hooks-write"]) {
    await writeFile(HOOK_LIST_FILE, formatHookList(collected));
    console.log(`훅 클래스 목록을 썼습니다: js ${collected.js.length}개, markup ${collected.markup.length}개 → ${HOOK_LIST_FILE}`);
  } else {
    const drift = hookListDrift(await readHookList(), collected);
    console.log(drift.ok ? `훅 클래스 목록이 소스와 맞습니다(js ${collected.js.length}개, markup ${collected.markup.length}개).` : `훅 클래스 목록이 소스와 어긋났습니다 — 소스가 는 경우에만 --hooks-write. 줄어서 어긋났으면 다시 만들지 말고 왜 줄었는지부터 보세요.\n  소스에만: ${drift.missing.join(", ") || "없음"}\n  목록에만: ${drift.stale.join(", ") || "없음"}`);
    process.exitCode = drift.ok ? 0 : 1;
  }
} else if (opt.snapshot) {
  const snap = await snapshotDir(opt.snapshot, { label: opt.snapshot });
  const text = opt.table ? `${formatSnapshotTable(snap)}\n` : `${JSON.stringify(snap)}\n`;
  if (opt.out) await writeFile(opt.out, text);
  else process.stdout.write(text);
  console.error(`스냅숏 ${Object.keys(snap.pages).length}장, sha256 ${snapshotHash(snap)}`);
} else if (opt.render) {
  if (!opt.repo) usage();
  const repo = path.resolve(opt.repo);
  const git = (...a) => {
    const r = spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")} 실패: ${r.stderr}`);
    return r.stdout.trim();
  };
  installSignalHandlers();
  const made = [];
  try {
    const base = git("rev-parse", opt.base ?? git("merge-base", "origin/main", "HEAD"));
    const buildNow = opt["build-now"] ?? new Date(git("show", "-s", "--format=%cI", base)).toISOString();
    const env = { BUILD_NOW: buildNow };
    const basePristine = await preparePristine({ repo, sha: base });
    made.push(basePristine);
    const headPristine = await preparePristine(opt.head ? { repo, sha: opt.head } : { repo, srcDir: opt.src ?? repo });
    made.push(headPristine);
    const a = await renderIsolated(basePristine, { env });
    made.push(a);
    const b = await renderIsolated(headPristine, { env });
    made.push(b);
    console.log(`같은 입력으로 렌더: 기준 ${basePristine.label} / 후보 ${headPristine.label} / BUILD_NOW=${buildNow}`);
    // 훅 목록: 후보 소스에서 다시 뽑아 판정에 더하고, 목록 파일과의 어긋남·기준 대비 빠진 이름을 보고에 같이 낸다(#289 5번).
    const [baseHooks, headHooks] = [await collectHookClasses(basePristine.dir), await collectHookClasses(headPristine.dir)];
    const site = hookListFindings({ list: await readHookList(), base: baseHooks, head: headHooks });
    console.log(`훅 클래스 목록 대 후보 소스: ${site.some((f) => f.id === "hook-list") ? "어긋남(아래 hook-list)" : "맞음"} / 기준 소스에서 빠진 훅: ${site.find((f) => f.id === "hook-list-dropped")?.missing.length ?? 0}개`);
    await report(await snapshotDir(a.docsDir, { label: `기준 ${basePristine.label}` }), await snapshotDir(b.docsDir, { label: `후보 ${headPristine.label}` }), { site, hooks: [...headHooks.js, ...headHooks.markup] });
  } catch (e) {
    if (!isTerminating()) {
      console.error(e instanceof DiskSpaceError || e instanceof UsageError ? e.message : e.stack ?? e.message);
      process.exitCode = e instanceof DiskSpaceError ? 3 : 2;
    }
  } finally {
    // 렌더 사본과 --src 스냅숏을 지운다(SHA 캐시는 남는다 — 개수 상한이 정리, #263).
    for (const m of made.reverse()) await m.dispose();
  }
} else {
  const [a, b] = rest;
  if (!a || !b) usage();
  try {
    await report(await loadSnapshot(a), await loadSnapshot(b));
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(e.message);
    process.exitCode = 2;
  }
}
