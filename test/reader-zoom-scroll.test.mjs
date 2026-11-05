// Reader layout zoom + keyboard/drag scrolling (owner report
// 2026-11-05): after zooming in, the TOP of the page could never be
// scrolled into view. Root cause: applyReaderZoom scaled
// #readerCanvasWrapper with `transform: scale(z)` + origin center —
// transformed overflow in the negative direction (top/left) is not
// scrollable, and the layout size never grew. The fix replaces
// transform zoom with LAYOUT zoom (real img width/height from a
// per-page zoom-1 base) in BOTH copies of the reader (teacher.html
// inline + js/curriculum.js for the admin portal), adds arrow-key
// panning / PageUp / PageDown to both keydown handlers, and adds
// mouse drag panning to the teacher reader.
// This suite EXECUTES the real functions from both files in a vm
// with a fake DOM, in the style of employee-form-open.test.mjs.
// Run from the repo root:  node test/reader-zoom-scroll.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEACHER = fs.readFileSync(path.join(REPO_ROOT, 'teacher.html'), 'utf8');
const CURR = fs.readFileSync(path.join(REPO_ROOT, 'js/curriculum.js'), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail && !cond ? ' :: ' + detail : ''));
}
function seg(src, from, to) {
  const a = src.indexOf(from);
  const b = to ? src.indexOf(to, a + 1) : -1;
  return a < 0 ? '' : src.slice(a, b < 0 ? undefined : b);
}

// ============================ structural ============================
for (const [label, src] of [['teacher', TEACHER], ['admin', CURR]]) {
  check(label + ': transform zoom is gone', !src.includes('scale(${CURRENT_READER_ZOOM})'));
  const apply = seg(src, 'function applyReaderZoom()', 'function changeReaderZoom');
  check(label + ': applyReaderZoom uses layout zoom (base + inline size, caps lifted)',
    apply.includes('READER_BASE_W') && apply.includes('img.style.width') &&
    apply.includes("img.style.maxWidth = 'none'") && apply.includes("wrapper.style.maxWidth = 'none'") &&
    !apply.includes('wrapper.style.transform = `scale('));
  check(label + ': zoom 1 restores the original CSS sizing',
    apply.includes("img.style.width = '';") && apply.includes("wrapper.style.maxWidth = '';"));
  const renderEnd = label === 'teacher' ? '// Teacher portal: loads storage pages' : '// Loads a reader page image';
  const render = seg(src, 'function renderReaderCurrentPage()', renderEnd);
  check(label + ': renderReaderCurrentPage resets the per-page base',
    render.includes('READER_BASE_W = 0;') && render.includes('READER_BASE_H = 0;'));
  check(label + ': resetReaderZoom scrolls to (0,0)',
    seg(src, 'function resetReaderZoom()', 'function fitReaderWidth()').includes('area.scrollTop = 0;'));
  check(label + ': keydown handler pans with arrows at zoom>1 and has PageUp/PageDown',
    src.includes("e.key === 'PageUp'") && src.includes("e.key === 'PageDown'") &&
    src.includes('area.scrollLeft -= 90') && src.includes('area.scrollTop += 90'));
}
check('teacher: drag panning exists, gated on annotation being off',
  TEACHER.includes('function setupReaderPanning()') &&
  seg(TEACHER, 'function setupReaderPanning()', 'function toggleReaderFullscreen()').includes('if (ANNOTATION_ACTIVE) return;'));
check('teacher: reader open wires up drag panning',
  seg(TEACHER, 'function openDigitalBookReader(', 'function populateReaderJumpSelect').includes('setupReaderPanning();'));

