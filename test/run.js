#!/usr/bin/env node
// ABOUTME: Unit tests for the Air Temperature app: runs the shipping main.js and ext*.js in a Node vm with stubs of the watch globals.
// ABOUTME: Usage: node test/run.js; prints one line per check and exits non-zero if any check fails. Demo/debug run on variant.js builds.

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const VARIANT = require('./variant.js');

const APP = path.join(__dirname, '../src/air_temperature');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const EN = JSON.parse(read('en.json'));

// Built-in TXT_* tokens: take the real English strings from the Editor's build library when it is installed.
const BUILTIN = { TXT_CELSIUS: '°C', TXT_FAHRENHEIT: '°F' };
try {
  const tr = require(path.join(os.homedir(), '.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/ng/translations.js')).translations;
  for (const k of Object.keys(BUILTIN)) if (tr.get(k) && tr.get(k).get('en')) BUILTIN[k] = tr.get(k).get('en');
} catch (e) { /* fall back to the constants above */ }

// Same token substitution the build applies to main.js and ext*.js (no HTML escaping for scripts).
const tpl = (src) => src.replace(/{{\s*([A-Za-z_][\w]*)\s*}}/g, (m, k) => {
  if (k in EN) return EN[k];
  if (k in BUILTIN) return BUILTIN[k];
  throw new Error('unknown token ' + k);
});

let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log('  ok   ' + name); } else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
};
const near = (a, b, eps) => typeof a === 'number' && Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);
const eqArr = (a, b) => a && b && a.length === b.length && Array.prototype.every.call(a, (v, i) => v === b[i]);
const section = (name) => console.log('\n' + name);

// ---------- byte helpers ----------
const leFromCanonical = (s) => s.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16)).reverse();
const sig = (u) => leFromCanonical('0000' + u.toString(16).padStart(4, '0') + '-0000-1000-8000-00805F9B34FB');
const i32 = (v) => [v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255];
const i16 = (v) => [v & 255, v >> 8 & 255];
const hex = (s) => s.replace(/\s+/g, '').match(/../g).map((h) => parseInt(h, 16));
const ascii = (s) => s.split('').map((c) => c.charCodeAt(0));
const signed = (a) => a.map((b) => (b > 127 ? b - 256 : b));
const df5 = (t) => { const v = Math.round(t / 0.005); return [5, v >> 8 & 255, v & 255, 0x53, 0x94, 0xC3, 0x7C, 0, 4, 0xFF, 0xFC, 4, 0x0C, 0xAC, 0x36, 0x42, 0, 0xCD]; };

