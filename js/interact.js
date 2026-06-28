/* ================================================================
   INTERACT — mouse & keyboard handlers
   ================================================================ */

const DRAG_TH = 3;
let mdScreen = null;

function srcPos(e) {
  const r = cv.getBoundingClientRect();
  return { x:(e.clientX-r.left)/S.zoom, y:(e.clientY-r.top)/S.zoom };
}

function initInteract() {
  const wrp = document.getElementById('wrap');

  cv.addEventListener('mousedown', onMouseDown);
  cv.addEventListener('mousemove', onMouseMove);
  cv.addEventListener('mouseup', onMouseUp);
  cv.addEventListener('mouseleave', () => {
    document.getElementById('hudL').textContent = '';
  });

  /* ctrl+wheel zoom */
  wrp.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const lvl = [2,4,6,8];
    let i = lvl.indexOf(S.zoom); if (i<0) i = 1;
    i = clamp(i + (e.deltaY<0 ? 1 : -1), 0, lvl.length-1);
    if (lvl[i] !== S.zoom) {
      document.getElementById('optZ').value = lvl[i];
      setZoom(lvl[i]);
    }
  }, { passive:false });

  document.addEventListener('keydown', onKeyDown);

  function tileTip() {
    let tip = document.getElementById('tileTooltip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'tileTooltip'; document.body.appendChild(tip); }
    return tip;
  }
  function showTileTip(e, idx) {
    const txt = typeof bankTooltipText === 'function' ? bankTooltipText(idx) : '';
    const tip = tileTip();
    if (!txt) { tip.style.display = 'none'; return; }
    tip.textContent = txt;
    tip.style.display = 'block';
    if (typeof placeTip === 'function') placeTip(e, tip);
    else { tip.style.left = (e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 12) + 'px'; }
  }
  function hideTileTip() {
    const tip = document.getElementById('tileTooltip');
    if (tip) tip.style.display = 'none';
  }
  function bankIndexAt(e, canvas, geom, len) {
    if (!canvas || !len) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const scaleX = canvas.width / r.width, scaleY = canvas.height / r.height;
    const cxp = (e.clientX - r.left) * scaleX, cyp = (e.clientY - r.top) * scaleY;
    const col = Math.floor(cxp / (geom.tw * geom.sc));
    const row = Math.floor(cyp / (geom.th * geom.sc));
    const idx = row * geom.cols + col;
    return (idx < 0 || idx >= len || col < 0 || col >= geom.cols) ? null : idx;
  }
  const tp = document.getElementById('tilePreview');
  if (tp) {
    tp.style.cursor = 'crosshair';
    tp.addEventListener('mousemove', e => {
      const next = bankIndexAt(e,tp,bankGeom,bankCells.length);
      if (S.bankSel !== next || S.lowBankSel != null) { S.bankSel = next; S.lowBankSel = null; render(); }
      if (next != null) showTileTip(e,next); else hideTileTip();
    });
    tp.addEventListener('mouseleave', () => { hideTileTip(); if (S.bankSel != null || S.lowBankSel != null) { S.bankSel = null; S.lowBankSel = null; render(); } });
  }
  const ltp = document.getElementById('lowTilePreview');
  if (ltp) {
    ltp.style.cursor = 'crosshair';
    ltp.addEventListener('mousemove', e => {
      const idx = bankIndexAt(e,ltp,lowBankGeom,lowBankCells.length);
      const next = idx == null || !lowBankCells[idx] ? null : lowBankCells[idx].mainIdx;
      if (S.bankSel !== next || S.lowBankSel !== idx) { S.bankSel = next; S.lowBankSel = idx; render(); }
      if (next != null) showTileTip(e,next); else hideTileTip();
    });
    ltp.addEventListener('mouseleave', () => { hideTileTip(); if (S.bankSel != null || S.lowBankSel != null) { S.bankSel = null; S.lowBankSel = null; render(); } });
  }
}

