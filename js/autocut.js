/* ================================================================
   AUTOCUT — automatic block decomposition of a frame
   ================================================================
   JavaScript port of render_cut.py, kept in the same integration shape
   as the original autocut.js file.

   Public entry points kept for the editor:
   - armAutoCut()
   - autoCutWholeSheet()
   - autoCutWholeSheetNew()
   - applyAutoCut(region, quiet)

   Core strategy:
   - detect connected sprites with a configurable gap tolerance;
   - recursively split each sprite's pixel-tight bbox on promising X/Y cuts;
   - minimise tile count first, then peak sprites per scanline, then block count;
   - merge adjacent tile rectangles;
   - float blocks over transparent slack while preserving covered content.

   Cell = 8 (wide) × S.tileH (8 or 16) tall.
   A pixel is filled if its RGBA value differs from palette[0].
   ================================================================ */

const AUTOCUT_VERSION = 'v1.1.0-render-cut-port';
const AUTOCUT_BUILD   = '2026-06-24 21:33:00';
try { console.log('[autocut] ' + AUTOCUT_VERSION + ' — build ' + AUTOCUT_BUILD); } catch(e) {}

/* ----------------------------------------------------------------
   Low-level image helpers
   ---------------------------------------------------------------- */

function tileW() { return 8; }
function tileH() { return Math.max(1, S.tileH || 16); }

/* Is the pixel at (x,y) non-transparent / non-background? */
function pxFilled(x, y, c0) {
  const iw = S.imgData.width, ih = S.imgData.height;
  if (x < 0 || y < 0 || x >= iw || y >= ih) return false;
  const d = S.imgData.data, si = (y * iw + x) * 4;
  return !(d[si] === c0.r && d[si+1] === c0.g && d[si+2] === c0.b && d[si+3] === c0.a);
}

/* Pixel-tight bbox of non-background content inside `region`.
   Returns {x,y,w,h} or null if empty. */
function contentBBox(region) {
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };
  const iw = S.imgData.width, ih = S.imgData.height;
  const rx0 = Math.max(0, Math.floor(region.x));
  const ry0 = Math.max(0, Math.floor(region.y));
  const rx1 = Math.min(iw, Math.ceil(region.x + region.w));
  const ry1 = Math.min(ih, Math.ceil(region.y + region.h));
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;

  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      if (pxFilled(x, y, c0)) {
        if (x < x1) x1 = x; if (y < y1) y1 = y;
        if (x > x2) x2 = x; if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < x1) return null;
  return { x:x1, y:y1, w:x2-x1+1, h:y2-y1+1 };
}

function clampI(v, lo, hi) {
  if (hi < lo) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
}

function tupleLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/* ----------------------------------------------------------------
   Sprite detection — direct port of render_cut.py:detect()
   ---------------------------------------------------------------- */

function detectSprites(region) {
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };
  const rx = Math.max(0, Math.floor(region.x));
  const ry = Math.max(0, Math.floor(region.y));
  const rw = Math.max(0, Math.min(S.imgData.width  - rx, Math.ceil(region.w)));
  const rh = Math.max(0, Math.min(S.imgData.height - ry, Math.ceil(region.h)));
  if (!rw || !rh) return [];

  const filled = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      if (pxFilled(rx + x, ry + y, c0)) filled[y*rw + x] = 1;
    }
  }

  const lab = new Int32Array(rw * rh);
  lab.fill(-1);
  const boxes = [];
  const stack = [];
  const R = Math.max(1, S.cutGap || 2);

  for (let sy = 0; sy < rh; sy++) {
    for (let sx = 0; sx < rw; sx++) {
      const i = sy * rw + sx;
      if (!filled[i] || lab[i] >= 0) continue;

      const idn = boxes.length;
      let x1 = sx, y1 = sy, x2 = sx, y2 = sy;
      lab[i] = idn;
      stack.length = 0;
      stack.push(i);

      while (stack.length) {
        const idx = stack.pop();
        const cx = idx % rw;
        const cy = (idx / rw) | 0;
        if (cx < x1) x1 = cx; if (cx > x2) x2 = cx;
        if (cy < y1) y1 = cy; if (cy > y2) y2 = cy;

        for (let dy = -R; dy <= R; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= rh) continue;
          for (let dx = -R; dx <= R; dx++) {
            const nx = cx + dx;
            if (nx < 0 || nx >= rw) continue;
            const ni = ny * rw + nx;
            if (filled[ni] && lab[ni] < 0) {
              lab[ni] = idn;
              stack.push(ni);
            }
          }
        }
      }
      boxes.push({ x:rx+x1, y:ry+y1, w:x2-x1+1, h:y2-y1+1 });
    }
  }
  return boxes;
}

