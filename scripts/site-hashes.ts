// 사이트 산출물의 파일별 해시 목록과 두 산출물의 대조 (#509, 구조 B-3).
//
// B3 시절 deploy.yml(병행 가동)이 매 실행에서 불렀다: main HEAD 의 커밋된 docs/(= 기존 배포가 올리는 산출물)와, 같은 HEAD 에서 render-pipeline 이
// build/site 로 새로 만든 산출물을 파일별 sha256 으로 맞댔다. 두 번의 자연 full 틱에서 연속으로 일치하면 B3 합격선이었다.
// (#510, B4 컷오버) deploy.yml 은 더 이상 이 도구를 안 부른다 - main 의 docs/ 에서 생성 HTML 53장이 빠져 "커밋된 docs/ 와 build/site" 대조가 성립하지 않는다.
// 손 도구로 남는다: 같은 SHA 의 두 산출(예: 재렌더, 롤백 전후의 build/site)을 파일별로 맞대는 데 쓴다. 배포본끼리의 전후 대조는 scripts/site-snapshot.ts 다.
//
//   node scripts/site-hashes.ts manifest <디렉터리|목록파일>
//   node scripts/site-hashes.ts compare <A> <B> [--out-dir=<디렉터리>]
//
// - 목록 한 줄은 `<sha256 hex>  <상대 경로>`(sha256sum 과 같은 모양), 경로 글자순. 디렉터리는 하위 파일 전부, 구분자는 `/` 다.
// - `compare` 의 A·B 는 디렉터리거나 위 목록 파일이다 - 실행마다 올라간 목록(artifact)끼리 내려받아 재실행 결과를 맞대는 데도 같은 명령을 쓴다.
// - 일치면 종료 0, 어긋나면 1(어긋난 파일을 종류별로 적는다), 사용법 오류는 2.
// - `--out-dir` 을 주면 그 디렉터리에 a.txt·b.txt(각 목록)와 report.txt 를 쓴다. `$GITHUB_STEP_SUMMARY` 가 있으면 요약도 거기에 덧붙인다.
// - 일반 파일과 디렉터리만 센다. 심볼릭 링크 등이 있으면 조용히 건너뛰지 않고 던진다(해시에서 빠진 파일이 일치로 보이지 않게).
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Manifest = Map<string, string>;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const byPath = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0); // readdir 순서는 파일시스템마다 다르고 localeCompare 는 ICU 에 기댄다

/** 디렉터리 아래 모든 파일의 상대 경로 -> sha256. 경로 글자순. */
export function hashTree(dir: string): Manifest {
  const out: Manifest = new Map();
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(path.relative(dir, p).split(path.sep).join("/"), sha256(readFileSync(p)));
      else throw new Error(`일반 파일도 디렉터리도 아닌 항목이 있다(해시에서 빠진다): ${p}`);
    }
  };
  walk(dir);
  return new Map([...out].sort(byPath));
}

/** 목록 텍스트 한 덩어리. 줄은 `<sha256>  <경로>`, 끝 줄바꿈 포함(비면 빈 문자열). */
export function formatManifest(m: Manifest): string {
  return [...m].map(([p, h]) => `${h}  ${p}\n`).join("");
}

/** 목록 텍스트를 읽는다. 모양이 틀린 줄이나 같은 경로 중복은 던진다. */
export function parseManifest(text: string): Manifest {
  const out: Manifest = new Map();
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "") continue;
    const m = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
    if (!m) throw new Error(`목록 ${i + 1}행을 읽을 수 없다: ${line.slice(0, 80)}`);
    if (out.has(m[2])) throw new Error(`목록에 같은 경로가 둘이다: ${m[2]}`);
    out.set(m[2], m[1]);
  }
  return new Map([...out].sort(byPath));
}

/** 목록 전체의 해시(틱 사이를 한 줄로 맞대려는 값). 경로·해시 하나라도 다르면 달라진다. */
export const treeHash = (m: Manifest): string => sha256(formatManifest(m));

