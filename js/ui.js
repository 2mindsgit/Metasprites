/* ================================================================
   UI — sidebar building, mirror radios, clone picker
   ================================================================ */

function toggleSimpleMode(on) {
  S.simpleMode = !!on;
  if (S.simpleMode) S.bboxEdit = false;
  syncSimpleCutControls();
  ui(); render();
}

function setC0Alpha(v) {
  S.c0alpha = clamp(parseInt(v)||0, 0, 100);
  const lbl = document.getElementById('c0val');
  if (lbl) lbl.textContent = S.c0alpha + '%';
  render();
}
function setPreviewC0Alpha(v) {
  S.prevC0alpha = clamp(parseInt(v)||0, 0, 100);
  const lbl = document.getElementById('prevC0val');
  if (lbl) lbl.textContent = S.prevC0alpha + '%';
  renderPreview();
}
function setPreviewBlockOutline(on) {
  S.previewBlockOutline = !!on;
  renderPreview();
}

/* Sanitize a sheet name for use as WLA-DX label / filename:
   lowercase, only [a-z0-9_], spaces/dashes/accents -> underscore. */
function sanitizeSheetName(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')                        // non-alnum -> _
    .replace(/_+/g, '_')                                 // collapse repeats
    .replace(/^_+|_+$/g, '');                            // trim edges
}

/* live input: update projectName, but keep raw text in the field so the
   user can type freely; sanitization is applied on export/blur. */
function onSheetNameInput(val) {
  S.projectName = sanitizeSheetName(val) || 'sans_titre';
}

/* sync the field with current projectName (called from ui()) */
function syncSheetName() {
  const el = document.getElementById('sheetName');
  if (el && document.activeElement !== el) el.value = S.projectName;
}

/* Hide the left/right columns (and their splitters) when no sheet is open,
   so the empty editor isn't cluttered before a PNG/JSON is loaded. The grid
   template is collapsed to a single column so the empty-state centers across
   the whole window. */
function updateColumnsVisibility() {
  const has = !!S.img;
  const disp = has ? '' : 'none';
  ['sidebar','splitL','splitR','rpanel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = disp;
  });
  const app = document.getElementById('app');
  if (app) {
    if (has) {
      /* restore the saved/default column layout */
      if (typeof loadLayout === 'function') loadLayout();
    } else {
      app.style.gridTemplateColumns = '1fr';  /* single full-width column */
    }
  }
}

/* ===== Configuration popup ===== */
function openConfig() {
  const ov = document.getElementById('configOverlay');
  if (!ov) return;
  document.getElementById('cfgAlloc').value     = S.alloc;
  document.getElementById('cfgTileH').value     = String(S.tileH);
  document.getElementById('cfgSimple').value    = S.simpleMode ? '1' : '0';
  document.getElementById('cfgOverlap').value  = normalizeCutOverlap(S.cutOverlap);
  document.getElementById('cfgAttrEnable').checked = !!S.attrEnable;
  renderAttrEditor();
  ov.style.display = 'block';
}

function closeConfig() {
  const ov = document.getElementById('configOverlay');
  if (ov) ov.style.display = 'none';
}

/* set overlap policy from the sidebar select; keep config popup in sync */
function setCutOverlap(v) {
  S.cutOverlap = normalizeCutOverlap(v);
  const c = document.getElementById('cfgOverlap'); if (c) c.value = S.cutOverlap;
  toast((window.mt?mt('Overlap'): 'Overlap') + ' : ' + (S.cutOverlap==='none'?(window.mt?mt('Non'):'Non'):(window.mt?mt('Oui'):'Oui')));
}

/* set the sprite-separation gap (px) for whole-sheet detection */
function setCutGap(v) {
  S.cutGap = clamp(parseInt(v)||2, 1, 32);
  const lbl = document.getElementById('cutGapVal');
  if (lbl) lbl.textContent = S.cutGap + 'px';
}

function normalizeSimpleCutValues() {
  S.simpleCutW = clamp(Math.round((parseInt(S.simpleCutW)||16)/8)*8, 8, 64);
  const step = S.tileH === 8 ? 8 : 16;
  const min = S.tileH === 8 ? 8 : 16;
  S.simpleCutH = clamp(Math.round((parseInt(S.simpleCutH)||min)/step)*step, min, 64);
}

