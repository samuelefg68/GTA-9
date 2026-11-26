import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { damp, clamp, groundHeight, pick, angleDiff, mat } from './utils.js';

const MODEL_COUNT = 3;
const WHEEL = /wheel/i;
const NOT_WHEEL = /steering|chrysler/i;
const isWheel = (n) => WHEEL.test(n) && !NOT_WHEEL.test(n);
const PERF = { maxSpeed: 34, maxRev: 10, accel: 14, brake: 10, steer: 0.55 };
const GRIP_G = 20;
const SLIP_T = 0.12;
const YAW_RESP = 12;
const WHEEL_IN = 4.2;
const WHEEL_OUT = 6.5;
const HAND_DECEL = 16;
const HAND_YAW = 1.6;
const HAND_GRIP_LOSS = 3;
const POWER_SLIDE = 1.2;
const ASSIST_K = 0.6;
const ASSIST_MAX = 0.2;
const NONE = { up: false, down: false, left: false, right: false, hand: false };
const SEAT_SCALE = 0.82;
const BRAKE = /brake/i;
const GLASS = /windshield|window|tailgateglass|glass|vidro/i;
const GLASS_COLOR = new THREE.Color(0.03, 0.035, 0.045);
const loader = new GLTFLoader();

let carGlassTex = null;
function getCarGlassTex() {
  if (carGlassTex) return carGlassTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#09131d');
  grad.addColorStop(0.5, '#132436');
  grad.addColorStop(1, '#080e14');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(0, 0, 128, 6);
  g.fillRect(0, 122, 128, 6);
  carGlassTex = new THREE.CanvasTexture(cv);
  carGlassTex.colorSpace = THREE.SRGBColorSpace;
  carGlassTex.wrapS = carGlassTex.wrapT = THREE.RepeatWrapping;
  return carGlassTex;
}

let cineCarGlassMat = null;
function getCineCarGlassMat(envTex) {
  if (!cineCarGlassMat) {
    cineCarGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b141e,
      map: getCarGlassTex(),
      roughness: 0.02, // Mais liso
      metalness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      reflectivity: 1.0,
      envMap: envTex || null,
      envMapIntensity: 3.5, // Brilho mais forte
    });
  } else if (envTex && cineCarGlassMat.envMap !== envTex) {
    cineCarGlassMat.envMap = envTex;
    cineCarGlassMat.needsUpdate = true;
  }
  return cineCarGlassMat;
}

// Pintura metálica dos carros para o modo cinematográfico
let cineCarPaintMatCache = new Map();
function getCineCarPaintMat(color, envTex) {
    const key = color.getHexString();
    let m = cineCarPaintMatCache.get(key);
    if (!m) {
        m = new THREE.MeshPhysicalMaterial({
            color: color,
            roughness: 0.35, // Lataria um pouco polida
            metalness: 0.7, // Visual metálico!
            clearcoat: 0.8, // Verniz automotivo
            clearcoatRoughness: 0.05,
            envMap: envTex || null,
            envMapIntensity: 1.5,
        });
        cineCarPaintMatCache.set(key, m);
    } else if (envTex && m.envMap !== envTex) {
        m.envMap = envTex;
        m.needsUpdate = true;
    }
    return m;
}

const carGlassMeshes = [];
const carPaintMeshes = []; // Armazena a lataria para trocar material

export function setCarGraphics(cine, envTex) {
  const cineGlassMat = cine ? getCineCarGlassMat(envTex) : null;
  for (const m of carGlassMeshes) {
    m.material = cine ? cineGlassMat : m.userData.normGlassMat;
  }
  
  for (const m of carPaintMeshes) {
      if (cine) {
          m.material = getCineCarPaintMat(m.userData.normPaintMat.color, envTex);
      } else {
          m.material = m.userData.normPaintMat;
      }
  }
}

