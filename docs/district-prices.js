// Local, prerendered data only. Map links remain useful when JavaScript is off.
(() => {
  document.querySelectorAll('.dbars').forEach((section) => {
    section.querySelectorAll('[data-district-select]').forEach((select) => { select.parentElement.hidden = false; });
    const cards = [...section.querySelectorAll('[data-map-card]')];
    if (cards.length) {
      const links = [...section.querySelectorAll('[data-map-district]')];
      const selects = [...section.querySelectorAll('[data-district-select]')];
      const choose = (slug, method) => {
        cards.forEach((card) => { card.hidden = card.dataset.mapCard !== slug; });
        links.forEach((link) => { link.setAttribute('aria-pressed', String(link.dataset.mapDistrict === slug)); });
        selects.forEach((select) => { select.value = slug; });
        if (method) window.analytics?.event('district_map_select', { district: slug, selection_method: method });
      };
      links.forEach((link) => {
        link.setAttribute('role', 'button');
        link.addEventListener('click', (event) => { event.preventDefault(); choose(link.dataset.mapDistrict, 'map'); });
        link.addEventListener('keydown', (event) => {
          if (event.key === ' ') { event.preventDefault(); choose(link.dataset.mapDistrict, 'keyboard'); }
        });
      });
      selects.forEach((select) => select.addEventListener('change', () => choose(select.value, 'select')));
      choose(selects[0].value);
    }
    section.querySelectorAll('.dbars-panel').forEach((panel) => {
      const compare = panel.querySelector('.dprice-compare');
      if (!compare) return;
      compare.hidden = false;
      compare.querySelectorAll('[data-compare-slot]').forEach((slot) => {
        const selects = [...slot.parentElement.querySelectorAll('[data-district-select]')];
        const show = (slug, track) => {
          const source = [...panel.querySelectorAll('[data-district]')].find((row) => row.dataset.district === slug);
          if (!source) return;
          slot.replaceChildren(source.firstElementChild.cloneNode(true));
          selects.forEach((select) => { select.value = slug; });
          if (track) window.analytics?.event('district_compare', { district: slug, realestate_kind: panel.dataset.kind, compare_slot: slot.dataset.compareSlot });
        };
        selects.forEach((select) => select.addEventListener('change', () => show(select.value, true)));
        show(selects[0].value);
      });
    });
  });
})();
