/* ================================================================
   RENDER — Canvas drawing + tile bank
   ================================================================ */

let cv, cc, tpCv, tpC, lowCv, lowC;

function initRender() {
  cv = document.getElementById('cv');
  cc = cv.getContext('2d');
  tpCv = document.getElementById('tilePreview');
  tpC  = tpCv.getContext('2d');
  lowCv = document.getElementById('lowTilePreview');
  lowC = lowCv ? lowCv.getContext('2d') : null;

  if (window.ResizeObserver && tpCv.parentElement) {
    const ro = new ResizeObserver(() => scheduleBankResize());
    ro.observe(tpCv.parentElement);
  }
  window.addEventListener('resize', () => scheduleBankResize());
}

/* Scroll the canvas viewport so the edited frame's content is centered. */
function centerOnFrame() {
  const wrap = document.getElementById('wrap');
  if (!wrap || !S.img) return;
  const f = curFrame();
  const { frame } = f ? resolveFrame(f) : { frame:null };
  let fx, fy;
  if (frame && frame.blocks && frame.blocks.length) {
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    frame.blocks.forEach(b=>{ x1=Math.min(x1,b.x); y1=Math.min(y1,b.y); x2=Math.max(x2,b.x+b.w); y2=Math.max(y2,b.y+b.h); });
    fx = (x1+x2)/2; fy = (y1+y2)/2;
  } else if (frame) {
    const a = getAnchor(frame); fx = a.x; fy = a.y;
  } else {
    return; /* nothing to center on */
  }
  wrap.scrollLeft = fx*S.zoom - wrap.clientWidth/2;
  wrap.scrollTop  = fy*S.zoom - wrap.clientHeight/2;
}

/* Change zoom while keeping a focal image-pixel under the same screen spot.
   Focal point priority: edited frame center (anchor/blocks bbox), else the
   current viewport center. Keeps the edited object in view on large sheets. */
function setZoom(newZoom) {
  const wrap = document.getElementById('wrap');
  if (!wrap || !S.img) { S.zoom = newZoom; render(); ui(); return; }

  const oldZoom = S.zoom;
  /* focal point in IMAGE pixels */
  let fx, fy;
  const f = curFrame();
  const { frame } = f ? resolveFrame(f) : { frame:null };
  if (frame && frame.blocks && frame.blocks.length) {
    /* center on the blocks' bbox */
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    frame.blocks.forEach(b=>{ x1=Math.min(x1,b.x); y1=Math.min(y1,b.y); x2=Math.max(x2,b.x+b.w); y2=Math.max(y2,b.y+b.h); });
    fx = (x1+x2)/2; fy = (y1+y2)/2;
  } else if (frame) {
    const a = getAnchor(frame); fx = a.x; fy = a.y;
  } else {
    /* viewport center in image px */
    fx = (wrap.scrollLeft + wrap.clientWidth/2) / oldZoom;
    fy = (wrap.scrollTop  + wrap.clientHeight/2) / oldZoom;
  }

  /* where is the focal point on screen right now (within the wrap viewport)? */
  const screenX = fx*oldZoom - wrap.scrollLeft;
  const screenY = fy*oldZoom - wrap.scrollTop;

  S.zoom = newZoom;
  render(); ui();

  /* after re-render the canvas has new size; keep focal point under the same
     screen position (or center it if it was a selection-based focus) */
  const targetScreenX = (frame ? wrap.clientWidth/2  : screenX);
  const targetScreenY = (frame ? wrap.clientHeight/2 : screenY);
  wrap.scrollLeft = fx*newZoom - targetScreenX;
  wrap.scrollTop  = fy*newZoom - targetScreenY;
}

/* ===== Drag rectangle (in-progress new block) ===== */
function dragRect() {
  const d = S.drag; if (!d) return null;
  const th = S.tileH;
  let x1 = snap(Math.min(d.sx,d.cx),8), y1 = snap(Math.min(d.sy,d.cy),8);
  let x2 = snap(Math.max(d.sx,d.cx),8)+8;
  let rawH = snap(Math.max(d.sy,d.cy),8)+8-y1;
  let h = Math.max(th, Math.ceil(rawH/th)*th);
  if (S.img) { x2 = Math.min(x2,S.img.width); h = Math.min(h, S.img.height-y1); }
  x1 = Math.max(0,x1); y1 = Math.max(0,y1);
  h = Math.max(th, snap(h,th));
  const w = x2-x1;
  if (w<8 || h<th) return null;
  return { x:x1, y:y1, w, h };
}

function finalizeDraw() {
  const r = dragRect();
  S.drag = null; S.action = null;
  if (!r) { render(); return; }
  const f = curFrame();
  /* can't draw on a clone */
  if (!f || f.ref) { render(); return; }
  const b = { id:uid(), x:r.x, y:r.y, w:r.w, h:r.h };
  f.blocks.push(b);
  S.selBlock = b.id;
  ui(); render();
  const nt = (r.w/8)*(r.h/S.tileH);
  toast('Bloc '+r.w+'×'+r.h+' ('+nt+' tile'+(nt>1?'s':'')+')');
}

