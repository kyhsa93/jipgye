// 데이터 파일을 못 받았을 때 화면이 따르는 사이트 공통 규칙 하나 (#173·#174).
//
//   로드 중과 실패는 다른 상태다. 실패한 자리에 "불러오는 중..."/"찾는 중..."을
//   남기지 않는다 - 실패를 말하는 문구와 재시도 단추로 바꾼다.
//
// 화면마다 문구와 단추를 따로 짜면 한 화면이 빠진다(금리 5장의 추이 구역과 단지로
// 묶어 보기가 그렇게 남았다). 실패 표시는 이 한 곳에서만 만들고, 화면은 어느 자리에서
// 어떤 문구로 말할지만 넘긴다. 이 파일이 없으면 화면은 실패 문구 없이 돈다 - 그래서
// 로드하는 페이지마다 test/load-failure.test.mjs가 이 스크립트를 물고 있는지 본다.
(function () {
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  /**
   * target을 실패 문구 + 재시도 단추로 바꾼다.
   * - message / retryLabel: 이미 현재 언어로 옮긴 문구.
   * - retryId: 단추 id. 한 화면에 실패 자리가 둘이면 서로 달라야 한다.
   * - wrap(inner): 자리의 모양(<tr><td>…, <p>…)을 입히는 함수. 없으면 그대로 둔다.
   * - onRetry: 단추를 누르면 부를 함수. 누른 단추는 다시 눌리지 않게 잠근다.
   */
  function showFailure(target, { message, retryLabel, retryId = "load-retry", wrap = (inner) => inner, onRetry }) {
    if (!target) return;
    const inner = `${escapeHtml(message)} <button type="button" id="${escapeHtml(retryId)}">${escapeHtml(retryLabel)}</button>`;
    target.innerHTML = wrap(inner);
    document.getElementById(retryId)?.addEventListener("click", (event) => {
      if (event.currentTarget) event.currentTarget.disabled = true;
      onRetry?.();
    });
  }

  window.loadState = { showFailure };
})();
