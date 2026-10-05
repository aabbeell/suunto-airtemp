#!/usr/bin/env node
// ABOUTME: Builds the demo (simulator) and debug (hardware-test) variants of Air Temperature from the lean store source in src/air_temperature.
// ABOUTME: Usage: node test/variant.js <demo|debug|demo,debug> <outDir> [key=value ...] (data.json overrides, store-shot keys); run.js uses build().

// The store build carries no demo or debug code: every byte of main.js costs heap on the watch (about 3.3 B resident and
// 1 B of compile transient per minified byte). The hooks are added back here by exact text patches; each must match
// exactly once, so a change to the lean source that moves an anchor fails loudly (run.js builds both variants).
// Demo: a simulator-only fake appConn (demo/ext5.js) driven through the real state machine, parsers and UI (SPEC §13,
// §22.11). Debug: the '[AT] ...' system-event trace and the memory-pool probe used by the hardware test (H13, H14).

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../src/air_temperature');
const DEMO_EXT5 = path.join(__dirname, 'demo/ext5.js');

const patch = (files, name, pairs) => {
  let s = files[name];
  for (const [old, neu] of pairs) {
    const n = s.split(old).length - 1;
    if (n !== 1) throw new Error('variant patch for ' + name + ': expected 1 match, found ' + n + ' for: ' + old.slice(0, 120));
    s = s.replace(old, () => neu);
  }
  files[name] = s;
};

// The demo hooks: bt replaces appConn (the simulator's stub first, then the fake), forced F for scenario 5, the fake's
// wrist value, its per-tick clock, con 4, and stats that the pre-seed filled. The demo shows no tag on screen: it exists
// only in this simulator variant, and a tag would take the space the real screen gives the data.
const demo = (files) => {
  patch(files, 'main.js', [
    ['var G, prof, S;', 'var G, prof, S, bt, demo = 0;'],
    ["    st = 1;\n    call(100);\n    // A connect that returns nothing (the simulator's stub) cannot be used: BT ERROR.\n    if (typeof G.c === 'undefined') st = 7;\n",
      "    bt = appConn;\n    st = 1;\n    call(100);\n" +
      "    // The simulator stubs appConn (connect returns undefined) and sets enabledZappId to a function; a watch never does both.\n" +
      "    if (typeof G.c === 'undefined') {\n      if (typeof enabledZappId === 'function') {\n        demo = 1;\n" +
      '        // The demo pre-seeds 10 minutes of history through stat(), so the trend and min/max show at once.\n' +
      "        bt = evalFile('{file_path}/ext5.js')(prof, G, function (t, h) { run = has = 1; tC = t; rh = h; age = 0; stat(); });\n" +
      '        has = 0;\n        age = 99999;\n        call(100);\n      } else st = 7;\n    }\n'],
    ['G.c = appConn.connect(', 'G.c = bt.connect('],
    ['appConn.regUuid(', 'bt.regUuid('],
    ['appConn.enaCharNotf(', 'bt.enaCharNotf('],
    ['appConn.writeChar(', 'bt.writeChar('],
    ['appConn.readChar(', 'bt.readChar('],
    ['  if (isFinite(input.units)) imp = input.units == 1 ? 1 : 0;\n',
      '  if (isFinite(input.units)) imp = input.units == 1 ? 1 : 0;\n  if (demo && bt.f) imp = 1;\n'],
    ['  step();\n  stat();\n', '  if (demo) bt.t();\n  step();\n  stat();\n'],
    ['  output.con = con;', '  output.con = demo ? 4 : con;'],
    ['  run = 1;\n  mn = 999;\n  mx = -999;\n  sC = nC = sH = nH = 0;\n', '  run = 1;\n  if (!demo) {\n    mn = 999;\n    mx = -999;\n    sC = nC = sH = nH = 0;\n  }\n'],
  ]);
  // ext6: the demo scenario setting (0-6, default 0) as G.n.
  patch(files, 'ext6.js', [
    ['  return x;', "  // Demo variant: scenario 0-6 (data.json demo).\n  i = +ls.getItem('demo') | 0;\n  x.n = i < 0 || i > 6 ? 0 : i;\n  return x;"],
  ]);
  files['ext5.js'] = fs.readFileSync(DEMO_EXT5, 'utf8');
  setData(files, { demo: '0' });
};