/* ===== Hit testing ===== */
const EDGE_PX = 6;

function hitTest(sx,sy) {
  const f = curFrame(); if (!f || f.ref) return null;
  const selB = f.blocks.find(b => b.id===S.selBlock);
  if (selB) {
    const e = edgeHit(selB,sx,sy);
    if (e) return { type:'edge', block:selB, edge:e };
  }
  for (let i=f.blocks.length-1; i>=0; i--) {
    const b = f.blocks[i];
    if (sx>=b.x && sx<b.x+b.w && sy>=b.y && sy<b.y+b.h)
      return { type:'block', block:b };
  }
  return null;
}

function edgeHit(b,sx,sy) {
  const m = EDGE_PX/S.zoom;
  if (sx<b.x-m || sx>b.x+b.w+m || sy<b.y-m || sy>b.y+b.h+m) return null;
  const nR = Math.abs(sx-(b.x+b.w))<m, nB = Math.abs(sy-(b.y+b.h))<m;
  const nL = Math.abs(sx-b.x)<m,       nT = Math.abs(sy-b.y)<m;
  if (nR&&nB) return 'br'; if (nR&&nT) return 'tr';
  if (nL&&nB) return 'bl'; if (nL&&nT) return 'tl';
  if (nR) return 'r'; if (nB) return 'b'; if (nL) return 'l'; if (nT) return 't';
  return null;
}

function edgeCursor(e) {
  if (!e) return 'crosshair';
  if (e==='r'||e==='l') return 'ew-resize';
  if (e==='b'||e==='t') return 'ns-resize';
  return 'nwse-resize';
}

function frameBounds(fr) {
  if (!fr) return null;
  if (fr.blocks && fr.blocks.length) {
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    fr.blocks.forEach(b=>{ x1=Math.min(x1,b.x); y1=Math.min(y1,b.y); x2=Math.max(x2,b.x+b.w); y2=Math.max(y2,b.y+b.h); });
    return { x:x1, y:y1, w:x2-x1, h:y2-y1 };
  }
  const bb = getBBox(fr);
  if (bb) return bb;
  const a = getAnchor(fr);
  return a ? { x:a.x, y:a.y, w:1, h:1 } : null;
}

function drawFrameLabel(fr,idx,col,strong) {
  const r = frameBounds(fr);
  if (!r) return;
  let txt = '#' + frameNum(fr), warn = 0;
  if (strong && S.zoom >= 4 && fr.blocks && fr.blocks.length) {
    let nt = 0;
    fr.blocks.forEach(b => nt += (b.w/8)*(b.h/S.tileH));
    const loadNt = S.tileH === 16 ? nt * 2 : nt;
    const peak = typeof maxSpritesPerLine === 'function' ? maxSpritesPerLine(fr.blocks) : 0;
    let tTxt = loadNt + 't', sTxt = peak + 's';
    if (S.alloc === 'dynamic' && loadNt >= 20) { tTxt += ' ⚠'; warn = Math.max(warn, loadNt >= 22 ? 2 : 1); }
    if (peak > 6) { sTxt += ' ▲'; warn = Math.max(warn, peak > 8 ? 2 : 1); }
    txt += ' (' + tTxt + ' / ' + sTxt + ')';
  }
  cc.save();
  cc.font = 'bold 11px monospace';
  const pad = 3, h = 14, w = Math.ceil(cc.measureText(txt).width) + pad*2;
  let x = r.x*S.zoom, y = r.y*S.zoom - h - 2;
  if (y < 0) y = r.y*S.zoom + 2;
  if (x + w > cv.width) x = cv.width - w - 1;
  if (x < 0) x = 1;
  cc.fillStyle = strong ? 'rgba(0,0,0,0.86)' : 'rgba(0,0,0,0.70)';
  cc.fillRect(x,y,w,h);
  cc.strokeStyle = warn === 2 ? '#ff4040' : warn === 1 ? '#ffaa00' : strong ? '#fff' : col;
  cc.lineWidth = strong ? 1.5 : 1;
  cc.strokeRect(x+.5,y+.5,w-1,h-1);
  cc.fillStyle = warn === 2 ? '#ff8080' : warn === 1 ? '#ffd060' : strong ? '#fff' : col;
  cc.fillText(txt,x+pad,y+11);
  cc.restore();
}

function anchorHit(sx,sy) {
  const f = curFrame(); if (!f) return false;
  const { frame } = resolveFrame(f);
  if (!frame) return false;
  const a = getAnchor(frame), m = 8/S.zoom;
  return Math.abs(sx-a.x)<m && Math.abs(sy-a.y)<m;
}