function onMouseDown(e) {
  if (!S.img || e.button !== 0) return;
  const p = srcPos(e);
  const f = curFrame();
  mdScreen = { x:e.clientX, y:e.clientY };

  /* nothing selected: search ALL animations for a clicked block,
     then jump into editing that animation+frame (overview click). */
  if (!f) {
    /* prefer the current animation if one is selected, then others */
    const ordered = [];
    const cur = curZone();
    if (cur) ordered.push(cur);
    S.zones.forEach(z => { if (z !== cur) ordered.push(z); });

    for (const zone of ordered) {
      for (const fr of zone.frames) {
        if (fr.ref) continue;
        for (let i=fr.blocks.length-1; i>=0; i--) {
          const b = fr.blocks[i];
          if (p.x>=b.x && p.x<b.x+b.w && p.y>=b.y && p.y<b.y+b.h) {
            S.selZone = zone.id;
            setFrameSelection([fr.id], fr.id);
            S.selBlock = b.id;
            S.bboxEdit = false;
            ui(); render();
            return;
          }
        }
      }
    }
    return;
  }

  /* if current frame is a clone, can't draw/edit blocks here. */
  if (f.ref) { return; }

  /* AUTO-CUT region selection takes priority when armed */
  if (S.autoCutArm) {
    S.action = 'autocut';
    S.drag = { sx:p.x, sy:p.y, cx:p.x, cy:p.y };
    return;
  }

  /* BBOX EDIT MODE: bbox interactions take priority */
  if (S.bboxEdit) {
    const bh = bboxHit(p.x, p.y);
    const bb = ensureBBox(f);
    if (bh && bh.type === 'bbox-edge') {
      S.action = 'bbox-resize';
      S.resizeEdge = bh.edge;
      S.resizeStart = { mx:p.x, my:p.y, bx:bb.x, by:bb.y, bw:bb.w, bh:bb.h };
      return;
    }
    if (bh && bh.type === 'bbox-body') {
      S.action = 'bbox-move';
      S.moveStart = { mx:p.x, my:p.y, bx:bb.x, by:bb.y };
      cv.style.cursor = 'move';
      return;
    }
    /* click outside bbox in edit mode: start a fresh bbox drag */
    S.action = 'bbox-draw';
    S.drag = { sx:p.x, sy:p.y, cx:p.x, cy:p.y };
    return;
  }

  /* anchor wins */
  if (anchorHit(p.x, p.y)) {
    const a = getAnchor(f);
    S.action = 'anchor';
    S.anchorDrag = { mx:p.x, my:p.y, oax:a.x, oay:a.y };
    cv.style.cursor = 'grab';
    return;
  }

  const hit = hitTest(p.x, p.y);

  /* Shift-click on a block: toggle it in the multi-selection */
  if (e.shiftKey && hit && hit.type === 'block') {
    if (!S.selBlocks) S.selBlocks = [];
    const id = hit.block.id;
    const i = S.selBlocks.indexOf(id);
    if (i >= 0) S.selBlocks.splice(i, 1); else S.selBlocks.push(id);
    S.selBlock = id;
    ui(); render();
    return;
  }

  /* Shift-drag on empty space: lasso selection rectangle */
  if (e.shiftKey && !(hit && hit.type)) {
    S.action = 'lasso';
    S.drag = { sx:p.x, sy:p.y, cx:p.x, cy:p.y, additive:(S.selBlocks && S.selBlocks.length>0) };
    return;
  }

  if (hit && hit.type === 'edge') {
    S.action = 'resize';
    S.resizeEdge = hit.edge;
    S.selBlock = hit.block.id;
    S.resizeStart = { mx:p.x, my:p.y, bx:hit.block.x, by:hit.block.y, bw:hit.block.w, bh:hit.block.h };
    ui(); render(); return;
  }
  if (hit && hit.type === 'block') {
    /* plain click clears any multi-selection unless clicking a selected one */
    if (S.selBlocks && S.selBlocks.length && !S.selBlocks.includes(hit.block.id)) {
      S.selBlocks = [];
    }
    S.selBlock = hit.block.id;
    S.action = 'premove';
    S.moveStart = { mx:p.x, my:p.y, bx:hit.block.x, by:hit.block.y };
    ui(); render(); return;
  }

  /* clicked on a block belonging to ANOTHER animation (visible in overview)?
     → jump to editing that animation+frame instead of drawing a new block. */
  for (const zone of S.zones) {
    if (zone.id === S.selZone) continue;
    for (const fr of zone.frames) {
      if (fr.ref) continue;
      for (let i=fr.blocks.length-1; i>=0; i--) {
        const b = fr.blocks[i];
        if (p.x>=b.x && p.x<b.x+b.w && p.y>=b.y && p.y<b.y+b.h) {
          S.selZone = zone.id;
          setFrameSelection([fr.id], fr.id);
          S.selBlock = b.id;
          S.bboxEdit = false;
          ui(); render();
          return;
        }
      }
    }
  }

  /* empty area → start drawing new block */
  S.action = 'predraw';
  S.drag = { sx:p.x, sy:p.y, cx:p.x, cy:p.y };
  S.selBlock = null;
  ui();
}