// ---------- watch simulation ----------
// Every character any boot() ever writes into each element, for the font check in T19.
const SEEN = {};
// opts: data (data.json overrides), zappId, connectRet, units, wrist, T (number or function), respond(fn, id, args) -> [ev, bytes] | null,
// throwOn(fn, id) -> true to make that appConn call throw (like "Duktape BLE API err 8"), variant ('demo', 'debug' or both:
// the files come from variant.js instead of the store source), shot (variant.js store-shot keys for the demo).
function boot(opts) {
  opts = opts || {};
  const files = opts.variant ? VARIANT.build(opts.variant, opts.shot) : null;
  const rd = (f) => (files ? files[f] : read(f));
  const has = (f) => (files ? f in files : fs.existsSync(path.join(APP, f)));
  // Most checks were written against the SensorPush profile, so boot() defaults to it; the shipped default is Auto (1).
  const data = Object.assign(JSON.parse(rd('data.json')), { sensor: '0' }, opts.data || {});
  const ui = { text: {}, style: {}, setText: 0, setStyle: 0, log: [] };
  const log = [];
  const queue = [];
  const conn = {
    calls: [], pending: null, violations: [], handler: null, linked: false,
    record(fn, args) { this.calls.push({ fn, args: Array.prototype.slice.call(args) }); },
  };
  const opCall = (fn, id, args, bytes) => {
    conn.record(fn, args);
    if (opts.throwOn && opts.throwOn(fn, id)) throw new Error('Duktape BLE API err 8');
    if (!conn.linked) conn.violations.push(fn + '(' + id + ') before event 100');
    if (conn.pending) conn.violations.push(fn + '(' + id + ') while ' + conn.pending.fn + '(' + conn.pending.id + ') pending');
    conn.pending = { fn, id };
    if (bytes && bytes.length > 20) conn.violations.push('write longer than 20 bytes');
    const r = (opts.respond || defaultRespond(opts))(fn, id, args);
    if (r) queue.push({ ch: id, ev: r[0], d: r[1], op: true });
  };
  const appConn = {
    connect(zid, handler, a, b) {
      conn.record('connect', arguments);
      if (opts.throwOn && opts.throwOn('connect')) throw new Error('Duktape BLE API err 2');
      conn.handler = handler;
      if (opts.autoLink !== false && opts.connectRet !== undefined) queue.push({ ch: 0, ev: 100 });
      return opts.connectRet;
    },
    regUuid(c, id, s, ch) { opCall('regUuid', id, arguments); },
    enaCharNotf(c, id) { opCall('enaCharNotf', id, arguments); },
    writeChar(c, id, b) { opCall('writeChar', id, arguments, b); },
    readChar(c, id) { opCall('readChar', id, arguments); },
  };
  // appConn only appears after onLoad, as in the simulator (onLoad touching it throws a ReferenceError there).
  const ctx = {
    enabledZappId: opts.zappId === undefined ? 3 : opts.zappId,
    setText(id, s) {
      ui.setText++;
      if (typeof s !== 'string' || !s.trim()) conn.violations.push('setText ' + id + ' with empty text');
      ui.text[id] = s;
      ui.log.push('text ' + id + ' ' + s);
      const set = SEEN[id] || (SEEN[id] = new Set());
      for (const ch of String(s)) set.add(ch);
    },
    setStyle(sel, p, v) {
      ui.setStyle++;
      if (typeof v !== 'string') conn.violations.push('setStyle ' + sel + ' ' + p + ' not a string');
      if (p === 'visibility' && !/^#(tg|tl|gg|hn|st|ti)( \*)?$/.test(sel)) conn.violations.push('visibility on ' + sel + ': not one of the switched divs');
      if (p === 'visibility' && / \*$/.test(sel)) {
        // The contents of a div ('#x *'): must follow the div's own call with the same value (reference doc pattern).
        if (ui.log[ui.log.length - 1] !== 'style ' + sel.slice(0, -2) + ' visibility ' + v) conn.violations.push('setStyle ' + sel + ' not right after its div');
        ui.log.push('style ' + sel + ' ' + p + ' ' + v);
        return;
      }
      ui.style[sel + ' ' + p] = v;
      // A wrapper div's visibility applies to its spans, which is what the screen readers below look at.
      for (const c of { '#tg': ['#t', '#u'], '#tl': ['#ar', '#tr'], '#gg': ['#g', '#v'] }[sel] || []) ui.style[c + ' ' + p] = v;
      ui.log.push('style ' + sel + ' ' + p + ' ' + v);
    },
    getStyle() { return undefined; },
    systemEvent() { log.push(Array.prototype.join.call(arguments, '')); },
    localStorage: { reads: 0, getItem(k) { this.reads++; return k in data ? data[k] : null; } },
    evalFile(p) {
      const f = p.replace('{file_path}/', '');
      if (!/^ext\d+\.js$/.test(f) || !has(f)) throw new Error('evalFile of ' + p);
      ctx.__loaded.push(f);
      return vm.runInContext('(' + tpl(rd(f)) + '\n)', ctx, { filename: f });
    },
    __loaded: [],
  };
  vm.createContext(ctx);
  // The watch runtime has no Date and documents only Int8Array, Uint8Array and Float32Array (plus DataView in examples).
  vm.runInContext('Date = undefined; Int16Array = undefined; Uint16Array = undefined; Int32Array = undefined; Uint32Array = undefined; Float64Array = undefined;', ctx);
  vm.runInContext(tpl(rd('main.js')), ctx, { filename: 'main.js' });
  const input = { units: opts.units === undefined ? 0 : opts.units, wrist: opts.wrist === undefined ? NaN : opts.wrist };
  const output = {};
  ctx.onLoad(input, output);
  ctx.appConn = appConn;
  const sim = {
    ctx, conn, ui, out: output, input, log, queue,
    // Deliver queued events (they arrive between ticks on the watch), then run one evaluate.
    tick(n) {
      for (let k = 0; k < (n || 1); k++) {
        const q = queue.splice(0, queue.length);
        for (const e of q) {
          if (e.op) conn.pending = null;
          if (e.ev === 100) conn.linked = true;
          if (e.ev === 101) { conn.linked = false; conn.pending = null; }
          conn.handler(e.ch, e.ev, e.d);
        }
        ui.log.push('tick');
        ctx.evaluate(input, output);
      }
      return sim;
    },
    emit(ch, ev, d) { queue.push({ ch, ev, d }); return sim; },
    count(fn, id) { return conn.calls.filter((c) => c.fn === fn && (id === undefined || c.args[1] === id)).length; },
    ids(fn) { return conn.calls.filter((c) => c.fn === fn).map((c) => c.args[1]).join(','); },
    // What the screen shows for one piece of information: '' for a hidden element (the state word while LIVE); #t, #u and
    // #tr read whichever group is visible, the bright one (#t #u #tr) or the grey one of a value that is not fresh (#g #v,
    // and the centred line #hn with the hint); the trend line '-1.7°/h  82% RH' is split into #tr (the trend, '--' when
    // there is none yet) and #rh ('82%', '--' when the visible line carries none); #mn and #mx without their label.
    // raw(id) is the visible line for #tr, else the element's own last text.
    text(id) {
      const grey = ui.style['#g visibility'] === 'VISIBLE';
      const line = (grey ? ui.text['#hn'] : ui.text['#tr']) || '';
      const hm = null;
      // Humidity is the top line ('43% RH'), shown while there is no state word.
      if (id === '#rh') { const r = /^(\d+)% RH$/.exec(ui.style['#ti visibility'] === 'VISIBLE' && ui.text['#ti'] || ''); return r ? r[1] + '%' : '--'; }
      if (grey && (id === '#t' || id === '#u' || id === '#tr')) id = { '#t': '#g', '#u': '#v', '#tr': '#hn' }[id];
      if (ui.style[id + ' visibility'] === 'HIDDEN') return '';
      if (id === '#mn' || id === '#mx') return ui.text[id].replace(/^\S+ /, '');
      return (id === '#tr' || id === '#hn') && hm ? line.slice(0, hm.index) || '--' : ui.text[id];
    },
    raw(id) { return id === '#tr' && ui.style['#g visibility'] === 'VISIBLE' ? ui.text['#hn'] : ui.text[id]; },
    dim() { return ui.style['#g visibility'] === 'VISIBLE' && ui.style['#t visibility'] === 'HIDDEN'; },
  };
  return sim;
}

// A default sensor: everything registers, notifications and writes succeed; SensorPush-style reads (1 T, 2 H, 3 battery).
const defaultRespond = (opts) => {
  const T = opts.T === undefined ? 21.5 : opts.T;
  return (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [109];
    if (fn === 'writeChar') return [104];
    if (fn === 'readChar') {
      if (id === 1) return [102, i32(Math.round((typeof T === 'function' ? T() : T) * 100))];
      if (id === 2) return [102, i32(4321)];
      if (id === 3) return [102, [0xA6, 0x0B, 0x2E, 0x09]];
      return [102, [0x57]];
    }
    return null;
  };
};

// A profile as the app sees it: the resident part ext<n>.js (label, timing, setup state, parser) merged with its table file
// ext<n + 8>.js (connect params as s1/s2, UUID bases u, candidates c), which main.js and ext13.js load only while needed.
const extFn = (f) => vm.runInContext('(' + tpl(read(f)) + '\n)', vm.createContext({}));
const profile = (n, G) => {
  const p = extFn('ext' + n + '.js')();
  const t = extFn('ext' + (n + 8) + '.js')(G || { a: 0, b: 0 });
  return Object.assign(p, { s1: t.a, s2: t.b, u: t.u, c: t.c });
};
const parse = (prof, role, bytes) => {
  const o = [NaN, NaN, NaN, 0];
  const r = prof.p(role, bytes, o);
  return { r, t: o[0], h: o[1], b: o[2], bk: o[3] };
};
const mkUuid = (prof, b, x, y) => { const a = prof.u[b].slice(0); a[12] = x; a[13] = y; return a; };
const candArrays = (prof, c) => (c[8] === 2 ? [[c[3], c[4]], [c[6], c[7]]] : [mkUuid(prof, c[2], c[3], c[4]), mkUuid(prof, c[5], c[6], c[7])]);

// =====================================================================
section('T1 UUIDs, candidates and search params');
{
  const SPS = 'EF090000-11D6-42BA-93B8-9DD7EC090AB0';
  const SPC = (x) => 'EF0900' + x + '-11D6-42BA-93B8-9DD7EC090AA9';
  const MI = (x) => 'ebe0cc' + x + '-7a0a-4b0c-8a1a-6ff2997da3a6';
  const NUS = (x) => '6E4000' + x + '-B5A3-F393-E0A9-E50E24DCCA9E';
  // [id, role, service, characteristic, form]; numbers are 16-bit SIG UUIDs.
  const expect = {
    1: { s1: [7].concat(leFromCanonical(SPS)), s2: [6].concat(leFromCanonical(SPS)), c: [
      [1, 1, SPS, SPC('80'), 0], [2, 3, SPS, SPC('81'), 0], [3, 4, SPS, SPC('07'), 0], [4, 7, SPS, SPC('0C'), 0]] },
    // Auto: the Xiaomi name first (proven on the Race S), the ESS service list second (a match only if the watch ORs sp2).
    2: { s1: [9].concat(ascii('LYWSD03MMC')), s2: [3, 0x1A, 0x18], c: [
      [1, 6, MI('b0'), MI('c1'), 0],
      [5, 1, 0x181A, 0x2A6E, 2], [6, 1, 0x181A, 0x2A6E, 16], [7, 3, 0x181A, 0x2A6F, 2], [8, 3, 0x181A, 0x2A6F, 16],
      [9, 5, 0x180F, 0x2A19, 2], [10, 5, 0x180F, 0x2A19, 16]] },
    3: { s1: [255, 0x99, 0x04], s2: [255, 0x99, 0x04], c: [[1, 6, NUS('01'), NUS('03'), 0]] },
    4: { s1: [3, 0x1A, 0x18], s2: [2, 0x1A, 0x18], c: [
      [1, 1, 0x181A, 0x2A6E, 2], [2, 1, 0x181A, 0x2A6E, 16], [3, 2, 0x181A, 0x2A1F, 2], [4, 2, 0x181A, 0x2A1F, 16],
      [5, 3, 0x181A, 0x2A6F, 2], [6, 3, 0x181A, 0x2A6F, 16], [7, 5, 0x180F, 0x2A19, 2], [8, 5, 0x180F, 0x2A19, 16]] },
  };
  const toLE = (u, form) => (typeof u !== 'number' ? leFromCanonical(u) : form === 2 ? [u & 255, u >> 8] : sig(u));
  for (const n of [1, 2, 3, 4]) {
    const p = profile(n);
    const e = expect[n];
    ok(eqArr(p.s1, e.s1) && eqArr(p.s2, e.s2), 'ext' + n + ' search params', JSON.stringify([p.s1, p.s2]));
    // Equally specific everywhere except Auto (2), whose broader second filter is the point (SPEC 22.18).
    ok(p.s1.length <= 17 && p.s2.length <= 17 && (n === 2 || p.s1.length === p.s2.length) && p.s1[0] !== 0x16 && p.s2[0] !== 0x16, 'ext' + n + ' params: <= 16 bytes after the type byte, equally specific (except Auto), no Service Data');
    ok(p.c.length === e.c.length, 'ext' + n + ' candidate count', p.c.length);
    const ids = {};
    p.c.forEach((c, i) => {
      const w = e.c[i];
      const arr = candArrays(p, c);
      ok(c[0] === w[0] && c[1] === w[1] && c[8] === w[4] && eqArr(arr[0], toLE(w[2], w[4])) && eqArr(arr[1], toLE(w[3], w[4])),
        'ext' + n + ' candidate ' + c[0] + ' (role ' + c[1] + ', form ' + c[8] + ') UUIDs');
      ok(ids[c[0]] === undefined && c[0] > 0 && c[0] < 16, 'ext' + n + ' candidate id ' + c[0] + ' unique and fits the 16-slot map');
      ids[c[0]] = 1;
    });
    ok(p.rg === 0 && p.ld === 0 && p.t === 0 && p.h === 0, 'ext' + n + ' declares its setup state (no property is added at run time)');
    ok(p.c.every((c, i) => i === 0 || c[0] > p.c[i - 1][0]), 'ext' + (n + 8) + ' candidate ids ascend (ext7 walks rc in id order = preference order)');
    const res = extFn('ext' + n + '.js')();
    ok(['a', 'b', 'u', 'c', 's1', 's2'].every((k) => !(k in res)) && res.p.prototype === null,
      'ext' + n + ' (resident) holds no UUID table or connect params, and its parser has no prototype object', Object.keys(res).join());
  }
  const sp = profile(1);
  ok(sp.c.every((c) => mkUuid(sp, c[5], c[6], c[7]).join() !== leFromCanonical(SPC('01')).join()), 'SensorPush never touches Device ID EF090001');
  ok(eqArr(sp.tw, [1, 0, 0, 0]) && eqArr(sp.lw, [3]), 'SensorPush trigger and LED payloads');
}

// =====================================================================
section('T2 parsers (vectors from the vendors and the SIG, malformed and signed input)');
{
  const sp = profile(1);
  let r = parse(sp, 1, [0x0A, 0x09, 0, 0]); ok(near(r.t, 23.14), 'SP T 23.14', r.t);
  r = parse(sp, 1, [0x2E, 0xFB, 0xFF, 0xFF]); ok(near(r.t, -12.34), 'SP T -12.34', r.t);
  r = parse(sp, 1, signed([0x2E, 0xFB, 0xFF, 0xFF])); ok(near(r.t, -12.34), 'SP T -12.34 from signed bytes', r.t);
  r = parse(sp, 3, [0xD7, 0x11, 0, 0]); ok(near(r.h, 45.67) && r.t !== r.t, 'SP H 45.67', r.h);
  r = parse(sp, 4, [0xA6, 0x0B, 0x2E, 0x09]); ok(r.b === 2982 && r.bk === 0, 'SP battery 2982 mV', r.b);
  r = parse(sp, 4, [0, 0, 0, 0]); ok(r.r === 1 && r.b !== r.b, 'SP battery 0 is invalid');
  r = parse(sp, 1, [0x0A, 0x09, 0]); ok(r.r === 0 && r.t !== r.t, 'SP short frame rejected');
  r = parse(sp, 1, [0x0A, 0x09, 0, 0, 0x55, 0x66]); ok(near(r.t, 23.14), 'SP longer frame uses the first 4 bytes');

  const mi = profile(2);
  r = parse(mi, 6, [0x1E, 0x09, 0x37, 0x7B, 0x0B]); ok(near(r.t, 23.34) && r.h === 55 && r.b === 2939 && r.bk === 0, 'Xiaomi stock 23.34 C 55 % 2939 mV', JSON.stringify(r));
  r = parse(mi, 6, signed([0x0C, 0xFE, 0x50, 0x7B, 0x0B])); ok(near(r.t, -5) && r.h === 80, 'Xiaomi stock -5.00 C from signed bytes', JSON.stringify(r));
  r = parse(mi, 6, [0x1E, 0x09, 0x37, 0x7B]); ok(r.r === 0, 'Xiaomi stock 4-byte frame rejected');
  r = parse(mi, 1, [0x8A, 0x09]); ok(near(r.t, 24.42), 'Xiaomi pvvx 0x2A6E 24.42', r.t);
  r = parse(mi, 3, [0x10, 0x17]); ok(near(r.h, 59.04), 'Xiaomi pvvx 0x2A6F 59.04', r.h);
  r = parse(mi, 5, [0x57]); ok(r.b === 87 && r.bk === 1, 'Xiaomi pvvx battery 87 %');

  const es = profile(4);
  r = parse(es, 1, [0x8A, 0x09]); ok(near(r.t, 24.42), 'ESS 0x2A6E 24.42', r.t);
  r = parse(es, 1, [0x0C, 0xFE]); ok(near(r.t, -5), 'ESS 0x2A6E -5.00', r.t);
  r = parse(es, 1, signed([0x0C, 0xFE])); ok(near(r.t, -5), 'ESS 0x2A6E -5.00 from signed bytes', r.t);
  r = parse(es, 1, [0x00, 0x80]); ok(r.r === 1 && r.t !== r.t, 'ESS 0x8000 is invalid');
  r = parse(es, 3, [0x10, 0x17]); ok(near(r.h, 59.04), 'ESS humidity 59.04', r.h);
  r = parse(es, 3, [0xFF, 0xFF]); ok(r.h !== r.h, 'ESS humidity 0xFFFF is invalid');
  r = parse(es, 3, signed([0xFF, 0xFF])); ok(r.h !== r.h, 'ESS humidity 0xFFFF invalid also as signed bytes');
  r = parse(es, 2, [0xF4, 0x00]); ok(near(r.t, 24.4), 'ESS 0x2A1F 24.4', r.t);
  r = parse(es, 2, [0x9C, 0xFF]); ok(near(r.t, -10), 'ESS 0x2A1F -10.0', r.t);
  r = parse(es, 5, [0x57]); ok(r.b === 87 && r.bk === 1, 'BAS 87 %');
  r = parse(es, 5, [0x65]); ok(r.b !== r.b, 'BAS 101 % ignored');
  r = parse(es, 1, [0x8A]); ok(r.r === 0, 'ESS 1-byte frame rejected');
  r = parse(es, 5, []); ok(r.r === 0, 'BAS empty frame rejected');

  // Ruuvi DF5 vectors from docs.ruuvi.com (first 18 bytes, as sent by the 3.x heartbeat).
  const ru = profile(3);
  r = parse(ru, 6, hex('05 12FC 5394 C37C 0004 FFFC 040C AC36 42 00CD'));
  ok(near(r.t, 24.3) && near(r.h, 53.49) && r.b === 2977, 'Ruuvi valid vector 24.3 C 53.49 % 2977 mV', JSON.stringify(r));
  r = parse(ru, 6, signed(hex('05 12FC 5394 C37C 0004 FFFC 040C AC36 42 00CD')));
  ok(near(r.t, 24.3) && near(r.h, 53.49) && r.b === 2977, 'Ruuvi valid vector from signed bytes');
  r = parse(ru, 6, hex('05 7FFF FFFE FFFE 7FFF 7FFF 7FFF FFDE FE FFFE'));
  ok(near(r.t, 163.835) && near(r.h, 163.835) && r.b === 3646, 'Ruuvi max vector', JSON.stringify(r));
  r = parse(ru, 6, hex('05 8001 0000 0000 8001 8001 8001 0000 00 0000'));
  ok(near(r.t, -163.835) && r.h === 0 && r.b === 1600, 'Ruuvi min vector', JSON.stringify(r));
  r = parse(ru, 6, hex('05 8000 FFFF FFFF 8000 8000 8000 FFFF FF FFFF'));
  ok(r.r === 1 && r.t !== r.t && r.h !== r.h && r.b !== r.b, 'Ruuvi invalid vector: all values invalid', JSON.stringify(r));
  r = parse(ru, 6, hex('05 12FC 5394 C37C 0004 FFFC 040C AC36 42 00CD CBB8334C884F'));
  ok(near(r.t, 24.3), 'Ruuvi full 24-byte DF5 accepted');
  r = parse(ru, 6, hex('03 29 1A 1E CE 1E FC 18 F9 42 02 CA 0B 53'));
  ok(r.r === 0, 'Ruuvi data format 3 ignored');
  r = parse(ru, 6, hex('05 12FC 5394 C37C 0004 FFFC 040C AC'));
  ok(r.r === 0, 'Ruuvi truncated frame (14 bytes) ignored');
}

// =====================================================================
section('T3 SensorPush happy path');
{
  const s = boot({ connectRet: 5, T: 23.14 });
  s.tick(1);
  const c = s.conn.calls[0];
  ok(c.fn === 'connect' && c.args[0] === 3 && eqArr(c.args[2], profile(1).s1) && eqArr(c.args[3], profile(1).s2), 'connect with zapp id and both SensorPush params');
  ok(s.out.con === 0, 'con stays 0 while connecting');
  s.tick(5);
  ok(s.ids('regUuid') === '1,2,3,4', 'regUuid order 1,2,3,4', s.ids('regUuid'));
  const regs = s.conn.calls.filter((x) => x.fn === 'regUuid');
  ok(regs.every((x) => x.args[0] === 5), 'regUuid uses the connection id');
  ok(eqArr(regs[0].args[2], leFromCanonical('EF090000-11D6-42BA-93B8-9DD7EC090AB0')) && eqArr(regs[0].args[3], leFromCanonical('EF090080-11D6-42BA-93B8-9DD7EC090AA9')), 'temperature char arrays');
  s.tick(6);
  const seq = s.conn.calls.filter((x) => x.fn !== 'connect' && x.fn !== 'regUuid').map((x) => x.fn + x.args[1] + (x.args[2] ? '[' + x.args[2].join(',') + ']' : ''));
  ok(seq.slice(0, 5).join(' ') === 'readChar3 writeChar4[3] writeChar1[1,0,0,0] readChar1 readChar2', 'battery, LED, trigger, read T, read H', seq.join(' '));
  ok(s.out.con === 1, 'con = 1 after the first good read');
  ok(near(s.ctx.tC, 23.14) && near(s.ctx.rh, 43.21) && s.ctx.bat === 2982, 'values taken', [s.ctx.tC, s.ctx.rh, s.ctx.bat].join());
  ok(near(s.out.airT, 23.14 + 273.15, 1e-9) && near(s.out.rh, 43.21), 'outputs airT in K and rh in %');
  ok(s.text('#t') === '23.1' && s.text('#rh') === '43%' && s.text('#st') === '' && !s.dim(), 'screen shows 23.1 (bright), 43 %, no state word while LIVE', [s.text('#t'), s.text('#rh'), s.text('#st')].join('|'));
  ok(s.raw('#tr') === '--°/h' && s.ui.style['#st visibility'] === 'HIDDEN' && s.ui.style['#ti visibility'] === 'VISIBLE' && s.ui.text['#ti'] === '43% RH', 'humidity on the top line, trend "--°/h" until there are enough samples; state word hidden', s.raw('#tr') + ' ' + s.ui.text['#ti']);
  ok(!('#sn' in s.ui.text) && !('#rh' in s.ui.text) && s.ui.style['#st visibility'] === 'HIDDEN', 'no sensor row, no separate humidity element; a fine battery (2.98 V) shows nothing');
  const before = s.count('writeChar', 1);
  s.tick(40);
  const writes = s.count('writeChar', 1) - before;
  ok(writes >= 3 && writes <= 4, 'poll period about 10 s (default setting)', writes);
  ok(s.count('writeChar', 4) === 1, 'LED blinked exactly once');
  ok(s.conn.violations.length === 0, 'one op in flight, nothing before 100, no oversize writes, no empty setText', s.conn.violations.join('; '));
  // The poll timer restarts when a cycle completes (3 ticks), so the period is P + 3 s.
  const s60 = boot({ connectRet: 5, data: { poll: '3' } }).tick(140);
  ok(s60.count('writeChar', 1) === 3, 'poll setting 60 s gives 3 cycles in 140 s', s60.count('writeChar', 1));
  const s5 = boot({ connectRet: 5, data: { poll: '0' } }).tick(60);
  ok(s5.count('writeChar', 1) >= 7 && s5.conn.violations.length === 0, '5 s poll: about every 8 s, never a second op in flight', s5.count('writeChar', 1));
}

// =====================================================================
section('T4 reconnect and lost link');
{
  const s = boot({ connectRet: 5 }).tick(20);
  const regs = s.count('regUuid');
  s.emit(0, 101).tick(1);
  ok(s.out.con === 0 && s.ctx.st === 5 && s.ctx.op === 0, '101: con 0, op cleared');
  ok(/^LOST \ds$/.test(s.text('#st')), 'LOST with seconds under a minute ("1s")', s.text('#st'));
  ok(s.out.airT === undefined && s.text('#t') === '21.5' && s.dim(), 'values stale at once: outputs undefined; the number stays for now, greyed');
  ok(s.text('#tr') === EN.h5, 'line under the number says reconnecting', s.text('#tr'));
  const calls = s.conn.calls.length;
  s.tick(5);
  ok(s.conn.calls.length === calls, 'no BLE calls while disconnected');
  const reads = s.count('readChar', 3);
  s.emit(0, 100).tick(4);
  ok(s.count('regUuid') === regs, 'no regUuid after reconnect (registration is local and kept)');
  ok(s.count('readChar', 3) === reads + 1, 'battery read again after reconnect');
  ok(s.count('writeChar', 4) === 1, 'LED not blinked again');
  ok(s.ctx.st === 4 && s.out.con === 1 && s.text('#st') === '' && !s.dim(), 'polling resumes and LIVE again (no state word, bright number)', s.text('#st'));
  ok(s.conn.violations.length === 0, 'no call before 100 and one op in flight across the reconnect', s.conn.violations.join('; '));
  // Notify profile: enaCharNotf again on the first tick after 100.
  const r = boot({ connectRet: 5, data: { sensor: '2' } }).tick(8);
  const n = r.count('enaCharNotf');
  r.emit(0, 101).tick(3).emit(0, 100).tick(1);
  ok(r.count('enaCharNotf') === n + 1, 'Ruuvi notifications re-enabled on the first tick after 100', r.count('enaCharNotf') - n);
  // Lost for 2 minutes: red, and the hint row suggests restarting.
  const l = boot({ connectRet: 5 }).tick(15).emit(0, 101).tick(119);
  ok(/^LOST 1:5\d$/.test(l.text('#st')) && l.text('#t') === '21.5', 'LOST before 2 minutes: the last value is still shown', l.text('#st'));
  l.tick(2);
  ok(/^LOST 2:0\d$/.test(l.text('#st')) && l.text('#t') === '--', 'LOST after 2 minutes: the number becomes --', l.text('#st') + ' ' + l.text('#t'));
  const lh = new Set();
  for (let i = 0; i < 9; i++) { l.tick(1); lh.add(l.text('#tr')); }
  ok(lh.size === 2 && lh.has(EN.h1) && lh.has(EN.h6), 'before any exercise: alternates "bring close" and "reselect the app"', [...lh].join('|'));
  l.ctx.onExerciseStart();
  lh.clear();
  for (let i = 0; i < 9; i++) { l.tick(1); lh.add(l.text('#tr')); }
  ok(lh.size === 2 && lh.has(EN.h1) && lh.has(EN.h4), 'during an exercise: alternates "bring close" and "restart exercise"', [...lh].join('|'));
  // A 112 in the same tick as a 101 must not hide the 101.
  const lk = boot({ connectRet: 5 }).tick(20);
  lk.emit(0, 101).emit(0, 112).tick(1);
  ok(lk.ctx.st === 5 && lk.out.con === 0 && /^LOST/.test(lk.text('#st')), '101 + 112 in one tick: still LOST', lk.ctx.st);
  const callsLk = lk.conn.calls.length;
  lk.tick(30);
  ok(lk.conn.calls.length === callsLk, '... and no GATT calls on the dead link', lk.conn.calls.length - callsLk);
  const ok100 = boot({ connectRet: 5 }).tick(20).emit(0, 101).tick(2);
  ok100.emit(0, 100).emit(0, 112).tick(5);
  ok(ok100.ctx.st === 4, '100 + 112 in one tick: setup still runs', ok100.ctx.st);
}

section('T4b link lost during first registration');
{
  // A firmware that refuses a second registration of the same id (108), the worst case for re-registering.
  const strict = (base) => {
    const done = {};
    return (fn, id, args) => {
      if (fn === 'regUuid') { if (done[id]) return [108]; done[id] = 1; return [107]; }
      return base(fn, id, args);
    };
  };
  // SensorPush: the link drops while regUuid(1) is in flight, so its answer is lost.
  const sp = boot({ connectRet: 5, respond: strict(defaultRespond({})) }).tick(2);
  ok(sp.ids('regUuid') === '1', 'regUuid(1) in flight', sp.ids('regUuid'));
  sp.emit(0, 101).tick(2).emit(0, 100).tick(20);
  ok(sp.ids('regUuid') === '1,2,3,4', 'resumes after the last sent candidate: every id registered once', sp.ids('regUuid'));
  ok(sp.ctx.st === 4 && sp.ctx.has === 1 && sp.text('#st') === '', 'temperature id kept (answer lost, data decides): LIVE', sp.text('#st'));
  // ESS: the link drops after 4 of 8 registrations.
  const es = boot({ connectRet: 5, data: { sensor: '3' }, respond: strict((fn, id) => (fn === 'enaCharNotf' ? [id % 2 ? 110 : 109] : fn === 'readChar' ? [103] : null)) }).tick(5);
  es.emit(0, 101).tick(3).emit(0, 100).tick(20);
  ok(es.ids('regUuid') === '1,2,3,4,5,6,7,8', 'ESS: each of the 8 ids registered exactly once across the drop', es.ids('regUuid'));
  ok(es.ctx.st === 4 && Array.from(es.ctx.rc).slice(1, 9).every((v) => v > 0) && es.ctx.prof.h === 6,
    'ESS: setup completes with all 8 candidates kept, not WRONG SENSOR', [es.ctx.st, Array.from(es.ctx.rc).join('')].join(' '));
  // The drop hits while the last candidate is in flight: the next link still picks the T and H ids.
  const last = boot({ connectRet: 5, respond: strict(defaultRespond({})) }).tick(5);
  ok(last.ids('regUuid') === '1,2,3,4', 'all four sent', last.ids('regUuid'));
  last.emit(0, 101).tick(2).emit(0, 100).tick(20);
  ok(last.ids('regUuid') === '1,2,3,4' && last.ctx.prof.t === 1 && last.ctx.prof.h === 2 && last.ctx.has === 1, 'drop on the last candidate: ids chosen on the next link, data flows', [last.ctx.prof.t, last.ctx.prof.h].join());
  ok(sp.conn.violations.length === 0 && es.conn.violations.length === 0 && last.conn.violations.length === 0, 'no call before 100 and one op in flight', sp.conn.violations.concat(es.conn.violations).join('; '));
}

// =====================================================================
section('T5 Xiaomi: every candidate registered, data decides');
{
  const stock = boot({ connectRet: 5, data: { sensor: '1' }, respond: (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [id === 1 ? 109 : 110];
    if (fn === 'readChar') return [103];
    return null;
  } }).tick(16);
  ok(stock.ids('regUuid') === '1,5,6,7,8,9,10', 'all seven candidates registered (107 is only local)', stock.ids('regUuid'));
  ok(stock.ids('enaCharNotf') === '1,5,6,7,8', 'notifications enabled on the frame, T and H candidates', stock.ids('enaCharNotf'));
  ok(stock.ids('readChar').indexOf('9,10') === 0, 'battery read on both forms', stock.ids('readChar'));
  ok(stock.ctx.prof.t === 1, 'the frame char that accepted notifications is preferred', stock.ctx.prof.t);
  stock.emit(1, 106, [0x1E, 0x09, 0x37, 0x7B, 0x0B]).tick(1);
  ok(near(stock.ctx.tC, 23.34) && stock.ctx.rh === 55 && stock.ctx.bat === 2939, 'stock frame parsed');
  ok(stock.text('#st') === '', 'stock battery 2.94 V is fine: no state word', stock.text('#st'));
  ok(stock.conn.violations.length === 0, 'one op in flight throughout', stock.conn.violations.join('; '));
  // pvvx/ATC: the custom char registers locally but never delivers; the ESS candidates do.
  const pv = boot({ connectRet: 5, data: { sensor: '1' }, respond: (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [id === 1 || id % 2 ? 110 : 109];
    if (fn === 'readChar') return [102, [0x5A]];
    return null;
  } }).tick(16);
  ok(pv.ctx.prof.t === 6 && pv.ctx.prof.h === 8, 'the expanded-form T and H that accepted notifications are preferred', [pv.ctx.prof.t, pv.ctx.prof.h].join());
  pv.emit(6, 106, [0x8A, 0x09]).emit(8, 106, [0x10, 0x17]).tick(1);
  ok(near(pv.ctx.tC, 24.42) && near(pv.ctx.rh, 59.04), 'pvvx frames parsed');
  ok(pv.ctx.bat === -91 && pv.text('#st') === '', 'percent battery stored as -1 - p; 90 % shows nothing', pv.text('#st'));
  pv.emit(6, 115, [0x00, 0x0A]).tick(1);
  ok(near(pv.ctx.tC, 25.6), 'event 115 (indication) handled like 106');
}

// =====================================================================
section('T6 ESS: both UUID forms, read fallback');
{
  const silent = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [id % 2 ? 110 : 109];
    if (fn === 'readChar') return id === 2 ? [102, [0x8A, 0x09]] : id === 6 ? [102, [0x10, 0x17]] : id === 8 ? [102, [0x40]] : [103];
    return null;
  } }).tick(17);
  ok(silent.ids('regUuid') === '1,2,3,4,5,6,7,8', 'eight candidates registered', silent.ids('regUuid'));
  ok(silent.ids('enaCharNotf') === '1,2,3,4,5,6', 'notifications tried on both forms of T, T1 and H', silent.ids('enaCharNotf'));
  ok(silent.ctx.prof.t === 2 && silent.ctx.prof.h === 6, '0x2A6E (preferred over 0x2A1F) in the form that accepted', [silent.ctx.prof.t, silent.ctx.prof.h].join());
  ok(silent.count('readChar', 2) === 0, 'no polling while notifications may still come');
  silent.tick(11);
  ok(silent.count('readChar', 2) === 1 && silent.count('readChar', 6) === 1, 'no data 10 s after setup -> read T and H', silent.count('readChar', 2));
  ok(near(silent.ctx.tC, 24.42) && near(silent.ctx.rh, 59.04), 'read fallback data accepted');
  silent.tick(36);
  ok(silent.count('readChar', 2) >= 4 && silent.count('readChar', 2) <= 5, 'fallback reads every P = 10 s (+ the 2-tick cycle)', silent.count('readChar', 2));
  silent.emit(2, 106, [0x00, 0x0A]).tick(1);
  const after = silent.count('readChar', 2);
  silent.tick(20);
  ok(silent.count('readChar', 2) === after, 'notifications arrived: polling stops while they keep coming');
  silent.tick(10);
  ok(silent.count('readChar', 2) === after + 1, 'notifications stop for 25 s (interval 20 + 5) -> reads resume', silent.count('readChar', 2) - after);
  // A sensor that only exposes the legacy 0x2A1F.
  const legacy = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn, id) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [id === 3 || id === 4 ? 109 : 110] : fn === 'readChar' ? [103] : null) }).tick(17);
  ok(legacy.ctx.prof.t === 3, 'only 0x2A1F accepts notifications -> it is preferred', legacy.ctx.prof.t);
  legacy.emit(4, 106, [0xF4, 0x00]).tick(1);
  ok(near(legacy.ctx.tC, 24.4) && legacy.ctx.prof.t === 4, '0x2A1F frames parsed x 0.1, and the delivering id is kept', legacy.ctx.prof.t);
  // A read-only sensor (no notifications at all) that exposes only the legacy 0x2A1F, in the expanded form, and humidity
  // only in the expanded form: the failed fallback reads move on until an id answers.
  const ro = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [110];
    if (fn === 'readChar') return id === 4 ? [102, [0xF4, 0x00]] : id === 6 ? [102, [0x10, 0x17]] : [103];
    return null;
  } }).tick(16);
  ok(ro.ctx.prof.t === 1 && ro.ctx.has === 0, 'read-only: starts on the first T id with no data', ro.ctx.prof.t);
  ro.tick(60);
  ok(ro.ctx.has === 1 && near(ro.ctx.tC, 24.4) && ro.ctx.prof.t === 4, 'read-only legacy 0x2A1F found by rotating the read id', [ro.ctx.prof.t, ro.ctx.tC].join());
  ro.tick(40);
  ok(near(ro.ctx.rh, 59.04) && ro.ctx.prof.h === 6, 'humidity read id rotates too', [ro.ctx.prof.h, ro.ctx.rh].join());
  ok(ro.count('readChar', 4) >= 3 && ro.text('#st') === '' && ro.out.con === 1, 'then it stays on the id that answers: LIVE', ro.count('readChar', 4));
  ok(ro.conn.violations.length === 0, 'one op in flight throughout', ro.conn.violations.join('; '));
  ok(ro.ctx.__loaded.filter((f) => f === 'ext15.js').length === 1 && typeof ro.ctx.prof.r === 'function' && ro.ctx.prof.r.prototype === null,
    'the rotation (ext15.js) is loaded on the first failed read only and kept', ro.ctx.__loaded.join());
  // Every T id fails: the rotation wraps around and never hangs.
  const none = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [110] : fn === 'readChar' ? [103] : null) }).tick(200);
  ok(none.ctx.st === 4 && [1, 2, 3, 4].indexOf(none.ctx.prof.t) >= 0 && /^NO DATA/.test(none.text('#st')), 'nothing readable: cycles T ids, NO DATA', none.ctx.prof.t + ' ' + none.text('#st'));
  ok(none.ctx.__loaded.filter((f) => f === 'ext15.js').length === 1, 'nothing readable for 200 s: ext15.js still compiled only once', none.ctx.__loaded.filter((f) => f === 'ext15.js').length);
  const sp15 = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && id === 1 ? [103] : defaultRespond({})(fn, id)) }).tick(60);
  ok(sp15.ctx.__loaded.indexOf('ext15.js') < 0 && sp15.ctx.prof.r === undefined, 'SensorPush (poll profile): failed reads never load the rotation');
}