// Cópias exclusivas para o carro do jogador, para o reflexo dinâmico não afetar os outros carros
export function createPlayerCarMaterials(vehicle, envTex) {
  const copies = new Map(); // material compartilhado -> cópia
  const swapped = [];       // [malha, material compartilhado]
  vehicle.group.traverse((m) => {
    if (!m.isMesh) return;
    const isGlass = !!m.userData.normGlassMat;
    if (!isGlass && !m.userData.normPaintMat) return;
    const shared = m.material;
    if (!shared.isMeshPhysicalMaterial) return;
    let copy = copies.get(shared);
    if (!copy) {
      copy = shared.clone();
      copy.envMap = envTex;
      if (isGlass) copy.envMapIntensity = 1.8;
      else { copy.metalness = 0.55; copy.roughness = 0.28; }
      copies.set(shared, copy);
    }
    swapped.push([m, shared]);
    m.material = copy;
  });
  return {
    setEnv(tex) {
      for (const c of copies.values()) { c.envMap = tex; c.needsUpdate = true; }
    },
    release() {
      for (const [m, shared] of swapped) m.material = shared;
      for (const c of copies.values()) c.dispose();
    },
  };
}

const TRAFFIC_SPEED = 30 / 3.6;
const TURN_SPEED = 4.5;
const AI_ACCEL = 2.5;
const AI_BRAKE = 5;
const AI_TURN = 1.6;
const TRAFFIC_COUNT = 100;
const ABANDON_T = 6;
const TELEPORT_MIN = 60;
const PED_LOOK = 20;
const PED_STOP = 1.0;
const PED_R = 0.35;
const STUCK_T = 10;
const newAI = () => ({ node: null, target: null, still: 0 });
const DRIVER_MIN_SPEED = 0.5;

const CAR_CULL_DIST = 110;
const LOD_DIST = 50;
const PROXY_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e];
const PROXY_GLASS = 0x1c232b;
const PROXY_GEO = new THREE.BoxGeometry(1, 1, 1);

const TARGET_LEN = 4.6;
const MODEL_FIX = [
  { scale: 1.25, keepAlpha: true, maxSpeed: 27.78 },
  { scale: 1.25, maxSpeed: 19.44 },
  { scale: 1.25, maxSpeed: 20.83 },
];

function setupWheels(model, root) {
  const wheels = [], brakes = [];
  model.traverse((o) => {
    if (o === model || !isWheel(o.name)) return;
    for (let p = o.parent; p && p !== model; p = p.parent) if (isWheel(p.name)) return;
    (BRAKE.test(o.name) ? brakes : wheels).push(o);
  });
  if (!wheels.length) return 0;
  root.updateMatrixWorld(true);
  const center = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  const tires = wheels.filter((w) => /tire/i.test(w.name));
  const hubs = tires.length ? tires : wheels;
  const hubPos = hubs.map(center);
  const midZ = hubPos.reduce((a, v) => a + v.z, 0) / hubPos.length;
  const wb = new THREE.Box3().setFromObject(hubs[0]);
  const radius = (wb.max.y - wb.min.y) / 2;
  const pivots = hubs.map((h, i) => {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    pivot.position.copy(hubPos[i]);
    pivot.userData.wheelPivot = true;
    pivot.userData.front = hubPos[i].z > midZ;
    spin.userData.wheelSpin = true;
    root.add(pivot);
    pivot.add(spin);
    pivot.updateMatrixWorld(true);
    spin.attach(h);
    return { pivot, spin, pos: hubPos[i] };
  });
  const nearest = (o) => {
    const c = center(o);
    let best = pivots[0], bd = Infinity;
    for (const pv of pivots) {
      const d = c.distanceToSquared(pv.pos);
      if (d < bd) { bd = d; best = pv; }
    }
    return best;
  };
  for (const w of wheels) {
    if (hubs.includes(w)) continue;
    nearest(w).spin.attach(w);
  }
  for (const b of brakes) {
    const pv = nearest(b);
    if (pv.pivot.userData.front) pv.pivot.attach(b);
  }
  root.updateMatrixWorld(true);
  return radius;
}

function splitWheelSides(model) {
  const targets = [];
  model.traverse((o) => { if (o.isMesh && isWheel(o.name)) targets.push(o); });
  for (const o of targets) {
    const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const p = src.attributes.position;
    const left = [], right = [];
    for (let t = 0; t < p.count; t += 3) {
      const cx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3;
      (cx < 0 ? left : right).push(t, t + 1, t + 2);
    }
    if (!left.length || !right.length) continue;
    const build = (idx) => {
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(src.attributes)) {
        const a = src.attributes[name], n = a.itemSize;
        const arr = new Float32Array(idx.length * n);
        idx.forEach((v, i) => { for (let k = 0; k < n; k++) arr[i * n + k] = a.array[v * n + k]; });
        g.setAttribute(name, new THREE.BufferAttribute(arr, n));
      }
      return g;
    };
    const side = o.clone();
    o.geometry = build(left);
    side.geometry = build(right);
    o.name += '_L';
    side.name = o.name.replace(/_L$/, '_R');
    o.parent.add(side);
  }
}

