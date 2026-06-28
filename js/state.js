/* ================================================================
   STATE — Data model & helpers
   ================================================================ */

const ZCOL = ['#4a9eff','#e94560','#00c868','#f0a030','#a070e0','#e0e040','#40e0d0','#ff69b4'];
const BCOL = ['rgba(80,140,255,0.5)','rgba(100,220,160,0.5)','rgba(255,180,60,0.5)',
              'rgba(220,80,120,0.5)','rgba(160,120,230,0.5)','rgba(80,220,220,0.5)'];

const S = {
  img:null, imgData:null, imgUrl:null, pal:[],
  tileH:16, zoom:4, projectName:'sans_titre',
  alloc:'preload', startTile:0,
  simpleMode:false,  // simple mode: no collision box, simplified ASM (tile-addr only)
  c0alpha:100,       // opacity % of palette index 0 on the sheet (0=transparent,100=opaque)
  prevC0alpha:100,   // opacity % of palette index 0 in preview
  previewBlockOutline:true,
  exportSizes:{},
  zones:[],          // animations
  nextFrameNum:0,
  selZone:null, selFrame:null, selFrames:[], frameSelAnchor:null, selBlock:null,
  /* interaction transient */
  action:null, drag:null, moveStart:null,
  resizeEdge:null, resizeStart:null, anchorDrag:null,
  bboxEdit:false,    // when true, mouse edits the collision/size box (pixel-precise)
  autoCutArm:false,  // when true, next drag defines the auto-cut region
  bankSel:null,      // hovered tile-bank cell index (highlights its sources)
  lowBankSel:null, lowOccThreshold:10,
  simpleCutW:16, simpleCutH:16,
  selBlocks:[],      // multi-selection of block ids (for batch move/delete)
  undoStack:[],      // history of block-deletion snapshots for undo
  /* export attributes config: when enabled, each frame carries an attribute
     byte (8 user-named bits) emitted in the .inc export. */
  attrEnable:false,
  attrBits: defaultAttrBits(),
  cutOverlap:'none',
  cutGap:2,          // sprite-detection: empty-pixel gap (>= this) splits sprites
};

/* default attribute bit definitions (bit 0 = LSB). name = short asm-ish id. */
function defaultAttrBits() {
  return [
    { name:'collide',  desc:'collide (always 0, engine sets bit to 1)' },
    { name:'attack',   desc:'attack' },
    { name:'jump',     desc:'jump' },
    { name:'noflip',   desc:'noflip (for ennemi)' },
    { name:'loop',     desc:'loop (animation)' },
    { name:'prio0',    desc:'priority (low bit)' },
    { name:'prio1',    desc:'priority (0:none,1:normal,2:strong,3:special)' },
    { name:'immortal', desc:'immortal (untouchable)' },
  ];
}

const A = { playing:false, fidx:0, tick:0, lastT:0, rafId:null, bankFrameId:null };

/* helpers */
const uid    = () => Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6);
const snap   = (v,s) => Math.floor(v/s)*s;
const clamp  = (v,a,b) => Math.max(a,Math.min(b,v));
const toast  = m => {
  const d = document.createElement('div'); d.className='toast'; d.textContent=m;
  document.body.appendChild(d); setTimeout(()=>d.remove(),2600);
};

function curZone()  { return S.zones.find(z=>z.id===S.selZone); }
function curFrame() { const z=curZone(); return z?.frames.find(f=>f.id===S.selFrame); }
function selectedFrameIds() {
  const z = curZone(); if (!z) return [];
  const ids = (S.selFrames && S.selFrames.length) ? S.selFrames : (S.selFrame ? [S.selFrame] : []);
  const set = new Set(ids);
  return z.frames.filter(f=>set.has(f.id)).map(f=>f.id);
}
function setFrameSelection(ids, currentId) {
  const z = curZone();
  const ok = new Set(z ? z.frames.map(f=>f.id) : []);
  const list = [...new Set((ids || []).filter(id=>ok.has(id)))];
  S.selFrames = list;
  S.selFrame = currentId && list.includes(currentId) ? currentId : (list.length ? list[list.length-1] : null);
  S.frameSelAnchor = S.selFrame;
  S.selBlock = null; S.selBlocks = [];
}
function clearFrameSelection() {
  S.selFrame = null; S.selFrames = []; S.frameSelAnchor = null; S.selBlock = null; S.selBlocks = [];
}
function normalizeCutOverlap(v) {
  return v === 'yes' || v === true ? 'yes' : 'none';
}

