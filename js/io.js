/* ================================================================
   IO — file save/load + PNG import
   ================================================================ */

let $fi, $fl;
let srcCv, srcC;

function initIO() {
  $fi = document.getElementById('fi');
  $fl = document.getElementById('fl');
  window.$fi = $fi;   // exposed for inline onclick="$fi.click()"
  window.$fl = $fl;

  srcCv = document.createElement('canvas');
  srcC  = srcCv.getContext('2d', { willReadFrequently:true });

  $fi.onchange = e => { if (e.target.files[0]) importPng(e.target.files[0]); e.target.value=''; };
  $fl.onchange = onLoadFileSelected;
}

/* ===== PNG import ===== */
function importPng(file) {
  const fname = file.name.replace(/\.[^.]+$/, '');
  if (fname) S.projectName = sanitizeSheetName(fname) || 'sans_titre';
  const r = new FileReader();
  r.onload = ev => {
    S.imgUrl = ev.target.result;
    const im = new Image();
    im.onload = () => {
      setImage(im); ui(); render();
      toast('Image '+im.width+'×'+im.height);
    };
    im.src = ev.target.result;
  };
  r.readAsDataURL(file);
}

function setImage(im) {
  S.img = im;
  srcCv.width = im.width; srcCv.height = im.height;
  srcC.clearRect(0,0,im.width,im.height);
  srcC.drawImage(im,0,0);
  S.imgData = srcC.getImageData(0,0,im.width,im.height);
  extractPal();
  buildImgNoC0();
  document.getElementById('empty').style.display = 'none';
  document.getElementById('stI').textContent = im.width+'×'+im.height;
}

/* build S.imgNoC0 : a canvas where palette index-0 pixels are transparent,
   used when "hide color 0" is on so sprite outlines stay readable over a
   solid background (magenta/cyan/etc). */
function buildImgNoC0() {
  if (!S.imgData || !S.pal.length) { S.imgNoC0 = null; return; }
  const c0 = S.pal[0];
  const src = S.imgData.data;
  const cn = document.createElement('canvas');
  cn.width = S.imgData.width; cn.height = S.imgData.height;
  const cnx = cn.getContext('2d');
  const out = cnx.createImageData(S.imgData.width, S.imgData.height);
  const od = out.data;
  for (let i=0; i<src.length; i+=4) {
    if (src[i]===c0.r && src[i+1]===c0.g && src[i+2]===c0.b && src[i+3]===c0.a) {
      od[i]=od[i+1]=od[i+2]=od[i+3]=0;            // transparent
    } else {
      od[i]=src[i]; od[i+1]=src[i+1]; od[i+2]=src[i+2]; od[i+3]=src[i+3];
    }
  }
  cnx.putImageData(out, 0, 0);
  S.imgNoC0 = cn;
}

function toHex2(v) {
  return v.toString(16).padStart(2, '0').toUpperCase();
}

function rgbToHex(col) {
  return '#' + toHex2(col.r) + toHex2(col.g) + toHex2(col.b);
}

function toSms2Bit(v) {
  // Conversion RGB 0-255 vers niveau SMS 0-3
  return Math.max(0, Math.min(3, Math.round(v / 85)));
}

function rgbToSms(col) {
  const r = toSms2Bit(col.r);
  const g = toSms2Bit(col.g);
  const b = toSms2Bit(col.b);
  // Master System : 00BBGGRR
  const sms = (b << 4) | (g << 2) | r;
  return '$' + toHex2(sms);
}
function placeTip(e, tip) {
  const m = 12;
  let x = e.clientX + m;
  let y = e.clientY + m;
  const r = tip.getBoundingClientRect();
  if (x + r.width > innerWidth - m) x = e.clientX - r.width - m;
  if (y + r.height > innerHeight - m) y = e.clientY - r.height - m;
  tip.style.left = Math.max(m, x) + 'px';
  tip.style.top = Math.max(m, y) + 'px';
}

