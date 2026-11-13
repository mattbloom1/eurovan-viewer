// Procedural, tileable textures generated with canvas 2D at runtime.
import * as THREE from 'three';

// ---------- periodic value noise ----------
function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
const fade = t => t * t * (3 - 2 * t);
// noise in [0,1], wraps every px (x) and py (y) lattice units
function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fade(x - xi), yf = fade(y - yi);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
// fbm over unit square [0,1)^2, tileable; fx/fy = base lattice frequency (ints)
function fbm(u, v, fx, fy, oct, seed) {
  let s = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * fx, v * fy, fx, fy, seed + o * 17);
    norm += amp; amp *= 0.5; fx *= 2; fy *= 2;
  }
  return s / norm;
}

export function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255]; // sRGB components (Color stores what we give it with no conversion here)
}
function srgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a, b, t) => a + (b - a) * t;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTexture(c, { srgbSpace = true, repeat = 1, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgbSpace ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = Math.max(1, Math.min(8, n)); }

// ---------- wood veneer ----------
// Grain runs along U (canvas x). One texture tile = `tile` metres.
export function woodTexture(w, size = 512, seed = 1) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const A = srgb(w.base), B = srgb(w.dark);
  const bump = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      // warped stripes across v -> grain lines along u
      const warp = fbm(u, v, 2, 3, 3, seed) - 0.5;
      const fine = fbm(u, v, 3, 48, 2, seed + 5);
      let g = v * w.lines + warp * w.warp * 6 + (fine - 0.5) * 0.35;
      g = g - Math.floor(g);
      // asymmetric ring profile: sharp latewood line then soft earlywood
      let line = Math.pow(Math.max(0, 1 - Math.abs(g - 0.5) * 2.2), 3.0);
      line += 0.35 * Math.pow(fine, 3);
      // long streaks
      const streak = fbm(u, v, 1, 24, 3, seed + 9);
      let t = line * w.contrast + (streak - 0.5) * w.contrast * 0.6;
      if (w.fleck) { // oak medullary rays: small elongated flecks
        const f = vnoise(u * 40, v * 160, 40, 160, seed + 3);
        if (f > 0.86) t -= (f - 0.86) * 2.5 * w.contrast;
      }
      if (w.nodes) { // bamboo node bands across the grain
        const nb = (u * 4) % 1;
        const n = Math.exp(-Math.pow((nb - 0.5) * 40, 2));
        t += n * 0.5;
      }
      const tone = (fbm(u, v, 1, 2, 2, seed + 11) - 0.5) * 0.18;
      t = Math.min(1, Math.max(-0.4, t + tone));
      const i = (y * size + x) * 4;
      d[i] = mix(A[0], B[0], t); d[i + 1] = mix(A[1], B[1], t); d[i + 2] = mix(A[2], B[2], t); d[i + 3] = 255;
      bump[y * size + x] = 200 - line * 120;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(c, { aniso: maxAniso });
  // bump map (greyscale) from the grain lines
  const bc = canvas(size, size), bctx = bc.getContext('2d');
  const bi = bctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { bi.data[i * 4] = bi.data[i * 4 + 1] = bi.data[i * 4 + 2] = bump[i]; bi.data[i * 4 + 3] = 255; }
  bctx.putImageData(bi, 0, 0);
  const bumpMap = toTexture(bc, { srgbSpace: false, aniso: maxAniso });
  return { map, bumpMap };
}

// ---------- plywood edge: thin alternating veneers ----------
// Layers stacked along `dir` ('u' or 'v'); ~1.5 mm per layer when tile = 0.1 m.
export function plyEdgeTexture(colors, dir = 'v', size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const [L, Dk] = [srgb(colors[0]), srgb(colors[1])];
  const img = ctx.createImageData(size, size), d = img.data;
  const layers = 64; // per 0.1 m tile -> 1.56 mm
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const a = dir === 'v' ? v : u, b = dir === 'v' ? u : v;
    const k = Math.floor(a * layers);
    const f = a * layers - k;
    const glue = f < 0.12 ? 0.85 : 0; // thin dark glue line
    const alt = (k % 2) * 0.25;
    const n = (fbm(dir === 'v' ? b : a, dir === 'v' ? a : b, 4, 4, 2, 7) - 0.5) * 0.2;
    const t = Math.min(1, glue + alt + n);
    const i = (y * size + x) * 4;
    d[i] = mix(L[0], Dk[0], t); d[i + 1] = mix(L[1], Dk[1], t); d[i + 2] = mix(L[2], Dk[2], t); d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { aniso: maxAniso });
}

// ---------- woven fabric (greyscale; tinted by material colour) ----------
let fabricCache = null;
export function fabricTexture() {
  if (fabricCache) return fabricCache;
  const size = 256, c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const th = 8; // thread width px
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = Math.floor(x / th), j = Math.floor(y / th);
    const over = (i + j) % 2 === 0; // plain weave: warp over / weft over
    const fx = (x % th) / th, fy = (y % th) / th;
    const prof = over ? Math.sin(fx * Math.PI) : Math.sin(fy * Math.PI);
    const fibre = fbm(x / size, y / size, over ? 64 : 8, over ? 8 : 64, 2, over ? 3 : 4);
    const slub = fbm(x / size, y / size, over ? 2 : 16, over ? 16 : 2, 2, 21);
    let g = 0.70 + 0.22 * prof + 0.12 * (fibre - 0.5) + 0.1 * (slub - 0.5);
    g = Math.max(0, Math.min(1, g)) * 255;
    const k = (y * size + x) * 4;
    d[k] = d[k + 1] = d[k + 2] = g; d[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const map = toTexture(c, { aniso: maxAniso });
  const bumpMap = toTexture(c, { srgbSpace: false, aniso: maxAniso });
  fabricCache = { map, bumpMap, tile: 0.06 }; // 6 cm per tile -> ~2.3 mm threads
  return fabricCache;
}

// ---------- striped blanket ----------
export function stripeTexture(cols, size = 256) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  // stripe widths (fractions of tile) - a "camp blanket" pattern, symmetric for tiling
  const bands = [[0, 0.30], [1, 0.06], [0, 0.03], [2, 0.12], [0, 0.03], [3, 0.04], [0, 0.03], [2, 0.12], [0, 0.03], [1, 0.06], [0, 0.18]];
  let y = 0;
  for (const [ci, w] of bands) {
    ctx.fillStyle = cols[ci % cols.length];
    ctx.fillRect(0, Math.floor(y * size), size, Math.ceil(w * size) + 1);
    y += w;
  }
  // overlay the weave
  const f = fabricTexture().map.image;
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ctx.drawImage(f, i * 64, j * 64, 64, 64);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  return toTexture(c, { aniso: maxAniso });
}

