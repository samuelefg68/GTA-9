import * as THREE from 'three';
import { groundHeight, rand } from './utils.js';

const NP = 500, NB = 40, NS = 120, NT = 16, NE = 6, GRAV = 14, STRIDE = 8;

export class Effects {
  constructor(scene) {
    this.d = new THREE.Object3D();
    this.pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0x7a0808 }), NP);
    this.pm.frustumCulled = false;
    this.pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.pm);
    this.p = new Float32Array(NP * STRIDE);
    this.pi = 0; this.sb = 0; this.ss = 0; this.ti = 0; this.ei = 0;

    const pg = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
    const pmat = new THREE.MeshBasicMaterial({ color: 0x4a0606, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.puddles = [];
    for (let i = 0; i < NB + NS; i++) {
      const m = new THREE.Mesh(pg, pmat);
      m.visible = false;
      m.userData = { r: 0, c: 0, v: 0, a: 1, b: 1 };
      scene.add(m);
      this.puddles.push(m);
    }

    const tg = new THREE.BoxGeometry(0.03, 0.03, 1);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
    this.tracers = [];
    for (let i = 0; i < NT; i++) {
      const m = new THREE.Mesh(tg, tm);
      m.visible = false;
      m.userData = { life: 0 };
      scene.add(m);
      this.tracers.push(m);
    }

    const eg = new THREE.SphereGeometry(1, 14, 10);
    this.blasts = [];
    for (let i = 0; i < NE; i++) {
      const m = new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, depthWrite: false }));
      m.visible = false;
      m.userData = { life: 0, r: 1 };
      scene.add(m);
      this.blasts.push(m);
    }
    this.reset();
  }

  reset() {
    this.p.fill(0);
    for (let i = 0; i < NP; i++) this._hide(i);
    this.pm.instanceMatrix.needsUpdate = true;
    for (const m of this.puddles) m.visible = false;
    for (const m of this.tracers) m.visible = false;
    for (const m of this.blasts) m.visible = false;
  }

  _hide(i) {
    const d = this.d;
    d.position.set(0, -100, 0);
    d.scale.setScalar(0);
    d.updateMatrix();
    this.pm.setMatrixAt(i, d.matrix);
  }

  blood(x, y, z, n, dx, dz, power) {
    const p = this.p;
    for (let k = 0; k < n; k++) {
      const o = this.pi * STRIDE;
      this.pi = (this.pi + 1) % NP;
      p[o] = x + rand(-0.1, 0.1);
      p[o + 1] = y + rand(-0.3, 0.3);
      p[o + 2] = z + rand(-0.1, 0.1);
      p[o + 3] = dx * power * rand(0.2, 1) + rand(-2, 2);
      p[o + 4] = rand(1, 5);
      p[o + 5] = dz * power * rand(0.2, 1) + rand(-2, 2);
      p[o + 6] = 3;
      p[o + 7] = rand(0.5, 1.6);
    }
  }

  puddle(x, z, r, t, big) {
    const i = big ? (this.sb = (this.sb + 1) % NB) : NB + (this.ss = (this.ss + 1) % NS);
    const m = this.puddles[i], u = m.userData;
    u.r = r;
    u.v = t > 0 ? r / t : 0;
    u.c = t > 0 ? r * 0.1 : r;
    u.a = rand(0.8, 1.2);
    u.b = rand(0.8, 1.2);
    m.position.set(x, groundHeight(x, z) + 0.03 + i * 0.0004, z);
    m.rotation.y = rand(0, 6.28);
    m.scale.set(u.c * u.a, 1, u.c * u.b);
    m.visible = true;
  }

  tracer(x0, y, z0, x1, z1) {
    const m = this.tracers[this.ti];
    this.ti = (this.ti + 1) % NT;
    const dx = x1 - x0, dz = z1 - z0;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.scale.z = Math.hypot(dx, dz);
    m.rotation.y = Math.atan2(dx, dz);
    m.userData.life = 0.06;
    m.visible = true;
  }

  explosion(x, y, z, r) {
    const m = this.blasts[this.ei];
    this.ei = (this.ei + 1) % NE;
    m.position.set(x, y, z);
    m.userData.life = 0.6;
    m.userData.r = r;
    m.scale.setScalar(r * 0.3);
    m.material.opacity = 1;
    m.visible = true;
  }

  update(dt) {
    const p = this.p, d = this.d;
    let dirty = false;
    for (let i = 0; i < NP; i++) {
      const o = i * STRIDE;
      if (p[o + 6] <= 0) continue;
      p[o + 6] -= dt;
      p[o + 4] -= GRAV * dt;
      p[o] += p[o + 3] * dt;
      p[o + 1] += p[o + 4] * dt;
      p[o + 2] += p[o + 5] * dt;
      const ground = p[o + 1] <= groundHeight(p[o], p[o + 2]) + 0.03;
      if (ground || p[o + 6] <= 0) {
        p[o + 6] = 0;
        if (ground && Math.random() < 0.4) this.puddle(p[o], p[o + 2], rand(0.06, 0.2), 0, false);
        this._hide(i);
      } else {
        d.position.set(p[o], p[o + 1], p[o + 2]);
        d.scale.setScalar(p[o + 7]);
        d.updateMatrix();
        this.pm.setMatrixAt(i, d.matrix);
      }
      dirty = true;
    }
    if (dirty) this.pm.instanceMatrix.needsUpdate = true;

    for (const m of this.puddles) {
      const u = m.userData;
      if (m.visible && u.c < u.r) {
        u.c = Math.min(u.r, u.c + u.v * dt);
        m.scale.set(u.c * u.a, 1, u.c * u.b);
      }
    }
    for (const m of this.tracers) if (m.visible && (m.userData.life -= dt) <= 0) m.visible = false;
    for (const m of this.blasts) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      const k = 1 - u.life / 0.6;
      m.scale.setScalar(u.r * (0.3 + 0.7 * k));
      m.material.opacity = 1 - k;
    }
  }
}