/* bbox edge/body hit (pixel-precise). Returns {type:'bbox-edge'|'bbox-body', edge?} */
function bboxHit(sx,sy) {
  const f = curFrame(); if (!f) return null;
  const bb = ensureBBox(f);
  const m = EDGE_PX/S.zoom;
  if (sx<bb.x-m || sx>bb.x+bb.w+m || sy<bb.y-m || sy>bb.y+bb.h+m) return null;
  const nR=Math.abs(sx-(bb.x+bb.w))<m, nB=Math.abs(sy-(bb.y+bb.h))<m;
  const nL=Math.abs(sx-bb.x)<m,        nT=Math.abs(sy-bb.y)<m;
  let edge=null;
  if (nR&&nB) edge='br'; else if (nR&&nT) edge='tr';
  else if (nL&&nB) edge='bl'; else if (nL&&nT) edge='tl';
  else if (nR) edge='r'; else if (nB) edge='b'; else if (nL) edge='l'; else if (nT) edge='t';
  if (edge) return { type:'bbox-edge', edge };
  return { type:'bbox-body' };
}

/* ===== Main canvas render ===== */
function render() {
  ensureFrameNums();
  if (!S.img) return;
  cv.width = S.img.width*S.zoom; cv.height = S.img.height*S.zoom;
  cc.imageSmoothingEnabled = false;
  const z = S.zoom;
  cc.clearRect(0,0,cv.width,cv.height);

  /* checker */
  const cs = Math.max(6, z*2);
  for (let y=0; y<cv.height; y+=cs) for (let x=0; x<cv.width; x+=cs) {
    cc.fillStyle = ((x/cs+y/cs)&1) ? '#141418' : '#1a1a1f';
    cc.fillRect(x,y,cs,cs);
  }

  /* image */
  const a0 = (S.c0alpha != null ? S.c0alpha : 100) / 100;
  if (a0 >= 1 || !S.imgNoC0) {
    /* fully opaque color 0 (or no transparent version ready) */
    cc.drawImage(S.img, 0,0, S.img.width*z, S.img.height*z);
  } else {
    /* pass 1: full image with color 0 dimmed to a0 */
    cc.globalAlpha = a0;
    cc.drawImage(S.img, 0,0, S.img.width*z, S.img.height*z);
    cc.globalAlpha = 1;
    /* pass 2: everything except color 0, fully opaque */
    cc.drawImage(S.imgNoC0, 0,0, S.img.width*z, S.img.height*z);
  }

  /* grid */
  cc.strokeStyle='rgba(255,255,255,0.06)'; cc.lineWidth=1;
  for (let gx=0; gx<=S.img.width; gx+=8) {
    cc.beginPath(); cc.moveTo(gx*z+.5,0); cc.lineTo(gx*z+.5,cv.height); cc.stroke();
  }
  for (let gy=0; gy<=S.img.height; gy+=S.tileH) {
    cc.beginPath(); cc.moveTo(0,gy*z+.5); cc.lineTo(cv.width,gy*z+.5); cc.stroke();
  }
  if (S.tileH === 16) {
    cc.strokeStyle = 'rgba(255,255,255,0.025)';
    for (let gy=8; gy<S.img.height; gy+=16) {
      cc.beginPath(); cc.moveTo(0,gy*z+.5); cc.lineTo(cv.width,gy*z+.5); cc.stroke();
    }
  }

  /* ===== OVERVIEW pass: outlines of ALL frames in ALL animations,
     so the whole layout is visible without selecting anything.
     Skips the currently selected animation (drawn in detail below). */
  S.zones.forEach(zone => {
    if (zone.id === S.selZone) return;
    zone.frames.forEach((fr,fi) => {
      if (fr.ref) return; /* skip clones, geometry lives on the source */
      const col = zone.color;
      /* block outlines (full opacity, dashed) */
      fr.blocks.forEach(b => {
        cc.strokeStyle = col;
        cc.lineWidth = 1;
        cc.setLineDash([3,2]);
        cc.strokeRect(b.x*z, b.y*z, b.w*z, b.h*z);
        cc.setLineDash([]);
      });
      /* collision bbox (full opacity, solid, animation color) */
      const bb = getBBox(fr);
      if (bb) {
        cc.strokeStyle = col;
        cc.lineWidth = 1;
        cc.strokeRect(bb.x*z, bb.y*z, bb.w*z, bb.h*z);
      }
      /* anchor cross (red, like the original) */
      const a = getAnchor(fr);
      const ax = a.x*z, ay = a.y*z, arm = Math.max(5, z*2);
      cc.strokeStyle = '#ff0000';
      cc.lineWidth = 1;
      cc.beginPath();
      cc.moveTo(ax-arm,ay); cc.lineTo(ax+arm,ay);
      cc.moveTo(ax,ay-arm); cc.lineTo(ax,ay+arm);
      cc.stroke();
      cc.fillStyle = '#ff0000';
      cc.beginPath(); cc.arc(ax,ay,1.5,0,Math.PI*2); cc.fill();
      drawFrameLabel(fr,fi,col,false);
    });
  });

  /* blocks of selected animation */
  const zn = curZone();
  const selFrameSet = new Set(selectedFrameIds());
  const topBlockLabels = [];
  if (zn) zn.frames.forEach((fr,fi) => {
    if (fr.ref) return; /* don't draw clones (their source is shown elsewhere if selected) */
    const isCur = selFrameSet.has(fr.id);
    fr.blocks.forEach((b,bi) => {
      const isSel = isCur && b.id===S.selBlock;
      const isMulti = isCur && S.selBlocks && S.selBlocks.includes(b.id);
      const col = BCOL[bi%BCOL.length];

      cc.fillStyle = isCur ? col : col.replace('0.5','0.12');
      cc.fillRect(b.x*z, b.y*z, b.w*z, b.h*z);
      /* multi-selection tint overlay */
      if (isMulti) {
        cc.fillStyle = 'rgba(80,200,255,0.30)';
        cc.fillRect(b.x*z, b.y*z, b.w*z, b.h*z);
      }

      if (isCur) {
        cc.strokeStyle = 'rgba(255,255,255,0.15)'; cc.lineWidth = 1;
        for (let gx=b.x+8; gx<b.x+b.w; gx+=8) {
          cc.beginPath(); cc.moveTo(gx*z+.5,b.y*z); cc.lineTo(gx*z+.5,(b.y+b.h)*z); cc.stroke();
        }
        for (let gy=b.y+S.tileH; gy<b.y+b.h; gy+=S.tileH) {
          cc.beginPath(); cc.moveTo(b.x*z,gy*z+.5); cc.lineTo((b.x+b.w)*z,gy*z+.5); cc.stroke();
        }
      }

      cc.strokeStyle = isMulti ? '#3cf' : isSel ? '#fff' : isCur ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.2)';
      cc.lineWidth = (isMulti||isSel) ? 2.5 : isCur ? 1.5 : 1;
      cc.setLineDash(isCur ? [] : [3,3]);
      cc.strokeRect(b.x*z, b.y*z, b.w*z, b.h*z);
      cc.setLineDash([]);

      if (isCur) topBlockLabels.push({ b, isSel });

      if (isSel) {
        const hs = 5;
        cc.fillStyle = '#fff';
        cc.fillRect((b.x+b.w)*z-hs, (b.y+b.h)*z-hs, hs*2, hs*2);
        cc.fillRect(b.x*z-hs,        b.y*z-hs,        hs*2, hs*2);
        cc.fillRect((b.x+b.w)*z-hs, b.y*z-hs,         hs*2, hs*2);
        cc.fillRect(b.x*z-hs,        (b.y+b.h)*z-hs, hs*2, hs*2);
        const mx = b.x+b.w/2, my = b.y+b.h/2;
        cc.fillRect(mx*z-hs/2,        (b.y+b.h)*z-hs/2, hs, hs);
        cc.fillRect((b.x+b.w)*z-hs/2, my*z-hs/2,        hs, hs);
        cc.fillRect(mx*z-hs/2,        b.y*z-hs/2,        hs, hs);
        cc.fillRect(b.x*z-hs/2,       my*z-hs/2,        hs, hs);
      }
    });

    /* anchor cross */
    if (isCur) {
      const a = getAnchor(fr);
      const ax = a.x*z, ay = a.y*z, arm = Math.max(8, z*3);
      cc.save();
      cc.lineWidth = 3; cc.strokeStyle = 'rgba(0,0,0,0.5)';
      cc.beginPath();
      cc.moveTo(ax-arm,ay); cc.lineTo(ax+arm,ay);
      cc.moveTo(ax,ay-arm); cc.lineTo(ax,ay+arm);
      cc.stroke();
      cc.lineWidth = 1.5; cc.strokeStyle = '#ff0000';
      cc.beginPath();
      cc.moveTo(ax-arm,ay); cc.lineTo(ax+arm,ay);
      cc.moveTo(ax,ay-arm); cc.lineTo(ax,ay+arm);
      cc.stroke();
      cc.fillStyle = '#ff0000';
      cc.beginPath(); cc.arc(ax,ay,2.5,0,Math.PI*2); cc.fill();
      cc.restore();

      /* collision / size bbox (hidden in simple mode) */
      const bb = S.simpleMode ? null : getBBox(fr);
      if (bb) {
        const editing = S.bboxEdit;
        cc.save();
        cc.strokeStyle = editing ? '#00e0ff' : 'rgba(0,224,255,0.55)';
        cc.lineWidth = editing ? 2 : 1;
        cc.setLineDash(editing ? [] : [5,3]);
        cc.strokeRect(bb.x*z, bb.y*z, bb.w*z, bb.h*z);
        cc.setLineDash([]);
        if (editing) {
          /* resize handles */
          const hs = 5; cc.fillStyle = '#00e0ff';
          const xs = [bb.x, bb.x+bb.w/2, bb.x+bb.w];
          const ys = [bb.y, bb.y+bb.h/2, bb.y+bb.h];
          xs.forEach((hx,ix) => ys.forEach((hy,iy) => {
            if (ix===1 && iy===1) return; /* skip center */
            cc.fillRect(hx*z-hs, hy*z-hs, hs*2, hs*2);
          }));
          /* size label */
          cc.font = 'bold 10px monospace';
          const lbl = 'box '+bb.w+'×'+bb.h;
          const lw = cc.measureText(lbl).width;
          let lx = (bb.x+bb.w)*z + 3, ly = bb.y*z + 2;
          if (lx + lw + 4 > cv.width) lx = bb.x*z - lw - 7;
          if (lx < 0) lx = bb.x*z + 2;
          if (ly + 12 > cv.height) ly = cv.height - 13;
          if (ly < 0) ly = 1;
          cc.fillStyle = 'rgba(0,0,0,0.75)';
          cc.fillRect(lx, ly, lw+4, 12);
          cc.fillStyle = '#00e0ff';
          cc.fillText(lbl, lx+2, ly+10);
        }
        cc.restore();
      }
    }
    drawFrameLabel(fr,fi,zn.color,isCur);
  });
  topBlockLabels.filter(o => !o.isSel).concat(topBlockLabels.filter(o => o.isSel)).forEach(o => {
    const b = o.b, isSel = o.isSel;
    cc.font = 'bold 10px monospace';
    const lbl = b.w+'×'+b.h;
    const tw2 = cc.measureText(lbl).width;
    let lx = (b.x+b.w)*z + 3, ly = b.y*z + 2;
    if (lx + tw2 + 4 > cv.width) lx = b.x*z - tw2 - 7;
    if (lx < 0) lx = b.x*z + 2;
    if (ly + 12 > cv.height) ly = cv.height - 13;
    if (ly < 0) ly = 1;
    cc.fillStyle = 'rgba(0,0,0,0.85)';
    cc.fillRect(lx, ly, tw2+4, 12);
    cc.fillStyle = isSel ? '#fff' : '#ccc';
    cc.fillText(lbl, lx+2, ly+10);
  });

  /* drag-in-progress rectangle */
  if (S.action==='draw' && S.drag) {
    const r = dragRect();
    if (r) {
      cc.fillStyle = 'rgba(255,220,60,0.1)';
      cc.fillRect(r.x*z, r.y*z, r.w*z, r.h*z);
      cc.strokeStyle = 'rgba(255,220,60,0.8)'; cc.lineWidth = 2; cc.setLineDash([5,3]);
      cc.strokeRect(r.x*z, r.y*z, r.w*z, r.h*z);
      cc.setLineDash([]);
      cc.strokeStyle = 'rgba(255,220,60,0.25)'; cc.lineWidth = 1;
      for (let gx=r.x+8; gx<r.x+r.w; gx+=8) {
        cc.beginPath(); cc.moveTo(gx*z+.5,r.y*z); cc.lineTo(gx*z+.5,(r.y+r.h)*z); cc.stroke();
      }
      for (let gy=r.y+S.tileH; gy<r.y+r.h; gy+=S.tileH) {
        cc.beginPath(); cc.moveTo(r.x*z,gy*z+.5); cc.lineTo((r.x+r.w)*z,gy*z+.5); cc.stroke();
      }
      cc.fillStyle = '#ffe040'; cc.font = 'bold 11px monospace';
      const nt = (r.w/8)*(r.h/S.tileH);
      cc.fillText(r.w+'×'+r.h+' ('+nt+' tiles)', r.x*z+3, (r.y+r.h)*z+14);
    }
  }

  /* lasso selection rectangle */
  if (S.action==='lasso' && S.drag) {
    const x1=Math.min(S.drag.sx,S.drag.cx), y1=Math.min(S.drag.sy,S.drag.cy);
    const x2=Math.max(S.drag.sx,S.drag.cx), y2=Math.max(S.drag.sy,S.drag.cy);
    cc.fillStyle = 'rgba(60,200,255,0.12)';
    cc.fillRect(x1*z, y1*z, (x2-x1)*z, (y2-y1)*z);
    cc.strokeStyle = '#3cf'; cc.lineWidth = 1.5; cc.setLineDash([5,3]);
    cc.strokeRect(x1*z, y1*z, (x2-x1)*z, (y2-y1)*z);
    cc.setLineDash([]);
  }

  /* auto-cut region selection rectangle (pixel-precise) */
  if (S.action==='autocut' && S.drag) {
    const x1=Math.round(Math.min(S.drag.sx,S.drag.cx)), y1=Math.round(Math.min(S.drag.sy,S.drag.cy));
    const x2=Math.round(Math.max(S.drag.sx,S.drag.cx)), y2=Math.round(Math.max(S.drag.sy,S.drag.cy));
    const rw=x2-x1, rh=y2-y1;
    cc.fillStyle = 'rgba(0,230,140,0.12)';
    cc.fillRect(x1*z, y1*z, rw*z, rh*z);
    cc.strokeStyle = '#00e68c'; cc.lineWidth = 2; cc.setLineDash([6,3]);
    cc.strokeRect(x1*z, y1*z, rw*z, rh*z);
    cc.setLineDash([]);
    /* tile grid stepping FROM the region origin (matches the cut) */
    cc.strokeStyle = 'rgba(0,230,140,0.3)'; cc.lineWidth = 1;
    for (let gx=x1+8; gx<x2; gx+=8) { cc.beginPath(); cc.moveTo(gx*z+.5,y1*z); cc.lineTo(gx*z+.5,y2*z); cc.stroke(); }
    for (let gy=y1+S.tileH; gy<y2; gy+=S.tileH) { cc.beginPath(); cc.moveTo(x1*z,gy*z+.5); cc.lineTo(x2*z,gy*z+.5); cc.stroke(); }
    cc.fillStyle = '#00e68c'; cc.font = 'bold 11px monospace';
    cc.fillText('découpe auto '+rw+'×'+rh, x1*z+3, y1*z-4 < 12 ? y2*z+14 : y1*z-4);
  }

  /* ===== highlight occurrences of the selected tile-bank cell ===== */
  if (S.bankSel != null && bankCells[S.bankSel]) {
    const tw = 8, th = S.tileH;
    bankCells[S.bankSel].sources.forEach(src => {
      cc.save();
      /* pulsing-ish solid highlight */
      cc.fillStyle = 'rgba(255,204,0,0.25)';
      cc.fillRect(src.px*z, src.py*z, tw*z, th*z);
      cc.strokeStyle = '#ffcc00';
      cc.lineWidth = 2;
      cc.strokeRect(src.px*z+1, src.py*z+1, tw*z-2, th*z-2);
      /* mirror indicator */
      if (src.mirror && src.mirror !== 'none') {
        cc.fillStyle = '#ffcc00';
        cc.font = 'bold 9px monospace';
        cc.fillText(src.mirror.toUpperCase(), src.px*z+2, src.py*z+10);
      }
      cc.restore();
    });
  }

  renderBank();
  updateStats();
  updateBadge();
  if (!A.playing) renderPreview();
}

