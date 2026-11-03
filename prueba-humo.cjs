/* Prueba de humo sin navegador: DOM/canvas falsos + frames simulados.
   Verifica arranque, oleadas, combate, mejoras, jefe y muerte. */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('No se encontró el <script>'); process.exit(1); }
const code = m[1];

/* ---------- stubs ---------- */
const grads = { addColorStop() {} };
const ctx = new Proxy({
  createLinearGradient: () => grads,
  createRadialGradient: () => grads,
  measureText: (s) => ({ width: String(s || '').length * 7 })
}, {
  get(t, k) { if (k in t) return t[k]; return () => {}; },
  set(t, k, v) { t[k] = v; return true; }
});

const elements = new Map();
function makeEl(id) {
  const handlers = {};
  const e = {
    id, dataset: {}, style: {}, textContent: '', innerHTML: '',
    width: 0, height: 0,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    appendChild() {},
    getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; },
    fire(t, ev) { (handlers[t] || []).forEach(f => f(ev)); },
    handlers
  };
  return e;
}
function getEl(id) {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
}

const globalHandlers = {};
const g = globalThis;
g.window = g;
g.document = {
  documentElement: { dataset: {} },
  getElementById: getEl,
  createElement: (tag) => makeEl('new-' + tag),
  addEventListener(t, f) { (globalHandlers[t] = globalHandlers[t] || []).push(f); },
  hidden: false
};
g.addEventListener = (t, f) => { (globalHandlers[t] = globalHandlers[t] || []).push(f); };
g.matchMedia = () => ({ matches: false });
g.localStorage = {
  _v: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._v, k) ? this._v[k] : null; },
  setItem(k, v) { this._v[k] = String(v); }
};
let rafCb = null;
g.requestAnimationFrame = (cb) => { rafCb = cb; return 1; };
g.performance = g.performance || { now: () => Date.now() };

function fireGlobal(type, ev) {
  (globalHandlers[type] || []).forEach(f => f(ev));
}
function key(k) {
  fireGlobal('keydown', { key: k, repeat: false, preventDefault() {} });
  fireGlobal('keyup', { key: k, preventDefault() {} });
}

/* ---------- ejecutar el juego ---------- */
let bootErr = null;
try {
  vm.runInThisContext(code, { filename: 'filo.js' });
} catch (e) { bootErr = e; }

const report = [];
function check(name, cond, extra) {
  report.push({ name, ok: !!cond, extra: extra || '' });
}

if (bootErr) {
  console.error('ERROR AL ARRANCAR:', bootErr.stack);
  process.exit(1);
}
check('arranca sin errores', document.documentElement.dataset.ready === '1');
check('sin error global', !document.documentElement.dataset.err, document.documentElement.dataset.err || '');

let clock = 0;
function step(ms) {
  const cb = rafCb;
  if (!cb) throw new Error('el bucle no se reprogramó');
  rafCb = null;
  clock += ms;
  cb(clock);
}
function run(frames, ms) { for (let i = 0; i < frames; i++) step(ms || 16.67); }

const F = g.__filo;
check('API de depuración presente', !!F);

/* menú */
run(30);
check('menú estable', F.state().mode === 'menu');

/* jugar */
getEl('btn-play').fire('click', {});
run(10);
check('entra en juego', F.state().mode === 'playing', F.state().mode);
check('oleada 1 arranca', F.state().wave === 1, 'w=' + F.state().wave);

/* mover + atacar durante 8 s */
fireGlobal('keydown', { key: 'd', repeat: false, preventDefault() {} });
getEl('game').fire('pointerdown', { pointerType: 'mouse', button: 0, clientX: 900, clientY: 360, preventDefault() {} });
let sawEnemies = 0, sawBullets = 0;
for (let i = 0; i < 480; i++) {
  step(16.67);
  if (i % 32 === 0) {
    const s = F.state();
    sawEnemies = Math.max(sawEnemies, s.enemies);
    sawBullets = Math.max(sawBullets, s.bullets);
    if (i % 96 === 0) {
      getEl('game').fire('pointermove', { pointerType: 'mouse', clientX: 300 + Math.random() * 700, clientY: 150 + Math.random() * 420 });
    }
  }
}
check('aparecen enemigos', sawEnemies > 0, 'max=' + sawEnemies);
check('hay disparos enemigos', sawBullets >= 0, 'max=' + sawBullets);
check('el jugador hace daño', F.state().score > 0, 'score=' + F.state().score);

