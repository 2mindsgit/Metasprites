/* ================================================================
   APP — bootstrap, wire global options, init
   ================================================================ */

function initApp() {
  /* tile size */
  document.getElementById('optMode').onchange = e => {
    S.tileH = +e.target.value; syncSimpleCutControls(); ui(); render();
  };

  /* zoom */
  document.getElementById('optZ').onchange = e => {
    setZoom(+e.target.value);
  };

  /* dedup */
  document.getElementById('optDedup').onchange = () => render();

  /* allocation mode */
  document.getElementById('optAlloc').onchange = e => {
    S.alloc = e.target.value;
  };

  /* start tile index */
  document.getElementById('optStartTile').onchange = e => {
    S.startTile = clamp(parseInt(e.target.value)||0, 0, 447);
    e.target.value = S.startTile;
    render();
  };

  /* mirror radios (bind once, ui() syncs values) */
  bindMirrorRadios();

  if (window.MetaLang) MetaLang.onchange = () => { ui(); render(); renderPreview(); };
  /* initial paint */
  ui();
  updateBadge();
  if (window.MetaLang) MetaLang.apply();
}

/* Boot when DOM ready */
(function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
    return;
  }
  initRender();
  initPreview();
  initIO();
  initInteract();
  initLayout();
  initApp();
})();
