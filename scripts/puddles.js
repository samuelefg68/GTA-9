// Poças no asfalto com reflexo planar (somente no modo Cinematográfico).
import * as THREE from 'three';
import { CITY } from './utils.js';

export const WEATHER_LAYER = 1; // só a câmera principal enxerga esta camada

const Y = 0.006;        // acima do asfalto e abaixo da pintura das faixas (0,01)
const CLIP_Y = 0.06;    // o reflexo ignora o que está abaixo disto (pintura do chão)
const SCALE = 0.4;      // resolução do reflexo em relação à tela
const MAX_WIDTH = 800;
const FAR = 450;        // alcance do reflexo
const SKY_SCALE = 0.45; // a esfera do céu (raio 900) precisa caber no alcance

const vertexShader = `
  uniform mat4 textureMatrix;
  varying vec3 vWorld; varying vec4 vReflect;
  #include <fog_pars_vertex>
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vReflect = textureMatrix * w;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const fragmentShader = `
  uniform sampler2D tReflect;
  uniform float wetness; uniform float rain; uniform float time;
  uniform float halfCity;
  varying vec3 vWorld; varying vec4 vReflect;
  #include <fog_pars_fragment>

  float hash(vec2 p){
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Anéis dos pingos: um por célula, cada um com posição e tempo próprios
  vec2 ripple(vec2 p, float seed){
    vec2 cell = floor(p), f = fract(p) - 0.5;
    float h = hash(cell + seed);
    float t = time * 1.4 + h * 7.0;
    float cycle = floor(t), age = fract(t);
    vec2 c = vec2(hash(cell + cycle + seed), hash(cell - cycle + seed + 19.0)) * 0.4 - 0.2;
    vec2 d = f - c;
    float len = length(d);
    float x = (len - age * 0.3) * 45.0;
    float wave = sin(x) * exp(-x * x * 0.12) * (1.0 - age);
    return len > 0.001 ? d / len * wave : vec2(0.0);
  }

  void main(){
    // Distância até o eixo da rua mais próxima em X e em Z
    vec2 axis = abs(mod(vWorld.xz + halfCity + 40.0, 80.0) - 40.0);
    float road = min(axis.x, axis.y);
    if (road > 10.0) discard; // embaixo dos quarteirões

    vec2 p = vWorld.xz;
    float n = noise(p * 0.16) * 0.62 + noise(p * 0.47 + 31.0) * 0.28 + noise(p * 1.9 + 7.0) * 0.10;
    n += smoothstep(7.0, 10.0, road) * 0.09; // a água junta perto do meio-fio

    float level = mix(0.86, 0.57, wetness);
    float water = smoothstep(level, level + 0.025, n);
    float damp = smoothstep(level - 0.09, level, n);
    float present = smoothstep(0.0, 0.15, wetness);

    float dist = distance(cameraPosition, vWorld);
    float near = 1.0 - smoothstep(14.0, 34.0, dist); // evita cintilação ao longe
    vec2 wave = (ripple(p * 2.2, 0.0) + ripple(p * 1.6 + 0.37, 5.0)) * rain * near;
    vec2 flow = vec2(noise(p * 3.0 + time * 0.6), noise(p * 3.0 - time * 0.5)) - 0.5;

    vec3 view = normalize(cameraPosition - vWorld);
    vec3 normal = normalize(vec3(wave.x * 0.35, 1.0, wave.y * 0.35));
    float fresnel = 0.12 + 0.88 * pow(1.0 - clamp(dot(view, normal), 0.0, 1.0), 4.0);

    vec2 uv = vReflect.xy / vReflect.w + wave * 0.018 + flow * 0.004 * rain;
    vec3 mirror = texture2D(tReflect, uv).rgb;
    vec3 waterColor = mix(vec3(0.012, 0.014, 0.017), mirror, fresnel);
    waterColor += vec3(0.05) * clamp(wave.x + wave.y, 0.0, 1.0);

    // Asfalto molhado: escurece a pista e mais ainda a borda das poças
    float wetAlpha = 0.18 * wetness + 0.34 * damp * present;
    float alpha = mix(wetAlpha, 0.94, water * present);
    vec3 color = mix(vec3(0.004), waterColor, water * present);

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

export class Puddles {
  constructor(world) {
    this.world = world;
    this.wetness = 0;
    this.target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
    this.mirror = new THREE.PerspectiveCamera(); // só enxerga a camada 0
    this.textureMatrix = new THREE.Matrix4();

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      wetness: { value: 0 }, rain: { value: 0 }, time: { value: 0 }, halfCity: { value: CITY.HALF },
    }]);
    uniforms.tReflect = { value: this.target.texture };
    uniforms.textureMatrix = { value: this.textureMatrix };

    const size = 2 * CITY.HALF + CITY.ROAD;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms, vertexShader, fragmentShader, fog: true,
        transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      })
    );
    this.mesh.position.y = Y;
    this.mesh.renderOrder = -1; // antes dos outros transparentes
    this.mesh.layers.set(WEATHER_LAYER);
    this.mesh.visible = false;
    world.scene.add(this.mesh);

    // Detalhes pequenos que não entram no reflexo (marcados em city.js)
    this.skip = [];
    world.scene.traverse((o) => { if (o.userData.noReflect) this.skip.push(o); });
    this._wasVisible = [];

    // Objetos temporários (sem alocação por quadro)
    this._size = new THREE.Vector2();
    this._fwd = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._skyPos = new THREE.Vector3();
    this._plane = new THREE.Plane();
    this._up = new THREE.Vector3(0, 1, 0);
    this._point = new THREE.Vector3();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  set(wetness, rain, time) {
    this.wetness = wetness;
    const u = this.mesh.material.uniforms;
    u.wetness.value = wetness;
    u.rain.value = rain;
    u.time.value = time;
  }

  // Chamado por World antes de desenhar a cena
  render() {
    const w = this.world;
    const active = w.graphics === 'cinematic' && this.wetness > 0.005;
    this.mesh.visible = active;
    if (!active) return;
    const camera = w.camera;
    camera.updateMatrixWorld();
    if (camera.position.y <= CLIP_Y) return;

    const r = w.renderer;
    r.getDrawingBufferSize(this._size);
    const k = Math.min(SCALE * (w.quality <= 1 ? 0.75 : 1), MAX_WIDTH / this._size.x);
    const tw = Math.max(2, Math.round(this._size.x * k));
    const th = Math.max(2, Math.round(this._size.y * k));
    if (this.target.width !== tw || this.target.height !== th) this.target.setSize(tw, th);

    this._updateMirror(camera);

    const oldTarget = r.getRenderTarget();
    const shadowPending = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false; // sombras só na passada principal
    for (let i = 0; i < this.skip.length; i++) {
      this._wasVisible[i] = this.skip[i].visible;
      this.skip[i].visible = false;
    }
    const sky = w.sky;
    this._skyPos.copy(sky.position);
    sky.position.copy(this.mirror.position);
    sky.scale.setScalar(SKY_SCALE);

    r.setRenderTarget(this.target);
    r.clear();
    r.render(w.scene, this.mirror);
    r.setRenderTarget(oldTarget);

    sky.position.copy(this._skyPos);
    sky.scale.setScalar(1);
    sky.updateMatrixWorld();
    for (let i = 0; i < this.skip.length; i++) this.skip[i].visible = this._wasVisible[i];
    r.shadowMap.needsUpdate = shadowPending;
  }

  // Câmera espelhada em relação ao plano da pista (mesma técnica do Reflector do Three.js)
  _updateMirror(camera) {
    const m = this.mirror;
    camera.getWorldDirection(this._fwd);
    m.position.set(camera.position.x, 2 * Y - camera.position.y, camera.position.z);
    m.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    m.up.y *= -1;
    this._fwd.y *= -1;
    m.lookAt(this._look.copy(m.position).add(this._fwd));
    m.fov = camera.fov;
    m.aspect = camera.aspect;
    m.near = camera.near;
    m.far = FAR;
    m.updateProjectionMatrix();
    m.updateMatrixWorld();

    this.textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    ).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);

    // Plano de corte oblíquo logo acima da pista
    this._plane.setFromNormalAndCoplanarPoint(this._up, this._point.set(0, CLIP_Y, 0));
    this._plane.applyMatrix4(m.matrixWorldInverse);
    const c = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = m.projectionMatrix.elements;
    const q = this._q.set(
      (Math.sign(c.x) + e[8]) / e[0],
      (Math.sign(c.y) + e[9]) / e[5],
      -1,
      (1 + e[10]) / e[14]
    );
    c.multiplyScalar(2 / c.dot(q));
    e[2] = c.x; e[6] = c.y; e[10] = c.z + 1; e[14] = c.w;
  }
}