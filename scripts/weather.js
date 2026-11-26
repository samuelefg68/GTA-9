// Clima: ciclo de chuva, tecla T e pingos. As poças ficam em puddles.js.
import * as THREE from 'three';
import { rand, clamp } from './utils.js';
import { Puddles, WEATHER_LAYER } from './puddles.js';

const DRY_TIME = [180, 360]; // s de tempo seco (3 a 6 min)
const RAIN_TIME = [60, 120]; // s de chuva (1 a 2 min)
const FADE = 10;             // s de transição do céu e dos pingos
const FILL = 25;             // s para as poças encherem (chuva forte)
const DRAIN = 45;            // s para as poças secarem

const DROPS = 7000;

function makeRain(camera) {
  const seed = new Float32Array(DROPS * 6);
  const tail = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    seed.set([x, y, z, x, y, z], i * 6);
    tail[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(seed, 3));
  geo.setAttribute('tail', new THREE.BufferAttribute(tail, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      time: { value: 0 },
      amount: { value: 0 },
      center: { value: camera.position }, // mesma referência: segue a câmera
    },
    vertexShader: `
      attribute float tail;
      uniform float time; uniform vec3 center;
      varying float vAlpha;
      const vec3 BOX = vec3(44.0, 26.0, 44.0);
      const vec3 VEL = vec3(2.5, -22.0, 1.0); // queda inclinada pelo vento
      void main(){
        float speed = 0.85 + 0.3 * fract(position.x * 37.0 + position.z * 91.0);
        vec3 p = mod(position * BOX + VEL * speed * time - center, BOX) - 0.5 * BOX + center;
        p -= normalize(VEL) * 0.65 * tail;
        float d = distance(p.xz, center.xz);
        vAlpha = (1.0 - smoothstep(14.0, 22.0, d)) * step(0.0, p.y)
               * smoothstep(0.6, 2.0, distance(p, center)) * (1.0 - 0.85 * tail);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float amount; varying float vAlpha;
      void main(){
        gl_FragColor = vec4(0.55, 0.62, 0.72, vAlpha * amount * 0.55);
        #include <colorspace_fragment>
      }`,
  });
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.layers.set(WEATHER_LAYER); // fora das capturas de reflexo
  return lines;
}

export class Weather {
  constructor(world, notify) {
    this.world = world;
    this.notify = notify;
    world.camera.layers.enable(WEATHER_LAYER);
    this.rain = makeRain(world.camera);
    world.scene.add(this.rain);
    this.puddles = new Puddles(world);
    world.preRender = () => this.puddles.render();
    this.reset();
  }

  reset() {
    this.raining = false;
    this.timer = rand(...DRY_TIME);
    this.intensity = 0; // céu e pingos (0..1)
    this.wetness = 0;   // poças (0..1)
    this.time = 0;
    this._apply();
  }

  toggle() {
    this._setRaining(!this.raining);
  }

  _setRaining(on) {
    this.raining = on;
    this.timer = rand(...(on ? RAIN_TIME : DRY_TIME));
    this.notify(on ? 'Começou a chover' : 'A chuva está passando');
  }

  update(dt, controls) {
    if (controls.wasPressed('KeyT')) this.toggle();
    this.timer -= dt;
    if (this.timer <= 0) this._setRaining(!this.raining);

    this.intensity = clamp(this.intensity + (this.raining ? dt : -dt) / FADE, 0, 1);
    const fill = this.raining ? (dt * this.intensity) / FILL : -dt / DRAIN;
    this.wetness = clamp(this.wetness + fill, 0, 1);
    this.time = (this.time + dt) % 3600;
    this._apply();
  }

  _apply() {
    const u = this.rain.material.uniforms;
    u.time.value = this.time;
    u.amount.value = this.intensity;
    this.rain.visible = this.intensity > 0.001;
    this.world.setRain(this.intensity);
    this.puddles.set(this.wetness, this.intensity, this.time);
  }
}
