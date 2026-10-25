// 얼린 고정 데이터(test/fixtures/site/data)를 읽는다 (#520, 구조 B-1 후속).
//
// 왜: 금리 조각(`ratesHtml`)을 화면 스크립트와 맞대는 시험들은 입력 데이터가 어떤 모양인지(12개월 옵션이 있는가, 앞 6개가 어느 상품인가)에
// 기대지만 시험의 주제는 코드 쪽 약속(구운 조각과 화면 스크립트가 같은 상품·순서를 그리는가)이다. docs/data 를 읽으면 그날 데이터 모양이
// 바뀔 때(합성 교란: 모든 수 +1 이면 term 12 가 13 이 되어 `ratesHtml` 이 null) 기능 PR 시험이 막힌다. 오늘 데이터와 같은지는
// tools/health 가 본다. 이 헬퍼는 저장소의 docs/data 를 읽지 않는다.
import { readFile } from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../fixtures/site/data");

/** `readFixture("realestate")` → test/fixtures/site/data/realestate.json 을 파싱한 값. */
export const readFixture = (name) => readFile(path.join(dir, `${name}.json`), "utf8").then(JSON.parse);
