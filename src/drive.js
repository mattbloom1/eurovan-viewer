// Drive mode: a small world (parking lot + rolling terrain + props + jump ramps + a mountain with a switchback road),
// arcade bicycle-model physics with airborne phase, boost with flame jets, chase/driver/orbit cameras,
// keyboard and multi-touch input.
import * as THREE from 'three';
import { VehiclePhysics } from './vehicle-physics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const LOT_X = 36, LOT_Z = 26;
const WORLD_X0 = -300, WORLD_X1 = 420, WORLD_Z = 300;   // terrain extents (clamp is 20 m inside)
const GRAV = 12;                                         // arcade gravity (m/s^2) while airborne

function rand(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- terrain description
// Mountain: centre MC, foot radius MR, flat summit disc of radius MS at height MH. A dirt road spirals up it at a constant grade.
const MC = { x: 230, z: -40 }, MR = 130, MS = 24, MH = 72;
const ROAD_HALF = 4.5, ROAD_BANK = 12, GRADE = 0.12;
const CA = { x: 34, z: -6 };                             // start of the dirt track that leaves the lot towards the mountain
const profile = u => { u = clamp(u, 0, 1); return 0.35 * u * smooth(0, 0.12, u) + 0.65 * (u * u * (3 - 2 * u)); };
const profileD = u => (profile(u + 1e-3) - profile(u - 1e-3)) / 2e-3;

// switchback / spiral road: constant grade, solved from the mountain profile (path turns only as much as the face needs)
const ROAD = (() => {
  const xs = [], zs = [], hs = [], ss = [];
  const th0 = Math.atan2(CA.z - MC.z, CA.x - MC.x), dr = 0.5;
  let r = MR - 2, th = th0, s = 0;
  const put = () => { xs.push(MC.x + r * Math.cos(th)); zs.push(MC.z + r * Math.sin(th)); hs.push(MH * profile((MR - r) / (MR - MS))); ss.push(s); };
  put();
  while (r > MS + 1e-6) {
    const step = Math.min(dr, r - MS), rm = r - step / 2, u = (MR - rm) / (MR - MS);
    const sr = MH * profileD(u) / (MR - MS);
    const k = Math.max(0.25, Math.sqrt(Math.max(0, (sr / GRADE) ** 2 - 1)));
    const dth = step * k / rm;
    th += dth; r -= step; s += Math.hypot(step, rm * dth);
    put();
  }
  return { xs, zs, hs, ss, n: xs.length, length: s, turns: (th - th0) / (2 * Math.PI) };
})();
const CB = { x: ROAD.xs[0], z: ROAD.zs[0] };             // road start = end of the approach track
// spatial buckets so the nearest-road query only looks at a handful of segments
const RG = (() => {
  const cs = 12, ox = MC.x - MR - 24, oz = MC.z - MR - 24, n = Math.ceil((2 * MR + 48) / cs), cells = new Array(n * n);
  const reach = ROAD_HALF + ROAD_BANK + 1;
  for (let i = 0; i < ROAD.n - 1; i++) {
    const x0 = Math.min(ROAD.xs[i], ROAD.xs[i + 1]) - reach, x1 = Math.max(ROAD.xs[i], ROAD.xs[i + 1]) + reach;
    const z0 = Math.min(ROAD.zs[i], ROAD.zs[i + 1]) - reach, z1 = Math.max(ROAD.zs[i], ROAD.zs[i + 1]) + reach;
    for (let gz = Math.max(0, Math.floor((z0 - oz) / cs)); gz <= Math.min(n - 1, Math.floor((z1 - oz) / cs)); gz++) {
      for (let gx = Math.max(0, Math.floor((x0 - ox) / cs)); gx <= Math.min(n - 1, Math.floor((x1 - ox) / cs)); gx++) {
        (cells[gz * n + gx] || (cells[gz * n + gx] = [])).push(i);
      }
    }
  }
  return { cs, ox, oz, n, cells };
})();
const RQ = { d: 1e9, s: 0, h: 0 };
function roadQuery(x, z) {
  RQ.d = 1e9;
  const gx = Math.floor((x - RG.ox) / RG.cs), gz = Math.floor((z - RG.oz) / RG.cs);
  if (gx < 0 || gz < 0 || gx >= RG.n || gz >= RG.n) return;
  const list = RG.cells[gz * RG.n + gx];
  if (!list) return;
  let bd = 1e18, bi = 0, bt = 0;
  for (let k = 0; k < list.length; k++) {
    const i = list[k], ax = ROAD.xs[i], az = ROAD.zs[i], bx = ROAD.xs[i + 1] - ax, bz = ROAD.zs[i + 1] - az;
    const t = clamp(((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz), 0, 1);
    const dx = x - ax - bx * t, dz = z - az - bz * t, d2 = dx * dx + dz * dz;
    if (d2 < bd) { bd = d2; bi = i; bt = t; }
  }
  RQ.d = Math.sqrt(bd);
  RQ.s = ROAD.ss[bi] + (ROAD.ss[bi + 1] - ROAD.ss[bi]) * bt;
  RQ.h = ROAD.hs[bi] + (ROAD.hs[bi + 1] - ROAD.hs[bi]) * bt;
}
function distSeg(x, z, a, b) {
  const bx = b.x - a.x, bz = b.z - a.z, t = clamp(((x - a.x) * bx + (z - a.z) * bz) / (bx * bx + bz * bz), 0, 1);
  return Math.hypot(x - a.x - bx * t, z - a.z - bz * t);
}

// jump ramps: profile = [u (along heading, m), height (m)] points, W = width. Ground under them is exactly 0.
const AX = (CB.x - CA.x), AZ = (CB.z - CA.z), AL = Math.hypot(AX, AZ), UX = AX / AL, UZ = AZ / AL, NX = -UZ, NZ = UX;  // track axis / left normal
const TRACK_H = Math.atan2(UX, UZ);
const kicker = (H, L) => [[0, 0], [L, H], [L + 0.45 * H, 0]];
const landing = (H, L) => [[-0.9 * H, 0], [0, H], [L, 0]];
function makeRamp(x, z, h, W, pts, tag) {
  const L = pts[pts.length - 1][0] - pts[0][0];
  return { x, z, h, W, pts, tag, s: Math.sin(h), c: Math.cos(h), rad2: (L + W) * (L + W), top: Math.max(...pts.map(p => p[1])) };
}
const RAMPS = [
  makeRamp(0, 9, 0, 4.2, kicker(0.9, 6), 'lot-small'),
  makeRamp(-27, -15, Math.PI / 2, 5, kicker(1.5, 8), 'lot-medium'),
  makeRamp(CA.x + UX * 14 + NX * 9, CA.z + UZ * 14 + NZ * 9, TRACK_H, 6.4, kicker(3.4, 13), 'big-launch'),
  makeRamp(CA.x + UX * 44 + NX * 9, CA.z + UZ * 44 + NZ * 9, TRACK_H, 8, landing(2.2, 18), 'big-landing'),
  makeRamp(CA.x + UX * 34 - NX * 9, CA.z + UZ * 34 - NZ * 9, TRACK_H, 5, kicker(1.7, 8), 'double-a'),
  makeRamp(CA.x + UX * 56 - NX * 9, CA.z + UZ * 56 - NZ * 9, TRACK_H, 5.5, kicker(2.4, 10), 'double-b'),
];
function rampAt(x, z) {
  let best = 0;
  for (let k = 0; k < RAMPS.length; k++) {
    const rp = RAMPS[k], dx = x - rp.x, dz = z - rp.z;
    if (dx * dx + dz * dz > rp.rad2) continue;
    const u = dx * rp.s + dz * rp.c, w = Math.abs(dx * rp.c - dz * rp.s), P = rp.pts;
    if (w > rp.W / 2 || u <= P[0][0] || u >= P[P.length - 1][0]) continue;
    let i = 0; while (u > P[i + 1][0]) i++;
    const t = (u - P[i][0]) / (P[i + 1][0] - P[i][0]);
    const hh = (P[i][1] + (P[i + 1][1] - P[i][1]) * t) * smooth(rp.W / 2, rp.W / 2 - 0.35, w);
    if (hh > best) best = hh;
  }
  return best;
}

// scratch output of groundAt for colouring: road weight, mountain height fraction
const INFO = { road: 0, u: 0 };
function hills(x, z) {
  const dx = Math.max(0, Math.abs(x) - LOT_X), dz = Math.max(0, Math.abs(z) - LOT_Z);
  const w = smooth(2, 30, Math.hypot(dx, dz));
  if (w === 0) return 0;
  const h = 3.2 * Math.sin(x * 0.034 + 1.3) * Math.cos(z * 0.029)
    + 2.0 * Math.sin(x * 0.012 + z * 0.017 + 0.4)
    + 0.9 * Math.sin(x * 0.071) * Math.sin(z * 0.063 + 0.7)
    + 1.6;
  return w * h + smooth(150, 290, Math.max(Math.abs(x), Math.abs(z))) * 14;
}
// Terrain without ramps (drives the mesh, trees, ...).
export function groundAt(x, z) {
  INFO.road = 0; INFO.u = 0;
  let h = hills(x, z);
  if (h !== 0 && x > 0) h *= smooth(14, 32, distSeg(x, z, CA, CB));        // graded corridor to the mountain
  const dx = x - MC.x, dz = z - MC.z, r2 = dx * dx + dz * dz;
  if (r2 < (MR + 16) * (MR + 16)) {
    const r = Math.sqrt(r2);
    h *= 1 - smooth(MR + 16, MR - 6, r);
    const th = Math.atan2(dz, dx), u0 = (MR - r) / (MR - MS);
    const reff = r * (1 + (0.05 * Math.sin(2 * th + 0.5) + 0.04 * Math.sin(3 * th + 2)) * smooth(0, 0.4, u0));
    const u = (MR - reff) / (MR - MS);
    if (u > 0) {
      INFO.u = u;
      const shape = smooth(0.05, 0.4, u) * (1 - smooth(0.82, 0.95, u));
      h += MH * profile(u) + shape * (4 * Math.sin(x * 0.043 + z * 0.031 + 1) * Math.cos(z * 0.047 - x * 0.021) + 2 * Math.sin(x * 0.11) * Math.sin(z * 0.097 + 2));
    }
    if (r < MR + 10) {
      roadQuery(x, z);
      if (RQ.d < ROAD_HALF + ROAD_BANK) {
        const rw = (1 - smooth(ROAD_HALF, ROAD_HALF + ROAD_BANK, RQ.d)) * smooth(0, 24, RQ.s);
        h += (RQ.h - h) * rw;
        INFO.road = rw;
      }
    }
  }
  return h;
}
// Everything the van drives on: terrain + ramps.
export function heightAt(x, z) {
  const g = groundAt(x, z);
  const rp = rampAt(x, z);
  return rp > g ? rp : g;
}
export const WORLD_INFO = { MC, MR, MS, MH, GRADE, ROAD, RAMPS, LOT_X, LOT_Z, CA, CB, GRAV };

// ---------------------------------------------------------------- canvas textures
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
  // big yellow "mountain" arrow near the east exit (text reads when driving towards +x)
  ctx.save(); ctx.translate(W - 6.5 * m, H * 0.5 + 3.4 * m); ctx.fillStyle = 'rgba(244,196,48,0.92)';
  ctx.beginPath(); ctx.moveTo(4.2 * m, 0); ctx.lineTo(1.2 * m, -2.1 * m); ctx.lineTo(1.2 * m, -0.8 * m); ctx.lineTo(-4.2 * m, -0.8 * m); ctx.lineTo(-4.2 * m, 0.8 * m); ctx.lineTo(1.2 * m, 0.8 * m); ctx.lineTo(1.2 * m, 2.1 * m); ctx.closePath(); ctx.fill();
  ctx.rotate(Math.PI / 2); ctx.fillStyle = 'rgba(244,196,48,0.92)'; ctx.font = `800 ${1.5 * m}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('MOUNTAIN', 0, -3.9 * m);
  ctx.restore();
  ctx.strokeStyle = 'rgba(232,190,60,0.9)'; ctx.lineWidth = 0.15 * m; ctx.setLineDash([0.6 * m, 0.4 * m]);
  ctx.strokeRect(W / 2 - 1.3 * m, H / 2 - 3 * m + 0, 2.6 * m, 6 * m);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTex = () => canvasTex(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}, false);
const rampTex = () => {
  const t = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e8731f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f7f3e6'; ctx.fillRect(0, 0, 9, h); ctx.fillRect(w - 9, 0, 9, h);
    ctx.lineWidth = 15; ctx.strokeStyle = '#f7f3e6'; ctx.lineJoin = 'miter';
    for (const y of [28, 82]) { ctx.beginPath(); ctx.moveTo(18, y + 30); ctx.lineTo(w / 2, y); ctx.lineTo(w - 18, y + 30); ctx.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
};

// ---------------------------------------------------------------- particles (pooled points, world space)
class Particles {
  constructor(n, additive, tex) {
    this.n = n; this.head = 0;
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.vel = new Float32Array(n * 3);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.a0 = new Float32Array(n);
    const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.pos = pos; this.size = size; this.alpha = alpha; this.col = col; this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uScale: { value: 600 } }, transparent: true, depthWrite: false, fog: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float aSize; attribute float aAlpha; attribute vec3 aCol; uniform float uScale; varying float vA; varying vec3 vC; void main(){ vA=aAlpha; vC=aCol; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=min(96.0, aSize*uScale/max(0.1,-mv.z)); }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ float a=texture2D(map,gl_PointCoord).a*vA; if(a<0.01) discard; gl_FragColor=vec4(vC,a); }',
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.clear();
  }
  clear() { this.life.fill(0); this.alpha.fill(0); this.size.fill(0); this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; }
  emit(x, y, z, vx, vy, vz, life, s0, s1, a0, r, g, b) {
    const i = this.head; this.head = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
  }
  update(dt, drag, grav, fadeIn) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      const t = 1 - this.life[i] / this.max[i], k = 1 - Math.min(1, drag * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - grav * dt; this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.alpha[i] = this.a0[i] * (fadeIn ? Math.min(1, t * 6) : 1) * (1 - t) * (1 - t * 0.3);
    }
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aCol.needsUpdate = true;
  }
}

export class Drive {
  constructor({ scene, van, camera, controls, manifest, bounds, wheels, renderer }) {
    this.scene = scene; this.van = van; this.camera = camera; this.controls = controls; this.renderer = renderer || null;
    this.bounds = bounds;
    this.active = false;
    this.camMode = 'chase';
    this.keys = new Set();
    this.physicalKeys = new Set();
    this.touch = {};
    this.onToast = null;                 // (text|null, kind) => void, set by main.js
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
    this._shk = new THREE.Vector3(); this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3(); this._one = new THREE.Vector3(1, 1, 1);
    this.fov0 = camera.fov;
    this.reset();
    this._bindKeys();
  }

  reset() {
    this._accumulator = 0; this._previousPose = null; this._currentPose = null; this._lastResult = null;
    this.x = 0; this.z = 0; this.heading = 0; this.v = 0; this.steer = 0; this.dist = 0;
    this.susP = 0; this.susPv = 0; this.susR = 0; this.susRv = 0; this.susY = 0; this.susYv = 0; this.lastV = 0; this.yawRate = 0;
    this.air = false; this.vy = 0; this.yAir = 0; this.airRx = 0; this.airRxV = 0; this.airRz = 0; this.airT = 0; this.airDist = 0;
    this.gLast = 0; this.vyG = 0; this.gT = 0; this._rx = 0; this._rz = 0;
    this.lastAir = { t: 0, ft: 0 }; this.airCount = 0; this.maxAirT = 0;
    this.boost = 1; this.boosting = false; this.boostLock = false; this.boostVis = 0; this.flame = 0;
    this.run = { state: 'idle', t: 0 };
    this._camInit = false; this._shk.set(0, 0, 0);
    if (this.fx) this._fxHide();
    if (this.onToast) this.onToast(null);
  }

  // test / debug helper: put the van somewhere with some speed
  teleport(x, z, heading = this.heading, v = 0) {
    this.x = x; this.z = z; this.heading = heading; this.v = v; this.air = false; this.vy = 0;
    this.susP = this.susPv = this.susR = this.susRv = this.susY = this.susYv = 0;
    this._place(0); this._snapCamera();
    this._accumulator = 0; this._previousPose = null; this._currentPose = null;
  }

  buildWorld() {
    if (this.world) return;
    const g = new THREE.Group(); g.name = 'DriveWorld';
    this.obstacleColliders = [];
    // ---- terrain: coarse base mesh with a hole + finer patch over the mountain, normals/colours from the height function
    const grassA = new THREE.Color(0x56703a), grassB = new THREE.Color(0x7c8a48), dirt = new THREE.Color(0x8a7656), rock = new THREE.Color(0x7d7b74);
    const alpine = new THREE.Color(0x8c8a5a), snow = new THREE.Color(0xdde3e8), roadC = new THREE.Color(0x9c8159), rockD = new THREE.Color(0x65625c), c = new THREE.Color();
    const buildGrid = (x0, x1, z0, z1, cs, hole, isPatch) => {
      const nx = Math.round((x1 - x0) / cs), nz = Math.round((z1 - z0) / cs), vx = nx + 1;
      const pos = new Float32Array(vx * (nz + 1) * 3), nor = new Float32Array(pos.length), col = new Float32Array(pos.length);
      const e = cs * 0.5;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
        const k = (j * vx + i) * 3, x = x0 + i * cs, z = z0 + j * cs, y = groundAt(x, z), road = INFO.road, u = INFO.u;
        const gx = (groundAt(x + e, z) - groundAt(x - e, z)) / (2 * e), gz = (groundAt(x, z + e) - groundAt(x, z - e)) / (2 * e);
        const il = 1 / Math.hypot(gx, 1, gz), slope = Math.hypot(gx, gz);
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; nor[k] = -gx * il; nor[k + 1] = il; nor[k + 2] = -gz * il;
        const n = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) * Math.cos(z * 0.17);
        c.copy(grassA).lerp(grassB, n);
        const nearLot = Math.max(Math.abs(x) - LOT_X, Math.abs(z) - LOT_Z);
        if (nearLot < 4) c.lerp(dirt, smooth(4, 0, nearLot) * 0.8);
        if (u > 0) {
          c.lerp(alpine, smooth(24, 50, y) * 0.5);
          c.lerp(rock, smooth(0.65, 1.3, slope + 0.1 * (n - 0.5)) * 0.9).lerp(rockD, smooth(0.9, 1.6, slope) * 0.6);
          c.lerp(snow, smooth(56, 63, y + 4 * (n - 0.5)) * (1 - smooth(0.9, 1.5, slope)));
        } else if (y > 9) c.lerp(rock, smooth(9, 16, y));
        if (road > 0) c.lerp(roadC, smooth(0.35, 0.95, road) * (0.92 + 0.08 * n));
        if (isPatch) c.lerp(dirt, (1 - smooth(3.2, 5.5, distSeg(x, z, CA, CB))) * 0.9);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
      const idx = [];
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const cx = x0 + (i + 0.5) * cs, cz = z0 + (j + 0.5) * cs;
        if (hole && cx > hole[0] && cx < hole[1] && cz > hole[2] && cz < hole[3]) continue;
        const a = j * vx + i, b = a + 1, cc = a + vx, d = cc + 1;
        if ((i + j) & 1) idx.push(a, cc, d, a, d, b); else idx.push(a, cc, b, b, cc, d);   // alternate the diagonal
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      return geo;
    };
    const P = [85, 375, -185, 105];                                   // mountain patch rect (on the base grid lines)
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const base = new THREE.Mesh(buildGrid(WORLD_X0, WORLD_X1, -WORLD_Z, WORLD_Z, 5, P, false), terrainMat);
    const patch = new THREE.Mesh(buildGrid(P[0], P[1], P[2], P[3], 2, null, true), terrainMat);
    for (const t of [base, patch]) { t.receiveShadow = true; g.add(t); }
    this.terrainTris = (base.geometry.index.count + patch.geometry.index.count) / 3;

    // ---- asphalt lot
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(LOT_X * 2, LOT_Z * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    lot.position.y = 0.01;
    lot.receiveShadow = true;
    g.add(lot);
    // curbs
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xbdb8ab, roughness: 0.9 });
    for (const [w, d, x, z] of [[LOT_X * 2, 0.3, 0, LOT_Z], [LOT_X * 2, 0.3, 0, -LOT_Z], [0.3, LOT_Z * 2, LOT_X, 0], [0.3, LOT_Z * 2, -LOT_X, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), curbMat); m.position.set(x, 0.07, z); m.receiveShadow = true; g.add(m);
    }
    // dirt track from the lot's east exit to the foot of the mountain road (flat ground, painted decal)
    {
      const x1 = 90, len = (x1 - CA.x) / UX, wid = 9;
      const tex = canvasTex(256, 64, (ctx, w, h) => {
        ctx.fillStyle = '#8f7a55'; ctx.fillRect(0, 0, w, h);
        const r = rand(11); for (let i = 0; i < 1400; i++) { const v = 100 + r() * 60 | 0; ctx.fillStyle = `rgba(${v},${v - 18},${v - 45},0.35)`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
        ctx.fillStyle = 'rgba(70,55,35,0.22)'; ctx.fillRect(0, h * 0.28, w, h * 0.12); ctx.fillRect(0, h * 0.6, w, h * 0.12);
        const m = ctx.createLinearGradient(0, 0, 0, h); m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(0.18, 'rgba(0,0,0,0)'); m.addColorStop(0.82, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
      });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, wid).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      strip.position.set(CA.x + UX * len / 2, 0.03, CA.z + UZ * len / 2); strip.rotation.y = Math.atan2(-UZ, UX); strip.receiveShadow = true; g.add(strip);
    }

    // ---- ramps
    {
      const topMat = new THREE.MeshStandardMaterial({ map: rampTex(), roughness: 0.75, side: THREE.DoubleSide });
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c6, roughness: 0.9, side: THREE.DoubleSide });
      for (const rp of RAMPS) {
        const P = rp.pts, hw = rp.W / 2, pos = [], uv = [], spos = [];
        let run = 0;
        for (let i = 0; i < P.length - 1; i++) {
          const [u0, h0] = P[i], [u1, h1] = P[i + 1], len = Math.hypot(u1 - u0, h1 - h0), v0 = run / 5, v1 = (run += len) / 5;
          pos.push(-hw, h0, u0, hw, h0, u0, hw, h1, u1, -hw, h0, u0, hw, h1, u1, -hw, h1, u1);
          uv.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
        }
        const B = -0.5;
        for (const s of [-hw, hw]) for (let i = 1; i < P.length - 1; i++) spos.push(s, P[0][1] + B, P[0][0], s, P[i][1], P[i][0], s, P[i + 1][1], P[i + 1][0]);
        for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; spos.push(-hw, B, P[i][0], hw, B, P[i][0], hw, B, P[j][0]); }
        spos.push(-hw, B, P[0][0], hw, B, P[P.length - 1][0], -hw, B, P[P.length - 1][0]);
        const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); tg.computeVertexNormals();
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3)); sg.computeVertexNormals();
        const grp = new THREE.Group(); grp.position.set(rp.x, 0, rp.z); grp.rotation.y = rp.h;
        const tm = new THREE.Mesh(tg, topMat), sm = new THREE.Mesh(sg, sideMat); tm.receiveShadow = sm.receiveShadow = true; tm.castShadow = sm.castShadow = true;
        grp.add(tm, sm); grp.name = 'Ramp_' + rp.tag; g.add(grp);
      }
    }

    // ---- delineator posts on the outer edge of the road
    {
      const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6, emissive: 0x333028 }), 80);
      const d = new THREE.Object3D(); let n = 0;
      for (let i = 4; i < ROAD.n - 4 && n < 80; i += 11) {
        const nx = ROAD.zs[i + 1] - ROAD.zs[i], nz = -(ROAD.xs[i + 1] - ROAD.xs[i]), nl = Math.hypot(nx, nz);
        let ox = nx / nl, oz = nz / nl;
        if (ox * (ROAD.xs[i] - MC.x) + oz * (ROAD.zs[i] - MC.z) < 0) { ox = -ox; oz = -oz; }
        const px = ROAD.xs[i] + ox * (ROAD_HALF + 0.5), pz = ROAD.zs[i] + oz * (ROAD_HALF + 0.5);
        d.position.set(px, groundAt(px, pz), pz); d.updateMatrix(); posts.setMatrixAt(n++, d.matrix);
      }
      posts.count = n; posts.castShadow = true; g.add(posts);
    }

    // ---- summit marker: striped pillar + flag + painted ring + a faint light pillar
    {
      const sx = MC.x, sz = MC.z, sy = MH;
      const stripes = canvasTex(32, 128, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f7f3e6' : '#e8531f'; ctx.fillRect(0, i * h / 8, w, h / 8); } });
      stripes.wrapS = THREE.RepeatWrapping;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 12, 12).translate(0, 6, 0), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }));
      pillar.position.set(sx, sy, sz); pillar.castShadow = true; g.add(pillar);
      const flagTex = canvasTex(128, 80, (ctx, w, h) => { for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#101010' : '#f4f1e8'; ctx.fillRect(x * w / 8, y * h / 5, w / 8, h / 5); } });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3, 8, 1).translate(2.5, 0, 0), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
      const fp = flag.geometry.attributes.position; for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin(fp.getX(i) * 1.2) * 0.25 * (fp.getX(i) / 5));
      flag.geometry.computeVertexNormals(); flag.position.set(sx + 0.35, sy + 10.2, sz); flag.castShadow = true; g.add(flag);
      const ring = new THREE.Mesh(new THREE.RingGeometry(9, 10.6, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf4c430, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      ring.position.set(sx, sy + 0.05, sz); g.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 90, 16, 1, true).translate(0, 45, 0), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(sx, sy, sz); g.add(beam);
    }
    // ---- finger post at the lot exit pointing to the mountain
    {
      const shape = new THREE.Shape(); shape.moveTo(0, -0.5); shape.lineTo(3.2, -0.5); shape.lineTo(4.1, 0); shape.lineTo(3.2, 0.5); shape.lineTo(0, 0.5); shape.closePath();
      const board = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }).translate(0, 0, -0.05), new THREE.MeshStandardMaterial({ color: 0x246b45, roughness: 0.7 }));
      const txt = canvasTex(512, 128, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.font = '800 64px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('MOUNTAIN', w / 2, h * 0.5); });
      const tm = new THREE.MeshBasicMaterial({ map: txt, transparent: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.78), tm); face.position.set(1.6, 0, 0.07);
      const face2 = face.clone(); face2.position.z = -0.07; face2.rotation.y = Math.PI;
      const sign = new THREE.Group(); sign.add(board, face, face2); sign.position.y = 3.1; sign.rotation.y = Math.atan2(-UZ, UX) + 0.5; sign.castShadow = true;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.4, 8).translate(0, 1.7, 0), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.6, metalness: 0.4 }));
      const sp = new THREE.Group(); sp.add(pole, sign); sp.position.set(CA.x + 6 + NX * 6.5, 0, CA.z + UZ * 6 + NZ * 6.5); g.add(sp);
      sign.traverse(o => { o.castShadow = true; });
    }

    // ---- props
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
      this.obstacleColliders.push({ x, z, y: 0, radius: 0.12, height: 7 });
    }
    // trees (trunk + two foliage cones): scattered over the world and on the lower mountain slopes (road kept clear), rocks
    const nearRamp = (x, z, pad) => RAMPS.some(rp => Math.hypot(x - rp.x, z - rp.z) < rp.pts[rp.pts.length - 1][0] + rp.W + pad);
    const N = 300;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6).translate(0, 1.1, 0), new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 }), N);
    const fol = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 4.0, 0), new THREE.MeshStandardMaterial({ color: 0x2f5a35, roughness: 1, flatShading: true }), N);
    const fol2 = new THREE.InstancedMesh(new THREE.ConeGeometry(1.15, 3.0, 7).translate(0, 5.8, 0), new THREE.MeshStandardMaterial({ color: 0x3a6b3d, roughness: 1, flatShading: true }), N);
    const tc = new THREE.Color();
    let n = 0;
    const plant = (x, z) => {
      const s = 0.7 + r() * 0.8;
      dummy.position.set(x, groundAt(x, z) - 0.1, z); dummy.rotation.set(0, r() * 6, 0); dummy.scale.set(s, s * (0.8 + r() * 0.5), s); dummy.updateMatrix();
      trunk.setMatrixAt(n, dummy.matrix); fol.setMatrixAt(n, dummy.matrix); fol2.setMatrixAt(n, dummy.matrix);
      this.obstacleColliders.push({ x, z, y: dummy.position.y, radius: 0.24 * s, height: 2.2 * dummy.scale.y });
      tc.setHSL(0.3 + r() * 0.06, 0.35, 0.22 + r() * 0.1); fol.setColorAt(n, tc); fol2.setColorAt(n, tc.offsetHSL(0, 0, 0.05));
      n++;
    };
    while (n < 160) {
      const x = (r() * 2 - 1) * 230, z = (r() * 2 - 1) * 230;
      if (Math.abs(x) < LOT_X + 8 && Math.abs(z) < LOT_Z + 8) continue;
      if (Math.hypot(x - MC.x, z - MC.z) < MR + 12 || (x > 0 && distSeg(x, z, CA, CB) < 22)) continue;
      plant(x, z);
    }
    for (let tries = 0; n < N && tries < 6000; tries++) {
      const a = r() * Math.PI * 2, rr = MR * (0.55 + 0.5 * Math.sqrt(r())), x = MC.x + Math.cos(a) * rr, z = MC.z + Math.sin(a) * rr;
      const y = groundAt(x, z), gx = (groundAt(x + 1.5, z) - groundAt(x - 1.5, z)) / 3, gz = (groundAt(x, z + 1.5) - groundAt(x, z - 1.5)) / 3;
      if (y > 40 || Math.hypot(gx, gz) > 0.75 || distSeg(x, z, CA, CB) < 22 || nearRamp(x, z, 6)) continue;
      roadQuery(x, z); if (RQ.d < ROAD_HALF + ROAD_BANK + 3) continue;
      plant(x, z);
    }
    trunk.count = fol.count = fol2.count = n; this.treeCount = n;
    for (const m of [trunk, fol, fol2]) { m.castShadow = true; g.add(m); }
    const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.8, 0), new THREE.MeshStandardMaterial({ color: 0x8b877d, roughness: 0.95, flatShading: true }), 70);
    for (let i = 0; i < 70; i++) {
      let x, z;
      do { x = (r() * 2 - 1) * 200; z = (r() * 2 - 1) * 200; } while ((Math.abs(x) < LOT_X + 4 && Math.abs(z) < LOT_Z + 4) || Math.hypot(x - MC.x, z - MC.z) < MR + 10 || (x > 0 && distSeg(x, z, CA, CB) < 20));
      const s = 0.4 + r() * 1.4;
      dummy.position.set(x, groundAt(x, z) - 0.2 * s, z); dummy.rotation.set(r() * 3, r() * 3, r() * 3); dummy.scale.set(s, s * 0.7, s * (0.8 + r() * 0.5)); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
      this.obstacleColliders.push({ x, z, y: dummy.position.y, radius: 0.55 * s, height: 0.9 * s });
    }
    rocks.castShadow = true; g.add(rocks);

    this._buildFx(g);
    g.visible = false;
    this.scene.add(g);
    this.world = g;
  }

  // boost flames (twin jets at the rear), sparks, smoke / dust, and the rear flame light
  _buildFx(g) {
    const fx = this.fx = { jets: [], t: 0, accS: 0, accM: 0 };
    const group = fx.group = new THREE.Group(); group.name = 'BoostFlames'; group.matrixAutoUpdate = false; group.visible = false; group.frustumCulled = false;
    const ramp = stops => t => { for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const a = stops[i - 1], b = stops[i], k = (t - a[0]) / (b[0] - a[0]); return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]; } return [0, 0, 0]; };
    const specs = [
      { f: ramp([[0, 1, 0.55, 0.12], [0.35, 1, 0.38, 0.06], [0.7, 0.45, 0.28, 0.9], [1, 0, 0, 0]]), len: 3.0, rad: 0.2, op: 0.4 },     // outer: orange to blue tip
      { f: ramp([[0, 1, 0.85, 0.35], [0.5, 1, 0.55, 0.1], [1, 0, 0, 0]]), len: 2.0, rad: 0.14, op: 0.55 },                              // mid
      { f: ramp([[0, 1, 0.95, 0.8], [0.5, 1, 0.85, 0.45], [1, 0, 0, 0]]), len: 1.2, rad: 0.08, op: 0.75 },                                       // white-yellow core
    ];
    const gl = glowTex();
    const rear = this.bounds.min.z, ey = this.bounds.min.y + 0.35, jx = Math.min(0.58, (this.bounds.max.x - this.bounds.min.x) * 0.3);
    fx.nozzle = [new THREE.Vector3(jx, ey, rear + 0.05), new THREE.Vector3(-jx, ey, rear + 0.05)];
    for (const nz of fx.nozzle) {
      const jet = { cones: [], phase: Math.random() * 10 };
      for (const sp of specs) {
        const geo = new THREE.ConeGeometry(1, 1, 12, 6, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);   // base at origin, tip towards local -Z
        const p = geo.attributes.position, col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const c = sp.f(clamp(-p.getZ(i), 0, 1)); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: sp.op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false }));
        m.position.copy(nz); m.frustumCulled = false; m.renderOrder = 6; group.add(m); jet.cones.push({ m, sp });
      }
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: gl, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false }));
      sprite.position.set(nz.x, nz.y, nz.z - 0.25); sprite.renderOrder = 7; group.add(sprite); jet.sprite = sprite;
      fx.jets.push(jet);
    }
    g.add(group);
    fx.sparks = new Particles(110, true, gl); fx.smoke = new Particles(90, false, gl);
    g.add(fx.sparks.points, fx.smoke.points);
    fx.light = new THREE.PointLight(0xff7a2a, 0, 24, 2); fx.light.castShadow = false;
    g.add(fx.light);
  }

  enter() {
    this.buildWorld();
    if (!this.physics) this.physics = new VehiclePhysics(heightAt, this.wheels, this.obstacleColliders);
    this.world.visible = true;
    this.active = true;
    this.fov0 = this.camera.fov;
    this.reset();
    this.keys.clear(); this.physicalKeys.clear(); this.touch = {};
    this._place(0);
    this._snapCamera();
  }

  exit() {
    this.active = false;
    if (this.world) this.world.visible = false;
    this.keys.clear(); this.physicalKeys.clear(); this.touch = {};
    this.boosting = false; this.boostVis = 0; this.flame = 0; this.air = false;
    this.run = { state: 'idle', t: 0 };
    if (this.fx) this._fxHide();
    if (this.onToast) this.onToast(null);
    this.camera.fov = this.fov0; this.camera.updateProjectionMatrix();
    this.van.position.set(0, 0, 0);
    this.van.rotation.set(0, 0, 0);
    for (const w of this.wheels) if (w.node && w.baseQuat) w.node.quaternion.copy(w.baseQuat);
    this.controls.enabled = true;
  }

  _fxHide() {
    const fx = this.fx;
    fx.group.visible = false; fx.light.intensity = 0; fx.sparks.clear(); fx.smoke.clear(); fx.accS = fx.accM = 0;
  }

  cycleCamera() {
    this.camMode = { chase: 'driver', driver: 'orbit', orbit: 'chase' }[this.camMode];
    this.controls.enabled = this.camMode === 'orbit';
    if (this.camMode === 'orbit') {
      this.controls.target.set(this.x, 1.1, this.z);
      this.controls.update();
    }
    this._camInit = false; this._shk.set(0, 0, 0);
    return this.camMode;
  }

  _bindKeys() {
    const map = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'hand', ShiftLeft: 'boost', ShiftRight: 'boost' };
    this.keyMap = map;
    window.addEventListener('keydown', e => {
      if (!this.active) return;
      if (map[e.code]) { this.physicalKeys.add(e.code); e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { if (map[e.code]) this.physicalKeys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.physicalKeys.clear(); this.touch = {}; });
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

  input(k) { return this.keys.has(k) || [...this.physicalKeys].some(code => this.keyMap[code] === k) || (this.touch[k] || 0) > 0; }

  _capturePose() {
    return { position: this.van.position.clone(), quaternion: this.van.quaternion.clone(), wheels: this.wheels.map(w => w.node ? w.node.quaternion.clone() : null) };
  }

  _applyPose(pose) {
    this.van.position.copy(pose.position); this.van.quaternion.copy(pose.quaternion);
    this.wheels.forEach((w, i) => { if (w.node && pose.wheels[i]) w.node.quaternion.copy(pose.wheels[i]); });
  }

  // Simulate at a constant rate and interpolate the visible pose between steps.
  update(dt) {
    const step = 1 / 60, elapsed = Math.max(0, Math.min(dt, 0.25));
    if (!this._currentPose) this._previousPose = this._currentPose = this._capturePose();
    this._applyPose(this._currentPose);
    this._accumulator += elapsed;
    while (this._accumulator + 1e-10 >= step) {
      this._previousPose = this._currentPose;
      this._lastResult = this._step(step);
      this._currentPose = this._capturePose();
      this._accumulator -= step;
    }
    const alpha = clamp(this._accumulator / step, 0, 1);
    this.van.position.lerpVectors(this._previousPose.position, this._currentPose.position, alpha);
    this.van.quaternion.slerpQuaternions(this._previousPose.quaternion, this._currentPose.quaternion, alpha);
    this.wheels.forEach((w, i) => { if (w.node && this._previousPose.wheels[i] && this._currentPose.wheels[i]) w.node.quaternion.slerpQuaternions(this._previousPose.wheels[i], this._currentPose.wheels[i], alpha); });
    this._updateFx(elapsed);
    this._updateCamera(elapsed);
    return this._lastResult || { mph: 0, v: 0, braking: false, gear: 'N', boost: this.boost, boosting: false, air: false, timer: -1, runState: 'idle' };
  }

  _step(dt) {
    if (this.physics) return this._physicsStep(dt);
    const gas = this.input('gas') ? 1 : 0, brake = this.input('brake') ? 1 : 0, hand = this.input('hand');
    const steerIn = (this.input('left') ? 1 : 0) - (this.input('right') ? 1 : 0);
    // boost meter: ~4 s of full boost, ~6 s to refill; running dry locks it until the key is released
    const boostKey = this.input('boost');
    if (!boostKey) this.boostLock = false;
    this.boosting = boostKey && !this.boostLock && this.boost > 0;
    if (this.boosting) { this.boost = Math.max(0, this.boost - dt / 4); if (this.boost === 0) { this.boostLock = true; this.boosting = false; } }
    else this.boost = Math.min(1, this.boost + dt / 6);
    const boosting = this.boosting;
    // steering: ramp toward target, faster return to centre
    const rate = steerIn === 0 ? 5 : 2.6;
    this.steer += clamp(steerIn - this.steer, -rate * dt, rate * dt);
    const v = this.v;
    const maxSteer = 0.58 / (1 + (v * v) / 160);
    const delta = this.steer * maxSteer;
    let nv = v, yawRate;

    if (!this.air) {
      let a = 0;
      if (boosting) a += v < -0.2 ? 14 : 15 * (1 - clamp(v / 60, 0, 1));
      else if (gas) a += v < -0.2 ? 7 : 3.4 * (1 - clamp(v / 42, 0, 1));
      if (brake) a += v > 0.3 ? -8.5 : -2.6;
      if (hand) a += -Math.sign(v) * 6.5;
      a -= (boosting ? 0.0022 : 0.0042) * v * Math.abs(v) + 0.22 * Math.sign(v);
      a -= 9.81 * Math.sin(this.pitchGround || 0) * 0.85;
      nv = v + a * dt;
      if (brake && v > 0.3 && nv < 0) nv = 0;                // brake does not flip into reverse in one go
      if (hand && Math.sign(nv) !== Math.sign(v)) nv = 0;
      if (!gas && !brake && !boosting && Math.abs(nv) < 0.12) nv = 0;
      nv = clamp(nv, -6, 52);
      this.accel = (nv - v) / dt;
      yawRate = (nv / this.wheelbase) * Math.tan(delta);
      if (hand && Math.abs(nv) > 3) yawRate *= 1.45;
    } else {
      // airborne: no steering / throttle authority; boost jets still push a little, a touch of air drag
      if (boosting) nv += 4 * dt;
      nv *= 1 - 0.04 * dt;
      this.accel = 0;
      yawRate = this.yawRate * Math.exp(-1.5 * dt);
    }
    this.v = nv;
    this.yawRate = yawRate;
    this.heading += yawRate * dt;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.x = clamp(this.x + fx * nv * dt, WORLD_X0 + 20, WORLD_X1 - 20);
    this.z = clamp(this.z + fz * nv * dt, -WORLD_Z + 20, WORLD_Z - 20);
    this.dist += nv * dt;

    if (!this.air) {
      // suspension: spring-damped body pitch/roll from longitudinal / lateral acceleration
      const aLong = clamp(this.accel, -10, 10), aLat = clamp(nv * yawRate, -9, 9);
      const k = 70, c = 10;
      // +X rotation = nose down: braking (aLong < 0) dives, accelerating squats. Left turn rolls the left side up.
      const tp = -aLong * 0.0055, tr = aLat * 0.012;
      this.susPv += (k * (tp - this.susP) - c * this.susPv) * dt; this.susP += this.susPv * dt;
      this.susRv += (k * (tr - this.susR) - c * this.susRv) * dt; this.susR += this.susRv * dt;
      this.susYv += (110 * (0 - this.susY) - 9 * this.susYv) * dt; this.susY += this.susYv * dt;   // landing squash
    }

    this._place(delta, dt);
    this._updateRun(dt);
    this.boostVis += ((this.boosting ? 1 : 0) - this.boostVis) * (1 - Math.exp(-dt * (this.boosting ? 4 : 1.7)));
    return { mph: Math.abs(nv) * 2.23694, v: nv, braking: brake && nv > 0.3, gear: nv < -0.1 ? 'R' : (Math.abs(nv) < 0.1 && !gas && !boosting ? 'N' : 'D'), boost: this.boost, boosting: this.boosting, air: this.air, timer: this.run.state === 'idle' ? -1 : this.run.t, runState: this.run.state };
  }

  _physicsStep(dt) {
    const gas = this.input('gas'), brake = this.input('brake'), boostKey = this.input('boost');
    if (!boostKey) this.boostLock = false;
    this.boosting = boostKey && !this.boostLock && this.boost > 0;
    if (this.boosting) { this.boost = Math.max(0, this.boost - dt / 4); if (this.boost === 0) { this.boostLock = true; this.boosting = false; } }
    else this.boost = Math.min(1, this.boost + dt / 6);
    const r = this.physics.step({ gas, brake, boost: this.boosting, hand: this.input('hand'), left: this.input('left'), right: this.input('right') });
    this.v = r.speed; this.heading = r.heading;
    this.physics.applyVisual(this.van);
    this.x = this.van.position.x; this.z = this.van.position.z;
    this.dist += this.v * dt;
    for (const w of this.wheels) {
      if (!w.node) continue;
      this._q1.setFromAxisAngle(this._xAxis, this.dist / w.r);
      if (w.front) { this._q2.setFromAxisAngle(this._yAxis, this.physics.steer * 0.58 / (1 + this.v * this.v / 160)); this._q1.premultiply(this._q2); }
      w.node.quaternion.copy(this._q1).multiply(w.baseQuat);
    }
    if (!r.grounded) { this.air = true; this.airT += dt; this.airDist += Math.abs(this.v) * dt; }
    else if (this.air) {
      this.air = false;
      if (this.airT > 0.12) this.airCount++;
      this.lastAir = { t: this.airT, ft: Math.round(this.airDist * 3.28084) };
      this.maxAirT = Math.max(this.maxAirT, this.airT);
      if (this.airT > 0.5 && this.onToast) this.onToast(`AIR ${this.airT.toFixed(1)} s / ${this.lastAir.ft} ft`, 'air');
      this.airT = 0; this.airDist = 0;
    }
    this._updateRun(dt);
    this.boostVis += ((this.boosting ? 1 : 0) - this.boostVis) * (1 - Math.exp(-dt * (this.boosting ? 4 : 1.7)));
    return { mph: Math.abs(this.v) * 2.23694, v: this.v, braking: brake && this.v > 0.3, gear: this.v < -0.1 ? 'R' : (Math.abs(this.v) < 0.1 && !gas && !this.boosting ? 'N' : 'D'), boost: this.boost, boosting: this.boosting, air: this.air, timer: this.run.state === 'idle' ? -1 : this.run.t, runState: this.run.state };
  }

  _place(delta, dt = 0) {
    if (this.physics && dt === 0) { this.physics.reset(this.x, this.z, this.heading, this.v); this.physics.applyVisual(this.van); return; }
    const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
    // group contact heights by actual position (front/rear by z, +X side/-X side by x), not by name
    let hf = 0, hr = 0, hl = 0, hrt = 0, nf = 0, nr = 0, nl = 0, nrt = 0;
    const midZ0 = (this.frontZ + this.rearZ) / 2, hw = this._hw || (this._hw = [0, 0, 0, 0]);
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      // local (x,z) -> world, rotation about Y by heading
      const wx = this.x + w.x * ch + w.z * sh, wz = this.z - w.x * sh + w.z * ch;
      const h = heightAt(wx, wz);
      hw[i] = h;
      if (w.z > midZ0) { hf += h; nf++; } else { hr += h; nr++; }
      if (w.x > 0) { hl += h; nl++; } else { hrt += h; nrt++; }
    }
    hf /= nf || 1; hr /= nr || 1; hl /= nl || 1; hrt /= nrt || 1;
    const span = this.frontZ - this.rearZ || this.wheelbase;
    const pitch = Math.atan2(hf - hr, span);
    const roll = Math.atan2(hl - hrt, this.track);
    // height at the van origin from the plane through the axles
    const midZ = (this.frontZ + this.rearZ) / 2;
    const G = (hf + hr) / 2 - Math.tan(pitch) * midZ;
    let y, rx, rz;

    if (dt === 0) {                                          // (re)placement: sit on the ground
      this.air = false; this.pitchGround = pitch;
      this.gLast = G; this.vyG = 0; this.gT = 0;
    } else if (!this.air) {
      this.pitchGround = pitch;
      const rise = G - this.gLast;
      const snap = rise > Math.max(0.45, Math.abs(this.v) * dt * 0.9);    // sheer step up (ramp back / curb): treat as a bump, not a launch
      const vy = snap ? 0 : rise / dt;
      const aEff = (vy - this.vyG) / dt;
      const yb = this.gLast + this.vyG * dt - 0.5 * GRAV * dt * dt;
      if (this.gT > 0.12 && Math.abs(this.v) > 4 && !snap && aEff < -1.25 * GRAV && yb > G + 0.03) {
        // ground fell away faster than gravity pulls: take off, keep the vertical speed we had
        this.air = true; this.vy = clamp(this.vyG, -3, 22); this.yAir = yb;
        this.airRx = this._rx; this.airRz = this._rz; this.airRxV = 0; this.airT = 0; this.airDist = 0;
      } else { this.vyG = vy; this.gLast = G; this.gT += dt; }
    }

    if (this.air && dt > 0) {
      this.vy -= GRAV * dt; this.yAir += this.vy * dt;
      this.airT += dt; this.airDist += Math.abs(this.v) * dt;
      this.airRxV = Math.min(this.airRxV + 0.9 * dt, 0.32);                    // slowly nose down
      this.airRx = Math.min(this.airRx + this.airRxV * dt, 0.45);
      this.airRz *= Math.exp(-0.6 * dt);
      const above = this.yAir - G;
      if (above < 3.5 && this.vy < 0) {                                      // arcade assist: level out for the landing
        const k = 1 - Math.exp(-dt * 3.2 * (1 - above / 3.5));
        this.airRx += (-pitch - this.airRx) * k; this.airRz += (roll - this.airRz) * k;
      }
      let hit = false;
      for (let i = 0; i < this.wheels.length; i++) {
        const w = this.wheels[i];
        if (this.yAir - Math.sin(this.airRx) * w.z + Math.sin(this.airRz) * w.x <= hw[i] + 0.02) hit = true;
      }
      if (hit && this.vy <= 0) this._land(G, pitch, roll);
    }

    if (this.air) { y = this.yAir; rx = this.airRx; rz = this.airRz; }
    else { y = G + clamp(this.susY, -0.35, 0.3); rx = -pitch + this.susP; rz = roll + this.susR; }
    this._rx = rx; this._rz = rz;
    this.van.position.set(this.x, y, this.z);
    this.van.rotation.set(rx, this.heading, rz, 'YXZ');
    // wheels: steer fronts, spin all by distance / radius
    for (const w of this.wheels) {
      if (!w.node) continue;
      this._q1.setFromAxisAngle(this._xAxis, this.dist / w.r);
      if (w.front) { this._q2.setFromAxisAngle(this._yAxis, delta); this._q1.premultiply(this._q2); }
      w.node.quaternion.copy(this._q1).multiply(w.baseQuat);
    }
  }

  _land(G, pitch, roll) {
    const impact = -this.vy, t = this.airT;
    this.air = false;
    // continue smoothly from the airborne pose; the springs settle it
    this.susY = clamp(this.yAir - G, -0.45, 0.45); this.susYv = clamp(this.vy * 0.35, -4, 0);
    this.susP = clamp(this.airRx + pitch, -0.5, 0.5); this.susPv = 0; this.susR = clamp(this.airRz - roll, -0.4, 0.4); this.susRv = 0;
    this.gLast = G; this.vyG = 0; this.gT = 0; this.pitchGround = pitch;
    if (t > 0.12) this.airCount++;
    this.lastAir = { t, ft: Math.round(this.airDist * 3.28084), impact };
    this.maxAirT = Math.max(this.maxAirT, t);
    // dust puff at the wheels
    const fx = this.fx;
    if (fx && this.active && impact > 2) {
      const ch = Math.cos(this.heading), sh = Math.sin(this.heading), fog = this.scene.fog ? this.scene.fog.color : null, n = Math.min(5, 1 + (impact / 3 | 0));
      const cr = fog ? fog.r * 0.95 : 0.7, cg = fog ? fog.g * 0.9 : 0.65, cb = fog ? fog.b * 0.8 : 0.55;
      for (const w of this.wheels) for (let k = 0; k < n; k++) {
        const wx = this.x + w.x * ch + w.z * sh, wz = this.z - w.x * sh + w.z * ch, a = Math.random() * 6.283, sp = 1.5 + Math.random() * Math.min(5, impact * 0.5);
        fx.smoke.emit(wx, heightAt(wx, wz) + 0.2, wz, Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp, 0.8 + Math.random() * 0.7, 0.9, 3.2 + Math.random() * 1.5, 0.55, cr, cg, cb);
      }
    }
    if (t > 0.5 && this.onToast) this.onToast(`AIR ${t.toFixed(1)} s / ${this.lastAir.ft} ft`, 'air');
  }

  _updateRun(dt) {
    const run = this.run, d = Math.hypot(this.x - MC.x, this.z - MC.z);
    if (run.state === 'idle') { if (this.x > LOT_X + 4) { run.state = 'running'; run.t = 0; } }
    else {
      if (run.state === 'running') run.t += dt;
      if (this.x < LOT_X - 2 && Math.abs(this.z) < LOT_Z) { run.state = 'idle'; run.t = 0; }      // back in the lot: re-arm
      else if (run.state === 'running' && d < MS - 2 && this.van.position.y > MH - 2) {
        run.state = 'done';
        this.best = this.best ? Math.min(this.best, run.t) : run.t;
        const f = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
        if (this.onToast) this.onToast(`Summit! ${f(run.t)}` + (this.best < run.t - 0.05 ? `  (best ${f(this.best)})` : ''), 'summit');
      }
    }
  }

  _updateFx(dt) {
    const fx = this.fx; if (!fx) return;
    const on = this.boosting;
    this.flame += ((on ? 1 : 0) - this.flame) * (1 - Math.exp(-dt * (on ? 16 : 6)));
    fx.t += dt;
    const lvl = this.flame, night = this.scene.fog ? 1 - Math.min(1, (this.scene.fog.color.r + this.scene.fog.color.g + this.scene.fog.color.b) / 1.2) : 0;
    const dtP = dt;
    fx.sparks.update(dtP, 1.2, 9, false); fx.smoke.update(dtP, 1.4, -0.5, true);
    if (lvl < 0.03 && !on) { fx.group.visible = false; fx.light.intensity = 0; return; }
    fx.group.visible = true;
    fx.group.matrix.compose(this.van.position, this.van.quaternion, this.van.scale); fx.group.matrixWorldNeedsUpdate = true;
    for (let j = 0; j < fx.jets.length; j++) {
      const jet = fx.jets[j], ph = jet.phase;
      const fl = 0.8 + 0.25 * Math.sin(fx.t * 43 + ph) + 0.12 * Math.sin(fx.t * 71 + ph * 2) + 0.12 * Math.random();
      for (let i = 0; i < jet.cones.length; i++) {
        const { m, sp } = jet.cones[i], f = fl * (1 - i * 0.04 * Math.sin(fx.t * 90 + i));
        const wob = 0.85 + 0.3 * Math.random();
        m.scale.set(sp.rad * wob * (0.7 + 0.5 * lvl), sp.rad * wob * (0.7 + 0.5 * lvl), Math.max(0.01, sp.len * lvl * f));
        m.material.opacity = sp.op * (0.8 + 0.2 * Math.random());
      }
      const gs = (1.0 + 0.4 * Math.random()) * (0.4 + 0.6 * lvl); jet.sprite.scale.set(gs, gs, 1); jet.sprite.material.opacity = lvl * 0.8;
    }
    // light at the rear, flickering
    const lp = this._tmp.set(0, this.bounds.min.y + 0.6, this.bounds.min.z - 1.1).applyMatrix4(fx.group.matrix);
    fx.light.position.copy(lp);
    fx.light.intensity = lvl * (38 + 14 * Math.random()) * (1 + night * 0.5);
    fx.light.color.setHSL(0.07 + 0.02 * Math.random(), 1, 0.55);
    // sparks + smoke trail (world space; they stay behind as the van drives on)
    if (on) {
      const fwdx = Math.sin(this.heading), fwdz = Math.cos(this.heading), v = this.v;
      fx.accS += dt * 130; fx.accM += dt * 32;
      const fog = this.scene.fog ? this.scene.fog.color : null, sr = fog ? fog.r * 0.5 : 0.35, sg = fog ? fog.g * 0.5 : 0.35, sb = fog ? fog.b * 0.5 : 0.35;
      while (fx.accS >= 1) {
        fx.accS -= 1;
        const nz = fx.nozzle[Math.random() < 0.5 ? 0 : 1], p = this._tmp2.set(nz.x, nz.y, nz.z - 0.3 - Math.random() * 1.2).applyMatrix4(fx.group.matrix), back = 4 + Math.random() * 7, hot = Math.random();
        fx.sparks.emit(p.x, p.y, p.z, fwdx * (v * 0.35 - back) + (Math.random() - 0.5) * 2.4, 0.4 + Math.random() * 2.2, fwdz * (v * 0.35 - back) + (Math.random() - 0.5) * 2.4, 0.3 + Math.random() * 0.45, 0.16 + Math.random() * 0.12, 0.05, 1, 1, 0.45 + 0.4 * hot, 0.1 + 0.3 * hot * hot);
      }
      while (fx.accM >= 1) {
        fx.accM -= 1;
        const nz = fx.nozzle[Math.random() < 0.5 ? 0 : 1], p = this._tmp2.set(nz.x, nz.y + 0.05, nz.z - 0.8 - Math.random() * 0.8).applyMatrix4(fx.group.matrix);
        fx.smoke.emit(p.x, p.y, p.z, fwdx * v * 0.12 + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.7, fwdz * v * 0.12 + (Math.random() - 0.5) * 0.8, 0.9 + Math.random() * 0.7, 0.5, 2.2 + Math.random(), 0.28, sr, sg, sb);
      }
    }
    // point-sprite scale from the camera / viewport
    const h = this.renderer ? this.renderer.domElement.height : 900, sc = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    fx.sparks.mat.uniforms.uScale.value = fx.smoke.mat.uniforms.uScale.value = sc;
  }

  _snapCamera() { this._camInit = false; this._updateCamera(1); }

  _updateCamera(dt) {
    const cam = this.camera, bv = this.boostVis, eb = bv * bv * (3 - 2 * bv);
    const fov = (this.camMode === 'driver' ? 62 : 50) + 22 * eb;
    if (Math.abs(cam.fov - fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const p = this.van.position;
    cam.position.sub(this._shk);
    if (this.camMode === 'chase') {
      const back = 7.2 + Math.max(0, this.v) * 0.06 + 2.6 * eb;
      const des = new THREE.Vector3(p.x - fx * back, p.y + 2.7 + 0.4 * eb, p.z - fz * back);
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
    // boost shake (not in orbit mode, where OrbitControls owns the camera)
    if (this.camMode !== 'orbit' && eb > 0.02) { const a = 0.07 * eb; this._shk.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a); cam.position.add(this._shk); }
    else this._shk.set(0, 0, 0);
    this._camInit = true;
  }
}