function extractPal() {
  const d = S.imgData.data;
  const seen = new Map();
  S.pal = [];
  for (let i=0; i<d.length; i+=4) {
    const k = d[i]+','+d[i+1]+','+d[i+2]+','+d[i+3];
    if (!seen.has(k)) {
      seen.set(k,1);
      S.pal.push({ r:d[i], g:d[i+1], b:d[i+2], a:d[i+3] });
    }
    if (S.pal.length >= 16) break;
  }
  const el = document.getElementById('palGrid');
  el.innerHTML = '';
  S.pal.forEach((col, i) => {
    const s = document.createElement('div');
    const hex = rgbToHex(col);
    const sms = rgbToSms(col);
    if (i === 0 && col.a < 128) {
      s.className = 'tr';
    } else {
      s.style.background = 'rgb(' + col.r + ',' + col.g + ',' + col.b + ')';
    }
    const info =
      '#' + i + (i === 0 && col.a < 128 ? ' (transp.)' : '') +
      '\nHEX : ' + hex +
      '\nSMS : ' + sms +
      '\nRGB : ' + col.r + ',' + col.g + ',' + col.b;
      s.addEventListener('mouseenter', e => {
        const tip = document.getElementById('palTooltip');
        tip.textContent = info;
        tip.style.display = 'block';
        placeTip(e, tip);
      });
      s.addEventListener('mousemove', e => {
        placeTip(e, document.getElementById('palTooltip'));
      });
      s.addEventListener('mouseleave', () => {
        document.getElementById('palTooltip').style.display = 'none';
      });
    el.appendChild(s);
  });
  document.getElementById('palInfo').textContent = window.mt ? mt('{n} couleur{s}', {n:S.pal.length, s:S.pal.length>1?'s':''}) : S.pal.length + ' couleur' + (S.pal.length>1?'s':'');
}

/* ===== File save ===== */
function fileSave() {
  const data = {
    version: 5,
    name: S.projectName,
    tileH: S.tileH,
    alloc: S.alloc,
    startTile: S.startTile,
    simpleMode: S.simpleMode,
    c0alpha: S.c0alpha,
    prevC0alpha: S.prevC0alpha,
    previewBlockOutline: S.previewBlockOutline !== false,
    attrEnable: S.attrEnable,
    attrBits: S.attrBits,
    cutOverlap: S.cutOverlap,
    cutGap: S.cutGap,
    simpleCutW: S.simpleCutW,
    simpleCutH: S.simpleCutH,
    exportSizes: S.exportSizes || {},
    zones: S.zones,
    nextFrameNum: S.nextFrameNum,
    imgUrl: S.imgUrl
  };
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = S.projectName + '.sms-meta.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Fichier sauvegardé : '+a.download);
}

/* ===== File load ===== */
function onLoadFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      applyLoadedProject(data);
    } catch (ex) {
      toast('Erreur lecture fichier');
      console.error(ex);
    }
  };
  r.readAsText(file);
}