async function loadCar(url, fix = {}) {
  const model = (await loader.loadAsync(url).catch(() => { throw new Error(`Falha ao carregar ${url}`); })).scene;
  const root = new THREE.Group();
  root.add(model);
  splitWheelSides(model);
  const lambert = new Map();
  let wheelR = 0.38;
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    const m = o.material;
    const vc = !m.map && !!o.geometry.attributes.color;
    const glass = GLASS.test(m.name) || GLASS.test(o.name);
    // Correção: Movido a declaração de alpha para o escopo externo para ser usada nos dois blocos de if
    const alpha = !!fix.keepAlpha && !glass && m.transparent;
    
    const key = m.uuid + (vc ? 'v' : '') + (glass ? 'g' : '');
    if (!lambert.has(key)) {
      const glow = !!m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01;
      lambert.set(key, new THREE.MeshLambertMaterial({
        map: m.map,
        color: glass ? GLASS_COLOR : (glow && !m.map ? m.emissive : m.color),
        vertexColors: vc,
        emissive: glow ? m.emissive : 0x000000,
        emissiveMap: glow ? m.emissiveMap : null,
        ...(alpha ? { transparent: true, opacity: m.opacity, depthWrite: false } : {}),
      }));
    }
    o.material = lambert.get(key);
    if (glass) o.userData.isGlass = true;
    else if (!m.map && !vc && !isWheel(o.name) && !/interior|seat|chassi/i.test(o.name) && !alpha) {
        // Marcação simples: se não for vidro, roda, interior, e não tiver textura, é "lataria"
        o.userData.isPaint = true; 
    }
  });
  model.rotation.y = fix.rotY || 0;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  if (!fix.rotY && size.x > size.z) {
    model.rotation.y -= Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }
  let k = fix.scale || 1;
  if (size.z < 3 || size.z > 7) k *= TARGET_LEN / size.z;
  if (k !== 1) {
    model.scale.multiplyScalar(k);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }
  wheelR = setupWheels(model, root) || wheelR;
  const c = box.getCenter(new THREE.Vector3());
  if (size.z < 3 || size.z > 7 || size.z < size.x) {
    throw new Error(`${url}: tamanho ou orientação inesperados (${size.x.toFixed(1)} x ${size.z.toFixed(1)} m; o comprimento deve ficar em Z, entre 3 e 7 m)`);
  }
  root.position.set(-c.x, -box.min.y, -c.z);
  const type = {
    name: 'Carro', len: size.z, h: size.y, wid: size.x * 0.85, hw: size.x / 2, hl: size.z / 2, wheelR,
    seatY: size.y * 0.36, seatZ: -size.z * 0.09, ...PERF,
    maxSpeed: fix.maxSpeed ?? PERF.maxSpeed,
  };
  return { proto: root, type };
}

let CAR_SHADOWS = false;
export function setCarShadows(on) { CAR_SHADOWS = !!on; }
const SHADOW_DIST = 45;