function syncSimpleCutControls() {
  normalizeSimpleCutValues();
  const h = document.getElementById('optSimpleCutH');
  if (h) {
    const step = S.tileH === 8 ? 8 : 16;
    const min = S.tileH === 8 ? 8 : 16;
    h.min = min; h.step = step; h.max = 64; h.value = S.simpleCutH;
  }
  const w = document.getElementById('optSimpleCutW');
  if (w) w.value = S.simpleCutW;
  const wv = document.getElementById('simpleCutWVal');
  if (wv) wv.textContent = S.simpleCutW + 'px';
  const hv = document.getElementById('simpleCutHVal');
  if (hv) hv.textContent = S.simpleCutH + 'px';
  updateSimpleCutInfo();
}

function setSimpleCutW(v) {
  S.simpleCutW = clamp(Math.round((parseInt(v)||16)/8)*8, 8, 64);
  syncSimpleCutControls();
}

function setSimpleCutH(v) {
  const step = S.tileH === 8 ? 8 : 16;
  const min = S.tileH === 8 ? 8 : 16;
  S.simpleCutH = clamp(Math.round((parseInt(v)||min)/step)*step, min, 64);
  syncSimpleCutControls();
}

function getSimpleCutStatus() {
  normalizeSimpleCutValues();
  if (!S.imgData) return { ok:false, message:'Importer un PNG pour calculer la grille.' };
  const iw = S.imgData.width, ih = S.imgData.height, cw = S.simpleCutW, ch = S.simpleCutH;
  const badW = iw % cw !== 0, badH = ih % ch !== 0;
  if (badW || badH) {
    const parts = [];
    if (badW) parts.push(window.mt ? mt('largeur {size} non multiple de {cut}', {size:iw, cut:cw}) : 'largeur ' + iw + ' non multiple de ' + cw);
    if (badH) parts.push(window.mt ? mt('hauteur {size} non multiple de {cut}', {size:ih, cut:ch}) : 'hauteur ' + ih + ' non multiple de ' + ch);
    return { ok:false, message:'PNG ' + iw + '×' + ih + ' · ' + (window.mt ? mt('découpe {w}×{h}', {w:cw, h:ch}) : 'découpe ' + cw + '×' + ch) + '<br><span style="color:#ff8080">' + parts.join(' · ') + '</span>', plain:(window.mt ? mt('Taille non concordante : PNG {iw}×{ih} px, découpe {cw}×{ch} px.\n{details}', {iw, ih, cw, ch, details:parts.join('\n')}) : 'Taille non concordante : PNG ' + iw + '×' + ih + ' px, découpe ' + cw + '×' + ch + ' px.\n' + parts.join('\n')) };
  }
  const cols = iw / cw, rows = ih / ch, n = cols * rows;
  let nonEmpty = n, empty = 0;
  if (typeof simpleRegionHasContent === 'function') {
    nonEmpty = 0;
    for (let y=0; y<ih; y+=ch) {
      for (let x=0; x<iw; x+=cw) {
        if (simpleRegionHasContent(x,y,cw,ch)) nonEmpty++;
      }
    }
    empty = n - nonEmpty;
  }
  const cutText = window.mt ? mt('PNG {iw}×{ih} · découpe {cw}×{ch}', {iw, ih, cw, ch}) : 'PNG ' + iw + '×' + ih + ' · découpe ' + cw + '×' + ch;
  const gridText = window.mt ? mt('{cols}×{rows} = {n} case{s}', {cols, rows, n, s:n>1?'s':''}) : cols + '×' + rows + ' = ' + n + ' case' + (n>1?'s':'');
  const frameText = window.mt ? mt('{n} frame{s} créée{s2}', {n:nonEmpty, s:nonEmpty>1?'s':'', s2:nonEmpty>1?'s':''}) : nonEmpty + ' frame' + (nonEmpty>1?'s':'') + ' créée' + (nonEmpty>1?'s':'');
  const emptyText = empty ? (window.mt ? mt('{n} vide{s} ignorée{s2}', {n:empty, s:empty>1?'s':'', s2:empty>1?'s':''}) : empty + ' vide' + (empty>1?'s':'') + ' ignorée' + (empty>1?'s':'')) : '';
  return { ok:true, cols, rows, frames:n, nonEmpty, empty, message:cutText + '<br><span style="color:var(--green)">' + gridText + '</span><br><span style="color:var(--text)">' + frameText + (emptyText ? ' · ' + emptyText : '') + '</span>' };
}

function updateSimpleCutInfo() {
  const info = document.getElementById('simpleCutInfo');
  const btn = document.getElementById('btnSimpleCutAll');
  if (!info && !btn) return;
  const st = getSimpleCutStatus();
  if (info) info.innerHTML = st.message;
  if (btn) btn.disabled = !S.imgData;
}