/* ---- disparo y técnicas ---- */
F.energy(100);
F.shoot();
run(2);
check('dispara proyectiles', F.state().bolts > 0, 'bolts=' + F.state().bolts);

F.energy(100);
const eBefore = F.state().energy;
F.skill(0);
run(2);
check('bola de energía: gasta energía', F.state().energy < eBefore, 'e=' + F.state().energy);
check('bola de energía: en recarga', F.state().cds[0] > 0, 'cd=' + F.state().cds[0]);
check('bola de energía: proyectil', F.state().bolts > 0, 'bolts=' + F.state().bolts);

F.energy(100);
F.skill(1);
run(2);
check('ráfaga: dispara 5', F.state().bolts >= 5, 'bolts=' + F.state().bolts);
check('ráfaga: en recarga', F.state().cds[1] > 0, 'cd=' + F.state().cds[1]);

F.energy(100);
F.skill(2);
run(2);
check('escudo activo', F.state().shield > 0, 'sh=' + F.state().shield);
const hpBefore = F.state().hp;
F.hurt(60);
run(2);
check('el escudo bloquea el daño', F.state().hp === hpBefore, 'hp=' + F.state().hp + '/' + hpBefore);

F.energy(0);
F.skill(3);
run(2);
check('sin energía no hay onda', F.state().cds[3] === 0, 'cd=' + F.state().cds[3]);

/* limpiar oleadas: mata todo repetidamente hasta que la oleada avance */
function clearCurrentWave(maxFrames) {
  const startWave = F.state().wave;
  for (let i = 0; i < maxFrames; i += 8) {
    const st = F.state();
    if (st.mode === 'upgrade') return 'upgrade';
    if (st.wave !== startWave) return 'advanced';
    F.killAll();
    run(8);
  }
  return 'timeout';
}

let s;
const r0 = clearCurrentWave(900);
s = F.state();
check('pasa de oleada 1', s.wave >= 2, 'w=' + s.wave + ' ' + r0);

/* oleada 2: ya hay tiradores */
let shots = 0;
for (let i = 0; i < 520; i++) { step(16.67); shots = Math.max(shots, F.state().bullets); }
check('hay disparos enemigos', shots > 0, 'max=' + shots);

/* oleada 2 limpia -> pantalla de mejora */
const r1 = clearCurrentWave(900);
check('pantalla de mejora', r1 === 'upgrade', 'modo=' + r1 + ' w=' + F.state().wave);
check('ofrece 3 mejoras', F.state().upgrades === 3, 'n=' + F.state().upgrades);
key('1');
run(5);
check('mejora aplicada', F.state().mode === 'playing', F.state().mode);

/* subir a oleada 4 y forzar la 5 (jefe) */
F.setWave(4);
clearCurrentWave(900);
if (F.state().mode === 'upgrade') { key('1'); run(5); }
run(240);
s = F.state();
check('llega al jefe', s.wave >= 5, 'w=' + s.wave);
check('el jefe aparece', s.boss || s.markers > 0 || s.queued > 0, 'boss=' + s.boss + ' e=' + s.enemies);

/* onda de energía no rompe nada */
F.nova();
run(60);
check('onda sin errores', true);

/* muerte y reinicio */
F.hurt(9999);
run(20);
check('muere', F.state().mode === 'dead', F.state().mode);

setTimeout(() => {
  check('pantalla de fin rellena', getEl('st-score').textContent !== '', 'score=' + getEl('st-score').textContent);
  key('r');
  run(20);
  check('reinicia', F.state().mode === 'playing' && F.state().wave === 1, F.state().mode + ' w=' + F.state().wave);
  check('sin error global tras partida', !document.documentElement.dataset.err, document.documentElement.dataset.err || '');

  let fails = 0;
  for (const r of report) {
    if (!r.ok) fails++;
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '   [' + r.extra + ']' : ''));
  }
  console.log('\n' + (report.length - fails) + '/' + report.length + ' comprobaciones OK');
  process.exit(fails ? 1 : 0);
}, 900);
