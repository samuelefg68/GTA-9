import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { damp, clamp, groundHeight, pick, angleDiff, mat } from './utils.js';

const MODEL_COUNT = 4;
const WHEEL = /wheel/i;
const NOT_WHEEL = /steering|chrysler/i; // volante do interior ("steering" ou "Chrysler_Wheel" no .glb) não é roda
const isWheel = (n) => WHEEL.test(n) && !NOT_WHEEL.test(n);
const PERF = { maxSpeed: 34, maxRev: 10, accel: 14, brake: 10, steer: 0.55 };
// ----- Direção (estilo Forza, pensada para teclado) -----
const GRIP_G = 20;         // aderência lateral máxima dos pneus (m/s²), ~2 g: arcade, curva na cidade sem alargar
const SLIP_T = 0.12;       // s: quanto tempo os pneus levam para trazer a frente de volta ao rumo (menor = mais aderência)
const YAW_RESP = 12;       // 1/s: resposta da rotação do carro ao volante
const WHEEL_IN = 4.2;      // volante gira para o lado da tecla: 0 a 1 em ~0,24 s
const WHEEL_OUT = 6.5;     // volante volta ao centro (ou troca de lado) mais rápido
const HAND_DECEL = 16;     // m/s² do freio de mão (antes 38: muito brusco)
const HAND_YAW = 1.6;      // com freio de mão, a traseira gira mais (cabe mais rotação antes do limite)
const HAND_GRIP_LOSS = 3;  // com freio de mão, a aderência cai para 1/3: o carro derrapa
const POWER_SLIDE = 1.2;   // com acelerador em curva, a aderência da traseira cai até 2,2× (derrapagem leve); igual para todos os carros
const ASSIST_K = 0.6;      // contra-esterço automático: volante extra = 0,6 × ângulo de deslize (ajuda, não trava)
const ASSIST_MAX = 0.2;    // rad: limite do contra-esterço automático
const NONE = { up: false, down: false, left: false, right: false, hand: false };
const SEAT_SCALE = 0.82;
const BRAKE = /brake/i;
const GLASS = /windshield|window|tailgateglass/i; // vidros do carro: viram fumê escuro
const GLASS_COLOR = new THREE.Color(0.03, 0.035, 0.045);
const loader = new GLTFLoader();

// ----- Tráfego (carros com IA, andando nas faixas) -----
const TRAFFIC_SPEED = 30 / 3.6; // limite de 30 km/h = 8,33 m/s
const TURN_SPEED = 4.5;         // velocidade nas curvas (m/s)
const AI_ACCEL = 2.5;           // aceleração confortável (m/s²)
const AI_BRAKE = 5;             // frenagem confortável (m/s²)
const AI_TURN = 1.6;            // taxa máxima de giro (rad/s)
const TRAFFIC_COUNT = 100;      // carros de tráfego ao iniciar
const ABANDON_T = 6;            // s até um carro abandonado voltar ao tráfego
const TELEPORT_MIN = 60;        // m: distância mínima do foco para surgir um carro de tráfego
const PED_LOOK = 20;            // m: até essa distância à frente, o tráfego considera um pedestre
const PED_STOP = 1.0;           // m: folga que o carro deixa ao parar atrás de um pedestre
const PED_R = 0.35;             // m: raio de um pedestre (igual a R em npc.js)
const STUCK_T = 10;             // s parado (sem pedestre à frente) antes de o carro ir para outro cruzamento
const newAI = () => ({ node: null, target: null, still: 0 });
const DRIVER_MIN_SPEED = 0.5;   // m/s: carro de tráfego acima disso tem motorista NPC (que sai correndo ao jogador tentar entrar)

// ----- Nível de detalhe (LOD) -----
// O .glb é muito pesado para desenhar dezenas de cópias. Carros além de LOD_DIST do foco viram uma caixa simples
// com a cor do carro. A simulação não muda: só o desenho.
const CAR_CULL_DIST = 110;     // m: carros além disso não são desenhados (reduz chamadas de desenho)
const LOD_DIST = 50;            // m: distância do foco a partir da qual o carro vira caixa
const PROXY_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0xecf0f1, 0x34495e];
const PROXY_GLASS = 0x1c232b;
const PROXY_GEO = new THREE.BoxGeometry(1, 1, 1); // compartilhada: cada parte é escalada para o carro