// =====================================================================
section('T7 Ruuvi');
{
  const r = boot({ connectRet: 5, data: { sensor: '2' } });
  r.tick(1);
  let t = 1;
  while (r.count('enaCharNotf') === 0 && t < 12) { r.tick(1); t++; }
  ok(t <= 4, 'enaCharNotf within 4 ticks of connect (12 s reboot deadline)', t);
  r.tick(2);
  r.emit(1, 106, hex('05 12FC 5394 C37C 0004 FFFC 040C AC36 42 00CD')).tick(1);
  ok(near(r.ctx.tC, 24.3) && near(r.ctx.rh, 53.49) && r.ctx.bat === 2977, 'DF5 heartbeat parsed');
  r.emit(1, 106, hex('03 29 1A 1E CE 1E FC 18 F9 42 02 CA 0B 53 00 00 00 00')).tick(1);
  ok(near(r.ctx.tC, 24.3), 'non-DF5 frame ignored');
  r.tick(40);
  ok(r.count('readChar', 1) === 0, 'Ruuvi is never polled');
  const twice = boot({ connectRet: 5, data: { sensor: '2' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [110] : null) }).tick(8);
  ok(twice.count('enaCharNotf', 1) === 2, 'enable failure (110) -> one retry', twice.count('enaCharNotf', 1));
  twice.tick(40);
  ok(twice.text('#st').indexOf(EN.stNoData) === 0 && [EN.h1, EN.h2, EN.h3].indexOf(twice.text('#tr')) >= 0, 'no notifications -> NO DATA with hints', twice.text('#st'));
}

