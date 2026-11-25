import * as THREE from 'three';

// Layout da cidade: 8x8 quarteirões de 60 m, ruas de 20 m (passo de 80 m).
// A cidade antiga (6x6) fica no centro; as duas colunas/linhas extras são a borda nova.
export const CITY = { N: 8, PITCH: 80, ROAD: 20, BLOCK: 60, HALF: 320, LIMIT: 326 };
// Área jogável a oeste: estende o limite do lado oeste até a pista (o avião voa além)
export const AIRFIELD = { XMIN: -380 };
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}
export const angleLerp = (a, b, t) => a + angleDiff(a, b) * t;

// Gerador pseudo-aleatório determinístico (a cidade é sempre a mesma).
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const blockCenter = (i) => -CITY.HALF + CITY.PITCH / 2 + i * CITY.PITCH;
const inBlock = (v) => {
  const i = Math.floor((v + CITY.HALF) / CITY.PITCH);
  return i >= 0 && i < CITY.N && Math.abs(v - blockCenter(i)) < 30;
};
// Altura do chão: calçadas ficam 0.25 m acima do asfalto.
export const groundHeight = (x, z) => (inBlock(x) && inBlock(z) ? 0.25 : 0);

// Materiais compartilhados (um por cor).
const mats = new Map();
export function mat(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, ...opts });
    mats.set(key, m);
  }
  return m;
}

// ---------- Humanoide procedural (jogador e NPCs) ----------
const HG = {
  torso: new THREE.BoxGeometry(0.5, 0.6, 0.28),
  head: new THREE.BoxGeometry(0.28, 0.3, 0.28),
  hair: new THREE.BoxGeometry(0.3, 0.12, 0.3),
  leg: new THREE.BoxGeometry(0.2, 0.9, 0.22),
  arm: new THREE.BoxGeometry(0.15, 0.65, 0.18),
};

export function createHumanoid({ shirt, pants, skin, hair }) {
  const g = new THREE.Group();
  const part = (geo, color, x, y) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, 0);
    m.castShadow = true;
    g.add(m);
  };
  const limb = (geo, color, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.y = -geo.parameters.height / 2;
    m.castShadow = true;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  part(HG.torso, shirt, 0, 1.2);
  part(HG.head, skin, 0, 1.65);
  part(HG.hair, hair, 0, 1.86);
  g.userData.legL = limb(HG.leg, pants, -0.13, 0.9);
  g.userData.legR = limb(HG.leg, pants, 0.13, 0.9);
  g.userData.armL = limb(HG.arm, shirt, -0.36, 1.48);
  g.userData.armR = limb(HG.arm, shirt, 0.36, 1.48);
  return g;
}

export function animateHumanoid(h, phase, amount) {
  const u = h.userData;
  const s = Math.sin(phase) * amount;
  u.legL.rotation.x = s;
  u.legR.rotation.x = -s;
  u.armL.rotation.x = -s * 0.8;
  u.armR.rotation.x = s * 0.8;
}

export function setSeated(h, on) {
  const u = h.userData;
  u.legL.rotation.x = u.legR.rotation.x = on ? -Math.PI / 2 : 0;
  u.armL.rotation.x = u.armR.rotation.x = on ? -1.1 : 0;
}