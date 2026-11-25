import * as THREE from 'three';
import { makeRng, blockCenter, mat, groundHeight, CITY } from './utils.js';

const { N, HALF } = CITY;

// Acumula instâncias e cria um único InstancedMesh (poucas draw calls para objetos repetidos).
class Batch {
  constructor(geo, material, cast = false, receive = false) {
    this.geo = geo; this.material = material; this.cast = cast; this.receive = receive; this.items = [];
  }
  add(x, y, z, ry, sx, sy, sz, color = 0xffffff) {
    this.items.push([x, y, z, ry, sx, sy, sz, color]);
    return this.items.length - 1;
  }
  build(scene) {
    if (!this.items.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.material, this.items.length);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    this.items.forEach((it, i) => {
      d.position.set(it[0], it[1], it[2]);
      d.rotation.set(0, it[3], 0);
      d.scale.set(it[4], it[5], it[6]);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      m.setColorAt(i, c.set(it[7]));
    });
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
    m.castShadow = this.cast;
    m.receiveShadow = this.receive;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
}

// ---------- Texturas de janelas (desenhadas em canvas, sem arquivos externos) ----------
function makeBase(glass) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  if (glass) {
    g.fillStyle = '#a9c6e0'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#4d7396'; g.fillRect(3, 5, 58, 26);
    g.fillStyle = '#6b93b8'; g.fillRect(3, 37, 58, 22);
    g.fillStyle = '#e8eef4'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 32, 64, 2);
  } else {
    g.fillStyle = '#e6e3dc'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3b556f'; g.fillRect(14, 12, 36, 34);
    g.fillStyle = '#5d7d9a'; g.fillRect(14, 12, 36, 8);
    g.fillStyle = '#bdb8ac'; g.fillRect(11, 46, 42, 5);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const BASES = { false: null, true: null };
const texCache = new Map();
function windowTex(glass, rx, ry) {
  const key = `${glass}_${rx}_${ry}`;
  let t = texCache.get(key);
  if (!t) {
    if (!BASES[glass]) BASES[glass] = makeBase(glass);
    t = BASES[glass].clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    texCache.set(key, t);
  }
  return t;
}

const CUBE = new THREE.BoxGeometry(1, 1, 1);
const ROOF_GEO = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4);
const ROOF_MAT = mat(0x5a5e66);

const PALETTE = [0xd9cfc1, 0xc7b9a6, 0xb8c4cf, 0xe0c9a6, 0xcfd6c2, 0xd8b4a0, 0xbfc3c9, 0xe8e0d0];
const GLASS = [0xa9c6e0, 0x8fb0cc, 0x9fd0d8, 0xb8c4d8];
const HOUSE = [0xf2e3c6, 0xe8c4a0, 0xc9d9c2, 0xd9d2e9, 0xf0d0d0];
const ROOFS = [0x8a3b2c, 0x5c3a2a, 0x44505e, 0x7a4a2a];
const AWN = [0xd64545, 0x2b8cd6, 0xe8a42b, 0x2eaa6a, 0xb04bd6];
const TREE = [0x3f8a3a, 0x4b9a44, 0x2f7a3a, 0x5ca04a];

const ON = [0xff3030, 0xffc61a, 0x2bea6a];
const OFF = [0x3a1010, 0x3a2d05, 0x0d3318];

