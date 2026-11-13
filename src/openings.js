// Doors, tailgate, slider and pop-top: eased open/close animation + procedural pop-top tent.
import * as THREE from 'three';
import { PIVOT_DEFAULTS } from './config.js';
import { tentTexture } from './textures.js';

// Find a node by its contract name, tolerating Blender duplicate suffixes (".001" -> "001" after
// GLTFLoader sanitising). Exact matches win.
export function findNode(root, name) {
  const exact = root.getObjectByName(name);
  if (exact) return exact;
  const re = new RegExp('^' + name + '\\.?\\d{3}$');
  let hit = null;
  root.traverse(o => { if (!hit && re.test(o.name)) hit = o; });
  if (hit) console.info(`[viewer] node "${name}" matched as "${hit.name}"`);
  return hit;
}

const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = t => Math.max(0, Math.min(1, t));
const DUR = { Door_L_Pivot: 1.1, Door_R_Pivot: 1.1, Slider_Pivot: 1.7, Tailgate_Pivot: 1.5, PopTop_Pivot: 2.2 };

export class Openings {
  constructor(van, manifest, clipPlanes) {
    this.van = van;
    this.pivots = new Map();
    this.clipPlanes = clipPlanes;
    const mp = Array.isArray(manifest && manifest.pivots) ? manifest.pivots : [];
    van.updateMatrixWorld(true);
    for (const [name, def] of Object.entries(PIVOT_DEFAULTS)) {
      const node = findNode(van, name);
      if (!node) { console.warn(`[openings] pivot node "${name}" not found: ${def.label} disabled`); continue; }
      const m = mp.find(p => p && p.name === name) || {};
      const cfg = { ...def };
      const vec3ok = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
      if (m.type === 'hinge' || m.type === 'slide') cfg.type = m.type;
      if (vec3ok(m.axis)) cfg.axis = m.axis;
      if (Number.isFinite(m.open)) cfg.open = m.open;
      if (vec3ok(m.out)) cfg.out = m.out;
      if (Number.isFinite(m.out_dist)) cfg.out_dist = m.out_dist;
      if (!mp.length || !m.name) console.info(`[openings] using fallback motion for ${name}`);
      const axis = new THREE.Vector3(...cfg.axis).normalize();
      this.pivots.set(name, {
        name, node, cfg, label: def.label, axis,
        out: cfg.out ? new THREE.Vector3(...cfg.out).normalize() : null,
        basePos: node.position.clone(), baseQuat: node.quaternion.clone(),
        t: 0, target: 0,
      });
    }
    this._q = new THREE.Quaternion();
    if (this.pivots.has('PopTop_Pivot')) this._buildTent(this.pivots.get('PopTop_Pivot'));
  }

  has(name) { return this.pivots.has(name); }
  isOpen(name) { const p = this.pivots.get(name); return !!p && p.target === 1; }
  anyOpen() { for (const p of this.pivots.values()) if (p.target === 1 || p.t > 0) return true; return false; }
  toggle(name) { const p = this.pivots.get(name); if (p) p.target = p.target ? 0 : 1; return p ? p.target === 1 : false; }
  set(name, open) { const p = this.pivots.get(name); if (p) p.target = open ? 1 : 0; }
  openAll() { for (const p of this.pivots.values()) p.target = 1; }
  closeAll(immediate = false) {
    for (const p of this.pivots.values()) { p.target = 0; if (immediate) { p.t = 0; this._apply(p); } }
  }

  // Which pivot (if any) does this object belong to?
  pivotOf(obj) {
    for (let o = obj; o && o !== this.van; o = o.parent) {
      for (const p of this.pivots.values()) if (p.node === o) return p.name;
      if (o === this.tent) return 'PopTop_Pivot';
    }
    return null;
  }

  // Advance animations. Returns true while anything moves.
  update(dt) {
    let moving = false;
    for (const p of this.pivots.values()) {
      if (p.t === p.target) continue;
      const step = dt / (DUR[p.name] || 1.3);
      p.t = p.target > p.t ? Math.min(p.target, p.t + step) : Math.max(p.target, p.t - step);
      this._apply(p);
      moving = true;
    }
    return moving;
  }

  _apply(p) {
    const { node, cfg } = p;
    if (cfg.type === 'slide') {
      // phase 1: pop outward, phase 2: run back along the track
      const a = ease(clamp01(p.t / 0.3));
      const b = ease(clamp01((p.t - 0.22) / 0.78));
      node.position.copy(p.basePos);
      if (p.out) node.position.addScaledVector(p.out, (cfg.out_dist || 0.12) * a);
      node.position.addScaledVector(p.axis, cfg.open * b);
    } else {
      const e = ease(p.t);
      this._q.setFromAxisAngle(p.axis, cfg.open * e);
      node.quaternion.copy(this._q).multiply(p.baseQuat);
      if (p.name === 'PopTop_Pivot') this._updateTent(cfg.open * e);
    }
  }