function applyLoadedProject(data) {
  S.projectName = data.name || 'sans_titre';
  S.tileH       = data.tileH || 16;
  S.alloc       = data.alloc || 'preload';
  S.startTile   = data.startTile != null ? data.startTile : 0;
  S.simpleMode  = !!data.simpleMode;
  S.c0alpha     = (data.c0alpha != null) ? data.c0alpha : 100;
  S.prevC0alpha = (data.prevC0alpha != null) ? data.prevC0alpha : 100;
  S.previewBlockOutline = data.previewBlockOutline !== false;
  S.attrEnable  = !!data.attrEnable;
  S.attrBits    = (Array.isArray(data.attrBits) && data.attrBits.length===8)
                    ? data.attrBits.map(b=>({name:b.name||'',desc:b.desc||''}))
                    : defaultAttrBits();
  S.cutOverlap  = normalizeCutOverlap(data.cutOverlap);
  S.cutGap      = (data.cutGap != null) ? data.cutGap : 2;
  S.simpleCutW = data.simpleCutW != null ? data.simpleCutW : 16;
  S.simpleCutH = data.simpleCutH != null ? data.simpleCutH : (S.tileH === 8 ? 8 : 16);
  S.exportSizes = data.exportSizes || {};

  document.getElementById('optMode').value      = S.tileH;
  document.getElementById('optAlloc').value     = S.alloc;
  document.getElementById('optStartTile').value = S.startTile;
  { const e=document.getElementById('optOverlap'); if(e) e.value = normalizeCutOverlap(S.cutOverlap); }
  { const e=document.getElementById('optCutGap'); if(e) e.value = S.cutGap; }
  { const e=document.getElementById('cutGapVal'); if(e) e.textContent = S.cutGap + 'px'; }
  const simpEl = document.getElementById('optSimple');
  if (simpEl) simpEl.checked = S.simpleMode;
  { const e=document.getElementById('optC0'); if(e) e.value = S.c0alpha; }
  { const e=document.getElementById('c0val'); if(e) e.textContent = S.c0alpha + '%'; }
  { const e=document.getElementById('optPrevC0'); if(e) e.value = S.prevC0alpha; }
  { const e=document.getElementById('prevC0val'); if(e) e.textContent = S.prevC0alpha + '%'; }
  if (typeof syncSimpleCutControls === 'function') syncSimpleCutControls();

  /* normalize zones (apply defaults for older files) */
  S.zones = (data.zones || []).map(z => ({
    ...z,
    mirror: z.mirror || 'none',
    loop:   z.loop !== false,   /* default to looping */
    frames: z.frames.map(f => ({
      ...f,
      ax:    f.ax    != null ? f.ax    : null,
      ay:    f.ay    != null ? f.ay    : null,
      delay: f.delay != null ? f.delay : 8,
      blocks: f.blocks || [],
      ref:    f.ref   || null,
      bbox:   f.bbox  || null,
      attr:   f.attr  != null ? f.attr : 0,
      num:    frameNumSeed(f) !== null ? Number(f.num) : null,
    }))
  }));

  ensureFrameNums();
  if (data.nextFrameNum != null && data.nextFrameNum > S.nextFrameNum) S.nextFrameNum = data.nextFrameNum;
  S.selZone = null; clearFrameSelection();
  prevStop();

  if (data.imgUrl) {
    S.imgUrl = data.imgUrl;
    const im = new Image();
    im.onload = () => { setImage(im); ui(); render(); updateExportSizes(); toast((window.mt ? mt('Projet chargé :') : 'Projet chargé :') + ' ' + S.projectName); };
    im.src = data.imgUrl;
  } else {
    ui(); render(); updateExportSizes();
    toast(window.mt ? mt('Projet chargé (sans image)') : 'Projet chargé (sans image)');
  }
}

/* ===== New project ===== */
function newProject() {
  if (S.zones.length || S.img) {
    if (!confirm(window.mt ? mt('Repartir à zéro ? Les données non sauvegardées seront perdues.') : 'Repartir à zéro ? Les données non sauvegardées seront perdues.')) return;
  }
  S.img = null; S.imgData = null; S.imgUrl = null; S.pal = [];
  S.tileH = 16; S.zoom = 4; S.projectName = 'sans_titre';
  S.alloc = 'preload'; S.startTile = 0; S.simpleMode = false; S.c0alpha = 100; S.prevC0alpha = 100; S.previewBlockOutline = true; S.simpleCutW = 16; S.simpleCutH = 16; S.nextFrameNum = 0;
  S.zones = []; S.selZone = null; clearFrameSelection();
  S.action = null; S.drag = null;
  S.exportSizes = {};
  prevStop();

  document.getElementById('optMode').value = 16;
  document.getElementById('optZ').value = 4;
  document.getElementById('optAlloc').value = 'preload';
  { const e=document.getElementById('optOverlap'); if(e) e.value = 'none'; }
  { const e=document.getElementById('optSimple'); if(e) e.checked=false; }
  { const e=document.getElementById('optC0'); if(e) e.value=100; }
  { const e=document.getElementById('c0val'); if(e) e.textContent='100%'; }
  { const e=document.getElementById('optPrevC0'); if(e) e.value=100; }
  { const e=document.getElementById('prevC0val'); if(e) e.textContent='100%'; }
  { const e=document.getElementById('optPrevBlockOutline'); if(e) e.checked=true; }
  if (typeof syncSimpleCutControls === 'function') syncSimpleCutControls();
  document.getElementById('optStartTile').value = 0;
  document.getElementById('empty').style.display = 'flex';
  document.getElementById('palGrid').innerHTML = '';
  document.getElementById('palInfo').textContent = '';
  document.getElementById('stI').textContent = '—';

  ui(); render(); updateExportSizes();
  toast('Nouveau projet');
}