function onMouseMove(e) {
  if (!S.img) return;
  const p = srcPos(e);
  const f = curFrame();

  /* hover cursor */
  if (!S.action && f && !f.ref) {
    if (S.bboxEdit) {
      const bh = bboxHit(p.x,p.y);
      if (bh && bh.type==='bbox-edge') cv.style.cursor = edgeCursor(bh.edge);
      else if (bh && bh.type==='bbox-body') cv.style.cursor = 'move';
      else cv.style.cursor = 'crosshair';
    } else if (anchorHit(p.x,p.y)) cv.style.cursor = 'grab';
    else {
      const hit = hitTest(p.x,p.y);
      if (hit && hit.type==='edge') cv.style.cursor = edgeCursor(hit.edge);
      else if (hit && hit.type==='block') cv.style.cursor = 'move';
      else cv.style.cursor = 'crosshair';
    }
  } else if (!S.action) {
    cv.style.cursor = f && f.ref ? 'not-allowed' : 'default';
  }

  if (!mdScreen) return;
  const dx = Math.abs(e.clientX-mdScreen.x);
  const dy = Math.abs(e.clientY-mdScreen.y);
  const pastTH = dx>DRAG_TH || dy>DRAG_TH;
  if (S.action==='premove' && pastTH)  { S.action='move';  cv.style.cursor='move'; }
  if (S.action==='predraw' && pastTH)  S.action='draw';

  if (S.action==='anchor' && S.anchorDrag) {
    const ad = S.anchorDrag;
    setAnchor(f, ad.oax+(p.x-ad.mx), ad.oay+(p.y-ad.my));
    render();
    document.getElementById('hudL').textContent = 'Ancre → '+f.ax+','+f.ay;
    return;
  }

  /* ---- lasso selection rectangle ---- */
  if (S.action==='lasso' && S.drag) {
    S.drag.cx = p.x; S.drag.cy = p.y;
    render();
    const x1=Math.round(Math.min(S.drag.sx,S.drag.cx)), y1=Math.round(Math.min(S.drag.sy,S.drag.cy));
    const x2=Math.round(Math.max(S.drag.sx,S.drag.cx)), y2=Math.round(Math.max(S.drag.sy,S.drag.cy));
    document.getElementById('hudL').textContent = 'Sélection '+(x2-x1)+'×'+(y2-y1);
    return;
  }

  /* ---- auto-cut region (free pixel rect) ---- */
  if (S.action==='autocut' && S.drag && f) {
    S.drag.cx = p.x; S.drag.cy = p.y;
    render();
    const x1=Math.round(Math.min(S.drag.sx,S.drag.cx)), y1=Math.round(Math.min(S.drag.sy,S.drag.cy));
    const x2=Math.round(Math.max(S.drag.sx,S.drag.cx)), y2=Math.round(Math.max(S.drag.sy,S.drag.cy));
    document.getElementById('hudL').textContent = 'Zone auto-découpe → '+(x2-x1)+'×'+(y2-y1);
    return;
  }

  /* ---- bbox move (pixel-precise) ---- */
  if (S.action==='bbox-move' && S.moveStart && f) {
    const bb = ensureBBox(f);
    bb.x = Math.round(S.moveStart.bx + (p.x-S.moveStart.mx));
    bb.y = Math.round(S.moveStart.by + (p.y-S.moveStart.my));
    if (S.img) { bb.x = clamp(bb.x,0,S.img.width-bb.w); bb.y = clamp(bb.y,0,S.img.height-bb.h); }
    render();
    document.getElementById('hudL').textContent = 'Box → '+bb.x+','+bb.y;
    return;
  }
  /* ---- bbox resize (pixel-precise) ---- */
  if (S.action==='bbox-resize' && S.resizeStart && f) {
    const bb = ensureBBox(f);
    const rs = S.resizeStart, ed = S.resizeEdge;
    const ddx = Math.round(p.x-rs.mx), ddy = Math.round(p.y-rs.my);
    if (ed.includes('r')) bb.w = Math.max(1, rs.bw+ddx);
    if (ed.includes('l')) { const nx=rs.bx+ddx, nw=rs.bw+(rs.bx-nx); if(nw>=1){bb.x=nx;bb.w=nw;} }
    if (ed.includes('b')) bb.h = Math.max(1, rs.bh+ddy);
    if (ed.includes('t')) { const ny=rs.by+ddy, nh=rs.bh+(rs.by-ny); if(nh>=1){bb.y=ny;bb.h=nh;} }
    if (S.img) {
      bb.x=clamp(bb.x,0,S.img.width); bb.y=clamp(bb.y,0,S.img.height);
      bb.w=Math.min(bb.w,S.img.width-bb.x); bb.h=Math.min(bb.h,S.img.height-bb.y);
    }
    render();
    document.getElementById('hudL').textContent = 'Box → '+bb.w+'×'+bb.h+' @ '+bb.x+','+bb.y;
    return;
  }
  /* ---- bbox draw fresh ---- */
  if (S.action==='bbox-draw' && S.drag && f) {
    S.drag.cx=p.x; S.drag.cy=p.y;
    const x1=Math.round(Math.min(S.drag.sx,S.drag.cx)), y1=Math.round(Math.min(S.drag.sy,S.drag.cy));
    const x2=Math.round(Math.max(S.drag.sx,S.drag.cx)), y2=Math.round(Math.max(S.drag.sy,S.drag.cy));
    f.bbox = { x:x1, y:y1, w:Math.max(1,x2-x1), h:Math.max(1,y2-y1) };
    render();
    document.getElementById('hudL').textContent = 'Box → '+f.bbox.w+'×'+f.bbox.h;
    return;
  }

  if (S.action==='move' && S.moveStart && f) {
    const b = f.blocks.find(b=>b.id===S.selBlock); if (!b) return;
    b.x = Math.round(S.moveStart.bx + (p.x-S.moveStart.mx));
    b.y = Math.round(S.moveStart.by + (p.y-S.moveStart.my));
    if (S.img) {
      b.x = clamp(b.x, 0, S.img.width-b.w);
      b.y = clamp(b.y, 0, S.img.height-b.h);
    }
    render();
    document.getElementById('hudL').textContent = 'Bloc → '+b.x+','+b.y;
    return;
  }
  if (S.action==='resize' && S.resizeStart && f) {
    const b = f.blocks.find(b=>b.id===S.selBlock); if (!b) return;
    const rs = S.resizeStart, ed = S.resizeEdge;
    const ddx = p.x-rs.mx, ddy = p.y-rs.my, th = S.tileH;
    if (ed.includes('r')) b.w = Math.max(8, snap(rs.bw+ddx,8)||8);
    if (ed.includes('l')) {
      let nx = snap(rs.bx+ddx,8);
      let nw = rs.bw + (rs.bx-nx);
      if (nw >= 8) { b.x = nx; b.w = nw; }
    }
    if (ed.includes('b')) b.h = Math.max(th, snap(rs.bh+ddy,th)||th);
    if (ed.includes('t')) {
      let ny = snap(rs.by+ddy,8);
      let nh = rs.bh + (rs.by-ny);
      nh = Math.max(th, snap(nh,th));
      if (nh >= th) { b.y = ny; b.h = nh; }
    }
    if (S.img) {
      b.w = Math.min(b.w, S.img.width  - b.x);
      b.h = Math.min(b.h, S.img.height - b.y);
    }
    render();
    document.getElementById('hudL').textContent = 'Resize → '+b.w+'×'+b.h;
    return;
  }
  if (S.action==='draw' && S.drag) {
    S.drag.cx = p.x; S.drag.cy = p.y;
    render();
    const r = dragRect();
    if (r) {
      const nt = (r.w/8)*(r.h/S.tileH);
      document.getElementById('hudL').textContent =
        r.w+'×'+r.h+' ('+nt+' tiles) @ '+r.x+','+r.y;
    }
    return;
  }

  /* idle hover */
  const sx = Math.floor(p.x), sy = Math.floor(p.y);
  if (S.img && sx>=0 && sy>=0 && sx<S.img.width && sy<S.img.height)
    document.getElementById('hudL').textContent =
      'px '+sx+','+sy+' │ tile '+Math.floor(sx/8)+','+Math.floor(sy/S.tileH);
}

