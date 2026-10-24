const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * 수집 스크립트(fetch-realestate·build-realestate·fetch-rates)가 이 실행의 시각을 읽는 한 자리 (#261).
 *
 * `env[name]`(시간대를 가진 ISO 8601, 예 `2026-10-31T14:59:59Z`)이 있으면 그 시각, 없으면 지금 — 미설정이면(빈 문자열 포함)
 * 전과 똑같이 `new Date()`다. 시험이 자식 프로세스의 시계를 고정하려는 자리라 production 워크플로는 이 변수를 설정하지 않는다
 * (test/collection-now.test.mjs가 워크플로 전부에서 없음을 지킨다).
 * 시험이 모듈을 읽을 때 정한 시각과 자식이 각자 `new Date()`로 읽는 시각은 KST 월 경계·자정에서 갈린다 — 시험은 시계를 읽지 않고 이 변수로 넘긴다.
 * 읽을 수 없는 값(시간대 없음·날짜만·달력에 없는 날)은 지금으로 넘기지 않고 멈춘다 — 고정했다고 믿은 실행이 오늘 시각으로 돌면
 * 시험이 조용히 시각에 의존한다(`summaryNow`와 같은 엄격도·같은 원칙).
 */
export function collectionNow(name, env = process.env) {
  const raw = env[name];
  if (!raw) return new Date();
  const m = ISO_WITH_ZONE.exec(raw);
  const t = m ? Date.parse(raw) : NaN;
  // Date.parse는 2월 30일을 3월 2일로 굴린다 — 달력에 없는 날은 오타이므로 구성 요소를 되짚어 막는다.
  const [y, mo, d, h, mi, s] = m ? m.slice(1, 7).map((v) => Number(v ?? 0)) : [];
  const roll = m ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : null;
  if (
    Number.isNaN(t) ||
    roll.getUTCFullYear() !== y || roll.getUTCMonth() !== mo - 1 || roll.getUTCDate() !== d ||
    roll.getUTCHours() !== h || roll.getUTCMinutes() !== mi || roll.getUTCSeconds() !== s
  ) {
    throw new Error(`${name}를 읽을 수 없습니다(시간대를 가진 ISO 8601만 받는다, 예 2026-10-31T14:59:59Z): ${raw}`);
  }
  return new Date(t);
}