// The debug trace: connect result, every BLE event, thrown calls, unparsable frames and the memory pool every 60 s.
const debug = (files) => {
  const isDemo = /\bdemo = 0;/.test(files['main.js']);
  patch(files, 'main.js', [
    ['    return;\n  }\n  if (ev != 100) {',
      "    if (G.d) G.g('connect called', typeof enabledZappId, G.c, " + (isDemo ? 'demo' : '0') + ');\n    return;\n  }\n  if (ev != 100) {'],
    ['    else opRes = 3;\n', "    else opRes = 3;\n    if (G.d) G.g('api', ev, id, e);\n"],
    ['  var r, t, h;\n', "  var r, t, h;\n  if (G.d) G.g('ev', ev, ch, st);\n"],
    ['  if (!prof.p(r, d, pr)) return;\n', "  if (!prof.p(r, d, pr)) {\n    if (G.d) G.g('bad', ch, d.length, '');\n    return;\n  }\n"],
    ['  if (!st) call(0);\n', "  if (!st) call(0);\n  if (G.d && !(tk % 60)) G.g('mem', tk, '', '');\n"],
    // The screen trace (hardware 2026-10-04, blank air value): the number, the group switch and the state word as sent.
    ['    K[i] = k;\n', "    K[i] = k;\n    if (G.d && (i == 1 || i > 8)) G.g('put', i, k, K[11]);\n"],
  ]);
  // ext6: the debug setting as G.d and, when it is on, the logger G.g (a closure: debug builds only).
  patch(files, 'ext6.js', [
    ['  return x;', "  // Debug variant: the system-event trace, and (for 'mem') the JS memory pool use via the undocumented resource.\n" +
      "  x.d = ls.getItem('debug') == '1' ? 1 : 0;\n  x.g = 0;\n  if (x.d) {\n    x.g = function (w, a, b, c) {\n" +
      "      systemEvent('[AT] ' + w + ' ' + a + ' ' + b + ' ' + c);\n      if (w != 'mem') return;\n      try {\n" +
      "        $.get('/Ui/Script/MemoryPool/Allocated', function (v) { systemEvent('[AT] mem ' + v); });\n" +
      "      } catch (e) {\n        systemEvent('[AT] mem ?');\n      }\n    };\n  }\n  return x;"],
  ]);
  setData(files, { debug: '1' });
};

// Store-shot keys (demo only, not written to data.json): base and ramp (air C at the start and C/h), rh (humidity % at
// base), f=1 (show F), drop=1 (scenario 3's link drop in any scenario). They patch the variant's copy of ext5.js, so a
// store image is one command instead of a hand-edited copy.
const SHOT = ['base', 'ramp', 'rh', 'f', 'drop'];
const shot = (files, kv) => {
  if (!files['ext5.js']) throw new Error('store-shot keys (' + Object.keys(kv).join(', ') + ') need the demo variant');
  const num = (k) => {
    const v = Number(kv[k]);
    if (kv[k] === '' || !isFinite(v)) throw new Error('store-shot key ' + k + ' must be a number: ' + kv[k]);
    return String(v);
  };
  const p = [];
  if ('base' in kv || 'ramp' in kv) {
    p.push(['var base = scn == 5 ? 40 : -8, ramp = scn == 5 ? 0.6 : -2;',
      'var base = ' + ('base' in kv ? num('base') : '(scn == 5 ? 40 : -8)') + ', ramp = ' + ('ramp' in kv ? num('ramp') : '(scn == 5 ? 0.6 : -2)') + ';']);
  }
  if ('rh' in kv) p.push(['return 82 - 1.5 * (v - base);', 'return ' + num('rh') + ' - 1.5 * (v - base);']);
  if ('f' in kv) p.push(['f: scn == 5,', 'f: ' + (kv.f === '1') + ',']);
  if ('drop' in kv) p.push(['if (scn == 3 && up && frames', 'if ((scn == 3 || ' + (kv.drop === '1') + ') && up && frames']);
  patch(files, 'ext5.js', p);
};

const setData = (files, kv) => {
  const d = JSON.parse(files['data.json']);
  Object.assign(d, kv);
  files['data.json'] = JSON.stringify(d, null, 2) + '\n';
};

// All top-level files of the app (what the source package takes), with the variant's patches applied. flags: 'demo',
// 'debug' or 'demo,debug'; data: data.json overrides.
const build = (flags, data) => {
  const want = String(flags || '').split(',').filter(Boolean);
  for (const f of want) if (f !== 'demo' && f !== 'debug') throw new Error('unknown variant ' + f);
  const files = {};
  for (const f of fs.readdirSync(SRC)) if (fs.statSync(path.join(SRC, f)).isFile()) files[f] = fs.readFileSync(path.join(SRC, f), 'utf8');
  if (want.indexOf('demo') >= 0) demo(files);
  if (want.indexOf('debug') >= 0) debug(files);
  if (data) {
    const kv = {};
    const rest = {};
    for (const k of Object.keys(data)) (SHOT.indexOf(k) >= 0 ? kv : rest)[k] = data[k];
    if (Object.keys(kv).length) shot(files, kv);
    setData(files, rest);
  }
  return files;
};

module.exports = { build };

if (require.main === module) {
  const [flags, out, ...kv] = process.argv.slice(2);
  if (!flags || !out) {
    console.error('usage: node test/variant.js <demo|debug|demo,debug> <outDir> [key=value ...]');
    console.error('  key=value: data.json overrides (demo=0..6, sensor, name, poll, debug) and, for demo, the store-shot keys');
    console.error('  base=<C> ramp=<C/h> rh=<%> f=1 drop=1');
    process.exit(2);
  }
  const dir = path.resolve(out);
  if (dir === path.resolve(SRC) || dir.startsWith(path.resolve(SRC) + path.sep)) {
    console.error('refusing to write a variant into the store source ' + SRC);
    process.exit(2);
  }
  const data = {};
  for (const p of kv) {
    const i = p.indexOf('=');
    if (i < 1) { console.error('bad override ' + p); process.exit(2); }
    data[p.slice(0, i)] = p.slice(i + 1);
  }
  const files = build(flags, data);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of Object.keys(files)) fs.writeFileSync(path.join(dir, f), files[f]);
  console.log('wrote ' + Object.keys(files).length + ' files (' + flags + ') to ' + dir);
}