export class Vehicle {
  constructor(model, x, z, heading) {
    const type = (this.type = model.type);
    this.name = type.name;
    this.home = { x, z, heading };
    this.pos = { x, y: 0, z };
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.wheelIn = 0;
    this.omega = 0;
    this.vlat = 0;
    this.spin = 0;
    this.driven = false;
    this.radius = type.wid / 2 + 0.05;
    this.reach = type.len / 2 - this.radius - 0.1;
    this.fx = Math.sin(heading);
    this.fz = Math.cos(heading);
    this.ai = null;
    this.traffic = false;
    this.abandon = 0;
    this.wasDriven = false;

    const g = (this.group = new THREE.Group());
    g.userData.car = true;
    this.body = model.proto.clone();
    g.add(this.body);

    this.body.traverse((m) => {
      if (m.isMesh) {
          if (m.userData.isGlass) {
            m.userData.normGlassMat = m.material;
            carGlassMeshes.push(m);
          } else if (m.userData.isPaint) {
            m.userData.normPaintMat = m.material;
            carPaintMeshes.push(m);
          }
      }
    });

    this.proxy = new THREE.Group();
    const bodyCol = pick(PROXY_COLORS);
    const body = new THREE.Mesh(PROXY_GEO, mat(bodyCol));
    body.scale.set(type.wid, type.h * 0.6, type.len);
    body.position.y = type.h * 0.3;
    body.userData.normPaintMat = body.material;
    carPaintMeshes.push(body);
    
    const cabin = new THREE.Mesh(PROXY_GEO, mat(PROXY_GLASS));
    cabin.scale.set(type.wid * 0.8, type.h * 0.4, type.len * 0.45);
    cabin.position.set(0, type.h * 0.8, -type.len * 0.08);
    cabin.userData.normGlassMat = cabin.material;
    carGlassMeshes.push(cabin);
    this.proxy.add(body, cabin);
    this.proxy.visible = false;
    g.add(this.proxy);

    g.traverse((m) => { if (m.isMesh) { m.castShadow = CAR_SHADOWS; m.receiveShadow = true; } });
    this.wheels = [];
    this.steered = [];
    g.traverse((o) => {
      if (o.userData.wheelSpin) this.wheels.push(o);
      else if (o.userData.wheelPivot && o.userData.front) this.steered.push(o);
    });
    this.seat = { x: type.wid * 0.22, y: type.seatY - 0.9 * SEAT_SCALE, z: type.seatZ, s: SEAT_SCALE };
    this.sync();
  }

  drive(dt, inp) {
    const T = this.type;
    let s = this.speed;
    if (inp.up) s += (s < -0.3 ? T.brake : T.accel * (1 - Math.max(0, s) / T.maxSpeed)) * dt;
    else if (inp.down) s -= (s > 0.3 ? T.brake : T.accel * 0.7 * (1 + Math.min(0, s) / T.maxRev)) * dt;
    else {
      const f = (this.driven ? 4 : 10) * dt;
      s = Math.abs(s) <= f ? 0 : s - Math.sign(s) * f;
    }
    if (inp.hand) {
      const f = HAND_DECEL * dt;
      s = Math.abs(s) <= f ? 0 : s - Math.sign(s) * f;
    }
    s -= s * Math.abs(s) * 0.0012 * dt;
    this.speed = clamp(s, -T.maxRev, T.maxSpeed);
    const v = this.speed;

    const want = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    const rate = want === 0 || (this.wheelIn !== 0 && Math.sign(want) !== Math.sign(this.wheelIn)) ? WHEEL_OUT : WHEEL_IN;
    this.wheelIn += clamp(want - this.wheelIn, -rate * dt, rate * dt);
    const maxSt = T.steer / (1 + Math.abs(v) * 0.07);
    const beta = Math.atan2(this.vlat, Math.max(v, 0.1));
    const hold = 1 - clamp(Math.abs(this.wheelIn) * 2, 0, 1);
    const assist = clamp(beta * ASSIST_K, -ASSIST_MAX, ASSIST_MAX) * clamp((v - 3) / 3, 0, 1) * hold;
    this.steer = damp(this.steer, this.wheelIn * maxSt + assist, 16, dt);

    const handOn = inp.hand && Math.abs(v) > 6;
    const yawMax = (handOn ? HAND_YAW : 1) * GRIP_G / Math.max(Math.abs(v), 3);
    const wish = clamp((v / (T.len * 0.6)) * Math.tan(this.steer), -yawMax, yawMax);
    this.omega += (wish - this.omega) * (1 - Math.exp(-YAW_RESP * dt));

    const powerK = inp.up && v > 0 ? clamp(v / 12, 0, 1) * Math.abs(this.wheelIn) : 0;
    const tau = SLIP_T * (handOn ? HAND_GRIP_LOSS : 1) * (1 + POWER_SLIDE * powerK);
    const ay = clamp(-this.vlat / tau, -GRIP_G, GRIP_G);
    this.vlat += (ay - this.omega * v) * dt;

    this.heading += this.omega * dt;
    this.fx = Math.sin(this.heading);
    this.fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
    this.pos.x += (this.fx * v + lx * this.vlat) * dt;
    this.pos.z += (this.fz * v + lz * this.vlat) * dt;
    this.spin += (v / this.type.wheelR) * dt;
  }