  // ---------- pop-top tent ----------
  _buildTent(p) {
    const node = p.node;
    // bounding box of the lid in the pivot's local frame (closed state)
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const box = new THREE.Box3(), tmp = new THREE.Box3(), m = new THREE.Matrix4();
    node.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      m.multiplyMatrices(inv, o.matrixWorld);
      tmp.copy(o.geometry.boundingBox).applyMatrix4(m);
      box.union(tmp);
    });
    if (box.isEmpty()) { console.warn('[openings] pop-top lid has no geometry: tent skipped'); return; }
    const size = box.getSize(new THREE.Vector3());
    // inset so the fabric sits just inside the lid skirt
    const inset = Math.min(0.06, Math.min(size.x, size.z) * 0.03);
    const x0 = box.min.x + inset, x1 = box.max.x - inset, z0 = box.min.z + inset, z1 = box.max.z - inset;
    const y = box.min.y;
    this._tentLocalAxis = p.axis.clone().applyQuaternion(p.baseQuat.clone().invert());

    // perimeter, starting rear-left (+X is the van's left), counter-clockwise seen from above
    const side = z1 - z0, width = x1 - x0, per = 2 * side + 2 * width;
    const corners = [[x1, z0], [x1, z1], [x0, z1], [x0, z0], [x1, z0]];
    const segs = [10, 5, 10, 5];
    const inward = [[-1, 0], [0, -1], [1, 0], [0, 1]];
    const ranges = [];
    const ring = []; // {x,z,u,nx,nz}
    let acc = 0;
    for (let s = 0; s < 4; s++) {
      const [ax, az] = corners[s], [bx, bz] = corners[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      ranges.push([acc / per, (acc + len) / per]);
      for (let i = 0; i < segs[s]; i++) {
        const f = i / segs[s];
        ring.push({ x: ax + (bx - ax) * f, z: az + (bz - az) * f, u: (acc + len * f) / per, nx: inward[s][0], nz: inward[s][1], edge: i === 0 });
      }
      acc += len;
    }
    ring.push({ ...ring[0], u: 1 });
    const NV = 6;
    const nU = ring.length;
    const pos = new Float32Array(nU * (NV + 1) * 3), uv = new Float32Array(nU * (NV + 1) * 2);
    const idx = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i < nU; i++) {
      const k = j * nU + i;
      uv[k * 2] = ring[i].u; uv[k * 2 + 1] = j / NV;
      if (j < NV && i < nU - 1) { const a = k, b = k + 1, c = k + nU, d = k + nU + 1; idx.push(a, c, b, b, c, d); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const tex = tentTexture(ranges);
    const mat = new THREE.MeshStandardMaterial({ name: 'Tent_Canvas', map: tex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, emissive: new THREE.Color(0xffb46a), emissiveMap: tex, emissiveIntensity: 0 });
    mat.clippingPlanes = this.clipPlanes;
    const tent = new THREE.Mesh(geo, mat);
    tent.name = 'PopTop_Tent';
    tent.position.copy(p.basePos);
    tent.quaternion.copy(p.baseQuat);
    tent.visible = false;
    tent.castShadow = true;
    tent.receiveShadow = true;
    tent.frustumCulled = false;
    node.parent.add(tent);
    this.tent = tent;
    this._tent = { ring, NV, nU, y, bottom: y - 0.04, top: y + 0.015, sag: 0.05 };
    this.tentMaterial = mat;
  }

  _updateTent(angle) {
    if (!this.tent) return;
    const T = this._tent;
    const show = Math.abs(angle) > 0.01;
    this.tent.visible = show;
    if (!show) return;
    const pos = this.tent.geometry.attributes.position.array;
    const q = new THREE.Quaternion().setFromAxisAngle(this._tentLocalAxis, angle);
    const v = new THREE.Vector3();
    let maxH = 0.001;
    const tops = T.ring.map(r => { v.set(r.x, T.top, r.z).applyQuaternion(q); maxH = Math.max(maxH, v.y - T.bottom); return v.clone(); });
    for (let j = 0; j <= T.NV; j++) {
      const f = j / T.NV;
      for (let i = 0; i < T.nU; i++) {
        const r = T.ring[i], t = tops[i];
        const h = t.y - T.bottom;
        // inward sag (fabric bellows), strongest mid-height, proportional to local height
        const s = T.sag * Math.sin(Math.PI * f) * (h / maxH) * (r.edge ? 0.3 : 1);
        const k = (j * T.nU + i) * 3;
        pos[k] = r.x + (t.x - r.x) * f + r.nx * s;
        pos[k + 1] = T.bottom + (t.y - T.bottom) * f;
        pos[k + 2] = r.z + (t.z - r.z) * f + r.nz * s;
      }
    }
    this.tent.geometry.attributes.position.needsUpdate = true;
    this.tent.geometry.computeVertexNormals();
    this.tent.geometry.computeBoundingSphere();
  }

  setTentGlow(v) { if (this.tentMaterial) this.tentMaterial.emissiveIntensity = v; }
}