/* ===== SMS planar tile encoding ===== */

/* Build a fast lookup from exact RGBA -> palette index (0-15) */
function buildPaletteIndex() {
  const map = new Map();
  S.pal.forEach((c,i) => map.set(c.r+','+c.g+','+c.b+','+c.a, i));
  return map;
}

function rgbaToIndex(map, r,g,b,a) {
  const idx = map.get(r+','+g+','+b+','+a);
  return idx !== undefined ? idx : 0; /* fallback to color 0 (transparent) */
}

/* Encode one 8x8 chunk of a tile buffer into 32 bytes (4 bitplanes × 8 rows),
   matching the Master System / SG-1000 VDP planar tile format. */
function encode8x8Planar(buf, tw, rowOffset, palMap) {
  const out = new Uint8Array(32);
  let o = 0;
  for (let row=0; row<8; row++) {
    const ry = rowOffset+row;
    /* gather the 8 palette indices of this row first */
    const idxs = new Array(8);
    for (let x=0; x<8; x++) {
      const di = (ry*tw+x)*4;
      idxs[x] = rgbaToIndex(palMap, buf[di],buf[di+1],buf[di+2],buf[di+3]);
    }
    for (let plane=0; plane<4; plane++) {
      let byte = 0;
      for (let x=0; x<8; x++) {
        const bit = (idxs[x] >> plane) & 1;
        byte |= bit << (7-x);
      }
      out[o++] = byte;
    }
  }
  return out;
}

/* Encode a full tile (8x8 = 32 bytes, or 8x16 = 64 bytes as two stacked tiles) */
function encodeTilePlanar(buf, tw, th, palMap) {
  if (th === 8) return encode8x8Planar(buf, tw, 0, palMap);
  /* th === 16: top 8x8 then bottom 8x8, concatenated */
  const top = encode8x8Planar(buf, tw, 0, palMap);
  const bot = encode8x8Planar(buf, tw, 8, palMap);
  const out = new Uint8Array(64);
  out.set(top, 0);
  out.set(bot, 32);
  return out;
}

/* ===== Export tile bank as SMS binary (.bin) ===== */
/* Build the list of displayed tile pixel-buffers (dedup-aware, mirror-aware) */
function buildDisplayTiles() {
  const allT = allTilesWithMirror();
  const dedup = document.getElementById('optDedup').checked;
  const seen = new Set(), display = [];
  allT.forEach(t => {
    const px = tilePx(t.px, t.py, t.mirror);
    const key = px.join(',');
    const isNew = !seen.has(key);
    seen.add(key);
    if (!dedup || isNew) display.push(px);
  });
  return display;
}

/* Return array of 32-byte planar 8x8 sub-tiles (an 8x16 metatile -> 2 entries) */
function buildPlanar8x8Tiles() {
  const tw = 8, th = S.tileH;
  const palMap = buildPaletteIndex();
  const display = buildDisplayTiles();
  const out = [];
  display.forEach(buf => {
    if (th === 16) {
      out.push(encode8x8Planar(buf, tw, 0, palMap));
      out.push(encode8x8Planar(buf, tw, 8, palMap));
    } else {
      out.push(encode8x8Planar(buf, tw, 0, palMap));
    }
  });
  return out;
}

