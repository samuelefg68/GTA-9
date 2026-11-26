import * as THREE from 'three';
import { makeRng, blockCenter, mat, groundHeight, CITY } from './utils.js';
import { createBuildings, setBuildingsGraphics } from './buildings.js';

const { N, HALF } = CITY;

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

// ---------- Texturas Procedurais Aprimoradas ----------
function makeAsphaltTex() {
  const S = 512;
  const cvMap = document.createElement('canvas');
  const cvRough = document.createElement('canvas');
  const cvBump = document.createElement('canvas');
  cvMap.width = cvMap.height = cvRough.width = cvRough.height = cvBump.width = cvBump.height = S;

  const gm = cvMap.getContext('2d');
  const gr = cvRough.getContext('2d');
  const gb = cvBump.getContext('2d');

  // RNG com semente: o asfalto é igual a cada carregamento
  const rnd = makeRng(7331);

  // Fundo do asfalto
  gm.fillStyle = '#2d3135'; gm.fillRect(0, 0, S, S);
  gr.fillStyle = '#d8d8d8'; gr.fillRect(0, 0, S, S); // Fosco
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, S, S); // Bump neutro

  // Desenha também do outro lado quando cruza a borda (textura sem emendas)
  const tiled = (x, y, rad, draw) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = x + ox, py = y + oy;
      if (px + rad >= 0 && px - rad <= S && py + rad >= 0 && py - rad <= S) draw(px, py);
    }
  };

  // Manchas suaves de desgaste
  for (let i = 0; i < 45; i++) {
    const rad = 25 + rnd() * 65;
    const tone = rnd() < 0.5 ? '0,0,0' : '150,155,160';
    tiled(rnd() * S, rnd() * S, rad, (x, y) => {
      const grad = gm.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${tone},0.07)`);
      grad.addColorStop(1, `rgba(${tone},0)`);
      gm.fillStyle = grad;
      gm.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    });
  }

  const gray = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
  const dot = (g, x, y, rx, ry, ang) => {
    g.beginPath(); g.ellipse(x, y, rx, ry, ang, 0, Math.PI * 2); g.fill();
  };

  // Granulação fina
  for (let i = 0; i < 38000; i++) {
    const x = (rnd() * S) | 0, y = (rnd() * S) | 0, light = rnd() < 0.35, sz = rnd() < 0.8 ? 1 : 2;
    gm.fillStyle = light ? `rgba(190,190,185,${0.06 + rnd() * 0.14})` : `rgba(0,0,0,${0.1 + rnd() * 0.22})`;
    gm.fillRect(x, y, sz, sz);
    gb.fillStyle = gray(light ? 140 + rnd() * 30 : 90 + rnd() * 30);
    gb.fillRect(x, y, sz, sz);
  }

  // Pedrinhas (brita) de tamanhos e tons variados
  for (let i = 0; i < 2600; i++) {
    const rx = 1 + rnd() * rnd() * 3, ry = rx * (0.6 + rnd() * 0.4), ang = rnd() * Math.PI;
    const v = 55 + rnd() * 65, warm = rnd() * 8, height = 145 + rnd() * 45, rough = 165 + rnd() * 60;
    tiled(rnd() * S, rnd() * S, rx + 1, (x, y) => {
      gm.fillStyle = 'rgba(0,0,0,0.25)'; dot(gm, x + 0.7, y + 0.9, rx, ry, ang);
      gm.fillStyle = `rgba(${(v + warm) | 0},${v | 0},${(v - warm * 0.5) | 0},0.75)`; dot(gm, x, y, rx, ry, ang);
      gb.fillStyle = gray(height); dot(gb, x, y, rx, ry, ang);
      gr.fillStyle = gray(rough); dot(gr, x, y, rx, ry, ang);
    });
  }

  // Rachaduras finas e ramificadas
  const line = (g, pts, ox, oy, style, width) => {
    g.strokeStyle = style; g.lineWidth = width; g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x + ox, y + oy) : g.moveTo(x + ox, y + oy)));
    g.stroke();
  };
  const crack = (x, y, ang, steps, width) => {
    const pts = [[x, y]], branches = [];
    for (let j = 0; j < steps; j++) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * 9; y += Math.sin(ang) * 9;
      pts.push([x, y]);
      if (width > 0.9 && rnd() < 0.15) branches.push([x, y, ang + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.6)]);
    }
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      line(gm, pts, ox, oy, 'rgba(8,9,10,0.45)', width);
      line(gb, pts, ox, oy, 'rgba(40,40,40,0.75)', width + 0.4);
    }
    for (const [bx, by, ba] of branches) crack(bx, by, ba, 3 + ((rnd() * 4) | 0), width * 0.6);
  };
  for (let i = 0; i < 4; i++) crack(rnd() * S, rnd() * S, rnd() * Math.PI * 2, 8 + ((rnd() * 10) | 0), 1.4);

  const wrap = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.repeat.set(120, 120); // Repetição no mapa
    return t;
  };
  return { map: wrap(cvMap, true), rough: wrap(cvRough, false), bump: wrap(cvBump, false) };
}

let asphaltMatNormal = null;
let asphaltMatCine = null;

function getAsphaltMat(cine, envTex) {
    if (!cine) {
        if (!asphaltMatNormal) asphaltMatNormal = new THREE.MeshLambertMaterial({ color: 0x2f3338 });
        return asphaltMatNormal;
    }
    if (!asphaltMatCine) {
        const tex = makeAsphaltTex();
        asphaltMatCine = new THREE.MeshStandardMaterial({
            map: tex.map,
            roughnessMap: tex.rough,
            bumpMap: tex.bump,
            bumpScale: 0.02,
            color: 0xffffff,
            roughness: 1.0,
            metalness: 0.0, // Asfalto não é metal
            envMap: envTex || null,
            envMapIntensity: 0.3
        });
    } else if (envTex && asphaltMatCine.envMap !== envTex) {
        asphaltMatCine.envMap = envTex;
        asphaltMatCine.needsUpdate = true;
    }
    return asphaltMatCine;
}


let asphaltMesh = null; // referência para o asfalto (troca de material Normal/Cinematográfico)

export function setCityGraphics(cine, envTex) {
  setBuildingsGraphics(cine, envTex);
  if (asphaltMesh) {
    asphaltMesh.material = getAsphaltMat(cine, envTex);
  }
}

const CUBE = new THREE.BoxGeometry(1, 1, 1);

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
  const bld = createBuildings(scene, physics, info, rnd);

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), mat(0x5d9b4a));
  grass.position.y = -0.05; grass.receiveShadow = true; scene.add(grass);
  
  // Modificado: usa getAsphaltMat e armazena na global para atualização
  asphaltMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + 60, 2 * HALF + 60).rotateX(-Math.PI / 2), getAsphaltMat(false, null));
  asphaltMesh.receiveShadow = true; scene.add(asphaltMesh);

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
  const edgePt = (cx, cz, e, along, off) =>
    e === 0 ? [cx + along, cz - off, 0, -1] : e === 1 ? [cx + along, cz + off, 0, 1] :
    e === 2 ? [cx - off, cz + along, -1, 0] : [cx + off, cz + along, 1, 0];

  // Loja: prédio de tijolo baixo (frente +z) com toldo colorido.
  function shop(x, z, w, d, h) {
    const { W, D } = bld.brick(x, z, w, d, h, 0, 2);
    box.add(x, 3.3, z + D / 2 + 1.0, 0, W * 0.9, 0.25, 2.2, choose(AWN));
  }

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
        if (Math.abs(X + sgn * 13) < HALF - 2) for (let o = -8; o <= 8; o += 1.6) box.add(X + sgn * 13, 0.03, Z + o, 0, 3.4, 0.04, 0.8, 0xf2f2f2);
        if (Math.abs(Z + sgn * 13) < HALF - 2) for (let o = -8; o <= 8; o += 1.6) box.add(X + o, 0.03, Z + sgn * 13, 0, 0.8, 0.04, 3.4, 0xf2f2f2);
      }
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

  const nodeGrid = [];
  for (let i = 0; i < N; i++) {
    nodeGrid[i] = [];
    for (let j = 0; j < N; j++) {
      const cx = blockCenter(i), cz = blockCenter(j);
      const mid = N / 2;
      const downtown = i >= mid - 1 && i <= mid && j >= mid - 1 && j <= mid;
      box.add(cx, 0.125, cz, 0, 60, 0.25, 60, 0x9c9ea3);

      const roll = rnd();
      const type = downtown ? (roll < 0.55 ? 'tower' : 'quad')
        : roll < 0.10 ? 'park' : roll < 0.18 ? 'parking' : roll < 0.40 ? 'tower' : roll < 0.66 ? 'quad' : 'houses';
      info.blocks.push({ x: cx, z: cz, type });
      const lot = type === 'park' || type === 'houses' ? 0x5b9a47 : type === 'parking' ? 0x3a3d42 : 0x8a8d92;
      box.add(cx, 0.26, cz, 0, 52, 0.02, 52, lot);

      if (type === 'tower') {
        bld.tower(cx, cz, r(26, 38), r(26, 38), downtown ? r(70, 120) : r(40, 80), rnd() < 0.5 ? 0 : Math.PI);
      } else if (type === 'quad') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const x = cx + sx * 12.5, z = cz + sz * 12.5, w = r(15, 20), d = r(15, 20);
          const ry = sz > 0 ? 0 : Math.PI; // frente voltada para a rua
          if (rnd() < 0.3) shop(x, z, w, d, r(6, 9));
          else if (downtown || rnd() < 0.45) bld.tower(x, z, w, d, downtown ? r(30, 65) : r(14, 40), ry);
          else bld.brick(x, z, w, d, r(10, 28), ry);
        }
      } else if (type === 'houses') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          bld.modern(cx + sx * 12.5, cz + sz * 12.5, r(10, 14), r(10, 13), sz > 0 ? 0 : Math.PI);
        }
      } else if (type === 'park') {
        box.add(cx, 0.28, cz, 0, 12, 0.02, 12, 0x3a7bd5);
        box.add(cx, 0.275, cz, 0, 52, 0.02, 4, 0xcdb88a);
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

  const ROAD_LANE = 5.5;
  const ROAD_STEP = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const ROAD_HEAD = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
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
    const fa = a + ROAD_STEP[h][0], fb = b + ROAD_STEP[h][1];
    if (inGrid(fa, fb)) arr.n.push(roadNodes[roadIdx(fa, fb, h, false)]);
    for (const hh of [(h + 1) % 4, (h + 3) % 4]) {
      if (inGrid(a + ROAD_STEP[hh][0], b + ROAD_STEP[hh][1])) arr.n.push(roadNodes[roadIdx(a, b, hh, true)]);
    }
    if (inGrid(fa, fb)) ex.n.push(roadNodes[roadIdx(fa, fb, h, false)]);
  }
  info.roadNodes = roadNodes;
  info.roadStarts = roadNodes.filter((n) => !n.exit);

  bld.build();
  box.build(scene); poles.build(scene); lampHeads.build(scene); foliage.build(scene);
  const signsMesh = signs.build(scene), housingsMesh = housings.build(scene);
  const lensMesh = lens.build(scene);
  // Detalhes pequenos ficam fora do reflexo das poças (puddles.js)
  for (const o of [signsMesh, housingsMesh, lensMesh]) if (o) o.userData.noReflect = true;

  let timer = 0, lastA = -1, lastB = -1;
  const stateOf = (t) => (t < 5 ? 0 : t < 6 ? 1 : 2);
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