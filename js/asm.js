/* ================================================================
   ASM — WLA-DX metasprite definition export (.inc)
   ================================================================

   Produces _{name}_metasprite_def.inc with:
     - pointer table _{name}_metatable
     - per animation: frame count + frame pointer table (+mirror set)
     - per frame: size-box line (delay,xMin,xMax,ySize)
                  one .db Y,X,tile,$FE/$FF line per 8x(tileH) tile
                  (Dynamic mode) .dw VRAM load addresses + $FFFF
     - .EQU {NAME}_TILE base address + address helpers
   ================================================================ */

/* signed 8-bit -> $XX hex string */
function asmByte(v) {
  let b = v & 0xff;
  return '$' + b.toString(16).toUpperCase().padStart(2,'0');
}
function asmWord(v) {
  return '$' + (v & 0xffff).toString(16).toUpperCase().padStart(4,'0');
}

/* sanitize a name into an asm label fragment */
function asmName(s) {
  return (s||'').toLowerCase().replace(/[^a-z0-9_]+/g,'_').replace(/^_+|_+$/g,'') || 'x';
}

/* Build the GLOBAL tile dedup map identical to the tile bank ordering.
   Returns { keyToIndex:Map, tilesPerMeta:int (1 or 2), count:int }.
   Index counts in VRAM tile units: each 8x16 metatile = 2 tile slots. */
function buildTileIndexMap() {
  const th = S.tileH;
  const dedup = document.getElementById('optDedup').checked;
  const tilesPerMeta = (th === 16) ? 2 : 1;

  const keyToIndex = new Map();   // pixel-key -> VRAM tile index (already *tilesPerMeta scaled)
  let nextSlot = 0;               // in 8x8 VRAM slots

  /* iterate exactly like allTilesWithMirror() so ordering matches the bank */
  const order = allTilesWithMirror(); // each entry is one 8x(tileH) metatile
  order.forEach(t => {
    const buf = tilePx(t.px, t.py, t.mirror);
    const key = t.mirror + '|' + buf.join(',');
    if (!dedup || !keyToIndex.has(key)) {
      if (!keyToIndex.has(key)) {
        keyToIndex.set(key, nextSlot);
        nextSlot += tilesPerMeta;
      }
    }
  });

  return { keyToIndex, tilesPerMeta, count: nextSlot };
}

/* Get VRAM tile index for a single 8x(tileH) metatile at (px,py,mirror) */
function tileIndexFor(map, px, py, mirror) {
  const buf = tilePx(px, py, mirror);
  const key = mirror + '|' + buf.join(',');
  const idx = map.keyToIndex.get(key);
  return idx !== undefined ? idx : 0;
}

/* Enumerate the 8x(tileH) sub-tiles of a block, in the SAME order the tile
   bank uses. For H/HV the columns are reversed, for V/HV the rows, so the
   tile indices line up with the (reversed) mirrored bank layout. */
function blockSubTiles(b, mirror) {
  const th = S.tileH;
  const cols = b.w/8, rows = b.h/th;
  const flipX = (mirror === 'h' || mirror === 'hv');
  const flipY = (mirror === 'v' || mirror === 'hv');
  const list = [];
  for (let ry=0; ry<rows; ry++) {
    const ty = flipY ? rows-1-ry : ry;
    for (let rx=0; rx<cols; rx++) {
      const tx = flipX ? cols-1-rx : rx;
      list.push({ px:b.x+tx*8, py:b.y+ty*th, dx:tx*8, dy:ty*th });
    }
  }
  return list;
}

/* Generate ASM text for one frame (non-clone, resolved).
   `mirror` is 'none' or the animation mirror applied to this rendering. */
