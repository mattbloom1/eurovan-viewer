// EuroVan camper viewer / configurator - entry point.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULTS, BUILDOUT_DEFAULT_OFF, PIVOT_DEFAULTS } from './config.js';
import { Finishes } from './finishes.js';
import { Openings, findNode } from './openings.js';
import { Environment, VanLights } from './environment.js';
import { Drive, heightAt } from './drive.js';
import { UI } from './ui.js';
import { loadState, saveState, shareUrl, clearSaved } from './state.js';
import { setMaxAnisotropy } from './textures.js';

const params = new URLSearchParams(location.search);
const MODEL_URL = params.get('model') || 'assets/van.glb';
const MANIFEST_URL = params.get('manifest') || MODEL_URL.replace(/[^/]*$/, 'manifest.json');

const coarse = matchMedia('(pointer: coarse)').matches;
const small = Math.min(screen.width, screen.height) < 760;
const MOBILE = coarse || small;
if (coarse) document.body.classList.add('touch');

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.localClippingEnabled = true;
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2500);
camera.position.set(-6, 2.2, 6.5);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.05;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0.95, 0);
controls.zoomSpeed = 0.9;
controls.screenSpacePanning = true;
controls.update();

const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4);
const clipPlanes = [clipPlane];

const env = new Environment(renderer, scene, { mobile: MOBILE });

// ---------------------------------------------------------------- render-on-demand loop
let dirty = true;
const requestRender = () => { dirty = true; };
controls.addEventListener('change', requestRender);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestRender();
}
window.addEventListener('resize', resize);
resize();

// Keep the van centred in the part of the screen not covered by the side panel / bottom sheet.
function updateViewOffset() {
  const w = window.innerWidth, h = window.innerHeight;
  const panel = document.getElementById('panel');
  const body = document.body;
  let ox = 0, oy = 0;
  if (panel && !body.classList.contains('driving') && !body.classList.contains('panel-closed')) {
    const r = panel.getBoundingClientRect();
    const sheet = r.width >= w - 2; // bottom-sheet layout
    if (sheet) oy = Math.min(h * 0.4, (h - r.top)) / 2;
    else ox = Math.min(w * 0.3, w - r.left) / 2;
  } else if (panel && !body.classList.contains('driving')) {
    const r = panel.getBoundingClientRect();
    if (r.width >= w - 2) oy = (h - r.top) / 2; // collapsed sheet still covers the tab bar
  }
  if (ox || oy) camera.setViewOffset(w, h, Math.round(ox), Math.round(oy), w, h);
  else camera.clearViewOffset();
  requestRender();
}
window.addEventListener('resize', () => requestAnimationFrame(updateViewOffset));
setTimeout(updateViewOffset, 0);

// ---------------------------------------------------------------- app
const app = {
  state: loadState(),
  section: { on: false, height: 1.35, auto: false },
  van: null, nodes: {}, finishes: null, openings: null, drive: null, lights: null, bounds: null,
  manifest: null,
  requestRender, camera, controls,
  onLayout() { requestAnimationFrame(updateViewOffset); requestRender(); },
};
window.__app = app; // handy for debugging from the console

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// apply a partial state change
app.set = (patch) => {
  Object.assign(app.state, patch);
  applyState(Object.keys(patch));
  saveState(app.state);
  ui && ui.sync();
  requestRender();
};

function applyState(keys) {
  const s = app.state, f = app.finishes;
  const has = k => !keys || keys.includes(k);
  if (!f) return;
  if (has('paint') || has('finish')) f.setPaint(s.paint, s.finish);
  if (has('wood')) f.setWood(s.wood);
  if (has('door') || has('doorHex') || has('wood')) f.setDoor(s.door, s.door === 'custom' ? s.doorHex : null);
  if (has('uph')) f.setUpholstery(s.uph);
  if (has('seat') || has('seatHex') || has('uph')) f.setSeat(s.seat, s.seat === 'custom' ? s.seatHex : null);
  if (has('floor')) f.setFloor(s.floor);
  const n = app.nodes;
  if (has('buildout') && n.Buildout) n.Buildout.visible = s.buildout;
  if (has('hidden') && n.Buildout) for (const c of n.Buildout.children) c.visible = !s.hidden.includes(c.name);
  if (has('interior') && n.Interior) n.Interior.visible = s.interior;
  // stock passenger seat frame only shows when the swivel seat (buildout) is not shown
  if ((has('buildout') || has('hidden')) && n.PassengerSeat_Stock) {
    const swivel = n.Buildout && n.Buildout.children.some(c => /^BO_Swivel_Seat_Table/.test(c.name));
    n.PassengerSeat_Stock.visible = !(swivel && s.buildout && !s.hidden.some(h => /^BO_Swivel_Seat_Table/.test(h)));
  }
  if (has('xray')) f.setXRay(s.xray, [n.Body, ...Object.keys(PIVOT_DEFAULTS).map(k => n[k])]);
  if (has('hour')) env.setHour(s.hour);
  if (has('hour') || has('headlights') || has('cabin')) updateLights();
}

