// Sky, sun/moon, environment lighting, showroom ground, fog and day/night blending.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { blobTexture } from './textures.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;

export class Environment {
  constructor(renderer, scene, { mobile }) {
    this.renderer = renderer;
    this.scene = scene;
    this.mobile = mobile;

    // image-based lighting
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envTex;

    // sky dome
    const sky = new Sky();
    sky.scale.setScalar(1800);
    const u = sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    if (u.cloudCoverage) u.cloudCoverage.value = 0.35;
    this.sky = sky;
    scene.add(sky);

    // night dome: gradient + stars, fades in over the sky
    this.night = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform float opacity; varying vec3 vDir;
        float h(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          float y = clamp(vDir.y, -0.2, 1.0);
          vec3 zen = vec3(0.010,0.018,0.05), hor = vec3(0.034,0.048,0.095);
          vec3 c = mix(hor, zen, smoothstep(0.0, 0.6, y));
          vec3 g = floor(vDir*420.0);
          float s = step(0.9975, h(g)) * smoothstep(0.02, 0.25, y);
          c += vec3(s) * (0.5 + 0.5*h(g+3.0));
          gl_FragColor = vec4(c, opacity);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
    }));
    this.night.renderOrder = -1;
    this.night.frustumCulled = false;
    scene.add(this.night);

    // lights
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b6250, 0.6);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = true;
    const ms = mobile ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -4.5; sc.right = 4.5; sc.top = 4.5; sc.bottom = -4.5; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    this.sun = sun;
    scene.add(sun, sun.target);
    this.focus = new THREE.Vector3();

    // showroom ground
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.96, metalness: 0 });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2), groundMat);
    this.ground.receiveShadow = true;
    this.ground.name = 'Showroom_Ground';
    scene.add(this.ground);

    // cheap contact shadow under the van (always on; it is what grounds the van on phones)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.85 }));
    this.blob.renderOrder = 1;
    this.blob.position.y = 0.004;
    scene.add(this.blob);

    scene.fog = new THREE.Fog(0xdfe6ea, 35, 130);
    this.nightFactor = 0;
    this.sunDir = new THREE.Vector3();
  }

  setBlobSize(w, l) { this.blob.scale.set(w * 1.35, 1, l * 1.2); }

  setDriveFog(on) {
    this.scene.fog.near = on ? 70 : 35;
    this.scene.fog.far = on ? 380 : 130;
    this.ground.visible = !on;
  }

  // hour: 0..24. Returns the night factor (0 day .. 1 night).
  setHour(hour) {
    this.hour = hour;
    const elev = 62 * Math.sin(((hour - 6) / 12) * Math.PI); // degrees
    const az = ((hour - 12) / 12) * 180 + 200;               // degrees, sun swings around the van
    const phi = (90 - elev) * D2R, theta = az * D2R;
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.visible = elev > -14;

    const night = smooth(3, -9, elev);
    this.nightFactor = night;
    this.night.material.uniforms.opacity.value = night;
    this.night.visible = night > 0.001;

    const dayI = smooth(-3, 14, elev);
    const warm = 1 - smooth(4, 30, elev);
    const sunCol = new THREE.Color(0xffffff).lerp(new THREE.Color(0xffb070), warm);
    const moonI = 0.45 * night;
    this.sun.color.copy(sunCol).lerp(new THREE.Color(0x9fb6ff), night);
    this.sun.intensity = 2.6 * dayI + moonI;
    this._lightDir = elev > -3 ? this.sunDir.clone() : new THREE.Vector3().setFromSphericalCoords(1, 50 * D2R, (az + 160) * D2R);
    this._lightDir.y = Math.max(this._lightDir.y, 0.12);
    this._lightDir.normalize();

    this.hemi.color.set(0xcfe3ff).lerp(new THREE.Color(0x26355a), night);
    this.hemi.groundColor.set(0x6b6250).lerp(new THREE.Color(0x0a0c12), night);
    this.hemi.intensity = 0.4 * (1 - night) + 0.35 * night;
    this.scene.environmentIntensity = 0.6 * (1 - night) + 0.06 * night;
    this.scene.backgroundIntensity = 1;

    const fogDay = new THREE.Color(0xc9d1d6).lerp(new THREE.Color(0xe7c9a8), warm * (1 - night));
    this.scene.fog.color.copy(fogDay).lerp(new THREE.Color(0x343f5e), night);
    this.ground.material.color.set(0x8c877d).lerp(new THREE.Color(0x4a4a4e), night * 0.6);
    this.renderer.toneMappingExposure = 0.66 + 0.4 * night;
    this.blob.material.opacity = 0.85 * (1 - night * 0.5);
    this._place();
    return night;
  }

  // Keep the shadow frustum centred on the van.
  setFocus(v) { this.focus.copy(v); this._place(); }
  _place() {
    if (!this._lightDir) return;
    this.sun.position.copy(this.focus).addScaledVector(this._lightDir, 25);
    this.sun.target.position.copy(this.focus);
    this.sun.target.updateMatrixWorld();
  }
}

// Headlight spots + warm cabin lights attached to the van.
export class VanLights {
  constructor(van, bounds) {
    const zF = bounds.max.z - 0.12, y = bounds.min.y + 0.8, hx = (bounds.max.x - bounds.min.x) * 0.33;
    this.heads = [];
    for (const x of [hx, -hx]) {
      const s = new THREE.SpotLight(0xfff0d8, 0, 45, 0.5, 0.55, 1.4);
      s.position.set(x, y, zF);
      s.target.position.set(x * 1.4, 0, zF + 14);
      s.castShadow = false;
      van.add(s, s.target);
      this.heads.push(s);
    }
    this.cabin = [];
    const zc = (bounds.min.z + bounds.max.z) / 2;
    for (const dz of [-0.2, -1.4]) {
      const p = new THREE.PointLight(0xffb468, 0, 1.6, 2);
      p.position.set(0, bounds.min.y + 1.6, zc + dz);
      van.add(p);
      this.cabin.push(p);
    }
  }
  set({ head = 0, cabin = 0, night = 0 }) {
    for (const s of this.heads) s.intensity = head * 140;
    for (const p of this.cabin) p.intensity = cabin * (0.4 + 1.6 * night);
  }
}
