// 두 디렉터리(또는 두 HTML)를 정준 덤프로 견준다. S1·S2의 측정 수단이다.
// 쓰는 쪽: bin/compare.mjs, test/, 그리고 나중에 #238의 shadow 단계·#244의 합격 측정.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { canonLines } from "./canon.mjs";

/** dir 아래의 파일을 상대 경로(/ 구분, 정렬)로 센다. pick이 false를 주면 뺀다. */
export async function listFiles(dir, pick = () => true) {
  const out = [];
  async function walk(rel) {
    for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && pick(next)) out.push(next);
    }
  }
  await walk("");
  return out.sort();
}

const isHtml = (f) => f.endsWith(".html");

/**
 * 줄 배열 둘의 차이를 hunk 목록으로 낸다. 앞뒤 공통부를 걷고, 가운데는 LCS로 맞춘다.
 * 가운데가 너무 크면(곱 4e6 초과) 정렬을 포기하고 통째로 하나의 hunk로 낸다.
 */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > 4e6) {
    return [{ aStart: start, bStart: start, removed: midA, added: midB, aligned: false }];
  }
  // LCS 표(뒤에서부터)
  const n = midA.length;
  const m = midB.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  let cur = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) {
      cur ??= { aStart: start + i, bStart: start + j, removed: [], added: [], aligned: true };
      cur.added.push(midB[j++]);
    } else {
      cur ??= { aStart: start + i, bStart: start + j, removed: [], added: [], aligned: true };
      cur.removed.push(midA[i++]);
    }
  }
  flush();
  return hunks;
}

/**
 * HTML 문자열 둘을 정준 덤프로 견준다. 같으면 빈 배열.
 * opts는 canonLines로 그대로 간다 — { ignoreDesignAttrs: true }면 class·style만 뺀 내용 비교다(#277).
 */
export function diffHtml(htmlA, htmlB, opts) {
  const a = canonLines(htmlA, opts);
  const b = canonLines(htmlB, opts);
  return diffLines(a, b).map((h) => ({ ...h, context: a.slice(Math.max(0, h.aStart - 2), h.aStart) }));
}

/**
 * 두 디렉터리의 .html을 쌍으로 견준다(상대 경로가 같은 것끼리). opts는 diffHtml로 그대로 간다(#277).
 * 반환: { total, equal, pages:[{file,status,hunks}], onlyA:[], onlyB:[] }. status는 equal | diff | onlyA | onlyB.
 */
export async function compareDirs(dirA, dirB, opts) {
  const [filesA, filesB] = await Promise.all([listFiles(dirA, isHtml), listFiles(dirB, isHtml)]);
  const setA = new Set(filesA);
  const setB = new Set(filesB);
  const all = [...new Set([...filesA, ...filesB])].sort();
  const pages = [];
  for (const file of all) {
    if (!setB.has(file)) pages.push({ file, status: "onlyA", hunks: [] });
    else if (!setA.has(file)) pages.push({ file, status: "onlyB", hunks: [] });
    else {
      const [a, b] = await Promise.all([readFile(path.join(dirA, file), "utf8"), readFile(path.join(dirB, file), "utf8")]);
      const hunks = a === b ? [] : diffHtml(a, b, opts);
      pages.push({ file, status: hunks.length ? "diff" : "equal", hunks });
    }
  }
  const equal = pages.filter((p) => p.status === "equal").length;
  return {
    total: pages.length,
    equal,
    failing: pages.filter((p) => p.status !== "equal"),
    pages,
  };
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** 모든 파일(확장자 무관)을 바이트로 견준다. "미설정이면 바이트 동일"을 보이는 데 쓴다. */
export async function compareBytes(dirA, dirB) {
  const [filesA, filesB] = await Promise.all([listFiles(dirA), listFiles(dirB)]);
  const setB = new Set(filesB);
  const setA = new Set(filesA);
  const diffs = [];
  let same = 0;
  for (const file of [...new Set([...filesA, ...filesB])].sort()) {
    if (!setB.has(file)) diffs.push({ file, status: "onlyA" });
    else if (!setA.has(file)) diffs.push({ file, status: "onlyB" });
    else {
      const [a, b] = await Promise.all([readFile(path.join(dirA, file)), readFile(path.join(dirB, file))]);
      if (sha256(a) === sha256(b)) same++;
      else diffs.push({ file, status: "diff" });
    }
  }
  return { total: same + diffs.length, same, diffs };
}

/** 디렉터리 전체의 지문(경로와 내용 해시를 묶은 해시). 렌더 전후로 저장소 docs/가 안 바뀌었는지 보는 데 쓴다. */
export async function treeHash(dir, pick = () => true) {
  const h = createHash("sha256");
  for (const file of await listFiles(dir, pick)) {
    h.update(file);
    h.update("\0");
    h.update(sha256(await readFile(path.join(dir, file))));
    h.update("\n");
  }
  return h.digest("hex");
}

const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n)}…(${s.length}자)` : s);

/** 사람이 읽는 보고. 페이지마다 hunk를 최대 maxHunks개, hunk마다 줄을 최대 maxLines개 보인다. */
export function formatReport(result, { maxHunks = 3, maxLines = 6 } = {}) {
  const lines = [`정준 비교: ${result.equal}/${result.total}장 일치, 불일치 ${result.failing.length}장`];
  for (const p of result.failing) {
    lines.push(`- ${p.file}: ${p.status}`);
    for (const h of p.hunks.slice(0, maxHunks)) {
      lines.push(`    @@ A 줄 ${h.aStart + 1} / B 줄 ${h.bStart + 1}${h.aligned ? "" : " (정렬 생략)"}`);
      for (const c of h.context) lines.push(`      ${clip(c)}`);
      for (const r of h.removed.slice(0, maxLines)) lines.push(`    - ${clip(r)}`);
      if (h.removed.length > maxLines) lines.push(`    - …외 ${h.removed.length - maxLines}줄`);
      for (const r of h.added.slice(0, maxLines)) lines.push(`    + ${clip(r)}`);
      if (h.added.length > maxLines) lines.push(`    + …외 ${h.added.length - maxLines}줄`);
    }
    if (p.hunks.length > maxHunks) lines.push(`    …hunk ${p.hunks.length - maxHunks}개 더`);
  }
  return lines.join("\n");
}
