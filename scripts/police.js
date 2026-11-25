import * as THREE from 'three';
import { createChibi, VARIANTS } from './chibi.js';
import { mat, rand, clamp, angleDiff, TAU } from './utils.js';

// Uniforme da polícia: reaproveita a estrutura de uma variação existente (VARIANTS é objeto mutável).
VARIANTS.police = {
  ...VARIANTS.npc1,
  top: 0x1d3a7a, trim: 0xe0b040, vest: 0x14213d, belt: 0x111111,
  pants: 0x14213d, boots: 0x111111, hair: 0x222222, hairStyle: 'flat', scarf: null,
};

const WANTED_T = 30;          // s sem policial por perto até a procura esfriar
const FOOT_HP = 100;          // mesma vida dos NPCs
const NEAR_PLAYER = 40;       // m: policial a esta distância mantém a procura
const BLINK_HZ = 4;           // ciclos por segundo da barra de luz
const FOOT_COUNT = 4;         // policiais a pé quando o jogador está a pé
const FOOT_MIN = 50, FOOT_MAX = 50; // m: distância de spawn
const FOOT_RUN_MULT = 1.5;    // 1,5x a velocidade de corrida do jogador
const DEFAULT_RUN = 6;        // m/s, se Player não expuser runSpeed
const HIT_DIST = 1.1;         // m: contato com policial a pé = derrota
const BODY_R = 0.35;
const CAR_COUNT = 2;
const CAR_SPAWN_MIN = 55, CAR_SPAWN_MAX = 80;
const CAR_MODEL = 0;          // índice do modelo (carro1.glb)
const CAR_SPEED = 100 / 3.6;  // 100 km/h
const CAR_ACCEL = 8, CAR_BRAKE = 12, CAR_TURN = 2.2; // m/s², rad/s
const CAR_SHOOT_RANGE = 14, CAR_SHOOT_CD = 4;
const ROCKET_SPEED = 35, ROCKET_HIT = 1.2, BLAST = 6;
const STUCK_T = 2;
const LOSE_FADE = 2.5;        // s para escurecer a tela

const LIGHT_GEO = new THREE.BoxGeometry(0.3, 0.12, 0.2);
const ROCKET_GEO = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8).rotateX(Math.PI / 2);

const CSS = `
#wanted-badge{position:fixed;top:16px;right:16px;width:56px;height:56px;border-radius:50%;
  background:#111;border:3px solid #ff3030;display:none;align-items:center;justify-content:center;
  pointer-events:none;z-index:20;animation:wantedFlash .5s steps(1) infinite}
@keyframes wantedFlash{0%{box-shadow:0 0 14px 4px #e02020;border-color:#ff3030}
  50%{box-shadow:0 0 14px 4px #2a6bff;border-color:#3a8bff}}
#lose-screen{position:fixed;inset:0;background:#000;display:none;flex-direction:column;
  align-items:center;justify-content:center;z-index:50;opacity:0}
#lose-title{font:italic 900 64px Impact,'Arial Black',sans-serif;color:#2f8fff;letter-spacing:2px;
  text-shadow:3px 3px 0 #0a1f4d,-2px -2px 0 #fff;opacity:0}
#lose-btn{margin-top:28px;padding:12px 36px;font:700 20px Impact,sans-serif;background:#2f8fff;color:#fff;
  border:0;border-radius:4px;cursor:pointer;opacity:0;pointer-events:none}
`;

export class Police {
  constructor({ scene, physics, vehicles, fx, player, notify, onRestart }) {
    this.scene = scene;
    this.physics = physics;
    this.vehicles = vehicles;
    this.fx = fx;
    this.player = player;
    this.notify = notify;
    this.onRestart = onRestart;

    this.wanted = false;
    this.timer = 0;
    this.t = 0;
    this.foot = [];      // { chibi, model, pos, heading }
    this.cars = [];      // viaturas em perseguição
    this.rockets = [];   // { m, x, y, z, dx, dz, t }
    this.loseT = 0;

    this._patchTraffic();
    this._buildUi();
  }