// Ajustes por modelo (índice 0 = carro1):
//   rotY      gira o modelo em torno de Y para a frente apontar para +z.
//   scale     multiplica o tamanho final (depois da escala automática).
//   keepAlpha mantém a transparência (BLEND) dos materiais, exceto vidros, que viram fumê escuro.
// A escala automática age se o comprimento (eixo Z) estiver fora de 3-7 m: o modelo vai para TARGET_LEN.
// carro1: ~4,65 m originais, frente em +z; scale 1,25 -> ~5,8 m. Materiais BLEND (cromados, detalhes) mantêm o alpha.
// carro2 (10 m), carro3 (8,7 m) e carro4 (antigo carro5, ~50,9 unidades): a escala automática os leva a 4,6 m e o scale 1,25 os deixa em ~5,75 m, igual ao carro1.
const TARGET_LEN = 4.6;
// maxSpeed em m/s: 100 km/h = 27,78; 70 km/h = 19,44; 75 km/h = 20,83; 60 km/h = 16,67.
const MODEL_FIX = [
  { scale: 1.25, keepAlpha: true, maxSpeed: 27.78 }, // carro1: 100 km/h
  { scale: 1.25, maxSpeed: 19.44 },                // carro2: 70 km/h
  { scale: 1.25, maxSpeed: 20.83 },                // carro3: 75 km/h
  { scale: 1.25, maxSpeed: 16.67 },                // carro4: 60 km/h
];

// Cada roda vira: pivô (esterço em Y) > grupo de giro (eixo X) > nó da roda (mantém a rotação e a escala do arquivo).
// O pivô fica no CENTRO DO PNEU (caixa de mundo), não na origem do nó: no .glb a origem de todas as peças
// da roda fica no centro do carro, e girar em torno dela faz a roda orbitar. Peças da roda (freio, suporte,
// pinça) seguem o pneu mais próximo. Discos de freio dianteiros esterçam sem girar.
// Devolve o raio do pneu em metros (0 se não achou rodas).
function setupWheels(model, root) {
  const wheels = [], brakes = [];
  model.traverse((o) => {
    if (o === model || !isWheel(o.name)) return;
    for (let p = o.parent; p && p !== model; p = p.parent) if (isWheel(p.name)) return; // só o nó mais externo
    (BRAKE.test(o.name) ? brakes : wheels).push(o);
  });
  if (!wheels.length) return 0;
  root.updateMatrixWorld(true);
  const center = (o) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  // pneus são os "hubs"; sem pneus, a própria roda vira hub
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
    spin.attach(h); // mantém a transformação de mundo do nó
    return { pivot, spin, pos: hubPos[i] };
  });
  // o pivô mais próximo de cada peça (pneu não é tocado aqui)
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

// Alguns nós de roda do .glb contêm DUAS rodas (esquerda e direita). O centro da caixa cai no meio do carro e a
// roda gira fora do eixo. Aqui cada nó é separado por triângulo (pelo lado em X) em dois nós: "_L" e "_R".
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
    if (!left.length || !right.length) continue; // só um lado: nada a separar
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

