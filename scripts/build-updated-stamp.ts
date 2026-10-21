// 모든 장의 #updated에 데이터 기준일(YYYY-MM-DD)을 정적으로 찍는다 (#111). 페이지 빌더가 전부 끝난 뒤에 돈다 -
// 틀에서 장을 다시 쓰는 빌더보다 앞서면 날짜가 덮인다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWriteSet } from "./render-writes.ts";
import { crossStampAll, stampAll } from "./updated-stamp.ts";

const root: number = path.resolve(import.meta.dirname, "..");

// 두 찍기가 전부 성공한 뒤에 쓴다(#237). 교차값 찍기는 첫 찍기가 바꾼 장을 이어 받으므로 읽을 때 모아 둔 것을 먼저 본다.
const writes = createWriteSet();
const io = { read: (file) => writes.peek(file) ?? readFileSync(file, "utf8"), write: (file, text) => writes.stage(file, text) };

const done = stampAll({ docsDir: path.join(root, "docs"), dataDir: path.join(root, "docs/data"), io });
console.log(`  기준일 표기 ${done.length}장`);

// 교차값(실거래 x 금리) 화면은 입력별 기준일 줄을 하나 더 찍는다 (#154).
const crossDone = crossStampAll({ docsDir: path.join(root, "docs"), dataDir: path.join(root, "docs/data"), io });
console.log(`  교차값 입력별 기준일 ${crossDone.length}장`);

writes.commit();
