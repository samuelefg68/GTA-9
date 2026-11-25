import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clamp, damp, groundHeight, mat } from './utils.js';

// Avião pilotável. Física simples de arcade: o acelerador (W) dá a velocidade, o mouse vertical
// controla o nariz (sobe/desce), A/D inclinam e curvam. Sem piloto, o avião fica parado na pista.

export const AIR_VMAX = 40;             // m/s (144 km/h): velocidade com acelerador total
const LENGTH = 11;                      // m: comprimento final (escala uniforme do modelo)
const STALL = 10 / 3.6;                 // m/s (10 km/h): abaixo disso o avião cai
const TAKEOFF = 60 / 3.6;               // m/s (60 km/h): velocidade mínima para decolar
const THROTTLE_UP = 0.6;                // 1/s: acelerador sobe segurando W
const THROTTLE_DOWN = 0.4;              // 1/s: acelerador cai ao soltar W
const ACCEL = 0.5;                      // 1/s: resposta da velocidade ao acelerador
const PITCH_MAX = 0.6;                  // rad (~34°) para cima ou para baixo
const PITCH_SENS = 0.003;               // rad por pixel de mouse vertical
const ROLL_MAX = 0.5;                   // rad de inclinação com A/D
const TURN_RATE = 0.9;                  // rad/s de curva com inclinação máxima
const CEIL = 200;                       // m: teto de voo
const BOUND = 700;                      // m: limite do voo em X e Z
const HIT_R = 4;                        // m: raio da caixa de colisão com prédios
const BLAST_V = 60 / 3.6;               // m/s: velocidade mínima para explodir num prédio
const BLAST_H = 5;                      // m: altura mínima para explodir num prédio
const RESPAWN_T = 20;                   // s: tempo até o avião reaparecer na pista
const GEAR_T = 1.5;                     // s para recolher ou estender o trem de pouso
const BOARD_R = 6;                      // m: distância máxima para entrar no avião
const SPAWN = { x: -322, z: 0, heading: -Math.PI / 2 }; // dentro da pista (x -480..-310, z -12..12) e na área que o jogador a pé alcança (x > -326), de frente para oeste
const loader = new GLTFLoader();

// Pista de pouso a oeste da cidade: x de -480 a -310, 24 m de largura, centrada em z = 0.
function buildRunway(scene) {
  const x0 = -480, x1 = -310, w = 24;
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, w).rotateX(-Math.PI / 2), mat(0x3a3e44));
  pad.position.set((x0 + x1) / 2, 0.03, 0);
  pad.receiveShadow = true;
  scene.add(pad);
  const dash = new THREE.BoxGeometry(6, 0.02, 0.5);
  const white = mat(0xf2f2f2);
  for (let x = x0 + 10; x < x1 - 5; x += 16) {
    const m = new THREE.Mesh(dash, white);
    m.position.set(x, 0.05, 0);
    scene.add(m);
  }
}

export class Aircraft {
  constructor(scene, physics, fx) {
    this.scene = scene;
    this.physics = physics;
    this.fx = fx;
    this.root = new THREE.Group();          // posição e rotação do avião (sem escala)
    this.root.rotation.order = 'YXZ';
    this.visual = new THREE.Group();        // contém o modelo (escala e orientação)
    this.root.add(this.visual);
    this.seat = new THREE.Vector3(0, 0.6, 0);
    this.prop = null;
    this.wheels = null;
    this.wheelsScale = null;
    this.onWreck = null;
    scene.add(this.root);
    buildRunway(scene);
    this.reset();
  }

  async load(url) {
    const gltf = await loader.loadAsync(url).catch(() => { throw new Error(`Falha ao carregar ${url}`); });
    const model = gltf.scene;
    // O construtor já chamou reset() (posiciona o root na pista). Medimos o modelo com o root na origem,
    // senão a caixa sai deslocada e o modelo fica do outro lado do mapa.
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);

    // Câmera e luzes do arquivo não são usadas
    const extra = [];
    model.traverse((o) => { if (o.isCamera || o.isLight || /^(Camera|TriLamp)/.test(o.name)) extra.push(o); });
    for (const o of extra) o.removeFromParent();