/* ----------------------------------------------------------------
   Recursive solver — direct JavaScript port of render_cut.py:solve()
   ---------------------------------------------------------------- */

function solveRenderCut(region) {
  const tw = tileW(), th = tileH();
  const iw = S.imgData.width, ih = S.imgData.height;
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };

  function filled(x, y) { return pxFilled(x, y, c0); }

  function tight(x1, y1, x2, y2) {
    x1 = clampI(Math.floor(x1), 0, iw - 1);
    y1 = clampI(Math.floor(y1), 0, ih - 1);
    x2 = clampI(Math.floor(x2), 0, iw - 1);
    y2 = clampI(Math.floor(y2), 0, ih - 1);
    if (x2 < x1 || y2 < y1) return null;

    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        if (filled(x, y)) {
          if (x < ax) ax = x; if (y < ay) ay = y;
          if (x > bx) bx = x; if (y > by) by = y;
        }
      }
    }
    return bx < ax ? null : { x1:ax, y1:ay, x2:bx, y2:by };
  }

  const rx = Math.max(0, Math.floor(region.x));
  const ry = Math.max(0, Math.floor(region.y));
  const rw = Math.max(0, Math.ceil(region.w));
  const rh = Math.max(0, Math.ceil(region.h));
  const bb0 = tight(rx, ry, rx + rw - 1, ry + rh - 1);
  if (!bb0) return [];

  const BBY1 = bb0.y1, BBY2 = bb0.y2;

  function tilesOf(bl) {
    let n = 0;
    for (let i = 0; i < bl.length; i++) n += bl[i][2] * bl[i][3];
    return n;
  }

  function peakTile(bl) {
    if (!bl.length) return 0;
    let worst = 0;
    for (let y = BBY1; y <= BBY2; y++) {
      let s = 0;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b[1] <= y && y < b[1] + b[3] * th) s += b[2];
      }
      if (s > worst) worst = s;
    }
    return worst;
  }

  function rowWidth(x1, x2, y) {
    let a = Infinity, b = -Infinity;
    for (let x = x1; x <= x2; x++) {
      if (filled(x, y)) { if (x < a) a = x; if (x > b) b = x; }
    }
    return b < a ? 0 : b - a + 1;
  }

  const memo = Object.create(null);

  function rec(x1, y1, x2, y2) {
    const t = tight(x1, y1, x2, y2);
    if (!t) return [];
    x1 = t.x1; y1 = t.y1; x2 = t.x2; y2 = t.y2;

    const key = x1 + ',' + y1 + ',' + x2 + ',' + y2;
    if (memo[key]) return memo[key].map(b => b.slice());

    const cw = x2 - x1 + 1;
    const ch = y2 - y1 + 1;
    const nC = Math.ceil(cw / tw);
    const nR = Math.ceil(ch / th);

    let best = [[x1, y1, nC, nR]];
    let bestKey = [nC * nR, peakTile(best), 1];

    const ys = new Set();
    for (let k = 1; k <= Math.floor(ch / th); k++) {
      ys.add(y1 + k * th);
      ys.add(y2 + 1 - k * th);
    }
    /* Faithful to render_cut.py: also test 8px-spaced horizontal cuts. */
    for (let k = 1; k <= Math.floor(ch / tw); k++) {
      ys.add(y1 + k * tw);
      ys.add(y2 + 1 - k * tw);
    }

    let prevw = null;
    for (let y = y1; y <= y2; y++) {
      const wnow = rowWidth(x1, x2, y);
      if (prevw !== null && Math.abs(wnow - prevw) >= 6) ys.add(y);
      prevw = wnow;
    }

    const yCuts = Array.from(ys).filter(s => y1 < s && s <= y2).sort((a,b) => a-b);
    for (let i = 0; i < yCuts.length; i++) {
      const sy = yCuts[i];
      const sol = rec(x1, y1, x2, sy - 1).concat(rec(x1, sy, x2, y2));
      const k = [tilesOf(sol), peakTile(sol), sol.length];
      if (tupleLess(k, bestKey)) { bestKey = k; best = sol; }
    }

    const xs = new Set();
    for (let k = 1; k <= Math.floor(cw / tw); k++) {
      xs.add(x1 + k * tw);
      xs.add(x2 + 1 - k * tw);
    }
    const xCuts = Array.from(xs).filter(s => x1 < s && s <= x2).sort((a,b) => a-b);
    for (let i = 0; i < xCuts.length; i++) {
      const sx = xCuts[i];
      const sol = rec(x1, y1, sx - 1, y2).concat(rec(sx, y1, x2, y2));
      const k = [tilesOf(sol), peakTile(sol), sol.length];
      if (tupleLess(k, bestKey)) { bestKey = k; best = sol; }
    }

    memo[key] = best.map(b => b.slice());
    return best.map(b => b.slice());
  }

  function mergeTileBlocks(bl) {
    bl = bl.map(b => b.slice());
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < bl.length; i++) {
        for (let j = i + 1; j < bl.length; j++) {
          const a = bl[i], b = bl[j];
          if (a[1] === b[1] && a[3] === b[3] &&
              (a[0] + a[2] * tw === b[0] || b[0] + b[2] * tw === a[0])) {
            bl[i] = [Math.min(a[0], b[0]), a[1], a[2] + b[2], a[3]];
            bl.splice(j, 1);
            changed = true;
            break outer;
          }
          if (a[0] === b[0] && a[2] === b[2] &&
              (a[1] + a[3] * th === b[1] || b[1] + b[3] * th === a[1])) {
            bl[i] = [a[0], Math.min(a[1], b[1]), a[2], a[3] + b[3]];
            bl.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    return bl;
  }

  let sol = mergeTileBlocks(rec(bb0.x1, bb0.y1, bb0.x2, bb0.y2));
  let blk = sol.map(b => ({ x:b[0], y:b[1], w:b[2]*tw, h:b[3]*th }));

  function peakP(bl) {
    if (!bl.length) return 0;
    let y0 = Infinity, y1 = -Infinity, worst = 0;
    for (let i = 0; i < bl.length; i++) {
      y0 = Math.min(y0, bl[i].y);
      y1 = Math.max(y1, bl[i].y + bl[i].h);
    }
    for (let y = y0; y < y1; y++) {
      let s = 0;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.y <= y && y < b.y + b.h) s += b.w / tw;
      }
      if (s > worst) worst = s;
    }
    return worst;
  }

  function coveredByOthers(bi, x, y) {
    for (let k = 0; k < blk.length; k++) {
      if (k === bi) continue;
      const o = blk[k];
      if (o.x <= x && x < o.x + o.w && o.y <= y && y < o.y + o.h) return true;
    }
    return false;
  }

  function uniqueContent(bi, b) {
    const pts = [];
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(iw, b.x + b.w), y1 = Math.min(ih, b.y + b.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (filled(x, y) && !coveredByOthers(bi, x, y)) pts.push([x, y]);
      }
    }
    return pts;
  }

  function rectOverlapArea(bi, b) {
    let a = 0;
    for (let k = 0; k < blk.length; k++) {
      if (k === bi) continue;
      const o = blk[k];
      const ix = Math.max(0, Math.min(b.x+b.w, o.x+o.w) - Math.max(b.x, o.x));
      const iy = Math.max(0, Math.min(b.y+b.h, o.y+o.h) - Math.max(b.y, o.y));
      a += ix * iy;
    }
    return a;
  }

  /* Re-anchor blocks over transparent margin to reduce the peak first, then
     reduce visual rectangle overlap. */
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let bi = 0; bi < blk.length; bi++) {
      const b = blk[bi];
      const pts = uniqueContent(bi, b);
      if (!pts.length) continue;

      let ux0 = Infinity, ux1 = -Infinity, uy0 = Infinity, uy1 = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const x = pts[i][0], y = pts[i][1];
        if (x < ux0) ux0 = x; if (x > ux1) ux1 = x;
        if (y < uy0) uy0 = y; if (y > uy1) uy1 = y;
      }

      const minY = Math.max(0, uy1 - b.h + 1);
      const maxY = Math.min(ih - b.h, uy0);
      const minX = Math.max(0, ux1 - b.w + 1);
      const maxX = Math.min(iw - b.w, ux0);

      const curX = b.x, curY = b.y;
      let bestX = curX, bestY = curY;
      let bestScore = [peakP(blk), rectOverlapArea(bi, b)];

      const yFrom = maxY >= minY ? minY : curY;
      const yTo   = maxY >= minY ? maxY : curY;
      const xFrom = maxX >= minX ? minX : curX;
      const xTo   = maxX >= minX ? maxX : curX;

      for (let ny = yFrom; ny <= yTo; ny++) {
        for (let nx = xFrom; nx <= xTo; nx++) {
          b.x = nx; b.y = ny;
          const sc = [peakP(blk), rectOverlapArea(bi, b)];
          if (tupleLess(sc, bestScore)) { bestScore = sc; bestX = nx; bestY = ny; }
        }
      }
      b.x = bestX; b.y = bestY;
      if (bestX !== curX || bestY !== curY) moved = true;
    }
    if (!moved) break;
  }

  function ownContentY(b) {
    let y1 = Infinity, y2 = -Infinity;
    const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
    const x1 = Math.min(iw, b.x + b.w), yy1 = Math.min(ih, b.y + b.h);
    for (let y = y0; y < yy1; y++) {
      for (let x = x0; x < x1; x++) {
        if (filled(x, y)) { if (y < y1) y1 = y; if (y > y2) y2 = y; }
      }
    }
    return y2 < y1 ? [b.y, b.y + b.h - 1] : [y1, y2];
  }

  function rectOverlaps(bl) {
    let n = 0;
    for (let i = 0; i < bl.length; i++) {
      for (let j = i + 1; j < bl.length; j++) {
        if (rectsIntersect(bl[i], bl[j])) n++;
      }
    }
    return n;
  }

  /* Vertical relax: float each block over empty space to remove rectangle
     overlap where possible, then reduce scanline peak. */
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < blk.length; i++) {
      const b = blk[i];
      const oc = ownContentY(b);
      const minY = Math.max(0, oc[1] - b.h + 1);
      const maxY = Math.min(ih - b.h, oc[0]);
      const cur = b.y;
      let bestY = cur;
      let bestScore = [rectOverlaps(blk), peakP(blk)];
      for (let ny = minY; ny <= maxY; ny++) {
        b.y = ny;
        const sc = [rectOverlaps(blk), peakP(blk)];
        if (tupleLess(sc, bestScore)) { bestScore = sc; bestY = ny; }
      }
      b.y = bestY;
      if (bestY !== cur) improved = true;
    }
    if (!improved) break;
  }

  return sanitizeBlocks(blk);
}