function asmFrame(frame, frameLabel, mirror, idxMap, baseEqu, dynamic) {
  const th = S.tileH;
  const a = getAnchor(frame);
  const bb = getBBox(frame) || { x:a.x, y:a.y, w:8, h:th };

  /* size box relative to anchor (signed) */
  let xMin = bb.x - a.x;
  let xMax = (bb.x + bb.w) - a.x;
  let ySize = bb.h;
  /* mirror H flips X bounds around anchor */
  if (mirror === 'h' || mirror === 'hv') {
    const nMin = -xMax, nMax = -xMin;
    xMin = nMin; xMax = nMax;
  }

  const lines = [];
  lines.push(frameLabel + ':');
  if (S.attrEnable) {
    const av = frame._attr || 0;
    lines.push('.db ' + frame._delay + ',' + asmByte(xMin) + ',' + asmByte(xMax) + ',' + asmByte(ySize) +
               ',%' + av.toString(2).padStart(8,'0') +
               ' ; delay, xMin, xMax, ySize, attr');
  } else {
    lines.push('.db ' + frame._delay + ',' + asmByte(xMin) + ',' + asmByte(xMax) + ',' + asmByte(ySize) +
               ' ; delay, xMin, xMax, ySize');
  }

  /* gather per-tile rows */
  const tileRows = [];    // {Y,X,idx}
  const addrOffsets = []; // ROM byte offsets for dynamic load table
  const tilesPerMeta = idxMap.tilesPerMeta;   // 2 for 8x16, 1 for 8x8

  /* per-frame VRAM slot counter (Dynamic mode): each frame reloads tiles
     into the same VRAM block, so indices restart from startTile every frame.
     In Preload mode, indices follow the global deduplicated bank order. */
  let frameSlot = 0;

  frame.blocks.forEach(b => {
    blockSubTiles(b, mirror).forEach(st => {
      /* tile top-left position relative to anchor */
      let relX = st.px - a.x;
      let relY = st.py - a.y;
      if (mirror === 'h' || mirror === 'hv') relX = -((st.px + 8) - a.x);
      if (mirror === 'v' || mirror === 'hv') relY = -((st.py + th) - a.y);

      const globalIdx = tileIndexFor(idxMap, st.px, st.py, mirror); /* 8x8 slot units */

      let vramIdx;
      if (dynamic) {
        /* restart from base each frame, increment per metatile */
        vramIdx = S.startTile + frameSlot;
        frameSlot += tilesPerMeta;
      } else {
        /* global growing index from the bank */
        vramIdx = S.startTile + globalIdx;
      }

      tileRows.push({ Y:relY, X:relX, idx:vramIdx });
      addrOffsets.push(globalIdx * 0x20); /* ROM offset = global slot × 0x20 */
    });
  });

  tileRows.forEach((r, i) => {
    const term = (i === tileRows.length-1) ? '$FF' : '$FE';
    lines.push('.db ' + asmByte(r.Y) + ',' + asmByte(r.X) + ',' +
               asmByte(r.idx) + ',' + term);
  });
  if (tileRows.length === 0) {
    lines.push('.db $00,$00,$00,$FF ; (frame vide)');
  }

  /* dynamic load address table */
  if (dynamic) {
    const addrs = addrOffsets.map(off => '(' + baseEqu + '+' + asmWord(off) + ')');
    addrs.push('$FFFF');
    lines.push('.dw ' + addrs.join(','));
  }

  return lines.join('\n');
}

