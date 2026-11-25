import * as THREE from 'three';
import { clamp, damp, angleLerp } from './utils.js';

export class ThirdPersonCamera {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = 0;
    this.pitch = 0.3;
    this.zoom = 1;
    this.dist = 6;
    this.idle = 0;
    this.focus = new THREE.Vector3();
    this.snapNext = true;
  }

  snap(yaw) {
    this.yaw = yaw;
    this.pitch = 0.3;
    this.snapNext = true;
  }

  // Entrada do usuário: mouse, setas e roda do mouse.
  handleInput(c, dt, takeDy = false) {
    if (c.dx || c.dy) {
      this.yaw -= c.dx * 0.0025;
      if (!takeDy) this.pitch = clamp(this.pitch + c.dy * 0.002, -0.15, 1.2);
      this.idle = 0;
    }
    const turn = (c.down('ArrowLeft') ? 1 : 0) - (c.down('ArrowRight') ? 1 : 0);
    if (turn) { this.yaw += turn * 2.2 * dt; this.idle = 0; }
    const tilt = (c.down('ArrowDown') ? 1 : 0) - (c.down('ArrowUp') ? 1 : 0);
    if (tilt) { this.pitch = clamp(this.pitch + tilt * 1.2 * dt, -0.15, 1.2); this.idle = 0; }
    if (c.wheel) this.zoom = clamp(this.zoom + c.wheel * 0.0008, 0.5, 2.2);
  }

  update(dt, target, inCar, heading, speed) {
    this.idle += dt;
    // No carro, a câmera volta sozinha para trás do veículo se o jogador não a mexe.
    // Só se realinha andando: parado, a câmera fica onde o jogador deixou.
    if (inCar && this.idle > 1.2 && Math.abs(speed) > 1.5) {
      this.yaw = angleLerp(this.yaw, speed < -1 ? heading + Math.PI : heading, 1 - Math.exp(-2.6 * dt));
      this.pitch = damp(this.pitch, 0.22, 2, dt);
    }
    const f = this.focus;
    const tx = target.x, ty = target.y + 1.7, tz = target.z;
    if (this.snapNext) { f.set(tx, ty, tz); this.snapNext = false; }
    else {
      const k = inCar ? 10 : 14;
      f.x = damp(f.x, tx, k, dt); f.y = damp(f.y, ty, k, dt); f.z = damp(f.z, tz, k, dt);
    }

    const wanted = (inCar ? 9.5 : 5.5) * this.zoom;
    const cp = Math.cos(this.pitch);
    const dx = -Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = -Math.cos(this.yaw) * cp;
    // Raio do foco até a posição desejada: se bater num prédio, aproxima a câmera.
    const hit = this.physics.raycast(f.x, f.y, f.z, dx, dy, dz, wanted + 0.6);
    const allowed = Math.max(Math.min(wanted, hit - 0.6), 0.8);
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 4, dt);

    const cam = this.camera;
    cam.position.set(f.x + dx * this.dist, Math.max(f.y + dy * this.dist, 0.5), f.z + dz * this.dist);
    cam.lookAt(f.x, f.y + 0.3, f.z);
    const fov = 65 + clamp(Math.abs(speed), 0, 35) / 35 * 12;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov = damp(cam.fov, fov, 4, dt); cam.updateProjectionMatrix(); }
  }
}