/* build the editable list of 8 attribute bits (name + description) */
function renderAttrEditor() {
  const box = document.getElementById('attrEditor');
  const on = document.getElementById('cfgAttrEnable').checked;
  if (!box) return;
  box.style.display = on ? 'flex' : 'none';
  if (!on) { box.innerHTML = ''; return; }
  if (!S.attrBits || S.attrBits.length !== 8) S.attrBits = defaultAttrBits();
  box.innerHTML = '';
  const hdr = document.createElement('div');
  hdr.style.cssText = 'font-size:10px;color:var(--text2,#888)';
  hdr.textContent = window.mt ? mt('bit 0 (LSB) → bit 7 (MSB) · nom asm + description') : 'bit 0 (LSB) → bit 7 (MSB) · nom asm + description';
  box.appendChild(hdr);
  S.attrBits.forEach((bit, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center';
    const lbl = document.createElement('span');
    lbl.textContent = i; lbl.style.cssText = 'width:14px;color:var(--text2,#888);text-align:right';
    const nm = document.createElement('input');
    nm.type='text'; nm.value=bit.name; nm.placeholder=window.mt?mt('nom'):'nom'; nm.style.cssText='width:90px';
    nm.oninput = e => { S.attrBits[i].name = e.target.value; };
    const ds = document.createElement('input');
    ds.type='text'; ds.value=bit.desc; ds.placeholder=window.mt?mt('description'):'description'; ds.style.cssText='flex:1';
    ds.oninput = e => { S.attrBits[i].desc = e.target.value; };
    row.appendChild(lbl); row.appendChild(nm); row.appendChild(ds);
    box.appendChild(row);
  });
  if (window.MetaLang) MetaLang.apply();
}

function applyConfig() {
  S.alloc      = document.getElementById('cfgAlloc').value;
  S.tileH      = parseInt(document.getElementById('cfgTileH').value, 10) || 16;
  S.simpleMode = document.getElementById('cfgSimple').value === '1';
  S.cutOverlap = normalizeCutOverlap(document.getElementById('cfgOverlap').value);
  S.attrEnable = document.getElementById('cfgAttrEnable').checked;
  /* keep the legacy toolbar selectors in sync */
  { const e=document.getElementById('optMode');   if(e) e.value = S.tileH; }
  { const e=document.getElementById('optAlloc');  if(e) e.value = S.alloc; }
  { const e=document.getElementById('optSimple'); if(e) e.checked = S.simpleMode; }
  { const e=document.getElementById('optOverlap'); if(e) e.value = normalizeCutOverlap(S.cutOverlap); }
  syncSimpleCutControls();
  closeConfig();
  ui(); render();
  toast(window.mt ? mt('Configuration appliquée') : 'Configuration appliquée');
}

/* import full config from another project .json (replaces current config) */
function importConfigFromFile() {
  const inp = document.getElementById('cfgImportFile');
  if (!inp) return;
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      let data;
      try { data = JSON.parse(r.result); }
      catch(e) { toast(window.mt ? mt('JSON invalide') : 'JSON invalide'); return; }
      if (!confirm(window.mt ? mt('Remplacer toute la configuration actuelle (mode, taille, mode simple, attributs) par celle de « {name} » ?', {name:data.name||file.name}) : 'Remplacer toute la configuration actuelle (mode, taille, mode simple, attributs) par celle de « '+(data.name||file.name)+' » ?')) return;
      if (data.alloc) S.alloc = data.alloc;
      if (data.tileH) S.tileH = data.tileH;
      S.simpleMode = !!data.simpleMode;
      S.cutOverlap = normalizeCutOverlap(data.cutOverlap);
      S.attrEnable = !!data.attrEnable;
      if (Array.isArray(data.attrBits) && data.attrBits.length === 8) {
        S.attrBits = data.attrBits.map(b => ({ name:b.name||'', desc:b.desc||'' }));
      }
      openConfig();           /* refresh popup fields */
      { const e=document.getElementById('optOverlap'); if(e) e.value = normalizeCutOverlap(S.cutOverlap); }
      { const e=document.getElementById('optMode'); if(e) e.value = S.tileH; }
      { const e=document.getElementById('optAlloc'); if(e) e.value = S.alloc; }
      { const e=document.getElementById('optSimple'); if(e) e.checked = S.simpleMode; }
      syncSimpleCutControls();
      toast('Configuration importée');
    };
    r.readAsText(file);
    inp.value = '';
  };
  inp.click();
}

function toggleBboxEdit() {
  const f = curFrame();
  if (!f || f.ref) { toast(window.mt ? mt('Sélectionner une frame (non clonée)') : 'Sélectionner une frame (non clonée)'); return; }
  S.bboxEdit = !S.bboxEdit;
  if (S.bboxEdit) ensureBBox(f);
  ui(); render();
}

