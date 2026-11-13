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
  const drive = new vm.SourceTextModule(fs.readFileSync('src/drive.js', 'utf8'), { context: driveContext });
  await drive.link(() => three); await drive.evaluate();
  const car = Object.create(drive.namespace.Drive.prototype);
  Object.assign(car, { active: true, keys: new Set(), physicalKeys: new Set(), touch: {} });
  car._bindKeys();
  const event = code => ({ code, preventDefault() {} });
  for (const [a, b, action] of [['KeyW', 'ArrowUp', 'gas'], ['KeyA', 'ArrowLeft', 'left'], ['ShiftLeft', 'ShiftRight', 'boost']]) {
    handlers.keydown(event(a)); handlers.keydown(event(b)); handlers.keyup(event(a));
    assert.equal(car.input(action), true, `${action} must remain active while another key is held`);
    handlers.keyup(event(b)); assert.equal(car.input(action), false);
  }
  car.setInput('gas', true); handlers.blur(); assert.equal(car.input('gas'), false);

  const source = fs.readFileSync('src/main.js', 'utf8');
  const reset = source.match(/app\.reset = \(\) => \{[\s\S]*?\n\};/)[0];
  const resetContext = vm.createContext({ DEFAULTS: { hour: 14 }, clearSaved() {}, defaultHidden: () => [], applyState() {}, saveState() {}, goView() {}, toast() {}, ui: { sync() {} }, app: { closeAll() {}, setSection() {} } });
  vm.runInContext('let hourTween = { from: 14, to: 22, t: 0.5 };\n' + reset + '\napp.reset(); globalThis.result = { hourTween, hour: app.state.hour };', resetContext);
  assert.equal(resetContext.result.hourTween, null);
  assert.equal(resetContext.result.hour, 14);
  console.log('Regression checks passed: shared state, keyboard inputs, and reset during time transition.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });

