// Run with: node --experimental-vm-modules tests/regressions.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const data = new Map();
  const location = { origin: 'https://example.test', pathname: '/', search: '', hash: '' };
  const context = vm.createContext({
    TextEncoder, TextDecoder, Uint8Array, btoa, atob, setTimeout, clearTimeout,
    localStorage: { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) },
    location, history: { replaceState: (_a, _b, url) => { location.hash = new URL(url, location.origin).hash; } },
  });
  const config = new vm.SourceTextModule(fs.readFileSync('src/config.js', 'utf8'), { context });
  const state = new vm.SourceTextModule(fs.readFileSync('src/state.js', 'utf8'), { context });
  await config.link(() => {}); await config.evaluate();
  await state.link(() => config); await state.evaluate();
  const { DEFAULTS } = config.namespace;
  const { loadState, saveState, shareUrl } = state.namespace;
  data.set('eurovan-viewer-config-v1', JSON.stringify({ wood: 'walnut', paint: '#123456' }));
  let url = new URL(shareUrl({ ...DEFAULTS, hidden: [] }));
  assert.ok(url.hash, 'default configuration must have an explicit share hash');
  location.hash = url.hash;
  assert.equal(loadState().wood, DEFAULTS.wood, 'shared defaults must override local preferences');
  url = new URL(shareUrl({ ...DEFAULTS, hidden: [], paint: '#abcdef' }));
  location.hash = url.hash;
  assert.equal(loadState().paint, '#abcdef');
  assert.equal(loadState().wood, DEFAULTS.wood);
  location.hash = '#c=invalid';
  assert.equal(loadState().wood, 'walnut', 'invalid links should fall back to stored settings');
  saveState({ ...DEFAULTS, hidden: [] });
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.ok(location.hash, 'saved default configuration must retain an explicit hash');

  const handlers = {};
  const driveContext = vm.createContext({ console, window: { addEventListener: (name, fn) => { handlers[name] = fn; } } });
  const three = new vm.SyntheticModule([], () => {}, { context: driveContext });
  const physicsStub = new vm.SyntheticModule(['VehiclePhysics'], function() { this.setExport('VehiclePhysics', class {}); }, { context: driveContext });
  const drive = new vm.SourceTextModule(fs.readFileSync('src/drive.js', 'utf8'), { context: driveContext });
  await drive.link(specifier => specifier === 'three' ? three : physicsStub); await drive.evaluate();
  const car = Object.create(drive.namespace.Drive.prototype);
  Object.assign(car, { active: true, keys: new Set(), physicalKeys: new Set(), touch: {} });
  car._bindKeys();
  const event = code => ({ code, preventDefault() {} });
  for (const [a, b, action] of [['KeyW', 'ArrowUp', 'gas'], ['KeyA', 'ArrowLeft', 'left'], ['ShiftLeft', 'ShiftRight', 'boost']]) {
    handlers.keydown(event(a)); handlers.keydown(event(b)); handlers.keyup(event(a));
    assert.equal(car.input(action), true, `${action} must remain active while another key is held`);
    handlers.keyup(event(b)); assert.equal(car.input(action), false);
  }
  let prevented = false;
  handlers.keydown({ code: 'Space', target: { closest: () => ({}) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'Space should activate a focused UI control');
  assert.equal(car.input('hand'), false, 'activating a control should not apply the handbrake');
  car.setInput('gas', true); handlers.blur(); assert.equal(car.input('gas'), false);
  const touchHandlers = {}, classes = new Set();
  const button = { dataset: { k: 'gas' }, classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name), remove: name => classes.delete(name) }, addEventListener: (name, fn) => { touchHandlers[name] = fn; }, setPointerCapture() {} };
  car._touchButtons = [];
  car.bindTouch({ querySelectorAll: () => [button] });
  const pointer = pointerId => ({ pointerId, preventDefault() {} });
  touchHandlers.pointerdown(pointer(1)); touchHandlers.pointerdown(pointer(2));
  touchHandlers.pointerup(pointer(1)); touchHandlers.lostpointercapture(pointer(1));
  assert.equal(car.input('gas'), true, 'releasing one finger must leave the other active');
  assert.ok(classes.has('held'));
  handlers.blur();
  assert.equal(car.input('gas'), false); assert.ok(!classes.has('held'), 'blur must clear held button visuals');
  const lighting = Object.create(drive.namespace.Drive.prototype);
  lighting.lotBulbMaterial = { emissiveIntensity: 0 };
  lighting.lotLamps = [{ visible: false, intensity: 0 }];
  lighting.setNight(1);
  assert.equal(lighting.lotLamps[0].visible, true); assert.ok(lighting.lotLamps[0].intensity > 0);
  lighting.setNight(0);
  assert.equal(lighting.lotLamps[0].visible, false); assert.equal(lighting.lotBulbMaterial.emissiveIntensity, 0);
  const orbit = Object.create(drive.namespace.Drive.prototype);
  const settable = () => ({ set(x, y, z) { Object.assign(this, { x, y, z }); } });
  Object.assign(orbit, { camMode: 'driver', heading: 0, van: { position: { x: 10, y: 3, z: 20 } }, camera: { aspect: 1, position: settable() }, controls: { target: settable(), update() {} }, _shk: settable() });
  orbit.cycleCamera();
  assert.equal(orbit.camMode, 'orbit');
  assert.equal(orbit.camera.position.z, 12, 'orbit should start outside the van after the driver view');
  assert.equal(orbit.controls.target.y, 4.1, 'orbit target should follow the van elevation');
  let physicsInput;
  const boostCar = Object.create(drive.namespace.Drive.prototype);
  Object.assign(boostCar, { input: key => key === 'boost' || key === 'brake', boost: 0.5, boostLock: false, boostVis: 0, air: false, airT: 0, airDist: 0, v: 0, dist: 0, wheels: [], run: { state: 'idle', t: 0 }, van: { position: { x: 0, z: 0 } }, _updateRun() {}, physics: { step(input) { physicsInput = input; return { speed: 0, grounded: true, heading: 0 }; }, applyVisual() {} } });
  boostCar._physicsStep(1 / 60);
  assert.equal(physicsInput.boost, false, 'braking should cancel boost thrust');
  assert.ok(boostCar.boost >= 0.5, 'braking must not waste boost charge');

  class Vec {
    constructor(x = 0) { this.x = x; }
    clone() { return new Vec(this.x); }
    copy(v) { this.x = v.x; return this; }
    lerpVectors(a, b, t) { this.x = a.x + (b.x - a.x) * t; return this; }
    slerpQuaternions(a, b, t) { return this.lerpVectors(a, b, t); }
  }
  function simulatedCar() {
    const c = Object.create(drive.namespace.Drive.prototype);
    Object.assign(c, { van: { position: new Vec(), quaternion: new Vec() }, wheels: [{ node: { quaternion: new Vec() } }], _accumulator: 0, _currentPose: null, _previousPose: null, _lastResult: null, boost: 1, count: 0 });
    c._step = function(dt) { assert.ok(Math.abs(dt - 1 / 60) < 1e-10); this.count++; this.van.position.x += dt * 6; this.wheels[0].node.quaternion.x += dt; return { mph: 1 }; };
    c._updateFx = () => {}; c._updateCamera = () => {};
    return c;
  }
  const half = simulatedCar(); half.update(1 / 60); half.update(1 / 120);
  assert.ok(Math.abs(half.van.position.x - 0.05) < 1e-9, 'pose should interpolate between physics states');
  assert.ok(Math.abs(half.wheels[0].node.quaternion.x - 1 / 120) < 1e-9, 'wheel pose should interpolate too');
  for (const fps of [30, 60, 144]) {
    const c = simulatedCar(); for (let i = 0; i < fps; i++) c.update(1 / fps);
    assert.equal(c.count, 60, `${fps} fps must produce 60 fixed physics steps`);
    assert.ok(Math.abs(c.van.position.x - 5.9) < 1e-8, `${fps} fps should produce the same rendered pose`);
  }
  const stalled = simulatedCar(); stalled.update(2);
  assert.equal(stalled.count, 15, 'long stalls must be bounded');

  const source = fs.readFileSync('src/main.js', 'utf8');
  const reset = source.match(/app\.reset = \(\) => \{[\s\S]*?\n\};/)[0];
  const resetContext = vm.createContext({ DEFAULTS: { hour: 14 }, clearSaved() {}, defaultHidden: () => [], applyState() {}, saveState() {}, goView() {}, toast() {}, ui: { sync() {} }, app: { closeAll() {}, setSection() {} } });
  vm.runInContext('let hourTween = { from: 14, to: 22, t: 0.5 };\n' + reset + '\napp.reset(); globalThis.result = { hourTween, hour: app.state.hour };', resetContext);
  assert.equal(resetContext.result.hourTween, null);
  assert.equal(resetContext.result.hour, 14);
  console.log('Regression checks passed: shared state, keyboard and touch inputs, reset, and fixed-step interpolation.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });

