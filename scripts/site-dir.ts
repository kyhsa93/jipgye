// 사이트 출력 디렉터리 (#508, 구조 B-2). prerender 와 build-*-pages 가 "어느 디렉터리의 장을 읽고 쓰는가"를 한 곳에서 정한다.
//
// - 기본은 docs/ 다. 환경변수 JIPGYE_SITE_DIR 이 없거나 비어 있으면 전과 똑같이 docs/ 를 제자리에서 갱신한다(바이트 동일이 합격선).
// - JIPGYE_SITE_DIR=<디렉터리>(저장소 루트 기준 상대 경로 또는 절대 경로)이면 여섯 렌더 스크립트가 그 디렉터리의 장을 읽고 쓴다. docs/ 는 손대지 않는다.
//
// 왜 "docs/ 를 통째로 복사한 뒤 그 복사본을 제자리에서 렌더"인가: 렌더 스크립트는 앞 단계의 산출을 다음 단계의 입력으로 읽는다 -
// build-news-pages 는 prerender 가 채운 news.html 을 틀로, build-budget-pages 는 method.html 을 읽어 다시 쓰고, build-updated-stamp 는
// 앞 다섯이 쓴 장 전부를 읽어 찍는다. 입력의 일부는 docs/ 에서, 일부는 출력 쪽에서 읽도록 가르면 단계마다 어느 쪽인지 따로 정해야 하고
// 하나만 틀려도 사이트가 달라진다. 출력 디렉터리가 docs/ 의 복사본으로 시작하면 "읽는 곳 = 쓰는 곳"이 기존과 똑같아 바이트가 같을 수밖에 없고,
// 정적 자산(style.css·nav.js·sw.js·icons·data)이 배포 산출물에 함께 들어가는 길도 이 복사 하나로 정해진다(배포 산출물 = 출력 디렉터리 전체).
// 데이터(docs/data)는 읽기 전용 소스라 렌더 스크립트는 계속 docs/data 에서 읽는다 - 수집·집계 빌더가 거기에 쓰고 main 에 남는다.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const DOCS_DIR = path.join(REPO_ROOT, "docs");
/** 출력 디렉터리를 정하는 환경변수. render-pipeline 은 `--out=<디렉터리>` 인자로도 받아 이 변수로 자식에게 넘긴다. */
export const SITE_DIR_ENV = "JIPGYE_SITE_DIR";

type Env = Record<string, string | undefined>;

/** 렌더 스크립트가 읽고 쓰는 디렉터리의 절대 경로. 환경변수가 없거나 비어 있으면 docs/ 다. */
export function siteDir(env: Env = process.env): string {
  const v = env[SITE_DIR_ENV];
  return v ? path.resolve(REPO_ROOT, v) : DOCS_DIR;
}

/** 로그용 경로: 저장소 안이면 루트 기준 상대 경로, 밖이면 절대 경로(`../../..` 사슬은 읽기 어렵다). */
export function shownPath(p: string): string {
  const rel = path.relative(REPO_ROOT, p);
  return (rel.startsWith("..") ? p : rel).split(path.sep).join("/");
}

/** 출력 디렉터리 안의 파일 하나(rel 은 `news.html` 같은 상대 경로). */
export function sitePath(rel: string, env: Env = process.env): string {
  return path.join(siteDir(env), rel);
}

/** 로그에 찍는 이름. 기본이면 전과 같은 `docs/news.html` 이다. */
export function siteLabel(rel: string, env: Env = process.env): string {
  return shownPath(sitePath(rel, env));
}

/**
 * 렌더 스크립트가 읽기 전에 부른다. 기본(docs/)이면 아무것도 안 한다. 다른 디렉터리인데 아직 docs/ 복사본이 없으면(stage-site 나
 * render-pipeline 이 안 돌았으면) 장이 없다는 ENOENT 대신 무엇을 먼저 해야 하는지 말하고 던진다.
 */
export function requireSite(env: Env = process.env): void {
  const dir = siteDir(env);
  if (dir === DOCS_DIR) return;
  if (!existsSync(path.join(dir, "index.html"))) {
    throw new Error(`출력 디렉터리 ${shownPath(dir)}에 docs/ 복사본이 없다 - node scripts/stage-site.ts 나 render-pipeline.ts 가 먼저 docs/ 를 복사한다`);
  }
}

function fileCount(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? fileCount(path.join(dir, e.name)) : 1;
  return n;
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * docs/ 를 출력 디렉터리로 통째로 복사한다(기존 내용은 먼저 지운다 - 지난 실행의 낡은 파일이 산출물에 남지 않게).
 * 출력 디렉터리가 docs/ 와 같으면(기본) 아무것도 안 한다. 지우기 전에 막는 것:
 *  - docs/ 안의 디렉터리(자기 자신 위로 복사),
 *  - docs/ 나 저장소 루트의 조상(통째로 지워진다),
 *  - 이미 있고 비어 있지 않은데 index.html 이 없는 디렉터리(우리가 만든 출력 디렉터리가 아닐 수 있다).
 */
export function stageSite({ out, docs = DOCS_DIR, root = REPO_ROOT }: { out: string; docs?: string; root?: string }): { copied: number; skipped: boolean } {
  const dest = path.resolve(root, out);
  if (dest === docs) return { copied: 0, skipped: true };
  if (inside(dest, docs)) throw new Error(`출력 디렉터리 ${dest}가 docs/ 안이다`);
  if (dest === root || inside(docs, dest) || inside(root, dest)) throw new Error(`출력 디렉터리 ${dest}가 docs/ 나 저장소 루트를 품고 있다`);
  if (existsSync(dest)) {
    if (!statSync(dest).isDirectory()) throw new Error(`출력 경로 ${dest}가 디렉터리가 아니다`);
    if (readdirSync(dest).length > 0 && !existsSync(path.join(dest, "index.html"))) {
      throw new Error(`출력 디렉터리 ${dest}가 비어 있지 않고 사이트(index.html)도 아니라 지우지 않는다`);
    }
    rmSync(dest, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(docs, dest, { recursive: true });
  return { copied: fileCount(dest), skipped: false };
}
