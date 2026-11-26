import * as THREE from 'three';
import { World, GRAPHICS } from './world.js';
import { Physics } from './physics.js';
import { buildCity } from './city.js';
import { Controls } from './controls.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { NPCManager } from './npc.js';
import { ThirdPersonCamera } from './camera.js';
import { Minimap } from './minimap.js';
import { Effects } from './effects.js';
import { Weapons } from './weapons.js';
import { Aircraft, AIR_VMAX } from './aviao.js';
import { groundHeight } from './utils.js';
import { Police } from './police.js';
import { Weather } from './weather.js';

export class Game {
  constructor() {
    this.state = 'menu'; // menu | playing | paused
    this.money = 0;
    this.fpsCap = 0;
    this.last = performance.now();
    this.menuAngle = 0;
    this.pickups = [];
    this._prompt = null;
    this._speed = -1;
    this._money = -1;
  }

  async init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), start: $('screen-start'), pause: $('screen-pause'), money: $('money'),
      prompt: $('prompt'), speedo: $('speedo'), speedValue: $('speed-value'), speedFill: $('speed-fill'), notifs: $('notifs'),
      gfx: [$('btn-gfx-start'), $('btn-gfx-pause')],
      alt: $('altitude'),
    };
    this.notify = this.notify.bind(this);
    window.game = this; // para depuração no console: game.world.renderer.info

    this.world = new World($('app'));
    this.physics = new Physics();
    this.city = buildCity(this.world.scene, this.physics);
    this.controls = new Controls(this.world.renderer.domElement);
    this.player = new Player(this.world.scene, this.physics);
    await this.player.load('./models/player.glb');
    this.vehicles = new VehicleManager(this.world.scene, this.physics, this.notify);
    await this.vehicles.load();
    this.vehicles.populate(this.city);
    this.fx = new Effects(this.world.scene);
    this.npcs = new NPCManager(this.world.scene, this.physics, this.city, 60, this.fx);
    this.vehicles.setPedestrians(this.npcs.list, this.player); // o tráfego para diante de pedestres
    this.weapons = new Weapons(this.world.scene, this.fx, this.npcs, this.vehicles, this.physics, this.player);
    this.aircraft = new Aircraft(this.world.scene, this.physics, this.fx);
    await this.aircraft.load('./models/aviao.glb');
    this.aircraft.onWreck = (x, z, h) => this._onWreck(x, z, h);
    this.police = new Police({
      scene: this.world.scene, physics: this.physics, vehicles: this.vehicles, fx: this.fx,
      player: this.player, notify: this.notify, onRestart: () => this.restart(),
    });
    this.weapons.onCrime = () => this.police.crime();
    this.npcs.onCrime = () => this.police.crime();
    this.weapons.police = this.police;
    this.cam = new ThirdPersonCamera(this.world.camera, this.physics);
    this.minimap = new Minimap($('minimap'), this.city);
    this.weather = new Weather(this.world, this.notify);
    this._initPickups();
    this.resetState();

    for (const b of this.el.gfx) b.addEventListener('click', () => this.toggleGraphics());
    this._updateGraphicsButtons();
    for (const b of this.el.gfx) b.disabled = false;

    this.controls.onLockChange = (locked) => { if (!locked && this.state === 'playing') this.pause(); };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' && this.state === 'playing') this.pause();
      else if (e.code === 'KeyP') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
      }
    });

    // Contador de FPS no canto superior esquerdo (criado por JS, sem mexer no HTML/CSS)
    this._fpsEl = document.createElement('div');
    Object.assign(this._fpsEl.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '1000', pointerEvents: 'none',
      padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,0,0,0.55)',
      color: '#7CFC7C', font: '12px monospace',
    });
    this._fpsEl.textContent = 'FPS --';
    document.body.appendChild(this._fpsEl);
    this._fpsFrames = 0;
    this._fpsT0 = performance.now();

    requestAnimationFrame(this.loop);
  }

  // ---------- Estados ----------
  resetState() {
    this.money = 0;
    const sp = this.city.spawn, car = this.city.starterCar;
    this.player.reset(sp);
    this.player.heading = Math.atan2(car.x - sp.x, car.z - sp.z); // olhando para o carro inicial
    this.player.sync();
    this.vehicles.resetAll();
    this.npcs.reset();
    this.fx.reset();
    this.weapons.reset();
    this.police.reset();
    this.aircraft.reset();
    this.weather.reset();
    for (const k of this.pickups) this._place(k);
    this.cam.snap(this.player.heading);
    this.cam.idle = 0;
  }

  start() {
    this.el.start.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.resetState();
    this._enter();
    this.notify('Bem-vindo a Vice Brasília. Chegue perto de um carro e aperte E.');
  }

  _enter() {
    this.state = 'playing';
    this.controls.enabled = true;
    this.controls.clear();
    this.controls.lock();
    this.el.pause.classList.add('hidden');
    this.last = performance.now();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.controls.enabled = false;
    this.controls.unlock();
    this.controls.clear();
    this.el.pause.classList.remove('hidden');
  }

  resume() { if (this.state === 'paused') this._enter(); }

  restart() {
    this.resetState();
    this._enter();
    this.notify('Jogo reiniciado.');
  }

  // ---------- Gráficos (padrão: Normal a cada carregamento da página; não é salvo) ----------
  toggleGraphics() {
    const next = this.world.graphics === GRAPHICS.NORMAL ? GRAPHICS.CINEMATIC : GRAPHICS.NORMAL;
    this.world.setGraphics(next);
    this._updateGraphicsButtons();
  }

  _updateGraphicsButtons() {
    const label = `Gráficos: ${this.world.graphics === GRAPHICS.NORMAL ? 'Normal' : 'Cinematográfico'}`;
    for (const b of this.el.gfx) b.textContent = label;
  }

  // ---------- Ciclo principal: atualização separada da renderização ----------
  loop = (t) => {
    requestAnimationFrame(this.loop);
    if (this.fpsCap && t - this.last < 1000 / this.fpsCap - 2) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    if (this.state === 'playing') this.update(dt, t / 1000);
    else if (this.state === 'menu') this.updateMenu(dt);
    else if (this.state === 'lost') this.police.fadeLose(dt);
    this.world.playerCar = this.player.vehicle || null;
    this.world.render();

    // Conta quadros realmente desenhados e atualiza o texto a cada 0,5 s
    this._fpsFrames++;
    const span = t - this._fpsT0;
    if (span >= 500) {
      const fps = Math.round((this._fpsFrames * 1000) / span);
      this._fpsEl.textContent = `FPS ${fps}`;
      if (!this.fpsCap) this.world.governQuality(fps); // ajuste automático de qualidade
      this._fpsFrames = 0;
      this._fpsT0 = t;
    }
  };

  updateMenu(dt) {
    this.menuAngle += dt * 0.08;
    const a = this.menuAngle, cam = this.world.camera;
    cam.position.set(Math.cos(a) * 120, 60, Math.sin(a) * 120);
    cam.lookAt(0, 10, 0);
    this.world.update(dt, { x: 0, z: 0 });
    this.city.update(dt);
    this.npcs.update(dt, this.vehicles, this.player);
  }

  update(dt, time) {
    const c = this.controls, p = this.player;
    this.cam.handleInput(c, dt, !!p.aircraft);
    if (c.wasPressed('KeyE')) this.toggleVehicle();
    if (c.wasPressed('KeyF')) {
      this.fpsCap = this.fpsCap ? 0 : 30;
      this.notify(this.fpsCap ? 'Limite de 30 FPS ativado' : 'Limite de FPS desativado');
    }

    if (p.aircraft) {
      this.aircraft.update(dt, c);
      p.followAircraft(this.aircraft);
      p.chibi.update(dt, { speed: 0, grounded: true, vy: 0 });
    } else {
      this.aircraft.update(dt, null);
      p.update(dt, c, this.cam.yaw, this.vehicles);
      p.sync();
    }
    this.weapons.update(dt, c, this.cam.yaw, p);
    this.vehicles.update(dt, c, p.pos);
    this.npcs.update(dt, this.vehicles, p);
    this.fx.update(dt);
    const why = this.police.update(dt, p);
    if (why) this._lose();
    this._updatePickups(dt, time);

    const v = p.vehicle, ac = p.aircraft;
    this.cam.update(dt, p.pos, !!(v || ac), p.heading, v ? v.speed : (ac ? ac.speed : p.speed));
    this.weather.update(dt, c);
    this.world.update(dt, p.pos);
    this.city.update(dt);
    this.minimap.draw(dt, p, this.cam.yaw, this.vehicles, this.npcs, this.pickups, this.aircraft);
    this._updateHud();
    c.endFrame();
  }

  toggleVehicle() {
    const p = this.player;
    if (p.aircraft) {
      if (p.exitAircraft()) this.notify('Você saiu do avião');
      else this.notify('Pouse e pare para sair');
    } else if (p.enterAircraft(this.aircraft)) {
      this.notify('Você entrou no avião');
    } else if (p.vehicle) {
      const name = p.vehicle.name;
      if (p.tryExit(this.vehicles)) this.notify(`Você saiu do ${name}`);
      else this.notify('Reduza a velocidade para sair');
    } else {
      // carro de tráfego em movimento: o motorista NPC sai correndo antes de o jogador entrar
      const n = this.vehicles.nearest(p.pos.x, p.pos.z, 4.2);
      if (n && this.vehicles.hasDriver(n)) { this.npcs.ejectDriver(n); this.police.crime(); }
      if (p.tryEnter(this.vehicles)) this.notify(`Você entrou no ${p.vehicle.name}`);
    }
  }

  // Derrota: escurece a tela, mostra "Perdeu Playboy" e solta o mouse. Restart pelo botão.
  _lose() {
    this.state = 'lost';
    this.controls.enabled = false;
    this.controls.unlock();
    this.controls.clear();
    this.police.showLose();
  }

  _onWreck(x, z, h) {
    this.notify('O avião explodiu!');
    if (this.player.aircraft) this.player.ejectFromAircraft(x, z, h);
  }

  // ---------- Coletáveis (dinheiro fictício) ----------
  _initPickups() {
    const geo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16).rotateX(Math.PI / 2);
    const m = new THREE.MeshLambertMaterial({ color: 0xffc928, emissive: 0x553d00 });
    for (let i = 0; i < 36; i++) {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      this.world.scene.add(mesh);
      this.pickups.push({ mesh, x: 0, z: 0, gh: 0, active: false, phase: Math.random() * 6.28, respawn: 0, value: 0 });
    }
  }

  _place(k) {
    const q = this.city.randomSidewalkPoint();
    k.x = q.x; k.z = q.z; k.gh = groundHeight(q.x, q.z);
    k.active = true;
    k.value = (1 + ((Math.random() * 5) | 0)) * 50;
    k.mesh.visible = true;
    k.mesh.position.set(k.x, k.gh + 0.9, k.z);
  }

  _updatePickups(dt, time) {
    const p = this.player;
    const r2 = p.vehicle ? 6.25 : 2.56;
    for (const k of this.pickups) {
      if (!k.active) {
        k.respawn -= dt;
        if (k.respawn <= 0) this._place(k);
        continue;
      }
      k.mesh.rotation.y += dt * 3;
      k.mesh.position.y = k.gh + 0.9 + Math.sin(time * 3 + k.phase) * 0.12;
      const dx = k.x - p.pos.x, dz = k.z - p.pos.z;
      if (dx * dx + dz * dz < r2) {
        k.active = false;
        k.mesh.visible = false;
        k.respawn = 30;
        this.money += k.value;
        this.notify(`+$${k.value}`);
      }
    }
  }

  // ---------- HUD ----------
  notify(msg) {
    const box = this.el.notifs;
    const d = document.createElement('div');
    d.className = 'notif';
    d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => d.remove(), 3500);
  }

  _updateHud() {
    const p = this.player, v = p.vehicle;
    if (this.money !== this._money) {
      this._money = this.money;
      this.el.money.textContent = `$ ${this.money.toLocaleString('pt-BR')}`;
    }
    const ac = p.aircraft;
    let msg = null;
    if (ac) msg = 'E · Sair do avião';
    else if (v) msg = 'E · Sair do veículo';
    else if (this.aircraft.canBoard(p.pos.x, p.pos.z)) msg = 'E · Entrar no avião';
    else {
      const n = this.vehicles.nearest(p.pos.x, p.pos.z, 4.2);
      if (n) msg = `E · Entrar no ${n.name}`;
    }
    if (msg !== this._prompt) {
      this._prompt = msg;
      this.el.prompt.textContent = msg || '';
      this.el.prompt.classList.toggle('hidden', !msg);
    }
    this.el.speedo.classList.toggle('hidden', !v && !ac);
    this.el.alt.classList.toggle('hidden', !ac);
    if (v || ac) {
      const spd = ac ? ac.speed : Math.abs(v.speed);
      const vmax = ac ? AIR_VMAX : v.type.maxSpeed;
      const kmh = Math.round(spd * 3.6);
      if (kmh !== this._speed) {
        this._speed = kmh;
        this.el.speedValue.textContent = kmh;
        this.el.speedFill.style.width = `${Math.min(100, (spd / vmax) * 100)}%`;
      }
      if (ac) this.el.alt.textContent = `Altitude ${Math.round(ac.y - groundHeight(ac.x, ac.z))} m`;
    }
  }
}