export type Diff = { onlyA: string[]; onlyB: string[]; differs: string[] };

export function diffManifests(a: Manifest, b: Manifest): Diff {
  const onlyA = [...a.keys()].filter((p) => !b.has(p));
  const onlyB = [...b.keys()].filter((p) => !a.has(p));
  const differs = [...a.keys()].filter((p) => b.has(p) && a.get(p) !== b.get(p));
  return { onlyA, onlyB, differs };
}

export const isSame = (d: Diff): boolean => d.onlyA.length + d.onlyB.length + d.differs.length === 0;

/** 디렉터리면 해시를 내고, 파일이면 목록으로 읽는다. */
export function load(target: string): Manifest {
  return statSync(target).isDirectory() ? hashTree(target) : parseManifest(readFileSync(target, "utf8"));
}

/** 어긋남 보고서. 종류마다 앞 SHOW 개까지만 적는다(전부 어긋나는 날 로그가 수백 줄이 되지 않게) - 개수는 전부 적는다. */
export function report(labelA: string, a: Manifest, labelB: string, b: Manifest, d: Diff, show = 40): string {
  const lines = [
    `A ${labelA}: 파일 ${a.size}개, 목록 해시 ${treeHash(a)}`,
    `B ${labelB}: 파일 ${b.size}개, 목록 해시 ${treeHash(b)}`,
    isSame(d) ? "결과: 일치(파일 집합과 파일별 sha256 이 같다)" : `결과: 어긋남(A 에만 ${d.onlyA.length} · B 에만 ${d.onlyB.length} · 내용 다름 ${d.differs.length})`,
  ];
  for (const [title, list] of [["A 에만 있다", d.onlyA], ["B 에만 있다", d.onlyB], ["내용이 다르다", d.differs]] as const) {
    if (list.length === 0) continue;
    lines.push(`${title}(${list.length}):`, ...list.slice(0, show).map((p) => `  ${p}`));
    if (list.length > show) lines.push(`  ... 그 밖에 ${list.length - show}개`);
  }
  return `${lines.join("\n")}\n`;
}

/** CLI 본체. 종료 코드를 돌려준다(시험이 프로세스 없이 부를 수 있게). */
export function main(argv: string[], env: Record<string, string | undefined> = process.env, out: (s: string) => void = (s) => process.stdout.write(s)): number {
  const [cmd, ...rest] = argv;
  const flags = rest.filter((x) => x.startsWith("--"));
  const args = rest.filter((x) => !x.startsWith("--"));
  const outDir = flags.find((f) => f.startsWith("--out-dir="))?.slice("--out-dir=".length);
  const unknown = flags.filter((f) => !f.startsWith("--out-dir="));
  if (unknown.length) {
    console.error(`알 수 없는 옵션: ${unknown.join(" ")}`);
    return 2;
  }
  if (cmd === "manifest" && args.length === 1 && !outDir) {
    out(formatManifest(load(args[0])));
    return 0;
  }
  if (cmd === "compare" && args.length === 2) {
    const a = load(args[0]);
    const b = load(args[1]);
    const d = diffManifests(a, b);
    const text = report(args[0], a, args[1], b, d);
    out(text);
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(path.join(outDir, "a.txt"), formatManifest(a));
      writeFileSync(path.join(outDir, "b.txt"), formatManifest(b));
      writeFileSync(path.join(outDir, "report.txt"), text);
    }
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### 사이트 산출 해시 대조\n\n\`\`\`\n${text}\`\`\`\n`);
    return isSame(d) ? 0 : 1;
  }
  console.error("사용법: node scripts/site-hashes.ts manifest <디렉터리|목록> | compare <A> <B> [--out-dir=<디렉터리>]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`[site-hashes] ${(err as Error).message}`);
    process.exitCode = 2;
  }
}
