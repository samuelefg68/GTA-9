import * as THREE from 'three';
import { rand, pick, damp, angleLerp, groundHeight, clamp } from './utils.js';
import { createChibi } from './chibi.js';

// Três variações de NPC (cores em chibi.js > VARIANTS); cada NPC sorteia uma.
const NPC_VARIANTS = ['npc1', 'npc2', 'npc3'];
const R = 0.35;
// NPCs além dessa distância (m) do jogador não são desenhados (reduz chamadas de desenho). Ajustável.
const NPC_DRAW_DIST2 = 100 * 100;
// Motorista que sai do carro de tráfego quando o jogador tenta entrar: corre em linha reta por RUNNER_LIFE
// segundos e some se estiver vivo. Entra em NPCManager.list como qualquer NPC, então pode ser atingido.
// Se morrer, o corpo fica caído até o reset do jogo, como os outros.
const RUNNER_SPEED = 4.5;     // m/s (corrida)
const RUNNER_LIFE = 7;        // s: tempo de fuga antes de sumir (só se estiver vivo)
const RUNNER_OUT = 1.2;       // m: quanto o motorista começa fora do banco, para o lado da porta
const _seatV = new THREE.Vector3();

class NPC {
  constructor(scene) {
    this.chibi = createChibi(pick(NPC_VARIANTS), { shadows: false });
    this.model = this.chibi.model;
    this.model.rotation.order = 'YXZ';
    this.model.scale.setScalar(rand(0.92, 1.08));
    scene.add(this.model);
    this.pos = { x: 0, y: 0, z: 0 };
    this.speed = rand(1.2, 2.3);       // cada NPC tem sua velocidade
    this.base = this.speed;
    this.hp = 100;
    this.dead = false;
    this.heading = 0;
    this.moving = false;
    this.animTick = (Math.random() * 4) | 0;   // escalona a animação de NPCs distantes
    this.node = null; this.target = null; this.prev = null;
    this.wait = 0; this.fallen = 0; this.stuck = 0;
    this.runner = false; this.life = 0; this.dx = 0; this.dz = 0; this.gone = false;
  }
}

export class NPCManager {
  constructor(scene, physics, city, count = 60, fx = null) {
    this.scene = scene;
    this.physics = physics;
    this.fx = fx;
    this.nodes = city.nodes;
    this.onCrime = null; // chamado quando o carro do jogador atropela um NPC
    this.list = [];
    for (let i = 0; i < count; i++) this.list.push(new NPC(scene));
    this.reset();
  }

  // Chamado quando o jogador tenta entrar num carro de tráfego em movimento: o motorista aparece no banco
  // e sai correndo para o lado da porta, longe do jogador.
  ejectDriver(v) {
    const g = v.group;
    g.updateMatrixWorld(true);
    _seatV.set(v.seat.x, v.seat.y, v.seat.z);
    g.localToWorld(_seatV);
    // lado da porta do motorista = sinal de seat.x no eixo esquerdo do carro (cos θ, -sin θ)
    const side = v.seat.x >= 0 ? 1 : -1;
    const lx = Math.cos(v.heading) * side, lz = -Math.sin(v.heading) * side;
    const x = _seatV.x + lx * RUNNER_OUT, z = _seatV.z + lz * RUNNER_OUT;
    const n = new NPC(this.scene);
    n.runner = true;
    n.life = RUNNER_LIFE;
    n.dx = lx; n.dz = lz;
    n.pos.x = x; n.pos.z = z; n.pos.y = groundHeight(x, z);
    n.heading = Math.atan2(lx, lz);
    n.moving = true;
    this.list.push(n);
  }

