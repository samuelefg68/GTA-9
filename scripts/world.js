import * as THREE from 'three';
import { rand } from './utils.js';
import { setCarShadows } from './vehicles.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const GRAPHICS = { NORMAL: 'normal', CINEMATIC: 'cinematic' };

// Níveis de qualidade ajustados automaticamente pelo FPS (ver governQuality).
// pr: resolução de render (limitada ao devicePixelRatio); shadow: tamanho do mapa de sombra.
const QUALITY = [
  { pr: 0.75, shadow: 512 },   // baixo
  { pr: 1, shadow: 1024 },     // médio
  { pr: 1.75, shadow: 2048 },  // alto (padrão)
];

// Diagnóstico: o composer (bloom + MSAA HalfFloat) fica desligado. Se o chão aparecer com ele desligado,
// a causa estava no pós-processamento. Com false, o modo Cinematográfico usa o tone mapping do renderer direto.
const USE_COMPOSER = false;

// Diagnóstico do modo Cinematográfico via URL (ver setGraphics). Não afeta o modo Normal.
const DBG = new URLSearchParams(window.location.search);

// Predefinições de gráficos. 'normal' é o padrão e reproduz o visual original.
// 'cinematic' só troca valores (tone mapping, cores, intensidades, altura do sol e viés de sombra).
// Não aumenta resolução de sombra, pixel ratio nem número de luzes, por isso não adiciona custo de GPU.
const PRESETS = {
  normal: {
    toneMapping: THREE.NoToneMapping, exposure: 1,
    sunDir: [80, 120, 60], sunColor: 0xfff1d6, sunIntensity: 2.1, bias: -0.0004, normalBias: 0.05,
    hemiSky: 0xcfe6ff, hemiGround: 0x6b7a5a, hemiIntensity: 1.1,
    fog: 0xbcd9f2, skyTop: 0x3a78c9, skyBottom: 0xbcd9f2, fogNear: 140, fogFar: 620,
    envIntensity: 0, bloom: 0,
  },
  // Sol baixo o bastante para dar contraluz, mas alto o bastante para que as sombras
  // não cubram a rua inteira (com y=40 a rua ficava quase toda preta).
  cinematic: {
    toneMapping: THREE.ACESFilmicToneMapping, exposure: 1.25,
    sunDir: [60, 75, 110], sunColor: 0xffa860, sunIntensity: 3.0, bias: -0.0004, normalBias: 0.05,
    hemiSky: 0x8fb8ff, hemiGround: 0x5a4030, hemiIntensity: 0.7,
    fog: 0xf0a070, skyTop: 0x1b3766, skyBottom: 0xffb27a, fogNear: 90, fogFar: 480,
    envIntensity: 0, bloom: 0,
  },
};

export class World {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false; // refeito só quando necessário (ver update)
    this._shadowKey = '';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.graphics = GRAPHICS.NORMAL;
    this.sunDir = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbcd9f2, 140, 620);
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.2, 1400);

    // Iluminação: hemisférica (ambiente) + direcional (sol) com sombras que seguem o jogador.
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

    // Céu em degradê (domo que acompanha a câmera).
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x3a78c9) }, bottom: { value: new THREE.Color(0xbcd9f2) } },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(h * 1.4, 0.0, 1.0)), 1.0);\n#include <colorspace_fragment>\n}',
      })
    );
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);

    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(28, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false, toneMapped: false }));
    this.scene.add(this.sunDisc);

    // Nuvens: elipsoides achatados compartilhando geometria e material.
    const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: 0.92, toneMapped: false });
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

    // Luz de rebote: um céu em degradê pré-filtrado (PMREM), gerado uma única vez.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(
      new THREE.SphereGeometry(10, 16, 8),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { top: { value: new THREE.Color(0x9ec8ff) }, horizon: { value: new THREE.Color(0xffc08a) }, ground: { value: new THREE.Color(0x3a2a20) } },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying float h; void main(){ vec3 c = h > 0.0 ? mix(horizon, top, smoothstep(0.0, 0.6, h)) : mix(horizon, ground, smoothstep(0.0, -0.3, h)); gl_FragColor = vec4(c, 1.0); }',
      })
    ));
    this.envTex = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    // Pós-processamento (só no modo Cinematográfico): cena -> bloom -> tone mapping/sRGB.
    // MSAA só com WebGL2; sem ele, o target HalfFloat funciona em mais GPUs/drivers.
    const size = this.renderer.getSize(new THREE.Vector2());
    const msaa = this.renderer.capabilities.isWebGL2 ? 4 : 0;
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0, 0.55, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composerOk = true; // vira false se o pós-processamento falhar; aí renderiza direto

    this.setGraphics(GRAPHICS.NORMAL);
    this.resize();
    this.quality = QUALITY.length - 1;
    this._qSlow = 0; this._qFast = 0;
    this._applyQuality();
    window.addEventListener('resize', () => this.resize());
  }

  // Aplica o nível de qualidade atual (resolução de render e tamanho do mapa de sombra)
  _applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
  }

  // Chamado pelo jogo com o FPS medido. Só baixa após ~1 s abaixo de 45 e só sobe após ~4 s acima de 58.
  governQuality(fps) {
    if (fps < 45) { this._qSlow++; this._qFast = 0; }
    else if (fps > 58) { this._qFast++; this._qSlow = 0; }
    else { this._qSlow = 0; this._qFast = 0; }
    if (this._qSlow >= 2 && this.quality > 0) {
      this.quality--; this._qSlow = 0; this._applyQuality();
    } else if (this._qFast >= 8 && this.quality < QUALITY.length - 1) {
      this.quality++; this._qFast = 0; this._applyQuality();
    }
  }

  // Aplica uma predefinição de gráficos. Não cria objetos novos: só ajusta valores existentes.
  // Diagnóstico: ?use=tone,hemi,sun,fog,env faz o modo Cinematográfico usar os valores do Normal nesses grupos.
  setGraphics(mode) {
    const p = PRESETS[mode];
    if (!p) return;
    this.graphics = mode;
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

    // Carros projetam sombra só no Cinematográfico (eles entram no mapa de sombra)
    setCarShadows(cine); // vehicles.js aplica no próximo quadro, só nos carros perto do jogador
  }

  // Liga a luz de rebote nos materiais Lambert já existentes (chamado só ao trocar de modo).
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt, focus) {
    // A sombra acompanha o foco, "encaixada" em passos de 2 m para evitar tremulação.
    const d = this.sunDir;
    const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
    this.sun.position.set(fx + d.x, d.y, fz + d.z);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.target.updateMatrixWorld();

    // Mapa de sombra só é refeito quando a posição encaixada muda (ou o modo de gráficos muda).
    // Antes era refeito a cada quadro, redesenhando todos os prédios na luz do sol.
    const key = fx + ',' + fz;
    // No Cinematográfico os carros se movem, então o mapa é refeito a cada quadro.
    this._frame = (this._frame || 0) + 1;
    const cineRefresh = this.graphics === GRAPHICS.CINEMATIC && this._frame % 2 === 0;
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
    if (USE_COMPOSER && this.graphics === GRAPHICS.CINEMATIC && this.composerOk) {
      try {
        this.composer.render();
        return;
      } catch (err) {
        // Falha no pós-processamento: registra uma vez e volta ao render direto.
        this.composerOk = false;
        console.error('Pós-processamento desativado, usando render direto:', err);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}