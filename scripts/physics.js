import { CITY, AIRFIELD, clamp } from './utils.js';

export const GRAVITY = 28;

const T = new Float64Array(2);
function slab(o, d, mn, mx) {
  if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
  let a = (mn - o) / d;
  let b = (mx - o) / d;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > T[0]) T[0] = a;
  if (b < T[1]) T[1] = b;
  return T[0] <= T[1];
}

// Colisores estáticos: caixas alinhadas aos eixos (AABB) guardadas numa grade espacial.
export class Physics {
  constructor() {
    this.cell = 20;
    this.grid = new Map();
    this.walls = []; // colisores altos (prédios) usados também no raycast da câmera
    this.stamp = 0;
    this.nx = 0; // normal da última colisão
    this.nz = 0;
    this._out = [];
  }

  _key(ix, iz) { return (ix + 100) * 1000 + (iz + 100); }

  add(x, z, hx, hz, h) {
    const c = { x, z, hx, hz, h, stamp: 0 };
    const cs = this.cell;
    const x0 = Math.floor((x - hx) / cs), x1 = Math.floor((x + hx) / cs);
    const z0 = Math.floor((z - hz) / cs), z1 = Math.floor((z + hz) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) this.grid.set(k, (arr = []));
        arr.push(c);
      }
    }
    if (h >= 8) this.walls.push(c);
    return c;
  }

  query(x, z, r) {
    const out = this._out;
    out.length = 0;
    const st = ++this.stamp;
    const cs = this.cell;
    const x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs);
    const z0 = Math.floor((z - r) / cs), z1 = Math.floor((z + r) / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (c.stamp !== st) { c.stamp = st; out.push(c); }
        }
      }
    }
    return out;
  }

  // Empurra o círculo p (x,z) para fora dos colisores e dos limites do mapa.
  resolve(p, r, y = 0) {
    let hit = false;
    const list = this.query(p.x, p.z, r);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (y >= c.h) continue;
      const cx = clamp(p.x, c.x - c.hx, c.x + c.hx);
      const cz = clamp(p.z, c.z - c.hz, c.z + c.hz);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      let nx, nz, push;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = r - d;
      } else {
        const px = c.hx - Math.abs(p.x - c.x), pz = c.hz - Math.abs(p.z - c.z);
        if (px < pz) { nx = Math.sign(p.x - c.x) || 1; nz = 0; push = px + r; }
        else { nx = 0; nz = Math.sign(p.z - c.z) || 1; push = pz + r; }
      }
      p.x += nx * push; p.z += nz * push;
      this.nx = nx; this.nz = nz; hit = true;
    }
    const L = CITY.LIMIT - r;
    if (p.x > L) { p.x = L; this.nx = -1; this.nz = 0; hit = true; }
    else if (p.x < AIRFIELD.XMIN + r) { p.x = AIRFIELD.XMIN + r; this.nx = 1; this.nz = 0; hit = true; }
    if (p.z > L) { p.z = L; this.nx = 0; this.nz = -1; hit = true; }
    else if (p.z < -L) { p.z = -L; this.nx = 0; this.nz = 1; hit = true; }
    return hit;
  }

  // Distância até o primeiro prédio ao longo do raio (ou maxT se nada for atingido).
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT;
    for (let i = 0; i < this.walls.length; i++) {
      const c = this.walls[i];
      T[0] = 0; T[1] = best;
      if (slab(ox, dx, c.x - c.hx, c.x + c.hx) && slab(oy, dy, 0, c.h) && slab(oz, dz, c.z - c.hz, c.z + c.hz)) {
        if (T[0] < best) best = T[0];
      }
    }
    return best;
  }

  // Gravidade + chão. b: { pos:{y}, vy, grounded }
  stepVertical(b, dt, gh) {
    b.vy -= GRAVITY * dt;
    b.pos.y += b.vy * dt;
    if (b.pos.y <= gh) { b.pos.y = gh; b.vy = 0; b.grounded = true; }
    else b.grounded = false;
  }
}