function sanitizeBlocks(blocks) {
  const iw = S.imgData.width, ih = S.imgData.height;
  return blocks
    .filter(b => b && b.w > 0 && b.h > 0)
    .map(b => {
      const w = Math.max(tileW(), Math.round(b.w / tileW()) * tileW());
      const h = Math.max(tileH(), Math.round(b.h / tileH()) * tileH());
      return {
        x: clampI(Math.round(b.x), 0, Math.max(0, iw - w)),
        y: clampI(Math.round(b.y), 0, Math.max(0, ih - h)),
        w: Math.min(w, Math.max(tileW(), Math.ceil(iw / tileW()) * tileW())),
        h: Math.min(h, Math.max(tileH(), Math.ceil(ih / tileH()) * tileH()))
      };
    });
}

/* ----------------------------------------------------------------
   Compatibility helpers retained from the original JS shape
   ---------------------------------------------------------------- */

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}

function blocksShareContent(a, b) {
  if (!rectsIntersect(a, b)) return false;
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x+a.w, b.x+b.w), y2 = Math.min(a.y+a.h, b.y+b.h);
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      if (pxFilled(x, y, c0)) return true;
    }
  }
  return false;
}

function disallowedOverlaps(blocks) {
  const mode = normalizeCutOverlap(S.cutOverlap);
  if (mode === 'yes') return 0;
  let n = 0;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (rectsIntersect(blocks[i], blocks[j])) n++;
    }
  }
  return n;
}

