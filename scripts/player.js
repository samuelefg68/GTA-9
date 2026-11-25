import * as THREE from 'three';
import { angleLerp, damp, groundHeight } from './utils.js';
import { createChibi } from './chibi.js';

const tmp = { x: 0, z: 0 };

// Normaliza nomes de arma (do HUD, teclas 1..5 ou campos externos) para as chaves do chibi
const WEAPON_KEYS = [
  [/^1$/, 'none'],
  [/^2$/, 'melee'],
  [/^3$/, 'pistol'],
  [/^4$/, 'rifle'],
  [/^5$/, 'bazooka'],
  [/auto|automatic|autom/i, 'rifle'],
  [/rpg|foguete/i, 'bazooka'],
  [/bazuca|bazooka|rocket|rpg/i, 'bazooka'],
  [/metralhadora|rifle|ak|m4|smg|sub|carbine|sniper|machine/i, 'rifle'],
  [/pistol|pistola|handgun|glock|revolver/i, 'pistol'],
  [/faca|knife|bat|sword|katana|club|crowbar|melee|taco/i, 'melee'],
  [/punho|fist|unarmed|none|nenhuma/i, 'none'],
];

export class Player {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.model = null;
    this.chibi = null;
    this.baseScale = 1;
    this.pos = { x: 0, y: 0, z: 0 };
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.heading = 0;
    this.speed = 0;
    this.grounded = true;
    this.radius = 0.4;
    this.aimYaw = 0;
    this.aimT = 0;
    this.vehicle = null;
    this.aircraft = null;
    this.weapon = 'none';
    this._mouseBound = false;
  }

  setWeapon(weaponName) {
    const name = String(weaponName || 'none');
    let key = 'none';
    for (const [rx, k] of WEAPON_KEYS) {
      if (rx.test(name)) { key = k; break; }
    }
    this.weapon = key;
    if (this.chibi) this.chibi.setWeapon(key);
  }

  // Golpe com a arma atual: soco (sem arma), golpe corpo a corpo ou tiro (recuo)
  attack(weaponOverride = null) {
    if (this.vehicle || this.aircraft || !this.chibi) return false;
    if (weaponOverride) this.setWeapon(weaponOverride);
    const kind = this.weapon === 'none' ? 'punch'
      : this.weapon === 'melee' ? 'melee'
      : 'shoot';
    return this.chibi.strike(kind);
  }

  // Soco e golpe usam a arma atual: sem arma é soco, com faca é golpe, com arma de fogo é tiro.
  punch() {
    return this.attack();
  }

  _bindAttackInputs() {
    if (this._mouseBound || typeof window === 'undefined') return;
    this._mouseBound = true;
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !this.vehicle) this.attack();
    });
  }

  // Esconde peças que não foram criadas pelo chibi (ex.: modelos antigos de arma do weapons.js)
  _hideForeign() {
    if (!this.model) return;
    this.model.traverse((o) => {
      if (o !== this.model && !(o.userData && o.userData.chibi)) o.visible = false;
    });
  }

  // Mantém a assinatura antiga (game.js passa a URL). O modelo agora é procedural.
  async load() {
    this._bindAttackInputs();
    const chibi = createChibi('player');
    this.chibi = chibi;
    this.model = chibi.model;
    this.scene.add(this.model);
    this.setWeapon(this.weapon);
    this.chibi.update(0, { speed: 0, grounded: true, vy: 0 });
    return [];
  }

  reset(sp) {
    if (this.aircraft) this._detachAircraft();
    if (this.vehicle) {
      this.vehicle.driven = false;
      this.vehicle = null;
      this._detach();
    }
    this.pos.x = sp.x; this.pos.z = sp.z; this.pos.y = groundHeight(sp.x, sp.z);
    this.vx = this.vz = this.vy = 0;
    this.heading = Math.PI;
    this.grounded = true;
    this.aimT = 0;
    if (this.chibi) this.chibi.resetPose();
    this.sync();
  }

  update(dt, c, camYaw, vm) {
    if (this.vehicle) {
      if (this.chibi) this.chibi.update(0, { speed: 0, grounded: true, vy: 0 });
      this._hideForeign();
      return;
    }

    // Troca de arma pelas teclas 1..5 (Punho, Faca, Pistola, Metralhadora, Bazuca)
    if (c && c.wasPressed) {
      const keys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
      const names = ['none', 'melee', 'pistol', 'rifle', 'bazooka'];
      for (let i = 0; i < keys.length; i++) {
        if (c.wasPressed(keys[i])) { this.setWeapon(names[i]); break; }
      }
    }

    // Golpe por teclado (F ou Q) ou quando a mira ativa um golpe externamente
    if (c && c.wasPressed && (c.wasPressed('KeyF') || c.wasPressed('KeyQ'))) {
      this.attack();
    } else if (this.aimT > 0.22) {
      this.attack();
    }

    const f = (c.down('KeyW') ? 1 : 0) - (c.down('KeyS') ? 1 : 0);
    const s = (c.down('KeyD') ? 1 : 0) - (c.down('KeyA') ? 1 : 0);
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    let wx = sy * f - cy * s, wz = cy * f + sy * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const run = c.down('ShiftLeft') || c.down('ShiftRight');
    const target = len > 0 ? (run ? 9 : 4.5) : 0;
    const k = this.grounded ? 14 : 4;
    this.vx = damp(this.vx, wx * target, k, dt);
    this.vz = damp(this.vz, wz * target, k, dt);
    if (len > 0) this.heading = angleLerp(this.heading, Math.atan2(wx, wz), 1 - Math.exp(-14 * dt));
    if (this.aimT > 0) { this.aimT -= dt; this.heading = this.aimYaw; }

    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    vm.pushOut(this.pos, this.radius);
    this.physics.resolve(this.pos, this.radius, this.pos.y);

    if (c.wasPressed('Space') && this.grounded) {
      this.vy = 9.5;
      this.grounded = false;
    }
    this.physics.stepVertical(this, dt, groundHeight(this.pos.x, this.pos.z));

    this.speed = Math.hypot(this.vx, this.vz);
    if (this.chibi) {
      this.chibi.update(dt, { speed: this.speed, grounded: this.grounded, vy: this.vy });
      this._hideForeign();
    }
  }

  sync() {
    if (this.aircraft) return; // o avião move o personagem
    const v = this.vehicle;
    if (v) {
      this.pos.x = v.pos.x; this.pos.y = v.pos.y; this.pos.z = v.pos.z;
      this.heading = v.heading;
      this.speed = Math.abs(v.speed);
    } else if (this.model) {
      this.model.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.model.rotation.y = this.heading;
    }
  }

  tryEnter(vm) {
    const v = vm.nearest(this.pos.x, this.pos.z, 4.2);
    if (!v || !this.model) return false;
    this.vehicle = v;
    v.driven = true;
    const m = this.model;
    m.removeFromParent();
    v.group.add(m);
    m.position.set(v.seat.x, v.seat.y, v.seat.z);
    m.rotation.set(0, 0, 0);
    m.scale.setScalar(this.baseScale * v.seat.s);
    this.vx = this.vz = 0;
    this.speed = 0;
    if (this.chibi) this.chibi.resetPose();
    return true;
  }

  tryExit(vm) {
    const v = this.vehicle;
    if (!v || Math.abs(v.speed) > 12) return false;
    const c = Math.cos(v.heading), s = Math.sin(v.heading);
    const d = v.type.wid / 2 + 0.9, L = v.type.len / 2 + 0.9;
    const cand = [[c * d, -s * d], [-c * d, s * d], [-s * L, -c * L], [s * L, c * L]];
    let spot = null;
    for (const o of cand) {
      tmp.x = v.pos.x + o[0]; tmp.z = v.pos.z + o[1];
      const x0 = tmp.x, z0 = tmp.z;
      if (!this.physics.resolve(tmp, this.radius, 0) && !vm.pushOut(tmp, this.radius)) {
        spot = [x0, z0]; break;
      }
    }
    if (!spot) spot = [v.pos.x + cand[0][0], v.pos.z + cand[0][1]];
    v.driven = false;
    this.vehicle = null;
    this._detach();
    this.pos.x = spot[0]; this.pos.z = spot[1];
    this.pos.y = groundHeight(spot[0], spot[1]);
    this.vx = this.vz = this.vy = 0;
    this.heading = v.heading;
    this.grounded = true;
    this.sync();
    return true;
  }

  // ----- Avião: o personagem senta no banco e segue o avião -----
  enterAircraft(ac) {
    if (!this.model || this.vehicle || this.aircraft || !ac.canBoard(this.pos.x, this.pos.z)) return false;
    this.aircraft = ac;
    this.model.removeFromParent();
    ac.root.add(this.model);
    this.model.position.copy(ac.seat);
    this.model.rotation.set(0, 0, 0);
    this.model.scale.setScalar(this.baseScale);
    this.chibi.setSeated(true);
    this.vx = this.vz = 0;
    this.speed = 0;
    this.followAircraft(ac);
    return true;
  }

  exitAircraft() {
    const ac = this.aircraft;
    if (!ac || !ac.canLeave()) return false;
    const h = ac.heading;
    const out = { x: ac.x + Math.cos(h) * 4, z: ac.z - Math.sin(h) * 4 }; // lado esquerdo do avião
    this.physics.resolve(out, this.radius, 0);
    this._detachAircraft();
    this.pos.x = out.x; this.pos.z = out.z;
    this.pos.y = groundHeight(out.x, out.z);
    this.vx = this.vz = this.vy = 0;
    this.heading = h;
    this.grounded = true;
    this.sync();
    return true;
  }

  // Explosão com o piloto dentro: o personagem sai no ponto da explosão
  ejectFromAircraft(x, z, h) {
    this._detachAircraft();
    const out = { x: x - Math.sin(h) * 3, z: z - Math.cos(h) * 3 };
    this.physics.resolve(out, this.radius, 0);
    this.pos.x = out.x; this.pos.z = out.z;
    this.pos.y = groundHeight(out.x, out.z);
    this.vx = this.vz = this.vy = 0;
    this.grounded = true;
    this.sync();
  }

  followAircraft(ac) {
    this.pos.x = ac.x; this.pos.y = ac.y; this.pos.z = ac.z;
    this.heading = ac.heading;
    this.speed = Math.abs(ac.speed);
  }

  _detachAircraft() {
    const m = this.model;
    this.aircraft = null;
    if (!m) return;
    m.removeFromParent();
    this.scene.add(m);
    m.scale.setScalar(this.baseScale);
    m.rotation.set(0, 0, 0);
    this.chibi.setSeated(false);
  }

  _detach() {
    const m = this.model;
    if (!m) return;
    m.removeFromParent();
    this.scene.add(m);
    m.scale.setScalar(this.baseScale);
    m.rotation.set(0, 0, 0);
    if (this.chibi) this.chibi.resetPose();
  }
}