function resetBbox() {
  const f = curFrame();
  if (!f || f.ref) return;
  clearBBox(f);
  if (S.bboxEdit) ensureBBox(f);
  ui(); render();
  toast('Boîte réinitialisée');
}

/* update the bbox controls visibility + label */
function updateBboxControls() {
  const box = document.getElementById('bboxControls');
  const f = curFrame();
  const show = f && !f.ref && !S.simpleMode;
  box.style.display = show ? 'block' : 'none';
  if (!show) { S.bboxEdit = false; return; }

  const btn = document.getElementById('btnBbox');
  btn.innerHTML = (S.bboxEdit ? '☑' : '☐') + ' Éditer boîte collision';
  btn.classList.toggle('act', S.bboxEdit);

  const bb = getBBox(f);
  const a = getAnchor(f);
  const info = document.getElementById('bboxInfo');
  if (bb) {
    const xMin = bb.x - a.x, xMax = (bb.x + bb.w) - a.x, ySize = bb.h;
    info.innerHTML = 'xMin '+xMin+' · xMax '+xMax+' · ySize '+ySize +
      (f.bbox ? '' : ' <span style="color:var(--text2)">(auto)</span>');
  } else {
    info.textContent = '(pas de blocs)';
  }
}

/* format bytes as "X.XKo (NNNN bytes)" */
function fmtSize(bytes) {
  const ko = bytes / 1024;
  const koStr = ko >= 10 ? Math.round(ko) : ko.toFixed(1);
  return koStr + 'Ko (' + bytes + ' bytes)';
}

/* refresh the export size labels under the buttons */
function updateExportSizes() {
  const el = document.getElementById('exportSizes');
  if (!el) return;
  const s = S.exportSizes || {};
  const lines = [];
  if (s.bin != null) lines.push('BIN ' + fmtSize(s.bin));
  if (s.psg != null) lines.push('PSG ' + fmtSize(s.psg));
  if (s.zx7 != null) lines.push('ZX7 ' + fmtSize(s.zx7));
  el.innerHTML = lines.join('<br>');
}

function updateAutoCutAllButton() {
  const b = document.getElementById('btnAutoCutAll');
  if (b) b.style.display = (S.imgData && !S.simpleMode) ? 'block' : 'none';
  const sb = document.getElementById('simpleCutBox');
  if (sb) sb.style.display = (S.imgData && S.simpleMode) ? 'block' : 'none';
  const cg = document.getElementById('cutGapBox');
  if (cg) cg.style.display = (!S.simpleMode) ? 'flex' : 'none';
  const d = document.getElementById('btnClearAll');
  if (d) d.disabled = !S.zones.length;
  syncSimpleCutControls();
}

