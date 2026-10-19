import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { languageHex } from './languages.js';

// City grid, in world units.
const LOT = 7;
const LOTS = 3; // lots per block side
const BLOCK = LOT * LOTS;
const STREET = 5;
const PITCH = BLOCK + STREET;
const FLOOR = 1; // world units per storey
const COL = 0.8; // world units per window column
const CELL = 8; // facade texture pixels per window

const SKY_TOP = new THREE.Color('#02030a');
const HORIZON = new THREE.Color('#15163a');
const WINDOW_COLORS = ['#ffd58a', '#ffe2a6', '#ffc56b', '#fff0cc', '#ffd58a', '#bfe2ff'];

export function buildingHeight(stars, scale, maxStars) {
  if (scale === 'linear') return 2.5 + 64 * (stars / Math.max(1, maxStars));
  return 2.5 + 7.5 * Math.log10(stars + 1) ** 1.25;
}

// Share of windows lit, from commits in the activity window.
export function litFraction(commits) {
  return 0.03 + 0.92 * (1 - Math.exp(-commits / 15));
}

function footprint(sizeKb) {
  return 2.6 + Math.min(2.8, Math.log10(sizeKb + 1) * 0.55);
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// K×K blocks of 3×3 lots; lots sorted so the most-starred repos land downtown.
function layout(count) {
  const k = Math.max(1, Math.ceil(Math.sqrt(Math.ceil(count / (LOTS * LOTS)))));
  const jitter = mulberry32(count + 7);
  const lots = [];
  for (let bx = 0; bx < k; bx++) {
    for (let bz = 0; bz < k; bz++) {
      for (let lx = 0; lx < LOTS; lx++) {
        for (let lz = 0; lz < LOTS; lz++) {
          const x = (bx - (k - 1) / 2) * PITCH + (lx - 1) * LOT;
          const z = (bz - (k - 1) / 2) * PITCH + (lz - 1) * LOT;
          lots.push({ x, z, d: Math.hypot(x, z) + jitter() * 3 });
        }
      }
    }
  }
  lots.sort((a, b) => a.d - b.d);
  return { k, lots };
}

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function facadeTexture(canvas, anisotropy) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = anisotropy;
  return t;
}

// Two matching textures: the facade as seen, and only its lit windows for the glow.
function facade(cols, floors, wall, lit, rand, anisotropy) {
  const w = cols * CELL;
  const h = floors * CELL;
  const [look, a] = canvas2d(w, h);
  const [glow, b] = canvas2d(w, h);
  a.fillStyle = `#${wall.getHexString()}`;
  a.fillRect(0, 0, w, h);
  b.fillStyle = '#000';
  b.fillRect(0, 0, w, h);

  for (let f = 0; f < floors; f++) {
    // Offices light up a floor at a time, so vary the odds per storey.
    const floorLit = Math.min(1, lit * (0.35 + 1.3 * rand()));
    for (let c = 0; c < cols; c++) {
      const x = c * CELL + 2;
      const y = f * CELL + 2;
      if (rand() < floorLit) {
        const color = WINDOW_COLORS[Math.floor(rand() * WINDOW_COLORS.length)];
        a.fillStyle = color;
        a.fillRect(x, y, 4, 5);
        b.globalAlpha = 0.45 + 0.55 * rand();
        b.fillStyle = color;
        b.fillRect(x, y, 4, 5);
        b.globalAlpha = 1;
      } else {
        a.fillStyle = rand() < 0.5 ? '#0b1120' : '#101a30';
        a.fillRect(x, y, 4, 5);
      }
    }
  }
  return { map: facadeTexture(look, anisotropy), glow: facadeTexture(glow, anisotropy) };
}

function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.map?.dispose();
      m.emissiveMap?.dispose();
      m.dispose();
    }
  });
}

