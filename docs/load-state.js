// 데이터 파일을 못 받았을 때 화면이 따르는 사이트 공통 규칙 다섯 (#173·#174·#296).
//
//   1. 빈 자리(구운 내용이 없는 자리)가 실패하면 "불러오는 중..."을 남기지 않고 실패 문구와 재시도 단추로 바꾼다.
//   2. 구운 내용이 있는 자리가 실패하면 구운 내용을 지우지도 숨기지도 않고, 그 바로 위에 실패를 알리고 재시도 단추를 준다.
//   3. 2번은 구운 것과 같은 보기일 때만이다. 보기를 바꿨으면(지난 날짜·다른 면적·분류·정렬) 남기지 않고 1번을 따른다.
//   4. 구운 값은 구운 날의 값이다. 구운 기준일을 지우거나 "-"로 바꾸지 않는다(3번의 보기에서는 그 보기의 기준일).
//   5. 실패와 "아직 없음"은 다른 말이다. 구운 자리는 404·빈 응답도 "새로 받지 못했다"로 알린다("준비 중"은 받은 뒤 빈 때만).
//
// 화면마다 문구와 단추를 따로 짜면 한 화면이 빠진다(금리 5장의 추이 구역과 단지로
// 묶어 보기가 그렇게 남았다). 실패 표시는 이 한 곳에서만 만들고, 화면은 어느 자리에서
// 어떤 문구로 말할지만 넘긴다. 이 파일이 없으면 화면은 실패 문구 없이 돈다 - 그래서
// 로드하는 페이지마다 test/load-failure.test.mjs가 이 스크립트를 물고 있는지 본다.
(function () {
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // 지금 화면에 떠 있는 재시도 단추 id들. 한 화면에 실패 자리가 둘이면(금리 5장의 표와 추이 구역)
  // 두 단추가 같은 main()을 부른다 - 한쪽을 누르고 다른 쪽도 누르면 main()이 두 번 돌았다(#187).
  // 하나를 누르면 떠 있는 단추를 모두 잠가 한 번의 실패에 재시도가 한 번만 나가게 한다.
  const live = new Set();

  function lockAll() {
    for (const id of live) {
      const button = document.getElementById(id);
      if (button) button.disabled = true;
    }
    live.clear();
  }

  /**
   * target을 실패 문구 + 재시도 단추로 바꾼다.
   * - message / retryLabel: 이미 현재 언어로 옮긴 문구.
   * - retryId: 단추 id. 한 화면에 실패 자리가 둘이면 서로 달라야 한다.
   * - wrap(inner): 자리의 모양(<tr><td>…, <p>…)을 입히는 함수. 없으면 그대로 둔다.
   * - onRetry: 단추를 누르면 부를 함수. 누른 단추와 같은 화면에 떠 있는 다른 재시도 단추도 잠근다.
   */
  function showFailure(target, { message, retryLabel, retryId = "load-retry", wrap = (inner) => inner, onRetry }) {
    if (!target) return;
    const inner = `${escapeHtml(message)} <button type="button" id="${escapeHtml(retryId)}">${escapeHtml(retryLabel)}</button>`;
    target.innerHTML = wrap(inner);
    live.add(retryId);
    document.getElementById(retryId)?.addEventListener("click", (event) => {
      if (event.currentTarget) event.currentTarget.disabled = true;
      lockAll();
      onRetry?.();
    });
  }

  // 규칙 2의 길: anchor 바로 아래에 알림 한 줄. onRetry가 있으면 실패 문구 + 구운 기준일 + 재시도, 없으면 영어 고지만.
  // 시세 틀과 구운 47장에 본문 그대로 실리므로 밖의 변수를 쓰지 않는다.
  function notifyBeside(anchor, message, retryLabel, onRetry) {
    notifyBeside.last?.remove();
    const en = document.documentElement.getAttribute("lang") === "en";
    const day = document.getElementById("updated")?.getAttribute("data-updated");
    const asOf = en
      ? `Shown below is what this page was built with${day ? ` on ${day}` : "; see its as-of date"}.`
      : `아래는 ${day ? `기준일(${day})` : "이 화면의 기준일"}에 만든 값입니다.`;
    const text = [message, onRetry && asOf, en && "Some of it is in Korean only."].filter(Boolean).join(" ");
    if (!text) return;
    anchor.insertAdjacentHTML("afterend", '<p class="content-notice"></p>');
    const box = (notifyBeside.last = anchor.nextElementSibling);
    box.append(text);
    if (!onRetry) return;
    box.insertAdjacentHTML("beforeend", ' <button type="button" id="load-retry"></button>');
    const button = box.lastElementChild;
    button.textContent = retryLabel;
    button.addEventListener("click", () => {
      button.disabled = true;
      box.remove();
      onRetry();
    });
  }

  window.loadState = { showFailure, notifyBeside };
})();