  autoDrive(dt, want, tx, tz) {
    this.speed += clamp(want - this.speed, -AI_BRAKE * dt, AI_ACCEL * dt);
    const dh = angleDiff(this.heading, Math.atan2(tx - this.pos.x, tz - this.pos.z));
    this.heading += clamp(dh, -AI_TURN * dt, AI_TURN * dt);
    this.steer = damp(this.steer, clamp(dh * 1.2, -0.5, 0.5), 8, dt);
    this.omega = 0; this.vlat = 0; this.wheelIn = 0;
    this.fx = Math.sin(this.heading);
    this.fz = Math.cos(this.heading);
    this.pos.x += this.fx * this.speed * dt;
    this.pos.z += this.fz * this.speed * dt;
    this.spin += (this.speed / this.type.wheelR) * dt;
  }

  sync() {
    this.group.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.group.rotation.y = this.heading;
    for (const w of this.steered) w.rotation.y = this.steer;
    for (const w of this.wheels) w.rotation.x = this.spin;
  }

  setShadow(on) {
    if (this._shadow === on) return;
    this._shadow = on;
    this.group.traverse((m) => { if (m.isMesh) m.castShadow = on; });
  }

  setLod(far) {
    if (this.far === far) return;
    this.far = far;
    this.body.visible = !far;
    this.proxy.visible = far;
  }

  reset() {
    this.pos.x = this.home.x; this.pos.z = this.home.z; this.pos.y = 0;
    this.heading = this.home.heading;
    this.fx = Math.sin(this.heading); this.fz = Math.cos(this.heading);
    this.speed = 0; this.steer = 0; this.driven = false;
    this.wheelIn = 0; this.omega = 0; this.vlat = 0;
    this.sync();
  }
}

const tmp = { x: 0, z: 0 };

export class VehicleManager {
  constructor(scene, physics, notify) {
    this.scene = scene;
    this.physics = physics;
    this.notify = notify;
    this.list = [];
    this.roadNodes = [];
    this.models = [];
    this.crashCooldown = 0;
    this.input = { up: false, down: false, left: false, right: false, hand: false };
    this.peds = [];
    this.walker = null;
  }

  async load() {
    carGlassMeshes.length = 0;
    carPaintMeshes.length = 0;
    this.models = await Promise.all(Array.from({ length: MODEL_COUNT }, (_, i) => loadCar(`models/carro${i + 1}.glb`, MODEL_FIX[i])));
  }

  spawn(x, z, heading, modelIndex) {
    const v = new Vehicle(modelIndex !== undefined ? this.models[modelIndex] : pick(this.models), x, z, heading);
    this.scene.add(v.group);
    this.list.push(v);
    return v;
  }

  populate(city) {
    const st = city.starterCar;
    this.spawn(st.x, st.z, st.heading, 0);
    for (const s of city.parkingSpots) {
      if (Math.random() >= 0.3) continue;
      if (this.list.some((v) => (v.pos.x - s.x) ** 2 + (v.pos.z - s.z) ** 2 < 64)) continue;
      this.spawn(s.x, s.z, s.heading);
    }
    this.roadNodes = city.roadStarts || [];
    if (this.roadNodes.length) for (let i = 0; i < TRAFFIC_COUNT; i++) this._addTraffic();
  }

  resetAll() {
    for (const v of this.list) {
      v.reset();
      v.wasDriven = false; v.abandon = 0;
      v.ai = v.traffic && this.roadNodes.length ? newAI() : null;
      if (v.ai) this._teleport(v, null);
    }
  }

  _addTraffic(focus = null) {
    const v = this.spawn(0, 0, 0);
    v.traffic = true;
    v.ai = newAI();
    this._teleport(v, focus);
    return v;
  }

  _crowd(v, c) {
    let k = 0;
    for (const o of this.list) if (o !== v && (o.pos.x - c.x) ** 2 + (o.pos.z - c.z) ** 2 < 625) k++;
    return k;
  }