export function buildCity(scene, physics) {
  const rnd = makeRng(2026);
  const r = (a, b) => a + rnd() * (b - a);
  const choose = (arr) => arr[(rnd() * arr.length) | 0];

  const info = {
    buildings: [], blocks: [], nodes: [], roadSpots: [], parkingSpots: [],
    spawn: { x: 20, z: 12.5 },
    starterCar: { x: 6, z: 17, heading: Math.PI },
    update: () => {},
    randomSidewalkPoint: null,
  };

  // Chão: grama infinita + asfalto sob a cidade.
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), mat(0x5d9b4a));
  grass.position.y = -0.05; grass.receiveShadow = true; scene.add(grass);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + 60, 2 * HALF + 60).rotateX(-Math.PI / 2), mat(0x2f3338));
  asphalt.receiveShadow = true; scene.add(asphalt);

  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const box = new Batch(CUBE, white, false, true);
  const poles = new Batch(new THREE.CylinderGeometry(1, 1, 1, 8), white, true, false);
  const lampHeads = new Batch(CUBE, new THREE.MeshBasicMaterial({ color: 0xfff2b8 }));
  const foliage = new Batch(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), true, false);
  const signs = new Batch(new THREE.CylinderGeometry(1, 1, 0.08, 8).rotateX(Math.PI / 2), white);
  const housings = new Batch(CUBE, mat(0x1b1c1f));
  const lens = new Batch(CUBE, new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const lights = [];

  const pole = (x, z, h, rad, color) => {
    poles.add(x, h / 2, z, 0, rad, h, rad, color);
    physics.add(x, z, rad + 0.05, rad + 0.05, h);
  };
  const tree = (x, z, s = 1) => {
    poles.add(x, 1.1 * s, z, 0, 0.22 * s, 2.2 * s, 0.22 * s, 0x6b4a2b);
    foliage.add(x, 3.4 * s, z, 0, 1.7 * s, 1.9 * s, 1.7 * s, choose(TREE));
    physics.add(x, z, 0.4 * s, 0.4 * s, 6);
  };
  // Ponto na borda do quarteirão: e = 0 norte, 1 sul, 2 oeste, 3 leste.
  const edgePt = (cx, cz, e, along, off) =>
    e === 0 ? [cx + along, cz - off, 0, -1] : e === 1 ? [cx + along, cz + off, 0, 1] :
    e === 2 ? [cx - off, cz + along, -1, 0] : [cx + off, cz + along, 1, 0];

  // ---------- Prédios ----------
  function building(x, z, w, d, h, color, glass = false) {
    const rx = Math.max(1, Math.round(d / 3.6)), rz = Math.max(1, Math.round(w / 3.6)), ry = Math.max(1, Math.round(h / 3.6));
    const mx = new THREE.MeshLambertMaterial({ map: windowTex(glass, rx, ry), color });
    const mz = new THREE.MeshLambertMaterial({ map: windowTex(glass, rz, ry), color });
    const m = new THREE.Mesh(CUBE, [mx, mx, ROOF_MAT, ROOF_MAT, mz, mz]);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    m.updateMatrix(); m.matrixAutoUpdate = false;
    scene.add(m);
    physics.add(x, z, w / 2, d / 2, h);
    info.buildings.push({ x, z, w, d });
    return m;
  }
  function tower(x, z, w, d, h) {
    const glass = rnd() < 0.5;
    const col = glass ? choose(GLASS) : choose(PALETTE);
    building(x, z, w, d, h, col, glass);
    // coroamento escalonado (sem colisor extra: está dentro da mesma área)
    const m = new THREE.Mesh(CUBE, ROOF_MAT);
    m.scale.set(w * 0.5, h * 0.12, d * 0.5);
    m.position.set(x, h + h * 0.06, z);
    m.castShadow = true; m.updateMatrix(); m.matrixAutoUpdate = false;
    scene.add(m);
  }
  function house(x, z, w, d, h) {
    building(x, z, w, d, h, choose(HOUSE), false);
    const roof = new THREE.Mesh(ROOF_GEO, mat(choose(ROOFS)));
    roof.scale.set(w * 1.1, 2.8, d * 1.1);
    roof.position.set(x, h + 1.4, z);
    roof.castShadow = true; roof.updateMatrix(); roof.matrixAutoUpdate = false;
    scene.add(roof);
  }
  function shop(x, z, w, d, h) {
    building(x, z, w, d, h, choose(PALETTE), false);
    box.add(x, 3.3, z + d / 2 + 1.0, 0, w * 0.9, 0.25, 2.2, choose(AWN));
  }

  // ---------- Ruas: faixas centrais, faixas de pedestres, semáforos ----------
  for (let k = 0; k <= N; k++) {
    const c = -HALF + 80 * k;
    for (let s = -HALF + 4; s <= HALF - 4; s += 8) {
      const m = Math.round((s + HALF) / 80);
      if (Math.abs(s - (-HALF + 80 * m)) < 13) continue;
      box.add(s, 0.03, c, 0, 3, 0.04, 0.22, 0xe8c547);
      box.add(c, 0.03, s, 0, 0.22, 0.04, 3, 0xe8c547);
    }
  }
  for (let a = 0; a <= N; a++) {
    for (let b = 0; b <= N; b++) {
      const X = -HALF + 80 * a, Z = -HALF + 80 * b;
      for (const sgn of [-1, 1]) {
        // travessias da rua horizontal (faixas alongadas em x) e da vertical (alongadas em z)
        if (Math.abs(X + sgn * 13) < HALF - 2) for (let o = -8; o <= 8; o += 1.6) box.add(X + sgn * 13, 0.03, Z + o, 0, 3.4, 0.04, 0.8, 0xf2f2f2);
        if (Math.abs(Z + sgn * 13) < HALF - 2) for (let o = -8; o <= 8; o += 1.6) box.add(X + o, 0.03, Z + sgn * 13, 0, 0.8, 0.04, 3.4, 0xf2f2f2);
      }
      // semáforos nos cantos que têm calçada
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const px = X + sx * 11.5, pz = Z + sz * 11.5;
          if (groundHeight(px, pz) === 0) continue;
          pole(px, pz, 5.4, 0.09, 0x3a3d42);
          housings.add(px - sx * 0.3, 5.3, pz - sz * 0.3, 0, 0.5, 1.5, 0.5);
          const i0 = lens.items.length;
          for (let q = 0; q < 3; q++) lens.add(px - sx * 0.55, 5.8 - q * 0.5, pz - sz * 0.55, 0, 0.28, 0.28, 0.28, OFF[q]);
          lights.push({ g: sx * sz > 0 ? 0 : 1, i0 });
        }
      }
    }
  }

  // ---------- Quarteirões ----------
  const nodeGrid = [];
  for (let i = 0; i < N; i++) {
    nodeGrid[i] = [];
    for (let j = 0; j < N; j++) {
      const cx = blockCenter(i), cz = blockCenter(j);
      const mid = N / 2; // centro da cidade: 2x2 quarteirões centrais (3..4 em 8x8)
      const downtown = i >= mid - 1 && i <= mid && j >= mid - 1 && j <= mid;
      box.add(cx, 0.125, cz, 0, 60, 0.25, 60, 0x9c9ea3);

      const roll = rnd();
      const type = downtown ? (roll < 0.55 ? 'tower' : 'quad')
        : roll < 0.10 ? 'park' : roll < 0.18 ? 'parking' : roll < 0.40 ? 'tower' : roll < 0.66 ? 'quad' : 'houses';
      info.blocks.push({ x: cx, z: cz, type });
      const lot = type === 'park' || type === 'houses' ? 0x5b9a47 : type === 'parking' ? 0x3a3d42 : 0x8a8d92;
      box.add(cx, 0.26, cz, 0, 52, 0.02, 52, lot);

      if (type === 'tower') {
        tower(cx, cz, r(26, 38), r(26, 38), downtown ? r(70, 120) : r(40, 80));
      } else if (type === 'quad') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = cx + sx * 12.5, z = cz + sz * 12.5, w = r(15, 20), d = r(15, 20);
          if (rnd() < 0.3) shop(x, z, w, d, r(6, 9));
          else if (rnd() < 0.5) tower(x, z, w, d, downtown ? r(30, 65) : r(14, 40));
          else building(x, z, w, d, downtown ? r(25, 50) : r(10, 28), choose(PALETTE));
        }
      } else if (type === 'houses') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          house(cx + sx * 12.5, cz + sz * 12.5, r(10, 14), r(10, 13), r(4.5, 6));
        }
      } else if (type === 'park') {
        box.add(cx, 0.28, cz, 0, 12, 0.02, 12, 0x3a7bd5);        // lago
        box.add(cx, 0.275, cz, 0, 52, 0.02, 4, 0xcdb88a);        // trilhas
        box.add(cx, 0.275, cz, 0, 4, 0.02, 52, 0xcdb88a);
        for (let t = 0; t < 16; t++) {
          const x = cx + r(-22, 22), z = cz + r(-22, 22);
          if (Math.abs(x - cx) < 8 && Math.abs(z - cz) < 8) continue;
          if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
          tree(x, z, r(0.9, 1.4));
        }
        for (const s of [-1, 1]) {
          box.add(cx + s * 8, 0.6, cz + 3.4, 0, 2.2, 0.15, 0.6, 0x7a5230);
          physics.add(cx + s * 8, cz + 3.4, 1.1, 0.3, 1);
        }
      } else if (type === 'parking') {
        for (const row of [-1, 1]) {
          const zc = cz + row * 14;
          for (let s = 0; s <= 13; s++) {
            const x = cx - 23.4 + s * 3.6;
            box.add(x, 0.285, zc, 0, 0.14, 0.02, 5.6, 0xf2f2f2);
            if (s < 13) info.parkingSpots.push({ x: x + 1.8, z: zc, heading: row > 0 ? Math.PI : 0 });
          }
        }
      }

      // Postes, árvores de calçada, placas
      for (let e = 0; e < 4; e++) {
        for (const al of [-16, 16]) {
          const [x, z] = edgePt(cx, cz, e, al, 29.3);
          pole(x, z, 7, 0.12, 0x44484f);
          lampHeads.add(x, 7.1, z, 0, 0.9, 0.2, 0.5);
        }
        for (const al of [-6, 7]) {
          if (rnd() < 0.7) { const [x, z] = edgePt(cx, cz, e, al, 28.4); tree(x, z, r(0.8, 1.1)); }
        }
      }
      for (let s = 0; s < 2; s++) {
        const [x, z, nx, nz] = edgePt(cx, cz, (rnd() * 4) | 0, r(-12, 12), 29.6);
        pole(x, z, 2.6, 0.05, 0x888c92);
        signs.add(x, 2.7, z, Math.atan2(nx, nz), 0.5, 0.5, 1, choose([0xd32f2f, 0x1565c0, 0xf9a825, 0x2e7d32]));
      }

      // Grafo de calçadas (cantos do quarteirão) usado pela IA dos NPCs
      nodeGrid[i][j] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: cx + sx * 27, z: cz + sz * 27, n: [] }));
    }
  }

  const link = (a, b) => { a.n.push(b); b.n.push(a); };
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const c = nodeGrid[i][j];
      for (let k = 0; k < 4; k++) link(c[k], c[(k + 1) % 4]);
      if (i < N - 1) { link(c[1], nodeGrid[i + 1][j][0]); link(c[2], nodeGrid[i + 1][j][3]); }
      if (j < N - 1) { link(c[3], nodeGrid[i][j + 1][0]); link(c[2], nodeGrid[i][j + 1][1]); }
      info.nodes.push(...c);
    }
  }
  info.randomSidewalkPoint = () => {
    const a = info.nodes[(Math.random() * info.nodes.length) | 0];
    const b = a.n[(Math.random() * a.n.length) | 0];
    const t = 0.1 + Math.random() * 0.8;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };

  // Vagas de carros nas faixas das ruas (mão direita)
  for (let k = 1; k <= N - 1; k++) {
    const c = -HALF + 80 * k;
    for (let m = 0; m < N; m++) {
      const mid = blockCenter(m);
      info.roadSpots.push(
        { x: mid + r(-8, 8), z: c + 5.5, heading: Math.PI / 2 },
        { x: mid + r(-8, 8), z: c - 5.5, heading: -Math.PI / 2 },
        { x: c - 5.5, z: mid + r(-8, 8), heading: 0 },
        { x: c + 5.5, z: mid + r(-8, 8), heading: Math.PI },
      );
    }
  }

  // ---------- Grafo de ruas (tráfego dos carros) ----------
  // Por cruzamento (a, b) e sentido h (mão direita: faixa a 5,5 m do eixo), há dois nós:
  //  - chegada (exit = false): o carro entra no cruzamento no sentido h. Vai em frente ou começa uma curva.
  //  - saída (exit = true): o carro já está na curva, com o novo sentido. Só segue em frente.
  // Assim uma curva nunca vira outra curva no mesmo cruzamento (antes o carro girava em círculo).
  // Curvas que saem do mapa não são criadas, então todo nó de chegada tem pelo menos uma saída.
  const ROAD_LANE = 5.5;
  const ROAD_STEP = [[0, 1], [1, 0], [0, -1], [-1, 0]];       // próximo cruzamento por sentido h
  const ROAD_HEAD = [0, Math.PI / 2, Math.PI, -Math.PI / 2];  // heading de cada sentido h
  const inGrid = (a, b) => a >= 0 && a <= N && b >= 0 && b <= N;
  const roadIdx = (a, b, h, exit) => ((a * (N + 1) + b) * 4 + h) * 2 + (exit ? 1 : 0);
  const roadNodes = [];
  for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) for (let h = 0; h < 4; h++) for (const exit of [false, true]) {
    const X = -HALF + 80 * a, Z = -HALF + 80 * b, th = ROAD_HEAD[h];
    roadNodes.push({ x: X - Math.cos(th) * ROAD_LANE, z: Z + Math.sin(th) * ROAD_LANE, heading: th, n: [], exit });
  }
  for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) for (let h = 0; h < 4; h++) {
    const arr = roadNodes[roadIdx(a, b, h, false)];
    const ex = roadNodes[roadIdx(a, b, h, true)];
    // em frente: vai ao cruzamento seguinte, já como chegada
    const fa = a + ROAD_STEP[h][0], fb = b + ROAD_STEP[h][1];
    if (inGrid(fa, fb)) arr.n.push(roadNodes[roadIdx(fa, fb, h, false)]);
    // curvas à esquerda (h+1) e à direita (h+3): entram na saída do mesmo cruzamento
    for (const hh of [(h + 1) % 4, (h + 3) % 4]) {
      if (inGrid(a + ROAD_STEP[hh][0], b + ROAD_STEP[hh][1])) arr.n.push(roadNodes[roadIdx(a, b, hh, true)]);
    }
    // saída de curva: segue em frente para o cruzamento seguinte
    if (inGrid(fa, fb)) ex.n.push(roadNodes[roadIdx(fa, fb, h, false)]);
  }
  info.roadNodes = roadNodes;
  info.roadStarts = roadNodes.filter((n) => !n.exit); // onde os carros podem nascer ou reaparecer

  box.build(scene); poles.build(scene); lampHeads.build(scene); foliage.build(scene);
  signs.build(scene); housings.build(scene);
  const lensMesh = lens.build(scene);

  // Semáforos: ciclo de 12 s; os dois grupos ficam em fases opostas.
  let timer = 0, lastA = -1, lastB = -1;
  const stateOf = (t) => (t < 5 ? 0 : t < 6 ? 1 : 2); // 0 verde, 1 amarelo, 2 vermelho
  const col = new THREE.Color();
  info.update = (dt) => {
    timer += dt;
    const sA = stateOf(timer % 12), sB = stateOf((timer + 6) % 12);
    if (sA === lastA && sB === lastB) return;
    lastA = sA; lastB = sB;
    for (const l of lights) {
      const s = l.g ? sB : sA;
      for (let q = 0; q < 3; q++) {
        const lit = (q === 0 && s === 2) || (q === 1 && s === 1) || (q === 2 && s === 0);
        lensMesh.setColorAt(l.i0 + q, col.set(lit ? ON[q] : OFF[q]));
      }
    }
    lensMesh.instanceColor.needsUpdate = true;
  };

  return info;
}