/* ================================================================
   PREVIEW — Animation playback
   ================================================================ */

let pvCv, pvC;

function initPreview() {
  pvCv = document.getElementById('prevCanvas');
  pvC  = pvCv.getContext('2d');
}

function previewC0Css(alpha) {
  const c = S.pal[0] || { r:0, g:0, b:0, a:255 };
  const a = (c.a == null ? 255 : c.a) / 255 * alpha;
  return 'rgba('+c.r+','+c.g+','+c.b+','+a+')';
}

function getZoneMaxExtent(zn) {
  let ml=0, mt=0, mr=0, mb=0;
  zn.frames.forEach(fr => {
    const { frame } = resolveFrame(fr);
    if (!frame || frame.blocks.length===0) return;
    const a = getAnchor(frame);
    frame.blocks.forEach(b => {
      ml = Math.max(ml, a.x - b.x);
      mt = Math.max(mt, a.y - b.y);
      mr = Math.max(mr, b.x + b.w - a.x);
      mb = Math.max(mb, b.y + b.h - a.y);
    });
  });
  return { ml, mt, mr, mb, w:ml+mr, h:mt+mb };
}

function drawPreviewBlock(src,b,dx,dy,dw,dh,a0) {
  if (a0 > 0) {
    pvC.globalAlpha = a0;
    pvC.drawImage(S.img,b.x,b.y,b.w,b.h,dx,dy,dw,dh);
    pvC.globalAlpha = 1;
  }
  if (S.imgNoC0) pvC.drawImage(S.imgNoC0,b.x,b.y,b.w,b.h,dx,dy,dw,dh);
  else pvC.drawImage(S.img,b.x,b.y,b.w,b.h,dx,dy,dw,dh);
}

function renderPreview(overrideHost) {
  const zn = curZone();
  const box = document.getElementById('prevBox');
  if (!zn || !zn.frames.length || !S.img) { box.style.display='none'; return; }
  box.style.display = 'block';
  const pc0 = document.getElementById('optPrevC0'), pc0v = document.getElementById('prevC0val'), pbo = document.getElementById('optPrevBlockOutline');
  if (pc0) pc0.value = S.prevC0alpha == null ? 100 : S.prevC0alpha;
  if (pc0v) pc0v.textContent = (S.prevC0alpha == null ? 100 : S.prevC0alpha) + '%';
  if (pbo) pbo.checked = S.previewBlockOutline !== false;

  const hostFrame = overrideHost
    || (A.playing ? zn.frames[A.fidx % zn.frames.length] : curFrame())
    || zn.frames[0];

  const { frame } = resolveFrame(hostFrame);
  if (!frame || frame.blocks.length === 0) {
    pvC.clearRect(0,0,pvCv.width,pvCv.height);
    document.getElementById('prevInfo').textContent = '(vide)';
    return;
  }

  const ext = getZoneMaxExtent(zn);
  const pad = 4;
  const maxDim = Math.max(ext.w||16, ext.h||16);
  const sc = Math.max(1, Math.min(4, Math.floor(180/maxDim)));
  const cw = (ext.w + pad*2) * sc;
  const ch = (ext.h + pad*2) * sc;

  pvCv.width  = Math.max(32, cw);
  pvCv.height = Math.max(32, ch);
  pvCv.style.width  = pvCv.width+'px';
  pvCv.style.height = pvCv.height+'px';
  pvC.imageSmoothingEnabled = false;
  pvC.clearRect(0,0,pvCv.width,pvCv.height);

  const a0 = (S.prevC0alpha != null ? S.prevC0alpha : 100) / 100;
  pvC.fillStyle = previewC0Css(a0);
  pvC.fillRect(0,0,pvCv.width,pvCv.height);

  const a  = getAnchor(frame);
  const ox = (ext.ml + pad) * sc;
  const oy = (ext.mt + pad) * sc;
  let fl=null, ft=null, fr=null, fb=null;

  frame.blocks.forEach(b => {
    const dx = (b.x-a.x)*sc + ox, dy = (b.y-a.y)*sc + oy, dw = b.w*sc, dh = b.h*sc;
    drawPreviewBlock(S.img,b,dx,dy,dw,dh,a0);
    if (S.previewBlockOutline !== false) {
      pvC.save();
      pvC.strokeStyle = previewC0Css(1); pvC.lineWidth = 0.5;
      pvC.setLineDash([2,2]);
      pvC.strokeRect(dx+.5,dy+.5,Math.max(1,dw-1),Math.max(1,dh-1));
      pvC.restore();
    }
    fl = fl==null ? dx : Math.min(fl,dx); ft = ft==null ? dy : Math.min(ft,dy);
    fr = fr==null ? dx+dw : Math.max(fr,dx+dw); fb = fb==null ? dy+dh : Math.max(fb,dy+dh);
  });
  if (fl != null && S.previewBlockOutline !== false) {
    pvC.save();
    pvC.strokeStyle = previewC0Css(1); pvC.lineWidth = 0.5;
    pvC.setLineDash([]);
    pvC.strokeRect(fl+.5,ft+.5,Math.max(1,fr-fl-1),Math.max(1,fb-ft-1));
    pvC.restore();
  }

  pvC.strokeStyle = '#ff0000'; pvC.lineWidth = 1;
  pvC.beginPath(); pvC.moveTo(ox-4,oy); pvC.lineTo(ox+4,oy); pvC.stroke();
  pvC.beginPath(); pvC.moveTo(ox,oy-4); pvC.lineTo(ox,oy+4); pvC.stroke();

  const fidx = A.playing ? A.fidx % zn.frames.length : zn.frames.indexOf(hostFrame);
  const isClone = !!hostFrame.ref;
  document.getElementById('prevInfo').textContent =
    (isClone?'↳ ':'') + hostFrame.name + ' (d:'+hostFrame.delay+') ' + (fidx+1)+'/'+zn.frames.length;
  if (A.playing || A._step) {
    A.bankFrameId = hostFrame.id;
    if (typeof renderBank === 'function') renderBank();
  }
}

