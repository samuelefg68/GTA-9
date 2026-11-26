import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from './utils.js';

// Prédios procedurais da cidade, em três estilos:
//   brick  (A) bloco de tijolo laranja em "L", base de pedra e cornijas claras
//   tower  (B) torre bege com janelas acesas e faixa vertical de ripas na frente
//   modern (C) casa moderna rosa/azul com varanda, deck externo e pinheiros low-poly
//
// Toda a geometria é gerada em coordenadas locais, ganha UV em METROS (dividido pelo
// tamanho do ladrilho) e é mesclada por material. A cidade inteira vira meia dúzia de
// malhas. As medidas dos blocos são múltiplos do ladrilho para as janelas fecharem
// certinho nas quinas. A frente do prédio é sempre +z local; `ry` (0 ou π) gira o
// prédio e mantém os colisores AABB alinhados aos eixos.

// Tamanho de um ladrilho de textura, em metros: uma janela por andar.
export const TILE = {
  brick: { tw: 3.4, th: 3.6 },
  tower: { tw: 3.6, th: 3.3 },
  modern: { tw: 4.0, th: 3.2 },
  wood: { tw: 0.9, th: 3.6 },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Texturas procedurais (desenhadas em um espaço fixo de 128×128) ----------

const SEED = { brick: 11, tower: 23, modern: 37, wood: 41 };
const BRICK_ROWS = 24, BRICK_W = 16, BRICK_H = 128 / BRICK_ROWS;

const DRAW = {
  brick: {
    color(g, rnd) {
      g.fillStyle = '#cbb79c'; g.fillRect(0, 0, 128, 128);
      for (let r = 0; r < BRICK_ROWS; r++) {
        const off = (r % 2) * BRICK_W / 2;
        for (let x = -BRICK_W; x < 128 + BRICK_W; x += BRICK_W) {
          g.fillStyle = `hsl(${16 + rnd() * 8}, ${42 + rnd() * 12}%, ${48 + rnd() * 12}%)`;
          g.fillRect(x + off + 0.5, r * BRICK_H + 0.4, BRICK_W - 1, BRICK_H - 0.8);
        }
      }
      g.fillStyle = '#e6d9bf'; g.fillRect(30, 18, 68, 92);            // moldura de pedra
      const gr = g.createLinearGradient(0, 26, 0, 102);
      gr.addColorStop(0, '#6fa6d8'); gr.addColorStop(1, '#2f5d91');
      g.fillStyle = gr; g.fillRect(36, 26, 56, 76);                    // vidro escuro
      g.fillStyle = '#e6d9bf'; g.fillRect(62, 26, 4, 76); g.fillRect(36, 52, 56, 3); // caixilho
      g.fillStyle = '#cdbf9f'; g.fillRect(27, 108, 74, 5);             // peitoril
    },
    bump(g) {
      g.fillStyle = '#707070'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#9c9c9c';
      for (let r = 0; r < BRICK_ROWS; r++) {
        const off = (r % 2) * BRICK_W / 2;
        for (let x = -BRICK_W; x < 128 + BRICK_W; x += BRICK_W) g.fillRect(x + off + 0.5, r * BRICK_H + 0.4, BRICK_W - 1, BRICK_H - 0.8);
      }
      g.fillStyle = '#c8c8c8'; g.fillRect(30, 18, 68, 92);
      g.fillStyle = '#282828'; g.fillRect(36, 26, 56, 76);
      g.fillStyle = '#c8c8c8'; g.fillRect(62, 26, 4, 76); g.fillRect(36, 52, 56, 3);
    },
  },
  tower: {
    color(g, rnd) {
      g.fillStyle = '#d3c9b8'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#c6bba8';
      for (let y = 0; y < 128; y += 4) g.fillRect(0, y, 128, 1);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(90,85,80,${0.05 + rnd() * 0.07})`; g.fillRect(rnd() * 126, rnd() * 126, 2 + rnd() * 3, 2); }
      g.fillStyle = '#8c8e92'; g.fillRect(0, 112, 128, 8);              // laje da varanda
      g.fillStyle = '#666a70'; g.fillRect(0, 120, 128, 3);
      g.fillStyle = '#34475c'; g.fillRect(14, 18, 100, 86);             // moldura
      const gr = g.createLinearGradient(0, 22, 0, 100);
      gr.addColorStop(0, '#8ec5f2'); gr.addColorStop(1, '#3f78b8');
      g.fillStyle = gr; g.fillRect(18, 22, 92, 78);                     // vidro com luz quente
      g.fillStyle = '#34475c'; g.fillRect(62, 22, 3, 78); g.fillRect(18, 48, 92, 3);
    },
    bump(g) {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#909090'; g.fillRect(0, 112, 128, 8);
      g.fillStyle = '#b0b0b0'; g.fillRect(14, 18, 100, 86);
      g.fillStyle = '#303030'; g.fillRect(18, 22, 92, 78);
      g.fillStyle = '#b0b0b0'; g.fillRect(62, 22, 3, 78); g.fillRect(18, 48, 92, 3);
    },
  },
  modern: {
    color(g, rnd) {
      g.fillStyle = '#f2eee8'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(90,80,70,${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * 127, rnd() * 127, 1 + rnd() * 2, 1 + rnd() * 2); }
      g.fillStyle = '#dcdcdc'; g.fillRect(10, 16, 108, 92);             // esquadria
      const gr = g.createLinearGradient(0, 20, 0, 104);
      gr.addColorStop(0, '#7ab2e4'); gr.addColorStop(1, '#2f5f93');
      g.fillStyle = gr; g.fillRect(14, 20, 100, 84);                    // vidro
      g.fillStyle = '#e0e0e0'; g.fillRect(46, 20, 3, 84); g.fillRect(79, 20, 3, 84); g.fillRect(14, 66, 100, 3);
      g.fillStyle = '#bdbdbd'; g.fillRect(8, 106, 112, 4);              // peitoril
    },
    bump(g) {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#a8a8a8'; g.fillRect(10, 16, 108, 92);
      g.fillStyle = '#303030'; g.fillRect(14, 20, 100, 84);
      g.fillStyle = '#a8a8a8'; g.fillRect(46, 20, 3, 84); g.fillRect(79, 20, 3, 84); g.fillRect(14, 66, 100, 3);
    },
  },
  wood: {
    color(g) {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#8c5b34' : '#5e3c22'; g.fillRect(i * 16, 0, 16, 128);
        g.fillStyle = '#3a2412'; g.fillRect(i * 16, 0, 1, 128);
      }
    },
    bump(g) {
      for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#a0a0a0' : '#606060'; g.fillRect(i * 16, 0, 16, 128); }
    },
  },
};

const mapCache = new Map();
const bumpCache = new Map();

function paintCanvas(key, kind, S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.scale(S / 128, S / 128);
  DRAW[key][kind](g, makeRng(SEED[key]));
  return c;
}
function setupTex(t, srgb) {
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function getMap(key, S) {
  const id = key + S;
  let t = mapCache.get(id);
  if (!t) { t = setupTex(new THREE.CanvasTexture(paintCanvas(key, 'color', S)), true); mapCache.set(id, t); }
  return t;
}
function getBump(key, S) {
  const id = key + S;
  let t = bumpCache.get(id);
  if (!t) { t = setupTex(new THREE.CanvasTexture(paintCanvas(key, 'bump', S)), false); bumpCache.set(id, t); }
  return t;
}

// ---------- Materiais (Normal = Lambert simples; Cinematográfico = Standard com relevo) ----------

const matCache = new Map();
let curCine = false;
let curEnv = null;

function getMat(key, cine, envTex) {
  const id = key + (cine ? '_c' : '_n');
  let m = matCache.get(id);
  const textured = key !== 'plain';
  if (!m) {
    if (!cine) {
      m = new THREE.MeshLambertMaterial({ vertexColors: true, map: textured ? getMap(key, 128) : null });
    } else {
      m = new THREE.MeshStandardMaterial({
        vertexColors: true,
        map: textured ? getMap(key, 256) : null,
        bumpMap: textured ? getBump(key, 256) : null,
        bumpScale: 0.08,
        roughness: 0.9,
        metalness: 0.05,
        envMap: envTex || null,
        envMapIntensity: 0.6,
      });
    }
    matCache.set(id, m);
  } else if (cine && envTex && m.envMap !== envTex) {
    m.envMap = envTex;
    m.needsUpdate = true;
  }
  return m;
}

let meshes = {};

// Chamado por city.js → setCityGraphics.
export function setBuildingsGraphics(cine, envTex) {
  curCine = !!cine;
  curEnv = envTex || null;
  for (const [key, mesh] of Object.entries(meshes)) mesh.material = getMat(key, curCine, curEnv);
}

// ---------- Acúmulo de geometria ----------

const lists = { plain: [], brick: [], tower: [], modern: [], wood: [] };
const _mat = new THREE.Matrix4();
const _col = new THREE.Color();

// Geometria já posicionada em coordenadas locais. (ox, oy, oz) é o canto mínimo usado como
// origem do UV, para as janelas começarem alinhadas ao piso e à quina da parede.
function bake(key, geo, ctx, color, ox, oy, oz) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  const cnt = p.count;
  const col = new Float32Array(cnt * 3);
  const t = TILE[key];
  _col.set(color);
  for (let i = 0; i < cnt; i++) {
    if (t) {
      const px = p.getX(i) - ox, py = p.getY(i) - oy, pz = p.getZ(i) - oz;
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, px / t.tw, pz / t.tw);
      else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, pz / t.tw, py / t.th);
      else uv.setXY(i, px / t.tw, py / t.th);
    }
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  _mat.makeRotationY(ctx.ry).setPosition(ctx.x, 0, ctx.z);
  geo.applyMatrix4(_mat);
  lists[key].push(geo);
}

function box(key, ctx, cx, cy, cz, sx, sy, sz, color = 0xffffff) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  bake(key, g, ctx, color, cx - sx / 2, cy - sy / 2, cz - sz / 2);
}

function cone(ctx, cx, cy, cz, r, h, color) {
  const g = new THREE.ConeGeometry(r, h, 6);
  g.translate(cx, cy, cz);
  bake('plain', g, ctx, color, 0, 0, 0);
}

// Guarda-corpo de barras horizontais (imagem 4).
function rail(ctx, y0, cx, cz, len, alongX, color = 0xc8ccd0) {
  const sx = alongX ? len : 0.06, sz = alongX ? 0.06 : len;
  box('plain', ctx, cx, y0 + 1.0, cz, sx, 0.07, sz, color);
  box('plain', ctx, cx, y0 + 0.5, cz, sx, 0.05, sz, color);
  const n = Math.max(2, Math.round(len / 2));
  for (let i = 0; i <= n; i++) {
    const o = -len / 2 + (len * i) / n;
    box('plain', ctx, alongX ? cx + o : cx, y0 + 0.5, alongX ? cz : cz + o, 0.07, 1.0, 0.07, color);
  }
}

const BRICK_TINT = [0xffffff, 0xf2e2d2, 0xe8d0c0, 0xf8ecd8];
const TOWER_TINT = [0xffffff, 0xf4efe8, 0xe8e4dc, 0xeee8e0];
const LOWER = [0xe49a8a, 0xe8b48a, 0xd9c28f, 0xc9d9b4];
const UPPER = [0x2f86a0, 0x3f6fa8, 0x4a8f6a, 0x8f5a9a];
const PINE = [0x3f7f3f, 0x4a8a44, 0x35703a];

// Cria os construtores de prédio ligados à cena, ao physics e ao `info` da cidade.
// `rnd` é o RNG com semente de city.js (cidade sempre igual).
export function createBuildings(scene, physics, info, rnd) {
  for (const k of Object.keys(lists)) lists[k] = [];
  meshes = {};
  const pick = (a) => a[(rnd() * a.length) | 0];
  const rr = (a, b) => a + rnd() * (b - a);

  const sgn = (ctx) => (ctx.ry === 0 ? 1 : -1);
  // Registra colisor AABB e retângulo (minimapa) a partir de coordenadas locais.
  const solid = (ctx, cx, cz, sx, sz, h) => {
    const s = sgn(ctx);
    physics.add(ctx.x + s * cx, ctx.z + s * cz, sx / 2, sz / 2, h);
    info.buildings.push({ x: ctx.x + s * cx, z: ctx.z + s * cz, w: sx, d: sz });
  };

  // A) Bloco de tijolo em "L". Devolve { W, D } reais (para o toldo das lojas).
  function brick(x, z, w, d, h, ry = 0, minFloors = 3) {
    const t = TILE.brick;
    const nw = clamp(Math.floor(w / t.tw), 3, 6), nd = clamp(Math.floor(d / t.tw), 3, 6);
    const na = Math.max(2, Math.round(nd * 0.5)), nb = Math.max(2, Math.round(nw * 0.5));
    const W = nw * t.tw, D = nd * t.tw, DA = na * t.tw, WB = nb * t.tw;
    const floors = clamp(Math.round(h / t.th), minFloors, 9);
    const PL = 1.4, H = floors * t.th, top = PL + H + 0.7;
    const ctx = { x, z, ry };
    const tint = pick(BRICK_TINT);
    const wings = [
      { cx: 0, cz: D / 2 - DA / 2, sx: W, sz: DA },                         // ala da frente
      { cx: -W / 2 + WB / 2, cz: -DA / 2, sx: WB, sz: D - DA },              // ala de fundo
    ];
    for (const wg of wings) {
      box('plain', ctx, wg.cx, PL / 2, wg.cz, wg.sx + 0.4, PL, wg.sz + 0.4, 0x8d8a85);                   // base de pedra
      box('brick', ctx, wg.cx, PL + H / 2, wg.cz, wg.sx, H, wg.sz, tint);                                // paredes
      box('plain', ctx, wg.cx, PL + H + 0.25, wg.cz, wg.sx + 0.6, 0.5, wg.sz + 0.6, 0xdcc9a8);           // cornija
      box('plain', ctx, wg.cx, PL + H + 0.6, wg.cz, wg.sx + 0.2, 0.2, wg.sz + 0.2, 0x6f7a86);            // laje do telhado
      box('plain', ctx, wg.cx + rr(-wg.sx / 4, wg.sx / 4), top + 0.4, wg.cz + rr(-wg.sz / 4, wg.sz / 4), 1.2, 0.8, 1.2, 0x8a8f96); // casa de máquinas
      solid(ctx, wg.cx, wg.cz, wg.sx + 0.4, wg.sz + 0.4, top);
    }
    // quinas de pedra clara nos 6 cantos do "L"
    const corners = [[-W / 2, D / 2], [W / 2, D / 2], [W / 2, D / 2 - DA], [-W / 2, -D / 2], [-W / 2 + WB, -D / 2], [-W / 2 + WB, D / 2 - DA]];
    for (const [qx, qz] of corners) box('plain', ctx, qx, PL + H / 2, qz, 0.5, H, 0.5, 0xeadfc9);
    // entrada, marquise e placa
    box('plain', ctx, 0, 1.2, D / 2 + 0.3, 1.8, 2.4, 0.2, 0x2b2420);
    box('plain', ctx, 0, 2.7, D / 2 + 0.7, 2.6, 0.15, 1.2, 0xdcc9a8);
    box('plain', ctx, 2.2, 2.4, D / 2 + 0.45, 0.9, 1.2, 0.1, 0xe8eef4);
    return { W, D };
  }

  // B) Torre bege com faixa de ripas. Prédios largos e altos ganham recuos.
  function tower(x, z, w, d, h, ry = 0) {
    const t = TILE.tower;
    const nw = clamp(Math.floor(w / t.tw), 3, 10), nd = clamp(Math.floor(d / t.tw), 3, 10);
    const floors = clamp(Math.round(h / t.th), 5, 40);
    const ctx = { x, z, ry };
    const tint = pick(TOWER_TINT);
    const tiers = [];
    if (nw >= 8 && nd >= 8 && floors >= 14) {
      const f1 = Math.round(floors * 0.5), f2 = Math.round(floors * 0.3);
      tiers.push({ nw, nd, f: f1 }, { nw: nw - 2, nd: nd - 2, f: f2 }, { nw: nw - 4, nd: nd - 4, f: floors - f1 - f2 });
    } else {
      tiers.push({ nw, nd, f: floors });
    }
    const W0 = tiers[0].nw * t.tw, D0 = tiers[0].nd * t.tw, H0 = tiers[0].f * t.th;
    box('plain', ctx, 0, 0.175, 0, W0 + 1.2, 0.35, D0 + 1.2, 0xd6d2ca);        // laje de concreto
    let y = 0.35;
    tiers.forEach((tr, i) => {
      const W = tr.nw * t.tw, D = tr.nd * t.tw, H = tr.f * t.th;
      box('tower', ctx, 0, y + H / 2, 0, W, H, D, tint);
      box('plain', ctx, 0, y + H + 0.2, 0, W + 0.3, 0.4, D + 0.3, 0xb9b3a8);   // laje/platibanda
      solid(ctx, 0, 0, W + 0.3, D + 0.3, y + H + 0.4);
      if (i === tiers.length - 1) {
        for (let k = 0; k < 3; k++) {
          box('plain', ctx, rr(-W / 3, W / 3), y + H + 0.4 + 0.6, rr(-D / 3, D / 3), rr(1.4, 2.4), 1.2, rr(1.4, 2.4), 0x9a9c9f);
        }
      }
      y += H + 0.4;
    });
    // faixa de ripas, porta âmbar e porta lateral
    box('wood', ctx, 0, 0.35 + H0 / 2, D0 / 2 + 0.25, t.tw, H0, 0.5, 0xffffff);
    box('plain', ctx, 0, 1.6, D0 / 2 + 0.52, 1.8, 2.9, 0.08, 0x2c3a4a);
    box('plain', ctx, 0, 1.55, D0 / 2 + 0.58, 1.4, 2.6, 0.1, 0x4a86c5);
    box('plain', ctx, -W0 / 2 + 1.2, 1.5, D0 / 2 + 0.05, 1.3, 2.3, 0.1, 0x4a86c5);
  }

  // C) Casa moderna (imagem 4): corpo rosa de 2 andares, volume azul recuado, terraço, deck e pinheiros.
  function modern(x, z, w, d, ry = 0) {
    const t = TILE.modern;
    const nw = clamp(Math.floor(w / t.tw), 2, 3), nd = clamp(Math.floor(d / t.tw), 2, 3);
    const W = nw * t.tw, D = nd * t.tw;
    const H1 = 2 * t.th, H2 = t.th, SL = 0.25, Du = D - 4;
    const ctx = { x, z, ry };
    const lower = pick(LOWER), upper = pick(UPPER);
    const y0 = H1 + SL;                                                    // piso do terraço
    box('modern', ctx, 0, H1 / 2, 0, W, H1, D, lower);
    box('plain', ctx, 0, H1 + SL / 2, 0, W + 0.5, SL, D + 0.5, 0x5f6368);   // laje do térreo/terraço
    box('modern', ctx, 0, y0 + H2 / 2, -D / 2 + Du / 2, W, H2, Du, upper);
    box('plain', ctx, 0, y0 + H2 + 0.2, -D / 2 + Du / 2, W + 0.2, 0.4, Du + 0.2, 0xe3d7b5);       // viga creme
    box('plain', ctx, 0, y0 + H2 + 0.55, -D / 2 + Du / 2, W + 0.8, 0.3, Du + 0.8, 0x6a6d72);      // laje de cobertura
    // terraço na frente do volume superior
    rail(ctx, y0, 0, D / 2 + 0.1, W + 0.4, true);
    rail(ctx, y0, -(W / 2 + 0.1), D / 2 - 2, 4, false);
    rail(ctx, y0, W / 2 + 0.1, D / 2 - 2, 4, false);
    box('plain', ctx, -W / 4, y0 + 0.3, D / 2 - 1.4, 2.0, 0.6, 0.9, 0xb5a98e);
    box('plain', ctx, -W / 4, y0 + 0.8, D / 2 - 1.8, 2.0, 0.6, 0.15, 0xb5a98e);
    // deck externo com escada na lateral (às vezes)
    if (rnd() < 0.65) {
      const dx = -W / 2 - 1.6, dz = D / 2 - 4.2, top = 3.2;
      box('plain', ctx, dx, top - 0.1, dz, 3.2, 0.2, 3.4, 0x4a4d52);
      for (const [px, pz] of [[dx - 1.5, dz - 1.6], [dx - 1.5, dz + 1.6], [dx + 1.5, dz - 1.6], [dx + 1.5, dz + 1.6]]) {
        box('plain', ctx, px, (top - 0.2) / 2, pz, 0.22, top - 0.2, 0.22, 0x3a3d42);
      }
      rail(ctx, top, dx - 1.6, dz, 3.4, false);
      rail(ctx, top, dx, dz - 1.7, 3.2, true);
      for (let i = 0; i < 5; i++) {
        const sh = top - ((i + 1) * top) / 6;
        box('plain', ctx, dx, sh / 2, dz + 1.7 + 0.25 + i * 0.5, 1.2, sh, 0.5, 0x6a6d72);
      }
    }
    // pinheiros low-poly na frente
    const s = sgn(ctx);
    const pine = (px, pz, k, c) => {
      cone(ctx, px, 1.2 * k, pz, 1.1 * k, 2.4 * k, c);
      cone(ctx, px, 2.5 * k, pz, 0.85 * k, 2.0 * k, c);
      cone(ctx, px, 3.6 * k, pz, 0.55 * k, 1.6 * k, c);
      physics.add(x + s * px, z + s * pz, 0.5 * k, 0.5 * k, 6);
    };
    pine(W / 2 - 0.5, D / 2 + 2.0, 1.0, pick(PINE));
    pine(W / 2 + 1.3, D / 2 + 3.0, 0.75, pick(PINE));
    solid(ctx, 0, 0, W + 0.5, D + 0.5, y0 + H2 + 0.7);
  }

  // Mescla tudo por material e adiciona à cena (chamar uma vez, no fim de buildCity).
  function build() {
    for (const key of Object.keys(lists)) {
      if (!lists[key].length) continue;
      const geo = mergeGeometries(lists[key], false);
      for (const g of lists[key]) g.dispose();
      lists[key].length = 0;
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, getMat(key, curCine, curEnv));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
      meshes[key] = mesh;
    }
  }

  return { brick, tower, modern, build };
}