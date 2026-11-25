import * as THREE from 'three';
import { mat, rand } from './utils.js';

const WEAPONS = [
  { name: 'Punho', melee: true, range: 1.7, dmg: 22, cd: 0.4, down: 1.2 },
  { name: 'Faca', melee: true, range: 1.9, dmg: 50, cd: 0.35, down: 0 },
  { name: 'Pistola', range: 70, dmg: 45, cd: 0.28, spread: 0.01, auto: false },
  { name: 'Metralhadora', range: 70, dmg: 20, cd: 0.08, spread: 0.04, auto: true },
  { name: 'Bazuca', rocket: true, cd: 1.3 },
];
const ROCKET_SPEED = 45, BLAST = 10;

const box = (w, h, d, color, x, y, z) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};

const model = (...parts) => {
  const g = new THREE.Group();
  g.position.y = -0.62;
  g.visible = false;
  for (const p of parts) g.add(p);
  return g;
};

export class Weapons {
  constructor(scene, fx, npcs, vehicles, physics, player) {
    this.fx = fx;
    this.npcs = npcs;
    this.vehicles = vehicles;
    this.physics = physics;
    this.player = player;
    this.cur = 0;
    this.cd = 0;
    this.swing = 0;
    this.kick = 0;
    this._show = null;
    this.tmp = { x: 0, z: 0 };
    this.onCrime = null; // chamado quando o jogador atinge um NPC (procura da polícia)

    this.models = [
      null,
      model(box(0.03, 0.3, 0.07, 0xd0d4d8, 0, -0.2, 0), box(0.04, 0.11, 0.04, 0x222222, 0, -0.02, 0)),
      model(box(0.05, 0.24, 0.07, 0x222222, 0, -0.1, 0.02), box(0.045, 0.06, 0.1, 0x111111, 0, 0, -0.05)),
      model(
        box(0.06, 0.55, 0.09, 0x2b2b2b, 0, -0.22, 0.02),
        box(0.045, 0.07, 0.16, 0x1a1a1a, 0, -0.1, -0.1),
        box(0.03, 0.2, 0.03, 0x111111, 0, -0.6, 0.03),
      ),
      model(
        box(0.15, 0.95, 0.15, 0x4b5a3a, 0, -0.1, 0.02),
        box(0.17, 0.08, 0.17, 0x222222, 0, 0.37, 0.02),
        box(0.17, 0.08, 0.17, 0x222222, 0, -0.57, 0.02),
      ),
    ];
    // O personagem procedural antigo possui userData.armR.
    // Em modelos GLB esse pivô customizado pode não existir.
    this.weaponAnchor = player.model.userData?.armR || player.model;
    this.armForPose = player.model.userData?.armR || null;

    for (const g of this.models) {
      if (!g) continue;
      if (this.weaponAnchor === player.model) {
        // Posição aproximada da mão direita, relativa à raiz do personagem.
        g.position.set(0.28, 1.2, 0.18);
      }
      this.weaponAnchor.add(g);
    }

    const rg = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8).rotateX(Math.PI / 2);
    this.rockets = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(rg, mat(0x555a4a));
      m.visible = false;
      scene.add(m);
      this.rockets.push({ m, x: 0, y: 0, z: 0, dx: 0, dz: 0, t: 0, on: false });
    }

    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);color:#fff;font:600 14px sans-serif;text-shadow:0 1px 3px #000;pointer-events:none;white-space:nowrap';
    this.cross = document.createElement('div');
    this.cross.style.cssText = 'position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:#fff;box-shadow:0 0 0 1px #000;pointer-events:none;display:none';
    document.getElementById('hud').append(this.el, this.cross);
    this.equip(0);
  }

  reset() {
    this.cd = this.swing = this.kick = 0;
    for (const r of this.rockets) { r.on = false; r.m.visible = false; }
    this.equip(0);
  }

  equip(i) {
    const old = this.models[this.cur];
    if (old) old.visible = false;
    this.cur = i;
    this.cd = 0.2;
    this.swing = this.kick = 0;
    this.el.innerHTML = WEAPONS.map((w, k) => `<span style="opacity:${k === i ? 1 : 0.45};margin:0 8px">${k + 1} ${w.name}</span>`).join('');
  }

  update(dt, c, yaw, p) {
    const w = WEAPONS[this.cur], g = this.models[this.cur];
    const inside = !!(p.vehicle || p.aircraft);
    if (g) g.visible = !inside;
    const show = !inside && !w.melee;
    if (show !== this._show) {
      this._show = show;
      this.cross.style.display = show ? 'block' : 'none';
    }
    this._rockets(dt);
    if (this.cd > 0) this.cd -= dt;
    if (this.swing > 0) this.swing -= dt;
    if (this.kick > 0) this.kick -= dt;
    if (inside) return;
    for (let i = 0; i < WEAPONS.length; i++) if (c.wasPressed('Digit' + (i + 1))) this.equip(i);
    const cw = WEAPONS[this.cur];
    if (this.cd <= 0 && ((cw.auto || cw.melee) ? c.fire : c.firePressed)) this._use(cw, yaw, p);
    this._pose(WEAPONS[this.cur], p);
  }

  _pose(w, p) {
    // Se o GLB não tiver o pivô customizado, o rig/animação controla os braços.
    const arm = this.armForPose || p.model.userData?.armR;
    if (!arm) return;

    if (w.melee) {
      if (this.swing > 0) arm.rotation.x = -1.7 * Math.sin(Math.PI * (1 - this.swing / 0.25));
    } else {
      arm.rotation.x = -1.45 + Math.max(0, this.kick) * 1.5;
    }
  }

  _use(w, yaw, p) {
    this.cd = w.cd;
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    p.heading = yaw;
    p.aimYaw = yaw;
    p.aimT = 0.5;
    if (w.melee) { this.swing = 0.25; this._melee(w, p, dx, dz); }
    else if (w.rocket) { this.kick = 0.15; this._launch(p, dx, dz); }
    else { this.kick = 0.1; this._shoot(w, p, dx, dz); }
  }

  // Alvos das armas: NPCs e policiais a pé (vivos ou caídos, que ignoram o dano).
  _targets() {
    return this.police ? this.npcs.list.concat(this.police.foot) : this.npcs.list;
  }

  _hit(n, dmg, dx, dz, down) {
    if (n.police) this.police.hit(n, dmg, dx, dz, down);
    else this.npcs.hit(n, dmg, dx, dz, down);
  }

  _melee(w, p, dx, dz) {
    let best = null, bd = w.range * w.range;
    for (const n of this._targets()) {
      if (n.dead) continue;
      const ex = n.pos.x - p.pos.x, ez = n.pos.z - p.pos.z, d2 = ex * ex + ez * ez;
      if (d2 > bd) continue;
      const d = Math.sqrt(d2);
      if (d > 0.01 && (ex * dx + ez * dz) / d < 0.5) continue;
      best = n;
      bd = d2;
    }
    if (best) { this._hit(best, w.dmg, dx, dz, w.down); if (this.onCrime) this.onCrime(); }
  }

  _shoot(w, p, dx, dz) {
    const a = rand(-w.spread, w.spread), ca = Math.cos(a), sa = Math.sin(a);
    const rx = dx * ca - dz * sa, rz = dx * sa + dz * ca;
    const t = this.tmp;
    let wall = w.range;
    for (let k = 1; k <= w.range; k++) {
      t.x = p.pos.x + rx * k;
      t.z = p.pos.z + rz * k;
      if (this.physics.resolve(t, 0.05, p.pos.y)) { wall = k; break; }
    }
    let bt = wall;
    // Carros bloqueiam a bala (estacionados também). Crime só se o carro estiver em tráfego ou ocupado.
    let carHit = null;
    for (const v of this.vehicles.list) {
      for (let s = 1; s >= -1; s -= 2) {
        const cx = v.pos.x + v.fx * v.reach * s - p.pos.x, cz = v.pos.z + v.fz * v.reach * s - p.pos.z;
        const d = cx * rx + cz * rz;
        if (d < 0 || d > bt) continue;
        const px = cx - rx * d, pz = cz - rz * d;
        if (px * px + pz * pz < v.radius * v.radius) { carHit = v; bt = d; }
      }
    }
    let best = null;
    for (const n of this._targets()) {
      if (n.dead) continue;
      const ex = n.pos.x - p.pos.x, ez = n.pos.z - p.pos.z;
      const d = ex * rx + ez * rz;
      if (d < 0 || d > bt) continue;
      const px = ex - rx * d, pz = ez - rz * d;
      if (px * px + pz * pz < 0.16) { best = n; bt = d; }
    }
    if (best) { this._hit(best, w.dmg, rx, rz, 0); if (this.onCrime) this.onCrime(); }
    if (carHit && (carHit.ai || carHit.driven) && this.onCrime) this.onCrime();
    this.fx.tracer(p.pos.x + rx * 0.7, p.pos.y + 1.3, p.pos.z + rz * 0.7, p.pos.x + rx * bt, p.pos.z + rz * bt);
  }

  _launch(p, dx, dz) {
    const r = this.rockets.find((q) => !q.on);
    if (!r) return;
    r.on = true;
    r.x = p.pos.x + dx;
    r.z = p.pos.z + dz;
    r.y = p.pos.y + 1.3;
    r.dx = dx;
    r.dz = dz;
    r.t = 0;
    r.m.rotation.y = Math.atan2(dx, dz);
    r.m.visible = true;
  }

  _rockets(dt) {
    for (const r of this.rockets) {
      if (!r.on) continue;
      let left = ROCKET_SPEED * dt, boom = false;
      while (left > 0 && !boom) {
        const s = Math.min(0.5, left);
        left -= s;
        r.x += r.dx * s;
        r.z += r.dz * s;
        r.t += s;
        this.tmp.x = r.x;
        this.tmp.z = r.z;
        if (r.t > 120 || this.physics.resolve(this.tmp, 0.15, r.y - 1.3) || this.vehicles.nearest(r.x, r.z, 2)) boom = true;
        else {
          for (const n of this._targets()) {
            if (n.dead) continue;
            const ex = n.pos.x - r.x, ez = n.pos.z - r.z;
            if (ex * ex + ez * ez < 0.64) { boom = true; break; }
          }
        }
      }
      r.m.position.set(r.x, r.y, r.z);
      if (boom) {
        r.on = false;
        r.m.visible = false;
        this._explode(r.x, r.y, r.z);
      }
    }
  }

  _explode(x, y, z) {
    this.fx.explosion(x, y, z, BLAST * 0.6);
    for (const n of this._targets()) {
      if (n.dead) continue;
      const ex = n.pos.x - x, ez = n.pos.z - z, d = Math.hypot(ex, ez);
      if (d > BLAST) continue;
      const k = d > 0.01 ? 1 / d : 0;
      this._hit(n, 260 * (1 - d / BLAST), ex * k, ez * k, 3);
      if (this.onCrime) this.onCrime();
    }
    const v = this.vehicles.nearest(x, z, BLAST);
    if (v) {
      const ex = v.pos.x - x, ez = v.pos.z - z, d = Math.hypot(ex, ez) || 1;
      v.speed += ((Math.sin(v.heading) * ex + Math.cos(v.heading) * ez) / d) * 15 * (1 - d / BLAST);
    }
  }
}