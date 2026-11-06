// Annotated lesson pages — Phase E (viewer + portal surfaces).
//
// Covers: the Student-360 parser surfacing annotatedPages; the shared
// read-only viewer in js/lesson-history.js (order by seq, ORIGINAL
// page captions, legacy image first, prev/next, per-page error state,
// layout zoom, blob-URL revocation on close); and the affordances in
// Teacher history, Parent lesson cards and the 360 inspector.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LH = require('../js/lesson-history.js');
const TEACHER = fs.readFileSync(new URL('../teacher.html', import.meta.url), 'utf8');
const PARENT = fs.readFileSync(new URL('../parent.html', import.meta.url), 'utf8');
const P360 = fs.readFileSync(new URL('../js/profiles360.js', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const LH_SRC = fs.readFileSync(new URL('../js/lesson-history.js', import.meta.url), 'utf8');

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (cond ? '' : ' | ' + (extra ?? '')));
}
const NL = '\n';
function extractFunction(src, name) {
  let start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('function not found: ' + name);
  if (src.slice(start - 6, start) === 'async ') start -= 6;
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ===========================================================================
// 1) 360 parser surfaces annotatedPages
// ===========================================================================
{
  const sandbox = { console, window: { LessonHistory: LH } };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(P360, '_parseLessonDetails360') + NL + 'this.__parse = _parseLessonDetails360;', sandbox);
  const log = {
    lesson_notes: JSON.stringify({
      book_id: 'holy-quran-16-line', book_title: 'Holy Quran 16 Line', page: 5, para: 2, status: 'Pass',
      annotated_pages: [
        { key: 'scoped-teacher-T/2.webp', para: 2, page: 6, orig_page: 26, seq: 2 },
        { key: 'scoped-teacher-T/1.webp', para: 2, page: 5, orig_page: 25, seq: 1 }
      ]
    })
  };
  const p = sandbox.__parse(log);
  check('360 parser: annotatedPages surfaced, normalized to seq order',
    Array.isArray(p.annotatedPages) && p.annotatedPages.length === 2
    && p.annotatedPages[0].origPage === 25 && p.annotatedPages[1].origPage === 26, JSON.stringify(p.annotatedPages));
  const legacy = sandbox.__parse({ lesson_notes: JSON.stringify({ book_id: 'b', page: 2, image_key: 'k' }) });
  check('360 parser: legacy record -> annotatedPages null, imageKey intact',
    legacy.annotatedPages === null && legacy.imageKey === 'k');
  const plain = sandbox.__parse({ lesson_notes: 'Started late' });
  check('360 parser: plain-text record -> annotatedPages null', plain.annotatedPages === null);
}

// ===========================================================================
// 2) Viewer behaviour with a fake DOM
// ===========================================================================
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], style: {}, textContent: '', parentNode: null,
    disabled: false, src: '', alt: '', type: '',
    clientWidth: tag === 'img' ? 400 : 0, naturalWidth: tag === 'img' ? 1200 : 0,
    _listeners: {},
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentNode = null; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    addEventListener(t, fn) { el._listeners[t] = fn; },
    removeEventListener(t) { delete el._listeners[t]; },
    click() { if (el._listeners.click) el._listeners.click({}); }
  };
  return el;
}
async function flush() { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); }