function frameNumSeed(f) {
  const n = f && Number(f.num);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function ensureFrameNums() {
  let max = -1;
  S.zones.forEach(z => (z.frames||[]).forEach(f => {
    const n = frameNumSeed(f);
    if (n !== null) { f.num = n; if (n > max) max = n; }
  }));
  S.zones.forEach(z => (z.frames||[]).forEach(f => {
    if (frameNumSeed(f) === null) f.num = ++max;
  }));
  S.nextFrameNum = max + 1;
}
function nextFrameNum() {
  if (S.nextFrameNum == null) ensureFrameNums();
  return S.nextFrameNum++;
}
function frameNum(f) {
  if (!f) return '??';
  if (frameNumSeed(f) === null) f.num = nextFrameNum();
  return String(f.num).padStart(2,'0');
}
function autoFrameName(z,f,i) {
  if (!f) return 'frame '+i;
  if (/^frame\s+\d+$/i.test(f.name||'')) f.name = 'frame '+i;
  return f.name || ('frame '+i);
}

function createAnimationNamed(name) {
  if (!name) return null;
  const z = { id:uid(), name, color:ZCOL[S.zones.length%ZCOL.length], mirror:'none', loop:true, frames:[] };
  S.zones.push(z);
  return z;
}


/* Resolve a frame: if it's a clone (has .ref), return the referenced frame.
   Returns {frame: realFrame, isClone: bool, host: hostFrame}
   The "host" is the actual entry in the animation list (clone or original). */
function resolveFrame(f) {
  if (!f) return { frame:null, isClone:false, host:null };
  if (f.ref) {
    const zone = S.zones.find(z => z.id === f.ref.zoneId);
    const src  = zone?.frames.find(fr => fr.id === f.ref.frameId);
    if (src && !src.ref) return { frame: src, isClone: true, host: f, srcZone: zone };
    return { frame:null, isClone:true, host:f };  // broken ref
  }
  return { frame:f, isClone:false, host:f };
}

/* Default anchor: center-bottom of bounding box of blocks */
function getAnchor(f) {
  if (!f) return { x:0, y:0 };
  if (f.ax !== null && f.ax !== undefined && f.ay !== null && f.ay !== undefined)
    return { x:f.ax, y:f.ay };
  if (f.blocks.length === 0) return { x:0, y:0 };
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  f.blocks.forEach(b=>{
    x1=Math.min(x1,b.x); y1=Math.min(y1,b.y);
    x2=Math.max(x2,b.x+b.w); y2=Math.max(y2,b.y+b.h);
  });
  return { x:Math.round((x1+x2)/2), y:y2 };
}

function setAnchor(f,x,y) { f.ax=Math.round(x); f.ay=Math.round(y); }

/* ===== Bounding box (collision / size-box) =====
   Stored on the frame as f.bbox = {x,y,w,h} in absolute sheet pixels.
   Free pixel placement (NOT snapped to tile grid).
   Default = exact bbox of the frame's blocks. */
function getBBox(f) {
  if (!f) return null;
  if (f.bbox) return f.bbox;
  /* default from blocks */
  if (!f.blocks || f.blocks.length === 0) return null;
  let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
  f.blocks.forEach(b=>{
    x1=Math.min(x1,b.x); y1=Math.min(y1,b.y);
    x2=Math.max(x2,b.x+b.w); y2=Math.max(y2,b.y+b.h);
  });
  return { x:x1, y:y1, w:x2-x1, h:y2-y1 };
}

/* Initialize an explicit editable bbox from current default */
function ensureBBox(f) {
  if (!f.bbox) {
    const b = getBBox(f);
    f.bbox = b ? { ...b } : { x:0, y:0, w:8, h:S.tileH };
  }
  return f.bbox;
}

/* ===== Undo (block deletions) ===== */
/* Snapshot the given frame's blocks so a deletion can be reverted. */
function pushUndo(frame, label) {
  if (!frame) return;
  S.undoStack = S.undoStack || [];
  S.undoStack.push({
    zoneId: S.selZone,
    frameId: frame.id,
    blocks: frame.blocks.map(b => ({ ...b })),
    bbox: frame.bbox ? { ...frame.bbox } : null,
    label: label || 'suppression'
  });
  /* cap history */
  if (S.undoStack.length > 30) S.undoStack.shift();
  updateUndoButton();
}

function undo() {
  if (!S.undoStack || !S.undoStack.length) { toast('Rien à annuler'); return; }
  const snap = S.undoStack.pop();
  const z = S.zones.find(z => z.id === snap.zoneId);
  const f = z && z.frames.find(fr => fr.id === snap.frameId);
  if (!f) { toast('Frame introuvable'); updateUndoButton(); return; }
  f.blocks = snap.blocks.map(b => ({ ...b }));
  f.bbox = snap.bbox ? { ...snap.bbox } : null;
  S.selZone = snap.zoneId;
  setFrameSelection([snap.frameId], snap.frameId);
  ui(); render();
  toast('Annulé : ' + snap.label);
  updateUndoButton();
}

function updateUndoButton() {
  const b = document.getElementById('btnUndo');
  if (b) b.style.display = (S.undoStack && S.undoStack.length) ? 'block' : 'none';
}

function clearFrameBlocks() {
  const f = curFrame();
  if (!f || f.ref) { toast('Sélectionner une frame (non clonée)'); return; }
  if (!f.blocks.length) { toast('Aucun bloc à supprimer'); return; }
  pushUndo(f, 'vidage des blocs');
  const n = f.blocks.length;
  f.blocks = [];
  S.selBlock = null;
  S.selBlocks = [];
  f.bbox = null;
  ui(); render();
  toast(n + ' bloc' + (n>1?'s':'') + ' supprimé' + (n>1?'s':''));
}

/* the currently active set of selected block ids (multi if any, else single) */
function selectedBlockIds() {
  if (S.selBlocks && S.selBlocks.length) return S.selBlocks.slice();
  if (S.selBlock) return [S.selBlock];
  return [];
}

/* Move selected blocks to a NEW frame in the same animation. */
function moveSelectionToNewFrame() {
  const z = curZone(); const f = curFrame();
  if (!z || !f || f.ref) { toast('Sélectionner une frame (non clonée)'); return; }
  const ids = selectedBlockIds();
  if (!ids.length) { toast(window.mt ? mt('Aucun bloc sélectionné') : 'Aucun bloc sélectionné'); return; }
  const moved = f.blocks.filter(b => ids.includes(b.id));
  if (!moved.length) { toast(window.mt ? mt('Aucun bloc sélectionné') : 'Aucun bloc sélectionné'); return; }
  /* remove from current frame */
  f.blocks = f.blocks.filter(b => !ids.includes(b.id));
  f.bbox = null;
  /* create new frame right after current, with the moved blocks */
  const idx = z.frames.indexOf(f);
  const nf = { id:uid(), num:nextFrameNum(), name:'frame '+(idx+1), blocks:moved, ax:null, ay:null, delay:8, bbox:null };
  z.frames.splice(idx+1, 0, nf);
  renumberAutoFrames(z);
  setFrameSelection([nf.id], nf.id);
  ui(); render();
  toast(moved.length + ' bloc' + (moved.length>1?'s':'') + ' → nouvelle frame');
}

/* Delete selected blocks from the current frame. */
function deleteSelection() {
  const f = curFrame();
  if (!f || f.ref) return;
  const ids = selectedBlockIds();
  if (!ids.length) { toast(window.mt ? mt('Aucun bloc sélectionné') : 'Aucun bloc sélectionné'); return; }
  pushUndo(f, 'suppression de blocs');
  const n = ids.length;
  f.blocks = f.blocks.filter(b => !ids.includes(b.id));
  f.bbox = null;
  S.selBlock = null;
  S.selBlocks = [];
  ui(); render();
  toast(n + ' bloc' + (n>1?'s':'') + ' supprimé' + (n>1?'s':''));
}

/* ===== CRUD: Animations ===== */
function addAnim() {
  const z = createAnimationNamed(prompt(window.mt ? mt("Nom de l'animation :") : "Nom de l'animation :", 'anim_'+S.zones.length));
  if (!z) return;
  S.selZone = z.id;
  clearFrameSelection();
  ui(); render();
}

function selAnim(id) {
  S.selZone = id; clearFrameSelection(); S.bboxEdit = false; S.autoCutArm = false; A.bankFrameId = null;
  prevStop(); ui(); render();
}

function renameAnim(id) {
  const z = S.zones.find(z=>z.id===id); if (!z) return;
  const n = prompt(window.mt ? mt('Renommer :') : 'Renommer :', z.name); if (n) z.name = n;
  ui(); render();
}

function delAnim(id) {
  A.bankFrameId = null;
  if (!confirm(window.mt ? mt('Supprimer animation + frames ?') : 'Supprimer animation + frames ?')) return;
  S.zones = S.zones.filter(z=>z.id!==id);
  if (S.selZone===id) { S.selZone=null; clearFrameSelection(); }
  prevStop(); ui(); render();
}

function clearAnimationsAndFrames() {
  A.bankFrameId = null;
  if (!S.zones.length) { toast(window.mt ? mt('Aucune animation à supprimer') : 'Aucune animation à supprimer'); return; }
  const nf = S.zones.reduce((n,z)=>n+z.frames.length,0);
  if (!confirm(window.mt ? mt('Tout supprimer ?\n\nToutes les animations et les {n} frame{s} seront supprimées.', {n:nf, s:nf>1?'s':''}) : 'Tout supprimer ?\n\nToutes les animations et les '+nf+' frame'+(nf>1?'s':'')+' seront supprimées.')) return;
  prevStop();
  S.zones = [];
  S.selZone = null;
  clearFrameSelection();
  S.bankSel = null; S.lowBankSel = null;
  S.autoCutArm = false;
  S.bboxEdit = false;
  S.undoStack = [];
  ui(); render();
  toast(window.mt ? mt('Animations et frames supprimées') : 'Animations et frames supprimées');
}

function moveAnim(id, dir) {
  const i = S.zones.findIndex(z=>z.id===id); if (i<0) return;
  const j = i+dir; if (j<0||j>=S.zones.length) return;
  [S.zones[i], S.zones[j]] = [S.zones[j], S.zones[i]];
  ui(); render();
}
function moveAnimToIndex(id, targetIndex) {
  const i = S.zones.findIndex(z=>z.id===id); if (i<0) return;
  targetIndex = clamp(targetIndex, 0, S.zones.length);
  const z = S.zones.splice(i,1)[0];
  if (targetIndex > i) targetIndex--;
  targetIndex = clamp(targetIndex, 0, S.zones.length);
  S.zones.splice(targetIndex,0,z);
  S.selZone = id;
  clearFrameSelection();
  ui(); render();
}

function setAnimMirror(id, mode) {
  const z = S.zones.find(z=>z.id===id); if (!z) return;
  z.mirror = mode;
  ui(); render();
}

function toggleAnimLoop(id) {
  const z = S.zones.find(z=>z.id===id); if (!z) return;
  z.loop = !z.loop;
  ui(); render();
}

function setAnimColor(id, color) {
  const z = S.zones.find(z=>z.id===id); if (!z) return;
  z.color = color;
  ui(); render();
}

/* ===== CRUD: Frames ===== */
function addFrame() {
  const z = curZone(); if (!z) return;
  z.frames.push({
    id:uid(), num:nextFrameNum(), name:'frame '+z.frames.length,
    blocks:[], ax:null, ay:null, delay:8, bbox:null
  });
  setFrameSelection([z.frames[z.frames.length-1].id], z.frames[z.frames.length-1].id);
  ui(); render();
}

function selFrameId(id, multi) {
  S.bboxEdit = false; S.autoCutArm = false; A.bankFrameId = null;
  const z = curZone(); if (!z) return;
  const f = z.frames.find(fr=>fr.id===id);
  if (!multi && f && f.ref) {
    const tgtZone = S.zones.find(zz=>zz.id===f.ref.zoneId);
    const tgtFrame = tgtZone?.frames.find(fr=>fr.id===f.ref.frameId);
    if (tgtZone && tgtFrame) {
      S.selZone = tgtZone.id;
      setFrameSelection([tgtFrame.id], tgtFrame.id);
      toast('→ source: '+tgtZone.name+'/'+tgtFrame.name);
      ui(); render(); centerOnFrame(); return;
    }
    toast('Référence introuvable');
  }
  if (multi) {
    const ids = selectedFrameIds();
    let next;
    if (ids.includes(id) && ids.length > 1) next = ids.filter(x=>x!==id);
    else {
      const a = z.frames.findIndex(fr=>fr.id===(S.frameSelAnchor || S.selFrame || id));
      const b = z.frames.findIndex(fr=>fr.id===id);
      const add = (a>=0 && b>=0) ? z.frames.slice(Math.min(a,b), Math.max(a,b)+1).map(fr=>fr.id) : [id];
      next = [...new Set(ids.concat(add))];
    }
    setFrameSelection(next, id);
    ui(); render(); centerOnFrame(); return;
  }
  setFrameSelection([id], id);
  ui(); render(); centerOnFrame();
}

function delFrames(ids) {
  const z = curZone(); if (!z) return;
  const set = new Set(ids || []); if (!set.size) return;
  const first = z.frames.findIndex(f=>set.has(f.id));
  const n0 = z.frames.length;
  z.frames = z.frames.filter(f=>!set.has(f.id));
  renumberAutoFrames(z);
  const left = z.frames[Math.min(Math.max(first,0), z.frames.length-1)];
  const keep = selectedFrameIds().filter(id=>!set.has(id));
  if (keep.length) setFrameSelection(keep, keep[keep.length-1]);
  else setFrameSelection(left ? [left.id] : [], left ? left.id : null);
  ui(); render();
  const d = n0 - z.frames.length;
  if (d) toast(d + ' frame' + (d>1?'s':'') + ' supprimée' + (d>1?'s':''));
}
function delFrame(fid) { delFrames([fid]); }
function deleteSelectedFrames() {
  const ids = selectedFrameIds();
  if (ids.length < 2) return false;
  delFrames(ids);
  return true;
}
function renumberAutoFrames(z) {
  if (!z) return;
  z.frames.forEach((f,i)=>{ if (!f.ref && /^frame\s+\d+$/i.test(f.name||'')) f.name = 'frame '+i; });
}
function moveFrame(fid, dir) {
  const z = curZone(); if (!z) return;
  const i = z.frames.findIndex(f=>f.id===fid); if (i<0) return;
  const j = i+dir; if (j<0||j>=z.frames.length) return;
  [z.frames[i], z.frames[j]] = [z.frames[j], z.frames[i]];
  renumberAutoFrames(z);
  ui(); render();
}
function moveFramesToIndex(ids, targetFrameId, after) {
  const z = curZone(); if (!z) return;
  const set = new Set(ids || []); if (!set.size || set.has(targetFrameId)) return;
  const moving = z.frames.filter(f=>set.has(f.id)); if (!moving.length) return;
  const rest = z.frames.filter(f=>!set.has(f.id));
  let idx = rest.findIndex(f=>f.id===targetFrameId); if (idx<0) return;
  if (after) idx++;
  z.frames = rest.slice(0,idx).concat(moving, rest.slice(idx));
  renumberAutoFrames(z);
  setFrameSelection(moving.map(f=>f.id), moving[moving.length-1].id);
  ui(); render();
}

/* Move a frame from the current animation to another animation (appended). */
function moveFramesToZone(ids, targetZoneId) {
  const z = curZone(); if (!z) return;
  const tgt = S.zones.find(zz => zz.id === targetZoneId);
  if (!tgt || tgt.id === z.id) return;
  const set = new Set(ids || []);
  const moving = z.frames.filter(f=>set.has(f.id));
  if (!moving.length) return;
  z.frames = z.frames.filter(f=>!set.has(f.id));
  tgt.frames.push(...moving);
  renumberAutoFrames(z);
  renumberAutoFrames(tgt);
  S.selZone = tgt.id;
  setFrameSelection(moving.map(f=>f.id), moving[moving.length-1].id);
  ui(); render();
  toast(moving.length + ' frame' + (moving.length>1?'s':'') + ' déplacée' + (moving.length>1?'s':'') + ' vers ' + tgt.name);
}
function moveFrameToZone(fid, targetZoneId) { moveFramesToZone([fid], targetZoneId); }

function cloneFrame(srcZoneId, srcFrameId) {
  const z = curZone(); if (!z) return;
  const srcZone = S.zones.find(zz=>zz.id===srcZoneId);
  const srcFrame = srcZone?.frames.find(fr=>fr.id===srcFrameId);
  if (!srcZone || !srcFrame) return;
  /* don't allow cloning a clone — resolve to root */
  const realSrc = srcFrame.ref || { zoneId:srcZone.id, frameId:srcFrame.id };
  /* shorter name when cloning within the same animation */
  const cloneName = (srcZone.id === z.id)
    ? '↳ ' + srcFrame.name
    : '↳ ' + srcZone.name + '/' + srcFrame.name;
  z.frames.push({
    id:uid(),
    num: nextFrameNum(),
    name: cloneName,
    ref: realSrc,
    delay: srcFrame.delay || 8,
    /* clones don't have their own blocks/anchor */
  });
  setFrameSelection([z.frames[z.frames.length-1].id], z.frames[z.frames.length-1].id);
  ui(); render();
  toast('Clone ajouté');
}


function cloneCurrentFrame() {
  const z = curZone(), f = curFrame();
  if (!z || !f) { toast('Sélectionner une frame'); return; }
  cloneFrame(z.id, f.id);
}

/* ===== CRUD: Blocks (always on the real, non-clone frame) ===== */
function selBlockId(id) { S.selBlock=id; ui(); render(); }

function delBlock(bid) {
  const f = curFrame(); if (!f || f.ref) return;
  pushUndo(f, 'suppression de bloc');
  f.blocks = f.blocks.filter(b=>b.id!==bid);
  if (S.selBlock===bid) S.selBlock=null;
  ui(); render();
}

/* ===== Mirror tile pixel extraction ===== */
function tilePx(px, py, mirror) {
  const d=S.imgData.data, iw=S.imgData.width, tw=8, th=S.tileH;
  const buf = new Uint8ClampedArray(tw*th*4);
  for (let y=0; y<th; y++) for (let x=0; x<tw; x++) {
    let sx = x, sy = y;
    if (mirror === 'h' || mirror === 'hv') sx = tw-1-x;
    if (mirror === 'v' || mirror === 'hv') sy = th-1-y;
    const si = ((py+sy)*iw + (px+sx))*4, di = (y*tw+x)*4;
    buf[di]=d[si]; buf[di+1]=d[si+1]; buf[di+2]=d[si+2]; buf[di+3]=d[si+3];
  }
  return buf;
}

/* Enumerate all tiles across all animations, resolving clones.
   Each tile gets a {px,py,mirror,animId} record.
   Mirrored tiles are appended per-animation if zone.mirror !== 'none'.
   For H/HV mirror, tile column order is reversed within each block and for
   V/HV the row order is reversed, so the mirrored tiles are laid out
   left-to-right / top-to-bottom as they will appear on screen. */
function blockTileOrder(b, mirror) {
  const cols = b.w/8, rows = b.h/S.tileH;
  const flipX = (mirror === 'h' || mirror === 'hv');
  const flipY = (mirror === 'v' || mirror === 'hv');
  const list = [];
  for (let ry=0; ry<rows; ry++) {
    const ty = flipY ? rows-1-ry : ry;
    for (let rx=0; rx<cols; rx++) {
      const tx = flipX ? cols-1-rx : rx;
      list.push({ px:b.x+tx*8, py:b.y+ty*S.tileH });
    }
  }
  return list;
}

function allTilesWithMirror() {
  const out = [];
  S.zones.forEach(zone => {
    /* normal tiles: natural reading order */
    zone.frames.forEach(f => {
      if (f.ref) return;
      const { frame } = resolveFrame(f);
      if (!frame) return;
      frame.blocks.forEach(b => {
        blockTileOrder(b, 'none').forEach(t =>
          out.push({ px:t.px, py:t.py, animId:zone.id, frameId:f.id, mirror:'none' }));
      });
    });
    /* mirror tiles: reversed order so they read left-to-right on screen */
    if (zone.mirror && zone.mirror !== 'none') {
      zone.frames.forEach(f => {
        if (f.ref) return;
        const { frame } = resolveFrame(f);
        if (!frame) return;
        frame.blocks.forEach(b => {
          blockTileOrder(b, zone.mirror).forEach(t =>
            out.push({ px:t.px, py:t.py, animId:zone.id, frameId:f.id, mirror:zone.mirror }));
        });
      });
    }
  });
  return out;
}