function onMouseUp() {
  if (S.action==='draw') finalizeDraw();
  else if (S.action==='lasso') {
    const f = curFrame();
    if (S.drag && f && !f.ref) {
      const x1=Math.min(S.drag.sx,S.drag.cx), y1=Math.min(S.drag.sy,S.drag.cy);
      const x2=Math.max(S.drag.sx,S.drag.cx), y2=Math.max(S.drag.sy,S.drag.cy);
      const hits = f.blocks.filter(b =>
        b.x < x2 && b.x+b.w > x1 && b.y < y2 && b.y+b.h > y1);
      if (!S.selBlocks || !S.drag.additive) S.selBlocks = [];
      hits.forEach(b => { if (!S.selBlocks.includes(b.id)) S.selBlocks.push(b.id); });
      if (S.selBlocks.length) S.selBlock = S.selBlocks[S.selBlocks.length-1];
      const n = S.selBlocks.length;
      if (n) toast(n + ' bloc' + (n>1?'s':'') + ' sélectionné' + (n>1?'s':''));
    }
    S.drag = null; ui(); render();
  }
  else if (S.action==='autocut') {
    if (S.drag) {
      const x1=Math.round(Math.min(S.drag.sx,S.drag.cx)), y1=Math.round(Math.min(S.drag.sy,S.drag.cy));
      const x2=Math.round(Math.max(S.drag.sx,S.drag.cx)), y2=Math.round(Math.max(S.drag.sy,S.drag.cy));
      const region = { x:x1, y:y1, w:x2-x1, h:y2-y1 };
      S.drag = null;
      applyAutoCut(region);
    } else { S.autoCutArm = false; ui(); render(); }
  }
  else if (S.action==='anchor' || S.action==='move' || S.action==='resize') { ui(); render(); }
  else if (S.action==='bbox-move' || S.action==='bbox-resize' || S.action==='bbox-draw') { S.drag=null; ui(); render(); }
  else if (S.action==='predraw') { S.drag=null; S.selBlock=null; ui(); render(); }
  S.action = null;
  S.moveStart = null; S.resizeStart = null; S.resizeEdge = null; S.anchorDrag = null;
  mdScreen = null;
}

