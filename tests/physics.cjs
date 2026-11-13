// Run with: node --experimental-vm-modules tests/physics.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
  const ctx = vm.createContext({ console, performance });
  const cannon = new vm.SourceTextModule(fs.readFileSync('vendor/cannon-es/cannon-es.js', 'utf8'), { context: ctx });
  const physics = new vm.SourceTextModule(fs.readFileSync('src/vehicle-physics.js', 'utf8'), { context: ctx });
  await physics.link(() => cannon); await physics.evaluate();
  const three = new vm.SyntheticModule([], () => {}, { context: ctx });
  const drive = new vm.SourceTextModule(fs.readFileSync('src/drive.js', 'utf8'), { context: ctx });
  await drive.link(name => name === 'three' ? three : physics); await drive.evaluate();
  // Wheel positions and radii from assets/manifest.json.
  const wheels = [
    { x: -0.7853, z: 1.447, r: 0.3379, front: true }, { x: 0.7853, z: 1.447, r: 0.338, front: true },
    { x: -0.7811, z: -1.473, r: 0.3379, front: false }, { x: 0.7811, z: -1.473, r: 0.338, front: false },
  ];
  const car = new physics.namespace.VehiclePhysics(drive.namespace.heightAt, wheels);
  const bodies = car.world.bodies.length;
  for (let i = 0; i < 90; i++) car.step({});
  assert.equal(car.vehicle.numWheelsOnGround, 4, 'van should settle on four wheels');
  let rampHeight = 0;
  for (let i = 0; i < 540; i++) {
    car.step({ gas: true });
    if (car.body.position.z > 9 && car.body.position.z < 20) rampHeight = Math.max(rampHeight, car.body.position.y);
  }
  assert.ok(car.body.position.z > 50, 'van should drive across the ramp and terrain');
  assert.ok(rampHeight > 1.5, 'van should rise over the ramp');
  assert.equal(car.world.bodies.length, bodies, 'terrain must not be rebuilt during a drive');
  const before = Math.abs(car.speed);
  for (let i = 0; i < 120; i++) car.step({ brake: true });
  assert.ok(Math.abs(car.speed) < before * 0.5, 'brake should slow the van');
  for (let i = 0; i < 240; i++) car.step({ brake: true });
  assert.ok(car.speed < -0.5, 'brake at low speed should reverse');
  const headingBefore = car.body.quaternion.clone();
  for (let i = 0; i < 180; i++) car.step({ brake: true, left: true });
  const q = car.body.quaternion, dot = Math.abs(q.x * headingBefore.x + q.y * headingBefore.y + q.z * headingBefore.z + q.w * headingBefore.w);
  assert.ok(dot < 0.99, 'steering should turn the van');
  car.reset();
  assert.equal(car.body.position.x, 0); assert.equal(car.body.position.z, 0);
  assert.ok(car.body.velocity.length() < 1e-9, 'reset should clear velocity');
  for (let i = 0; i < 180; i++) car.step({ gas: true, left: true });
  const direction = new cannon.namespace.Vec3();
  car.body.quaternion.vmult(new cannon.namespace.Vec3(0, 0, 1), direction);
  assert.ok(direction.x > 0.05, 'left input should steer towards the van\'s left (+X)');
  const road = drive.namespace.WORLD_INFO.ROAD, k = Math.floor(road.n / 2);
  const heading = Math.atan2(road.xs[k + 1] - road.xs[k], road.zs[k + 1] - road.zs[k]);
  car.reset(road.xs[k], road.zs[k], heading, 5);
  for (let i = 0; i < 120; i++) car.step({ gas: true });
  assert.ok(Number.isFinite(car.body.position.y), 'mountain drive must remain finite');
  assert.ok(car.body.position.y > drive.namespace.heightAt(car.body.position.x, car.body.position.z) - 1, 'van should remain above the mountain terrain');
  console.log('Physics checks passed: ground contact, ramp, terrain, braking, reverse, steering and reset.');
})().catch(e => { console.error(e); process.exitCode = 1; });