// Carrega um .glb, troca o material por Lambert (mantendo a textura), corrige rotação/escala, apoia o carro
// no chão e centraliza em X/Z. Os tamanhos de colisão vêm da caixa do modelo (retrovisores contam ~15%).
async function loadCar(url, fix = {}) {
  const model = (await loader.loadAsync(url).catch(() => { throw new Error(`Falha ao carregar ${url}`); })).scene;
  const root = new THREE.Group(); // wrapper: recebe o recentramento; o modelo recebe rotação e escala
  root.add(model);
  splitWheelSides(model);
  const lambert = new Map();
  let wheelR = 0.38;
  model.traverse((o) => {
    if (!o.isMesh) return;
    // Sem normais o Lambert fica preto: calcula-as. Sem textura, a cor vem dos vértices (COLOR_0).
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    const m = o.material;
    const vc = !m.map && !!o.geometry.attributes.color;
    const key = m.uuid + (vc ? 'v' : '');
    if (!lambert.has(key)) {
      // Luzes são materiais só com emissão (base branca): o Lambert precisa da emissão e da cor da luz, senão ficam brancas.
      const glow = !!m.emissive && m.emissive.r + m.emissive.g + m.emissive.b > 0.01;
      const glass = GLASS.test(m.name) || GLASS.test(o.name);
      const alpha = !!fix.keepAlpha && !glass && m.transparent;
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
  });
  model.rotation.y = fix.rotY || 0;
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  // Comprimento ficou em X (frente em +x): gira para levar o comprimento a Z
  if (!fix.rotY && size.x > size.z) {
    model.rotation.y -= Math.PI / 2;
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    size = box.getSize(new THREE.Vector3());
  }
  let k = fix.scale || 1;
  if (size.z < 3 || size.z > 7) k *= TARGET_LEN / size.z; // modelo em outra unidade: escala para ~4,6 m
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

// Sombras dos carros: ligadas só no modo Cinematográfico (controlado por world.js)
let CAR_SHADOWS = false;
export function setCarShadows(on) { CAR_SHADOWS = !!on; }
const SHADOW_DIST = 45; // m: só carros dentro dessa distância do foco projetam sombra

export class Vehicle {
  constructor(model, x, z, heading) {
    const type = (this.type = model.type);
    this.name = type.name;
    this.home = { x, z, heading };
    this.pos = { x, y: 0, z };
    this.heading = heading;
    this.speed = 0;        // velocidade longitudinal (m/s), na direção da frente
    this.steer = 0;        // ângulo das rodas dianteiras (rad), suavizado
    this.wheelIn = 0;      // posição do volante, de -1 (direita) a 1 (esquerda), com rampa de teclado
    this.omega = 0;        // taxa de giro do carro (rad/s)
    this.vlat = 0;         // velocidade lateral (m/s), positiva para a esquerda: é o "deslize" quando o carro não segue a frente
    this.spin = 0;
    this.driven = false;
    this.radius = type.wid / 2 + 0.05;
    this.reach = type.len / 2 - this.radius - 0.1; // distância dos dois círculos de colisão ao centro
    this.fx = Math.sin(heading);
    this.fz = Math.cos(heading);
    this.ai = null;        // estado da IA de tráfego (null = sem IA)
    this.traffic = false;  // carro que faz parte do tráfego (volta a ele depois de reset ou abandono)
    this.abandon = 0;      // contagem regressiva até um carro abandonado voltar ao tráfego
    this.wasDriven = false;

    const g = (this.group = new THREE.Group());
    g.userData.car = true; // world.js localiza os carros por esta marca
    this.body = model.proto.clone(); // modelo completo (.glb)
    g.add(this.body);
    // Caixa simples para o nível de detalhe distante (uma malha, um desenho).
    // Carroceria e cabine com vidro escuro. A origem do grupo fica no chão, no centro do carro.
    this.proxy = new THREE.Group();
    const body = new THREE.Mesh(PROXY_GEO, mat(pick(PROXY_COLORS)));
    body.scale.set(type.wid, type.h * 0.6, type.len);
    body.position.y = type.h * 0.3;
    const cabin = new THREE.Mesh(PROXY_GEO, mat(PROXY_GLASS));
    cabin.scale.set(type.wid * 0.8, type.h * 0.4, type.len * 0.45);
    cabin.position.set(0, type.h * 0.8, -type.len * 0.08);
    this.proxy.add(body, cabin);
    this.proxy.visible = false;
    g.add(this.proxy);
    // Carros recebem sombra dos prédios (receiveShadow) e, no Cinematográfico, também projetam
    g.traverse((m) => { if (m.isMesh) { m.castShadow = CAR_SHADOWS; m.receiveShadow = true; } });
    this.wheels = []; // grupos de giro (rotation.x)
    this.steered = []; // pivôs das rodas dianteiras (rotation.y)
    g.traverse((o) => {
      if (o.userData.wheelSpin) this.wheels.push(o);
      else if (o.userData.wheelPivot && o.userData.front) this.steered.push(o);
    });
    // Posição do motorista (lado esquerdo = +x), usada pelo jogador.
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
    s -= s * Math.abs(s) * 0.0012 * dt; // arrasto aerodinâmico
    this.speed = clamp(s, -T.maxRev, T.maxSpeed);
    const v = this.speed;

    // Volante: a tecla leva o volante com uma rampa (sem salto para o máximo); soltar traz ao centro.
    // Trocar de lado (contraesterço) é rápido. Em alta velocidade o volante gira menos (ângulo máximo cai).
    const want = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    const rate = want === 0 || (this.wheelIn !== 0 && Math.sign(want) !== Math.sign(this.wheelIn)) ? WHEEL_OUT : WHEEL_IN;
    this.wheelIn += clamp(want - this.wheelIn, -rate * dt, rate * dt);
    const maxSt = T.steer / (1 + Math.abs(v) * 0.07);
    // Contra-esterço automático: com a traseira escapando (vlat), o volante vai para o lado do deslize,
    // o que reduz o ângulo. Só andando para frente (de 3 a 6 m/s o efeito entra aos poucos).
    const beta = Math.atan2(this.vlat, Math.max(v, 0.1)); // ângulo de deslize (rad), positivo = para a esquerda
    // Só age com o volante solto: com o jogador virando, o contra-esterço freava a curva.
    const hold = 1 - clamp(Math.abs(this.wheelIn) * 2, 0, 1); // 1 = volante solto, 0 = virado (meio curso)
    const assist = clamp(beta * ASSIST_K, -ASSIST_MAX, ASSIST_MAX) * clamp((v - 3) / 3, 0, 1) * hold;
    this.steer = damp(this.steer, this.wheelIn * maxSt + assist, 16, dt);

    // Rotação pedida pelo volante (geometria de Ackermann simplificada: ω = v·tan δ / L).
    // A aderência limita a aceleração lateral a GRIP_G: ω ≤ GRIP_G / v. Assim, em curva rápida o carro
    // "alarga" (não gira mais), como num carro de verdade no limite.
    const handOn = inp.hand && Math.abs(v) > 6;
    const yawMax = (handOn ? HAND_YAW : 1) * GRIP_G / Math.max(Math.abs(v), 3);
    const wish = clamp((v / (T.len * 0.6)) * Math.tan(this.steer), -yawMax, yawMax);
    this.omega += (wish - this.omega) * (1 - Math.exp(-YAW_RESP * dt));

    // Deslize lateral: o carro gira, mas a velocidade demora a acompanhar a frente (o pneu puxa de volta).
    // Sem o pneu, a velocidade lateral mudaria por -ω·v (rotação do referencial). Em regime, vlat = -ω·v·τ:
    // com aderência alta é um deslize de poucos graus; no freio de mão, τ triplica e a traseira escapa.
    // Acelerador em curva: a traseira perde aderência (mais com velocidade e volante virado). Soltar o gás devolve a aderência.
    const powerK = inp.up && v > 0 ? clamp(v / 12, 0, 1) * Math.abs(this.wheelIn) : 0;
    const tau = SLIP_T * (handOn ? HAND_GRIP_LOSS : 1) * (1 + POWER_SLIDE * powerK);
    const ay = clamp(-this.vlat / tau, -GRIP_G, GRIP_G); // força de aderência do pneu (aceleração)
    this.vlat += (ay - this.omega * v) * dt;

    this.heading += this.omega * dt;
    this.fx = Math.sin(this.heading);
    this.fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading); // esquerda (AGENTS.md)
    this.pos.x += (this.fx * v + lx * this.vlat) * dt;
    this.pos.z += (this.fz * v + lz * this.vlat) * dt;
    this.spin += (v / this.type.wheelR) * dt;
  }

  // Condução do tráfego: acelera/freia até `want` (m/s) e gira em direção ao ponto (tx, tz).
  autoDrive(dt, want, tx, tz) {
    this.speed += clamp(want - this.speed, -AI_BRAKE * dt, AI_ACCEL * dt);
    const dh = angleDiff(this.heading, Math.atan2(tx - this.pos.x, tz - this.pos.z));
    this.heading += clamp(dh, -AI_TURN * dt, AI_TURN * dt);
    this.steer = damp(this.steer, clamp(dh * 1.2, -0.5, 0.5), 8, dt);
    this.omega = 0; this.vlat = 0; this.wheelIn = 0; // a IA não modela deslize: o estado do jogador não vaza para o tráfego
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

  // Sombra só para carros perto do foco (cada carro que projeta sombra custa desenho no mapa de sombra)
  setShadow(on) {
    if (this._shadow === on) return;
    this._shadow = on;
    this.group.traverse((m) => { if (m.isMesh) m.castShadow = on; });
  }

  // Perto do foco: modelo completo; longe: caixa simples. Só troca quando muda.
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
    this.peds = [];        // NPCs (com pos, dead, fallen): o tráfego para antes deles
    this.walker = null;    // jogador a pé (com pos e vehicle)
  }

  async load() {
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
    // Vagas de estacionamento seguem com carros parados; as faixas das ruas ficam para o tráfego.
    for (const s of city.parkingSpots) {
      if (Math.random() >= 0.3) continue;
      if (this.list.some((v) => (v.pos.x - s.x) ** 2 + (v.pos.z - s.z) ** 2 < 64)) continue;
      this.spawn(s.x, s.z, s.heading);
    }
    this.roadNodes = city.roadStarts || []; // nós de chegada: onde o tráfego nasce ou reaparece
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

  // Cria um carro de tráfego em um cruzamento aleatório.
  _addTraffic(focus = null) {
    const v = this.spawn(0, 0, 0);
    v.traffic = true;
    v.ai = newAI();
    this._teleport(v, focus);
    return v;
  }

  // Coloca o carro num cruzamento aleatório, longe do foco e sem sobrepor outros carros.
  // Número de outros carros a menos de 5 m do nó c.
  _crowd(v, c) {
    let k = 0;
    for (const o of this.list) if (o !== v && (o.pos.x - c.x) ** 2 + (o.pos.z - c.z) ** 2 < 625) k++;
    return k;
  }

  // Escolhe um cruzamento longe do foco e sem carros por perto. Varre todos a partir de um ponto aleatório
  // (antes: 30 sorteios e, se falhassem, o carro ia para um nó ocupado, empilhando-se com outros).
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
    // sem nó livre e longe do foco: usa o nó menos ocupado de todos
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

  // Distância livre (m) até o pedestre mais próximo na frente da carroceria, ou Infinity.
  // Pedestres mortos e caídos não contam (não há como esperar que saiam).
  _pedAhead(v) {
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const half = v.type.hw + PED_R;
    let best = Infinity;
    const P = this.peds;
    for (let i = 0; i <= P.length; i++) {
      // o último item é o jogador, se estiver a pé
      const o = i < P.length ? P[i] : (this.walker && !this.walker.vehicle ? this.walker : null);
      if (!o || o.dead || o.fallen > 0) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const f = dx * v.fx + dz * v.fz;
      if (f <= 0) continue;
      if (Math.abs(dx * lx + dz * lz) > half) continue; // fora da faixa do carro
      const gap = f - v.type.hl - PED_R;
      if (gap < PED_LOOK && gap < best) best = gap;
    }
    return best;
  }

  // Distância livre (m) até o próximo veículo na mesma faixa, ou Infinity.
  _gapAhead(v) {
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    let best = Infinity;
    for (const o of this.list) {
      if (o === v) continue;
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      const f = dx * v.fx + dz * v.fz;
      if (f <= 0) continue;
      if (Math.abs(dx * lx + dz * lz) > 1.8) continue; // outra faixa
      const gap = f - v.type.hl - o.type.hl;
      if (gap < best) best = gap;
    }
    return best;
  }

  // IA de um carro de tráfego: segue o grafo de ruas, desacelera nas curvas e atrás de outros carros.
  _traffic(v, dt, focus) {
    const a = v.ai;
    let dx = a.target.x - v.pos.x, dz = a.target.z - v.pos.z;
    if (dx * dx + dz * dz < 1.44) { // chegou ao cruzamento: escolhe o próximo (nunca dá ré)
      a.node = a.target;
      a.target = pick(a.node.n);
      dx = a.target.x - v.pos.x; dz = a.target.z - v.pos.z;
    }
    const dist = Math.hypot(dx, dz);
    let want = Math.min(TRAFFIC_SPEED, v.type.maxSpeed);
    if (Math.abs(angleDiff(a.node.heading, a.target.heading)) > 0.3 && dist < 14) want = Math.min(want, TURN_SPEED);
    const gap = this._gapAhead(v);
    if (gap < Infinity) want = Math.min(want, Math.sqrt(2 * AI_BRAKE * Math.max(0, gap - 2.5)));
    // pedestre na frente: freia até parar e só anda quando a faixa estiver livre
    const ped = this._pedAhead(v);
    if (ped < Infinity) want = Math.min(want, Math.sqrt(2 * AI_BRAKE * Math.max(0, ped - PED_STOP)));
    // travado: parado sem pedestre à frente. Antes só contava com want > 1, então carros presos uns atrás
    // dos outros (e no mesmo cruzamento) nunca eram realocados e formavam um nó de congestionamento.
    if (v.speed < 0.2 && ped === Infinity) {
      a.still += dt;
      if (a.still > STUCK_T) { this._teleport(v, focus); return; }
    } else a.still = 0;
    v.autoDrive(dt, want, a.target.x, a.target.z);
  }

  // Só carros de tráfego (com IA) em movimento têm motorista NPC. Parados ou estacionados ficam vazios.
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

  // Empurra uma pessoa (círculo de raio r) para fora da carroceria inteira do veículo.
  // A carroceria é um retângulo orientado (comprimento × largura reais do modelo) no referencial do carro.
  // Retorna o veículo atingido, se houver.
  pushOut(p, r) {
    let hit = null;
    for (const v of this.list) {
      const T = v.type;
      const lim = T.hl + T.hw + r; // raio que envolve a carroceria inteira
      const ddx = p.x - v.pos.x, ddz = p.z - v.pos.z;
      if (ddx * ddx + ddz * ddz > lim * lim) continue;
      // eixos locais: frente (fx, fz) e esquerda (cos θ, -sin θ), como em AGENTS.md
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      const u = ddx * v.fx + ddz * v.fz; // distância à frente/atrás do centro
      const w = ddx * lx + ddz * lz;     // distância à esquerda/direita do centro
      const eu = T.hl + r - Math.abs(u); // folga para sair pela frente/traseira
      const ew = T.hw + r - Math.abs(w); // folga para sair pelas laterais
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
        v.ai = null; v.wasDriven = true; // jogador assumiu: sem IA
        v.drive(dt, inp);
      } else {
        if (v.wasDriven) { v.wasDriven = false; v.abandon = ABANDON_T; v.traffic = true; }
        if (v.abandon > 0) {
          v.abandon -= dt;
          if (v.abandon <= 0 && this.roadNodes.length) { v.ai = newAI(); this._teleport(v, focus); }
        }
        if (v.ai) this._traffic(v, dt, focus);
        else if (v.speed !== 0) v.drive(dt, NONE);
        else continue; // carro parado: nada a simular
      }

      // colisão com construções/objetos: dois círculos (frente e traseira)
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

    // colisão entre veículos, com troca simples de momento
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const ddx = a.pos.x - b.pos.x, ddz = a.pos.z - b.pos.z;
        const lim = (a.type.len + b.type.len) / 2 + 0.5; // pares mais distantes que isso não podem colidir
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
    // nível de detalhe: o modelo completo só perto do foco
    // além de CAR_CULL_DIST o carro não é desenhado (a simulação continua); o carro do jogador sempre aparece
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