const revoked = [];
let blobSeq = 0;
const docListeners = {};
const body = makeEl('body');
const documentStub = {
  body,
  createElement: (tag) => makeEl(tag),
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  removeEventListener: (t) => { delete docListeners[t]; },
  getElementById: () => null,
  querySelectorAll: () => []
};
const fetchStub = async (url) => {
  if (String(url).includes('bad')) return { ok: false, status: 403, blob: async () => ({}) };
  return { ok: true, status: 200, blob: async () => ({ fakeBlob: true }) };
};
const viewSandbox = {
  console,
  URL: { createObjectURL: () => 'blob:fake-' + (++blobSeq), revokeObjectURL: (u) => { revoked.push(u); } },
  fetch: fetchStub,
  document: documentStub,
  localStorage: { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  setTimeout, clearTimeout
};
viewSandbox.window = viewSandbox;
viewSandbox.globalThis = viewSandbox;
vm.createContext(viewSandbox);
vm.runInContext(LH_SRC, viewSandbox);
const V = viewSandbox.LessonHistory;
check('viewer: API exported', typeof V.openAnnotatedPagesViewer === 'function' && typeof V.closeAnnotatedPagesViewer === 'function');

const PAGES = [
  { key: 'scoped-teacher-T/p26.webp', para: 2, page: 6, origPage: 26, seq: 2 },
  { key: 'scoped-teacher-T/p25.webp', para: 2, page: 5, origPage: 25, seq: 1 },
  { key: 'scoped-teacher-T/bad.webp', para: 2, page: 7, origPage: 27, seq: 3 }
];
function parts() {
  const overlay = body.children[body.children.length - 1];
  const [header, stage, footer] = overlay.children;
  return {
    overlay,
    title: header.children[0], counter: header.children[1],
    img: stage.children[0], msg: stage.children[1],
    prev: footer.children[0], caption: footer.children[1],
    zoomOut: footer.children[2], zoomLabel: footer.children[3], zoomIn: footer.children[4], next: footer.children[5]
  };
}
{
  const opened = V.openAnnotatedPagesViewer(PAGES, { title: 'Holy Quran 16 Line', imageKey: 'scoped-teacher-T/photo.webp' });
  check('viewer: opens with legacy image + 3 pages', opened === true && body.children.length === 1);
  await flush();
  let p = parts();
  check('viewer: legacy image first, captioned "Lesson image", counter 1 / 4',
    p.caption.textContent === 'Lesson image' && p.counter.textContent === '1 / 4' && p.title.textContent === 'Holy Quran 16 Line',
    p.caption.textContent + '|' + p.counter.textContent);
  p.img.onload();
  check('viewer: image shown after load, loading message hidden', p.img.style.display === '' && p.msg.style.display === 'none');

  p.next.click(); await flush(); p = parts(); p.img.onload();
  check('viewer: next follows seq order -> Page 25 (original number)', p.caption.textContent === 'Page 25' && p.counter.textContent === '2 / 4', p.caption.textContent);

  p.zoomIn.click();
  check('viewer: zoom applies layout width (safe-centre stage pattern)',
    p.zoomLabel.textContent === '150%' && p.img.style.width === '600px' && p.img.style.maxWidth === 'none',
    p.zoomLabel.textContent + '|' + p.img.style.width);

  p.next.click(); await flush(); p = parts(); p.img.onload();
  check('viewer: zoom resets on page change; caption Page 26', p.caption.textContent === 'Page 26' && p.zoomLabel.textContent === '100%');

  p.next.click(); await flush(); p = parts();
  check('viewer: failing page shows an in-place error and stays navigable',
    p.msg.textContent.includes('could not be loaded') && p.next.disabled === true && p.prev.disabled === false,
    p.msg.textContent);
  p.prev.click(); await flush(); p = parts(); p.img.onload();
  check('viewer: prev returns to the good page', p.caption.textContent === 'Page 26');

  docListeners.keydown({ key: 'ArrowLeft', target: { tagName: 'DIV' } }); await flush(); p = parts(); p.img.onload();
  check('viewer: ArrowLeft keyboard navigation works', p.caption.textContent === 'Page 25');

  const revokedBefore = revoked.length;
  docListeners.keydown({ key: 'Escape', target: { tagName: 'DIV' } });
  check('viewer: Escape closes, overlay removed, blob URLs revoked, key handler removed',
    body.children.length === 0 && revoked.length > revokedBefore && !docListeners.keydown,
    'children=' + body.children.length + ' revoked=' + revoked.length);
}
{
  const opened = V.openAnnotatedPagesViewer(null, { imageKey: 'scoped-teacher-T/only.webp' });
  await flush();
  const p = parts();
  check('viewer: legacy-only record opens with a single "Lesson image" item',
    opened === true && p.caption.textContent === 'Lesson image' && p.counter.textContent === '1 / 1' && p.prev.disabled && p.next.disabled);
  V.closeAnnotatedPagesViewer();
  check('viewer: empty input opens nothing', V.openAnnotatedPagesViewer([], {}) === false && body.children.length === 0);
  check('viewer: captions fall back to the relative page, then position',
    V.annotatedPageCaption({ origPage: null, page: 7 }, 0) === 'Page 7'
    && V.annotatedPageCaption({ origPage: null, page: null }, 2) === 'Page 3');
}

// ===========================================================================
// 3) Portal surface structure
// ===========================================================================
check('teacher: history card button + handler wired',
  TEACHER.includes('View annotated pages (') && TEACHER.includes('function openTeacherAnnotatedPages(idx)'));
check('teacher: form strip has a View button for attached pages',
  TEACHER.includes('viewAttAnnotatedStripPages()') && TEACHER.includes('_ATT_STRIP_PAGES'));
check('parent: card button + handler wired, count from entry or payload',
  PARENT.includes('function openParentAnnotatedPages(idx)') && PARENT.includes('View annotated pages (${annotatedCount})') && PARENT.includes('_LH_PARENT_VISIBLE_LOGS'));
check('parent: legacy single image display untouched',
  PARENT.includes('data-lh-img-key') && PARENT.includes('hydrateParentLessonImages'));
check('360: inspector button + handler wired',
  P360.includes('function open360AnnotatedPagesFromInspector(idx)') && P360.includes('View annotated pages (${annotatedPages.length})'));
check('360: index.html loads profiles360 (handler reachable)',
  INDEX.includes('js/profiles360.js'));
check('viewer: no editing controls in the shared viewer (read-only)',
  !/contenteditable=|drawImage|execCommand/.test(LH_SRC.slice(LH_SRC.indexOf('Annotated pages viewer'))));

const failed = results.filter(r => !r.pass);
console.log('annotated-pages-viewer: ' + (results.length - failed.length) + '/' + results.length + ' passed');
if (failed.length) process.exit(1);
