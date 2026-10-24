/**
 * 배포본 스냅샷과 전후 대조 (#510, 구조 B-4 컷오버). 읽기 전용 - GET 만 한다.
 *
 * 컷오버의 합격선은 「병합 직후 사이트가 직전과 사용자 보이는 바이트 동일(sitemap·SW·404·검색 색인 포함, 병합 전 스냅샷과 diff 0)」이다. 그 직전·직후를 같은 방법으로 찍어 맞대는 도구다.
 * deploy-check.ts(#99)가 "배포본 = 이 저장소의 docs/" 를 보는 것과 달리, 이것은 "배포본 = 배포본" 이다 - 저장소 상태와 무관하게 두 시점의 라이브 사이트를 맞댄다.
 *
 *   node scripts/site-snapshot.ts capture --base=https://kyhsa93.github.io/jipgye/ --dir=docs --out=before.json
 *   (병합·배포 뒤)
 *   node scripts/site-snapshot.ts capture --base=https://kyhsa93.github.io/jipgye/ --like=before.json --out=after.json
 *   node scripts/site-snapshot.ts diff before.json after.json
 *
 * - 찍는 파일 목록: `--dir=<디렉터리>` 면 그 아래 모든 파일(병합 전에는 옛 레이아웃의 docs/ - HTML 67장·정적 자산·data 전부), `--like=<스냅샷>` 이면 그 스냅샷이 찍은 경로 그대로.
 *   병합 후에 `--dir=build/site`(같은 SHA 로 만든 산출) 대신 `--like` 를 권한다 - 두 시점이 같은 목록을 찍어야 "없어진 장"이 목록 차이에 가려지지 않는다.
 * - 각 경로는 GET 해서 상태 코드·바이트 수·SHA-256 을 적는다. 루트(`/`)와 index.html 둘 다 찍는다. 덧붙여 sitemap.xml·robots.txt·404.html 과, 있을 수 없는 경로(`__no_such_page__.html`)의
 *   응답(= Pages 의 404 본문)도 찍는다 - 이 저장소 docs/ 에는 sitemap·404 가 없어(#508) 상태 코드와 본문이 컷오버로 안 바뀌었음을 이 응답으로 본다.
 * - `diff` 는 파일 집합(없어진 것·새로 생긴 것)·상태 코드·바이트 차이를 종류별로 적는다. 종료 코드 0 = 차이 없음, 1 = 차이 있음, 2 = 사용법 오류.
 * - 요청 대상은 --base 와 같은 출처·경로 아래뿐이다(제3자 요청 금지). 리다이렉트는 따라가지 않는다(3xx 는 상태 이상으로 적힌다).
 *
 * 병합 전 스냅샷은 마지막 틱의 Daily·Summarize·Deploy 가 모두 끝나 busy=0 일 때 찍는다 - 아니면 "직전"이 이미 움직이는 중이다. 병합 후는 deploy.yml 의 Deploy site 가 성공한 뒤에 찍는다.
 * 같은 UTC 날짜 안이면 차이가 0 이다. 병합이 예산 장 창의 UTC 날짜를 넘겨 일어나면 method.html·budget-*.html 의 건수가 하루치 움직일 수 있다(BUILD_NOW = HEAD 커밋 시각) -
 * 차이가 그 파일들뿐이면 `diff` 가 그 사정을 한 줄로 알린다(원인 분류의 힌트일 뿐 합격 판정은 사람이 한다).
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_BASE = "https://kyhsa93.github.io/jipgye/";
/** 목록과 무관하게 항상 찍는 것. 사이트 맵·로봇·404 파일과, 있을 수 없는 경로(Pages 의 404 응답). */
export const EXTRA_PROBES = ["sitemap.xml", "robots.txt", "404.html", "__no_such_page__.html"];

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export type Probe = { status: number | null; bytes?: number; sha256?: string; error?: string };
export type Snapshot = { base: string; capturedAt: string; probes: Record<string, Probe>; summary: { htmlCount: number; html: string[]; swSha256: string | null; sitemap: Probe | null; notFound: Probe | null } };

