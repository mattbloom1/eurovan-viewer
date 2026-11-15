// Run with: node --experimental-vm-modules tests/tuning.cjs
// Pushes every "Car settings" slider to its min and max (alone and all together), every preset and some mixed
// extremes through several seconds of fixed-step physics, and checks the state stays finite and sane.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  const ctx = vm.createContext({ console, performance });
  const cannon = new vm.SourceTextModule(fs.readFileSync('vendor/cannon-es/cannon-es.js', 'utf8'), { context: ctx });
  const physics = new vm.SourceTextModule(fs.readFileSync('src/vehicle-physics.js', 'utf8'), { context: ctx });
  await physics.link(() => cannon); await physics.evaluate();
  const { VehiclePhysics, TUNE_DEFS, TUNE_DEFAULTS, TUNE_PRESETS, clampTune, compactTune } = physics.namespace;
  const wheels = [
    { x: -0.7853, z: 1.447, r: 0.3379, front: true }, { x: 0.7853, z: 1.447, r: 0.338, front: true },
    { x: -0.7811, z: -1.473, r: 0.3379, front: false }, { x: 0.7811, z: -1.473, r: 0.338, front: false },
  ];
  const ground = (x, z) => (x > 40 && x < 60 ? (x - 40) * 0.15 : 0);  // flat with a ramp so gravity/suspension get exercised
  const heights = await VehiclePhysics.prepareTerrain(ground, () => Promise.resolve());
  const car = new VehiclePhysics(ground, wheels, [], heights);
  const finite = (label) => {
    const b = car.body, vals = [b.position.x, b.position.y, b.position.z, b.velocity.x, b.velocity.y, b.velocity.z, b.quaternion.x, b.quaternion.w, b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z, car.speed];
    assert.ok(vals.every(Number.isFinite), `${label}: non-finite state ${vals}`);
    assert.ok(b.velocity.length() < 400 && Math.abs(b.position.y) < 2000, `${label}: physics exploded (${b.velocity.length().toFixed(0)} m/s, y ${b.position.y.toFixed(0)})`);
  };
  const script = [{ gas: true }, { gas: true, left: true }, { boost: true, right: true }, { brake: true, hand: true, left: true }, { gas: true, hand: true, right: true }, {}];
  const run = (label, tune) => {
    car.setTune(tune); car.reset(0, 0, 0, 0);
    for (let i = 0; i < 360; i++) { car.step(script[Math.floor(i / 60)]); if (i % 30 === 0) finite(label); }
    finite(label);
  };
  let runs = 0;
  for (const d of TUNE_DEFS) for (const v of [d.min, d.max]) { run(`${d.key}=${v}`, { [d.key]: v }); runs++; }
  run('all min', Object.fromEntries(TUNE_DEFS.map(d => [d.key, d.min])));
  run('all max', Object.fromEntries(TUNE_DEFS.map(d => [d.key, d.max])));
  run('alternating', Object.fromEntries(TUNE_DEFS.map((d, i) => [d.key, i % 2 ? d.min : d.max])));
  run('alternating2', Object.fromEntries(TUNE_DEFS.map((d, i) => [d.key, i % 2 ? d.max : d.min])));
  run('garbage', { pw: NaN, top: Infinity, gv: -5, ss: 'x', ms: 1e12, rh: -1, bogus: 1 });
  runs += 5;
  for (const p of TUNE_PRESETS) { run(`preset ${p.id}`, p.values); runs++; }
  // switching tune live, mid-drive, must not break the state either
  car.setTune({}); car.reset(0, 0, 0, 0);
  for (let i = 0; i < 600; i++) {
    if (i % 40 === 0) car.setTune(Object.fromEntries(TUNE_DEFS.map((d, k) => [d.key, ((i / 40 + k) % 3 === 0) ? d.min : ((i / 40 + k) % 3 === 1 ? d.max : d.def)])));
    car.step({ gas: true, boost: i % 200 < 80, left: i % 120 < 30 });
    if (i % 20 === 0) finite('live switching');
  }
  // helpers
  assert.equal(JSON.stringify(clampTune(undefined)), JSON.stringify(TUNE_DEFAULTS));
  assert.equal(JSON.stringify(compactTune({ ...TUNE_DEFAULTS })), '{}');
  assert.equal(JSON.stringify(compactTune({ gv: 2, pw: 100, top: 9999 })), JSON.stringify({ top: 200, gv: 2 }));
  for (const d of TUNE_DEFS) assert.ok(d.min < d.max && d.def >= d.min && d.def <= d.max, `${d.key}: default inside range`);
  // default behaviour: tune at defaults reproduces an untuned car exactly
  const a = new VehiclePhysics(ground, wheels, [], heights), b = new VehiclePhysics(ground, wheels, [], heights);
  b.setTune({ ...TUNE_DEFAULTS });
  for (let i = 0; i < 300; i++) { a.step({ gas: true, left: i > 100 }); b.step({ gas: true, left: i > 100 }); }
  assert.equal(a.body.position.x, b.body.position.x); assert.equal(a.body.position.z, b.body.position.z);
  // sliders must actually change behaviour
  const reached = (tune, input, secs = 14) => { car.setTune(tune); car.reset(-250, 0, Math.PI / 2, 0); let m = 0; for (let i = 0; i < secs * 60; i++) { car.step(input); m = Math.max(m, car.speed); } return m; };
  const lo = reached({ top: 50 }, { gas: true }), mid = reached({}, { gas: true }), hi = reached({ top: 160 }, { gas: true });
  console.log('Gas top speed (m/s) at 50 / 94 / 160 mph setting:', lo.toFixed(1), mid.toFixed(1), hi.toFixed(1));
  assert.ok(lo < mid - 2 && mid < hi - 2, 'top speed slider should change the reached top speed');
  assert.ok(reached({ pw: 300 }, { gas: true }, 4) > reached({ pw: 50 }, { gas: true }, 4) + 3, 'engine power should change acceleration');
  const fall = tune => { car.setTune(tune); car.reset(-100, 0, 0, 0); car.body.position.y = 30; car.step({}); let t = 0; while (car.vehicle.numWheelsOnGround === 0 && t < 600) { car.step({}); t++; } return t; };
  const earth = fall({}), moon = fall({ gv: 2 });
  console.log('Fall frames from 30 m at gravity 12 / 2:', earth, moon);
  assert.ok(moon > earth * 2, 'gravity slider should change fall time');
  console.log(`Tuning checks passed: ${runs} extreme/preset runs finite, defaults unchanged, top speed / power / gravity effective.`);
})().catch(e => { console.error(e); process.exitCode = 1; });
