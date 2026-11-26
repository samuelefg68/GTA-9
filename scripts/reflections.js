import * as THREE from 'three';
import { createPlayerCarMaterials } from './vehicles.js';

// Reflexo dinâmico do carro do jogador (somente no modo Cinematográfico)
const SIZE = 96;           // resolução de cada face
const FACE_INTERVAL = 150; // ms entre faces (no máximo uma face por quadro)
const MOVE_MIN = 3;        // m: com o carro parado, o reflexo atual continua valendo
const STILL_REFRESH = 3000; // ms: renovação mínima com o carro parado (céu/chuva mudam)

export class CarReflections {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.target = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType });
    this.cube = new THREE.CubeCamera(0.9, 1500, this.target);
    this.car = null;
    this.mats = null;
    this.face = 0;
    this.last = 0;
    this.live = false; // true depois da primeira volta completa
    this.cx = 0; this.cz = 0; this.cycleStart = 0; // onde/quando a volta atual começou
  }

  // Devolve o carro aos materiais que tinha antes
  release() {
    if (this.mats) this.mats.release();
    this.mats = null;
    this.car = null;
  }

  update(car, staticEnv) {
    if (car !== this.car) {
      this.release();
      if (!car) return;
      this.car = car;
      this.mats = createPlayerCarMaterials(car, staticEnv); // estático até a 1ª captura
      this.face = 0;
      this.last = 0;
      this.live = false;
    }
    if (!car) return;
    const now = performance.now();
    if (now - this.last < FACE_INTERVAL) return;
    if (this.face === 0) {
      // Início de uma volta: parado e com reflexo já pronto, não gasta nada
      const dx = car.pos.x - this.cx, dz = car.pos.z - this.cz;
      if (this.live && dx * dx + dz * dz < MOVE_MIN * MOVE_MIN && now - this.cycleStart < STILL_REFRESH) return;
      this.cx = car.pos.x; this.cz = car.pos.z; this.cycleStart = now;
    }
    this.last = now;
    this._renderFace(car);
    this.face = (this.face + 1) % 6;
    if (this.face === 0) {
      // O Three.js só reprocessa o reflexo aqui, com as 6 faces prontas
      this.target.texture.needsPMREMUpdate = true;
      if (!this.live) {
        this.live = true;
        this.mats.setEnv(this.target.texture);
      }
    }
  }

  _renderFace(car) {
    const r = this.renderer, cube = this.cube;
    if (cube.coordinateSystem !== r.coordinateSystem) {
      cube.coordinateSystem = r.coordinateSystem;
      cube.updateCoordinateSystem();
    }
    // Durante uma volta, a posição acompanha o carro
    cube.position.set(car.pos.x, car.pos.y + car.type.h * 0.75, car.pos.z);
    cube.updateMatrixWorld(true);

    const oldTarget = r.getRenderTarget();
    const visible = car.group.visible;
    // Não deixa a captura atualizar as sombras: o carro está escondido
    const shadowPending = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    car.group.visible = false;
    r.setRenderTarget(this.target, this.face);
    r.render(this.scene, cube.children[this.face]);
    car.group.visible = visible;
    r.shadowMap.needsUpdate = shadowPending;
    r.setRenderTarget(oldTarget);
  }
}