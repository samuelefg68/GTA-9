import * as THREE from 'three';

// Personagem chibi feito só com primitivas do Three.js. Origem nos pés, frente em +z.
// Hierarquia: root (pés) > hip/knee (pernas), root > upper (tronco, bob) > shoulder > elbow > hand.

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Paletas. hairStyle: 'spiky' | 'flat' | 'bob'. vest: colete (só o jogador).
export const VARIANTS = {
  player: {
    skin: 0xf3c9a0, hair: 0xf2c94c, hairStyle: 'spiky', eyes: 0x2c7fd9,
    top: 0x1f2c4d, trim: 0x35c8ea, vest: 0x3d4149, belt: 0x8a5a2b,
    pants: 0x1d2538, boots: 0x2b2f38, glove: 0x2a2e36, scarf: 0x2a2d36,
  },
  npc1: {
    skin: 0xf2cba4, hair: 0x6e4a2a, hairStyle: 'spiky', eyes: 0x4a3020,
    top: 0xf3efe4, trim: 0xd08a3c, vest: null, belt: 0x7d4d25,
    pants: 0x6e7760, boots: 0x4a2d1a, glove: 0xf2cba4, scarf: null,
  },
  npc2: {
    skin: 0xe8b48a, hair: 0x2b2b33, hairStyle: 'flat', eyes: 0x333333,
    top: 0x7b2e2e, trim: 0xd9b25a, vest: null, belt: 0x2e2e2e,
    pants: 0x3d4250, boots: 0x2b2b2b, glove: 0x1e1e1e, scarf: null,
  },
  npc3: {
    skin: 0xf5d0b0, hair: 0xb9653b, hairStyle: 'bob', eyes: 0x2a6a4a,
    top: 0x3f7d52, trim: 0xf0e6c8, vest: null, belt: 0x5b3b2b,
    pants: 0x4a4f5c, boots: 0x3a2a20, glove: 0xf5d0b0, scarf: null,
  },
};

const SEAT_POSE = { legL: 1.4, legR: 1.4, kneeL: 1.4, kneeR: 1.4, armL: 0.9, armR: 0.9, elbowL: 0.9, elbowR: 0.9, zL: 0.1, zR: -0.1, lean: 0.04 };

// Poses de arma segurada (criadas uma vez; antes eram recriadas a cada quadro)
const HOLD = {
  none: null,
  melee: { armR: 0.9, elbowR: 1.2, zR: -0.05, armL: 0.3, elbowL: 0.8, zL: 0.1 },
  pistol: { armR: 1.25, elbowR: 0.25, zR: -0.1, armL: 1.1, elbowL: 0.9, zL: -0.2 },
  rifle: { armR: 1.2, elbowR: 0.9, zR: -0.1, armL: 1.3, elbowL: 1.1, zL: -0.25 },
  bazooka: { armR: 1.3, elbowR: 1.0, zR: -0.2, armL: 1.3, elbowL: 1.2, zL: -0.3 },
};

// Cache de geometria e material compartilhados (poucos objetos na GPU)
const GEO = {};
const MAT = {};
const geo = (key, make) => GEO[key] || (GEO[key] = make());
const mat = (color) => MAT[color] || (MAT[color] = new THREE.MeshLambertMaterial({ color }));

