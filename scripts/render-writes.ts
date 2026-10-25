// 렌더 스크립트의 쓰기 묶음 (#237). 한 스크립트가 여러 장을 쓸 때, 전부 메모리에서 렌더에 성공한 뒤에만 디스크에 쓴다.
//
// 전에는 장마다 "렌더 → 쓰기"를 반복해서, 중간 장의 틀에서 마커가 지워졌거나 조각 함수가 던지면 앞 장들만 새 출력이 되고
// 나머지는 어제 것인 채로 커밋·배포될 수 있었다. 이제 렌더 중 오류는 쓰기 전에 난다 - 어떤 파일도 바뀌지 않는다.
// (쓰는 도중의 디스크 오류까지는 막지 못한다. 그건 이 묶음의 범위 밖이다.)
// 렌더 실패는 폴백 없이 첫 실패에서 멈춘다(scripts/render-pipeline.ts, #248 P1).
import { writeFileSync } from "node:fs";

export function createWriteSet() {
  const staged = new Map();
  return {
    /** 쓸 내용을 올려 둔다. 같은 파일을 다시 올리면 나중 것이 이긴다(순서는 처음 올린 자리). note는 쓴 뒤 로그에 찍는다. */
    stage(file, content, note = null) {
      staged.set(file, { content, note });
    },
    /** 올려 둔 내용(없으면 undefined). 같은 스크립트의 뒤 단계가 앞 단계 결과를 이어 받을 때 쓴다. */
    peek: (file) => staged.get(file)?.content,
    get size() {
      return staged.size;
    },
    /** 올려 둔 것을 올린 순서대로 쓴다. 쓴 파일 목록을 돌려준다. */
    commit({ log = console.log } = {}) {
      const written = [];
      for (const [file, { content, note }] of staged) {
        writeFileSync(file, content);
        written.push(file);
        if (note) log(note);
      }
      staged.clear();
      return written;
    },
  };
}
