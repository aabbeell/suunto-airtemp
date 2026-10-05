#!/usr/bin/env node
// ABOUTME: Runs every Air Temperature sp-mem scenario on an app dir (lowmem, shipped form) and prints one row of est32 numbers each.
// ABOUTME: Usage: node test/mem/summary.js [appDir] [--quick]; needs ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem built (build.sh).

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SPMEM = path.join(ROOT, '../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/sp-mem.js');
const args = process.argv.slice(2);
const app = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'src/air_temperature'));
const quick = args.indexOf('--quick') >= 0;
const M = (f) => path.join(__dirname, f);

// [label, scenario, --set overrides]
const RUNS = [
  ['sensorpush', 'sensorpush.js', []],
  ['idle', 'idle.js', []],
  ['idle-name', 'idle.js', ['sensor=1', 'name=ATC_A1B2C3']],
  ['xiaomi', 'xiaomi.js', []],
  ['ruuvi', 'flap.js', ['sensor=2', 'flap=0']],
  ['ess', 'ess.js', []],
  ['ess-u8', 'ess.js', ['type=uint8array', 'every=1']],
  ['readfail', 'readfail.js', []],
  ['flap7', 'flap.js', ['sensor=0', 'flap=7']],
  ['worst', 'worst.js', []],
  ['long2h', 'long.js', []],
];

const num = (s) => parseInt(String(s).replace(/,/g, ''), 10);
const one = (scn, sets) => {
  const jf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-mem-')), 'r.json');
  const a = [SPMEM, app, '--variants', 'lowmem', '--forms', 'shipped', '--json', jf, '--scenario', M(scn)];
  for (const s of sets) a.push('--set', s);
  const r = spawnSync('node', a, { encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = r.stdout + r.stderr;
  const row = (label) => (out.split('\n').find((l) => l.startsWith(label)) || '').trim().split(/\s{2,}/);
  const J = JSON.parse(fs.readFileSync(jf, 'utf8')).results['lowmem/shipped'];
  const cp = (l) => J.checkpoints.find((c) => c.label === l);
  const ticks = J.ticks.filter((t) => t[0] > 0);
  const garbage = ticks.map((t) => Math.max(0, t[7]));
  const st = cp('steady state');
  const scope = st.walk.appTopBlocks.find((x) => x[2] === 'scopes');
  const errs = out.split('\n').filter((l) => /app errors|refused/i.test(l) && !/\b0\b/.test(l));
  return {
    steady: num(row('steady state')[2]),
    loadPeak: num(row('load peak')[2]),
    runPeak: num(row('run peak')[2]),
    fnBlock: num(row('largest compiled-function data block')[2]),
    appBlock: num(row('largest live app block')[2]) + ' ' + (row('largest live app block')[3] || ''),
    scope: scope ? scope[0] : '<' + st.walk.appTopBlocks[st.walk.appTopBlocks.length - 1][0],
    garbAvg: Math.round(garbage.reduce((x, y) => x + y, 0) / Math.max(1, garbage.length)),
    garbMax: Math.max.apply(null, garbage.concat(0)),
    garbTicks: garbage.filter((g) => g > 0).length,
    growth: (out.split('\n').find((l) => /^lowmem\s/.test(l)) || '').trim().split(/\s{2,}/).pop(),
    out: ((out.split('\n').find((l) => /outputs at end/.test(l)) || '').trim()).replace('outputs at end: ', ''),
    errs: errs.length,
  };
};

if (!fs.existsSync(SPMEM)) {
  console.error('sp-mem not found at ' + SPMEM);
  process.exit(2);
}
console.log('app ' + app + ' (lowmem est32, shipped form; garbage = host bytes freed only by the tick-end mark-and-sweep)');
console.log(['scenario', 'steady', 'loadPk', 'runPk', 'fnBlk', 'scope', 'garb avg/max (ticks)', 'growth', 'outputs at end'].join('\t'));
for (const [label, scn, sets] of quick ? RUNS.slice(0, 1) : RUNS) {
  const r = one(scn, sets);
  console.log([label.padEnd(10), r.steady, r.loadPeak, r.runPeak, r.fnBlock, r.scope, r.garbAvg + '/' + r.garbMax + ' (' + r.garbTicks + ')',
    r.growth, r.out + (r.errs ? ' ERRORS' : '')].join('\t'));
}