const listDragState = { type:null, id:null, zoneId:null, ids:[] };
function clearListDropMarks() {
  document.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(el=>el.classList.remove('drop-before','drop-after','dragging'));
}
function dragAfter(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}
function markDrop(e, el) {
  el.classList.remove('drop-before','drop-after');
  el.classList.add(dragAfter(e,el) ? 'drop-after' : 'drop-before');
}
function startAnimDrag(e, id, el) {
  listDragState.type = 'anim';
  listDragState.id = id;
  listDragState.zoneId = null;
  listDragState.ids = [];
  S.selZone = id;
  clearFrameSelection();
  A.bankFrameId = null;
  render();
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
}
function overAnimDrop(e, id, el) {
  if (listDragState.type !== 'anim' || listDragState.id === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  markDrop(e,el);
}
function dropAnim(e, id, el) {
  if (listDragState.type !== 'anim' || listDragState.id === id) return;
  e.preventDefault();
  const i = S.zones.findIndex(z=>z.id===id);
  if (i >= 0) moveAnimToIndex(listDragState.id, i + (dragAfter(e,el) ? 1 : 0));
  clearListDropMarks();
}
function startFrameDrag(e, id, el) {
  const z = curZone(); if (!z) return;
  listDragState.type = 'frame';
  listDragState.id = id;
  listDragState.zoneId = z.id;
  S.bboxEdit = false;
  S.autoCutArm = false;
  A.bankFrameId = null;
  if (!selectedFrameIds().includes(id)) setFrameSelection([id], id);
  else S.selFrame = id;
  listDragState.ids = selectedFrameIds();
  render();
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
}
function overFrameDrop(e, id, el) {
  if (listDragState.type !== 'frame' || listDragState.zoneId !== S.selZone || listDragState.ids.includes(id)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  markDrop(e,el);
}
function dropFrame(e, id, el) {
  if (listDragState.type !== 'frame' || listDragState.zoneId !== S.selZone || listDragState.ids.includes(id)) return;
  e.preventDefault();
  moveFramesToIndex(listDragState.ids.length ? listDragState.ids : [listDragState.id], id, dragAfter(e,el));
  clearListDropMarks();
}
function endListDrag() {
  listDragState.type = null;
  listDragState.id = null;
  listDragState.zoneId = null;
  listDragState.ids = [];
  clearListDropMarks();
}

function ui() {
  ensureFrameNums();
  updateColumnsVisibility();
  updateAutoCutAllButton();
  /* ===== animations list ===== */
  const zl = document.getElementById('animList');
  zl.innerHTML = '';
  S.zones.forEach((z,zi) => {
    const d = document.createElement('div');
    d.className = 'anim-item' + (z.id===S.selZone ? ' sel' : '');
    d.ondragover = e => overAnimDrop(e,z.id,d);
    d.ondragleave = () => d.classList.remove('drop-before','drop-after');
    d.ondrop = e => dropAnim(e,z.id,d);

    const grip = document.createElement('span');
    grip.className = 'drag-grip';
    grip.textContent = '⋮';
    grip.title = 'Cliquer/glisser pour déplacer l’animation';
    grip.draggable = true;
    grip.onclick = e => e.stopPropagation();
    grip.ondragstart = e => { e.stopPropagation(); startAnimDrag(e,z.id,d); };
    grip.ondragend = endListDrag;
    d.appendChild(grip);

    const dot = document.createElement('label');
    dot.className = 'dot';
    dot.style.background = z.color;
    dot.style.cursor = 'pointer';
    dot.title = 'Changer la couleur';
    dot.onclick = e => { e.stopPropagation(); }; /* don't select the anim */
    const cpick = document.createElement('input');
    cpick.type = 'color';
    cpick.value = z.color;
    cpick.style.cssText = 'opacity:0;width:0;height:0;position:absolute;pointer-events:none';
    /* live update during slide: change color + dot + canvas only, NO ui() */
    cpick.oninput = e => {
      z.color = e.target.value;
      dot.style.background = z.color;
      render();
    };
    /* on commit, refresh the sidebar (tags etc.) */
    cpick.onchange = e => { z.color = e.target.value; ui(); render(); };
    cpick.onclick = e => e.stopPropagation();
    dot.appendChild(cpick);
    d.appendChild(dot);

    const name = document.createElement('span');
    name.className = 'zname';
    name.textContent = z.name;
    d.appendChild(name);

    if (z.mirror && z.mirror !== 'none') {
      const mt = document.createElement('span');
      mt.className = 'mir-tag';
      mt.textContent = z.mirror.toUpperCase();
      d.appendChild(mt);
    }

    /* loop indicator */
    const lt = document.createElement('span');
    lt.className = 'mir-tag';
    lt.style.color = (z.loop !== false) ? 'var(--green)' : 'var(--text2)';
    lt.style.background = (z.loop !== false) ? 'rgba(0,200,104,0.15)' : 'transparent';
    lt.textContent = (z.loop !== false) ? '↻' : '→';
    lt.title = (z.loop !== false) ? 'Boucle' : 'Une fois';
    d.appendChild(lt);

    const acts = document.createElement('span');
    acts.className = 'acts';

    const bLoop = document.createElement('button');
    bLoop.className = 'mini';
    bLoop.textContent = (z.loop !== false) ? '↻' : '→';
    bLoop.title = (z.loop !== false) ? 'Boucle (cliquer pour: une fois)' : 'Une fois (cliquer pour: boucle)';
    bLoop.onclick = e => { e.stopPropagation(); toggleAnimLoop(z.id); };

    const bUp = document.createElement('button');
    bUp.className = 'mini';
    bUp.textContent = '▲';
    bUp.title = 'Monter';
    bUp.disabled = zi===0;
    bUp.onclick = e => { e.stopPropagation(); moveAnim(z.id,-1); };

    const bDn = document.createElement('button');
    bDn.className = 'mini';
    bDn.textContent = '▼';
    bDn.title = 'Descendre';
    bDn.disabled = zi===S.zones.length-1;
    bDn.onclick = e => { e.stopPropagation(); moveAnim(z.id,+1); };

    const bR = document.createElement('button');
    bR.className = 'mini';
    bR.textContent = '✏️';
    bR.title = 'Renommer';
    bR.onclick = e => { e.stopPropagation(); renameAnim(z.id); };

    const bD = document.createElement('button');
    bD.className = 'mini del';
    bD.textContent = '✕';
    bD.onclick = e => { e.stopPropagation(); delAnim(z.id); };

    acts.append(bLoop,bUp,bDn,bR,bD);
    d.appendChild(acts);
    d.onclick = () => selAnim(z.id);
    zl.appendChild(d);
  });

  /* ===== frame panel ===== */
  const zn = curZone();
  const fp = document.getElementById('frmPanel');
  fp.style.display = zn ? 'block' : 'none';

  /* always-on UI bits that must run even with no animation selected */
  syncSheetName();

  if (!zn) { updateBboxControls(); return; }

  document.getElementById('frmZN').textContent = zn.name;

  /* move-frame-to-anim: visible only with a real frame and another anim */
  const mvBtn = document.getElementById('btnMoveFrameZone');
  if (mvBtn) {
    const n = selectedFrameIds().length;
    mvBtn.style.display = n ? 'block' : 'none';
    mvBtn.title = n > 1 ? 'Déplacer ces frames vers une autre animation' : 'Déplacer cette frame vers une autre animation';
    mvBtn.innerHTML = n > 1 ? '&#8644; Déplacer '+n+' frames…' : '&#8644; Déplacer vers une anim…';
  }

  /* auto-cut available only outside simple mode and with an editable frame */
  const acBtn = document.getElementById('btnAutoCut');
  if (acBtn) {
    const f = curFrame();
    const showAC = (!S.simpleMode && f && !f.ref);
    acBtn.style.display = showAC ? 'block' : 'none';
    acBtn.classList.toggle('act', S.autoCutArm);
    acBtn.innerHTML = S.autoCutArm ? '&#9986; Dessinez la zone…' : '&#9986; Découpe auto (zone)';
  }
  const clrBtn = document.getElementById('btnClearBlocks');
  if (clrBtn) {
    const f = curFrame();
    clrBtn.style.display = (f && !f.ref && f.blocks.length) ? 'block' : 'none';
  }
  const selAct = document.getElementById('selActions');
  if (selAct) {
    const f = curFrame();
    const n = (S.selBlocks && S.selBlocks.length) ? S.selBlocks.length : 0;
    const show = f && !f.ref && n > 0;
    selAct.style.display = show ? 'block' : 'none';
    if (show) { const c = document.getElementById('selCount'); if (c) c.textContent = n; }
  }
  const btnCloneCurrent = document.getElementById('btnCloneCurrent');
  if (btnCloneCurrent) btnCloneCurrent.style.display = curFrame() ? 'block' : 'none';
  const btnImportFrame = document.getElementById('btnImportFrame');
  if (btnImportFrame) {
    const canImport = S.zones.some(z => z.id !== zn.id && z.frames.some(f=>!f.ref));
    btnImportFrame.style.display = canImport ? 'block' : 'none';
  }
  if (typeof updateUndoButton === 'function') updateUndoButton();

  /* mirror radio reflect current */
  document.querySelectorAll('input[name="mirror"]').forEach(r => {
    r.checked = (r.value === (zn.mirror||'none'));
  });

  /* ===== frame list ===== */
  const fl = document.getElementById('frmList');
  fl.innerHTML = '';
  const frameIds = selectedFrameIds();
  zn.frames.forEach((f,fi) => {
    const isSel = frameIds.includes(f.id);
    const isClone = !!f.ref;
    const { frame:realFrame } = resolveFrame(f);

    const fd = document.createElement('div');
    fd.className = 'frame-item' + (isSel?' sel':'') + (isClone?' clone':'');
    fd.ondragover = e => overFrameDrop(e,f.id,fd);
    fd.ondragleave = () => fd.classList.remove('drop-before','drop-after');
    fd.ondrop = e => dropFrame(e,f.id,fd);

    const grip = document.createElement('span');
    grip.className = 'drag-grip';
    grip.textContent = '⋮';
    grip.title = window.mt ? mt('Cliquer/glisser pour déplacer la frame') : 'Cliquer/glisser pour déplacer la frame';
    grip.draggable = true;
    grip.onclick = e => e.stopPropagation();
    grip.ondragstart = e => { e.stopPropagation(); startFrameDrag(e,f.id,fd); };
    grip.ondragend = endListDrag;
    fd.appendChild(grip);

    const sp = document.createElement('span');
    sp.className = 'fi-name';
    const frameNumLabel = '#' + frameNum(f);
    if (isClone) {
      const n = document.createElement('span');
      n.className = 'fi-num';
      n.textContent = frameNumLabel + ' frame ' + fi + ' ';
      const ic = document.createElement('span');
      ic.className = 'clone-icon';
      ic.textContent = '↳';
      const tx = document.createElement('span');
      let nt = 0;
      if (realFrame && realFrame.blocks) realFrame.blocks.forEach(b => nt += (b.w/8)*(b.h/S.tileH));
      const loadNt = S.tileH === 16 ? nt * 2 : nt;
      const tileTxt = nt + 't' + (S.tileH === 16 ? ' (' + loadNt + 't)' : '');
      const peak = realFrame && realFrame.blocks ? maxSpritesPerLine(realFrame.blocks) : 0;
      tx.textContent = f.name.replace(/^↳\s*/, '') + ' — ' + (realFrame && realFrame.blocks ? realFrame.blocks.length : 0) + 'b, ' + tileTxt + ', ' + peak + 's';
      sp.append(n, ic, tx);
    } else {
      const frameName = autoFrameName(zn,f,fi);
      let nt = 0;
      f.blocks.forEach(b => nt += (b.w/8)*(b.h/S.tileH));
      const loadNt = S.tileH === 16 ? nt * 2 : nt;
      const tileTxt = nt + 't' + (S.tileH === 16 ? ' (' + loadNt + 't)' : '');
      const peak = maxSpritesPerLine(f.blocks);
      sp.textContent = frameNumLabel + ' ' + frameName + ' — ' + f.blocks.length + 'b, ' + tileTxt + ', ' + peak + 's';
      if (S.alloc === 'dynamic' && loadNt >= 20) {
        const warn = document.createElement('span');
        const crit = loadNt >= 22;
        warn.textContent = ' ⚠';
        warn.style.color = crit ? '#ff4040' : '#ffaa00';
        warn.style.fontWeight = 'bold';
        warn.style.fontSize = '15px';
        warn.title = crit
          ? loadNt + ' tiles à charger : dépasse le budget VBlank (≥22) — risque de ne pas tout charger'
          : loadNt + ' tiles à charger : proche de la limite VBlank (≥20)';
        sp.appendChild(warn);
      }
      /* sprites-per-scanline warning (SMS max 8/line). Alert when >6. */
      if (peak > 6) {
        const sw = document.createElement('span');
        const over = peak > 8;
        sw.textContent = ' ▲' + peak;
        sw.style.color = over ? '#ff4040' : '#ffaa00';
        sw.style.fontWeight = 'bold';
        sw.style.fontSize = '12px';
        sw.title = over
          ? peak + ' sprites sur une ligne : dépasse la limite SMS de 8/ligne (clignotement)'
          : peak + ' sprites sur une ligne : proche de la limite SMS (8/ligne)';
        sp.appendChild(sw);
      }
    }

    const di = document.createElement('input');
    di.type = 'number';
    di.className = 'delay-input';
    di.min = 0; di.max = 255;
    di.value = f.delay;
    di.title = 'Délai (frames 60Hz)';
    di.onclick = e => e.stopPropagation();
    di.onchange = e => {
      f.delay = clamp(parseInt(e.target.value)||0, 0, 255);
      render();
    };

    const bUp = document.createElement('button');
    bUp.className = 'mini'; bUp.textContent = '▲';
    bUp.disabled = fi===0;
    bUp.onclick = e => { e.stopPropagation(); moveFrame(f.id,-1); };

    const bDn = document.createElement('button');
    bDn.className = 'mini'; bDn.textContent = '▼';
    bDn.disabled = fi===zn.frames.length-1;
    bDn.onclick = e => { e.stopPropagation(); moveFrame(f.id,+1); };

    const bD = document.createElement('button');
    bD.className = 'mini del';
    bD.textContent = '✕';
    bD.onclick = e => { e.stopPropagation(); delFrame(f.id); };

    fd.append(sp,di,bUp,bDn,bD);
    fd.onclick = e => selFrameId(f.id, e.shiftKey);
    fl.appendChild(fd);

    /* block list (only if non-clone and selected) */
    if (f.id===S.selFrame && !isClone) {
      f.blocks.forEach((b,bi) => {
        const bd = document.createElement('div');
        bd.className = 'block-item' + (b.id===S.selBlock?' sel':'');
        bd.innerHTML = '<span>bloc '+bi+' — '+b.w+'×'+b.h+' @ '+b.x+','+b.y+'</span>';
        const bbD = document.createElement('button');
        bbD.className = 'mini del';
        bbD.textContent = '✕';
        bbD.onclick = e => { e.stopPropagation(); delBlock(b.id); };
        bd.appendChild(bbD);
        bd.onclick = e => { e.stopPropagation(); selBlockId(b.id); };
        fl.appendChild(bd);
      });
    }
  });

  document.getElementById('hudR').textContent = '×'+S.zoom;
  updateBboxControls();
  renderFrameAttrs();
  syncSheetName();
  if (window.MetaLang) MetaLang.apply();
}

/* render the 8 attribute checkboxes for the current frame */
function renderFrameAttrs() {
  const box = document.getElementById('attrBox');
  if (!box) return;
  const f = curFrame();
  const show = S.attrEnable && f && !f.ref;
  box.style.display = show ? 'block' : 'none';
  if (!show) return;
  if (f.attr == null) f.attr = 0;
  if (!S.attrBits || S.attrBits.length !== 8) S.attrBits = defaultAttrBits();
  const checks = document.getElementById('attrChecks');
  checks.innerHTML = '';
  S.attrBits.forEach((bit, i) => {
    const lab = document.createElement('label');
    lab.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!(f.attr & (1<<i));
    cb.onchange = () => {
      if (cb.checked) f.attr |= (1<<i); else f.attr &= ~(1<<i);
      updateAttrByte();
    };
    const txt = document.createElement('span');
    txt.innerHTML = '<b>'+(bit.name||('bit'+i))+'</b> <span style="color:var(--text2)">'+(bit.desc||'')+'</span>';
    lab.appendChild(cb); lab.appendChild(txt);
    checks.appendChild(lab);
  });
  updateAttrByte();
}

function updateAttrByte() {
  const f = curFrame();
  const el = document.getElementById('attrByteVal');
  if (!f || !el) return;
  const v = f.attr || 0;
  el.textContent = '0b' + v.toString(2).padStart(8,'0') + ' ($' + v.toString(16).toUpperCase().padStart(2,'0') + ')';
}

/* ===== Mirror radio change ===== */
function bindMirrorRadios() {
  document.querySelectorAll('input[name="mirror"]').forEach(r => {
    r.onchange = e => {
      const zn = curZone(); if (!zn) return;
      setAnimMirror(zn.id, e.target.value);
    };
  });
}

/* ===== Clone picker ===== */
function showClonePicker() {
  const z = curZone(); if (!z) return;
  const sel = document.getElementById('cloneSelect');
  sel.innerHTML = '';
  let count = 0;
  S.zones.filter(zz => zz.id !== z.id).forEach(zz => {
    const og = document.createElement('optgroup');
    og.label = zz.name;
    let local = 0;
    zz.frames.forEach((fr, i) => {
      if (fr.ref) return;
      const opt = document.createElement('option');
      opt.value = zz.id + '|' + fr.id;
      opt.textContent = '#' + frameNum(fr) + ' ' + autoFrameName(zz,fr,i);
      og.appendChild(opt);
      local++; count++;
    });
    if (local) sel.appendChild(og);
  });
  if (count === 0) { toast(window.mt ? mt('Aucune frame à importer') : 'Aucune frame à importer'); return; }
  document.getElementById('clonePicker').style.display = 'block';
}

function hideClonePicker() {
  document.getElementById('clonePicker').style.display = 'none';
}

function doCloneFrame() {
  const sel = document.getElementById('cloneSelect');
  if (!sel.value) return;
  const [zid, fid] = sel.value.split('|');
  cloneFrame(zid, fid);
  hideClonePicker();
}

/* ===== Move-frame-to-another-animation picker ===== */
function showMoveFramePicker() {
  const zn = curZone();
  const ids = selectedFrameIds();
  if (!zn || !ids.length) { toast(window.mt ? mt('Sélectionner une frame') : 'Sélectionner une frame'); return; }
  const sel = document.getElementById('moveFrameSelect');
  sel.innerHTML = '';
  const neo = document.createElement('option');
  neo.value = '__new__';
  neo.textContent = window.mt ? mt('Nouvelle animation') : 'Nouvelle animation';
  sel.appendChild(neo);
  S.zones.filter(z => z.id !== zn.id).forEach(z => {
    const opt = document.createElement('option');
    opt.value = z.id;
    opt.textContent = z.name + ' (' + z.frames.length + ' frame' + (z.frames.length>1?'s':'') + ')';
    sel.appendChild(opt);
  });
  document.getElementById('moveFramePicker').style.display = 'block';
}

function hideMoveFramePicker() {
  document.getElementById('moveFramePicker').style.display = 'none';
}

function doMoveFrameZone() {
  const sel = document.getElementById('moveFrameSelect');
  const ids = selectedFrameIds();
  if (!sel.value || !ids.length) return;
  let targetId = sel.value;
  if (targetId === '__new__') {
    const z = createAnimationNamed(prompt(window.mt ? mt("Nom de l'animation :") : "Nom de l'animation :", 'anim_'+S.zones.length));
    if (!z) return;
    targetId = z.id;
  }
  moveFramesToZone(ids, targetId);
  hideMoveFramePicker();
}

