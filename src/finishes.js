// Material registry + finish application (paint, wood, upholstery, floor, lights).
import * as THREE from 'three';
import { WOODS, PAINT_FINISHES, DOOR_COLORS, UPHOLSTERY, SEAT_COLORS, FLOORS } from './config.js';
import { woodTexture, plyEdgeTexture, fabricTexture, stripeTexture, floorTexture } from './textures.js';

const WOOD_TILE = 0.6;   // metres per wood texture tile
const EDGE_TILE = 0.1;   // metres per ply-edge tile
const FLOOR_TILE = 1.2;  // metres per floor tile

// Match a Blender material name, allowing ".001" style suffixes.
const fam = (base) => new RegExp('^' + base + '(\\.\\d+)?$');
const FAMILY = {
  paint: fam('VW_Paint'),
  glass: fam('VW_Glass'),
  glassTint: fam('VW_GlassTint'),
  tail: fam('VW_TailLens'),
  amber: /^VW_AmberLens/,
  clear: /^VW_LensClear/,
  bulb: fam('VW_BulbGlass'),
  reflector: fam('VW_Reflector'),
  popGel: fam('VW_PopTopGel'),
  veneer: fam('BO_BirchPly_Veneer'),
  edgeX: fam('BO_BirchPly_Edge_X'),
  edgeY: fam('BO_BirchPly_Edge_Y'),
  edgeZ: fam('BO_BirchPly_Edge_Z'),
  oak: fam('BO_Oak_Solid'),
  doorPaint: fam('BO_Paint_ForestGreen'),
  floor: fam('BO_Vinyl_Plank'),
  charcoal: fam('BO_Wool_Charcoal'),
  mustard: fam('BO_Wool_Mustard'),
  rust: fam('BO_Wool_Rust'),
  linen: fam('BO_Linen_Cream'),
  duvet: fam('BO_Duvet_Oat'),
  stripe: fam('BO_Blanket_Stripe'),
  felt: fam('BO_Felt_Wall'),
  velour: fam('VW_Velour'),
  ledWarm: fam('BO_LED_Warm'),
  ledEmit: fam('BO_LED_Emit'),
};

// Ply-edge stripe direction per edge material (layers stacked along this UV axis).
const EDGE_DIR = { edgeX: 'v', edgeY: 'v', edgeZ: 'v' };