function updateLights(brake = 0) {
  const s = app.state, night = env.nightFactor;
  const head = s.headlights || (app.drive && app.drive.active && night > 0.45) ? 1 : 0;
  const cabin = s.cabin ? 1 : 0;
  app.finishes && app.finishes.setLights({ head, brake, cabin, night });
  app.lights && app.lights.set({ head, cabin, night });
  app.drive && app.drive.setNight(night);
  app.openings && app.openings.setTentGlow(cabin * night * 0.35);
  document.body.classList.toggle('night', night > 0.5);
}

app.toggleCollection = (name, on) => {
  const hidden = new Set(app.state.hidden);
  if (on) hidden.delete(name); else hidden.add(name);
  app.set({ hidden: [...hidden] });
};
app.buildoutCollections = () => (app.nodes.Buildout ? app.nodes.Buildout.children.map(c => c.name).filter(Boolean) : []);
app.pivotList = () => Object.entries(PIVOT_DEFAULTS).filter(([k]) => app.openings && app.openings.has(k)).map(([k, d]) => [k, d.label]);
app.togglePivot = (name) => { app.openings.toggle(name); ui.sync(); requestRender(); };
app.openAll = () => { app.openings.openAll(); ui.sync(); requestRender(); };
app.closeAll = () => { app.openings.closeAll(); ui.sync(); requestRender(); };

app.setSection = (on, height) => {
  app.section.on = on;
  app.section.auto = false;
  if (height !== undefined) app.section.height = height;
  clipPlane.constant = on ? app.section.height : 1e4;
  ui && ui.sync();
  requestRender();
};

// smooth hour changes (buttons) or immediate (slider)
let hourTween = null;
app.setHour = (target, animate) => {
  if (!animate) { hourTween = null; app.set({ hour: target }); return; }
  hourTween = { from: app.state.hour, to: target, t: 0 };
};

app.modelDetails = () => {
  const m = app.manifest;
  if (!m) return 'No manifest.json found: using built-in defaults for doors, wheels and materials.';
  const parts = [];
  if (m.version) parts.push(`Version ${m.version}`);
  if (m.exported) parts.push(`exported ${fmtDate(m.exported)}`);
  if (Number.isFinite(m.total_tris)) parts.push(`${(m.total_tris / 1000).toFixed(0)}k triangles`);
  return parts.join(' · ');
};
function fmtDate(s) {
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

app.screenshot = () => {
  renderer.render(scene, camera);
  canvas.toBlob(blob => {
    if (!blob) { toast('Screenshot failed'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eurovan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Screenshot saved');
  }, 'image/png');
};
app.copyLink = async () => {
  const url = shareUrl(app.state);
  try { await navigator.clipboard.writeText(url); toast('Link copied'); }
  catch (_) { prompt('Copy this link:', url); }
};
app.reset = () => {
  hourTween = null;
  clearSaved();
  app.state = { ...DEFAULTS, hidden: defaultHidden() };
  applyState(null);
  app.closeAll();
  app.setSection(false);
  saveState(app.state);
  ui.sync();
  goView('exterior');
  toast('Reset to defaults');
};
function defaultHidden() { return app.buildoutCollections().filter(n => BUILDOUT_DEFAULT_OFF.some(re => re.test(n))); }

// ---------------------------------------------------------------- camera presets
function setFov(f) { if (camera.fov !== f) { camera.fov = f; camera.updateProjectionMatrix(); } }
let tween = null;
const views = {};
function computeViews() {
  const B = app.bounds, c = B.getCenter(new THREE.Vector3()), size = B.getSize(new THREE.Vector3());
  const L = size.z, W = size.x, Hh = size.y;
  const portrait = camera.aspect < 0.85;
  const far = portrait ? 2.0 : 1;
  const slider = app.sliderCenter || new THREE.Vector3(B.min.x, 1, c.z - 0.3);
  const fw = app.drive ? app.drive.frontZ : B.max.z - 1;
  const driverX = W * 0.22;
  views.exterior = { pos: new THREE.Vector3(-L * 1.05 * far, Hh * 1.05 + (portrait ? 1.5 : 0), L * 1.2 * far), target: new THREE.Vector3(0, Hh * 0.45, c.z) };
  // stand outside the slider opening (closed-door centre), looking in and slightly rearward
  views.interior = { pos: new THREE.Vector3(B.min.x - (portrait ? 3.0 : 2.4), B.min.y + 1.8, slider.z + (portrait ? 0.6 : 1.0)), target: new THREE.Vector3(W * 0.2, B.min.y + 0.95, slider.z - 0.25), open: ['Slider_Pivot'] };
  views.rear = { pos: new THREE.Vector3(1.4, Hh * 0.95, B.min.z - (portrait ? 6.5 : 4.4)), target: new THREE.Vector3(0, Hh * 0.5, B.min.z + 1.0), open: ['Tailgate_Pivot'] };
  views.plan = { pos: new THREE.Vector3(0, (portrait ? 9.5 : 7.5), c.z - 0.25), target: new THREE.Vector3(0, 0.6, c.z), section: true };
  const eye = new THREE.Vector3(driverX, B.min.y + 1.6, fw - 0.95);
  views.driver = { pos: eye, target: eye.clone().add(new THREE.Vector3(-0.06, -0.09, 0.4)), fov: 62 };
}

function goView(name, instant = false) {
  if (!app.bounds || (app.drive && app.drive.active)) return;
  computeViews();
  const v = views[name];
  if (!v) return;
  document.querySelectorAll('#views .chip').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if (v.open) for (const p of v.open) app.openings.set(p, true);
  if (v.section) { app.section.on = true; app.section.auto = true; clipPlane.constant = app.section.height; }
  else if (app.section.auto) { app.section.on = false; app.section.auto = false; clipPlane.constant = 1e4; }
  setFov(v.fov || 40);
  controls.maxPolarAngle = name === 'driver' || name === 'interior' ? Math.PI : Math.PI * 0.495;
  ui && ui.sync();
  if (instant) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); requestRender(); return; }
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: v.pos.clone(), t1: v.target.clone(), t: 0, dur: 1.1 };
}
document.querySelectorAll('#views .chip').forEach(b => b.addEventListener('click', () => goView(b.dataset.view)));
controls.addEventListener('start', () => { tween = null; document.querySelectorAll('#views .chip').forEach(b => b.classList.remove('active')); });