  _teleport(v, focus) {
    const N = this.roadNodes;
    const start = (Math.random() * N.length) | 0;
    let c = null, best = null, bestK = Infinity;
    for (let t = 0; t < N.length; t++) {
      const n = N[(start + t) % N.length];
      if (focus && (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2 < TELEPORT_MIN * TELEPORT_MIN) continue;
      const k = this._crowd(v, n);
      if (k === 0) { c = n; break; }
      if (k < bestK) { bestK = k; best = n; }
    }
    if (!c) c = best || N[start];
    v.pos.x = c.x; v.pos.z = c.z; v.pos.y = 0;
    v.heading = c.heading;
    v.fx = Math.sin(v.heading); v.fz = Math.cos(v.heading);
    v.speed = 0; v.steer = 0; v.wheelIn = 0; v.omega = 0; v.vlat = 0;
    v.ai.node = c; v.ai.target = pick(c.n); v.ai.still = 0;
    v.sync();
  }

  setPedestrians(list, walker) {
    this.peds = list;
    this.walker = walker;
  }

  _pedAhead(v) {
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const half = v.type.hw + PED_R;
    let best = Infinity;
    const P = this.peds;
    for (let i = 0; i <= P.length; i++) {
      const o = i < P.length ? P[i] : (this.walker && !this.walker.vehicle ? this.walker : null);
      if (!o || o.dead || o.fallen > 0) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const f = dx * v.fx + dz * v.fz;
      if (f <= 0) continue;
      if (Math.abs(dx * lx + dz * lz) > half) continue;
      const gap = f - v.type.hl - PED_R;
      if (gap < PED_LOOK && gap < best) best = gap;
    }
    return best;
  }

  _gapAhead(v) {
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    let best = Infinity;
    for (const o of this.list) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const f = dx * v.fx + dz * v.fz;
      if (f <= 0) continue;
      if (Math.abs(dx * lx + dz * lz) > 1.8) continue;
      const gap = f - v.type.hl - o.type.hl;
      if (gap < best) best = gap;
    }
    return best;
  }

  _traffic(v, dt, focus) {
    const a = v.ai;
    let dx = a.target.x - v.pos.x, dz = a.target.z - v.pos.z;
    if (dx * dx + dz * dz < 1.44) {
      a.node = a.target;
      a.target = pick(a.node.n);
      dx = a.target.x - v.pos.x; dz = a.target.z - v.pos.z;
    }
    const dist = Math.hypot(dx, dz);
    let want = Math.min(TRAFFIC_SPEED, v.type.maxSpeed);
    if (Math.abs(angleDiff(a.node.heading, a.target.heading)) > 0.3 && dist < 14) want = Math.min(want, TURN_SPEED);
    const gap = this._gapAhead(v);
    if (gap < Infinity) want = Math.min(want, Math.sqrt(2 * AI_BRAKE * Math.max(0, gap - 2.5)));
    const ped = this._pedAhead(v);
    if (ped < Infinity) want = Math.min(want, Math.sqrt(2 * AI_BRAKE * Math.max(0, ped - PED_STOP)));
    if (v.speed < 0.2 && ped === Infinity) {
      a.still += dt;
      if (a.still > STUCK_T) { this._teleport(v, focus); return; }
    } else a.still = 0;
    v.autoDrive(dt, want, a.target.x, a.target.z);
  }

  hasDriver(v) {
    return !!v.ai && !v.driven && Math.abs(v.speed) > DRIVER_MIN_SPEED;
  }

