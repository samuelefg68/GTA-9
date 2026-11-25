import { damp, CITY } from './utils.js';

const S = 2; // pixels por metro no mapa estático
const H = CITY.HALF + 10; // meio lado do mapa estático (m)

export class Minimap {
  constructor(canvas, city) {
    this.ctx = canvas.getContext('2d');
    this.size = canvas.width;
    this.zoom = 1.7;
    this.sx = 0; this.sy = 0;
    this.px = 0; this.pz = 0; this.cs = 1; this.sn = 0;
    // Camada estática (ruas, quarteirões, prédios) desenhada uma única vez.
    this.map = document.createElement('canvas');
    this.map.width = this.map.height = 2 * H * S;
    this._drawStatic(city);
  }

  _drawStatic(city) {
    const g = this.map.getContext('2d');
    g.scale(S, S);
    g.translate(H, H);
    g.fillStyle = '#202328';
    g.fillRect(-H, -H, 2 * H, 2 * H);
    g.strokeStyle = '#3b3f46';
    g.lineWidth = 0.6;
    g.setLineDash([3, 4]);
    for (let k = 0; k <= CITY.N; k++) {
      const c = -CITY.HALF + 80 * k;
      g.beginPath();
      g.moveTo(-H, c); g.lineTo(H, c);
      g.moveTo(c, -H); g.lineTo(c, H);
      g.stroke();
    }
    g.setLineDash([]);
    for (const b of city.blocks) {
      g.fillStyle = '#5a5f69';
      g.fillRect(b.x - 30, b.z - 30, 60, 60);
      if (b.type === 'park') { g.fillStyle = '#4d7a4a'; g.fillRect(b.x - 26, b.z - 26, 52, 52); }
      else if (b.type === 'parking') { g.fillStyle = '#3b3e44'; g.fillRect(b.x - 26, b.z - 26, 52, 52); }
    }
    g.fillStyle = '#9097a3';
    for (const b of city.buildings) g.fillRect(b.x - b.w / 2, b.z - b.d / 2, b.w, b.d);
  }

  _proj(x, z) {
    const dx = x - this.px, dz = z - this.pz;
    const c = this.size / 2;
    this.sx = c + (dx * this.cs - dz * this.sn) * this.zoom;
    this.sy = c + (dx * this.sn + dz * this.cs) * this.zoom;
  }

  // yaw da câmera fica sempre "para cima" no mapa.
  draw(dt, player, yaw, vehicles, npcs, pickups, aircraft = null) {
    // Redesenha só ~20 vezes por segundo: o mapa estático é grande (1320 px) e redesenhá-lo a cada quadro pesa.
    this._acc = (this._acc || 0) + dt;
    if (this._acc < 1 / 20) return;
    dt = this._acc;
    this._acc = 0;
    const g = this.ctx, W = this.size, c = W / 2;
    this.zoom = damp(this.zoom, player.vehicle || player.aircraft ? 1.15 : 1.7, 3, dt);
    const phi = yaw + Math.PI;
    this.cs = Math.cos(phi); this.sn = Math.sin(phi);
    this.px = player.pos.x; this.pz = player.pos.z;

    g.clearRect(0, 0, W, W);
    g.fillStyle = '#14161a';
    g.fillRect(0, 0, W, W);
    g.save();
    g.translate(c, c);
    g.rotate(phi);
    g.scale(this.zoom, this.zoom);
    g.translate(-this.px, -this.pz);
    g.drawImage(this.map, -H, -H, 2 * H, 2 * H);
    g.restore();

    // cone de visão da câmera
    g.fillStyle = 'rgba(47,139,255,0.18)';
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c * 0.85, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    g.closePath();
    g.fill();

    const lim = W + 10;
    g.fillStyle = '#4cd964';
    for (const p of pickups) {
      if (!p.active) continue;
      this._proj(p.x, p.z);
      if (this.sx < -10 || this.sy < -10 || this.sx > lim || this.sy > lim) continue;
      g.beginPath(); g.arc(this.sx, this.sy, 2.4, 0, 6.2832); g.fill();
    }
    g.fillStyle = '#ff3b3b';
    for (const n of npcs.list) {
      this._proj(n.pos.x, n.pos.z);
      if (this.sx < -10 || this.sy < -10 || this.sx > lim || this.sy > lim) continue;
      g.beginPath(); g.arc(this.sx, this.sy, 2.6, 0, 6.2832); g.fill();
    }
    for (const v of vehicles.list) {
      if (v === player.vehicle) continue;
      this._proj(v.pos.x, v.pos.z);
      if (this.sx < -10 || this.sy < -10 || this.sx > lim || this.sy > lim) continue;
      g.save();
      g.translate(this.sx, this.sy);
      g.rotate(phi - v.heading + Math.PI);
      g.fillStyle = '#ffd32a';
      g.fillRect(-3, -5.5, 6, 11);
      g.fillStyle = '#7a6400';
      g.fillRect(-2, -5.5, 4, 3);
      g.restore();
    }

    // avião parado (sem ninguém dentro): ícone cinza claro
    if (aircraft && !aircraft.wrecked && player.aircraft !== aircraft) {
      this._proj(aircraft.x, aircraft.z);
      if (this.sx >= -10 && this.sy >= -10 && this.sx <= lim && this.sy <= lim) {
        g.save();
        g.translate(this.sx, this.sy);
        g.rotate(phi - aircraft.heading + Math.PI);
        g.fillStyle = '#e8e8f0';
        g.fillRect(-1.5, -7, 3, 14);
        g.fillRect(-6, -1, 12, 2);
        g.restore();
      }
    }

    // jogador: seta azul apontando para onde ele olha
    g.save();
    g.translate(c, c);
    g.rotate(phi - player.heading + Math.PI);
    g.fillStyle = '#2f8bff';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();

    // norte
    g.fillStyle = '#f5e6c8';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', c + this.sn * (c - 14), c - this.cs * (c - 14));
  }
}