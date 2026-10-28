// 모든 장의 #updated에 데이터 기준일(YYYY-MM-DD)을 정적으로 찍는다 (#111). 페이지 빌더가 전부 끝난 뒤에 돈다 -
// 틀에서 장을 다시 쓰는 빌더보다 앞서면 날짜가 덮인다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWriteSet } from "./render-writes.ts";
import { crossStampAll, stampAll } from "./updated-stamp.ts";
import { requireSite, siteDir } from "./site-dir.ts";
import { stampPageAssets } from "./page-assets.ts";

const root = path.resolve(import.meta.dirname, "..");

requireSite(); // 출력 디렉터리가 docs/ 가 아니면 docs/ 복사본이 먼저 있어야 한다(#508)
const siteRoot = siteDir(); // 찍는 장의 디렉터리: 기본 docs/. 기준일 소스(docs/data)는 어느 쪽이든 그대로다.

// 두 찍기가 전부 성공한 뒤에 쓴다(#237). 교차값 찍기는 첫 찍기가 바꾼 장을 이어 받으므로 읽을 때 모아 둔 것을 먼저 본다.
const writes = createWriteSet();
const io = { read: (file) => writes.peek(file) ?? readFileSync(file, "utf8"), write: (file, text) => writes.stage(file, text) };

const done = stampAll({ docsDir: siteRoot, dataDir: path.join(root, "docs/data"), io });
console.log(`  기준일 표기 ${done.length}장`);

// 교차값(실거래 x 금리) 화면은 입력별 기준일 줄을 하나 더 찍는다 (#154).
const crossDone = crossStampAll({ docsDir: siteRoot, dataDir: path.join(root, "docs/data"), io });
console.log(`  교차값 입력별 기준일 ${crossDone.length}장`);

const assetsDone = stampPageAssets({ siteRoot, io });
console.log(`  스타일 버전·기능 분류 ${assetsDone}장`);
writes.commit();