// =====================================================================
section('T8 wrong sensor, timeouts and thrown BLE errors');
{
  const w = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [108] : null) }).tick(12);
  ok(w.ctx.st === 6 && w.out.con === 3, 'every candidate refused (108) -> WRONG, con 3');
  ok(w.text('#st') === EN.stWrong, 'WRONG SENSOR');
  ok([EN.h1, EN.h2, EN.h3].indexOf(w.text('#tr')) >= 0, 'hint shown under the number', w.text('#tr'));
  ok(w.count('regUuid') === 8, 'all eight candidates tried', w.count('regUuid'));
  // A timeout (like a throw) is retried once per candidate; a refusal (108, above) is not.
  const timeout = boot({ connectRet: 5, respond: () => null }).tick(60);
  ok(timeout.ctx.st === 6 && timeout.ids('regUuid') === '1,1,2,2,3,3,4,4', 'regUuid with no answer: 5-tick timeout, one retry each, then WRONG', timeout.ids('regUuid'));
  const thrower = boot({ connectRet: 5, throwOn: (fn, id) => fn === 'readChar' && id === 3 });
  let err = null;
  try { thrower.tick(30); } catch (e) { err = e; }
  ok(!err && thrower.ctx.st === 4 && thrower.ctx.has === 1, 'a throwing appConn call is caught and the app carries on', err && err.message);
  const cthrow = boot({ connectRet: 5, throwOn: (fn) => fn === 'connect' });
  err = null;
  try { cthrow.tick(3); } catch (e) { err = e; }
  ok(!err && cthrow.ctx.st === 7 && cthrow.text('#st') === EN.stFail && cthrow.out.con === 3, 'a throwing connect is caught -> BT ERROR, Searching closed', err && err.message);
  const late = boot({ connectRet: 5, autoLink: false }).tick(59);
  ok(late.out.con === 0 && late.count('regUuid') === 0, 'no 100: nothing but connect, con 0 for 59 s');
  late.tick(1);
  ok(late.out.con === 3 && late.text('#st') === EN.stSearch, 'after 60 s con 3 closes Searching; still SEARCHING with hints', late.text('#st'));
  late.emit(0, 112).tick(30);
  ok(late.count('connect') === 2, '112 -> connect retried after 30 s', late.count('connect'));
  // Never trapped in Searching (SPEC 0.8, 12): linked but no good sample, setup never finished, or a drop with no reconnect.
  const fail103 = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && id === 1 ? [103] : defaultRespond({})(fn, id)) }).tick(60);
  ok(fail103.out.con === 1 && fail103.ctx.st === 4 && /^NO DATA|CONNECTING/.test(fail103.text('#st')), 'SensorPush linked, T reads fail: con 1 from the link (closes Searching), screen keeps explaining', fail103.out.con + ' ' + fail103.text('#st'));
  const bad = boot({ connectRet: 5, T: 500 }).tick(60);
  ok(bad.out.con === 1, 'implausible T only: con 1 from the link', bad.out.con);
  const silent = boot({ connectRet: 5, respond: (fn) => (fn === 'regUuid' ? [107] : null) }).tick(60);
  ok(silent.out.con === 1, 'GATT calls never answered: con 1 from the link', silent.out.con);
  const drop = boot({ connectRet: 5 }).tick(3).emit(0, 101).tick(56);
  ok(drop.out.con === 0 && drop.ctx.st === 5, 'drop during setup, no reconnect: con 0 after the 101');
  drop.tick(1);
  ok(drop.out.con === 0 && /^LOST/.test(drop.text('#st')), 'drop during setup, no reconnect: con stays 0 (it was 1 on the link), LOST', drop.out.con);
  // Controls: a notify profile closes Searching at setup end; once con was non-zero a 101 sets 0 as in the template.
  const ess = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [109] : fn === 'readChar' ? [103] : null) }).tick(20);
  ok(ess.out.con === 1, 'ESS linked, no data yet: con 1 at setup end', ess.out.con);
  ess.emit(0, 101).tick(100);
  ok(ess.out.con === 0, 'after a 101 (con was non-zero before) con stays 0 like the template', ess.out.con);
  const sp = boot({ connectRet: 5 }).tick(30);
  ok(sp.out.con === 1, 'SensorPush with data: con 1 (not 3) at 60 s', sp.tick(40).out.con);
  // Hints follow the state.
  ok(w.text('#tr') === EN.h3, 'WRONG SENSOR: only "Check Sensor setting"', w.text('#tr'));
  w.tick(8);
  ok(w.text('#tr') === EN.h3, '... and it stays', w.text('#tr'));
  cthrow.tick(9);
  ok(cthrow.text('#tr') === EN.h6, 'BT ERROR before any exercise: "Reselect the app"', cthrow.text('#tr'));
  cthrow.ctx.onExerciseStart();
  cthrow.tick(1);
  ok(cthrow.text('#tr') === EN.h4, 'BT ERROR during an exercise: "Restart exercise"', cthrow.text('#tr'));
  const hints = new Set();
  const se = boot({ connectRet: 5, autoLink: false });
  for (let i = 0; i < 13; i++) { se.tick(1); hints.add(se.text('#tr')); }
  ok(hints.size === 3 && hints.has(EN.h1) && hints.has(EN.h2) && hints.has(EN.h3), 'SEARCHING cycles three hints', [...hints].join('|'));
}

// =====================================================================
section('T9 name override');
{
  // Names are used only by the Xiaomi (sensor 1) and ESS (sensor 3) profiles.
  const a = boot({ connectRet: 5, data: { sensor: '1', name: ' ATC_A1B2C3 ' } }).tick(1);
  const c = a.conn.calls[0];
  ok(eqArr(c.args[2], [9].concat(ascii('ATC_A1B2C3'))) && eqArr(c.args[3], [8].concat(ascii('ATC_A1B2C3'))), 'name trimmed into [9,...] and [8,...]');
  // A name problem is one more hint in the SEARCHING cycle under '--' (the sensor row is gone); a usable name adds none.
  const hints = (data) => {
    const x = boot({ connectRet: 5, autoLink: false, data });
    const seen = new Set();
    for (let i = 0; i < 24; i++) { x.tick(1); seen.add(x.text('#tr')); }
    return [...seen].sort().join('|');
  };
  const base = [EN.h1, EN.h2, EN.h3].sort().join('|');
  ok(hints({ sensor: '1', name: ' ATC_A1B2C3 ' }) === base, 'usable name: SEARCHING cycles hints 1-3 only', hints({ sensor: '1', name: ' ATC_A1B2C3 ' }));
  const b = boot({ connectRet: 5, data: { sensor: '1', name: 'Küche' } }).tick(1);
  ok(eqArr(b.conn.calls[0].args[2], profile(2).s1) && hints({ sensor: '1', name: 'Küche' }) === [EN.h1, EN.h2, EN.h3, EN.nameBad].sort().join('|'),
    'non-ASCII name ignored; "Name must be ASCII" joins the hint cycle', hints({ sensor: '1', name: 'Küche' }));
  const l = boot({ connectRet: 5, data: { sensor: '1', name: 'ABCDEFGHIJKLMNOP' } }).tick(1);
  ok(eqArr(l.conn.calls[0].args[2], profile(2).s1) && l.ctx.G.x === 1, '16 characters ignored');
  const f = boot({ connectRet: 5, data: { sensor: '1', name: 'ATC_A1B2C3D4E5F' } }).tick(1);
  ok(f.conn.calls[0].args[2].length === 16 && f.ctx.G.x === 0, '15 characters accepted');
  const es = boot({ connectRet: 5, data: { sensor: '3', name: 'Thermo1' } }).tick(1);
  ok(eqArr(es.conn.calls[0].args[2], [9].concat(ascii('Thermo1'))), 'ESS profile uses the name');
  const e = boot({ connectRet: 5, data: { name: '   ' } }).tick(1);
  ok(eqArr(e.conn.calls[0].args[2], profile(1).s1) && e.ctx.G.x === 0 && hints({ name: '   ' }) === base, 'blank name uses the profile params, no name hint');
  // SensorPush and Ruuvi send their names in the scan response only: a name would replace a working filter with one that
  // most likely never matches, so it is ignored and the hint cycle says so.
  for (const [sensor, n] of [['0', 1], ['2', 3]]) {
    const sp = boot({ connectRet: 5, data: { sensor, name: 'SensorPush HT.w' } }).tick(1);
    const cc = sp.conn.calls[0];
    ok(eqArr(cc.args[2], profile(n).s1) && eqArr(cc.args[3], profile(n).s2), 'sensor ' + sensor + ': name ignored, profile filters kept');
    const hs = hints({ sensor, name: 'SensorPush HT.w' });
    ok(hs === [EN.h1, EN.h2, EN.h3, EN.nameOff].sort().join('|'), 'sensor ' + sensor + ': "Sensor name not used" joins the hint cycle', hs);
  }
  const spl = boot({ connectRet: 5, data: { name: 'Küche' } }).tick(20);
  ok(spl.text('#st') === '' && spl.ctx.has === 1 && spl.text('#tr') !== EN.nameOff, 'SensorPush with a name still connects and reads; no name hint once LIVE', spl.text('#tr'));
  ok(a.ctx.localStorage.reads === 3, 'localStorage read 3 times (name, sensor, poll), all in onLoad', a.ctx.localStorage.reads);
  const g = boot({ connectRet: 5, data: { sensor: '1', name: 'ATC_A1B2C3D4E5F' }, respond: (fn, id) => {
    if (fn === 'regUuid') return [107];
    if (fn === 'enaCharNotf') return [id === 6 || id === 8 ? 109 : 110];
    if (fn === 'readChar') return [102, [0x57]];
    return null;
  } }).tick(16);
  g.emit(6, 106, [0x8A, 0x09]).tick(1);
  ok(g.ctx.has === 1 && g.text('#st') === '' && g.ctx.bat === -88, 'linked by name: LIVE, battery 87 % shows nothing', [g.text('#st'), g.ctx.bat].join(' '));
  a.tick(100);
  ok(a.ctx.localStorage.reads === 3, 'no localStorage access after onLoad');
}

// =====================================================================
section('T10 demo guard (demo variant) and the store build in the simulator');
{
  const sim = boot({ variant: 'demo', connectRet: undefined, zappId: function () {} }).tick(1);
  ok(sim.ctx.demo === 1 && sim.ctx.__loaded.indexOf('ext5.js') >= 0 && sim.out.con === 4, 'demo variant: undefined + function -> demo, con 4');
  for (const variant of ['demo', undefined]) {
    for (const z of [7, undefined]) {
      const w = boot({ variant, connectRet: undefined, zappId: z === undefined ? null : z });
      if (z === undefined) w.ctx.enabledZappId = undefined;
      w.tick(3);
      ok(!w.ctx.demo && w.ctx.__loaded.indexOf('ext5.js') < 0 && w.text('#st') === EN.stFail && w.out.con === 3,
        (variant || 'store') + ' build: undefined + ' + typeof w.ctx.enabledZappId + ' -> BT ERROR, no demo', w.text('#st'));
    }
    for (const id of [0, 5]) {
      const w = boot({ variant, connectRet: id }).tick(3);
      ok(!w.ctx.demo && w.ctx.st >= 1 && w.ctx.st <= 4 && w.ctx.G.c === id, (variant || 'store') + ' build: connect returned ' + id + ' -> real path', w.ctx.st);
    }
  }
  // The store build has no demo: in the simulator (connect stubbed, enabledZappId a function) it shows BT ERROR.
  const lean = boot({ connectRet: undefined, zappId: function () {} }).tick(15);
  ok(lean.text('#st') === EN.stFail && lean.out.con === 3 && lean.ctx.demo === undefined && lean.ctx.__loaded.indexOf('ext5.js') < 0,
    'store build in the simulator: BT ERROR, Searching closed, no demo code', lean.text('#st'));
  ok(lean.text('#tr') === EN.h6 && lean.text('#t') === '--', '... with "Reselect the app" under --', lean.text('#tr'));
}