// ---------------------------------------------------------------- tap a door to toggle it
const raycaster = new THREE.Raycaster();
let downAt = null;
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; });
canvas.addEventListener('pointerup', e => {
  if (!downAt || downAt.id !== e.pointerId) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y), dt = performance.now() - downAt.t;
  downAt = null;
  if (moved > 6 || dt > 450 || !app.van || (app.drive && app.drive.active)) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(app.van, true);
  for (const hit of hits) {
    if (!isVisible(hit.object)) continue;
    if (clipPlane.constant < 1e3 && hit.point.y > clipPlane.constant) continue;
    const mat = Array.isArray(hit.object.material) ? hit.object.material[hit.face ? hit.face.materialIndex : 0] : hit.object.material;
    if (mat && mat.transparent && mat.opacity < 0.3) continue; // click through clear glass / x-ray ghost
    const p = app.openings.pivotOf(hit.object);
    if (p) { app.togglePivot(p); }
    break;
  }
});
canvas.addEventListener('pointercancel', () => { downAt = null; });
function isVisible(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

// ---------------------------------------------------------------- drive mode UI
const hud = document.getElementById('drive-hud');
const mphEl = document.getElementById('mph'), gearEl = document.getElementById('gear'), camBtn = document.getElementById('btn-cam');
const boostBar = document.getElementById('boostbar'), boostFill = document.getElementById('boost-fill'), timerEl = document.getElementById('drive-timer'), driveToast = document.getElementById('drive-toast');
let toastTimer = 0, lastBoostPct = -1, lastTimerTxt = '';
function showDriveToast(text, kind) {
  clearTimeout(toastTimer);
  if (!text) { driveToast.classList.remove('show', 'summit'); return; }
  driveToast.textContent = text;
  driveToast.classList.toggle('summit', kind === 'summit');
  driveToast.classList.add('show');
  toastTimer = setTimeout(() => driveToast.classList.remove('show'), kind === 'summit' ? 4500 : 2200);
}
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
app.enterDrive = async () => {
  if (!app.drive) return;
  app.openings.closeAll(true);
  app.setSection(false);
  tween = null;
  await app.drive.enter();
  env.setDriveFog(true);
  document.body.classList.add('driving');
  hud.hidden = false;
  updateViewOffset();
  camBtn.textContent = 'Camera: ' + app.drive.camMode;
  controls.enabled = app.drive.camMode === 'orbit';
  controls.maxPolarAngle = Math.PI * 0.48;
  updateLights();
  ui.sync();
  canvas.focus();
};
app.exitDrive = () => {
  if (!app.drive || !app.drive.active) return;
  app.drive.exit();
  lastTimerTxt = ''; lastBoostPct = -1; timerEl.hidden = true; showDriveToast(null);
  env.setDriveFog(false);
  env.setFocus(new THREE.Vector3(0, 0, 0));
  env.blob.position.set(0, 0.004, 0);
  env.blob.rotation.set(0, 0, 0);
  env.blob.material.opacity = 0.85 * (1 - env.nightFactor * 0.5);
  document.body.classList.remove('driving');
  hud.hidden = true;
  updateViewOffset();
  controls.enabled = true;
  updateLights();
  goView('exterior', true);
};
document.getElementById('btn-exit-drive').addEventListener('click', () => app.exitDrive());
document.getElementById('btn-reset-car').addEventListener('click', () => { app.drive.reset(); app.drive._place(0); app.drive._snapCamera(); });
camBtn.addEventListener('click', () => { camBtn.textContent = 'Camera: ' + app.drive.cycleCamera(); });
window.addEventListener('keydown', e => {
  if (!app.drive || !app.drive.active) return;
  if (e.code === 'Escape') app.exitDrive();
  else if (e.code === 'KeyC') camBtn.textContent = 'Camera: ' + app.drive.cycleCamera();
  else if (e.code === 'KeyR') { app.drive.reset(); app.drive._place(0); app.drive._snapCamera(); }
});

// ---------------------------------------------------------------- quick buttons
document.getElementById('btn-daynight').addEventListener('click', () => app.setHour(env.nightFactor > 0.5 ? 14 : 22, true));
document.getElementById('btn-shot').addEventListener('click', () => app.screenshot());
document.getElementById('btn-panel').addEventListener('click', () => { document.body.classList.toggle('panel-closed'); setTimeout(updateViewOffset, 380); });
if (MOBILE && window.innerWidth <= 760) document.body.classList.add('panel-closed');

// ---------------------------------------------------------------- loading
const loaderEl = document.getElementById('loader'), barEl = document.getElementById('loader-bar'), loaderText = document.getElementById('loader-text');
let ui = null;

async function fetchManifest() {
  try {
    const r = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn('[viewer] manifest not available (' + MANIFEST_URL + '):', e.message || e);
    return null;
  }
}

async function load() {
  const manifest = await fetchManifest();
  app.manifest = manifest;
  const draco = new DRACOLoader().setDecoderPath('./vendor/three/addons/libs/draco/gltf/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const bust = manifest && manifest.exported ? (MODEL_URL.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(manifest.exported) : '';
  let gltf;
  try {
    gltf = await loader.loadAsync(MODEL_URL + bust, ev => {
      if (ev.lengthComputable && ev.total) { barEl.parentElement.classList.remove('indet'); barEl.style.width = (100 * ev.loaded / ev.total).toFixed(1) + '%'; loaderText.textContent = `Loading the van… ${(ev.loaded / 1048576).toFixed(1)} / ${(ev.total / 1048576).toFixed(1)} MB`; }
      else { barEl.parentElement.classList.add('indet'); loaderText.textContent = `Loading the van… ${(ev.loaded / 1048576).toFixed(1)} MB`; }
    });
  } catch (e) {
    console.error('[viewer] failed to load model', e);
    loaderEl.classList.add('error');
    loaderText.textContent = `Could not load the model (${MODEL_URL}). ${e.message || ''}`;
    return;
  }
  loaderText.textContent = 'Preparing materials…';
  await new Promise(r => setTimeout(r, 30));
  draco.dispose();

  let van = gltf.scene.getObjectByName('Van');
  if (!van) { console.warn('[viewer] node "Van" not found: using the glTF scene root'); van = gltf.scene; van.name = 'Van'; }
  else { van.removeFromParent(); }
  scene.add(van);
  app.van = van;
  const want = ['Body', 'Interior', 'Buildout', 'PassengerSeat_Stock', ...Object.keys(PIVOT_DEFAULTS), 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
  const missing = [];
  for (const n of want) { const o = findNode(van, n); if (o) app.nodes[n] = o; else missing.push(n); }
  if (missing.length) console.warn('[viewer] nodes not found in model:', missing.join(', '));

  van.updateMatrixWorld(true);
  // Bounds of the van itself (body, doors, wheels); stray buildout/concept geometry can sit far away.
  app.bounds = new THREE.Box3();
  for (const n of ['Body', ...Object.keys(PIVOT_DEFAULTS), 'Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']) if (app.nodes[n]) app.bounds.expandByObject(app.nodes[n]);
  if (app.bounds.isEmpty()) app.bounds.setFromObject(van);
  if (app.nodes.Slider_Pivot) app.sliderCenter = new THREE.Box3().setFromObject(app.nodes.Slider_Pivot).getCenter(new THREE.Vector3());
  if (app.bounds.isEmpty()) app.bounds.set(new THREE.Vector3(-0.92, 0, -2.45), new THREE.Vector3(0.92, 2, 2.45));
  const size = app.bounds.getSize(new THREE.Vector3());
  env.setBlobSize(size.x, size.z);

  app.finishes = new Finishes(van, manifest, clipPlanes);
  app.openings = new Openings(van, manifest, clipPlanes);
  app.lights = new VanLights(van, app.bounds);
  const wheels = {};
  for (const n of ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']) if (app.nodes[n]) wheels[n] = app.nodes[n];
  app.drive = new Drive({ scene, van, camera, controls, manifest, bounds: app.bounds, wheels, renderer });
  app.drive.onToast = showDriveToast;
  app.drive.bindTouch(document.getElementById('touch-drive'));

  // first visit: hide clutter collections by default
  let hadSaved = false;
  try { hadSaved = !!localStorage.getItem('eurovan-viewer-config-v1') || /[#&]c=/.test(location.hash); } catch (_) { /* ignore */ }
  if (!hadSaved) app.state.hidden = defaultHidden();
  const f = app.finishes;
  const lacking = ['paint', 'veneer', 'doorPaint', 'floor'].filter(k => f.missing.includes(k));
  if (lacking.length) app.missingNote = `Some finish materials are not in this model (${lacking.join(', ')}); those controls have no effect.`;

  applyState(null);
  ui = new UI(app);
  ui.build();
  document.getElementById('model-info').textContent = manifest ? `model ${manifest.version || '?'} · ${fmtDate(manifest.exported)}` : 'model: no manifest';

  // compile shaders before revealing
  goView('exterior', true);
  try { await renderer.compileAsync(scene, camera); } catch (_) { /* older drivers */ }
  renderer.render(scene, camera);
  loaderEl.classList.add('done');
  setTimeout(() => loaderEl.remove(), 700);
  app.ready = true;
}

// ---------------------------------------------------------------- frame loop
const clock = { last: performance.now(), getDelta() { const n = performance.now(), d = (n - this.last) / 1000; this.last = n; return d; } };
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let lastBrake = 0;
function tick() {
  const raw = Math.min(clock.getDelta(), 0.5); // animations follow wall-clock time
  const dt = Math.min(raw, 0.1);               // physics / damping stay stable
  let active = false;
  if (tween) {
    tween.t = Math.min(1, tween.t + raw / tween.dur);
    const e = ease(tween.t);
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (tween.t >= 1) tween = null;
    active = true;
  }
  if (hourTween) {
    hourTween.t = Math.min(1, hourTween.t + raw / 1.6);
    const hr = hourTween.from + (hourTween.to - hourTween.from) * ease(hourTween.t);
    app.state.hour = hr;
    applyState(['hour']);
    if (hourTween.t >= 1) { hourTween = null; saveState(app.state); ui && ui.sync(); }
    active = true;
  }
  if (app.openings && app.openings.update(raw)) {
    active = true;
    if (!app.openings._wasMoving) ui && ui.sync();
    app.openings._wasMoving = true;
  } else if (app.openings) app.openings._wasMoving = false;
  if (app.drive && app.drive.active) {
    const r = app.drive.update(raw);
    mphEl.textContent = Math.round(r.mph);
    gearEl.textContent = r.gear;
    const bp = Math.round(r.boost * 100);
    if (bp !== lastBoostPct) { lastBoostPct = bp; boostFill.style.transform = `scaleX(${r.boost.toFixed(3)})`; boostBar.classList.toggle('low', r.boost < 0.2); }
    boostBar.classList.toggle('on', r.boosting);
    const tt = r.timer < 0 ? '' : fmtTime(r.timer);
    if (tt !== lastTimerTxt) { lastTimerTxt = tt; timerEl.hidden = !tt; timerEl.textContent = tt; }
    const b = r.braking ? 1 : 0;
    if (b !== lastBrake) { lastBrake = b; updateLights(b); }
    env.setFocus(app.van.position);
    env.setDriveShadow(app.van.position, app.drive.heading, heightAt(app.van.position.x, app.van.position.z));
    active = true;
  }
  if (controls.enabled && controls.update(dt)) active = true;
  if (active || dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
document.addEventListener('visibilitychange', () => { clock.getDelta(); requestRender(); });

load();

