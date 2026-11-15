// Cannon-es raycast vehicle on the same procedural height function as the visible course.
import * as CANNON from '../vendor/cannon-es/cannon-es.js';

const STEP = 1 / 60;
const CENTRE_Y = 1.072;
const LIMITS = { minX: -280, maxX: 400, minZ: -280, maxZ: 280 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Live-tunable "Car settings". Every value has a default equal to the original hard-coded constant, so an
// untouched tune behaves exactly as before. `%` entries are multipliers (100 = stock). Camera entries are
// read by drive.js; the rest are applied here. Keys are short because only non-default values are persisted.
export const TUNE_DEFS = [
  { key: 'pw', group: 'Engine', label: 'Engine power', unit: '%', min: 30, max: 400, step: 5, def: 100 },
  { key: 'top', group: 'Engine', label: 'Top speed', unit: 'mph', min: 40, max: 200, step: 1, def: 94 },
  { key: 'br', group: 'Engine', label: 'Brake strength', unit: '%', min: 20, max: 400, step: 5, def: 100 },
  { key: 'ms', group: 'Engine', label: 'Vehicle mass', unit: 'kg', min: 800, max: 4000, step: 50, def: 1600 },
  { key: 'bp', group: 'Boost', label: 'Boost power', unit: '%', min: 20, max: 400, step: 5, def: 100 },
  { key: 'bt', group: 'Boost', label: 'Boost duration', unit: 's', min: 1, max: 20, step: 0.5, def: 4 },
  { key: 'bc', group: 'Boost', label: 'Boost recharge time', unit: 's', min: 1, max: 30, step: 0.5, def: 6 },
  { key: 'sa', group: 'Steering & grip', label: 'Steering sensitivity (max angle)', unit: '%', min: 40, max: 200, step: 5, def: 100 },
  { key: 'sr', group: 'Steering & grip', label: 'Steering response speed', unit: '%', min: 30, max: 300, step: 5, def: 100 },
  { key: 'sf', group: 'Steering & grip', label: 'High-speed steering falloff', unit: '%', min: 0, max: 400, step: 5, def: 100 },
  { key: 'gr', group: 'Steering & grip', label: 'Tyre grip (lateral)', unit: '%', min: 20, max: 300, step: 5, def: 100 },
  { key: 'hg', group: 'Steering & grip', label: 'Handbrake rear grip (lower = more slide)', unit: '%', min: 5, max: 100, step: 5, def: 100 },
  { key: 'ss', group: 'Suspension', label: 'Suspension stiffness', unit: '', min: 10, max: 100, step: 1, def: 35 },
  { key: 'sd', group: 'Suspension', label: 'Suspension damping', unit: '%', min: 20, max: 300, step: 5, def: 100 },
  { key: 'rh', group: 'Suspension', label: 'Ride height (spring length)', unit: 'cm', min: 28, max: 70, step: 1, def: 42 },
  { key: 'gv', group: 'World', label: 'Gravity', unit: 'm/s²', min: 1, max: 30, step: 0.5, def: 12 },
  { key: 'cd', group: 'Camera', label: 'Chase camera distance', unit: 'm', min: 4, max: 16, step: 0.2, def: 7.2 },
  { key: 'fv', group: 'Camera', label: 'Base field of view', unit: '°', min: 30, max: 90, step: 1, def: 50 },
  { key: 'fk', group: 'Camera', label: 'Boost FOV kick', unit: '°', min: 0, max: 45, step: 1, def: 22 },
];
export const TUNE_DEFAULTS = Object.freeze(Object.fromEntries(TUNE_DEFS.map(d => [d.key, d.def])));
export const TUNE_PRESETS = [
  { id: 'stock', name: 'Stock EuroVan', values: {} },
  { id: 'rally', name: 'Rally', values: { pw: 150, top: 110, gr: 140, hg: 55, ss: 45, sd: 130, rh: 52, sr: 130, sf: 80, br: 150, bp: 130 } },
  { id: 'drift', name: 'Drift', values: { pw: 220, top: 120, gr: 65, hg: 25, sa: 140, sr: 150, sf: 40, ss: 38, sd: 90, bp: 150 } },
  { id: 'rocket', name: 'Rocket', values: { pw: 300, top: 180, bp: 300, bt: 10, bc: 3, br: 250, sf: 160, ms: 1400, fk: 38 } },
  { id: 'moon', name: 'Moon gravity', values: { gv: 2, ss: 22, sd: 60, rh: 52, fv: 55 } },
];
// Always returns a complete, finite, in-range tune (unknown keys dropped, bad values fall back to defaults).
export function clampTune(input) {
  const out = {};
  for (const d of TUNE_DEFS) {
    const v = input && typeof input === 'object' ? input[d.key] : undefined;
    out[d.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, d.min, d.max) : d.def;
  }
  return out;
}
// Only the non-default entries, for compact persistence.
export function compactTune(input) {
  const full = clampTune(input), out = {};
  for (const d of TUNE_DEFS) if (full[d.key] !== d.def) out[d.key] = full[d.key];
  return out;
}

export class VehiclePhysics {
  static async prepareTerrain(heightAt, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0))) {
    const heights = [];
    for (let x = -300; x <= 420; x++) {
      const row = [];
      for (let z = 300; z >= -300; z--) row.push(heightAt(x, z));
      heights.push(row);
      // Limit uninterrupted work so the preparing message can remain responsive.
      if ((x + 300) % 8 === 7) await yieldControl();
    }
    return heights;
  }

  constructor(heightAt, wheels, obstacles = [], preparedHeights = null) {
    this.heightAt = heightAt;
    this.tune = { ...TUNE_DEFAULTS };
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -12, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    const heights = preparedHeights || [];
    // One collision field is prepared on entry; no terrain is rebuilt during a drive.
    if (!preparedHeights) for (let x = -300; x <= 420; x++) {
      const row = [];
      for (let z = 300; z >= -300; z--) row.push(heightAt(x, z));
      heights.push(row);
    }
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(heights, { elementSize: 1 }), position: new CANNON.Vec3(-300, 0, 300) });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(ground);
    ground.updateAABB(); // Wheel raycasts run before the first world step.
    for (const obstacle of obstacles) {
      const radius = Math.max(0.1, obstacle.radius), height = Math.max(0.5, obstacle.height);
      const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 2, shape: new CANNON.Box(new CANNON.Vec3(radius, height / 2, radius)), position: new CANNON.Vec3(obstacle.x, obstacle.y + height / 2, obstacle.z) });
      this.world.addBody(body);
      body.updateAABB();
    }
    this.body = new CANNON.Body({ mass: 1600, shape: new CANNON.Box(new CANNON.Vec3(0.88, 0.36, 2.25)), linearDamping: 0.015, angularDamping: 0.45 });
    this.vehicle = new CANNON.RaycastVehicle({ chassisBody: this.body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    // Cannon's vehicle uses world.rayTest for its suspension. Wheels should
    // sample the ground, while the chassis handles impacts with obstacles.
    this.world.rayTest = (from, to, result) => this.world.raycastClosest(from, to, { skipBackfaces: true, collisionFilterMask: 1 }, result);
    for (const w of wheels) this.vehicle.addWheel({
      chassisConnectionPointLocal: new CANNON.Vec3(w.x, -0.4, w.z), directionLocal: new CANNON.Vec3(0, -1, 0), axleLocal: new CANNON.Vec3(-1, 0, 0),
      radius: w.r, suspensionRestLength: 0.42, suspensionStiffness: 35, dampingRelaxation: 3, dampingCompression: 4.4,
      frictionSlip: 5, rollInfluence: 0.02, maxSuspensionTravel: 0.3, isFrontWheel: w.front,
    });
    this.wheels = wheels;
    this.vehicle.addToWorld(this.world);
    this.applyTune();
    this.forward = new CANNON.Vec3();
    this.offset = new CANNON.Vec3();
    this.drag = new CANNON.Vec3();
    this.airBoost = new CANNON.Vec3();
    this.reset();
  }

  setTune(tune) { this.tune = clampTune(tune); this.applyTune(); }

  applyTune() {
    const t = this.tune, b = this.body;
    this.world.gravity.set(0, -t.gv, 0);
    if (b.mass !== t.ms) { b.mass = t.ms; b.updateMassProperties(); }
    for (const w of this.vehicle.wheelInfos) {
      w.suspensionStiffness = t.ss; w.suspensionRestLength = t.rh / 100;
      w.dampingRelaxation = 3 * t.sd / 100; w.dampingCompression = 4.4 * t.sd / 100;
      w.frictionSlip = 5 * t.gr / 100;
    }
    b.wakeUp();
  }

  // Height of the body centre above the visible van origin: the stock offset, shifted by the spring length
  // and by how far the springs sag under gravity, so the model keeps sitting on its wheels.
  rideOffset() {
    const t = this.tune, sag = Math.min(t.gv / (4 * t.ss), 0.3);
    return Math.max(0.5, CENTRE_Y + (t.rh / 100 - 0.42) - (sag - 12 / (4 * 35)));
  }

  reset(x = 0, z = 0, heading = 0, speed = 0) {
    const b = this.body;
    this.safe = null;
    b.position.set(x, this.heightAt(x, z) + this.rideOffset() + 0.03, z);
    b.quaternion.setFromEuler(0, heading, 0);
    b.velocity.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
    b.angularVelocity.set(0, 0, 0); b.force.set(0, 0, 0); b.torque.set(0, 0, 0);
    b.wakeUp(); this.world.broadphase.dirty = true;
    this.steer = 0; this.speed = speed; this.prevGrounded = true;
  }

  step(input) {
    const b = this.body, vehicle = this.vehicle;
    b.quaternion.vmult(new CANNON.Vec3(0, 0, 1), this.forward);
    let speed = b.velocity.dot(this.forward);
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const rate = (steerInput ? 2.6 : 5) * this.tune.sr / 100;
    this.steer += clamp(steerInput - this.steer, -rate * STEP, rate * STEP);
    const t = this.tune, k = t.top / TUNE_DEFAULTS.top;
    const steering = this.steer * this.steerLimit(speed);
    let force = 0, brake = 0;
    if (input.boost) force = -6000 * t.bp / 100 * clamp(1 - Math.max(0, speed) / (52 * k), 0, 1);
    else if (input.gas) force = -1400 * t.pw / 100 * clamp(1 - Math.max(0, speed) / (42 * k), 0, 1);
    if (input.brake) { if (speed > 0.5) brake = 120 * t.br / 100; else force = 1000 * clamp(1 + Math.min(0, speed) / 6, 0, 1); }
    for (let i = 0; i < this.wheels.length; i++) {
      vehicle.setSteeringValue(this.wheels[i].front ? steering : 0, i);
      vehicle.applyEngineForce(force, i);
      if (!this.wheels[i].front) vehicle.wheelInfos[i].frictionSlip = 5 * t.gr / 100 * (input.hand ? t.hg / 100 : 1);
      // Cannon treats brake as an impulse per step; split it across substeps.
      vehicle.setBrake((input.hand && !this.wheels[i].front ? Math.max(brake, 25) : brake) / 2, i);
    }
    // Rolling and aerodynamic resistance make coasting predictable without
    // imposing an abrupt speed cutoff; fade resistance near zero to avoid jitter.
    const resistance = 1600 * (0.22 + 0.0042 * speed * speed / (k * k)) * clamp(speed / 0.5, -1, 1);
    this.forward.scale(-resistance, this.drag);
    const airborneBoost = input.boost && !this.prevGrounded ? 1600 * 4 * t.bp / 100 * clamp(1 - Math.max(0, speed) / (52 * k), 0, 1) : 0;
    this.forward.scale(airborneBoost, this.airBoost);
    const impactSpeed = Math.max(0, -b.velocity.y);
    // Smaller collision steps reduce visible penetration at boost speeds.
    for (let i = 0; i < 2; i++) { b.applyForce(this.drag); if (airborneBoost) b.applyForce(this.airBoost); this.world.step(STEP / 2); }
    // Stop outward motion at the world edge instead of reporting speed while
    // the position is pinned; preserve any velocity along the boundary.
    if (b.position.x < LIMITS.minX) { b.position.x = LIMITS.minX; if (b.velocity.x < 0) b.velocity.x = 0; }
    if (b.position.x > LIMITS.maxX) { b.position.x = LIMITS.maxX; if (b.velocity.x > 0) b.velocity.x = 0; }
    if (b.position.z < LIMITS.minZ) { b.position.z = LIMITS.minZ; if (b.velocity.z < 0) b.velocity.z = 0; }
    if (b.position.z > LIMITS.maxZ) { b.position.z = LIMITS.maxZ; if (b.velocity.z > 0) b.velocity.z = 0; }
    // Last line of defence for extreme tunes: never let a non-finite state reach the renderer.
    const p = b.position, v = b.velocity;
    if (!(Number.isFinite(p.x + p.y + p.z + v.x + v.y + v.z + b.quaternion.w + b.angularVelocity.x + b.angularVelocity.y + b.angularVelocity.z) && Math.abs(p.y) < 2000 && v.length() < 400)) {
      const s = this.safe || { x: 0, z: 0, heading: 0 };
      this.reset(s.x, s.z, s.heading, 0);
    } else if (vehicle.numWheelsOnGround > 0) this.safe = { x: p.x, z: p.z, heading: Math.atan2(this.forward.x, this.forward.z) };
    b.quaternion.vmult(new CANNON.Vec3(0, 0, 1), this.forward);
    speed = b.velocity.dot(this.forward);
    this.speed = speed;
    this.prevGrounded = vehicle.numWheelsOnGround > 0;
    return { speed, grounded: this.prevGrounded, impactSpeed, heading: Math.atan2(this.forward.x, this.forward.z) };
  }

  // Front wheel angle (rad) for the current speed at full lock; also drives the visible wheels.
  steerLimit(speed) { return 0.58 * this.tune.sa / 100 / (1 + speed * speed * this.tune.sf / 100 / 160); }

  applyVisual(van) {
    const b = this.body;
    b.quaternion.vmult(new CANNON.Vec3(0, this.rideOffset(), 0), this.offset);
    van.position.set(b.position.x - this.offset.x, b.position.y - this.offset.y, b.position.z - this.offset.z);
    van.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
}