// ---------- floor: vinyl plank / checker ----------
// One tile = 1.2 m. Planks run along U, 0.15 m wide (8 rows per tile).
export function floorTexture(f, size = 1024) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  if (f.kind === 'checker') {
    const n = 4; const s = size / n;
    const A = srgb(f.a), B = srgb(f.b);
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const on = (Math.floor(x / s) + Math.floor(y / s)) % 2;
      const C = on ? B : A;
      const n2 = (vnoise(x / 6, y / 6, size / 6, size / 6, 3) - 0.5) * 10;
      const grout = (x % s < 2 || y % s < 2) ? -18 : 0;
      const k = (y * size + x) * 4;
      d[k] = C[0] + n2 + grout; d[k + 1] = C[1] + n2 + grout; d[k + 2] = C[2] + n2 + grout; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(c, { aniso: maxAniso });
  }
  const rows = 8, rh = size / rows;
  const A = srgb(f.base), B = srgb(f.dark);
  const img = ctx.createImageData(size, size), d = img.data;
  const offs = [], tints = [];
  for (let r = 0; r < rows; r++) { offs.push(hash(r, 1, 9) * size); tints.push([(hash(r, 2, 9) - 0.5), (hash(r, 3, 9) - 0.5)]); }
  for (let y = 0; y < size; y++) {
    const r = Math.floor(y / rh), ry = y - r * rh;
    for (let x = 0; x < size; x++) {
      const xr = (x - offs[r] + size) % size; // position within the row (one joint per row per tile)
      const half = xr < size / 2 ? 0 : 1; // two planks per row, each 0.6 m
      const tint = half ? tints[r][1] : tints[r][0];
      const u = x / size, v = y / size;
      const g = (v * 64 + (fbm(u, v, 2, 8, 2, 31 + r) - 0.5) * 3);
      const gl = Math.pow(Math.max(0, 1 - Math.abs((g - Math.floor(g)) - 0.5) * 2.4), 3) * 0.5;
      let t = 0.15 + gl + tint * f.vary * 4 + (fbm(u, v, 1, 16, 2, 41) - 0.5) * 0.3;
      const seam = (ry < 2 || xr % (size / 2) < 2) ? 0.9 : 0;
      t = Math.min(1, Math.max(0, t + seam));
      const k = (y * size + x) * 4;
      d[k] = mix(A[0], B[0], t); d[k + 1] = mix(A[1], B[1], t); d[k + 2] = mix(A[2], B[2], t); d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { aniso: maxAniso });
}

// ---------- tent canvas with mesh windows ----------
export function tentTexture(ranges) {
  const W = 512, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#a59b86';
  ctx.fillRect(0, 0, W, H);
  // weave noise
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = (vnoise(x / 2, y / 2, W / 2, H / 2, 5) - 0.5) * 16 + (vnoise(x / 16, y / 3, W / 16, H / 3, 6) - 0.5) * 10;
    const k = (y * W + x) * 4; d[k] += n; d[k + 1] += n; d[k + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // U layout around the perimeter: ranges = [left side, front, right side, rear] as [u0,u1].
  // V runs bottom (0) to top (1); the sides are wedges (tall at the front), so windows sit toward the front.
  const R = ranges || [[0, 0.38], [0.38, 0.5], [0.5, 0.88], [0.88, 1]];
  ctx.fillStyle = 'rgba(28,30,28,0.85)';
  const win = (u0, u1, v0 = 0.3, v1 = 0.75) => {
    const x0 = u0 * W, w = (u1 - u0) * W;
    ctx.beginPath(); ctx.roundRect(x0, H * (1 - v1), w, H * (v1 - v0), 8); ctx.fill();
  };
  const at = (r, a, b) => [r[0] + (r[1] - r[0]) * a, r[0] + (r[1] - r[0]) * b];
  // left side runs rear->front, right side runs front->rear
  win(...at(R[0], 0.55, 0.88));
  win(...at(R[1], 0.18, 0.82), 0.3, 0.78);
  win(...at(R[2], 0.12, 0.45));
  // seams top/bottom
  ctx.fillStyle = '#5f5a4f'; ctx.fillRect(0, 0, W, 6); ctx.fillRect(0, H - 6, W, 6);
  const t = toTexture(c, { aniso: maxAniso });
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- soft round contact shadow ----------
export function blobTexture() {
  const s = 128, c = canvas(s, s), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// thumbnail data URL for UI cards (small canvas, cheap)
export function woodThumb(w) {
  const t = woodTexture(w, 96, 1);
  const url = t.map.image.toDataURL();
  t.map.dispose(); t.bumpMap.dispose();
  return url;
}
export function floorThumb(f) {
  const t = floorTexture(f, 192);
  const url = t.image.toDataURL();
  t.dispose();
  return url;
}
