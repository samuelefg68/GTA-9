import * as THREE from 'three';
import { rand, lerp } from './utils.js';
import { setCarShadows, setCarGraphics } from './vehicles.js';
import { setCityGraphics } from './city.js';
import { CarReflections } from './reflections.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const GRAPHICS = { NORMAL: 'normal', CINEMATIC: 'cinematic' };

// Escada de qualidade (do mais barato ao mais caro). A resolução NUNCA fica abaixo do nativo
// (pr 1): abaixo disso a imagem fica borrada. O regulador corta, nesta ordem: sombras maiores,
// reflexo dinâmico do carro (cube) e bloom. O antialiasing é o FXAA, ligado em todos os níveis.
// O Cinematográfico começa no nível CINE_START (tudo ligado, resolução nativa).
const QUALITY = [
  { pr: 1,    shadow: 512,  bloom: false, cube: false },
  { pr: 1,    shadow: 1024, bloom: false, cube: false },
  { pr: 1,    shadow: 1024, bloom: true,  cube: false },
  { pr: 1,    shadow: 1024, bloom: true,  cube: true  },
  { pr: 1.25, shadow: 1024, bloom: true,  cube: true  },
  { pr: 1.75, shadow: 2048, bloom: true,  cube: true  },
];
const CINE_START = 3;
const FPS_MIN = 33;   // abaixo disto (média de 1 s) o regulador baixa a qualidade (Cinematográfico)

// Cores do tempo fechado (chuva)
const STORM = {
  skyTop: new THREE.Color(0x3b444f), skyBottom: new THREE.Color(0x737d87),
  cloud: new THREE.Color(0x5b636d), sun: new THREE.Color(0xaab4c0),
  hemiSky: new THREE.Color(0x8591a0), hemiGround: new THREE.Color(0x3c403c),
};

const USE_COMPOSER = true;
const DBG = new URLSearchParams(window.location.search);

// Alterando os presets do Cinematic para Dia Claro
const PRESETS = {
  normal: {
    toneMapping: THREE.NoToneMapping, exposure: 1,
    sunDir: [80, 120, 60], sunColor: 0xfff1d6, sunIntensity: 2.1, bias: -0.0004, normalBias: 0.05,
    hemiSky: 0xcfe6ff, hemiGround: 0x6b7a5a, hemiIntensity: 1.5,
    fog: 0xbcd9f2, skyTop: 0x3a78c9, skyBottom: 0xbcd9f2, fogNear: 140, fogFar: 620,
    envIntensity: 0, bloom: 0,
  },
  cinematic: {
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.25,
    // Sol mais alto e cor neutra (dia)
    sunDir: [40, 140, 70], sunColor: 0xfffaed, sunIntensity: 2.8, bias: -0.0004, normalBias: 0.05,
    // Luz ambiente mais viva
    hemiSky: 0x90b0d0, hemiGround: 0x5a6050, hemiIntensity: 1.3,
    // Céu azul e névoa diurna
    fog: 0xa8c5e0, skyTop: 0x1b5aab, skyBottom: 0x90c5ed, fogNear: 100, fogFar: 500,
    envIntensity: 0, bloom: 0.25, // Bloom reduzido para dia
  },
};

export class World {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this._shadowKey = '';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.graphics = GRAPHICS.NORMAL;
    this.sunDir = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbcd9f2, 140, 620);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.2, 1400);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6b7a5a, 1.1);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x3a78c9) }, bottom: { value: new THREE.Color(0xbcd9f2) } },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(h * 1.4, 0.0, 1.0)), 1.0);