function maxSpritesPerLine(blocks) {
  if (!blocks.length) return 0;
  let ymin = Infinity, ymax = -Infinity;
  blocks.forEach(b => { ymin = Math.min(ymin, b.y); ymax = Math.max(ymax, b.y + b.h); });
  let worst = 0;
  for (let y = ymin; y < ymax; y++) {
    let n = 0;
    blocks.forEach(b => { if (y >= b.y && y < b.y + b.h) n += Math.ceil(b.w / 8); });
    if (n > worst) worst = n;
  }
  return worst;
}

function occupancyAt(ox, oy, xEnd, yEnd) {
  const tw = tileW(), th = tileH();
  const c0 = S.pal[0] || { r:0, g:0, b:0, a:0 };
  const cols = Math.max(0, Math.ceil((xEnd - ox) / tw));
  const rows = Math.max(0, Math.ceil((yEnd - oy) / th));
  const occ = new Uint8Array(cols * rows);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let filled = 0;
      const x0 = ox + rx * tw, y0 = oy + ry * th;
      for (let y = 0; y < th && !filled; y++) {
        for (let x = 0; x < tw; x++) {
          if (pxFilled(x0+x, y0+y, c0)) { filled = 1; break; }
        }
      }
      occ[ry*cols + rx] = filled;
    }
  }
  return { cols, rows, occ, tw, th, ox, oy };
}