/* ===== Tile Bank ===== */
let bankCells = [];
let bankDisplay = [];
let lowBankCells = [];
let lowBankDisplay = [];
let bankGeom = { bw:16, tw:8, th:16, sc:2, cols:16 };
let lowBankGeom = { bw:16, tw:8, th:16, sc:2, cols:16 };
let bankResizeW = 0;
let bankResizeRAF = 0;

function tileOccupancy(buf) {
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };
  let used = 0, total = buf.length / 4;
  for (let i=0; i<buf.length; i+=4) if (!(buf[i]===c0.r && buf[i+1]===c0.g && buf[i+2]===c0.b && buf[i+3]===c0.a)) used++;
  return total ? used * 100 / total : 0;
}

function bankOccurrenceCount(i) {
  const c = bankCells[i];
  if (!c) return 0;
  const pos = new Set();
  c.sources.forEach(s => pos.add(s.px+','+s.py));
  return pos.size;
}

function bankTooltipText(i) {
  const c = bankCells[i], d = bankDisplay[i];
  if (!c || !d) return '';
  return 'Tile #'+i+'\nOccurrences : '+bankOccurrenceCount(i)+'\nOccupation : '+d.occ.toFixed(1)+'%';
}

function bankTileKeysForHostFrame(hostFrame, zone) {
  const { frame } = resolveFrame(hostFrame);
  const keys = new Set();
  if (!frame) return keys;
  const mirrors = ['none'];
  if (zone && zone.mirror && zone.mirror !== 'none') mirrors.push(zone.mirror);
  mirrors.forEach(m => {
    frame.blocks.forEach(b => {
      blockTileOrder(b, m).forEach(t => {
        const px = tilePx(t.px,t.py,m);
        keys.add(px.join(','));
      });
    });
  });
  return keys;
}