    // O piloto do arquivo não é usado: o piloto é o chibi, sentado no banco
    const pilot = model.getObjectByName('Pilot');
    if (pilot) pilot.visible = false;
    this.prop = model.getObjectByName('propeler') || null;

    // Materiais Lambert (como os carros); vidro escuro
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const isArr = Array.isArray(o.material);
      const list = (isArr ? o.material : [o.material]).map((m) => {
        const glass = /glass/i.test(m.name || '');
        // DoubleSide: a fuselagem e as asas aparecem por dentro e por fora; mantém transparência do arquivo
        return new THREE.MeshLambertMaterial({
          color: glass ? 0x1c232b : m.color,
          map: glass ? null : (m.map || null),
          side: THREE.DoubleSide,
          transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest,
        });
      });
      o.material = isArr ? list : list[0];
    });

    // Nariz (-X no arquivo) para +z; escala uniforme até LENGTH; base do trem de pouso no chão
    model.rotation.y = Math.PI / 2;
    this.visual.add(model);
    this.root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(LENGTH / (box.max.z - box.min.z));
    this.root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.set(-c.x, -box.min.y, -c.z);
    this.root.updateMatrixWorld(true);

    // Lugar do piloto: centro do Pilot no plano da cabine, com os pés na altura de sua base
    if (pilot) {
      const pb = new THREE.Box3().setFromObject(pilot);
      const pc = pb.getCenter(new THREE.Vector3());
      this.seat.set(pc.x, pb.min.y, pc.z); // box em coordenadas de mundo = coordenadas do avião (raiz sem transformação)
    }

    // A animação do arquivo não é usada: ela move os ossos Bone (raiz) e Bone.002, que carregam o corpo inteiro.
    // O trem de pouso é o nó "Wheels", recolhido por escala em torno do centro da roda.
    this.wheels = model.getObjectByName('Wheels') || null;
    this.wheelsScale = this.wheels ? this.wheels.scale.clone() : null;
    this._applyGear();
  }

  reset() {
    this.x = SPAWN.x; this.y = 0; this.z = SPAWN.z; this.heading = SPAWN.heading;
    this.speed = 0; this.vy = 0; this.throttle = 0;
    this.pitch = 0; this.aimPitch = 0; this.roll = 0; this.idle = 0;
    this.grounded = true; this.gear = 0;
    this.wrecked = false; this.wreckT = 0;
    this.root.visible = true;
    this._applyGear();
    this._apply();
  }

  // Pode entrar: parado no chão e perto do avião
  canBoard(x, z) {
    return !this.wrecked && this.grounded && this.speed < 1 && Math.hypot(this.x - x, this.z - z) <= BOARD_R;
  }

  // Pode sair: parado no chão
  canLeave() {
    return !this.wrecked && this.grounded && this.speed < 1;
  }

  // c: controles do piloto (null se não há ninguém dentro)
  update(dt, c) {
    if (this.wrecked) {
      this.wreckT -= dt;
      if (this.wreckT <= 0) this.reset();
      return;
    }
    const piloted = !!c;
    const inp = piloted ? (c.down('KeyD') ? 1 : 0) - (c.down('KeyA') ? 1 : 0) : 0;

    if (piloted) {
      this.throttle = clamp(this.throttle + (c.down('KeyW') ? THROTTLE_UP : -THROTTLE_DOWN) * dt, 0, 1);
      if (c.dy) {
        this.aimPitch = clamp(this.aimPitch - c.dy * PITCH_SENS, -PITCH_MAX, PITCH_MAX);
        this.idle = 0;
      } else this.idle += dt;
    } else {
      this.throttle = Math.max(0, this.throttle - THROTTLE_DOWN * dt);
      this.idle += dt;
    }
    // nivelamento automático do nariz quando o mouse fica parado
    if (this.idle > 1) this.aimPitch = damp(this.aimPitch, 0, 1.5, dt);

    // no chão o avião não inclina (evita o nariz girando em torno do ponto de contato);
    // perto do chão o nariz não aponta para baixo
    const altNow = this.y - groundHeight(this.x, this.z);
    let aim = this.aimPitch;
    if (this.grounded) aim = 0;
    else if (altNow < 3) aim = Math.max(0, aim);
    this.pitch = damp(this.pitch, aim, 6, dt);
    const sp = Math.sin(this.pitch), cp = Math.cos(this.pitch);

    // velocidade: acelerador manda; subir reduz, descer aumenta
    const tgt = this.throttle * AIR_VMAX * (1 - 0.35 * sp);
    const rate = this.grounded && this.throttle < 0.05 ? 1.2 : ACCEL;
    this.speed = damp(this.speed, Math.max(0, tgt), rate, dt);

    // inclinação visual (só no ar) e curva
    this.roll = damp(this.roll, (this.grounded ? 0 : inp) * ROLL_MAX, 5, dt);
    const turn = Math.min(1, this.speed / 15);
    this.heading -= inp * TURN_RATE * turn * dt; // D vira à direita (rumo diminui)

    // decolagem e vertical
    if (this.grounded) {
      this.vy = 0;
      if (this.speed >= TAKEOFF && this.aimPitch > 0.05) {
        // decolagem: começa a subir com velocidade mínima, para não voltar ao chão no quadro seguinte
        this.grounded = false;
        this.vy = Math.max(2, this.speed * Math.sin(this.aimPitch));
      }
    }
    if (!this.grounded) {
      const stallPull = this.speed < STALL ? (STALL - this.speed) * 4 : 0;
      this.vy = damp(this.vy, this.speed * sp - stallPull, 2, dt);
    }

    this.x += Math.sin(this.heading) * this.speed * cp * dt;
    this.z += Math.cos(this.heading) * this.speed * cp * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, -BOUND, BOUND);
    this.z = clamp(this.z, -BOUND, BOUND);

    const g = groundHeight(this.x, this.z);
    if (this.y <= g) {
      this.y = g;
      if (this.vy <= 0) { this.vy = 0; this.grounded = true; }
    } else if (this.y > CEIL) {
      this.y = CEIL;
      this.vy = Math.min(0, this.vy);
    }

    if (this._collide()) return; // explodiu: não atualiza mais nada neste quadro

    // trem de pouso: recolhe no ar (acima de 3 m), estende ao pousar
    const airborne = !this.grounded && this.y - g > 3;
    const step = dt / GEAR_T;
    this.gear = airborne ? Math.min(1, this.gear + step) : Math.max(0, this.gear - step);
    this._applyGear();

    if (this.prop) this.prop.rotateX((6 + 40 * this.throttle) * dt);
    this._apply();
  }

  // Colisão só com prédios (colisores altos). Batida forte no ar explode; o resto só para o avião.
  // Retorna true se explodiu.
  _collide() {
    const g = groundHeight(this.x, this.z);
    for (const w of this.physics.walls) {
      if (this.y >= w.h) continue;
      const cx = clamp(this.x, w.x - w.hx, w.x + w.hx);
      const cz = clamp(this.z, w.z - w.hz, w.z + w.hz);
      const dx = this.x - cx, dz = this.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= HIT_R * HIT_R) continue;
      if (this.speed >= BLAST_V && this.y - g >= BLAST_H) {
        this._explode();
        return true;
      }
      let nx, nz, push;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = HIT_R - d;
      } else {
        const px = w.hx - Math.abs(this.x - w.x), pz = w.hz - Math.abs(this.z - w.z);
        if (px < pz) { nx = this.x < w.x ? -1 : 1; nz = 0; push = px + HIT_R; }
        else { nx = 0; nz = this.z < w.z ? -1 : 1; push = pz + HIT_R; }
      }
      this.x += nx * push;
      this.z += nz * push;
      this.speed *= 0.2;
    }
    return false;
  }

  _explode() {
    this.fx.explosion(this.x, this.y, this.z, 8);
    this.wrecked = true;
    this.wreckT = RESPAWN_T;
    this.root.visible = false;
    this.speed = 0; this.throttle = 0; this.vy = 0;
    if (this.onWreck) this.onWreck(this.x, this.z, this.heading);
  }

  _applyGear() {
    if (!this.wheels) return;
    const k = Math.max(0.001, 1 - this.gear); // 1 = estendido, ~0 = recolhido
    this.wheels.scale.copy(this.wheelsScale).multiplyScalar(k);
  }

  _apply() {
    this.root.position.set(this.x, this.y, this.z);
    // inclinação: nariz para cima é X negativo; D inclina para a direita
    this.root.rotation.set(-this.pitch, this.heading, this.roll);
  }
}