function prevPlay() {
  const zn = curZone();
  if (!zn || zn.frames.length < 2) { toast('Min 2 frames'); return; }
  A.playing = true; A.fidx = 0; A.tick = 0; A.lastT = performance.now(); A.bankFrameId = zn.frames[0].id;
  document.getElementById('btnPlay').disabled = true;
  animLoop();
}

function prevStop() {
  A.playing = false; A.bankFrameId = null;
  if (A.rafId) cancelAnimationFrame(A.rafId);
  A.rafId = null;
  document.getElementById('btnPlay').disabled = false;
  renderPreview();
  if (typeof renderBank === 'function') renderBank();
}

function animLoop() {
  if (!A.playing) return;
  const now = performance.now();
  if (now - A.lastT >= 16.67) {
    A.lastT = now; A.tick++;
    const zn = curZone();
    if (zn && zn.frames.length) {
      const fr = zn.frames[A.fidx % zn.frames.length];
      if (A.tick >= (fr.delay||1)) {
        A.tick = 0;
        A.fidx = (A.fidx+1) % zn.frames.length;
      }
    }
    renderPreview();
  }
  A.rafId = requestAnimationFrame(animLoop);
}

function prevStep(dir) {
  const zn = curZone();
  if (!zn || !zn.frames.length) { toast('Aucune frame'); return; }
  A.playing = false;
  if (A.rafId) cancelAnimationFrame(A.rafId);
  A.rafId = null;
  document.getElementById('btnPlay').disabled = false;
  const n = zn.frames.length;
  let base = (A.fidx != null) ? A.fidx : Math.max(0, zn.frames.findIndex(f=>f.id===S.selFrame));
  if (base < 0) base = 0;
  A.fidx = ((base + dir) % n + n) % n;
  A.tick = 0;
  const target = zn.frames[A.fidx];
  if (target) { setFrameSelection([target.id], target.id); A.bankFrameId = target.id; }
  A._step = true;
  renderPreviewStep();
  A._step = false;
  ui();
  if (typeof renderBank === 'function') renderBank();
}

function renderPreviewStep() {
  const zn = curZone();
  if (!zn || !zn.frames.length) return;
  const fr = zn.frames[A.fidx % zn.frames.length];
  renderPreview(fr);
}