function bestOccupancy(region) {
  const bb = contentBBox(region);
  if (!bb) return null;
  const tw = tileW(), th = tileH();
  let best = null;
  for (let phx = 0; phx < tw; phx++) {
    for (let phy = 0; phy < th; phy++) {
      const ox = bb.x - phx;
      const oy = bb.y - phy;
      const grid = occupancyAt(ox, oy, bb.x + bb.w, bb.y + bb.h);
      let count = 0;
      for (let i = 0; i < grid.occ.length; i++) count += grid.occ[i];
      if (!best || count < best.count) best = { grid, count };
    }
  }
  return best ? best.grid : null;
}

function gridPartitionBlocks(region) {
  const g = bestOccupancy(region);
  if (!g) return [];
  const { cols, rows, occ, tw, th, ox, oy } = g;
  const used = new Uint8Array(cols * rows);
  const at = (r, c) => occ[r*cols + c];
  const blocks = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!at(r, c) || used[r*cols+c]) continue;
      let w = 1;
      while (c+w < cols && at(r, c+w) && !used[r*cols+(c+w)]) w++;
      let h = 1, grow = true;
      while (grow && r+h < rows) {
        for (let k = 0; k < w; k++) {
          if (!at(r+h, c+k) || used[(r+h)*cols+(c+k)]) { grow = false; break; }
        }
        if (grow) h++;
      }
      for (let rr = r; rr < r+h; rr++) for (let cc = c; cc < c+w; cc++) used[rr*cols+cc] = 1;
      blocks.push({ x:ox+c*tw, y:oy+r*th, w:w*tw, h:h*th });
    }
  }
  return sanitizeBlocks(blocks);
}

function forceNoRectOverlap(blocks, region) {
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (rectsIntersect(blocks[i], blocks[j])) {
        const grid = gridPartitionBlocks(region);
        if (grid.length) return grid;
        return blocks;
      }
    }
  }
  return blocks;
}

/* Legacy names kept as wrappers for code that may still reference them. */
function autoCutDynamic(gridIgnored, region) { return solveRenderCut(region); }
function autoCutDynamicH(region) { return solveRenderCut(region); }
function autoCutDynamicOverlap(region) { return solveRenderCut(region); }
function autoCutDynamicGrid(grid) {
  if (!grid) return [];
  return gridPartitionBlocks({ x:grid.ox, y:grid.oy, w:grid.cols*grid.tw, h:grid.rows*grid.th });
}
function autoCutPreload(grid) { return autoCutDynamicGrid(grid); }
function optimizeBlock(b) { return [b]; }
function optimizeBlocks(blocks) { return blocks.slice(); }
function trimBlock(b) { return b; }
function relaxVerticalOverlap(blocks) { return blocks; }

/* ----------------------------------------------------------------
   Editor integration — same public structure as autocut.js
   ---------------------------------------------------------------- */

function armAutoCut() {
  if (S.simpleMode) { toast('Indisponible en mode simple'); return; }
  if (!S.imgData) { toast(window.mt ? mt('Aucune image') : 'Aucune image'); return; }
  const f = curFrame();
  if (!f || f.ref) { toast('Sélectionner une frame (non clonée)'); return; }
  S.autoCutArm = !S.autoCutArm;
  if (S.autoCutArm) S.bboxEdit = false;
  ui(); render();
  if (S.autoCutArm) toast('Dessinez la zone de découpe automatique');
}