// =====================================================================
section('T10b debug trace (hardware checks H13, H14)');
{
  const d = boot({ variant: 'debug', connectRet: 5 });
  let gets = 0;
  d.ctx.$ = { get(p, cb) { gets++; if (p === '/Ui/Script/MemoryPool/Allocated') cb(12345); } };
  d.tick(61);
  ok(d.log.some((l) => l === '[AT] connect called number 5 0'), 'debug logs "connect called", typeof enabledZappId, connection id, demo flag', d.log[0]);
  ok(gets === 1 && d.log.some((l) => l === '[AT] mem 12345'), 'debug logs the memory pool every 60 ticks', gets);
  ok(d.log.some((l) => /^\[AT\] ev 107 /.test(l)), 'debug logs BLE events');
  ok(d.log.some((l) => /^\[AT\] ev 107 /.test(l)) && d.ctx.G.d === 1, 'debug variant: data.json debug is 1');
  const off = boot({ variant: 'debug', connectRet: 5, data: { debug: '0' } }).tick(61);
  ok(off.log.length === 0 && off.ctx.G.g === 0, 'debug variant with debug 0 logs nothing and creates no logger');
  const r = boot({ connectRet: 5 }).tick(61);
  ok(r.log.length === 0 && r.ctx.G.g === undefined && r.ctx.G.d === undefined, 'store build logs nothing and has no logger');
  const dd = boot({ variant: 'demo,debug', connectRet: undefined, zappId: function () {} }).tick(15);
  ok(dd.log.some((l) => l === '[AT] connect called function 7 1') && dd.text('#st') === '' && dd.ctx.demo === 1, 'demo + debug variant: both hooks apply (the demo shows no tag)', dd.log[0]);
}

// =====================================================================
section('T11 formatting');
{
  const w = boot({ connectRet: 5, units: 1, T: 21.5 }).tick(12);
  ok(w.text('#t') === '70.7' && w.text('#u') === '°F', 'big number in F', w.text('#t') + w.text('#u'));
  const c = boot({ connectRet: 5, units: 0, T: -12.34 }).tick(12);
  ok(c.text('#t') === '-12.3' && c.text('#u') === '°C', 'C screen', c.text('#t'));
  const z = boot({ connectRet: 5, T: -0.04 }).tick(12);
  ok(z.text('#t') === '0.0', '-0.04 C shows 0.0, not -0.0', z.text('#t'));
  const m40 = boot({ connectRet: 5, T: -40 }).tick(12);
  const f40 = boot({ connectRet: 5, units: 1, T: -40 }).tick(12);
  ok(m40.text('#t') === '-40.0' && f40.text('#t') === '-40.0', '-40 is -40.0 in both units');
  const hot = boot({ connectRet: 5, units: 1, T: 40.28 }).tick(12);
  ok(hot.text('#t') === '104.5', '40.28 C = 104.5 F', hot.text('#t'));
  const n = boot({ connectRet: 5, units: NaN }).tick(12);
  ok(n.text('#u') === '°C', 'NaN units input: metric', n.text('#u'));
}

// =====================================================================
section('T12 exercise stats and summary');
{
  let T = 10;
  const s = boot({ connectRet: 5, T: () => T }).tick(12);
  ok(s.ctx.nC === 0 && s.text('#mn') === '--', 'nothing counted before start');
  ok(JSON.stringify(s.ctx.getSummaryOutputs({}, {})) === '[]' && s.ctx.__loaded.indexOf('ext8.js') < 0, 'summary [] without data (ext8 not even loaded)');
  s.ctx.onExerciseStart();
  s.tick(30);
  T = 20;
  s.tick(40);
  s.ctx.onExercisePause();
  T = -5;
  s.tick(30);
  T = 20;
  s.tick(30);
  s.ctx.onExerciseContinue();
  s.tick(10);
  const sum = s.ctx.getSummaryOutputs({}, {});
  ok(sum.length === 4 && sum.map((x) => x.id).join() === 'n,a,x,h', 'summary has min, avg, max, humidity');
  ok(sum.map((x) => x.name).join('|') === [EN.sMin, EN.sAvg, EN.sMax, EN.sRh].join('|'), 'summary names translated');
  ok(near(sum[0].value, 10 + 273.15, 1e-6) && near(sum[2].value, 20 + 273.15, 1e-6), 'min 10 C, max 20 C in K (paused -5 C not counted)', sum[0].value + ' ' + sum[2].value);
  const avg = sum[1].value - 273.15;
  ok(avg > 13 && avg < 18, 'time-weighted average between 13 and 18 C', avg);
  ok(sum[0].format === 'Temperature_Fourdigits' && sum[3].format === 'Percentage_Threedigits', 'summary formats');
  ok(near(sum[3].value, 43.21, 1e-6), 'humidity average', sum[3].value);
  ok(s.text('#mn') === '10.0' && s.text('#mx') === '20.0', 'min/max on screen', s.text('#mn') + ' ' + s.text('#mx'));
  // Uneven cadence: a value held for 50 s weighs 5 times a value held for 10 s.
  const u = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [109] : null) }).tick(16);
  u.ctx.onExerciseStart();
  u.emit(2, 106, i16(0)).tick(10);
  u.emit(2, 106, i16(600)).tick(50);
  const ua = u.ctx.getSummaryOutputs({}, {})[1].value - 273.15;
  ok(near(ua, 5, 0.01), 'uneven cadence: (10 s x 0 + 50 s x 6) / 60 = 5', ua);
  const noH = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn, id) => (fn === 'regUuid' ? [id === 5 || id === 6 ? 108 : 107] : fn === 'enaCharNotf' ? [109] : null) }).tick(16);
  noH.ctx.onExerciseStart();
  noH.emit(2, 106, [0x8A, 0x09]).tick(5);
  const sh = noH.ctx.getSummaryOutputs({}, {});
  ok(sh.length === 3 && sh.every((x) => x.id !== 'h'), 'no humidity char -> humidity entry omitted');
  ok(noH.text('#rh') === '--', 'no humidity -> -- on screen');
}

// =====================================================================
section('T13 trend');
{
  const ramp = (perHour, ticks, units) => {
    let t = 0;
    const s = boot({ connectRet: 5, units, data: { poll: '0' }, T: () => 5 + perHour * t / 3600 });
    for (let i = 0; i < ticks; i++) { t++; s.tick(1); }
    return s;
  };
  const cases = [[0, '\u2192'], [2, '\u2197'], [5, '\u2191'], [-2, '\u2198'], [-5, '\u2193']];
  for (const [rate, icon] of cases) {
    const s = ramp(rate, 700);
    ok(s.ctx.rate === s.ctx.rate && near(s.ctx.rate, rate, 0.25), 'ramp ' + rate + ' C/h measured', s.ctx.rate);
    ok(s.text('#ar') === icon && s.ui.style['#ar visibility'] === 'VISIBLE', 'ramp ' + rate + ' icon ' + icon.charCodeAt(0).toString(16));
    ok(Object.keys(s.ui.style).every((x) => / visibility$/.test(x)), 'ramp ' + rate + ': no runtime colour or opacity, only visibility', Object.keys(s.ui.style).join());
  }
  const f = ramp(-2, 700, 1);
  ok(/^-3\.\d°\/h$/.test(f.text('#tr')), 'F rate is x 1.8 (about -3.6 F/h)', f.text('#tr'));
  // The arrow follows the printed number with the same thresholds in both units, 1 and 3 degrees/h: +1.7°/h tilts in F
  // as it does in C (with 2 and 5 F/h, F showed a flat arrow next to +1.7 while C showed a tilted one next to -1.7).
  const f0 = ramp(0.45, 700, 1);
  ok(/^\+0\.\d°\/h$/.test(f0.text('#tr')) && f0.text('#ar') === '\u2192', 'F +0.8 F/h: flat arrow (below 1)', f0.text('#tr') + ' ' + f0.text('#ar'));
  const f1 = ramp(0.95, 700, 1);
  ok(/^\+1\.\d°\/h$/.test(f1.text('#tr')) && f1.text('#ar') === '\u2197', 'F +1.7 F/h: rising arrow, as +1.7 C/h is', f1.text('#tr') + ' ' + f1.text('#ar'));
  const f2 = ramp(1.3, 700, 1);
  ok(/^\+2\.\d°\/h$/.test(f2.text('#tr')) && f2.text('#ar') === '\u2197', 'F +2.3 F/h: rising arrow', f2.text('#tr') + ' ' + f2.text('#ar'));
  const f5 = ramp(1.9, 700, 1);
  ok(/^\+3\.\d°\/h$/.test(f5.text('#tr')) && f5.text('#ar') === '\u2191', 'F +3.4 F/h: steep arrow (3 and up)', f5.text('#tr') + ' ' + f5.text('#ar'));
  const c17 = ramp(-1.7, 700, 0);
  const f17 = ramp(-0.95, 700, 1);
  ok(/^-1\.\d°\/h$/.test(c17.text('#tr')) && /^-1\.\d°\/h$/.test(f17.text('#tr')) && c17.text('#ar') === '\u2198' && f17.text('#ar') === '\u2198',
    'about -1.7°/h: the same falling arrow in C and in F', [c17.text('#tr'), c17.text('#ar'), f17.text('#tr'), f17.text('#ar')].join(' '));
  // The bottom line: arrow and trend, e.g. "↘ -1.7°/h"; the humidity is on the top line.
  ok(/^-1\.\d°\/h$/.test(c17.raw('#tr')) && c17.text('#rh') === '43%', 'trend line and humidity line', c17.raw('#tr') + ' ' + c17.text('#rh'));
  const c1 = ramp(0.95, 700, 0);
  ok(c1.text('#tr') === '+1.0°/h' ? c1.text('#ar') === '\u2197' : c1.text('#ar') === '\u2192', 'C: arrow agrees with the printed tenths', c1.text('#tr') + ' ' + c1.text('#ar'));
  // The arrow is made visible before its glyph is sent (setText only changes visible elements).
  const ord = ramp(2, 700, 0);
  const lg = ord.ui.log;
  const vis = lg.indexOf('style #tl visibility VISIBLE');
  const tickStart = lg.lastIndexOf('tick', vis);
  const tickEnd = lg.indexOf('tick', vis);
  const txt = lg.slice(tickStart, tickEnd < 0 ? lg.length : tickEnd).findIndex((x) => x.indexOf('text #ar ') === 0);
  ok(vis > 0 && txt > vis - tickStart, 'first VISIBLE precedes the arrow glyph in the same tick', [vis - tickStart, txt].join());
  // Trend and arrow are withdrawn while the value is stale.
  ord.emit(0, 101).tick(1);
  ok(ord.ui.style['#ar visibility'] === 'HIDDEN' && ord.text('#tr') === EN.h5, 'LOST: arrow hidden, the trend line says reconnecting', ord.text('#tr'));
  const early = boot({ connectRet: 5, data: { poll: '0' } }).tick(150);
  ok(early.ctx.rate !== early.ctx.rate && early.text('#tr') === '--°/h' && early.text('#ar') === '-', 'under 9 slots: a dash for the arrow, trend text waits', early.text('#ar'));
  const g = boot({ connectRet: 5, data: { poll: '0' } });
  g.tick(200);
  g.ctx.has = 0;
  g.tick(300);
  const ring = Array.from(g.ctx.ring);
  ok(ring.some((v) => v !== v) && ring.some((v) => v === v), 'ring holds gaps (NaN) and values');
  ok(Object.prototype.toString.call(g.ctx.ring) === '[object Float32Array]', 'ring is a Float32Array (Int16Array is undocumented on the watch)');
}

// =====================================================================
section('T14 staleness');
{
  let alive = true;
  const s = boot({ connectRet: 5, respond: (fn, id) => {
    const d = defaultRespond({ T: 12.5 })(fn, id);
    if (fn === 'readChar' && !alive) return [103];
    return d;
  } }).tick(15);
  ok(s.ctx.S === 35, 'S = max(30, 3 x 10 + 5) = 35 for SensorPush at 10 s', s.ctx.S);
  alive = false;
  while (s.ctx.age < 30 && s.ctx.fails < 3) s.tick(1);
  ok(s.text('#st') === '' && !s.dim() && s.out.airT !== undefined, 'still fresh after 2 failed polls', s.ctx.age);
  s.tick(10);
  ok(s.out.airT === undefined && s.out.rh === undefined && [EN.h7, EN.h1].indexOf(s.text('#tr')) >= 0, 'stale: outputs undefined, a hint under the number', s.text('#tr'));
  const sh = new Set();
  for (let i = 0; i < 8; i++) { s.tick(1); sh.add(s.text('#tr')); }
  ok(sh.size === 2 && sh.has(EN.h7) && sh.has(EN.h1), 'the sensor had delivered: "Sensor went quiet" and "Bring sensor close", not "Check Sensor setting"', [...sh].join('|'));
  ok(s.dim() && s.ui.text['#g'] === '12.5', 'the stale value is drawn by the grey copy of the number', s.ui.text['#g']);
  ok(/^NO DATA (\d+s|\d:\d\d)$/.test(s.text('#st')), 'NO DATA with the time since the last sample ("48s", "1:05")', s.text('#st'));
  ok(s.text('#t') === '12.5', 'last value kept on screen (for now)');
  alive = true;
  s.tick(14);
  ok(s.out.airT !== undefined && s.text('#st') === '' && !s.dim() && s.text('#tr') !== EN.h1, 'recovers when data returns (bright number, no state word)');
  // Linked but the sensor never delivered: the setup hints 1-3, "Check Sensor setting" among them.
  const nv = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' ? [103] : defaultRespond({})(fn, id)) }).tick(60);
  const nh = new Set();
  for (let i = 0; i < 16; i++) { nv.tick(1); nh.add(nv.text('#tr')); }
  ok(/^NO DATA/.test(nv.text('#st')) && [...nh].sort().join('|') === [EN.h1, EN.h2, EN.h3].sort().join('|'), 'NO DATA before any sample cycles hints 1-3', [nv.text('#st')].concat([...nh]).join('|'));
  const r = boot({ connectRet: 5, data: { sensor: '2' } });
  ok(r.ctx.S === 30, 'S = 30 for Ruuvi (3 x 3 + 5 < 30)', r.ctx.S);
  // Humidity stops while temperature continues: '--' after S, like the logged output.
  let hOk = true;
  const h = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && id === 2 && !hOk ? [103] : defaultRespond({ T: 12.5 })(fn, id)) }).tick(20);
  ok(h.text('#rh') === '43%', 'humidity shown while fresh', h.text('#rh'));
  hOk = false;
  h.tick(60);
  ok(h.text('#rh') === '--' && h.out.rh === undefined && h.text('#st') === '' && /°\/h$|^--$/.test(h.raw('#tr')), 'humidity stale: gone from the trend line and the output, temperature still LIVE', h.text('#rh'));
  const hl = boot({ connectRet: 5 }).tick(20).emit(0, 101).tick(1);
  ok(hl.text('#rh') === '--', 'LOST: humidity not shown as current', hl.text('#rh'));
}