function exportTileBankBinary() {
  if (!S.imgData) { toast('Aucune image chargée'); return; }
  const tw = 8, th = S.tileH;
  const display = buildDisplayTiles();
  if (!display.length) { toast('Aucun tile à exporter'); return; }

  const palMap = buildPaletteIndex();
  const bytesPerTile = (th === 16) ? 64 : 32;
  const out = new Uint8Array(display.length * bytesPerTile);

  display.forEach((buf,i) => {
    out.set(encodeTilePlanar(buf, tw, th, palMap), i*bytesPerTile);
  });

  downloadBlob(out, S.projectName + '_tilebank.bin');
  recordExportSize('bin', out.length);
  toast('BIN : '+display.length+' tiles, '+out.length+' octets');
}

/* ===== Export PS Gaiden compressed (.psgcompr) ===== */
function exportTileBankPSG() {
  if (!S.imgData) { toast('Aucune image chargée'); return; }
  const tiles32 = buildPlanar8x8Tiles();
  if (!tiles32.length) { toast('Aucun tile à exporter'); return; }

  const out = compressTilesPSG(tiles32);
  if (!out) return;

  const raw = tiles32.length * 32;
  downloadBlob(out, S.projectName + '_tilebank.psgcompr');
  recordExportSize('psg', out.length);
  toast('PSG : '+tiles32.length+' tiles, '+raw+'→'+out.length+' octets ('+
        Math.round(100*out.length/raw)+'%)');
}

/* ===== Export ZX7 compressed (.zx7) =====
   Compresses the raw planar BIN stream (interleaved VRAM bytes). */
function exportTileBankZX7() {
  if (!S.imgData) { toast('Aucune image chargée'); return; }
  const tw = 8, th = S.tileH;
  const display = buildDisplayTiles();
  if (!display.length) { toast('Aucun tile à exporter'); return; }

  const palMap = buildPaletteIndex();
  const bytesPerTile = (th === 16) ? 64 : 32;
  const raw = new Uint8Array(display.length * bytesPerTile);
  display.forEach((buf,i) => {
    raw.set(encodeTilePlanar(buf, tw, th, palMap), i*bytesPerTile);
  });

  const out = compressZX7(raw);
  downloadBlob(out, S.projectName + '_tilebank.zx7');
  recordExportSize('zx7', out.length);
  toast('ZX7 : '+raw.length+'→'+out.length+' octets ('+
        Math.round(100*out.length/raw.length)+'%)');
}

/* shared download helper */
function downloadBlob(u8, filename) {
  const blob = new Blob([u8], { type:'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* record last export size & refresh the label */
function recordExportSize(kind, bytes) {
  S.exportSizes = S.exportSizes || {};
  S.exportSizes[kind] = bytes;
  updateExportSizes();
}

function exportTileBankPng() {
  if (!S.imgData) { toast('Aucune image chargée'); return; }
  const allT = allTilesWithMirror();
  if (!allT.length) { toast('Aucun tile à exporter'); return; }

  const bw = 16, tw = 8, th = S.tileH;
  const dedup = document.getElementById('optDedup').checked;
  const seen = new Set(), display = [];

  allT.forEach(t => {
    const px = tilePx(t.px, t.py, t.mirror);
    const key = px.join(',');
    const isNew = !seen.has(key);
    seen.add(key);
    if (!dedup || isNew) display.push(px);
  });

  const rows = 1;
  const out = document.createElement('canvas');
  out.width = display.length * tw;
  out.height = th;
  const octx = out.getContext('2d');

  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  const tc = tmp.getContext('2d');

  display.forEach((buf,i) => {
    tc.putImageData(new ImageData(buf,tw,th), 0,0);
    octx.drawImage(tmp, i*tw, 0);
  });

  out.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = S.projectName + '_tilebank.png';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exporté : '+a.download+' ('+display.length+' tiles)');
  }, 'image/png');
}
