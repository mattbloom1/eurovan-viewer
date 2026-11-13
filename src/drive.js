// Drive mode: a small world (parking lot + rolling terrain + props), arcade bicycle-model physics,
// chase/driver/orbit cameras, keyboard and multi-touch input.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LOT_X = 36, LOT_Z = 26, WORLD = 300;

function rand(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Terrain height: flat lot in the middle, rolling hills around it.
export function heightAt(x, z) {
  const dx = Math.max(0, Math.abs(x) - LOT_X), dz = Math.max(0, Math.abs(z) - LOT_Z);
  const d = Math.hypot(dx, dz);
  const w = smooth(2, 30, d);
  if (w === 0) return 0;
  const h = 3.2 * Math.sin(x * 0.034 + 1.3) * Math.cos(z * 0.029)
    + 2.0 * Math.sin(x * 0.012 + z * 0.017 + 0.4)
    + 0.9 * Math.sin(x * 0.071) * Math.sin(z * 0.063 + 0.7)
    + 1.6;
  return w * h + smooth(150, 290, Math.max(Math.abs(x), Math.abs(z))) * 14;
}

function lotTexture() {
  const W = 1024, H = Math.round(1024 * LOT_Z / LOT_X), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3d3f42'; ctx.fillRect(0, 0, W, H);
  const r = rand(5);
  for (let i = 0; i < 14000; i++) { const g = 40 + r() * 50 | 0; ctx.fillStyle = `rgba(${g},${g},${g + 3},${0.25 + r() * 0.35})`; ctx.fillRect(r() * W, r() * H, 1 + r() * 2.5, 1 + r() * 2.5); }
  for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(20,20,22,0.07)'; ctx.beginPath(); ctx.ellipse(r() * W, r() * H, 8 + r() * 22, 5 + r() * 12, r() * 3, 0, 7); ctx.fill(); }
  const m = W / (LOT_X * 2); // px per metre
  ctx.strokeStyle = 'rgba(240,238,228,0.9)'; ctx.lineWidth = 0.12 * m;
  // two rows of stalls along the top and bottom edges, 2.7 m wide, 5.5 m deep
  for (const [y0, dir] of [[2 * m, 1], [H - 2 * m, -1]]) {
    for (let x = 6 * m; x <= W - 6 * m; x += 2.7 * m) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + dir * 5.5 * m); ctx.stroke(); }
  }
  // centre stalls (back-to-back)
  for (let x = 14 * m; x <= W - 14 * m; x += 2.7 * m) { ctx.beginPath(); ctx.moveTo(x, H / 2 - 5.5 * m); ctx.lineTo(x, H / 2 + 5.5 * m); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(14 * m, H / 2); ctx.lineTo(W - 14 * m, H / 2); ctx.stroke();
  // lane arrows + "start" box
  ctx.fillStyle = 'rgba(240,238,228,0.85)';
  for (const [x, y, a] of [[W * 0.2, H * 0.3, 0], [W * 0.8, H * 0.7, Math.PI]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath();
    ctx.moveTo(2 * m, 0); ctx.lineTo(0, -0.9 * m); ctx.lineTo(0, -0.3 * m); ctx.lineTo(-2 * m, -0.3 * m); ctx.lineTo(-2 * m, 0.3 * m); ctx.lineTo(0, 0.3 * m); ctx.lineTo(0, 0.9 * m); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.strokeStyle = 'rgba(232,190,60,0.9)'; ctx.lineWidth = 0.15 * m; ctx.setLineDash([0.6 * m, 0.4 * m]);
  ctx.strokeRect(W / 2 - 1.3 * m, H / 2 - 3 * m + 0, 2.6 * m, 6 * m);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export class Drive {
  constructor({ scene, van, camera, controls, manifest, bounds, wheels }) {
    this.scene = scene; this.van = van; this.camera = camera; this.controls = controls;
    this.bounds = bounds;
    this.active = false;
    this.camMode = 'chase';
    this.keys = new Set();
    this.touch = {};
    // wheel geometry from manifest, falling back to the nodes / sensible defaults
    const mw = Array.isArray(manifest && manifest.wheels) ? manifest.wheels : [];
    this.wheels = [];
    const defaults = { Wheel_FL: [0.78, 1.6], Wheel_FR: [-0.78, 1.6], Wheel_RL: [0.78, -1.7], Wheel_RR: [-0.78, -1.7] };
    for (const name of Object.keys(defaults)) {
      const node = wheels[name] || null;
      const m = mw.find(w => w && w.name === name);
      let x, z, r;
      if (m && Array.isArray(m.position)) { x = m.position[0]; z = m.position[2]; }
      else if (node) { x = node.position.x; z = node.position.z; }
      else { [x, z] = defaults[name]; }
      r = (m && Number.isFinite(m.radius) && m.radius > 0.1) ? m.radius : (node ? Math.max(0.25, node.position.y) : 0.33);
      this.wheels.push({ name, node, x, z, r, front: z > 0, left: x > 0, baseQuat: node ? node.quaternion.clone() : null });
      if (!node) console.warn(`[drive] wheel node ${name} missing`);
    }
    const fz = this.wheels.filter(w => w.front).map(w => w.z), rz = this.wheels.filter(w => !w.front).map(w => w.z);
    const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
    this.wheelbase = Number.isFinite(manifest && manifest.wheelbase) && manifest.wheelbase > 1 ? manifest.wheelbase : Math.abs(avg(fz) - avg(rz)) || 3.0;
    this.track = Number.isFinite(manifest && manifest.track) && manifest.track > 0.8 ? manifest.track : Math.abs(this.wheels[0].x - this.wheels[1].x) || 1.6;
    this.frontZ = avg(fz);
    this.rearZ = avg(rz);
    this._q1 = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._yAxis = new THREE.Vector3(0, 1, 0); this._xAxis = new THREE.Vector3(1, 0, 0);
    this.reset();
    this._bindKeys();
  }

  reset() {
    this.x = 0; this.z = 0; this.heading = 0; this.v = 0; this.steer = 0; this.dist = 0;
    this.susP = 0; this.susPv = 0; this.susR = 0; this.susRv = 0; this.lastV = 0; this.yawRate = 0;
    this._camInit = false;
  }

  buildWorld() {
    if (this.world) return;
    const g = new THREE.Group(); g.name = 'DriveWorld';
    // terrain
    const seg = 160;
    const geo = new THREE.PlaneGeometry(WORLD * 2, WORLD * 2, seg, seg).rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const grassA = new THREE.Color(0x56703a), grassB = new THREE.Color(0x7c8a48), dirt = new THREE.Color(0x8a7656), rock = new THREE.Color(0x7d7b74);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = heightAt(x, z);
      p.setY(i, y);
      const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) * Math.cos(z * 0.17);
      c.copy(grassA).lerp(grassB, n);
      const nearLot = Math.max(Math.abs(x) - LOT_X, Math.abs(z) - LOT_Z);
      if (nearLot < 4) c.lerp(dirt, smooth(4, 0, nearLot) * 0.8);
      if (y > 9) c.lerp(rock, smooth(9, 16, y));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    terrain.receiveShadow = true;
    g.add(terrain);

    // asphalt lot
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(LOT_X * 2, LOT_Z * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lot.position.y = 0.01;
    lot.receiveShadow = true;
    g.add(lot);
    // curbs
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xbdb8ab, roughness: 0.9 });
    for (const [w, d, x, z] of [[LOT_X * 2, 0.3, 0, LOT_Z], [LOT_X * 2, 0.3, 0, -LOT_Z], [0.3, LOT_Z * 2, LOT_X, 0], [0.3, LOT_Z * 2, -LOT_X, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), curbMat); m.position.set(x, 0.07, z); m.receiveShadow = true; g.add(m);
    }

    const r = rand(42);
    const dummy = new THREE.Object3D();
    // cones: a slalom line + a few loose ones
    const coneGeo = new THREE.ConeGeometry(0.17, 0.55, 12).translate(0, 0.275, 0);
    const cones = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.6 }), 22);
    for (let i = 0; i < 22; i++) {
      const x = i < 14 ? -24 + i * 3.6 : -30 + r() * 60, z = i < 14 ? -9 + (i % 2) * 0.4 : -20 + r() * 40;
      dummy.position.set(x, 0.01, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); cones.setMatrixAt(i, dummy.matrix);
    }
    cones.castShadow = true; g.add(cones);
    // light poles
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 });
    for (const [x, z] of [[-20, 0], [20, 0], [-LOT_X + 2, LOT_Z - 2], [LOT_X - 2, -LOT_Z + 2]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7, 8).translate(0, 3.5, 0), poleMat);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.35), poleMat); head.position.set(0, 7, 0);
      pole.position.set(x, 0, z); pole.add(head); pole.castShadow = true; g.add(pole);
    }
    // trees (trunk + two foliage cones), rocks
    const N = 170;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), N);
    const fol = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 4.0, 0), new THREE.MeshStandardMaterial({ color: 0x2f5a35, roughness: 1, flatShading: true }), N);
    const fol2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.15, 3.0, 7).translate(0, 5.8, 0), new THREE.MeshStandardMaterial({ color: 0x3a6b3d, roughness: 1, flatShading: true }), N);
    const tc = new THREE.Color();
    let n = 0;
    while (n < N) {
      const x = (r() * 2 - 1) * 230, z = (r() * 2 - 1) * 230;
      if (Math.abs(x) < LOT_X + 8 && Math.abs(z) < LOT_Z + 8) continue;
      const s = 0.7 + r() * 0.8;
      dummy.position.set(x, heightAt(x, z) - 0.1, z); dummy.rotation.set(0, r() * 6, 0); dummy.scale.set(s, s * (0.8 + r() * 0.5), s); dummy.updateMatrix();
      trunk.setMatrixAt(n, dummy.matrix); fol.setMatrixAt(n, dummy.matrix); fol2.setMatrixAt(n, dummy.matrix);
      tc.setHSL(0.3 + r() * 0.06, 0.35, 0.22 + r() * 0.1); fol.setColorAt(n, tc); fol2.setColorAt(n, tc.offsetHSL(0, 0, 0.05));
      n++;
    }
    for (const m of [trunk, fol, fol2]) { m.castShadow = true; g.add(m); }
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x8b877d, roughness: 0.95, flatShading: true }), 70);
    for (let i = 0; i < 70; i++) {
      let x, z;
      do { x = (r() * 2 - 1) * 200; z = (r() * 2 - 1) * 200; } while (Math.abs(x) < LOT_X + 4 && Math.abs(z) < LOT_Z + 4);
      const s = 0.4 + r() * 1.4;
      dummy.position.set(x, heightAt(x, z) - 0.2 * s, z); dummy.rotation.set(r() * 3, r() * 3, r() * 3); dummy.scale.set(s, s * 0.7, s * (0.8 + r() * 0.5)); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.castShadow = true; g.add(rocks);
    g.visible = false;
    this.scene.add(g);
    this.world = g;
  }

  enter() {
    this.buildWorld();
    this.world.visible = true;
    this.active = true;
    this.reset();
    this.keys.clear(); this.touch = {};
    this._place(0);
    this._snapCamera();
  }

  exit() {
    this.active = false;
    if (this.world) this.world.visible = false;
    this.van.position.set(0, 0, 0);
    this.van.rotation.set(0, 0, 0);
    for (const w of this.wheels) if (w.node && w.baseQuat) w.node.quaternion.copy(w.baseQuat);
    this.controls.enabled = true;
  }

  cycleCamera() {
    this.camMode = { chase: 'driver', driver: 'orbit', orbit: 'chase' }[this.camMode];
    this.controls.enabled = this.camMode === 'orbit';
    if (this.camMode === 'orbit') {
      this.controls.target.set(this.x, 1.1, this.z);
      this.controls.update();
    }
    this._camInit = false;
    return this.camMode;
  }

  _bindKeys() {
    const map = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand' };
    this.keyMap = map;
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (map[e.code]) { this.keys.add(map[e.code]); e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { if (map[e.code]) this.keys.delete(map[e.code]); });
    window.addEventListener('blur', () => { this.keys.clear(); this.touch = {}; });
  }

  bindTouch(root) {
    for (const b of root.querySelectorAll('[data-k]')) {
      const k = b.dataset.k;
      const down = e => { e.preventDefault(); this.touch[k] = (this.touch[k] || 0) + 1; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } };
      const up = e => { if (b.classList.contains('held')) { this.touch[k] = 0; b.classList.remove('held'); } };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', e => e.preventDefault());
    }
  }

  // inject inputs programmatically (used by tests / automation)
  setInput(k, on) { if (on) this.keys.add(k); else this.keys.delete(k); }

  input(k) { return this.keys.has(k) || (this.touch[k] || 0) > 0; }

  // advance by wall-clock dt using fixed-size substeps (stable on slow frames)
  update(dt) {
    let t = Math.min(dt, 0.5), r = null;
    do { const h = Math.min(t, 1 / 30); r = this._step(Math.max(h, 1e-4)); t -= h; } while (t > 1e-4);
    return r;
  }

  _step(dt) {
    const gas = this.input('gas') ? 1 : 0, brake = this.input('brake') ? 1 : 0, hand = this.input('hand');
    const steerIn = (this.input('left') ? 1 : 0) - (this.input('right') ? 1 : 0);
    // steering: ramp toward target, faster return to centre
    const rate = steerIn === 0 ? 5 : 2.6;
    this.steer += clamp(steerIn - this.steer, -rate * dt, rate * dt);
    const v = this.v;
    const maxSteer = 0.58 / (1 + (v * v) / 160);
    const delta = this.steer * maxSteer;

    let a = 0;
    if (gas) a += v < -0.2 ? 7 : 3.4 * (1 - clamp(v / 42, 0, 1));
    if (brake) a += v > 0.3 ? -8.5 : -2.6;
    if (hand) a += -Math.sign(v) * 6.5;
    a -= 0.0042 * v * Math.abs(v) + 0.22 * Math.sign(v);
    a -= 9.81 * Math.sin(this.pitchGround || 0) * 0.85;
    let nv = v + a * dt;
    if (brake && v > 0.3 && nv < 0) nv = 0;                // brake does not flip into reverse in one go
    if (hand && Math.sign(nv) !== Math.sign(v)) nv = 0;
    if (!gas && !brake && Math.abs(nv) < 0.12) nv = 0;
    nv = clamp(nv, -6, 44);
    this.v = nv;
    this.accel = (nv - v) / dt;

    let yawRate = (nv / this.wheelbase) * Math.tan(delta);
    if (hand && Math.abs(nv) > 3) yawRate *= 1.45;
    this.yawRate = yawRate;
    this.heading += yawRate * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.x = clamp(this.x + fx * nv * dt, -WORLD + 20, WORLD - 20);
    this.z = clamp(this.z + fz * nv * dt, -WORLD + 20, WORLD - 20);
    this.dist += nv * dt;

    // suspension: spring-damped body pitch/roll from longitudinal / lateral acceleration
    const aLong = clamp(this.accel, -10, 10), aLat = clamp(nv * yawRate, -9, 9);
    const k = 70, c = 10;
    // +X rotation = nose down: braking (aLong < 0) dives, accelerating squats. Left turn rolls the left side up.
    const tp = -aLong * 0.0055, tr = aLat * 0.012;
    this.susPv += (k * (tp - this.susP) - c * this.susPv) * dt; this.susP += this.susPv * dt;
    this.susRv += (k * (tr - this.susR) - c * this.susRv) * dt; this.susR += this.susRv * dt;

    this._place(delta);
    this._updateCamera(dt);
    return { mph: Math.abs(nv) * 2.23694, v: nv, braking: brake && nv > 0.3, gear: nv < -0.1 ? 'R' : (Math.abs(nv) < 0.1 && !gas ? 'N' : 'D') };
  }

  _place(delta) {
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    // group contact heights by actual position (front/rear by z, +X side/-X side by x), not by name
    let hf = 0, hr = 0, hl = 0, hrt = 0, nf = 0, nr = 0, nl = 0, nrt = 0;
    const midZ0 = (this.frontZ + this.rearZ) / 2;
    for (const w of this.wheels) {
      // local (x,z) -> world, rotation about Y by heading
      const wx = this.x + w.x * ch + w.z * sh, wz = this.z - w.x * sh + w.z * ch;
      const h = heightAt(wx, wz);
      if (w.z > midZ0) { hf += h; nf++; } else { hr += h; nr++; }
      if (w.x > 0) { hl += h; nl++; } else { hrt += h; nrt++; }
    }
    hf /= nf || 1; hr /= nr || 1; hl /= nl || 1; hrt /= nrt || 1;
    const span = this.frontZ - this.rearZ || this.wheelbase;
    const pitch = Math.atan2(hf - hr, span);
    const roll = Math.atan2(hl - hrt, this.track);
    this.pitchGround = pitch;
    // height at the van origin from the plane through the axles
    const midZ = (this.frontZ + this.rearZ) / 2;
    const y = (hf + hr) / 2 - Math.tan(pitch) * midZ;
    this.van.position.set(this.x, y, this.z);
    this.van.rotation.set(-pitch + this.susP, this.heading, roll + this.susR, 'YXZ');
    // wheels: steer fronts, spin all by distance / radius
    for (const w of this.wheels) {
      if (!w.node) continue;
      this._q1.setFromAxisAngle(this._xAxis, this.dist / w.r);
      if (w.front) { this._q2.setFromAxisAngle(this._yAxis, delta); this._q1.premultiply(this._q2); }
      w.node.quaternion.copy(this._q1).multiply(w.baseQuat);
    }
  }

  _snapCamera() { this._camInit = false; this._updateCamera(1); }

  _updateCamera(dt) {
    const cam = this.camera;
    const fov = this.camMode === 'driver' ? 62 : 50;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const p = this.van.position;
    if (this.camMode === 'chase') {
      const back = 7.2 + Math.max(0, this.v) * 0.06;
      const des = new THREE.Vector3(p.x - fx * back, p.y + 2.7, p.z - fz * back);
      const ground = heightAt(des.x, des.z) + 1.2;
      des.y = Math.max(des.y, ground);
      const k = this._camInit ? 1 - Math.exp(-dt * 5) : 1;
      cam.position.lerp(des, k);
      cam.lookAt(p.x + fx * 2.5, p.y + 1.2, p.z + fz * 2.5);
    } else if (this.camMode === 'driver') {
      const eye = new THREE.Vector3(Math.abs(this.wheels[0].x) * 0.55, (this.bounds.min.y + 1.6), this.frontZ - 0.95);
      const look = eye.clone().add(new THREE.Vector3(0, -1.0, 6));
      this.van.localToWorld(eye); this.van.localToWorld(look);
      cam.position.copy(eye);
      cam.lookAt(look);
    } else {
      // orbit: follow the van by shifting camera + target with it
      const t = this.controls.target;
      const nt = new THREE.Vector3(p.x, p.y + 1.1, p.z);
      const d = nt.clone().sub(t);
      t.copy(nt); cam.position.add(d);
      this.controls.update();
    }
    this._camInit = true;
  }
}