export class City {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.appendChild(this.renderer.domElement);
    this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(HORIZON, 200, 900);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 8000);
    this.camera.position.set(120, 90, 120);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.07,
      autoRotate: true,
      autoRotateSpeed: 0.45,
      maxPolarAngle: Math.PI * 0.475,
      minDistance: 6,
    });
    this.controls.addEventListener('start', () => this.onUserOrbit?.());

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.8);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.addEnvironment();
    this.city = new THREE.Group();
    this.scene.add(this.city);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.9 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.pickables = [];
    this.beacons = [];
    this.rising = [];
    this.cars = null;
    this.focus = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.clock = new THREE.Clock();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  get autoRotate() {
    return this.controls.autoRotate;
  }

  set autoRotate(on) {
    this.controls.autoRotate = on;
  }

  addEnvironment() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: SKY_TOP }, horizon: { value: HORIZON } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top;
          uniform vec3 horizon;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, 0.0, 1.0);
            gl_FragColor = vec4(mix(horizon, top, pow(h, 0.5)), 1.0);
          }`,
      }),
    );
    sky.renderOrder = -1;
    this.scene.add(sky);

    const n = 2200;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 0.06 + 0.94 * Math.random() ** 0.7;
      const r = Math.sqrt(1 - y * y);
      const t = Math.random() * Math.PI * 2;
      pos.set([Math.cos(t) * r * 2500, y * 2500, Math.sin(t) * r * 2500], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(
      new THREE.Points(
        starGeo,
        new THREE.PointsMaterial({ color: '#c9d4ff', size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8, depthWrite: false }),
      ),
    );

    const moonDir = new THREE.Vector3(-0.55, 0.42, -0.72).normalize();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(55, 32, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d8').multiplyScalar(1.6), fog: false }),
    );
    moon.position.copy(moonDir).multiplyScalar(2300);
    this.scene.add(moon);

    this.scene.add(new THREE.HemisphereLight('#5d6cb0', '#0a0a14', 1.1));
    const moonlight = new THREE.DirectionalLight('#aab8ff', 1.1);
    moonlight.position.copy(moonDir).multiplyScalar(100);
    this.scene.add(moonlight);

    const land = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: '#07080f', roughness: 1 }));
    land.rotation.x = -Math.PI / 2;
    land.position.y = -0.05;
    this.scene.add(land);
  }

  clear() {
    disposeTree(this.city);
    this.city.clear();
    this.pickables = [];
    this.beacons = [];
    this.rising = [];
    this.cars = null;
    this.focus = null;
    this.highlight.visible = false;
  }

  build(repos, { scale = 'log' } = {}) {
    this.clear();
    const sorted = [...repos].sort((a, b) => b.stars - a.stars || b.commits - a.commits || a.name.localeCompare(b.name));
    const maxStars = sorted[0]?.stars ?? 0;
    const { k, lots } = layout(Math.max(1, sorted.length));
    this.half = (k * PITCH) / 2;

    this.addGround(k);
    this.addStreetlights(k);

    let maxH = 6;
    sorted.forEach((repo, i) => {
      const lot = lots[i];
      const h = buildingHeight(repo.stars, scale, maxStars);
      maxH = Math.max(maxH, h);
      const building = this.makeBuilding(repo, h, i < 3 && h > 14);
      building.position.set(lot.x, 0, lot.z);
      building.scale.y = 0.001;
      this.rising.push({ obj: building, delay: lot.d * 0.01 + Math.random() * 0.2 });
      this.city.add(building);
    });

    const totalCommits = sorted.reduce((sum, r) => sum + r.commits, 0);
    this.addTraffic(k, totalCommits);
    this.frame(maxH);
    this.riseStart = this.clock.elapsedTime;
  }

  makeBuilding(repo, h, antenna) {
    const rand = mulberry32(hashString(repo.fullName));
    const w = footprint(repo.size);
    const floors = Math.max(2, Math.round(h / FLOOR));
    const cols = Math.max(2, Math.round(w / COL));
    const lang = new THREE.Color(languageHex(repo.language));
    const wall = new THREE.Color('#141a2b').lerp(lang, 0.1);
    if (repo.archived) wall.multiplyScalar(0.6);

    const lit = repo.archived ? 0 : litFraction(repo.commits);
    const { map, glow } = facade(cols, floors, wall, lit, rand, this.anisotropy);
    const side = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: glow,
      emissive: '#ffffff',
      emissiveIntensity: 1.6,
      roughness: 0.7,
      metalness: 0.2,
    });
    const roof = new THREE.MeshStandardMaterial({ color: wall.clone().multiplyScalar(0.85), roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), [side, side, roof, roof, side, side]);
    body.position.y = h / 2;

    const activity = 1 - Math.exp(-repo.commits / 20);
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.86, 0.4, w * 0.86),
      new THREE.MeshStandardMaterial({
        color: lang,
        emissive: lang,
        emissiveIntensity: repo.archived ? 0.04 : 0.15 + 0.9 * activity,
        roughness: 0.5,
      }),
    );
    crown.position.y = h + 0.2;

    const group = new THREE.Group();
    group.add(body, crown);

    if (antenna) {
      const mastH = 2.5 + h * 0.08;
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.12, mastH, 6),
        new THREE.MeshStandardMaterial({ color: '#2a3048', roughness: 0.6, metalness: 0.5 }),
      );
      mast.position.y = h + 0.4 + mastH / 2;
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3045').multiplyScalar(3) }),
      );
      beacon.position.y = h + 0.4 + mastH + 0.1;
      group.add(mast, beacon);
      this.beacons.push({ mesh: beacon, phase: rand() * 2 });
    }

    const info = { repo, w, h, group };
    body.userData = info;
    crown.userData = info;
    this.pickables.push(body, crown);
    return group;
  }

  addGround(k) {
    const span = k * PITCH + STREET;
    const ppu = Math.min(10, 2048 / span);
    const size = Math.round(span * ppu);
    const [canvas, ctx] = canvas2d(size, size);
    const toPx = (v) => (v + span / 2) * ppu;

    ctx.fillStyle = '#0b0d16';
    ctx.fillRect(0, 0, size, size);
    for (let bx = 0; bx < k; bx++) {
      for (let bz = 0; bz < k; bz++) {
        const cx = (bx - (k - 1) / 2) * PITCH;
        const cz = (bz - (k - 1) / 2) * PITCH;
        ctx.fillStyle = '#171b29';
        ctx.fillRect(toPx(cx - BLOCK / 2), toPx(cz - BLOCK / 2), BLOCK * ppu, BLOCK * ppu);
        ctx.fillStyle = '#1b2031';
        for (let lx = 0; lx < LOTS; lx++) {
          for (let lz = 0; lz < LOTS; lz++) {
            const x = cx + (lx - 1) * LOT - LOT / 2 + 0.5;
            const z = cz + (lz - 1) * LOT - LOT / 2 + 0.5;
            ctx.fillRect(toPx(x), toPx(z), (LOT - 1) * ppu, (LOT - 1) * ppu);
          }
        }
      }
    }
    ctx.strokeStyle = '#6b5626';
    ctx.lineWidth = Math.max(1, 0.18 * ppu);
    ctx.setLineDash([1.6 * ppu, 1.6 * ppu]);
    for (let i = 0; i <= k; i++) {
      const s = toPx((i - k / 2) * PITCH);
      ctx.beginPath();
      ctx.moveTo(0, s);
      ctx.lineTo(size, s);
      ctx.moveTo(s, 0);
      ctx.lineTo(s, size);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(span, span),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.5, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.city.add(ground);
  }

  addStreetlights(k) {
    const spots = [];
    const off = STREET / 2 + 0.4;
    for (let i = 0; i <= k; i++) {
      for (let j = 0; j <= k; j++) {
        const x = (i - k / 2) * PITCH;
        const z = (j - k / 2) * PITCH;
        for (const [dx, dz] of [[off, off], [-off, -off], [off, -off], [-off, off]]) spots.push([x + dx, z + dz]);
      }
    }
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.07, 3, 5),
      new THREE.MeshStandardMaterial({ color: '#232a40', roughness: 0.6 }),
      spots.length,
    );
    const lamps = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb25e').multiplyScalar(1.4) }),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      poles.setMatrixAt(i, m.makeTranslation(x, 1.5, z));
      lamps.setMatrixAt(i, m.makeTranslation(x, 3.05, z));
    });
    this.city.add(poles, lamps);
  }

  // Traffic scales with total recent commits: a busy profile is a busy city.
  addTraffic(k, totalCommits) {
    const count = Math.round(THREE.MathUtils.clamp(10 + totalCommits / 2, 10, 280));
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.45),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      count,
    );
    const extent = this.half + STREET / 2;
    const head = new THREE.Color('#fff1d0').multiplyScalar(1.5);
    const tail = new THREE.Color('#ff3a30').multiplyScalar(1.8);
    const cars = [];
    for (let i = 0; i < count; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      cars.push({
        horizontal: Math.random() < 0.5,
        street: (Math.floor(Math.random() * (k + 1)) - k / 2) * PITCH,
        lane: dir * 1.1,
        dir,
        pos: (Math.random() * 2 - 1) * extent,
        speed: 5 + Math.random() * 9,
      });
      mesh.setColorAt(i, dir > 0 ? head : tail);
    }
    this.cars = { mesh, list: cars, extent, dummy: new THREE.Object3D() };
    this.city.add(mesh);
  }

  // Fits the city's bounding sphere in view, whichever of the two fovs is narrower.
  frame(maxH) {
    const r = this.half + STREET;
    // Farthest of the ground corners and the top of the tallest tower, measured from the target.
    const radius = Math.max(Math.hypot(r * Math.SQRT2, maxH * 0.4), Math.hypot(r * 0.5, maxH * 0.6 + 6)) * 1.08;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = Math.max(45, (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 0.95);
    const target = new THREE.Vector3(0, maxH * 0.4, 0);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(1, 0.62, 1).normalize().multiplyScalar(dist));
    this.controls.maxDistance = dist * 2.6;
    this.scene.fog.near = dist * 0.8;
    this.scene.fog.far = dist * 3.6;
    this.controls.update();
  }

  finishRise() {
    for (const { obj } of this.rising) obj.scale.y = 1;
    this.rising = [];
  }

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.pickables, false)[0]?.object.userData ?? null;
  }

  setHighlight(info) {
    this.highlight.visible = !!info;
    if (!info) return;
    const { w, h, group } = info;
    this.highlight.scale.set(w + 0.3, h + 0.7, w + 0.3);
    this.highlight.position.set(group.position.x, (h + 0.7) / 2, group.position.z);
  }

  flyTo(info) {
    const to = new THREE.Vector3(info.group.position.x, info.h * 0.55, info.group.position.z);
    this.focus = { from: this.controls.target.clone(), to, start: this.clock.elapsedTime };
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;

    if (this.rising.length) {
      let done = true;
      for (const item of this.rising) {
        const p = THREE.MathUtils.clamp((t - this.riseStart - item.delay) / 1.2, 0, 1);
        item.obj.scale.y = Math.max(0.001, 1 - (1 - p) ** 3);
        if (p < 1) done = false;
      }
      if (done) this.rising = [];
    }

    if (this.cars) {
      const { mesh, list, extent, dummy } = this.cars;
      list.forEach((car, i) => {
        car.pos += car.dir * car.speed * dt;
        if (car.pos > extent) car.pos = -extent;
        if (car.pos < -extent) car.pos = extent;
        const across = car.street + car.lane;
        dummy.position.set(car.horizontal ? car.pos : across, 0.2, car.horizontal ? across : car.pos);
        dummy.rotation.y = car.horizontal ? 0 : Math.PI / 2;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }

    for (const b of this.beacons) b.mesh.visible = (t + b.phase) % 1.8 < 0.35;

    if (this.focus) {
      const p = THREE.MathUtils.clamp((t - this.focus.start) / 0.9, 0, 1);
      this.controls.target.lerpVectors(this.focus.from, this.focus.to, 1 - (1 - p) ** 3);
      if (p === 1) this.focus = null;
    }

    this.controls.update(dt);
    this.composer.render(dt);
  }

  // Renders the current view at a fixed size, for the shareable poster.
  snapshot(width, height) {
    this.finishRise();
    const hadHighlight = this.highlight.visible;
    this.highlight.visible = false;
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(1);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer.render();

    const [out, ctx] = canvas2d(width, height);
    ctx.drawImage(this.renderer.domElement, 0, 0);

    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x, size.y, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);
    this.camera.aspect = size.x / size.y;
    this.camera.updateProjectionMatrix();
    this.highlight.visible = hadHighlight;
    return out;
  }
}
