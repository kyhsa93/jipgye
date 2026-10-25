// 날짜별 뉴스 파일 (#706, P1 성능). 사이트 빌드 단계(render-pipeline)가 `<출력 디렉터리>/data/news-day/YYYY-MM-DD.json` 을 하루 하나씩 만든다.
//
// 왜: `news.html?date=` 는 하루를 그리려고 news-history.json(869KB)·summary-history.json(575KB)을 통째로 받아 파싱했다(gzip 합 ~298KB).
// 하루치는 수 KB 라서, 빌드가 날짜별로 잘라 두면 지난 날 화면은 그 파일 하나(~15KB 목표)만 받는다.
//
// 구조 B 를 지킨다: 수집·요약은 이 파일을 모르고 main 에 커밋되는 것은 0 이다(docs/data 의 history 두 파일이 원본 그대로 남는다).
// 이 스크립트는 docs/data 를 읽기만 하고 출력 디렉터리(기본 docs/ — 그때는 .gitignore 가 막는다)에 쓴다. 원본 항목은 한 글자도 바꾸지 않는다 -
// 요약·기사 내용 변경 0. 하루 파일이 없으면(옛 배포·낯선 날짜) news.html 이 기존 history 경로로 되돌아간다.
//
// 형식: {"date": "YYYY-MM-DD", "news": <news-history 의 그날 항목 | {}>, "summary": <summary-history 의 그날 항목 | {}>} - 없는 쪽은 {} 다(news.html 이 기록 없음으로 그리는 값 그대로).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, shownPath, siteDir } from "./site-dir.ts";

export const DAY_DIR = "data/news-day";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Entry = { date?: unknown } & Record<string, unknown>;

/**
 * 두 history 배열을 날짜별로 묶는다. 날짜 모양이 아닌 항목은 건너뛰고(파일 이름이 되므로), 같은 날짜가 여럿이면 첫 항목이 이긴다
 * (news.html 의 기존 `find` 가 앞의 것을 골랐다 - 그쪽에 맞춘다). 결과는 날짜 오름차순이다.
 */
export function splitByDay(newsHistory: Entry[], summaryHistory: Entry[]): { day: string; body: { date: string; news: Entry; summary: Entry } }[] {
  const days = new Map<string, { date: string; news: Entry; summary: Entry }>();
  const put = (list: Entry[], key: "news" | "summary") => {
    for (const entry of list) {
      const date = entry?.date;
      if (typeof date !== "string" || !DAY.test(date)) continue;
      const body = days.get(date) ?? { date, news: {}, summary: {} };
      if (!body[key].date) body[key] = entry; // 같은 날짜가 둘이면 첫 항목 - 기존 find 와 같다
      days.set(date, body);
    }
  };
  put(newsHistory, "news");
  put(summaryHistory, "summary");
  return [...days.keys()].sort().map((day) => ({ day, body: days.get(day)! }));
}

/** 출력 디렉터리 `<out>/data/news-day/` 를 비우고 날짜별 파일을 쓴다. 쓴 파일 수와 바이트 합을 돌려준다. */
export function writeNewsDays({ out, dataDir = path.join(REPO_ROOT, "docs/data") }: { out: string; dataDir?: string }): { files: number; bytes: number } {
  const read = (name: string): Entry[] => {
    const file = path.join(dataDir, name);
    // 기록 파일이 아예 없으면(고정 데이터 시험 작업 폴더 등) 그쪽은 빈 기록이다 - 하루 파일은 없어도 되는 최적화라 news.html 이 history 로 되돌아간다.
    if (!existsSync(file)) {
      console.warn(`[build-news-days] ${name} 이 없다 - 그 기록은 비어 있는 것으로 본다`);
      return [];
    }
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`${name} 이 배열이 아니다`);
    return parsed;
  };
  const dir = path.join(out, DAY_DIR);
  rmSync(dir, { recursive: true, force: true }); // 지난 실행의 낡은 날짜 파일이 남지 않게
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  const days = splitByDay(read("news-history.json"), read("summary-history.json"));
  for (const { day, body } of days) {
    const text = JSON.stringify(body);
    bytes += Buffer.byteLength(text);
    writeFileSync(path.join(dir, `${day}.json`), text);
  }
  return { files: days.length, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const out = siteDir();
  const { files, bytes } = writeNewsDays({ out });
  console.log(`[build-news-days] ${shownPath(path.join(out, DAY_DIR))}: ${files}개 파일 (${bytes}B)`);
}