export class Finishes {
  constructor(root, manifest, clipPlanes) {
    this.root = root;
    this.manifest = manifest || {};
    this.clipPlanes = clipPlanes;
    this.byFamily = {};          // family -> Set<Material>
    this.missing = [];
    this.textures = {};          // slot -> [Texture] (disposed when replaced)
    this.frontLens = new Set();  // cloned lens materials on the front half (headlights)
    this.rearClear = new Set();  // clear lenses on rear (reverse lights) - stay dim
    this.ghost = new THREE.MeshStandardMaterial({ name: 'XRay_Ghost', color: 0xcfe0ea, roughness: 0.3, metalness: 0, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
    this.ghost.clippingPlanes = clipPlanes;
    this.xrayOn = false;
    this._setup();
  }

  _matInfo(name) {
    const list = this.manifest.materials;
    if (!Array.isArray(list)) return null;
    return list.find(m => m && m.name === name) || null;
  }

  _setup() {
    const all = new Map();
    const meshes = [];
    this.root.traverse(o => {
      if (!o.isMesh) return;
      meshes.push(o);
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) if (m) all.set(m.uuid, m);
    });
    this.meshes = meshes;

    // 1. Paint -> one shared MeshPhysicalMaterial with clearcoat
    const paintSrc = [...all.values()].find(m => FAMILY.paint.test(m.name));
    if (paintSrc) {
      const p = new THREE.MeshPhysicalMaterial({ name: 'VW_Paint', color: paintSrc.color.clone(), metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
      this.paint = p;
      this._replace(m => FAMILY.paint.test(m.name), p);
    } else {
      this.paint = null;
    }

    // 2. Front/rear split of clear lens + bulb + reflector materials so headlights glow but reverse lights do not
    const box = new THREE.Box3(), c = new THREE.Vector3();
    const clones = new Map();
    for (const mesh of meshes) {
      const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      let changed = false;
      const out = arr.map(m => {
        if (!m || !(FAMILY.clear.test(m.name) || FAMILY.bulb.test(m.name) || FAMILY.reflector.test(m.name))) return m;
        box.setFromObject(mesh).getCenter(c);
        const front = c.z > 0;
        const key = m.uuid + (front ? 'F' : 'R');
        if (!clones.has(key)) {
          const cl = m.clone();
          cl.name = m.name;
          clones.set(key, cl);
          (front ? this.frontLens : this.rearClear).add(cl);
        }
        changed = true;
        return clones.get(key);
      });
      if (changed) mesh.material = Array.isArray(mesh.material) ? out : out[0];
    }

    // Recollect after replacement
    const final = new Map();
    for (const o of meshes) {
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) if (m) final.set(m.uuid, m);
      o.castShadow = true;
      o.receiveShadow = true;
    }
    for (const m of final.values()) {
      m.clippingPlanes = this.clipPlanes;
      for (const [k, re] of Object.entries(FAMILY)) {
        if (re.test(m.name)) (this.byFamily[k] ||= new Set()).add(m);
      }
    }
    this.materials = final;
    for (const k of Object.keys(FAMILY)) if (!this.byFamily[k]) this.missing.push(k);
    if (this.missing.length) console.info('[finishes] material families not found in model:', this.missing.join(', '));

    // 3. Glass
    for (const m of this.get('glass')) this._glass(m, this._alpha(m, 0.22), false);
    for (const m of this.get('glassTint')) this._glass(m, this._alpha(m, 0.88), true);
    for (const k of ['tail', 'amber', 'clear', 'bulb', 'reflector']) for (const m of this.get(k)) {
      if (m.opacity < 1 || m.transparent) { m.transparent = true; m.depthWrite = false; }
      m.emissive = m.emissive || new THREE.Color();
    }
    for (const k of ['ledWarm', 'ledEmit']) for (const m of this.get(k)) {
      m.emissive = new THREE.Color(0xffc98a);
      m.emissiveIntensity = 0.6;
    }
    for (const m of this.get('popGel')) { m.roughness = Math.min(m.roughness ?? 0.5, 0.45); }

    // mesh UV sanity for textured families
    const texFam = ['veneer', 'oak', 'edgeX', 'edgeY', 'edgeZ', 'floor', 'charcoal', 'mustard', 'rust', 'linen', 'duvet', 'stripe', 'felt', 'velour', 'doorPaint'];
    const texMats = new Set(texFam.flatMap(k => [...this.get(k)]));
    const noUV = new Set();
    for (const o of meshes) {
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      if (!o.geometry.attributes.uv && arr.some(m => texMats.has(m))) arr.forEach(m => texMats.has(m) && noUV.add(m.name));
    }
    this.noUV = noUV;
    if (noUV.size) console.info('[finishes] meshes without UVs use textured materials (textures will look flat):', [...noUV].join(', '));
  }

  _alpha(m, def) {
    const info = this._matInfo(m.name);
    const a = info && typeof info.alpha === 'number' && info.alpha < 1 ? info.alpha : (m.opacity < 1 ? m.opacity : def);
    return a;
  }
  _glass(m, alpha, tint) {
    m.transparent = true;
    m.opacity = alpha;
    m.depthWrite = false;
    m.roughness = 0.04;
    m.metalness = 0;
    if (tint) m.color.multiplyScalar(0.6);
    m.envMapIntensity = 1.4;
  }

  _replace(pred, mat) {
    this.root.traverse(o => {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) o.material = o.material.map(m => (m && pred(m) ? mat : m));
      else if (o.material && pred(o.material)) o.material = mat;
    });
  }

  get(fam) { return this.byFamily[fam] || new Set(); }

  _swapTex(slot, texs) {
    for (const t of this.textures[slot] || []) t.dispose();
    this.textures[slot] = texs;
  }

  // ---------- paint ----------
  setPaint(hex, finish) {
    if (!this.paint) return;
    const f = PAINT_FINISHES[finish] || PAINT_FINISHES.metallic;
    this.paint.color.set(hex);
    this.paint.metalness = f.metalness;
    this.paint.roughness = f.roughness;
    this.paint.clearcoat = f.clearcoat;
    this.paint.clearcoatRoughness = f.clearcoatRoughness;
  }

  // ---------- wood ----------
  setWood(id) {
    const w = WOODS.find(x => x.id === id) || WOODS[0];
    this.wood = w;
    const { map, bumpMap } = woodTexture(w, 512, 1);
    map.repeat.set(1 / WOOD_TILE, 1 / WOOD_TILE);
    bumpMap.repeat.copy(map.repeat);
    // solid trim gets a second seed so it does not look identical
    const solid = woodTexture(w, 256, 4);
    solid.map.repeat.set(1 / 0.35, 1 / 0.35); solid.bumpMap.repeat.copy(solid.map.repeat);
    this._swapTex('wood', [map, bumpMap, solid.map, solid.bumpMap]);
    for (const m of this.get('veneer')) this._applyTex(m, map, bumpMap, w.rough, 0.6);
    for (const m of this.get('oak')) this._applyTex(m, solid.map, solid.bumpMap, w.rough - 0.05, 0.6);

    const edges = [];
    for (const k of ['edgeX', 'edgeY', 'edgeZ']) {
      const set = this.get(k);
      if (!set.size) continue;
      const t = w.ply ? plyEdgeTexture(w.edge, EDGE_DIR[k]) : null;
      if (t) { t.repeat.set(1 / EDGE_TILE, 1 / EDGE_TILE); edges.push(t); }
      for (const m of set) {
        if (t) this._applyTex(m, t, null, 0.7, 0);
        else { this._clearTex(m); m.color.set(w.edge[0]); m.roughness = w.rough; }
      }
    }
    this._swapTex('edge', edges);
    if (this.doorId === 'wood') this.setDoor('wood');
  }

  _applyTex(m, map, bump, rough, bumpScale) {
    m.map = map;
    m.color.set(0xffffff);
    if (bump && 'bumpMap' in m) { m.bumpMap = bump; m.bumpScale = bumpScale; } else if ('bumpMap' in m) m.bumpMap = null;
    if (rough !== undefined) m.roughness = rough;
    m.metalness = 0;
    m.needsUpdate = true;
  }
  _clearTex(m) {
    if (m.map || m.bumpMap) { m.map = null; if ('bumpMap' in m) m.bumpMap = null; m.needsUpdate = true; }
  }

  // ---------- cabinet doors ----------
  setDoor(id, hex) {
    this.doorId = id;
    const set = this.get('doorPaint');
    if (id === 'wood') {
      const t = this.textures.wood;
      for (const m of set) {
        if (t) this._applyTex(m, t[0], t[1], this.wood ? this.wood.rough : 0.6, 0.6);
      }
      return;
    }
    const c = hex || (DOOR_COLORS.find(d => d.id === id) || DOOR_COLORS[0]).hex;
    for (const m of set) { this._clearTex(m); m.color.set(c); m.roughness = 0.55; m.metalness = 0; }
  }

  // ---------- upholstery ----------
  setUpholstery(id) {
    const p = UPHOLSTERY.find(x => x.id === id) || UPHOLSTERY[0];
    this.uph = p;
    const fab = fabricTexture();
    const rep = 1 / fab.tile;
    if (!this._fabRepeated) { fab.map.repeat.set(rep, rep); fab.bumpMap.repeat.set(rep, rep); this._fabRepeated = true; }
    const roles = { charcoal: p.charcoal, mustard: p.mustard, rust: p.rust, linen: p.linen, duvet: p.duvet, felt: p.felt };
    for (const [k, hex] of Object.entries(roles)) for (const m of this.get(k)) {
      m.map = fab.map; m.bumpMap = fab.bumpMap; m.bumpScale = 0.8; m.color.set(hex); m.roughness = 0.95; m.metalness = 0; m.needsUpdate = true;
      if ('sheen' in m) m.sheen = 0;
    }
    if (this.get('stripe').size) {
      const st = stripeTexture(p.stripe);
      st.repeat.set(1 / 0.5, 1 / 0.5);
      this._swapTex('stripe', [st]);
      for (const m of this.get('stripe')) { m.map = st; m.bumpMap = fab.bumpMap; m.bumpScale = 0.6; m.color.set(0xffffff); m.roughness = 0.95; m.metalness = 0; m.needsUpdate = true; }
    }
    if (this.seatId === 'match') this.setSeat('match');
  }

  setSeat(id, hex) {
    this.seatId = id;
    const fab = fabricTexture();
    let c = hex || (SEAT_COLORS.find(s => s.id === id) || SEAT_COLORS[0]).hex;
    if (id === 'match') c = (this.uph || UPHOLSTERY[0]).charcoal;
    for (const m of this.get('velour')) {
      m.map = fab.map; m.bumpMap = fab.bumpMap; m.bumpScale = 0.5; m.color.set(c); m.roughness = 0.92; m.metalness = 0; m.needsUpdate = true;
    }
  }

  // ---------- floor ----------
  setFloor(id) {
    const f = FLOORS.find(x => x.id === id) || FLOORS[0];
    const t = floorTexture(f);
    t.repeat.set(1 / FLOOR_TILE, 1 / FLOOR_TILE);
    this._swapTex('floor', [t]);
    for (const m of this.get('floor')) this._applyTex(m, t, null, f.kind === 'checker' ? 0.35 : 0.5, 0);
  }

  // ---------- lights (emissive) ----------
  // head: 0..1 headlights on, brake: 0..1, cabin: 0..1 LED level, night: 0..1
  setLights({ head = 0, brake = 0, cabin = 0, night = 0 }) {
    for (const m of this.frontLens) {
      m.emissive.set(0xfff1d6);
      // transparent lenses need more emissive to read as lit (blending scales it by opacity)
      m.emissiveIntensity = head * (FAMILY.bulb.test(m.name) ? 6 : 2.2) / Math.max(m.transparent ? m.opacity : 1, 0.2);
    }
    for (const m of this.rearClear) { m.emissive.set(0x000000); m.emissiveIntensity = 0; }
    for (const m of this.get('tail')) {
      m.emissive.set(0xff1a0a);
      m.emissiveIntensity = Math.max(head * 1.2, brake * 3.5) / Math.max(m.transparent ? m.opacity : 1, 0.3);
    }
    for (const m of this.get('amber')) { m.emissive.set(0xff8a00); m.emissiveIntensity = head * 0.25; }
    const led = cabin * (0.8 + 3.2 * night);
    for (const k of ['ledWarm', 'ledEmit']) for (const m of this.get(k)) { m.emissiveIntensity = led; }
  }

  // ---------- x-ray ----------
  setXRay(on, roots) {
    if (on === this.xrayOn) return;
    this.xrayOn = on;
    const glassy = m => m && (FAMILY.glass.test(m.name) || FAMILY.glassTint.test(m.name));
    for (const r of roots) {
      if (!r) continue;
      r.traverse(o => {
        if (!o.isMesh) return;
        if (on) {
          o.userData._origMat = o.material;
          o.material = Array.isArray(o.material) ? o.material.map(m => (glassy(m) ? m : this.ghost)) : (glassy(o.material) ? o.material : this.ghost);
          o.userData._origCast = o.castShadow;
          o.castShadow = false;
        } else if (o.userData._origMat) {
          o.material = o.userData._origMat;
          o.castShadow = o.userData._origCast ?? true;
          delete o.userData._origMat;
        }
      });
    }
  }
}