/* Main export */
function exportASM() {
  if (!S.zones.length) { toast('Aucune animation'); return; }
  if (!S.imgData) { toast('Aucune image'); return; }

  const name = asmName(S.projectName);
  const NAME = name.toUpperCase();
  const baseEqu = NAME + '_TILE';
  const dynamic = (S.alloc === 'dynamic');
  const idxMap = buildTileIndexMap();

  const out = [];
  out.push('; ============================================================');
  out.push('; ' + S.projectName + ' — metasprite definitions (WLA-DX)');
  out.push('; Généré par SMS Metasprite Editor');
  out.push('; Mode tiles : 8x' + S.tileH + '   Allocation : ' + S.alloc);
  out.push('; Tiles : ' + (idxMap.count) + ' tiles VRAM (index départ ' + S.startTile + ')');
  out.push('; ============================================================');
  out.push('');
  if (S.attrEnable) {
    /* attribute bit map comment, matching the branching-tree style:
       bit0 (LSB) has '+' at far right, bit7 (MSB) at far left. */
    const bits = (S.attrBits && S.attrBits.length===8) ? S.attrBits : defaultAttrBits();
    out.push('; attribut bits (octet par frame, bit0 = LSB)');
    out.push(';   0b00000000');
    for (let i=0; i<8; i++) {
      /* row for bit i: (7-i) leading pipes, then '+', total width 8 columns */
      const pipes = '|'.repeat(7 - i);
      const col = pipes + '+';
      out.push(';   ' + col + ' ' + (bits[i].name||('bit'+i)) +
               (bits[i].desc ? ' — ' + bits[i].desc : ''));
    }
    out.push('');
  }
  if (dynamic || S.simpleMode) {
    out.push('.EQU ' + baseEqu + ' $' + (0x8000).toString(16).toUpperCase().padStart(4,'0') +
             ' ; Adresse ROM');
    out.push('');
  }

  /* pointer table */
  out.push('; pointer table');
  out.push('_' + name + '_metatable:');
  S.zones.forEach(z => {
    out.push('.dw ' + name + '_' + asmName(z.name));
  });
  out.push('');

  /* ---- Pre-pass: map every NON-clone frame to its physical label ----
     key "zoneId|frameId" -> { animLabel, idx } so clones can point at the
     source frame's body label instead of duplicating it. */
  const physLabel = new Map();
  S.zones.forEach(z => {
    const animLabel = name + '_' + asmName(z.name);
    z.frames.forEach((f, i) => {
      if (!f.ref) physLabel.set(z.id + '|' + f.id, { animLabel, idx:i });
    });
  });

  /* resolve the body label for a host frame (clone-aware).
     Returns { base, mirrorSuffix:true if source anim has mirror } */
  function bodyLabelFor(hostFrame, hostZone, hostIdx) {
    if (hostFrame.ref) {
      const srcZone = S.zones.find(z => z.id === hostFrame.ref.zoneId);
      const phys = physLabel.get(hostFrame.ref.zoneId + '|' + hostFrame.ref.frameId);
      if (srcZone && phys) {
        return {
          normal: phys.animLabel + '_frame' + phys.idx,
          mirror: phys.animLabel + '_frame' + phys.idx + '_' + (srcZone.mirror || 'h'),
          srcHasMirror: srcZone.mirror && srcZone.mirror !== 'none',
          isClone: true
        };
      }
    }
    const animLabel = name + '_' + asmName(hostZone.name);
    return {
      normal: animLabel + '_frame' + hostIdx,
      mirror: animLabel + '_frame' + hostIdx + '_' + (hostZone.mirror || 'h'),
      srcHasMirror: hostZone.mirror && hostZone.mirror !== 'none',
      isClone: false
    };
  }

  /* detect a "full clone" animation: every frame is a clone, and they all
     reference the SAME source animation, in the same order/count.
     -> we alias the label onto the source and emit no body. */
  function fullCloneTarget(z) {
    if (!z.frames.length) return null;
    if (!z.frames.every(f => f.ref)) return null;
    const firstZoneId = z.frames[0].ref.zoneId;
    if (!z.frames.every(f => f.ref.zoneId === firstZoneId)) return null;
    const srcZone = S.zones.find(s => s.id === firstZoneId);
    if (!srcZone || srcZone.id === z.id) return null;
    /* must map 1:1 to the source's non-clone frames in order */
    const srcNonClone = srcZone.frames.filter(f => !f.ref);
    if (srcNonClone.length !== z.frames.length) return null;
    for (let i = 0; i < z.frames.length; i++) {
      if (z.frames[i].ref.frameId !== srcNonClone[i].id) return null;
    }
    return srcZone;
  }

  /* ---- collect full-clone aliases: srcZoneId -> [aliasLabel,...] ---- */
  const aliasesFor = new Map();
  const fullCloneZones = new Set();
  S.zones.forEach(z => {
    const tgt = fullCloneTarget(z);
    if (tgt) {
      fullCloneZones.add(z.id);
      const arr = aliasesFor.get(tgt.id) || [];
      arr.push({ label: name + '_' + asmName(z.name), srcName: tgt.name, name: z.name });
      aliasesFor.set(tgt.id, arr);
    }
  });

  /* first-tile ROM offset for a frame (simple mode), respecting mirror */
  function frameFirstRomOffset(frame, mirror) {
    if (!frame || !frame.blocks.length) return 0;
    const b = frame.blocks[0];
    const sts = blockSubTiles(b, mirror);
    const st = sts[0];
    const globalIdx = tileIndexFor(idxMap, st.px, st.py, mirror);
    return globalIdx * 0x20;
  }

  /* per animation */
  S.zones.forEach(z => {
    if (fullCloneZones.has(z.id)) return;

    const anim = asmName(z.name);
    const animLabel = name + '_' + anim;
    const hasMirror = z.mirror && z.mirror !== 'none';
    const loopBit = (z.loop !== false) ? 1 : 0;
    const infoByte = '%' + (loopBit & 0xff).toString(2).padStart(8,'0');

    out.push('; ---- ' + z.name + (hasMirror ? '  (miroir '+z.mirror.toUpperCase()+')' : '') +
             ((z.loop !== false) ? '  [boucle]' : '  [une fois]') + ' ----');
    out.push(animLabel + ':');
    const aliases = aliasesFor.get(z.id);
    if (aliases) aliases.forEach(al => out.push(al.label + ': ; clone de ' + z.name));

    out.push('.db ' + z.frames.length + ', ' + infoByte + ' ; nb frames, %bit info');

    /* ===== SIMPLE MODE: one tile-address .dw row per direction ===== */
    if (S.simpleMode) {
      const fseq = z.frames.map((f,i) => {
        const { frame } = resolveFrame(f);
        return { frame, label:i };
      });
      const idxList = z.frames.map((f,i) => {
        /* frame index label for the comment (clone-aware position) */
        return i;
      });

      const normAddrs = fseq.map(fs => '(' + baseEqu + '+' + asmWord(frameFirstRomOffset(fs.frame, 'none')) + ')');
      out.push('.dw ' + normAddrs.join(', ') + ' ; normal frames');
      if (hasMirror) {
        const mirAddrs = fseq.map(fs => '(' + baseEqu + '+' + asmWord(frameFirstRomOffset(fs.frame, z.mirror)) + ')');
        out.push('.dw ' + mirAddrs.join(', ') + ' ; miroir ' + z.mirror.toUpperCase());
      }
      out.push('');
      return;
    }

    /* ===== NORMAL MODE: frame pointer table + bodies ===== */
    out.push('meta_' + animLabel + ':');

    const normPtrs = [];
    const mirPtrs  = [];
    z.frames.forEach((f, i) => {
      const bl = bodyLabelFor(f, z, i);
      normPtrs.push(bl.normal);
      if (hasMirror) {
        mirPtrs.push(bl.isClone && bl.srcHasMirror ? bl.mirror : (animLabel + '_frame' + i + '_' + z.mirror));
      }
    });

    out.push('.dw ' + normPtrs.join(',') + ' ; normal');
    if (hasMirror) out.push('.dw ' + mirPtrs.join(',') + ' ; miroir ' + z.mirror.toUpperCase());
    out.push('');

    z.frames.forEach((f, i) => {
      if (f.ref) return;
      const { frame } = resolveFrame(f);
      if (!frame) return;
      frame._delay = f.delay != null ? f.delay : 8;
      frame._attr = f.attr || 0;
      out.push(asmFrame(frame, animLabel + '_frame' + i, 'none', idxMap, baseEqu, dynamic));
      out.push('');
    });

    if (hasMirror) {
      z.frames.forEach((f, i) => {
        if (f.ref) return;
        const { frame } = resolveFrame(f);
        if (!frame) return;
        frame._delay = f.delay != null ? f.delay : 8;
      frame._attr = f.attr || 0;
        out.push(asmFrame(frame, animLabel + '_frame' + i + '_' + z.mirror, z.mirror, idxMap, baseEqu, dynamic));
        out.push('');
      });
    }
  });

  const text = out.join('\n');
  const blob = new Blob([text], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '_' + name + '_metasprite_def.inc';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('ASM exporté : ' + a.download);
}


function cName(s) {
  const n = asmName(s);
  return /^[0-9]/.test(n) ? '_' + n : n;
}
function cHex8(v) {
  return '0x' + (v & 0xff).toString(16).toUpperCase().padStart(2,'0');
}
function cHex16(v) {
  return '0x' + (v & 0xffff).toString(16).toUpperCase().padStart(4,'0');
}
function cArray(type, name, vals, perLine) {
  perLine = perLine || 12;
  if (!vals.length) return 'const ' + type + ' ' + name + '[] = { };\n';
  const lines = [];
  for (let i=0; i<vals.length; i+=perLine) {
    const last = i + perLine >= vals.length;
    lines.push('  ' + vals.slice(i,i+perLine).join(', ') + (last ? '' : ','));
  }
  return 'const ' + type + ' ' + name + '[] = {\n' + lines.join('\n') + '\n};\n';
}
function cFrame(frame, mirror, idxMap, baseDef, dynamic) {
  const th = S.tileH;
  const a = getAnchor(frame);
  const bb = getBBox(frame) || { x:a.x, y:a.y, w:8, h:th };
  let xMin = bb.x - a.x, xMax = (bb.x + bb.w) - a.x, ySize = bb.h;
  if (mirror === 'h' || mirror === 'hv') { const nMin = -xMax, nMax = -xMin; xMin = nMin; xMax = nMax; }
  const bytes = [cHex8(frame._delay), cHex8(xMin), cHex8(xMax), cHex8(ySize)];
  if (S.attrEnable) bytes.push(cHex8(frame._attr || 0));
  const addrs = [];
  const tilesPerMeta = idxMap.tilesPerMeta;
  let frameSlot = 0, count = 0;
  frame.blocks.forEach(b => {
    blockSubTiles(b, mirror).forEach(st => {
      let relX = st.px - a.x, relY = st.py - a.y;
      if (mirror === 'h' || mirror === 'hv') relX = -((st.px + 8) - a.x);
      if (mirror === 'v' || mirror === 'hv') relY = -((st.py + th) - a.y);
      const globalIdx = tileIndexFor(idxMap, st.px, st.py, mirror);
      let vramIdx;
      if (dynamic) { vramIdx = S.startTile + frameSlot; frameSlot += tilesPerMeta; }
      else vramIdx = S.startTile + globalIdx;
      bytes.push(cHex8(relY), cHex8(relX), cHex8(vramIdx), cHex8(0xFE));
      addrs.push(baseDef + ' + ' + cHex16(globalIdx * 0x20));
      count++;
    });
  });
  if (count) bytes[bytes.length - 1] = cHex8(0xFF);
  else bytes.push(cHex8(0), cHex8(0), cHex8(0), cHex8(0xFF));
  if (dynamic) addrs.push(cHex16(0xFFFF));
  return { bytes, addrs };
}
function exportDevkitSMS() {
  if (!S.zones.length) { toast('Aucune animation'); return; }
  if (!S.imgData) { toast('Aucune image'); return; }
  const name = cName(S.projectName);
  const NAME = name.toUpperCase();
  const guard = NAME + '_METASPRITE_DEF_H';
  const baseDef = NAME + '_TILE';
  const dynamic = (S.alloc === 'dynamic');
  const idxMap = buildTileIndexMap();
  const h = [], c = [], decl = [], metaEntries = [];
  function dec(line){ decl.push('extern ' + line + ';'); }
  function addU8(n, vals, perLine){ c.push(cArray('unsigned char', n, vals, perLine || 12)); dec('const unsigned char ' + n + '[]'); }
  function addU16(n, vals){ c.push(cArray('unsigned int', n, vals, 8)); dec('const unsigned int ' + n + '[]'); }
  function addVoidPtr(n, vals){ c.push('const void * const ' + n + '[] = {\n  ' + vals.join(',\n  ') + '\n};\n'); dec('const void * const ' + n + '[]'); }
  function addMetaStruct(n, count, infoByte, normalList, mirrorList){ c.push('const metasprite_anim_t ' + n + ' = {\n  { ' + cHex8(count) + ', ' + cHex8(infoByte) + ' },\n  ' + normalList + ',\n  ' + (mirrorList || '0') + '\n};\n'); dec('const metasprite_anim_t ' + n); metaEntries.push('&' + n); }
  c.push('#include "' + name + '_metasprite_def.h"\n');
  function frameFirstRomOffset(frame, mirror) {
    if (!frame || !frame.blocks.length) return 0;
    const st = blockSubTiles(frame.blocks[0], mirror)[0];
    return tileIndexFor(idxMap, st.px, st.py, mirror) * 0x20;
  }
  S.zones.forEach(z => {
    const anim = name + '_' + cName(z.name);
    const hasMirror = z.mirror && z.mirror !== 'none';
    const infoByte = (z.loop !== false) ? 1 : 0;
    if (S.simpleMode) {
      const norm = [], mir = [];
      z.frames.forEach(f => {
        const r = resolveFrame(f).frame;
        norm.push(baseDef + ' + ' + cHex16(frameFirstRomOffset(r, 'none')));
        if (hasMirror) mir.push(baseDef + ' + ' + cHex16(frameFirstRomOffset(r, z.mirror)));
      });
      addU16(anim + '_tiles', norm);
      if (hasMirror) addU16(anim + '_tiles_' + z.mirror, mir);
      addVoidPtr('meta_' + anim, [anim + '_tiles']);
      if (hasMirror) addVoidPtr('meta_' + anim + '_' + z.mirror, [anim + '_tiles_' + z.mirror]);
      addMetaStruct(anim, z.frames.length, infoByte, 'meta_' + anim, hasMirror ? 'meta_' + anim + '_' + z.mirror : null);
      return;
    }
    const normPtrs = [], mirPtrs = [];
    z.frames.forEach((f,i) => {
      normPtrs.push(anim + '_frame' + i);
      if (dynamic) normPtrs.push(anim + '_frame' + i + '_rom');
      if (hasMirror) {
        mirPtrs.push(anim + '_frame' + i + '_' + z.mirror);
        if (dynamic) mirPtrs.push(anim + '_frame' + i + '_' + z.mirror + '_rom');
      }
    });
    addVoidPtr('meta_' + anim, normPtrs);
    if (hasMirror) addVoidPtr('meta_' + anim + '_' + z.mirror, mirPtrs);
    addMetaStruct(anim, z.frames.length, infoByte, 'meta_' + anim, hasMirror ? 'meta_' + anim + '_' + z.mirror : null);
    z.frames.forEach((f,i) => {
      const r = resolveFrame(f).frame;
      if (!r) return;
      r._delay = f.delay != null ? f.delay : 8;
      r._attr = f.attr || 0;
      const cf = cFrame(r, 'none', idxMap, baseDef, dynamic);
      addU8(anim + '_frame' + i, cf.bytes, 4);
      if (dynamic) addU16(anim + '_frame' + i + '_rom', cf.addrs);
      if (hasMirror) {
        const mf = cFrame(r, z.mirror, idxMap, baseDef, dynamic);
        addU8(anim + '_frame' + i + '_' + z.mirror, mf.bytes, 4);
        if (dynamic) addU16(anim + '_frame' + i + '_' + z.mirror + '_rom', mf.addrs);
      }
    });
  });
  c.push('const metasprite_anim_t * const _' + name + '_metatable[] = {\n  ' + metaEntries.join(',\n  ') + '\n};\n');
  dec('const metasprite_anim_t * const _' + name + '_metatable[]');
  h.push('#ifndef ' + guard);
  h.push('#define ' + guard);
  h.push('');
  h.push('#define ' + baseDef + ' 0x8000 /* Adresse ROM */');
  h.push('');
  h.push('#ifndef METASPRITE_ANIM_T_DEFINED');
  h.push('#define METASPRITE_ANIM_T_DEFINED');
  h.push('typedef struct {');
  h.push('  unsigned char infos[2];');
  h.push('  const void * const *frames;');
  h.push('  const void * const *frames_mirror;');
  h.push('} metasprite_anim_t;');
  h.push('#endif');
  h.push('');
  decl.forEach(d => h.push(d));
  h.push('');
  h.push('#endif');
  const hText = h.join('\n');
  const cText = c.join('\n');
  downloadTextFile(hText, name + '_metasprite_def.h');
  downloadTextFile(cText, name + '_metasprite_def.c');
  toast('DevkitSMS exporté : .c + .h');
}
function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type:'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