  // ---------- Interface ----------
  _buildUi() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.badge = document.createElement('div');
    this.badge.id = 'wanted-badge';
    this.badge.innerHTML = `<svg width="34" height="34" viewBox="0 0 24 24">
      <path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z" fill="#fff"/>
      <path d="M12 7l1.2 2.6 2.8.3-2.1 1.9.6 2.8L12 13.3l-2.5 1.3.6-2.8-2.1-1.9 2.8-.3z" fill="#1d3a7a"/></svg>`;
    document.body.appendChild(this.badge);

    this.lose = document.createElement('div');
    this.lose.id = 'lose-screen';
    this.lose.innerHTML = '<div id="lose-title">Perdeu Playboy</div><button id="lose-btn">Reiniciar</button>';
    document.body.appendChild(this.lose);
    this.loseTitle = this.lose.querySelector('#lose-title');
    this.loseBtn = this.lose.querySelector('#lose-btn');
    this.loseBtn.addEventListener('click', () => { if (this.onRestart) this.onRestart(); });
  }

  // ---------- API pública ----------
  // Chamado quando o jogador ataca um NPC ou rouba um carro com motorista fugindo.
  crime() {
    this.wanted = true;
    this.timer = WANTED_T;
    this.badge.style.display = 'flex';
    this._sync();
  }

  reset() {
    this._clearAll();
    this.wanted = false;
    this.timer = 0;
    this.loseT = 0;
    this.badge.style.display = 'none';
    this.lose.style.display = 'none';
    this.lose.style.opacity = '0';
    this.loseTitle.style.opacity = '0';
    this.loseBtn.style.opacity = '0';
    this.loseBtn.style.pointerEvents = 'none';
  }

  showLose() {
    this.loseT = 0;
    this._clearAll();
    this.badge.style.display = 'none';
    this.lose.style.display = 'flex';
    this.lose.style.opacity = '0';
    this.loseTitle.style.opacity = '0';
    this.loseBtn.style.opacity = '0';
    this.loseBtn.style.pointerEvents = 'none';
  }

  fadeLose(dt) {
    this.loseT += dt;
    const f = clamp(this.loseT / LOSE_FADE, 0, 1);
    this.lose.style.opacity = String(f);
    this.loseTitle.style.opacity = String(clamp((f - 0.6) / 0.4, 0, 1));
    if (f >= 1) {
      this.loseBtn.style.opacity = '1';
      this.loseBtn.style.pointerEvents = 'auto';
    }
  }

  // Retorna 'hit' (policial encostou), 'rocket' (bazuca atingiu) ou null.
  update(dt, p) {
    if (!this.wanted) return null;
    this.t += dt;
    this._sync();

    let near = false;
    const pos = p.pos;

    // Policiais a pé
    for (const n of this.foot) {
      if (n.dead) continue;
      const dx = pos.x - n.pos.x, dz = pos.z - n.pos.z, d = Math.hypot(dx, dz);
      if (d < NEAR_PLAYER) near = true;
      if (d < HIT_DIST) return 'hit';
      if (d > 0.01) {
        n.heading = Math.atan2(dx, dz);
        const spd = FOOT_RUN_MULT * this._run();
        const step = Math.min(spd * dt, d);
        n.pos.x += (dx / d) * step;
        n.pos.z += (dz / d) * step;
      }
      this.physics.resolve(n.pos, BODY_R, 0);
      this.vehicles.pushOut(n.pos, BODY_R);
      n.model.position.set(n.pos.x, 0, n.pos.z);
      n.model.rotation.y = n.heading;
      n.chibi.update(dt, { speed: FOOT_RUN_MULT * this._run(), grounded: true, vy: 0, runFrac: 1 });
    }

    // Viaturas: movimento fica no _traffic patchado; aqui, tiro e luz.
    for (const v of this.cars) {
      const st = v.pursuit;
      if (near === false && Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) < NEAR_PLAYER) near = true;
      st.shotT -= dt;
      const dx = pos.x - v.pos.x, dz = pos.z - v.pos.z, d = Math.hypot(dx, dz);
      if (p.vehicle && d < CAR_SHOOT_RANGE && st.shotT <= 0) {
        st.shotT = CAR_SHOOT_CD;
        this._launch(v.pos.x + (dx / d) * 2, 1.2, v.pos.z + (dz / d) * 2, dx / d, dz / d);
      }
      const on = Math.floor(this.t * BLINK_HZ * 2) % 2;
      v.light.red.visible = on === 0;
      v.light.blue.visible = on === 1;
    }

    if (this._rockets(dt, pos)) return 'rocket';

    // Procura esfria só depois de WANTED_T sem policial por perto
    if (near) this.timer = WANTED_T;
    else this.timer -= dt;
    if (this.timer <= 0) {
      this.wanted = false;
      this._clearAll();
      this.badge.style.display = 'none';
      this.notify('Você não está mais procurado');
    }
    return null;
  }

  // ---------- Estado ----------
  _run() {
    const r = this.player.runSpeed;
    return r > 0 ? r : DEFAULT_RUN;
  }

  _sync() {
    const p = this.player;
    const inCar = !!(p.vehicle || p.aircraft);
    // Viatura que o jogador assumiu deixa de ser polícia
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (v.driven) { this._detachCar(v); this.cars.splice(i, 1); }
    }
    if (inCar) {
      this._clearFoot();
      for (let i = this.cars.length; i < CAR_COUNT; i++) this._spawnCar();
    } else {
      this._clearCars();
      // Nova leva de policiais só quando todos da leva anterior estiverem mortos (corpos ficam no chão)
      if (this.foot.every((n) => n.dead)) for (let i = 0; i < FOOT_COUNT; i++) this._spawnFoot();
    }
  }

  _clearAll() {
    this._clearFoot();
    this._clearCars();
    for (const r of this.rockets) this.scene.remove(r.m);
    this.rockets.length = 0;
  }

  _clearFoot() {
    for (const n of this.foot) this.scene.remove(n.model);
    this.foot.length = 0;
  }

  _clearCars() {
    for (const v of this.cars) this._detachCar(v, true);
    this.cars.length = 0;
  }

  _detachCar(v, remove = false) {
    v.pursuit = null;
    v.ai = null;
    if (v.light) { v.light.bar.visible = false; }
    if (remove) {
      const i = this.vehicles.list.indexOf(v);
      if (i >= 0) this.vehicles.list.splice(i, 1);
      this.scene.remove(v.group);
    }
  }

  // ---------- Policiais a pé ----------
  _spawnFoot() {
    const p = this.player;
    for (let tries = 0; tries < 8; tries++) {
      const a = rand(0, TAU), d = rand(FOOT_MIN, FOOT_MAX);
      const pos = { x: p.pos.x + Math.sin(a) * d, y: 0, z: p.pos.z + Math.cos(a) * d };
      if (this.physics.resolve(pos, BODY_R, 0) || this.vehicles.pushOut(pos, BODY_R)) continue;
      const chibi = createChibi('police', { shadows: false });
      const model = chibi.model;
      model.rotation.order = 'YXZ';
      model.position.set(pos.x, 0, pos.z);
      this.scene.add(model);
      this.foot.push({ chibi, model, pos, heading: 0, hp: FOOT_HP, dead: false, police: true });
      return;
    }
  }

  // Dano de arma/explosão em policial a pé. Morto cai no chão e fica até a procura acabar.
  hit(n, dmg, dx, dz, down) {
    if (n.dead) return;
    n.hp -= dmg;
    n.pos.x += dx * down * 0.3;
    n.pos.z += dz * down * 0.3;
    if (n.hp > 0) return;
    n.dead = true;
    n.model.rotation.set(-Math.PI / 2, n.heading, 0, 'YXZ');
    n.model.position.set(n.pos.x, 0.2, n.pos.z);
  }

  // ---------- Viaturas ----------
  _spawnCar() {
    const p = this.player;
    for (let tries = 0; tries < 8; tries++) {
      const a = rand(0, TAU), d = rand(CAR_SPAWN_MIN, CAR_SPAWN_MAX);
      const x = p.pos.x + Math.sin(a) * d, z = p.pos.z + Math.cos(a) * d;
      if (this.physics.resolve({ x, z }, 1.2, 0)) continue;
      const v = this.vehicles.spawn(x, z, Math.atan2(p.pos.x - x, p.pos.z - z), CAR_MODEL);
      v.ai = { pursuit: true };
      v.pursuit = { stuck: 0, shotT: rand(1, CAR_SHOOT_CD) };
      v.speed = 0;
      this._buildLight(v);
      this.cars.push(v);
      return;
    }
  }

  _buildLight(v) {
    const bar = new THREE.Group();
    bar.position.set(0, v.type.h + 0.15, 0);
    const red = new THREE.Mesh(LIGHT_GEO, mat(0xff2a2a));
    red.position.x = -0.2;
    const blue = new THREE.Mesh(LIGHT_GEO, mat(0x2a6bff));
    blue.position.x = 0.2;
    bar.add(red, blue);
    v.group.add(bar);
    v.light = { bar, red, blue };
  }

  // Substitui o tráfego para viaturas da polícia: vão direto ao jogador, ignoram ruas.
  _patchTraffic() {
    const vm = this.vehicles;
    const origTraffic = vm._traffic.bind(vm);
    vm._traffic = (v, dt, focus) => (v.pursuit ? this._drive(v, dt) : origTraffic(v, dt, focus));
    const origHas = vm.hasDriver.bind(vm);
    vm.hasDriver = (v) => !v.pursuit && origHas(v);
  }

  _drive(v, dt) {
    const p = this.player, st = v.pursuit;
    const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z, d = Math.hypot(dx, dz);
    const diff = angleDiff(v.heading, Math.atan2(dx, dz));
    v.heading += clamp(diff, -CAR_TURN * dt, CAR_TURN * dt);

    // Curva fechada: reduz a velocidade; reta: 100 km/h
    const target = Math.abs(diff) > 1.2 ? 8 : CAR_SPEED;
    if (v.speed < target) v.speed = Math.min(target, v.speed + CAR_ACCEL * dt);
    else v.speed = Math.max(target, v.speed - CAR_BRAKE * dt);

    v.fx = Math.sin(v.heading);
    v.fz = Math.cos(v.heading);
    v.pos.x += v.fx * v.speed * dt;
    v.pos.z += v.fz * v.speed * dt;
    v.steer = clamp(diff, -0.5, 0.5);
    v.spin += (v.speed * dt) / (v.type.wheelR || 0.35);

    // Preso (batendo em prédio): teleporta para perto, na frente do jogador
    if (v.speed < 1 && d > 12) {
      st.stuck += dt;
      if (st.stuck > STUCK_T) {
        const a = Math.atan2(v.pos.x - p.pos.x, v.pos.z - p.pos.z) + rand(-0.6, 0.6);
        v.pos.x = p.pos.x + Math.sin(a) * CAR_SPAWN_MIN;
        v.pos.z = p.pos.z + Math.cos(a) * CAR_SPAWN_MIN;
        v.heading = Math.atan2(p.pos.x - v.pos.x, p.pos.z - v.pos.z);
        v.speed = 0;
        st.stuck = 0;
      }
    } else st.stuck = 0;
    v.sync();
  }

  // ---------- Bazuca ----------
  _launch(x, y, z, dx, dz) {
    const m = new THREE.Mesh(ROCKET_GEO, mat(0x3a3f33));
    m.rotation.y = Math.atan2(dx, dz);
    this.scene.add(m);
    this.rockets.push({ m, x, y, z, dx, dz, t: 0 });
  }

  // Avança os foguetes. Retorna true se algum atingiu o jogador.
  _rockets(dt, pos) {
    let hit = false;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      const step = ROCKET_SPEED * dt;
      r.x += r.dx * step;
      r.z += r.dz * step;
      r.t += dt;
      r.m.position.set(r.x, r.y, r.z);
      const pd = Math.hypot(pos.x - r.x, pos.z - r.z);
      let boom = pd < ROCKET_HIT;
      if (boom) hit = true;
      if (!boom && r.t > 0.15) {
        const t = { x: r.x, z: r.z };
        if (this.physics.resolve(t, 0.15, r.y - 1.3) || r.t > 6) boom = true;
      }
      if (boom) {
        this.fx.explosion(r.x, r.y, r.z, BLAST * 0.6);
        r.m.visible = false;
        this.scene.remove(r.m);
        this.rockets.splice(i, 1);
      }
    }
    return hit;
  }
}