// =====================================================================
section('T15 jump filter and plausibility');
{
  const s = boot({ connectRet: 5, data: { sensor: '3' } }).tick(16);
  const t = (v) => i16(Math.round(v * 100));
  s.emit(2, 106, t(10)).tick(1);
  s.emit(2, 106, t(30)).tick(1);
  ok(near(s.ctx.tC, 10), 'single spike held back');
  s.emit(2, 106, t(10.2)).tick(1);
  ok(near(s.ctx.tC, 10.2) && s.ctx.cand !== s.ctx.cand, 'spike dropped, normal value accepted');
  s.emit(2, 106, t(25)).tick(1);
  s.emit(2, 106, t(25.5)).tick(1);
  ok(near(s.ctx.tC, 25.5), 'confirmed step accepted');
  s.emit(2, 106, t(-61)).tick(1);
  ok(near(s.ctx.tC, 25.5), '-61 C rejected');
  s.emit(2, 106, t(86)).tick(1);
  ok(near(s.ctx.tC, 25.5), '86 C rejected');
  s.emit(6, 106, i16(10400)).tick(1);
  ok(s.ctx.rh === 100, '104 % clamped to 100');
  s.emit(6, 106, i16(11000)).tick(1);
  ok(s.ctx.rh === 100, '110 % dropped');
  s.emit(2, 106, [0x01]).tick(1);
  ok(near(s.ctx.tC, 25.5) && s.ctx.has === 1, 'short frame ignored, last value kept');
  s.emit(2, 106, undefined).emit(14, 106, [1, 2]).tick(1);
  ok(near(s.ctx.tC, 25.5), 'missing data and unregistered char ignored');
  const q = boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'enaCharNotf' ? [109] : fn === 'readChar' ? [103] : null) }).tick(16);
  ok(q.ctx.S === 65, 'S = 65 for ESS (3 x 20 + 5)', q.ctx.S);
  q.emit(2, 106, t(10)).tick(66);
  q.emit(2, 106, t(25)).tick(1);
  ok(near(q.ctx.tC, 25), 'jump after more than S (65 s) accepted directly');
  // At 60 s polling (cycle 63 s, S = 185) the filter must still hold a single glitch back.
  let T = 10;
  let reads = 0;
  const p60 = boot({ connectRet: 5, data: { poll: '3' }, T: () => (++reads === 4 ? T + 30 : T) });
  p60.ctx.onExerciseStart();
  p60.tick(260);
  ok(p60.ctx.S === 185 && reads >= 4, '60 s poll: S = 185 and the glitch read happened', p60.ctx.S + ' ' + reads);
  ok(near(p60.ctx.tC, 10) && near(p60.ctx.mx, 10) && p60.text('#mx') === '10.0', '60 s poll: a +30 C glitch never becomes the value or MAX', p60.ctx.mx);
}

// =====================================================================
section('T16 long run, allocation and size budgets');
{
  let n = 0;
  const s = boot({ connectRet: 5, data: { sensor: '2' } }).tick(6);
  const ring = s.ctx.ring;
  const pr = s.ctx.pr;
  const rc = s.ctx.rc;
  const before = s.ui.setText;
  for (let i = 0; i < 7200; i++) {
    if (i % 3 === 0) s.emit(1, 106, df5(-5 + (n++ % 40) / 10));
    s.tick(1);
  }
  const calls = s.ui.setText - before;
  ok(calls < 7200 * 10 / 4, 'setText calls stay near changes + periodic refresh (' + calls + ' in 7200 ticks)', calls);
  ok(s.ctx.ring === ring && s.ctx.pr === pr && s.ctx.rc === rc, 'ring, parser scratch and char map are the same objects throughout');
  ok(s.ctx.stp === 0, 'setup stepper (ext7) released after setup');
  ok(s.conn.violations.length === 0, 'no violations in 2 hours', s.conn.violations.slice(0, 3).join('; '));
  const src = read('main.js');
  const fns = (src.match(/^var \w+ = function/gm) || []).length;
  ok(fns <= 8, 'module-level function objects <= 8 (deep-dive limits)', fns);
}