/** 디렉터리 아래 모든 파일의 상대 경로(/ 구분), 이름 순. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out;
}

/** 경로 -> 배포본 URL. 키 "/" 는 루트 URL 이다. */
export const urlOf = (base: string, key: string) => (key === "/" ? base : base + key.split("/").map(encodeURIComponent).join("/"));

async function probeOne(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<Probe> {
  try {
    const res = await fetchImpl(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, bytes: buf.length, sha256: sha256(buf) };
  } catch (e) {
    return { status: null, error: e?.name === "TimeoutError" ? "시간 초과" : (e?.message ?? String(e)) };
  }
}

/** 키 목록을 찍는다. 같은 키는 한 번만. 요약(HTML 목록·sw.js 해시·sitemap·404)을 함께 만든다. */
export async function capture({ base = DEFAULT_BASE, keys, fetchImpl = fetch, concurrency = 8, timeoutMs = 15000, now = () => new Date() }: { base?: string; keys: string[]; fetchImpl?: typeof fetch; concurrency?: number; timeoutMs?: number; now?: () => Date }): Promise<Snapshot> {
  if (!base.endsWith("/")) base += "/";
  const all = [...new Set(["/", ...keys, ...EXTRA_PROBES])].sort();
  const probes: Record<string, Probe> = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, all.length) }, async () => {
      while (next < all.length) {
        const key = all[next++];
        probes[key] = await probeOne(fetchImpl, urlOf(base, key), timeoutMs);
      }
    }),
  );
  const sorted = Object.fromEntries(Object.entries(probes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const html = Object.keys(sorted).filter((k) => /^[^/]+\.html$/.test(k) && sorted[k].status === 200);
  return {
    base,
    capturedAt: now().toISOString(),
    probes: sorted,
    summary: { htmlCount: html.length, html, swSha256: sorted["sw.js"]?.sha256 ?? null, sitemap: sorted["sitemap.xml"] ?? null, notFound: sorted["__no_such_page__.html"] ?? null },
  };
}

export type Diff = { onlyBefore: string[]; onlyAfter: string[]; status: { key: string; before: number | null; after: number | null }[]; bytes: string[]; same: number };

/** 두 스냅샷의 차이. capturedAt·base 는 비교하지 않는다. "없어짐/생김"은 200 이었던 쪽 기준이다(404 -> 404 는 같다). */
export function diffSnapshots(a: Snapshot, b: Snapshot): Diff {
  const keys = [...new Set([...Object.keys(a.probes), ...Object.keys(b.probes)])].sort();
  const d: Diff = { onlyBefore: [], onlyAfter: [], status: [], bytes: [], same: 0 };
  for (const k of keys) {
    const pa = a.probes[k];
    const pb = b.probes[k];
    if (!pa) d.onlyAfter.push(k);
    else if (!pb) d.onlyBefore.push(k);
    else if (pa.status !== pb.status) d.status.push({ key: k, before: pa.status, after: pb.status });
    else if (pa.sha256 !== pb.sha256) d.bytes.push(k);
    else d.same += 1;
  }
  return d;
}

/** 합격선이 말하는 항목을 앞에 적고, 차이 목록을 뒤에 적는다. 줄 배열을 돌려준다. */
export function renderDiff(a: Snapshot, b: Snapshot, d: Diff = diffSnapshots(a, b)): string[] {
  const line = (label: string, x: unknown, y: unknown) => `${label}: ${JSON.stringify(x)} -> ${JSON.stringify(y)} ${JSON.stringify(x) === JSON.stringify(y) ? "(같다)" : "(다르다)"}`;
  const out = [
    `전: ${a.capturedAt} · 후: ${b.capturedAt} · base ${a.base}${a.base === b.base ? "" : ` -> ${b.base} (다른 base 를 맞댔다)`}`,
    `HTML 장 수(200): ${a.summary.htmlCount} -> ${b.summary.htmlCount} ${a.summary.htmlCount === b.summary.htmlCount ? "(같다)" : "(다르다)"}`,
    `HTML 목록: ${JSON.stringify(a.summary.html) === JSON.stringify(b.summary.html) ? "같다" : `다르다 - 없어짐 ${a.summary.html.filter((f) => !b.summary.html.includes(f)).join(",") || "-"} · 생김 ${b.summary.html.filter((f) => !a.summary.html.includes(f)).join(",") || "-"}`}`,
    line("sw.js sha256", a.summary.swSha256?.slice(0, 16) ?? null, b.summary.swSha256?.slice(0, 16) ?? null),
    line("sitemap.xml", a.summary.sitemap && [a.summary.sitemap.status, a.summary.sitemap.sha256?.slice(0, 16)], b.summary.sitemap && [b.summary.sitemap.status, b.summary.sitemap.sha256?.slice(0, 16)]),
    line("404 응답(없는 경로)", a.summary.notFound && [a.summary.notFound.status, a.summary.notFound.sha256?.slice(0, 16)], b.summary.notFound && [b.summary.notFound.status, b.summary.notFound.sha256?.slice(0, 16)]),
  ];
  for (const k of d.onlyBefore) out.push(`  전에만 찍힘: ${k}`);
  for (const k of d.onlyAfter) out.push(`  후에만 찍힘: ${k}`);
  for (const s of d.status) out.push(`  상태 코드: ${s.key} ${s.before} -> ${s.after}`);
  for (const k of d.bytes) out.push(`  바이트 다름: ${k}`);
  const diffs = d.onlyBefore.length + d.onlyAfter.length + d.status.length + d.bytes.length;
  const windowOnly = d.bytes.length > 0 && d.onlyBefore.length + d.onlyAfter.length + d.status.length === 0 && d.bytes.every((k) => k === "method.html" || /^budget-\d+eok\.html$/.test(k));
  if (windowOnly) out.push("  참고: 차이가 method.html·budget-*.html 뿐이다 - 예산 장의 「최근 6개월」 창(BUILD_NOW = HEAD 커밋 시각의 UTC 날짜)이 직전 렌더와 다른 날로 넘어간 차이일 수 있다. 같은 UTC 날짜인지 확인한다.");
  out.push(`요약: 같음 ${d.same} · 차이 ${diffs}`);
  return out;
}

function usage(): never {
  console.error("사용법:\n  node scripts/site-snapshot.ts capture --base=<URL> (--dir=<디렉터리> | --like=<스냅샷.json>) --out=<파일.json> [--concurrency=8] [--timeout=15]\n  node scripts/site-snapshot.ts diff <전.json> <후.json>");
  process.exit(2);
}

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const opt = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (cmd === "capture") {
    const out = opt("out");
    const dir = opt("dir");
    const like = opt("like");
    if (!out || (!dir && !like) || (dir && like)) usage();
    const keys = dir ? listFiles(dir) : Object.keys((JSON.parse(readFileSync(like!, "utf8")) as Snapshot).probes);
    const snap = await capture({ base: opt("base") ?? DEFAULT_BASE, keys, concurrency: Number(opt("concurrency") ?? 8), timeoutMs: Number(opt("timeout") ?? 15) * 1000 });
    writeFileSync(out, `${JSON.stringify(snap, null, 2)}\n`);
    const bad = Object.entries(snap.probes).filter(([k, p]) => (p.status !== 200 && !EXTRA_PROBES.includes(k)) || p.error);
    console.log(`스냅샷 ${out}: ${Object.keys(snap.probes).length}경로 · HTML ${snap.summary.htmlCount}장 · sw.js ${snap.summary.swSha256?.slice(0, 16) ?? "없음"} · sitemap ${snap.summary.sitemap?.status} · 404 응답 ${snap.summary.notFound?.status}`);
    for (const [k, p] of bad) console.log(`  200 이 아님: ${k} ${p.error ?? p.status}`);
    return 0;
  }
  if (cmd === "diff") {
    const [fa, fb] = rest.filter((a) => !a.startsWith("--"));
    if (!fa || !fb) usage();
    const a = JSON.parse(readFileSync(fa, "utf8")) as Snapshot;
    const b = JSON.parse(readFileSync(fb, "utf8")) as Snapshot;
    const d = diffSnapshots(a, b);
    for (const l of renderDiff(a, b, d)) console.log(l);
    return d.onlyBefore.length + d.onlyAfter.length + d.status.length + d.bytes.length === 0 ? 0 : 1;
  }
  usage();
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  process.exitCode = await main(process.argv.slice(2));
}