  nearest(x, z, maxD) {
    let best = null, bd = maxD * maxD;
    for (const v of this.list) {
      const d = (v.pos.x - x) ** 2 + (v.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  pushOut(p, r) {
    let hit = null;
    for (const v of this.list) {
      const T = v.type;
      const lim = T.hl + T.hw + r;
      const ddx = p.x - v.pos.x, ddz = p.z - v.pos.z;
      if (ddx * ddx + ddz * ddz > lim * lim) continue;
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      const u = ddx * v.fx + ddz * v.fz;
      const w = ddx * lx + ddz * lz;
      const eu = T.hl + r - Math.abs(u);
      const ew = T.hw + r - Math.abs(w);
      if (eu <= 0 || ew <= 0) continue;
      if (eu < ew) {
        const su = u < 0 ? -1 : 1;
        p.x += v.fx * eu * su;
        p.z += v.fz * eu * su;
      } else {
        const sw = w < 0 ? -1 : 1;
        p.x += lx * ew * sw;
        p.z += lz * ew * sw;
      }
      hit = v;
    }
    return hit;
  }

  update(dt, controls, focus = null) {
    const physics = this.physics;
    const inp = this.input;
    inp.up = controls.down('KeyW'); inp.down = controls.down('KeyS');
    inp.left = controls.down('KeyA'); inp.right = controls.down('KeyD');
    inp.hand = controls.down('Space');
    this.crashCooldown -= dt;
    if (!focus) { const d = this.list.find((v) => v.driven); focus = d ? d.pos : null; }

    for (const v of this.list) {
      if (v.driven) {
        v.ai = null; v.wasDriven = true;
        v.drive(dt, inp);
      } else {
        if (v.wasDriven) { v.wasDriven = false; v.abandon = ABANDON_T; v.traffic = true; }
        if (v.abandon > 0) {
          v.abandon -= dt;
          if (v.abandon <= 0 && this.roadNodes.length) { v.ai = newAI(); this._teleport(v, focus); }
        }
        if (v.ai) this._traffic(v, dt, focus);
        else if (v.speed !== 0) v.drive(dt, NONE);
        else continue;
      }

      let impact = 0;
      for (let s = 1; s >= -1; s -= 2) {
        tmp.x = v.pos.x + v.fx * v.reach * s;
        tmp.z = v.pos.z + v.fz * v.reach * s;
        const ox = tmp.x, oz = tmp.z, spd = v.speed;
        if (physics.resolve(tmp, v.radius)) {
          v.pos.x += tmp.x - ox;
          v.pos.z += tmp.z - oz;
          const dot = Math.abs(v.fx * physics.nx + v.fz * physics.nz);
          const dotL = Math.abs(Math.cos(v.heading) * physics.nx - Math.sin(v.heading) * physics.nz);
          v.speed *= 1 - 0.9 * dot;
          v.vlat *= 1 - 0.6 * dotL;
          impact = Math.max(impact, Math.abs(spd) * dot);
        }
      }
      if (impact > 9 && v.driven && this.crashCooldown <= 0) {
        this.notify('Batida!');
        this.crashCooldown = 1.5;
      }
      v.pos.y = damp(v.pos.y, groundHeight(v.pos.x, v.pos.z), 14, dt);
    }

    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const ddx = a.pos.x - b.pos.x, ddz = a.pos.z - b.pos.z;
        const lim = (a.type.len + b.type.len) / 2 + 0.5;
        if (ddx * ddx + ddz * ddz > lim * lim) continue;
        if (!a.driven && !b.driven && a.speed === 0 && b.speed === 0) continue;
        const ma = a.driven ? 3 : 1, mb = b.driven ? 3 : 1;
        const min = a.radius + b.radius;
        for (let sa = -1; sa <= 1; sa += 2) {
          for (let sb = -1; sb <= 1; sb += 2) {
            const dx = a.pos.x + a.fx * a.reach * sa - (b.pos.x + b.fx * b.reach * sb);
            const dz = a.pos.z + a.fz * a.reach * sa - (b.pos.z + b.fz * b.reach * sb);
            const d2 = dx * dx + dz * dz;
            if (d2 >= min * min) continue;
            const d = Math.sqrt(d2) || 0.01;
            const nx = dx / d, nz = dz / d, pen = min - d;
            a.pos.x += nx * pen * (mb / (ma + mb)); a.pos.z += nz * pen * (mb / (ma + mb));
            b.pos.x -= nx * pen * (ma / (ma + mb)); b.pos.z -= nz * pen * (ma / (ma + mb));
            const vn = (a.fx * a.speed - b.fx * b.speed) * nx + (a.fz * a.speed - b.fz * b.speed) * nz;
            if (vn < 0) {
              const j2 = -vn * 0.6;
              a.speed += (a.fx * nx + a.fz * nz) * j2 * (mb / (ma + mb));
              b.speed -= (b.fx * nx + b.fz * nz) * j2 * (ma / (ma + mb));
              if (-vn > 8 && (a.driven || b.driven) && this.crashCooldown <= 0) {
                this.notify('Batida!');
                this.crashCooldown = 1.5;
              }
            }
          }
        }
      }
    }
    if (focus) {
      const r2 = LOD_DIST * LOD_DIST, cull2 = CAR_CULL_DIST * CAR_CULL_DIST, sh2 = SHADOW_DIST * SHADOW_DIST;
      for (const v of L) {
        const d2 = (v.pos.x - focus.x) ** 2 + (v.pos.z - focus.z) ** 2;
        v.setLod(d2 > r2);
        v.group.visible = d2 < cull2 || v.driven;
        v.setShadow(CAR_SHADOWS && (d2 < sh2 || v.driven));
      }
    }
    for (const v of L) v.sync();
  }
}