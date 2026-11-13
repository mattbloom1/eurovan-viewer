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
  const collisionField = car.world.bodies[0].shapes[0];
  let terrainError = 0, worstTerrain;
  for (let i = 0; i < 1200; i++) {
    const x = 90 + (i * 37.137 % 280), z = -180 + (i * 53.271 % 280);
    const physical = collisionField.getHeightAt(x + 300, 300 - z, true);
    const error = Math.abs(physical - drive.namespace.surfaceGroundAt(x, z));
    if (error > terrainError) { terrainError = error; worstTerrain = { x, z, physical, visible: drive.namespace.surfaceGroundAt(x, z), ramp: drive.namespace.heightAt(x, z) }; }
  }
  console.log('Maximum sampled mountain surface mismatch:', terrainError.toFixed(3), 'm', worstTerrain);
  assert.ok(terrainError < 0.2, 'collision field should track the visible mountain terrain');
  assert.ok(drive.namespace.heightAt(175.056, 98.848) < -1, 'terrain below sea level must not be flattened outside ramps');
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
  for (let i = 0; i < 600; i++) car.step({ brake: true });
  assert.ok(car.speed < -3 && car.speed > -7, 'reverse should reach a controlled speed');
  car.reset();
  for (let i = 0; i < 240; i++) car.step({ gas: true });
  const coastingStart = Math.abs(car.speed);
  for (let i = 0; i < 180; i++) car.step({});
  assert.ok(Math.abs(car.speed) < coastingStart, 'van should slow when coasting');
  car.reset();
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
  for (const ramp of drive.namespace.WORLD_INFO.RAMPS) {
    const downhillApproach = ramp.tag === 'big-landing';
    const start = downhillApproach ? ramp.pts[ramp.pts.length - 1][0] + 5 : ramp.pts[0][0] - 5;
    const dx = Math.sin(ramp.h), dz = Math.cos(ramp.h), direction = downhillApproach ? -1 : 1;
    const x = ramp.x + dx * start, z = ramp.z + dz * start;
    car.reset(x, z, ramp.h + (downhillApproach ? Math.PI : 0), 12);
    let progressed = 0, minClearance = Infinity;
    for (let i = 0; i < 120; i++) {
      car.step({ gas: true });
      progressed = Math.max(progressed, ((car.body.position.x - x) * dx + (car.body.position.z - z) * dz) * direction);
      minClearance = Math.min(minClearance, car.body.position.y - drive.namespace.heightAt(car.body.position.x, car.body.position.z));
    }
    assert.ok(progressed > 8, `${ramp.tag}: van should approach and cross the ramp`);
    assert.ok(minClearance > -0.5, `${ramp.tag}: van should stay above the course`);
  }
  const obstacles = [{ x: 0, y: 0, z: 16, radius: 0.3, height: 3 }];
  for (let i = 0; i < 370; i++) obstacles.push({ x: 50 + i % 20 * 4, y: 0, z: Math.floor(i / 20) * 4, radius: 0.3, height: 3 });
  const flat = new physics.namespace.VehiclePhysics(() => 0, wheels, obstacles);
  flat.reset(0, 0, 0, 12);
  for (let i = 0; i < 120; i++) flat.step({ gas: true });
  assert.ok(flat.body.position.z < 15, 'the van must not drive through a tree trunk');
  flat.reset(0, 0, 0, 28);
  let furthest = flat.body.position.z;
  for (let i = 0; i < 75; i++) { flat.step({}); furthest = Math.max(furthest, flat.body.position.z); }
  assert.ok(furthest < 16, 'the van must not tunnel through a tree at boost speed');
  flat.reset(12, 0, 0, 12);
  for (let i = 0; i < 60; i++) flat.step({ hand: true });
  const handbrakeSpeed = Math.abs(flat.speed);
  console.log('Handbrake speed after one second from 12 m/s:', handbrakeSpeed.toFixed(2), 'm/s');
  assert.ok(flat.speed > 0, 'handbrake should not reverse a forward-moving van on level ground');
  flat.reset(12, 0, 0, 12);
  for (let i = 0; i < 60; i++) flat.step({ brake: true });
  assert.ok(handbrakeSpeed > 3, 'handbrake should not stop a moving van instantly');
  assert.ok(handbrakeSpeed > Math.abs(flat.speed) + 1, 'handbrake should be gentler than the foot brake');
  flat.reset(12, 0, 0, 5);
  const profileStart = performance.now();
  for (let i = 0; i < 600; i++) flat.step({ gas: true });
  console.log('Average physics step with 371 obstacles:', ((performance.now() - profileStart) / 600).toFixed(3), 'ms');
  console.log('Physics checks passed: ramps, terrain, trees, brakes, coasting, reverse, steering and reset.');
})().catch(e => { console.error(e); process.exitCode = 1; });