function getBankUsedCells() {
  const z = curZone();
  const keys = new Set();
  if (z) {
    const addFrameKeys = f => bankTileKeysForHostFrame(f,z).forEach(k=>keys.add(k));
    if (A.bankFrameId && z.frames.some(f=>f.id===A.bankFrameId)) {
      const f = z.frames.find(f=>f.id===A.bankFrameId);
      if (f) addFrameKeys(f);
    } else {
      const sel = selectedFrameIds();
      if (sel.length) sel.forEach(id => { const f = z.frames.find(fr=>fr.id===id); if (f) addFrameKeys(f); });
      else z.frames.forEach(addFrameKeys);
    }
  }
  const out = new Set();
  if (keys.size) bankDisplay.forEach((cell,i) => { if (keys.has(cell.key)) out.add(i); });
  return out;
}

function drawBankCanvas(canvas, ctx, display, geom, usedCells, dimOthers) {
  const bw = geom.bw, tw = geom.tw, th = geom.th, sc = geom.sc;
  const rows = Math.max(1, Math.ceil(display.length / bw));
  canvas.width = bw * tw * sc;
  canvas.height = rows * th * sc;
  ctx.imageSmoothingEnabled = false;
  for (let y=0; y<canvas.height; y+=6) for (let x=0; x<canvas.width; x+=6) {
    ctx.fillStyle = ((x/6+y/6)&1) ? '#141418' : '#1a1a1f';
    ctx.fillRect(x,y,6,6);
  }
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  const tc = tmp.getContext('2d');
  display.forEach((t,i) => {
    tc.putImageData(new ImageData(t.buf,tw,th),0,0);
    ctx.drawImage(tmp,(i%bw)*tw*sc,Math.floor(i/bw)*th*sc,tw*sc,th*sc);
  });
  if (dimOthers) display.forEach((t,i) => {
    const mi = t.mainIdx == null ? i : t.mainIdx;
    if (usedCells.has(mi)) return;
    const cx = (i % bw) * tw * sc, cy = Math.floor(i / bw) * th * sc;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(cx,cy,tw*sc,th*sc);
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let x=0; x<=canvas.width; x+=8*sc) { ctx.beginPath(); ctx.moveTo(x+.5,0); ctx.lineTo(x+.5,canvas.height); ctx.stroke(); }
  for (let y=0; y<=canvas.height; y+=8*sc) { ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(canvas.width,y+.5); ctx.stroke(); }
  if (th > 8) {
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    for (let y=0; y<=canvas.height; y+=th*sc) { ctx.beginPath(); ctx.moveTo(0,y+.5); ctx.lineTo(canvas.width,y+.5); ctx.stroke(); }
  }
  display.forEach((t,i) => {
    const mi = t.mainIdx == null ? i : t.mainIdx;
    if (!usedCells.has(mi)) return;
    const cx = (i % bw) * tw * sc, cy = Math.floor(i / bw) * th * sc;
    ctx.fillStyle = 'rgba(60,200,255,0.18)';
    ctx.fillRect(cx,cy,tw*sc,th*sc);
    ctx.strokeStyle = '#3cc8ff'; ctx.lineWidth = 2;
    ctx.strokeRect(cx+1,cy+1,tw*sc-2,th*sc-2);
  });
  display.forEach((t,i) => {
    const mi = t.mainIdx == null ? i : t.mainIdx;
    if (S.bankSel !== mi) return;
    const cx = (i % bw) * tw * sc, cy = Math.floor(i / bw) * th * sc;
    ctx.fillStyle = 'rgba(255,204,0,0.16)';
    ctx.fillRect(cx,cy,tw*sc,th*sc);
    ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2;
    ctx.strokeRect(cx+1,cy+1,tw*sc-2,th*sc-2);
  });
}

function renderBank() {
  if (!S.imgData) {
    tpCv.width=1; tpCv.height=1;
    if (lowCv) { lowCv.width=1; lowCv.height=1; }
    const lb = document.getElementById('lowTileBankBox');
    if (lb) lb.style.display = 'none';
    return;
  }
  const allT = allTilesWithMirror();
  const tw = 8, th = S.tileH, sc = 2;
  const parent = tpCv.parentElement;
  const avail = parent ? Math.max(1, parent.clientWidth - 2) : 256;
  bankResizeW = avail;
  const bw = Math.max(1, Math.floor(avail / (tw * sc)));
  const dedup = document.getElementById('optDedup').checked;
  const seen = new Map();
  bankDisplay = [];
  bankCells = [];
  allT.forEach(t => {
    const px = tilePx(t.px,t.py,t.mirror);
    const key = px.join(',');
    const src = { px:t.px, py:t.py, mirror:t.mirror, animId:t.animId, frameId:t.frameId };
    if (dedup) {
      if (seen.has(key)) {
        bankCells[seen.get(key)].sources.push(src);
      } else {
        const occ = tileOccupancy(px);
        seen.set(key,bankDisplay.length);
        bankDisplay.push({ buf:px, occ, key });
        bankCells.push({ sources:[src], occ });
      }
    } else {
      const occ = tileOccupancy(px);
      bankDisplay.push({ buf:px, occ, key });
      bankCells.push({ sources:[src], occ });
    }
  });
  bankGeom = { bw, tw, th, sc, cols:bw };
  const frameUsedCells = getBankUsedCells();
  drawBankCanvas(tpCv,tpC,bankDisplay,bankGeom,frameUsedCells,!!frameUsedCells.size);
  const sl = document.getElementById('lowOccSlider');
  const val = document.getElementById('lowOccVal');
  const lb = document.getElementById('lowTileBankBox');
  const li = document.getElementById('lowTileInfo');
  const threshold = clamp(parseInt(S.lowOccThreshold || (sl ? sl.value : 10)) || 10,1,50);
  S.lowOccThreshold = threshold;
  if (sl) sl.value = threshold;
  if (val) val.textContent = threshold + '%';
  lowBankDisplay = [];
  lowBankCells = [];
  bankDisplay.forEach((t,i) => {
    if (t.occ < threshold) {
      lowBankDisplay.push({ buf:t.buf, occ:t.occ, key:t.key, mainIdx:i });
      lowBankCells.push({ sources:bankCells[i].sources, occ:t.occ, mainIdx:i });
    }
  });
  if (lb) lb.style.display = 'block';
  if (lowCv && lowC) {
    if (lowBankDisplay.length) {
      lowCv.style.display = 'block';
      lowBankGeom = { bw, tw, th, sc, cols:bw };
      drawBankCanvas(lowCv,lowC,lowBankDisplay,lowBankGeom,frameUsedCells,!!frameUsedCells.size);
      if (li) li.textContent = window.mt ? mt('{n} tile{s} sous le seuil', {n:lowBankDisplay.length, s:lowBankDisplay.length>1?'s':''}) : lowBankDisplay.length + ' tile' + (lowBankDisplay.length>1?'s':'') + ' sous le seuil';
    } else {
      lowCv.style.display = 'none';
      if (li) li.textContent = '';
    }
  }
  document.getElementById('stT').textContent = allT.length;
  document.getElementById('stU').textContent = (dedup ? seen.size : bankDisplay.length) + (dedup ? ' ' + (window.mt ? mt('(affiché{s})', {s:seen.size>1?'s':''}) : '(affiché'+(seen.size>1?'s':'')+')') : '');
  const slotsPerTile = (S.tileH === 16) ? 2 : 1;
  const nSlots = bankDisplay.length * slotsPerTile;
  const rangeEl = document.getElementById('stRange');
  const dynamic = (S.alloc === 'dynamic');
  if (bankDisplay.length) {
    if (dynamic) {
      let maxFrameSlots = 0;
      S.zones.forEach(z => z.frames.forEach(f => {
        if (f.ref) return;
        let t = 0;
        f.blocks.forEach(b => t += (b.w/8) * (b.h/S.tileH));
        const slots = t * slotsPerTile;
        if (slots > maxFrameSlots) maxFrameSlots = slots;
      }));
      const end = S.startTile + Math.max(maxFrameSlots,1) - 1;
      rangeEl.innerHTML = S.startTile + '–' + end +
        ' <span style="color:var(--text2)">(frame max : ' + maxFrameSlots + ' slots)</span>' +
        (end>447 ? ' <span style="color:var(--red)">⚠</span>' : '') +
        (S.tileH === 16 ? ' <span style="background:rgba(240,160,48,0.18);color:var(--orange);padding:0 4px;border-radius:2px;font-weight:bold">8×16 ×2</span>' : '');
    } else {
      const end = S.startTile + nSlots - 1;
      rangeEl.innerHTML = S.startTile + '–' + end + (end>447 ? ' <span style="color:var(--red)">⚠</span>' : '') +
        (S.tileH === 16 ? ' <span style="background:rgba(240,160,48,0.18);color:var(--orange);padding:0 4px;border-radius:2px;font-weight:bold">8×16 ×2</span>' : '');
    }
  } else {
    rangeEl.textContent = '—';
  }
  const wEl = document.getElementById('stWeight');
  if (wEl) {
    wEl.style.color = '';
    wEl.title = '';
    if (bankDisplay.length) {
      const bytes = bankDisplay.length * slotsPerTile * 32;
      const kb = (bytes/1024).toFixed(2);
      if (bytes > 16384) {
        wEl.innerHTML = kb + ' kB (' + bytes + ' bytes) <span style="color:var(--red);font-weight:bold">⚠ &gt;16Ko</span>';
        wEl.style.color = 'var(--red)';
        wEl.title = 'Warning : le BIN dépasse 16Ko / 16384 bytes';
      } else {
        wEl.textContent = kb + ' kB (' + bytes + ' bytes)';
      }
    } else {
      wEl.textContent = '—';
    }
  }
  applyBankDisplayScale();
}

function scaleBankCanvas(canvas, parent) {
  if (!canvas || !canvas.width || canvas.style.display === 'none') return;
  const p = parent || canvas.parentElement;
  if (!p) return;
  const avail = Math.max(1, p.clientWidth - 2);
  canvas.style.width = avail + 'px';
  canvas.style.height = (canvas.height * (avail / canvas.width)) + 'px';
}

function applyBankDisplayScale() {
  scaleBankCanvas(tpCv);
  scaleBankCanvas(lowCv,tpCv ? tpCv.parentElement : null);
}

function scheduleBankResize() {
  if (!tpCv || !tpCv.parentElement || !S.imgData) return;
  const w = Math.max(1, tpCv.parentElement.clientWidth - 2);
  if (Math.abs(w - bankResizeW) < 1) { applyBankDisplayScale(); return; }
  if (bankResizeRAF) cancelAnimationFrame(bankResizeRAF);
  bankResizeRAF = requestAnimationFrame(() => {
    bankResizeRAF = 0;
    renderBank();
  });
}

function setLowOccThreshold(v) {
  S.lowOccThreshold = clamp(parseInt(v)||10,1,50);
  renderBank();
}

function updateStats() {
  let fc = 0;
  S.zones.forEach(z => fc += z.frames.length);
  document.getElementById('stZ').textContent = S.zones.length;
  document.getElementById('stF').textContent = fc;
}

function updateBadge() {
  const el = document.getElementById('badge');
  const f = curFrame();
  if (f) {
    const { frame, isClone } = resolveFrame(f);
    if (frame) {
      const a = getAnchor(frame);
      el.textContent = (isClone?'↳ ':'') + f.name + ' | ancre '+a.x+','+a.y;
      el.className = 'badge editing';
    } else {
      el.textContent = f.name + ' (ref. invalide)';
      el.className = 'badge idle';
    }
  } else {
    el.textContent = '—';
    el.className = 'badge idle';
  }
}