// =====================================================================
section('T17 static source rules');
{
  const files = fs.readdirSync(APP);
  for (const f of files.filter((x) => /\.(js|html)$/.test(x))) {
    const lines = read(f).split('\n');
    const tag = /\.html$/.test(f) ? /^<!-- ABOUTME: .+ -->$/ : /^\/\/ ABOUTME: .+/;
    ok(tag.test(lines[0]) && tag.test(lines[1]), f + ' starts with a two-line ABOUTME header');
  }
  for (const f of files.filter((x) => /\.js$/.test(x))) {
    const code = read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const bad = ['=>', 'let ', 'const ', '`', 'class ', 'Date', 'Int16Array', 'Uint16Array', 'Int32Array'].filter((k) => code.indexOf(k) >= 0);
    ok(bad.length === 0, f + ' has no ES6 syntax, Date or undocumented typed arrays', bad.join(' '));
    ok(!/[=(,:]\s*\/[^/*]/.test(code), f + ' has no regex literals');
    ok(code.indexOf('evalFile') < 0 || f === 'main.js', f + ': evalFile only in main.js ({file_path} does not resolve in an ext file on the watch, hardware 2026-10-04)');
    ok(code.indexOf('{{') < 0 || f === 'main.js' || f === 'ext8.js', f + ': translation tokens only in main.js and the summary ext8.js (the simulator does not translate ext files)');
  }
  for (const f of files.filter((x) => /^ext\d+\.js$/.test(x))) {
    let isFn = false;
    try { isFn = typeof vm.runInNewContext('(' + read(f) + '\n)') === 'function'; } catch (e) { isFn = false; }
    ok(isFn, f + ' is a single function expression');
  }
  // `output` only as output.<name> inside onLoad/evaluate; never in helpers, the handler, closures or ext files.
  const main = read('main.js');
  const outside = main.replace(/function (onLoad|evaluate)\(input, output\) \{[\s\S]*?\n\}/g, '').replace(/function getSummaryOutputs\(input, output\)/, '');
  ok(!/\boutput\b/.test(outside.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'main.js touches output only inside onLoad and evaluate');
  ok(!/[^.\w]output\b(?!\.)/.test(main.replace(/\(input, output\)/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')), 'output is never used as a bare value');
  ok(files.filter((x) => /^ext/.test(x)).every((f) => !/\boutput\b/.test(read(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'))), 'ext files never touch output');
  const html = read('t.html');
  ok((html.match(/<script|onLoad=|onActivate=/g) || []).length === 0, 't.html has no template script');
  ok((html.match(/<div|<span/g) || []).length <= 18, 't.html element count', (html.match(/<div|<span/g) || []).length);
  ok(!/<userInput|<pushButton|<canvas|<img/.test(html), 'no button overrides, canvas or images');
  const style = html.match(/style="[^"]*"/g) || [];
  const props = new Set();
  style.forEach((s) => s.slice(7, -1).split(';').filter(Boolean).forEach((d) => props.add(d.split(':')[0].trim())));
  const allowed = ['top', 'left', 'width', 'height', 'color', 'background-color', 'opacity', 'border', 'visibility', 'padding-left', 'padding-right', 'padding', 'box-sizing',
    // the graph's line and fill, in both spellings Suunto uses (Graph example inline, watch theme CSS)
    'stroke-color', 'stroke', 'stroke-width', 'fill-color', 'fill'];
  ok([...props].every((p) => allowed.indexOf(p) >= 0), 'only supported CSS properties', [...props].join(','));
  for (const id of ['st', 'ti', 't', 'u', 'g', 'v', 'ar', 'tr', 'hn', 'mn', 'mx']) {
    const m = html.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'));
    ok(m && m[1].trim().length > 0, '#' + id + ' has a non-space placeholder');
  }
  for (const k of Object.keys(EN)) ok(!/['"\\&<>]/.test(EN[k]), 'en.json ' + k + ' is safe inside a script string');
  const used = (main + html + read('ext8.js') + VARIANT.build('demo')['main.js']).match(/{{\s*(\w+)\s*}}/g).map((t) => t.replace(/[{} ]/g, ''));
  ok(used.every((k) => k in EN || k in BUILTIN), 'every token exists', used.filter((k) => !(k in EN || k in BUILTIN)).join());
  ok(Object.keys(EN).every((k) => used.indexOf(k) >= 0), 'every en.json key is used (store build, ext8.js or the demo variant)', Object.keys(EN).filter((k) => used.indexOf(k) < 0).join());
  for (const k of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'nameBad', 'nameOff']) ok(EN[k].length <= 20, 'hint ' + k + ' is short', EN[k]);
  // The one longer hint; the safe-area check of the n screenshots (tools/safe-area.js) shows it inside the circle.
  ok(EN.h7.length <= 22, 'hint h7 is at most 22 characters', EN.h7);
}

// =====================================================================
section('T18 manifest and data.json');
{
  const m = JSON.parse(read('manifest.json'));
  const d = JSON.parse(read('data.json'));
  ok(Buffer.byteLength(m.name) <= 60 && Buffer.byteLength(m.description) <= 100 && m.version.length <= 4, 'name, description, version within limits');
  ok(m.type === 'device' && m.out.some((o) => o.name === 'con'), 'device app with a con output');
  ok(m.in.length === 1 && m.out.length === 4 && m.out.filter((o) => o.log).length === 2 && m.out.some((o) => o.name === 'gT' && !o.log), '1 in, 4 out (gT feeds the graph, not logged), 2 logged');
  ok(m.settings.every((s) => !s.valuePath && !/\]\s*$/.test(s.shownName)), 'inline enum values only, no unit brackets');
  for (const s of m.settings) {
    if (s.type === 'enum') ok(+d[s.path] >= 0 && +d[s.path] < s.values.length, 'default for ' + s.path + ' is a valid index');
    if (s.type === 'string') ok(typeof d[s.path] === 'string' && Buffer.byteLength(d[s.path]) <= s.maxLength, 'default for ' + s.path + ' fits maxLength');
  }
  ok(!('demo' in d) && !('debug' in d) && d.sensor === '1', 'shipped data.json: sensor 1 (Auto), no demo or debug keys (variant.js adds them)');
  ok(Object.keys(d).every((k) => m.settings.some((x) => x.path === k)), 'every data.json key is a setting (localStorage buffers the whole file)', Object.keys(d).join());
  ok(Object.values(d).every((v) => typeof v === 'string') && Buffer.byteLength(read('data.json')) < 2000, 'data.json values are strings and the file stays under 2 KB');
  ok(m.out.find((o) => o.name === 'airT').format === 'Temperature_Fourdigits', 'airT logged with the negative-safe temperature format');
}

// =====================================================================
section('Demo shim (simulator, demo variant) through the real state machine');
{
  // '' = no state word: the demo shows no tag, so scenarios 0, 5 and 6 look like a live sensor.
  const expectState = { 0: '', 1: EN.stNoData, 2: EN.stSearch, 3: EN.stLost, 4: EN.stWrong, 5: '', 6: '' };
  for (const sensor of ['0', '1', '2', '3']) {
    for (let scn = 0; scn <= 6; scn++) {
      let err = null;
      let s;
      try {
        s = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, wrist: 293.15, data: { sensor, demo: String(scn) } });
        s.tick(90);
      } catch (e) { err = e; }
      const st = s && s.text('#st');
      ok(!err && typeof st === 'string' && (expectState[scn] ? st.indexOf(expectState[scn]) === 0 : st === ''), 'sensor ' + sensor + ' scenario ' + scn + ' -> ' + (expectState[scn] || 'no state word'), err ? err.stack.split('\n').slice(0, 2).join(' ') : st);
    }
  }
  const live = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '0' }, wrist: 293.15 }).tick(15);
  ok(live.text('#st') === '' && live.ui.style['#st visibility'] === 'HIDDEN' && !('#sn' in live.ui.text), 'demo: no DEMO tag, no sensor row', live.text('#st'));
  ok(live.ctx.rate < -1 && live.ctx.rate > -3 && live.text('#ar') === '\u2198', 'pre-seeded trend shows about -2 C/h', live.ctx.rate);
  ok(/^-\d+\.\d$/.test(live.text('#mn')) && /^-\d+\.\d$/.test(live.text('#mx')) && /^\d+%$/.test(live.text('#rh')), 'min, max and humidity populated', [live.text('#mn'), live.text('#mx'), live.text('#rh')].join(' '));
  const hot = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '5' } }).tick(15);
  ok(hot.text('#u') === '°F' && /^10\d\.\d$/.test(hot.text('#t')), 'scenario 5 shows about 104 F', hot.text('#t'));
  const store = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '6' } }).tick(15);
  ok(store.text('#st') === '' && store.ctx.bat === 2950, 'scenario 6 looks like a real sensor (battery 2.95 V, nothing shown)', store.ctx.bat);
  const ess = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '0', sensor: '3' } }).tick(30);
  ok((ess.ctx.prof.t === 2 || ess.ctx.prof.t === 4) && ess.ctx.prof.h === 6, 'ESS demo: the 2-byte forms refuse, an expanded form that delivers is kept', [ess.ctx.prof.t, ess.ctx.prof.h].join());
}

// =====================================================================
section('T20 review round 2 regressions (each fails on the round-1 code)');
{
  // Jump filter: two consecutive out-of-band samples on the same side of the value are a real change, not a glitch.
  const j = boot({ connectRet: 5, data: { sensor: '3' } }).tick(16);
  const t16 = (v) => i16(Math.round(v * 100));
  j.emit(2, 106, t16(20)).tick(1);
  j.emit(2, 106, t16(5)).tick(1);
  ok(near(j.ctx.tC, 20), 'first sample 15 C below: held');
  j.emit(2, 106, t16(-3)).tick(1);
  ok(near(j.ctx.tC, -3), 'second sample on the same side (8 C further on): accepted, not held again', j.ctx.tC);
  // An exponential fall from +30 to -20 C (tau 120 s) read every 60 s: the old value may be held for one sample only.
  let tt = 0;
  const air = () => -20 + 50 * Math.exp(-Math.max(0, tt - 200) / 120);
  const ex = boot({ connectRet: 5, data: { poll: '3' }, T: air });
  let staleLive = 0;
  for (let i = 0; i < 700; i++) {
    tt++;
    ex.tick(1);
    if (ex.text('#st') === '' && Math.abs(ex.ctx.tC - air()) > 10) staleLive++;
  }
  ok(staleLive > 0 && staleLive <= 110, 'fast real fall at 60 s polling: LIVE more than 10 C off the air for at most ~one poll cycle', staleLive);

  // A late answer to an operation that timed out completes nothing: it names another characteristic.
  let manual = true;
  // Registration (ext13.js) takes ticks 3-10; ext7.js, loaded on the next tick, sends the first enable.
  const late = boot({ connectRet: 5, data: { sensor: '1' }, respond: (fn) => (fn === 'regUuid' ? [107] : fn === 'readChar' ? [103] : manual ? null : [110]) }).tick(10);
  ok(late.ids('enaCharNotf') === '1', 'enable of the frame char pending', late.ids('enaCharNotf'));
  late.tick(6);
  ok(late.ids('enaCharNotf') === '1,5', 'no answer: timed out, next candidate enabled', late.ids('enaCharNotf'));
  late.emit(1, 110).tick(1);
  ok(late.ids('enaCharNotf') === '1,5', 'a late 110 for the old char does not complete the pending enable of char 5', late.ids('enaCharNotf'));
  manual = false;
  late.emit(5, 109).tick(3);
  ok(late.ids('enaCharNotf') === '1,5,6,7,8' && late.ctx.prof.t === 5, 'char 5, which answered 109, is chosen as the polled T id (not char 6)', late.ctx.prof.t);

  // A connect retry after 112 that throws: bounded retries, then BT ERROR (it used to stay SEARCHING forever).
  let nc = 0;
  const rt = boot({ connectRet: 5, autoLink: false, throwOn: (fn) => fn === 'connect' && ++nc > 1 }).tick(5);
  rt.emit(0, 112).tick(120);
  ok(rt.ctx.st === 7 && rt.text('#st') === EN.stFail && rt.count('connect') === 4, 'thrown retries after 112: 3 retries, then BT ERROR', rt.count('connect') + ' ' + rt.text('#st'));
  const callsRt = rt.conn.calls.length;
  rt.tick(200);
  ok(rt.conn.calls.length === callsRt && rt.out.con === 3, '... and nothing more is tried; Searching closed');

  // One thrown regUuid on the only temperature candidate is retried; the sensor still ends LIVE.
  for (const [sensor, feed] of [['0', null], ['2', () => df5(12.5)], ['1', () => [0xE2, 0x04, 0x37, 0x7B, 0x0B]]]) {
    let thrown = 0;
    const rg = boot({ connectRet: 5, data: { sensor }, throwOn: (fn, id) => fn === 'regUuid' && id === 1 && !thrown++ }).tick(20);
    for (let i = 0; i < 20; i++) { if (feed) rg.emit(1, 106, feed()); rg.tick(1); }
    ok(rg.count('regUuid', 1) === 2 && rg.ctx.st === 4 && rg.text('#st') === '' && rg.ctx.rc[1] > 0,
      'sensor ' + sensor + ': regUuid(1) threw once -> sent again -> LIVE', rg.text('#st') + ' rc1=' + rg.ctx.rc[1]);
  }

  // Stale value at a glance: a hint right under the number, then '--' after 2 minutes; min and max keep the history.
  const lo = boot({ connectRet: 5, T: 12.5 }).tick(15);
  lo.ctx.onExerciseStart();
  lo.tick(10);
  ok(lo.out.gT === 12.5 + 273.15, 'fresh: the graph feed carries the value', lo.out.gT);
  lo.emit(0, 101).tick(60);
  ok(lo.text('#t') === '12.5' && lo.dim() && lo.text('#tr') === EN.h5 && lo.out.gT === 12.5 + 273.15 && lo.out.airT === undefined,
    'LOST 1 min: value greyed, "Reconnecting" under it; the graph feed holds the last value, the logged output is undefined',
    [lo.text('#t'), lo.text('#tr'), lo.out.gT].join('|'));
  lo.tick(60);
  ok(/^LOST 2:0/.test(lo.text('#st')) && lo.text('#t') === '--' && lo.text('#mn') === '12.5' && lo.text('#mx') === '12.5', 'LOST 2 min: number --, min and max kept',
    [lo.text('#st'), lo.text('#t'), lo.text('#mn')].join('|'));
  let up = true;
  const nd = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && !up ? [103] : defaultRespond({ T: 12.5 })(fn, id)) }).tick(15);
  up = false;
  let tStale = -1;
  let tBlank = -1;
  for (let i = 0; i < 300 && tBlank < 0; i++) {
    nd.tick(1);
    if (tStale < 0 && /^NO DATA/.test(nd.text('#st'))) tStale = i;
    if (nd.text('#t') === '--') tBlank = i;
  }
  ok(tStale >= 0 && nd.text('#t') === '--' && tBlank - tStale >= 80 && nd.ctx.age >= nd.ctx.S + 120 && nd.ctx.age < nd.ctx.S + 122,
    'NO DATA: the number becomes -- once the sample is 2 minutes past S', [tStale, tBlank, nd.ctx.age].join());
  // No runtime colour or opacity in any state: only visibility, which is proven on hardware (the arrow, the state word,
  // the wrist row and the bright or grey number row).
  const looks = [lo, nd, boot({ connectRet: 5, data: { sensor: '3' }, respond: (fn) => (fn === 'regUuid' ? [108] : null) }).tick(15),
    boot({ connectRet: 5, throwOn: (fn) => fn === 'connect' }).tick(3), boot({ connectRet: 5, autoLink: false }).tick(20),
    boot({ variant: 'demo', connectRet: undefined, zappId: function () {} }).tick(15)];
  ok(looks.every((x) => Object.keys(x.ui.style).every((k) => /^#(ar|st|ti|t|u|tr|g|v|hn|tg|tl|gg) visibility$/.test(k))), 'no setStyle other than visibility in LOST, NO DATA, WRONG, BT ERROR, SEARCHING, demo',
    looks.map((x) => Object.keys(x.ui.style).join('+')).join(' '));
  // Nothing to show yet: the actionable hint is the bold line under a grey '--', and no wrist row (no air value).
  const sr = boot({ connectRet: 5, autoLink: false }).tick(3);
  ok(sr.text('#t') === '--' && sr.dim() && [EN.h1, EN.h2, EN.h3].indexOf(sr.text('#tr')) >= 0 && sr.out.gT === undefined, 'SEARCHING: hint under a grey --, no graph sample yet',
    sr.text('#tr'));

  // Memory: the UUID tables and connect params are never resident. They are loaded from the table file (ext9-12.js) for
  // each connect call and by ext13.js for registration on the first link; reconnects load only ext7.js.
  for (const sensor of ['0', '1', '2', '3']) {
    const mm = boot({ connectRet: 5, data: { sensor } }).tick(1);
    const tf = 'ext' + (+sensor + 9) + '.js';
    const resident = (x) => !('c' in x.ctx.prof) && !('u' in x.ctx.prof) && x.ctx.G.a === 0 && x.ctx.G.b === 0;
    ok(resident(mm) && mm.ctx.__loaded.join() === ['ext6.js', 'ext' + (+sensor + 1) + '.js', tf].join(), 'sensor ' + sensor + ': onLoad loads settings and the resident profile; the first connect the table file', mm.ctx.__loaded.join());
    mm.tick(25);
    ok(resident(mm) && mm.ctx.prof.rg === -1 && mm.ctx.st >= 4 && mm.ctx.__loaded.slice(3).join() === ['ext13.js', tf, 'ext7.js'].join(),
      'sensor ' + sensor + ': first link: ext13.js (with the table file) registers, then ext7.js; rg = -1', [mm.ctx.st, mm.ctx.prof.rg, mm.ctx.__loaded.join()].join(' '));
    const n = mm.ctx.__loaded.length;
    mm.emit(0, 101).tick(3).emit(0, 100).tick(15);
    ok(mm.ctx.st === 4 && mm.conn.violations.length === 0 && mm.ctx.__loaded.slice(n).join() === 'ext7.js' && mm.ctx.stp === 0,
      'sensor ' + sensor + ': a reconnect loads only ext7.js, sets up and releases it', [mm.ctx.st, mm.ctx.__loaded.slice(n).join()].join(' '));
  }
  const fm = boot({ connectRet: 5 }).tick(1);
  ok(['call', 'onBle', 'step', 'stat', 'str', 'put', 'draw', 'rows'].every((n) => fm.ctx[n].prototype === null) && fm.ctx.prof.p.prototype === null,
    'module functions and the profile parser carry no prototype object');
  ok(fm.ctx.G.g === undefined && typeof boot({ variant: 'debug', connectRet: 5 }).ctx.G.g === 'function', 'the debug logger closure exists in the debug variant only');
  // Every evalFile'd function that is called and released drops its prototype (the cycle would wait for a mark-and-sweep):
  // the table file in main.js and ext13.js, ext14.js in ext6.js, ext15.js in main.js, ext7/13.js and their steppers.
  const e13 = read('ext13.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok((e13.match(/\bfunction\b/g) || []).length === 2, 'ext13.js holds exactly one inner function (the stepper)');
  // A loaded function called at once (evalFile(...)(...)) keeps its prototype: allowed only once per app run (onLoad's
  // settings and profile, the summary at exercise end), never on a path that repeats (connect, link, failed read).
  const direct = (f) => (read(f).replace(/^\s*\/\/.*$/gm, '').match(/evalFile\([^)]*\)\(/g) || []).length;
  ok(direct('main.js') === 3 && direct('ext6.js') === 0 && direct('ext13.js') === 0 && direct('ext7.js') === 0,
    'repeating evalFile paths drop the loaded function\'s prototype before calling it', [direct('main.js'), direct('ext6.js'), direct('ext13.js')].join());

  // The setup stepper leaves no cycle behind: its prototype is dropped and ext7 creates no other closure.
  const sg = boot({ connectRet: 5 }).tick(4);
  ok(typeof sg.ctx.stp === 'function' && sg.ctx.stp.prototype === null, 'setup stepper has no prototype object');
  const e7 = read('ext7.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok((e7.match(/\bfunction\b/g) || []).length === 2, 'ext7.js holds exactly one inner function (the stepper)');
}

// =====================================================================
section('T21 review round 3: memory layout, split setup, store and variant builds');
{
  // Module-level names: at most 56, so the module scope record stays below lowmem Duktape's 64-slot hash-part limit.
  // (Read through the context's own global: a var without an initialiser does not show on the sandbox object.)
  const probe = vm.createContext({});
  const globals = () => vm.runInContext('Object.getOwnPropertyNames(this)', probe);
  const before = new Set(globals());
  vm.runInContext(tpl(read('main.js')), probe);
  const life = ['onLoad', 'evaluate', 'onExerciseStart', 'onExercisePause', 'onExerciseContinue', 'onExerciseEnd', 'onLap', 'onAutoLap',
    'getUserInterface', 'getSummaryOutputs'];
  const names = globals().filter((n) => !before.has(n) && life.indexOf(n) < 0);
  ok(names.length <= 56, 'main.js has at most 56 module-level names (' + names.length + ')', names.join(' '));

  // Registration done (ext13.js returns 3) re-enters setup on the next tick to load ext7.js. A 101 that arrives first wins
  // (LOST, nothing loaded), and the next 100 loads ext7.js without registering again; a 112 cannot cancel the re-entry.
  for (const ev of [101, 112]) {
    const x = boot({ connectRet: 5 }).tick(1);
    let t = 0;
    while (!(x.ctx.lk === 100 && x.ctx.st === 2 && x.ctx.stp === 0) && t < 30) { x.tick(1); t++; }
    ok(x.ctx.lk === 100 && x.ctx.prof.rg === -1 && x.ids('regUuid') === '1,2,3,4', 'registration done after ' + t + ' ticks: re-entry pending', x.ids('regUuid'));
    const n = x.ctx.__loaded.length;
    x.emit(0, ev).tick(1);
    if (ev === 101) {
      ok(x.ctx.st === 5 && x.ctx.stp === 0 && x.ctx.__loaded.length === n && /^LOST/.test(x.text('#st')), '101 before the re-entry: LOST, ext7.js not loaded', x.text('#st'));
      x.tick(3).emit(0, 100).tick(15);
    } else {
      ok(x.ctx.st === 2 && typeof x.ctx.stp === 'function' && x.ctx.__loaded.slice(n).join() === 'ext7.js', '112 in the same window: ext7.js still loaded', x.ctx.__loaded.slice(n).join());
      x.tick(15);
    }
    ok(x.ctx.st === 4 && x.text('#st') === '' && x.ids('regUuid') === '1,2,3,4' && x.count('readChar', 3) === 1 && x.conn.violations.length === 0,
      'after a ' + ev + ' at the re-entry: battery read once, LIVE, nothing registered twice', [x.text('#st'), x.ids('regUuid')].join(' '));
  }

  // Battery: a percentage p is stored as -1 - p (no separate kind flag); low is below 15 % or below 2,500 mV. With no
  // sensor row, a low battery is the one state word LIVE shows (orange, at the top); otherwise LIVE shows none.
  for (const [pct, want] of [[10, EN.batLow], [14, EN.batLow], [15, ''], [0, EN.batLow], [100, '']]) {
    const b = boot({ connectRet: 5, data: { sensor: '1' }, respond: (fn, id) => {
      if (fn === 'regUuid') return [107];
      if (fn === 'enaCharNotf') return [id === 6 || id === 8 ? 109 : 110];
      if (fn === 'readChar') return [102, [pct]];
      return null;
    } }).tick(17);
    b.emit(6, 106, [0x8A, 0x09]).tick(1);
    ok(b.text('#st') === want && b.ctx.bat === -1 - pct && b.ctx.has === 1, 'percent battery ' + pct + ' % -> ' + (want ? '"' + want + '"' : 'no state word'), b.text('#st') + ' bat=' + b.ctx.bat);
  }
  for (const [mv, want] of [[2400, EN.batLow], [2499, EN.batLow], [2500, ''], [3010, '']]) {
    const b = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && id === 3 ? [102, [mv & 255, mv >> 8, 0x2E, 0x09]] : defaultRespond({})(fn, id)) }).tick(20);
    ok(b.text('#st') === want && b.ctx.bat === mv && b.ctx.has === 1, 'mV battery ' + mv + ' -> ' + (want ? '"' + want + '"' : 'no state word'), b.text('#st'));
  }
  // BAT LOW gives way to a problem state and comes back with LIVE.
  const bl = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' && id === 3 ? [102, [0x60, 0x09, 0x2E, 0x09]] : defaultRespond({})(fn, id)) }).tick(20);
  bl.emit(0, 101).tick(2);
  const blLost = bl.text('#st');
  bl.emit(0, 100).tick(15);
  ok(/^LOST/.test(blLost) && bl.text('#st') === EN.batLow && bl.ctx.bat === 2400, 'low battery: LOST while lost, BAT LOW again once LIVE', blLost + ' / ' + bl.text('#st'));

  // The store package carries no demo or debug code; the variants are built from it and keep the same static rules.
  const lean = read('main.js');
  ok(!/\bdemo\b|\bbt\.|G\.g\(|G\.d\b|systemEvent/.test(lean.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) && !fs.existsSync(path.join(APP, 'ext5.js')),
    'store main.js has no demo or debug hooks, and the store package no demo shim');
  const vf = VARIANT.build('demo,debug');
  for (const f of ['main.js', 'ext5.js', 'ext6.js']) {
    const lines = vf[f].split('\n');
    const code = lines.filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    const bad = ['=>', 'let ', 'const ', '`', 'class ', 'Date', 'Int16Array', 'Uint16Array', 'Int32Array'].filter((k) => code.indexOf(k) >= 0);
    ok(/^\/\/ ABOUTME: .+/.test(lines[0]) && /^\/\/ ABOUTME: .+/.test(lines[1]) && bad.length === 0 && !/[=(,:]\s*\/[^/*]/.test(code),
      'demo+debug variant ' + f + ': ABOUTME header, ES5, no regex', bad.join(' '));
  }
  let isFn = false;
  try { isFn = typeof vm.runInNewContext('(' + vf['ext5.js'] + '\n)') === 'function'; } catch (e) { isFn = false; }
  ok(isFn, 'demo ext5.js is a single function expression');
  ok(JSON.parse(vf['data.json']).demo === '0' && JSON.parse(vf['data.json']).debug === '1', 'variant data.json: demo 0, debug 1');
  // Store-shot keys patch the demo's ext5.js (not data.json) and refuse anything that is not a number.
  const shotF = VARIANT.build('demo', { demo: '6', base: '-14.6', ramp: '-3.5', rh: '91', f: '1', drop: '1' });
  ok(/var base = -14\.6, ramp = -3\.5;/.test(shotF['ext5.js']) && /return 91 - 1\.5/.test(shotF['ext5.js']) && /f: true,/.test(shotF['ext5.js']) && /\(scn == 3 \|\| true\)/.test(shotF['ext5.js']) &&
    !('base' in JSON.parse(shotF['data.json'])) && JSON.parse(shotF['data.json']).demo === '6', 'store-shot keys patch ext5.js and stay out of data.json');
  let refused = 0;
  for (const [fl, d] of [[undefined, { base: '1' }], ['demo', { base: '1;x' }], ['demo', { rh: '' }]]) { try { VARIANT.build(fl, d); } catch (e) { refused++; } }
  ok(refused === 3, 'store-shot keys need the demo variant and numbers', refused);
  const sh1 = boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '6' }, shot: { base: '-14.6', ramp: '-3.5', rh: '91' } }).tick(15);
  ok(sh1.text('#t') === '-14.6' && sh1.text('#rh') === '91%' && sh1.text('#st') === '', 'store shot 1 from keys: -14.6, 91 %, no state word', [sh1.text('#t'), sh1.text('#rh')].join(' '));
}

// =====================================================================
section('T22 screen pass 2026-10-04: no sensor row, no LIVE or DEMO word, grey stale value, humidity on the trend line');
{
  // setText is not proven to change a hidden element: no text may go to an element hidden at that moment. The template
  // starts with #t #u #tr #ar #w hidden and #st #g #v #hn visible.
  const hiddenWrites = (x) => {
    const vis = { '#t': 0, '#u': 0, '#tr': 0, '#ar': 0, '#w': 0, '#st': 1, '#g': 1, '#v': 1, '#hn': 1 };
    const bad = [];
    for (const l of x.ui.log) {
      let m = /^style (#\w+) visibility (\w+)$/.exec(l);
      if (m) {
        for (const id of { '#tg': ['#t', '#u'], '#tl': ['#ar', '#tr'], '#gg': ['#g', '#v'] }[m[1]] || [m[1]]) vis[id] = m[2] === 'VISIBLE' ? 1 : 0;
        continue;
      }
      m = /^text (#\w+) /.exec(l);
      if (m && vis[m[1]] === 0) bad.push(l);
    }
    return bad;
  };
  const tpl = read('t.html');
  ok(!/id="(sn|rh)"/.test(tpl) && /id="st" class="[^"]*sp-c-orange/.test(tpl), 'template: no sensor row, no humidity column; the state word is orange (static class)');
  {
    // Every div shown or hidden also gets the same call for its contents ('#x *'), in every state.
    const x = boot({ connectRet: 5, T: 12.5 }).tick(20).emit(0, 101).tick(130).emit(0, 100).tick(40);
    const lg = x.ui.log, bad = [];
    lg.forEach((l, n) => { const m = /^style (#\w+) visibility (\w+)$/.exec(l); if (m && lg[n + 1] !== 'style ' + m[1] + ' * visibility ' + m[2]) bad.push(l); });
    ok(bad.length === 0 && x.conn.violations.length === 0 && lg.some((l) => / \* visibility/.test(l)), 'every visibility change is also sent to the div contents', bad.slice(0, 3).join(' | ') + x.conn.violations.slice(0, 2).join(' | '));
  }
  ok(!/<span[^>]*visibility/.test(tpl), 'template: no span carries visibility (a hidden span did not show again on the watch, 2026-10-04)');
  ok(/id="g" class="[^"]*cm-mid/.test(tpl) && /id="v" class="[^"]*cm-mid/.test(tpl), 'template: the grey copy of the number row uses the theme grey (cm-mid)');
  // The hint has its own centred line: in the trend row the hidden arrow keeps its width and pushed hints off centre.
  ok(/id="hn" class="[^"]*p-hc/.test(tpl) && !/id="hn"[^>]*sp-vertical-center/.test(tpl), 'template: the hint line #hn is a centred element of its own');
  const hs = boot({ connectRet: 5, T: 12.5 }).tick(20).emit(0, 101).tick(1);
  ok(hs.ui.text['#hn'] === EN.h5 && hs.ui.style['#tr visibility'] === 'HIDDEN' && hs.ui.style['#hn visibility'] === 'VISIBLE' && hs.ui.style['#ar visibility'] === 'HIDDEN',
    'LOST: the hint goes to the centred line, the trend row is hidden', hs.ui.text['#hn']);
  hs.emit(0, 100).tick(15);
  ok(/°\/h|RH/.test(hs.ui.text['#tr']) && hs.ui.style['#tr visibility'] === 'VISIBLE' && hs.ui.style['#hn visibility'] === 'HIDDEN', 'linked again: the trend row is back', hs.ui.text['#tr']);
  // A run through every state, in both units, with a full refresh every 10 ticks.
  let alive = true;
  const runs = [
    boot({ connectRet: 5, wrist: 304.15, respond: (fn, id) => (fn === 'readChar' && !alive ? [103] : defaultRespond({ T: 12.5 })(fn, id)) }),
    boot({ connectRet: 5, units: 1, wrist: 304.15, data: { sensor: '2' } }),
    boot({ connectRet: 5, autoLink: false }),
    boot({ variant: 'demo', connectRet: undefined, zappId: function () {}, data: { demo: '3' } }),
  ];
  runs[0].tick(30);
  alive = false;
  runs[0].tick(60);
  alive = true;
  runs[0].tick(20).emit(0, 101).tick(130).emit(0, 100).tick(20);
  runs[1].tick(40).emit(0, 101).tick(10).emit(0, 100).tick(20);
  runs[2].tick(40);
  runs[3].tick(60);
  ok(runs.every((x) => hiddenWrites(x).length === 0), 'no setText to a hidden element in any state (LIVE, NO DATA, LOST, SEARCHING, demo)', runs.map((x) => hiddenWrites(x).slice(0, 2).join(';')).join(' | '));
  // The grey and bright rows switch together, and the number moves with them.
  const sw = boot({ connectRet: 5, T: 12.5 }).tick(20);
  ok(!sw.dim() && sw.ui.style['#t visibility'] === 'VISIBLE' && sw.ui.style['#u visibility'] === 'VISIBLE' && sw.ui.style['#v visibility'] === 'HIDDEN' && sw.ui.text['#t'] === '12.5',
    'LIVE: bright number and unit, grey row hidden', sw.ui.text['#t']);
  sw.emit(0, 101).tick(1);
  ok(sw.dim() && sw.ui.style['#v visibility'] === 'VISIBLE' && sw.ui.style['#u visibility'] === 'HIDDEN' && sw.ui.text['#g'] === '12.5' && sw.ui.text['#v'] === '°C',
    'LOST: the same value and unit in the grey row', [sw.ui.text['#g'], sw.ui.text['#v']].join(''));
  sw.emit(0, 100).tick(15);
  ok(!sw.dim() && sw.text('#t') === '12.5', 'linked again: bright');
  // One state word at most, and only when something needs attention.
  const fine = boot({ connectRet: 5 }).tick(30);
  ok(fine.ui.style['#st visibility'] === 'HIDDEN' && fine.text('#st') === '', 'LIVE with a good battery: no state word');
  const conn = boot({ connectRet: 5, respond: (fn, id) => (fn === 'readChar' ? null : defaultRespond({})(fn, id)) }).tick(12);
  ok(conn.text('#st') === EN.stConn, 'CONNECTING still shows (short-lived)', conn.text('#st'));
  // Hints that are new in this pass fit the n display by length (the screenshots are the real check).
  ok(EN.h7 === 'Sensor went quiet', 'data-stopped hint', EN.h7);
}

// =====================================================================
section('T19 every glyph written at run time exists in its element\'s watch font (n, o, q)');
{
  // The simulator draws with desktop fonts, and the Editor checks only literal template text, so runtime strings are
  // checked here: every character any test above wrote into an element.
  let lib = null;
  try {
    const L = path.join(os.homedir(), '.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib');
    lib = { css: require(path.join(L, 'html/css-transform.js')).CssTransform, cs: require(path.join(L, 'ng/charset.js')).getCharsets };
  } catch (e) { console.log('  SKIP Editor 1.42.0 build library not found: font check not run'); }
  if (lib) {
    const ids = ['#st', '#t', '#u', '#g', '#v', '#ar', '#tr', '#hn', '#mn', '#mx'];
    ok(ids.every((id) => SEEN[id] && SEEN[id].size > 0), 'every text slot was exercised', ids.filter((id) => !SEEN[id]).join());
    for (const d of ['q', 'o', 'n']) {
      const t = new lib.css('t.html', d, read('t.html'), APP);
      t.transform();
      const html = t.getHtml();
      for (const id of ids) {
        const m = html.match(new RegExp('id="' + id.slice(1) + '"[^>]*class="([^"]*)"')) || html.match(new RegExp('class="([^"]*)"[^>]*id="' + id.slice(1) + '"'));
        const font = m && m[1].split(' ').find((c) => /^f-/.test(c));
        const set = font && lib.cs(d).get(font);
        const miss = set ? [...(SEEN[id] || [])].filter((ch) => ch.trim() && !set.has(ch)) : ['no font'];
        ok(miss.length === 0, d + ' ' + id + ' (' + font + '): ' + (SEEN[id] ? SEEN[id].size : 0) + ' distinct characters all in the font',
          miss.map((ch) => ch + ' U+' + ch.charCodeAt(0).toString(16).toUpperCase()).join(' '));
      }
    }
    ok([...SEEN['#ar']].join('').indexOf('\u2197') >= 0 && [...SEEN['#ar']].join('').indexOf('\u2193') >= 0, 'all five arrows were among the checked glyphs');
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