// ============================ fake DOM ==============================
function makeEl(id) {
  const el = {
    id, style: {}, innerText: '', value: '',
    clientWidth: 0, clientHeight: 0, scrollLeft: 0, scrollTop: 0,
    scrollWidth: 0, scrollHeight: 0, naturalWidth: 0, naturalHeight: 0,
    _handlers: {},
    classList: {
      _set: new Set(),
      add(...cs) { cs.forEach(c => this._set.add(c)); },
      remove(...cs) { cs.forEach(c => this._set.delete(c)); },
      toggle() {},
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    dispatch(type, ev) { (this._handlers[type] || []).slice().forEach(fn => fn(ev)); },
  };
  return el;
}
function makeCtx(extra) {
  const els = new Map();
  const winHandlers = {};
  const ctx = {
    console,
    document: {
      activeElement: { tagName: 'BODY' },
      getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    },
    addEventListener: (type, fn) => { (winHandlers[type] = winHandlers[type] || []).push(fn); },
    setTimeout: () => 0,
    clearTimeout: () => {},
    ...extra,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, els, winHandlers };
}
function primeStage(ctx, els) {
  const img = ctx.document.getElementById('readerPageImg');
  img.clientWidth = 400; img.clientHeight = 560;      // rendered size at zoom 1
  img.naturalWidth = 1200; img.naturalHeight = 1680;  // intrinsic page size
  const area = ctx.document.getElementById('readerContentArea');
  area.clientWidth = 800; area.clientHeight = 600;
  ctx.document.getElementById('readerCanvasWrapper');
  ctx.document.getElementById('readerZoomLevel');
  return { img, area, wrapper: ctx.document.getElementById('readerCanvasWrapper') };
}
// Layout model of the scroll area: #readerImageStage (min-h-full, grows
// with content, ~32px total padding) wraps the img at its LAYOUT size,
// so the scrollable height is driven by the img's layout height and the
// page's top edge sits at a non-negative content offset.
function assertFullyReachable(label, img, area, wrapper) {
  const imgH = parseInt(img.style.height, 10);
  const pageTopOffset = 16; // stage padding above the page (>= 0: reachable)
  const scrollH = Math.max(area.clientHeight, imgH + 32);
  check(label + ': zoomed page height is real layout size', Number.isFinite(imgH) && imgH > area.clientHeight, 'imgH=' + imgH);
  check(label + ': whole page inside the scrollable range, top edge reachable',
    !wrapper.style.transform && pageTopOffset >= 0 && pageTopOffset + imgH <= scrollH);
}
const keyEv = (key) => ({ key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() { this.pd = true; } });

// ====================== execution: teacher ==========================
{
  const flips = [];
  let syncCalls = 0;
  const { ctx, els, winHandlers } = makeCtx({
    changeReaderPage: (d) => flips.push(d),
    closeDigitalBookReader: () => {},
    undoAnnotation: () => {},
    redoAnnotation: () => {},
    toggleReaderWhiteboard: () => {},
    selectAnnotationTool: () => {},
    resizeAndSyncAnnotationCanvas: () => { syncCalls++; },
  });
  const prelude = `
    let CURRENT_READER_ZOOM = 1.0;
    let READER_BASE_W = 0;
    let READER_BASE_H = 0;
    let READER_IS_PANNING = false;
    let READER_PAN_START_X = 0;
    let READER_PAN_START_Y = 0;
    let READER_SCROLL_START_X = 0;
    let READER_SCROLL_START_Y = 0;
    let ANNOTATION_ACTIVE = false;
  `;
  const zoomRegion = seg(TEACHER, 'function applyReaderZoom()', 'function toggleReaderFullscreen()');
  const keyRegion = seg(TEACHER, '// Keyboard & Wheel controls for teacher reader', 'function parseTeacherTimeToMinutes');
  check('teacher: extraction anchors found', zoomRegion.includes('applyReaderZoom') && keyRegion.includes("addEventListener('keydown'"));
  vm.runInContext(prelude + zoomRegion + keyRegion, ctx);
  const { img, area, wrapper } = primeStage(ctx, els);
  const get = (expr) => vm.runInContext(expr, ctx);

  get('applyReaderZoom()');
  check('teacher: base captured from the zoom-1 rendered size', get('READER_BASE_W') === 400 && get('READER_BASE_H') === 560,
    'base=' + get('READER_BASE_W') + 'x' + get('READER_BASE_H'));
  check('teacher: at zoom 1 no inline size is forced', !img.style.width && !img.style.maxWidth);

  get('changeReaderZoom(1.95)');
  check('teacher: zoom reaches 2.95', get('CURRENT_READER_ZOOM') === 2.95);
  check('teacher: img inline size == base * zoom', img.style.width === '1180px' && img.style.height === '1652px',
    img.style.width + 'x' + img.style.height);
  check('teacher: caps lifted on img + wrapper, wrapper has NO transform',
    img.style.maxWidth === 'none' && img.style.maxHeight === 'none' &&
    wrapper.style.maxWidth === 'none' && wrapper.style.maxHeight === 'none' && !wrapper.style.transform);
  check('teacher: zoom label shows 295%', els.get('readerZoomLevel').innerText === '295%');
  check('teacher: annotation canvas re-synced on zoom', syncCalls > 0);
  assertFullyReachable('teacher', img, area, wrapper);

  // Keyboard panning at zoom > 1: offsets move, page does NOT flip.
  area.scrollLeft = 200; area.scrollTop = 200;
  const kd = winHandlers.keydown[0];
  kd(keyEv('ArrowRight')); kd(keyEv('ArrowDown'));
  check('teacher: arrows pan at zoom>1 (no page flip)', area.scrollLeft === 290 && area.scrollTop === 290 && flips.length === 0,
    `scroll=${area.scrollLeft},${area.scrollTop} flips=${flips.length}`);
  kd(keyEv('ArrowUp')); kd(keyEv('ArrowLeft'));
  check('teacher: ArrowUp/Left pan back', area.scrollTop === 200 && area.scrollLeft === 200);
  kd(keyEv('PageDown'));
  check('teacher: PageDown scrolls ~90% of the area height', area.scrollTop === 200 + Math.round(600 * 0.9), 'scrollTop=' + area.scrollTop);
  kd(keyEv('PageUp'));
  check('teacher: PageUp scrolls back', area.scrollTop === 200);

  // Keyboard at zoom 1: Left/Right flip, Up/Down scroll.
  get('CURRENT_READER_ZOOM = 1.0');
  kd(keyEv('ArrowRight')); kd(keyEv('ArrowLeft'));
  check('teacher: arrows flip pages at zoom 1', flips.length === 2 && flips[0] === 1 && flips[1] === -1, 'flips=' + flips.join(','));
  const stBefore = area.scrollTop;
  kd(keyEv('ArrowDown'));
  check('teacher: ArrowDown scrolls at zoom 1 (no flip)', area.scrollTop === stBefore + 90 && flips.length === 2);

  // Drag panning: works zoomed + annotation off; blocked otherwise.
  get('setupReaderPanning()');
  get('CURRENT_READER_ZOOM = 2.0');
  area.scrollLeft = 100; area.scrollTop = 100;
  area.dispatch('mousedown', { clientX: 300, clientY: 300, button: 0, preventDefault() {} });
  check('teacher: drag starts a pan when zoomed + annotation off', get('READER_IS_PANNING') === true);
  (winHandlers.mousemove || []).forEach(fn => fn({ clientX: 260, clientY: 270 }));
  check('teacher: drag pans the scroll area', area.scrollLeft === 140 && area.scrollTop === 130,
    `scroll=${area.scrollLeft},${area.scrollTop}`);
  (winHandlers.mouseup || []).forEach(fn => fn({}));
  check('teacher: mouseup ends the pan', get('READER_IS_PANNING') === false);
  get('ANNOTATION_ACTIVE = true');
  area.dispatch('mousedown', { clientX: 300, clientY: 300, button: 0, preventDefault() {} });
  check('teacher: no panning while the annotation whiteboard is on', get('READER_IS_PANNING') === false);
  get('ANNOTATION_ACTIVE = false');
  get('CURRENT_READER_ZOOM = 1.0');
  area.dispatch('mousedown', { clientX: 300, clientY: 300, button: 0, preventDefault() {} });
  check('teacher: no panning at zoom 1', get('READER_IS_PANNING') === false);

  // Reset: zoom 1, CSS sizing back, scrolled to the top-left.
  get('CURRENT_READER_ZOOM = 2.0'); get('applyReaderZoom()');
  area.scrollLeft = 300; area.scrollTop = 500;
  get('resetReaderZoom()');
  check('teacher: reset restores zoom 1 + CSS sizing + scroll (0,0)',
    get('CURRENT_READER_ZOOM') === 1 && !img.style.width && !img.style.maxWidth &&
    area.scrollLeft === 0 && area.scrollTop === 0);
}

// ====================== execution: admin (curriculum.js) ============
{
  const flips = [];
  let syncCalls = 0;
  const { ctx, els, winHandlers } = makeCtx({
    TEACHING_TOOL: 'pointer',
    changeReaderPage: (d) => flips.push(d),
    closeDigitalBookReader: () => {},
    undoTeachingAnnotation: () => {},
    setTeachingTool: () => {},
    initOrResizeAnnotationCanvas: () => { syncCalls++; },
  });
  const prelude = `
    let CURRENT_READER_ZOOM = 1.0;
    let READER_BASE_W = 0;
    let READER_BASE_H = 0;
    let READER_IS_PANNING = false;
    let READER_PAN_START_X = 0;
    let READER_PAN_START_Y = 0;
    let READER_SCROLL_START_X = 0;
    let READER_SCROLL_START_Y = 0;
    let READER_SPACE_DOWN = false;
  `;
  const zoomRegion = seg(CURR, 'function applyReaderZoom()', 'function toggleReaderFullscreen()');
  const kdStart = CURR.lastIndexOf("window.addEventListener('keydown'");
  const kdEnd = CURR.indexOf("window.addEventListener('keyup'", kdStart);
  const keyRegion = kdStart > -1 && kdEnd > kdStart ? CURR.slice(kdStart, kdEnd) : '';
  check('admin: extraction anchors found', zoomRegion.includes('applyReaderZoom') && keyRegion.includes('ArrowLeft'));
  vm.runInContext(prelude + zoomRegion + keyRegion, ctx);
  const { img, area, wrapper } = primeStage(ctx, els);
  const get = (expr) => vm.runInContext(expr, ctx);

  get('applyReaderZoom()');
  check('admin: base captured from the zoom-1 rendered size', get('READER_BASE_W') === 400 && get('READER_BASE_H') === 560);

  get('changeReaderZoom(1.95)');
  check('admin: img inline size == base * zoom, wrapper has NO transform',
    img.style.width === '1180px' && img.style.height === '1652px' && !wrapper.style.transform,
    img.style.width + 'x' + img.style.height);
  check('admin: caps lifted on img + wrapper', img.style.maxWidth === 'none' && wrapper.style.maxHeight === 'none');
  check('admin: annotation canvas re-synced on zoom', syncCalls > 0);
  assertFullyReachable('admin', img, area, wrapper);

  area.scrollLeft = 200; area.scrollTop = 200;
  const kd = winHandlers.keydown[0];
  kd(keyEv('ArrowRight')); kd(keyEv('ArrowDown'));
  check('admin: arrows pan at zoom>1 (no page flip)', area.scrollLeft === 290 && area.scrollTop === 290 && flips.length === 0,
    `scroll=${area.scrollLeft},${area.scrollTop} flips=${flips.length}`);
  kd(keyEv('PageDown'));
  check('admin: PageDown scrolls ~90% of the area height', area.scrollTop === 290 + Math.round(600 * 0.9), 'scrollTop=' + area.scrollTop);

  get('CURRENT_READER_ZOOM = 1.0');
  kd(keyEv('ArrowRight'));
  check('admin: ArrowRight flips the page at zoom 1', flips.length === 1 && flips[0] === 1);
  const stBefore = area.scrollTop;
  kd(keyEv('ArrowDown'));
  check('admin: ArrowDown scrolls at zoom 1 (no flip)', area.scrollTop === stBefore + 90 && flips.length === 1);

  get('CURRENT_READER_ZOOM = 2.0'); get('applyReaderZoom()');
  area.scrollLeft = 300; area.scrollTop = 500;
  get('resetReaderZoom()');
  check('admin: reset restores zoom 1 + CSS sizing + scroll (0,0)',
    get('CURRENT_READER_ZOOM') === 1 && !img.style.width && area.scrollLeft === 0 && area.scrollTop === 0);
}

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