  reset() {
    // motoristas que fugiram somem junto com seus corpos; os pedestres voltam ao normal
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].runner) {
        this.list[i].model.removeFromParent();
        this.list.splice(i, 1);
      }
    }
    for (const n of this.list) {
      n.node = pick(this.nodes);
      n.target = pick(n.node.n);
      n.prev = null;
      const t = Math.random();
      n.pos.x = n.node.x + (n.target.x - n.node.x) * t;
      n.pos.z = n.node.z + (n.target.z - n.node.z) * t;
      n.pos.y = groundHeight(n.pos.x, n.pos.z);
      n.heading = Math.atan2(n.target.x - n.node.x, n.target.z - n.node.z);
      n.wait = 0; n.fallen = 0; n.stuck = 0;
      n.hp = 100; n.dead = false; n.speed = n.base;
      n.model.rotation.x = 0;
    }
  }

  hit(n, dmg, dx, dz, down = 0) {
    if (n.dead) return;
    n.hp -= dmg;
    n.speed = Math.max(n.speed, 3.8);
    const p = n.pos, dead = n.hp <= 0;
    this.fx.blood(p.x, p.y + 1.2, p.z, ((dmg * 0.3) | 0) + (dead ? 25 : 0), dx, dz, dead ? 5 : 3);
    if (dead) {
      n.dead = true;
      n.fallen = 1e9;
      n.model.rotation.x = -Math.PI / 2;
      this.fx.puddle(p.x - Math.sin(n.heading) * 0.9, p.z - Math.cos(n.heading) * 0.9, rand(0.8, 1.3), 5, true);
    } else if (down > 0) {
      n.fallen = down;
      n.model.rotation.x = -Math.PI / 2;
      p.x += dx * 0.5;
      p.z += dz * 0.5;
    }
  }

  // Escolhe o próximo destino (canto de calçada vizinho), evitando voltar quando possível.
  _next(n) {
    const nb = n.target.n;
    let choice = null, count = 0;
    for (let i = 0; i < nb.length; i++) {
      if (nb[i] === n.node) continue;
      if (Math.random() * ++count < 1) choice = nb[i];
    }
    n.prev = n.node;
    n.node = n.target;
    n.target = choice || n.prev;
  }

  // Motorista que fugiu: corre em linha reta, colide com obstáculos e some quando a fuga acaba (se estiver vivo).
  _runnerStep(n, dt) {
    if (n.dead) return;
    if (n.fallen > 0) {
      n.fallen -= dt;
      if (n.fallen <= 0) n.model.rotation.x = 0;
      return;
    }
    n.life -= dt;
    if (n.life <= 0) { n.gone = true; return; }
    const p = n.pos;
    p.x += n.dx * RUNNER_SPEED * dt;
    p.z += n.dz * RUNNER_SPEED * dt;
    this.physics.resolve(p, R, p.y);
    p.y = groundHeight(p.x, p.z);
    n.speed = RUNNER_SPEED;
    n.heading = Math.atan2(n.dx, n.dz);
  }

  update(dt, vm, player) {
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const n = L[i], p = n.pos, m = n.model;

      if (n.runner) { this._runnerStep(n, dt); continue; }
      if (n.dead) continue;
      if (n.fallen > 0) {
        n.fallen -= dt;
        if (n.fallen <= 0) { m.rotation.x = 0; n.wait = 0.5; }
        continue;
      }

      let moving = false;
      n.moving = false;
      if (n.wait > 0) n.wait -= dt;
      else {
        const dx = n.target.x - p.x, dz = n.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.5) {
          this._next(n);
          if (Math.random() < 0.2) n.wait = rand(1, 4);
        } else {
          const step = n.speed * dt;
          p.x += (dx / d) * step; p.z += (dz / d) * step;
          n.heading = angleLerp(n.heading, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
          moving = true;
          n.moving = true;
        }
      }

      // evita outros NPCs
      for (let j = i + 1; j < L.length; j++) {
        const o = L[j];
        if (o.fallen > 0) continue;
        const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.5 && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (0.7 - d) * 0.5;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
          o.pos.x -= (dx / d) * push; o.pos.z -= (dz / d) * push;
        }
      }
      // afasta-se do jogador a pé
      if (!player.vehicle) {
        const dx = p.x - player.pos.x, dz = p.z - player.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.64 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          p.x += (dx / d) * (0.8 - d); p.z += (dz / d) * (0.8 - d);
        }
      }
      // veículos: empurra ou derruba se estiver rápido
      const hitV = vm.pushOut(p, R);
      if (hitV && !hitV.pursuit && Math.abs(hitV.speed) > 5) {
        const s = Math.sign(hitV.speed);
        this.hit(n, Math.abs(hitV.speed) * 9, Math.sin(hitV.heading) * s, Math.cos(hitV.heading) * s, 3);
        if (hitV.driven && this.onCrime) this.onCrime();
      }

      // obstáculos: se ficar preso, dá meia-volta
      if (this.physics.resolve(p, R, p.y)) {
        n.stuck += dt;
        if (n.stuck > 0.5) {
          const t = n.target; n.target = n.node; n.node = t; n.stuck = 0;
        }
      } else n.stuck = Math.max(0, n.stuck - dt);

      p.y = damp(p.y, groundHeight(p.x, p.z), 12, dt);
    }

    // remove motoristas cuja fuga terminou (só os vivos chegam aqui marcados)
    for (let i = L.length - 1; i >= 0; i--) {
      if (L[i].gone) {
        L[i].model.removeFromParent();
        L.splice(i, 1);
      }
    }

    for (const n of L) {
      const m = n.model;
      m.position.set(n.pos.x, n.pos.y + (n.fallen > 0 ? 0.2 : 0), n.pos.z);
      m.rotation.y = n.heading;
      const ddx = n.pos.x - player.pos.x, ddz = n.pos.z - player.pos.z;
      m.visible = ddx * ddx + ddz * ddz < NPC_DRAW_DIST2;
      if (!m.visible) continue;
      if (n.fallen > 0) continue;
      // andar ou correr: o NPC corre quando foge (velocidade acima de 2,3 m/s); parado fica em pé
      const moving = n.moving && n.wait <= 0;
      // NPCs longe do jogador animam em quadros alternados (poupa CPU sem parecer travado de perto)
      const dx = m.position.x - player.pos.x, dz = m.position.z - player.pos.z;
      const far = dx * dx + dz * dz > 40 * 40;
      n.animTick = (n.animTick + 1) % 4;
      if (far && n.animTick !== 0) continue;
      n.chibi.update(far ? dt * 4 : dt, {
        speed: moving ? n.speed : 0,
        grounded: true,
        vy: 0,
        runFrac: clamp((n.speed - 2.3) / 1.5, 0, 1),
      });
    }
  }
}