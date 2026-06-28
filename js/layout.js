/* ================================================================
   LAYOUT — resizable sidebar/rpanel columns with persistence
   ================================================================ */

const LAYOUT_KEY = 'sms-meta-layout';
const DEFAULT_LEFT  = 240;
const DEFAULT_RIGHT  = 215;
const MIN_LEFT = 180, MAX_LEFT = 600;
const MIN_RIGHT = 160, MAX_RIGHT = 900;

function loadLayout() {
  let left = DEFAULT_LEFT, right = DEFAULT_RIGHT;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d.left)  left  = clamp(d.left,  MIN_LEFT,  MAX_LEFT);
      if (d.right) right = clamp(d.right, MIN_RIGHT, MAX_RIGHT);
    }
  } catch (e) {}
  applyLayout(left, right);
}

function saveLayout(left, right) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left, right }));
  } catch (e) {}
}

function applyLayout(left, right) {
  document.getElementById('app').style.gridTemplateColumns =
    left + 'px 4px 1fr 4px ' + right + 'px';
}

function getCurrentColumns() {
  const cols = getComputedStyle(document.getElementById('app')).gridTemplateColumns.split(' ');
  return {
    left:  parseFloat(cols[0]),
    right: parseFloat(cols[4])
  };
}

function initLayout() {
  loadLayout();

  const splitL = document.getElementById('splitL');
  const splitR = document.getElementById('splitR');

  bindSplitter(splitL, 'left');
  bindSplitter(splitR, 'right');
}

function bindSplitter(el, side) {
  el.addEventListener('mousedown', e => {
    e.preventDefault();
    el.classList.add('active');
    document.body.style.cursor = 'col-resize';
    const startX = e.clientX;
    const cur = getCurrentColumns();
    const startLeft  = cur.left;
    const startRight = cur.right;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (side === 'left') {
        const nl = clamp(startLeft + dx, MIN_LEFT, MAX_LEFT);
        applyLayout(nl, getCurrentColumns().right);
      } else {
        const nr = clamp(startRight - dx, MIN_RIGHT, MAX_RIGHT);
        applyLayout(getCurrentColumns().left, nr);
      }
      /* re-render canvas-dependent UI if needed (cheap no-op otherwise) */
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      el.classList.remove('active');
      document.body.style.cursor = '';
      const final = getCurrentColumns();
      saveLayout(final.left, final.right);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