#include <colorspace_fragment>
}`,
      })
    );
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);

    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false, toneMapped: false }));
    this.scene.add(this.sunDisc);

    const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92, toneMapped: false });
    this.cloudMat = cloudMat;
    this.clouds = [];
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const m = new THREE.Mesh(cloudGeo, cloudMat);
        m.scale.set(rand(25, 45), rand(8, 13), rand(15, 28));
        m.position.set(j * 28 - 42 + rand(-6, 6), rand(-3, 4), rand(-10, 10));
        g.add(m);
      }
      g.position.set(rand(-700, 700), rand(170, 240), rand(-700, 700));
      this.scene.add(g);
      this.clouds.push(g);
    }

    // PMREM (mapa de ambiente) refeito para Dia Claro!
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: {
          top: { value: new THREE.Color(0x1b5aab) }, // Azul céu vibrante
          horizon: { value: new THREE.Color(0xa8c5e0) }, // Horizonte claro
          ground: { value: new THREE.Color(0x404840) }, // Chão mais neutro
          sunDir: { value: new THREE.Vector3(40, 140, 70).normalize() },
        },
        vertexShader: 'varying vec3 dir; void main(){ dir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir;
          varying vec3 dir;
          void main(){
            float h = dir.y;
            vec3 c = h > 0.0
              ? mix(horizon, top, smoothstep(0.0, 0.6, h))
              : mix(horizon * 0.8, ground, smoothstep(0.0, -0.3, h));
            float s = max(dot(normalize(dir), sunDir), 0.0);
            // Sol claro, sem o tom laranjado do pôr do sol
            c += vec3(1.0, 0.95, 0.85) * pow(s, 24.0) * 1.5;
            c += vec3(1.0, 1.0, 0.9) * smoothstep(0.998, 1.0, s) * 5.0;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      })
    ));
    this.envTex = pmrem.fromScene(envScene, 0.015).texture;
    pmrem.dispose();

    const size = this.renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples: 0, // sem MSAA (caro): o antialiasing é o FXAA
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.25, 0.4, 0.92);
    // Bloom em 1/4 da resolução (metade da padrão): o brilho é borrado de qualquer jeito
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bloomSetSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // FXAA depois do OutputPass (precisa da imagem já em sRGB); é o último passe e vai para a tela
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.composerOk = true;
    this._envRainApplied = 0;

    this.reflections = new CarReflections(this.renderer, this.scene);
    this.playerCar = null; // carro dirigido pelo jogador (definido por game.js)

    this.rain = 0;                // intensidade da chuva (definida por weather.js)
    this.preRender = null;        // passada extra antes da cena (reflexo das poças)
    this._base = null;            // predefinições em uso, sem o efeito da chuva
    this._envRecords = new WeakMap();
    this._envScale = 1;
    this.sunDisc.material.transparent = true;

    this.setGraphics(GRAPHICS.NORMAL);
    this.resize();
    this.quality = QUALITY.length - 1;
    this._qSlow = 0; this._qFast = 0; this._upNeed = 10; this._sinceUp = 99;
    this._lastT = 0; this._accT = 0; this._accN = 0; // medição própria de FPS
    this._applyQuality();
    window.addEventListener('resize', () => this.resize());
  }

  _applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.renderer.shadowMap.needsUpdate = true;
    this.bloom.enabled = q.bloom;
    this.resize();
  }

  // O World mede o FPS sozinho (a cada ~1 s) e chama o regulador; governQuality() ficou
  // só por compatibilidade com o game.js e não faz mais nada.
  governQuality() {}

  _measure() {
    const now = performance.now();
    if (this._lastT) {
      const dt = now - this._lastT;
      if (dt < 500) { this._accT += dt; this._accN++; } // ignora pausas/aba escondida
    }
    this._lastT = now;
    if (this._accT >= 1000) {
      this._govern(this._accN * 1000 / this._accT);
      this._accT = 0; this._accN = 0;
    }
  }

  // Cinematográfico: baixa se a média ficar abaixo de FPS_MIN; Normal mira 45+.
  _govern(fps) {
    const cine = this.graphics === GRAPHICS.CINEMATIC;
    const lo = cine ? FPS_MIN : 45, hi = cine ? 52 : 58;
    this._sinceUp++;
    if (fps < lo) {
      this._qFast = 0;
      if (this.quality > 0) {
        // Subiu e logo caiu de novo: espera mais antes de tentar subir outra vez
        if (this._sinceUp < 12) this._upNeed = Math.min(this._upNeed * 2, 60);
        this.quality = Math.max(0, this.quality - (fps < 24 ? 2 : 1));
        this._applyQuality();
      }
    } else if (fps > hi) {
      if (++this._qFast >= this._upNeed && this.quality < QUALITY.length - 1) {
        this.quality++; this._qFast = 0; this._sinceUp = 0; this._applyQuality();
      }
    } else {
      this._qFast = 0;
    }
  }

  setGraphics(mode) {
    const p = PRESETS[mode];
    if (!p) return;
    this.graphics = mode;
    this._setEnvScale(1); // devolve os reflexos ao normal antes de trocar materiais
    this.reflections.release(); // antes de trocar os materiais dos carros
    const cine = mode === GRAPHICS.CINEMATIC;
    const use = new Set(DBG.get('use') ? DBG.get('use').split(',') : []);
    const g = (group) => (cine && use.has(group) ? PRESETS.normal : p);

    const t = g('tone');
    this.renderer.toneMapping = t.toneMapping;
    this.renderer.toneMappingExposure = t.exposure;

    const h = g('hemi');
    this.hemi.color.setHex(h.hemiSky);
    this.hemi.groundColor.setHex(h.hemiGround);
    this.hemi.intensity = h.hemiIntensity;

    const s = g('sun');
    this.sun.color.setHex(s.sunColor);
    this.sun.intensity = s.sunIntensity;
    this.sun.shadow.bias = s.bias;
    this.sun.shadow.normalBias = s.normalBias;
    this.sunDir.set(s.sunDir[0], s.sunDir[1], s.sunDir[2]);

    const f = g('fog');
    this.scene.fog.color.setHex(f.fog);
    this.scene.fog.near = f.fogNear;
    this.scene.fog.far = f.fogFar;
    this.sky.material.uniforms.top.value.setHex(f.skyTop);
    this.sky.material.uniforms.bottom.value.setHex(f.skyBottom);

    this.bloom.strength = p.bloom;
    this.renderer.shadowMap.needsUpdate = true;
    this._applyEnvironment(g('env').envIntensity);

    setCityGraphics(cine, this.envTex);
    setCarGraphics(cine, this.envTex);
    setCarShadows(cine);
    // O Cinematográfico começa num nível médio e o regulador sobe se der
    if (cine && this.quality > CINE_START) {
      this.quality = CINE_START; this._qSlow = 0; this._qFast = 0;
      this._applyQuality();
    }

    this._base = { exposure: t.exposure, hemi: h, sun: s, fog: f, bloom: p.bloom };
    this._applyWeather();
  }

  setRain(k) {
    if (k === this.rain) return;
    // Os materiais são percorridos em passos, não a cada quadro
    const step = Math.abs(k - this._envRainApplied) > 0.02 || k === 0 || k === 1;
    this.rain = k;
    this._applyWeather(step);
  }

  // Mistura a predefinição atual com o tempo fechado.
  // Normal: só céu, nuvens, sol e cor da neblina. Cinematográfico: também luzes e reflexos.
  _applyWeather(updateEnv = true) {
    const b = this._base;
    if (!b) return;
    const k = this.rain;
    const lk = this.graphics === GRAPHICS.CINEMATIC ? k : 0;
    const u = this.sky.material.uniforms;
    u.top.value.setHex(b.fog.skyTop).lerp(STORM.skyTop, k);
    u.bottom.value.setHex(b.fog.skyBottom).lerp(STORM.skyBottom, k);
    this.scene.fog.color.setHex(b.fog.fog).lerp(STORM.skyBottom, k);
    this.cloudMat.color.setHex(0xffffff).lerp(STORM.cloud, k);
    this.sunDisc.material.opacity = 1 - k;
    this.sunDisc.visible = k < 0.99;

    this.scene.fog.near = lerp(b.fog.fogNear, 50, lk);
    this.scene.fog.far = lerp(b.fog.fogFar, 340, lk);
    this.renderer.toneMappingExposure = b.exposure * (1 - 0.12 * lk);
    this.hemi.color.setHex(b.hemi.hemiSky).lerp(STORM.hemiSky, lk);
    this.hemi.groundColor.setHex(b.hemi.hemiGround).lerp(STORM.hemiGround, lk);
    this.hemi.intensity = b.hemi.hemiIntensity * (1 - 0.25 * lk);
    this.sun.color.setHex(b.sun.sunColor).lerp(STORM.sun, lk);
    this.sun.intensity = b.sun.sunIntensity * (1 - 0.8 * lk);
    this.bloom.strength = b.bloom * (1 - 0.5 * lk);

    if (updateEnv) {
      this._envRainApplied = k;
      this._setEnvScale(1 - 0.65 * lk);
    }
  }

  // Escurece o reflexo estático (envTex) nos materiais PBR. O cubemap dinâmico
  // do carro já captura o céu escuro, então ele mantém a intensidade original.
  _setEnvScale(scale) {
    if (scale === 1 && this._envScale === 1) return;
    this._envScale = scale;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (let i = 0; i < m.length; i++) this._scaleEnv(m[i], scale);
      else this._scaleEnv(m, scale);
    });
  }

  _scaleEnv(m, scale) {
    if (!m.isMeshStandardMaterial) return; // inclui MeshPhysicalMaterial
    let rec = this._envRecords.get(m);
    if (!rec) {
      if (m.envMap !== this.envTex) return;
      rec = { base: m.envMapIntensity, applied: m.envMapIntensity };
      this._envRecords.set(m, rec);
    } else if (m.envMapIntensity !== rec.applied) {
      rec.base = m.envMapIntensity; // outro código mudou o valor
    }
    rec.applied = m.envMap === this.envTex ? rec.base * scale : rec.base;
    m.envMapIntensity = rec.applied;
  }

  _updateCarReflections() {
    const r = this.reflections;
    const car = this.graphics === GRAPHICS.CINEMATIC && QUALITY[this.quality].cube ? this.playerCar : null;
    const swap = car !== r.car;
    const scale = this._envScale;
    // Ao trocar de carro, as cópias dos materiais precisam partir dos valores originais
    if (swap) this._setEnvScale(1);
    const wasLive = r.live;
    r.update(car, this.envTex);
    if (swap) this._setEnvScale(scale);
    else if (r.live !== wasLive && scale !== 1) this._setEnvScale(scale);
  }

  _applyEnvironment(intensity) {
    const env = intensity > 0 ? this.envTex : null;
    this.scene.traverse((o) => {
      const m = o.material;
      if (!m || !m.isMeshLambertMaterial) return;
      const list = Array.isArray(m) ? m : [m];
      for (const x of list) {
        if (!x.isMeshLambertMaterial) continue;
        x.envMap = env;
        x.envMapIntensity = intensity;
        x.needsUpdate = true;
      }
    });
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.fxaa.material.uniforms['resolution'].value.set(1 / (w * pr), 1 / (h * pr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt, focus) {
    const d = this.sunDir;
    const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
    this.sun.position.set(fx + d.x, d.y, fz + d.z);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();

    const key = fx + ',' + fz;
    this._frame = (this._frame || 0) + 1;
    const every = this.quality >= 4 ? 3 : 4; // sombras: renovação menos frequente
    const cineRefresh = this.graphics === GRAPHICS.CINEMATIC && this._frame % every === 0;
    if (key !== this._shadowKey || cineRefresh) {
      this._shadowKey = key;
      this.renderer.shadowMap.needsUpdate = true;
    }

    const cp = this.camera.position;
    this.sky.position.copy(cp);
    this.sunDisc.position.set(cp.x + d.x * 7, cp.y + d.y * 7, cp.z + d.z * 7);
    for (const c of this.clouds) {
      c.position.x += dt * 4;
      if (c.position.x > 750) c.position.x = -750;
    }
  }

  render() {
    this._measure();
    this._updateCarReflections();
    if (this.preRender) this.preRender();
    if (USE_COMPOSER && this.graphics === GRAPHICS.CINEMATIC && this.composerOk) {
      try {
        this.composer.render();
        return;
      } catch (err) {
        this.composerOk = false;
        console.error('Pós-processamento desativado, usando render direto:', err);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}