const boxG = (w, h, d) => geo(`b${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d));
const ballG = (r) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10));
const capG = (r, l) => geo(`k${r}_${l}`, () => new THREE.CapsuleGeometry(r, l, 4, 8));
const cylG = (r, l) => geo(`c${r}_${l}`, () => new THREE.CylinderGeometry(r, r, l, 10));
const coneG = (r, h) => geo(`n${r}_${h}`, () => new THREE.ConeGeometry(r, h, 6));

function part(g, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function pivot(x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  return g;
}

// Armas montadas na mão direita, alinhadas com +z (frente quando o braço está estendido)
function buildWeapons(hand) {
  const out = {};
  const metal = 0x9aa3ad, dark = 0x2d3138, wood = 0x7a4a24;

  const knife = new THREE.Group();
  knife.add(part(cylG(0.025, 0.14), dark, 0, 0, 0.02));
  knife.add(part(boxG(0.035, 0.02, 0.24), metal, 0, 0, 0.2));
  out.melee = knife;

  const pistol = new THREE.Group();
  pistol.add(part(boxG(0.07, 0.1, 0.2), dark, 0, 0, 0.12));
  pistol.add(part(boxG(0.05, 0.14, 0.06), dark, 0, -0.1, 0.06));
  out.pistol = pistol;

  const rifle = new THREE.Group();
  rifle.add(part(boxG(0.08, 0.12, 0.85), dark, 0, 0, 0.4));
  rifle.add(part(boxG(0.07, 0.14, 0.2), wood, 0, -0.02, -0.08));
  rifle.add(part(boxG(0.04, 0.16, 0.06), dark, 0, -0.12, 0.3));
  out.rifle = rifle;

  const bazooka = new THREE.Group();
  const tube = part(cylG(0.09, 1.0), dark, 0, 0, 0.45);
  tube.rotation.x = Math.PI / 2;
  bazooka.add(tube);
  bazooka.add(part(cylG(0.11, 0.12), metal, 0, 0, 0.92).rotateX(Math.PI / 2));
  out.bazooka = bazooka;

  for (const key of Object.keys(out)) {
    out[key].visible = false;
    hand.add(out[key]);
  }
  return out;
}

export class Chibi {
  constructor(variant = 'npc1', opts = {}) {
    const v = VARIANTS[variant] || VARIANTS.npc1;
    this.variant = variant;
    this.v = v;

    const root = new THREE.Group();
    this.model = root;

    // Pernas (presas à raiz, não ao tronco)
    this.legs = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';
      const hip = pivot(side * 0.12, 0.64, 0);
      root.add(hip);
      hip.add(part(capG(0.1, 0.16), v.pants, 0, -0.17, 0));
      const knee = pivot(0, -0.34, 0);
      hip.add(knee);
      knee.add(part(capG(0.09, 0.12), v.pants, 0, -0.14, 0));
      knee.add(part(boxG(0.2, 0.14, 0.28), v.boots, 0, -0.23, 0.04));
      this.legs[key] = { hip, knee };
    }

    // Tronco e cabeça (sobem e descem com o bob)
    const upper = pivot(0, 0.64, 0);
    root.add(upper);
    this.upper = upper;

    upper.add(part(boxG(0.44, 0.46, 0.28), v.top, 0, 0.22, 0));
    upper.add(part(boxG(0.46, 0.07, 0.3), v.belt, 0, 0.0, 0));
    if (v.vest) upper.add(part(boxG(0.4, 0.34, 0.12), v.vest, 0, 0.24, 0.17));
    if (v.scarf) upper.add(part(boxG(0.22, 0.07, 0.22), v.scarf, 0, 0.46, 0.02));
    upper.add(part(cylG(0.07, 0.1), v.skin, 0, 0.5, 0));

    const head = pivot(0, 0.72, 0);
    upper.add(head);
    this.head = head;
    head.add(part(ballG(0.28), v.skin, 0, 0, 0, 1, 0.92, 0.95));
    head.add(part(ballG(0.06), v.skin, -0.27, -0.02, 0));
    head.add(part(ballG(0.06), v.skin, 0.27, -0.02, 0));

    // Olhos grandes com íris e brilho
    for (const sx of [-1, 1]) {
      head.add(part(ballG(0.075), 0xffffff, sx * 0.1, -0.02, 0.24, 1, 1.15, 0.5));
      head.add(part(ballG(0.05), v.eyes, sx * 0.1, -0.03, 0.27, 1, 1.1, 0.6));
      head.add(part(ballG(0.018), 0xffffff, sx * 0.112, 0.0, 0.3));
    }
    head.add(part(boxG(0.05, 0.02, 0.02), 0x5a2a2a, 0, -0.13, 0.27));

    this._buildHair(head);

    // Braços: ombro > cotovelo > mão
    this.arms = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';
      const shoulder = pivot(side * 0.29, 0.4, 0);
      upper.add(shoulder);
      shoulder.add(part(capG(0.1, 0.12), v.top, 0, -0.11, 0));
      shoulder.add(part(cylG(0.105, 0.03), v.trim, 0, -0.2, 0));
      const elbow = pivot(0, -0.22, 0);
      shoulder.add(elbow);
      elbow.add(part(capG(0.075, 0.08), v.glove, 0, -0.11, 0));
      const hand = pivot(0, -0.24, 0);
      elbow.add(hand);
      hand.add(part(ballG(0.085), v.glove, 0, -0.02, 0));
      this.arms[key] = { shoulder, elbow, hand };
    }
    this.weapons = buildWeapons(this.arms.R.hand);
    this.weapon = 'none';

    // Estado de pose e de golpe
    this.pose = this._restPose();
    this.target = this._restPose();
    this.gaitT = 0;
    this.runW = 0;
    this.strikeT = 0;
    this.strikeDur = 0.3;
    this.strikeKind = null;
    this.strikeSide = 1;
    this.punchSide = 1;
    this.breathT = 0;
    this.seated = false;

    // Desempenho: sombra só onde o opts pedir (NPCs não projetam); culling do motor fica ligado
    const shadows = opts.shadows !== false;
    this.model.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
    // marca tudo o que o chibi criou; qualquer outra peça encaixada no modelo é estranha
    this.model.traverse((o) => { o.userData.chibi = true; });
  }

  _buildHair(head) {
    const v = this.v;
    if (v.hairStyle === 'spiky') {
      head.add(part(ballG(0.3), v.hair, 0, 0.06, 0, 1.02, 0.75, 1.03));
      head.add(part(coneG(0.075, 0.22), v.hair, 0, 0.3, 0.02));
      head.add(part(coneG(0.07, 0.2), v.hair, -0.13, 0.26, 0.02, 1, 1, 1).rotateZ(0.5));
      head.add(part(coneG(0.07, 0.2), v.hair, 0.13, 0.26, 0.02, 1, 1, 1).rotateZ(-0.5));
      head.add(part(coneG(0.065, 0.18), v.hair, 0, 0.27, -0.12).rotateX(-0.5));
      head.add(part(boxG(0.36, 0.08, 0.08), v.hair, 0, 0.12, 0.23));
    } else if (v.hairStyle === 'flat') {
      head.add(part(ballG(0.3), v.hair, 0, 0.05, 0, 1.03, 0.8, 1.03));
      head.add(part(boxG(0.5, 0.1, 0.08), v.hair, 0, 0.15, 0.24));
    } else {
      head.add(part(ballG(0.3), v.hair, 0, 0.04, 0, 1.02, 0.9, 1.02));
      head.add(part(boxG(0.07, 0.3, 0.26), v.hair, -0.27, -0.1, -0.02));
      head.add(part(boxG(0.07, 0.3, 0.26), v.hair, 0.27, -0.1, -0.02));
      head.add(part(boxG(0.5, 0.1, 0.08), v.hair, 0, 0.14, 0.24));
    }
  }

  _restPose() {
    return {
      legL: 0, legR: 0, kneeL: 0, kneeR: 0,
      armL: 0, armR: 0, elbowL: 0.15, elbowR: 0.15,
      zL: 0.2, zR: -0.2, bob: 0, lean: 0, twist: 0,
    };
  }

  // Sentado (banco do avião): pernas para frente, braços à frente segurando o manche
  setSeated(on) {
    this.seated = !!on;
    this.resetPose();
  }

  setWeapon(key) {
    this.weapon = key && this.weapons[key] ? key : 'none';
    for (const k of Object.keys(this.weapons)) this.weapons[k].visible = (k === this.weapon);
  }

  // kind: 'punch' | 'melee' | 'shoot'. Retorna false se já estiver golpeando.
  strike(kind) {
    if (this.strikeT > 0) return false;
    this.strikeKind = kind;
    if (kind === 'punch') {
      this.strikeDur = 0.3;
      this.strikeSide = this.punchSide;
      this.punchSide = -this.punchSide;
    } else if (kind === 'melee') {
      this.strikeDur = 0.38;
      this.strikeSide = 1;
    } else {
      this.strikeDur = 0.22;
      this.strikeSide = 1;
    }
    this.strikeT = this.strikeDur;
    return true;
  }

  // o: { speed, grounded, vy }. dt = 0 mantém a pose atual sem avançar o tempo.
  update(dt, o) {
    const speed = Math.max(0, o.speed || 0);
    const grounded = o.grounded !== false;
    const vy = o.vy || 0;

    const k = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;
    const runTarget = o.runFrac !== undefined ? clamp(o.runFrac, 0, 1) : clamp((speed - 4.5) / 4.5, 0, 1);
    this.runW += (runTarget - this.runW) * k;

    if (dt > 0) {
      this.breathT += dt;
      const moving = grounded && speed > 0.3;
      // cadência: passos por segundo crescem com a velocidade
      if (moving) this.gaitT += dt * Math.PI * 2 * (0.8 + 0.1 * speed);
      else this.gaitT += dt * 0.5;
      this.strikeT = Math.max(0, this.strikeT - dt);
    }

    const target = this._targetPose(o, grounded, speed, vy);
    this.target = target;

    // Suavização da pose (amortecimento exponencial por campo)
    for (const key of Object.keys(target)) {
      this.pose[key] += (target[key] - this.pose[key]) * k;
    }

    // Golpe por cima da pose
    if (this.strikeT > 0) this._applyStrike(this.strikeT / this.strikeDur);

    this._apply();
  }

  _targetPose(o, grounded, speed, vy) {
    const p = this._restPose();
    if (this.seated) { Object.assign(p, SEAT_POSE); return p; }
    const rw = this.runW;

    if (!grounded) {
      if (vy > 0) {
        // pulo: pernas dobradas e braços para cima
        Object.assign(p, { legL: 0.5, legR: 0.5, kneeL: 1.0, kneeR: 1.0, armL: 2.3, armR: 2.3, elbowL: 0.2, elbowR: 0.2, zL: 0.25, zR: -0.25, lean: 0 });
      } else {
        // queda: pernas um pouco dobradas, braços abertos para frente
        Object.assign(p, { legL: 0.2, legR: 0.2, kneeL: 0.4, kneeR: 0.4, armL: 1.2, armR: 1.2, elbowL: 0.3, elbowR: 0.3, zL: 0.3, zR: -0.3 });
      }
      this._applyHold(p, 0.9);
      return p;
    }

    if (speed > 0.3) {
      // andar / correr: amplitudes crescem com runW
      const s = Math.sin(this.gaitT);
      const c = Math.cos(this.gaitT);
      const hipAmp = lerp(0.45, 0.85, rw);
      const kneeAmp = lerp(0.5, 1.1, rw);
      const armAmp = lerp(0.4, 0.9, rw);
      const bobAmp = lerp(0.015, 0.045, rw);
      const lean = lerp(0.03, 0.14, rw);

      p.legL = hipAmp * s;
      p.legR = -hipAmp * s;
      p.kneeL = kneeAmp * 0.8 * Math.max(0, c) + 0.05;
      p.kneeR = kneeAmp * 0.8 * Math.max(0, -c) + 0.05;
      p.armL = -armAmp * s;
      p.armR = armAmp * s;
      p.elbowL = lerp(0.35, 1.2, rw);
      p.elbowR = lerp(0.35, 1.2, rw);
      p.zL = lerp(0.22, 0.28, rw);
      p.zR = -lerp(0.22, 0.28, rw);
      p.bob = bobAmp * (0.5 - 0.5 * Math.cos(2 * this.gaitT));
      p.lean = lean;
      p.twist = -lerp(0.06, 0.16, rw) * s;
    } else {
      // parado: respiração lenta
      const br = Math.sin(this.breathT * 2.0);
      p.bob = 0.008 * br;
      p.armL = 0.04 * br;
      p.armR = -0.04 * br;
    }

    this._applyHold(p, 1.0);
    return p;
  }

  // Pose de arma segurada. weight 0..1 (1 = totalmente na pose)
  _applyHold(p, weight) {
    const hold = HOLD[this.weapon];
    if (!hold) return;
    for (const key of ['armR', 'elbowR', 'zR', 'armL', 'elbowL', 'zL']) {
      p[key] = lerp(p[key], hold[key], weight);
    }
    // Com arma, o balanço das pernas continua mas os braços ficam fixos
  }

  // ext: 1 no início do golpe, cai para 0 no fim
  _applyStrike(t) {
    const u = 1 - t;               // progresso 0..1
    const ext = Math.sin(u * Math.PI);
    if (this.strikeKind === 'punch') {
      const arm = this.strikeSide > 0 ? 'R' : 'L';
      const other = arm === 'R' ? 'L' : 'R';
      this.pose['arm' + arm] = lerp(this.pose['arm' + arm], 1.5, ext);
      this.pose['elbow' + arm] = lerp(this.pose['elbow' + arm], 0.1, ext);
      this.pose['z' + arm] = lerp(this.pose['z' + arm], arm === 'R' ? -0.05 : 0.05, ext);
      // o peito gira em direção ao braço que soca (lado direito = -x)
      this.pose.twist -= this.strikeSide * 0.3 * ext;
      this.pose['arm' + other] = lerp(this.pose['arm' + other], -0.3, ext * 0.5);
    } else if (this.strikeKind === 'melee') {
      const sw = Math.sin((u - 0.15) * Math.PI * 1.15);
      this.pose.armR = lerp(this.pose.armR, 1.6, ext);
      this.pose.elbowR = lerp(this.pose.elbowR, 0.2, ext);
      this.pose.twist += sw * 0.5;
    } else {
      // recuo de disparo
      this.pose.armR = this.pose.armR - 0.25 * ext;
      this.pose.elbowR = this.pose.elbowR + 0.2 * ext;
    }
  }

  _apply() {
    const p = this.pose;
    this.legs.L.hip.rotation.set(-p.legL, 0, 0);
    this.legs.R.hip.rotation.set(-p.legR, 0, 0);
    this.legs.L.knee.rotation.set(p.kneeL, 0, 0);
    this.legs.R.knee.rotation.set(p.kneeR, 0, 0);

    this.upper.position.y = 0.64 + p.bob;
    // X positivo inclina o topo para +z (frente)
    this.upper.rotation.set(p.lean, p.twist, 0);
    this.head.rotation.set(-p.lean * 0.5, -p.twist * 0.5, 0);

    this.arms.L.shoulder.rotation.set(-p.armL, 0, p.zL);
    this.arms.R.shoulder.rotation.set(-p.armR, 0, p.zR);
    this.arms.L.elbow.rotation.set(-p.elbowL, 0, 0);
    this.arms.R.elbow.rotation.set(-p.elbowR, 0, 0);
  }

  // Reinicia a pose para o repouso (sem avançar o tempo)
  resetPose() {
    this.pose = this._restPose();
    this.target = this._restPose();
    this.strikeT = 0;
    this.gaitT = 0;
    this.runW = 0;
    this._apply();
  }
}

export function createChibi(variant, opts) {
  return new Chibi(variant, opts);
}