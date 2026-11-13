// Cannon-es raycast vehicle on the same procedural height function as the visible course.
import * as CANNON from '../vendor/cannon-es/cannon-es.js';

const STEP = 1 / 60;
const CENTRE_Y = 1.072;
const LIMITS = { minX: -280, maxX: 400, minZ: -280, maxZ: 280 };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
    this.forward = new CANNON.Vec3();
    this.offset = new CANNON.Vec3();
    this.drag = new CANNON.Vec3();
    this.airBoost = new CANNON.Vec3();
    this.reset();
  }

  reset(x = 0, z = 0, heading = 0, speed = 0) {
    const b = this.body;
    b.position.set(x, this.heightAt(x, z) + CENTRE_Y + 0.03, z);
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
    const rate = steerInput ? 2.6 : 5;
    this.steer += clamp(steerInput - this.steer, -rate * STEP, rate * STEP);
    const steering = this.steer * (0.58 / (1 + speed * speed / 160));
    let force = 0, brake = 0;
    if (input.boost) force = -6000 * clamp(1 - Math.max(0, speed) / 52, 0, 1);
    else if (input.gas) force = -1400 * clamp(1 - Math.max(0, speed) / 42, 0, 1);
    if (input.brake) { if (speed > 0.5) brake = 120; else force = 1000 * clamp(1 + Math.min(0, speed) / 6, 0, 1); }
    for (let i = 0; i < this.wheels.length; i++) {
      vehicle.setSteeringValue(this.wheels[i].front ? steering : 0, i);
      vehicle.applyEngineForce(force, i);
      // Cannon treats brake as an impulse per step; split it across substeps.
      vehicle.setBrake((input.hand && !this.wheels[i].front ? Math.max(brake, 25) : brake) / 2, i);
    }
    // Rolling and aerodynamic resistance make coasting predictable without
    // imposing an abrupt speed cutoff; fade resistance near zero to avoid jitter.
    const resistance = 1600 * (0.22 + 0.0042 * speed * speed) * clamp(speed / 0.5, -1, 1);
    this.forward.scale(-resistance, this.drag);
    const airborneBoost = input.boost && !this.prevGrounded ? 1600 * 4 * clamp(1 - Math.max(0, speed) / 52, 0, 1) : 0;
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
    b.quaternion.vmult(new CANNON.Vec3(0, 0, 1), this.forward);
    speed = b.velocity.dot(this.forward);
    this.speed = speed;
    this.prevGrounded = vehicle.numWheelsOnGround > 0;
    return { speed, grounded: this.prevGrounded, impactSpeed, heading: Math.atan2(this.forward.x, this.forward.z) };
  }

  applyVisual(van) {
    const b = this.body;
    b.quaternion.vmult(new CANNON.Vec3(0, CENTRE_Y, 0), this.offset);
    van.position.set(b.position.x - this.offset.x, b.position.y - this.offset.y, b.position.z - this.offset.z);
    van.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
}