function onKeyDown(e) {
  if (e.target.tagName==='INPUT' || e.target.tagName==='SELECT') return;
  const f = curFrame();
  const b = f?.blocks.find(b=>b.id===S.selBlock);

  if (e.key === 'Escape') {
    if (S.autoCutArm) { S.autoCutArm = false; S.action = null; S.drag = null; ui(); render(); return; }
    if (S.bboxEdit) { S.bboxEdit = false; ui(); render(); return; }
    if (S.action) {
      S.action = null; S.drag = null;
      S.moveStart = null; S.resizeStart = null; S.anchorDrag = null;
      render(); return;
    }
    if (S.selBlock || (S.selBlocks && S.selBlocks.length)) { S.selBlock = null; S.selBlocks = []; ui(); render(); return; }
    if (S.selFrames && S.selFrames.length > 1) { setFrameSelection(S.selFrame ? [S.selFrame] : [], S.selFrame); ui(); render(); return; }
    if (S.bankSel != null || S.lowBankSel != null) { S.bankSel = null; S.lowBankSel = null; render(); return; }
    /* nothing else to dismiss → return to global overview */
    if (S.selFrame || S.selZone) {
      prevStop();
      S.selZone = null; clearFrameSelection();
      ui(); render();
      return;
    }
  }

  /* Ctrl/Cmd+Z : undo last block deletion */
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault(); undo(); return;
  }

  if ((e.key==='Delete' || e.key==='Backspace')) {
    if (S.selBlocks && S.selBlocks.length) { e.preventDefault(); deleteSelection(); return; }
    if (S.selBlock) { e.preventDefault(); delBlock(S.selBlock); return; }
    if (deleteSelectedFrames()) { e.preventDefault(); return; }
  }

  if (b && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 8 : 1;
    if (e.key==='ArrowLeft')  b.x -= step;
    if (e.key==='ArrowRight') b.x += step;
    if (e.key==='ArrowUp')    b.y -= step;
    if (e.key==='ArrowDown')  b.y += step;
    if (S.img) {
      b.x = clamp(b.x, 0, S.img.width-b.w);
      b.y = clamp(b.y, 0, S.img.height-b.h);
    }
    ui(); render();
  }

  if (e.key===' ' && !e.repeat) {
    e.preventDefault();
    A.playing ? prevStop() : prevPlay();
  }
}