let autoCutAllBusy = false;
function setAutoCutAllBusy(on) {
  const b = document.getElementById('btnAutoCutAll');
  const ov = document.getElementById('busyOverlay');
  if (b) {
    b.disabled = on;
    b.innerHTML = on ? '<span class="spin"></span>Découpe en cours…' : '&#9986; Découper toute la planche';
  }
  if (ov) {
    ov.classList.toggle('on', on);
    ov.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
}
function autoCutWholeSheetNew() {
  if (autoCutAllBusy) return;
  if (S.simpleMode) { toast('Indisponible en mode simple'); return; }
  if (!S.imgData) { toast(window.mt ? mt('Aucune image') : 'Aucune image'); return; }
  autoCutAllBusy = true;
  setAutoCutAllBusy(true);
  requestAnimationFrame(() => setTimeout(() => {
    try { autoCutWholeSheetNewRun(); }
    finally { autoCutAllBusy = false; setAutoCutAllBusy(false); }
  }, 0));
}
function autoCutWholeSheetNewRun() {
  const region = { x:0, y:0, w:S.imgData.width, h:S.imgData.height };
  const sprites = detectSprites(region);
  if (!sprites.length) { toast('Aucun sprite détecté'); return; }
  sprites.sort((a,b) => (a.y - b.y) || (a.x - b.x));
  const z = { id:uid(), name:'anim_auto', color:ZCOL[S.zones.length % ZCOL.length], mirror:'none', loop:true, frames:[] };
  S.zones.push(z);
  S.selZone = z.id;
  let totalBlocks = 0, totalTiles = 0;
  sprites.forEach((sp, i) => {
    const fr = { id:uid(), num:nextFrameNum(), name:'frame '+i, blocks:[], ax:null, ay:null, delay:8, bbox:null, attr:0 };
    z.frames.push(fr);
    setFrameSelection([fr.id], fr.id);
    applyAutoCut({ x:sp.x, y:sp.y, w:sp.w, h:sp.h }, true);
    totalBlocks += fr.blocks.length;
    fr.blocks.forEach(b => { totalTiles += (b.w / 8) * (b.h / tileH()); });
  });
  z.frames = z.frames.filter(fr => fr.blocks.length > 0);
  z.frames.forEach((fr, i) => { fr.name = 'frame ' + i; });
  S.selZone = null;
  clearFrameSelection();
  S.bankSel = null; S.lowBankSel = null;
  ui(); render();
  const nf = z.frames.length;
  toast(nf + ' sprite' + (nf>1?'s':'') + ' → ' + nf + ' frame' + (nf>1?'s':'') + ', ' + totalBlocks + ' bloc' + (totalBlocks>1?'s':'') + ', ' + totalTiles + ' tile' + (totalTiles>1?'s':''));
}

function autoCutWholeSheet() {
  if (S.simpleMode) { toast('Indisponible en mode simple'); return; }
  if (!S.imgData) { toast(window.mt ? mt('Aucune image') : 'Aucune image'); return; }
  const f = curFrame();
  if (!f || f.ref) { toast('Sélectionner une frame (non clonée)'); return; }
  S.autoCutArm = false;
  applyAutoCut({ x:0, y:0, w:S.imgData.width, h:S.imgData.height });
}

function applyAutoCut(region, quiet) {
  S.autoCutArm = false;
  const f = curFrame();
  if (!f || f.ref) { ui(); render(); return; }
  if (!region || region.w < 4 || region.h < 4) { ui(); render(); return; }

  const bb = contentBBox(region);
  if (!bb) { toast('Aucun pixel non-transparent dans la zone'); ui(); render(); return; }

  let rawBlocks = solveRenderCut(region);

  /* Keep the editor's overlap policy semantics. The Python algorithm already
     tries to de-overlap, but `none` needs a hard guarantee. */
  const mode = normalizeCutOverlap(S.cutOverlap);
  if (mode === 'none' && disallowedOverlaps(rawBlocks) > 0) rawBlocks = forceNoRectOverlap(rawBlocks, region);

  const newBlocks = rawBlocks.map(b => ({ id:uid(), x:b.x, y:b.y, w:b.w, h:b.h }));
  f.blocks = f.blocks.concat(newBlocks);
  S.selBlock = null;

  if (!quiet) {
    ui(); render();
    let nt = 0;
    newBlocks.forEach(b => { nt += (b.w / 8) * (b.h / tileH()); });
    const peak = maxSpritesPerLine(newBlocks);
    const label = (S.alloc === 'dynamic') ? 'dynamique' : 'preload';
    toast('Auto-découpe ' + label + ' : +' + newBlocks.length + ' bloc' + (newBlocks.length>1?'s':'') +
          ', +' + nt + ' tile' + (nt>1?'s':'') + ' · max ' + peak + ' sprites/ligne' +
          (peak > 8 ? ' ⚠' : ''));
  }
}

let simpleCutBusy = false;
function setSimpleCutBusy(on) {
  const b = document.getElementById('btnSimpleCutAll');
  const ov = document.getElementById('busyOverlay');
  if (b) {
    b.disabled = on || !S.imgData;
    b.innerHTML = on ? '<span class="spin"></span>' + (window.mt ? mt('Découpe en cours…') : 'Découpe en cours…') : (window.mt ? mt('✂ Découper la planche') : '&#9986; Découper la planche');
  }
  if (ov) {
    ov.classList.toggle('on', on);
    ov.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
}
function simpleCutWholeSheet() {
  if (simpleCutBusy) return;
  if (!S.simpleMode) { toast(window.mt ? mt('Activer le mode simple') : 'Activer le mode simple'); return; }
  if (!S.imgData) { toast(window.mt ? mt('Aucune image') : 'Aucune image'); return; }
  if (typeof syncSimpleCutControls === 'function') syncSimpleCutControls();
  const st = typeof getSimpleCutStatus === 'function' ? getSimpleCutStatus() : { ok:true };
  if (!st.ok) { alert(st.plain || (window.mt ? mt('Taille non concordante avec la découpe choisie.') : 'Taille non concordante avec la découpe choisie.')); return; }
  simpleCutBusy = true;
  setSimpleCutBusy(true);
  requestAnimationFrame(() => setTimeout(() => {
    try { simpleCutWholeSheetRun(st); }
    finally { simpleCutBusy = false; setSimpleCutBusy(false); }
  }, 0));
}
function simpleRegionHasContent(x,y,w,h) {
  return !!contentBBox({ x, y, w, h });
}
function simpleCutWholeSheetRun(status) {
  const iw = S.imgData.width, ih = S.imgData.height, cw = S.simpleCutW, ch = S.simpleCutH;
  const cols = iw / cw, rows = ih / ch;
  const z = { id:uid(), name:'anim_simple', color:ZCOL[S.zones.length % ZCOL.length], mirror:'none', loop:true, frames:[] };
  let i = 0, skipped = 0;
  for (let y=0; y<ih; y+=ch) {
    for (let x=0; x<iw; x+=cw) {
      if (!simpleRegionHasContent(x,y,cw,ch)) { skipped++; continue; }
      z.frames.push({ id:uid(), num:nextFrameNum(), name:'frame '+i, blocks:[{ id:uid(), x, y, w:cw, h:ch }], ax:null, ay:null, delay:8, bbox:null, attr:0 });
      i++;
    }
  }
  if (z.frames.length) S.zones.push(z);
  S.selZone = null;
  clearFrameSelection();
  S.bankSel = null; S.lowBankSel = null; S.autoCutArm = false; S.bboxEdit = false;
  ui(); render();
  const msgFrames = window.mt ? mt('{n} frame{s} créée{s2}', {n:z.frames.length, s:z.frames.length>1?'s':'', s2:z.frames.length>1?'s':''}) : z.frames.length + ' frame' + (z.frames.length>1?'s':'') + ' créée' + (z.frames.length>1?'s':'');
  const msgEmpty = skipped ? (window.mt ? mt('{n} vide{s} ignorée{s2}', {n:skipped, s:skipped>1?'s':'', s2:skipped>1?'s':''}) : skipped + ' vide' + (skipped>1?'s':'') + ' ignorée' + (skipped>1?'s':'')) : '';
  toast(cols + '×' + rows + ' = ' + msgFrames + (msgEmpty ? ' · ' + msgEmpty : ''));
}
