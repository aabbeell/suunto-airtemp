// ABOUTME: AirTemp for Suunto, a SuuntoPlus device app that shows air temperature and humidity from an off-wrist BLE sensor.
// ABOUTME: Hot path (BLE events, sample checks, polling, stats, trend, screen) plus the tick-1 connect; profiles ext1-4.js, cold code ext6-15.js.

// st (link state): 0 INIT, 1 LINK (waiting for 100), 2 SETUP (ext13.js registers on the first link, then ext7.js), 4 RUN,
// 5 LOST (after 101), 6 WRONG sensor, 7 FAIL.
// op: the pending call's success event (107 regUuid, 109 enaCharNotf, 104 writeChar, 102 readChar); op + 1 is its failure event;
// oc: the characteristic id it was made for. opRes: 0 pending, 1 done, 2 refused (op + 1), 3 threw or timed out.
// Roles: 1 T (0.01 C), 2 T1 (0.1 C), 3 H, 4 B (mV), 5 BP (%), 6 F (frame with T, H, battery), 7 L (LED).
// UI state us: 0 SEARCHING, 1 CONNECTING, 2 LIVE (no state word), 3 NO DATA, 4 LOST, 5 LOST > 2 min, 6 WRONG SENSOR,
// 7 BT ERROR. The demo (simulator) and debug variants are built by test/variant.js; the store build has
// neither.

// Initial values live here (top-level code) so the lifecycle dispatcher the minifier builds stays small.
// At most 56 module-level names (54 now, the 8 helpers included): lowmem Duktape gives an object of more than 64 property
// slots a 256-entry hash part, which would more than double the module scope record (about 0.7 KB to 1.9 KB). Rarely used
// state therefore lives in G.
// G: settings and cold state from ext6.js: s profile file, p poll period, x sensor-name problem (1 bad, 2 not used by
// this profile; shown as a hint while searching), a/b sensor-name connect params (dropped on the first link), c
// connection id (undefined until connect returns one), y con was once non-zero, r connect retries after 112, w ticks
// until the next retry.
// bat: battery in mV, or a percentage p stored as -1 - p.
var G, prof, S;
var st = 0, op = 0, oc = 0, opAge = 0, opRes = 0, lk = 0, ever = 0, la = 0, con = 0, stp = 0;
var nn = 0, nw = 0, ps = 0, pollT = 0, fails = 0, rc = new Int8Array(16), pr = new Array(4);
var tC = NaN, rh = NaN, bat = NaN, cand = NaN, has = 0, age = 99999, hAge = 0, imp = 0;
var run = 0, mn = 999, mx = -999, sC = 0, nC = 0, sH = 0, nH = 0;
var ring = new Float32Array(30), ri = 0, wT = 0, wS = 0, wN = 0, rate = NaN;
var K = new Array(12), rs = 3, tk = 0, rnd = Math.round;
// Translated strings: 0-7 state words (by us; LIVE shows none, so 2 is BAT LOW, the one word LIVE can show), 8 unused,
// 9-17 hints 1-9 (key 1e9 + n; 8 and 9 are the sensor-name problems), 18-25 element ids of text slots 0-7 (7 is the
// humidity on the top line, shown when the state word is not), 27 the state word (visibility slot 9; 26 and 28 unused), 29-32 the bright
// and the grey group of slot 11 (the number row div, and the trend line div or the centred hint line), 33-34 the grey
// number and unit. The summary names are tokens in
// ext8.js (the watch build translates ext files; only the simulator shows them raw). No runtime colour or opacity:
// runtime setStyle is proven on hardware only for visibility (deep-dive refresh-rate). Colour is static in t.html (the
// orange state word, the grey copy of the number for a stale value), switched by visibility.
var TX = ['{{stSearch}}', '{{stConn}}', '{{batLow}}', '{{stNoData}}', '{{stLost}}', '{{stLost}}', '{{stWrong}}', '{{stFail}}',
  '', '{{h1}}', '{{h2}}', '{{h3}}', '{{h4}}', '{{h5}}', '{{h6}}', '{{h7}}', '{{nameBad}}', '{{nameOff}}',
  '#st', '#t', '#u', '#ar', '#tr', '#mn', '#mx', '#ti', '', '#st', '', '#tg', '#tl', '#gg', '#hn', '#g', '#v'];

// Every appConn call goes through here, inside try/catch: an uncaught BLE error makes the firmware disable the app.
// 0 = the first connect (tick 1), 100 = connect; otherwise the call becomes the one pending operation, completed by the
// handler or a 5-tick timeout.
var call = function (ev, id, x, y) {
  if (!ev) {
    // appConn is not defined yet during onLoad in the simulator, so it is first touched here, as in the official template.
    st = 1;
    call(100);
    // A connect that returns nothing (the simulator's stub) cannot be used: BT ERROR.
    if (typeof G.c === 'undefined') st = 7;
    return;
  }
  if (ev != 100) {
    op = ev;
    oc = id;
    opAge = opRes = 0;
  }
  try {
    if (ev == 100) {
      // The connect params come from the profile's table file ext9-12.js (or the sensor name), loaded only for this call.
      // Its prototype is dropped (a function and its prototype reference each other), so refcounting frees it at once.
      x = evalFile('{file_path}/ext' + (G.s + 8) + '.js');
      x.prototype = null;
      x = x(G);
      G.c = appConn.connect(enabledZappId, onBle, x.a, x.b);
    } else if (ev == 107) appConn.regUuid(G.c, id, x, y);
    else if (ev == 109) appConn.enaCharNotf(G.c, id);
    else if (ev == 104) appConn.writeChar(G.c, id, x);
    else appConn.readChar(G.c, id);
  } catch (e) {
    // A thrown connect is handled like event 112 (bounded retry, then BT ERROR); any other call ends as 'threw' (3).
    if (ev == 100) lk = 112;
    else opRes = 3;
  }
};

// BLE event handler: records link events and call results, parses data. Allocates nothing; evaluate() publishes.
var onBle = function (ch, ev, d) {
  var r, t, h;
  // A 112 (connect failed) never hides a 100 or 101 that arrived in the same tick.
  if (ev == 100 || ev == 101 || ev == 112) {
    if (ev != 112 || !lk) lk = ev;
    return;
  }
  // A late answer to an operation that already timed out names another characteristic, so it completes nothing.
  if (op && ch == oc && ev >= op && ev - op < 2) opRes = ev - op + 1;
  r = rc[ch];
  if ((ev != 102 && ev != 106 && ev != 115) || !r || !d) return;
  pr[0] = pr[1] = pr[2] = NaN;
  if (!prof.p(r, d, pr)) return;
  t = pr[0];
  h = pr[1];
  if (pr[2] === pr[2]) bat = pr[3] ? -1 - pr[2] : pr[2];
  // Humidity: 100-105 % is clamped, anything else outside 0-100 dropped. The id that delivers becomes the one polled.
  if (h >= 0 && h <= 105) {
    rh = h > 100 ? 100 : h;
    hAge = 0;
    if (r == 3) prof.h = ch;
  }
  if (t >= -60 && t <= 85) {
    if (ev != 102) { nw = 0; nn = 1; }
    if (r != 3) prof.t = ch;
    // A jump of more than 10 C since a sample that is still fresh (age <= S, so also at 60 s polling) is held until the
    // next sample confirms it: a second sample on the same side of tC (a real fast change keeps going one way; a single
    // glitch is followed by a normal value). NaN cand compares false, so the first out-of-band sample is always held.
    if (has && age <= S && (t - tC > 10 || tC - t > 10) && !((cand - tC) * (t - tC) > 0)) {
      cand = t;
      return;
    }
    tC = t;
    age = fails = 0;
    has = 1;
    cand = NaN;
  }
};

// Link state machine; issues at most one BLE call per tick.
var step = function () {
  var r = 0, n;
  if (lk == 100 && st > 0 && st < 6) {
    // The connect params are not needed again: after the first link the system reconnects by itself.
    ever = 1;
    // con 1 on the link itself closes the watch's Searching view. Waiting for the first frame was too slow (the Race S gives
    // up after about 24 s, a Xiaomi needs about 25 s), and con 3 made the watch drop the app as not found at once
    // (hardware 2026-10-04).
    con = 1;
    G.a = G.b = 0;
    op = la = ps = pollT = nw = nn = 0;
    st = 2;
    // ext13.js registers the candidates (first link, or resumed after a drop during it; prof.rg is -1 once done), ext7.js
    // enables notifications, reads the battery and blinks the LED (every link). The prototypes of the loaded function and
    // of the stepper it returns are dropped (each function and its prototype reference each other), so refcounting frees
    // both as soon as they are released.
    stp = evalFile('{file_path}/ext' + (prof.rg < 0 ? 7 : 13) + '.js');
    stp.prototype = null;
    // ext13.js gets the table function, not its file name: {file_path} resolves only in main.js on the watch (an ext file's
    // own evalFile fails with 'opening {file_path}/ext10.js failed', hardware 2026-10-04).
    stp = stp(prof, rc, call, prof.rg < 0 ? 0 : evalFile('{file_path}/ext' + (G.s + 8) + '.js'));
    stp.prototype = null;
  } else if (lk == 101 && ever && st > 1 && st < 6) {
    if (st != 5) la = 0;
    st = 5;
    op = con = stp = 0;
  } else if (lk == 112 && st == 1) {
    if (G.r < 3) G.w = 30;
    else st = 7;
  }
  lk = 0;
  if (op) {
    if (!opRes && ++opAge > 5) opRes = 3;
    if (!opRes) return;
    r = opRes;
    op = 0;
  }
  if (st == 1 && G.w && !--G.w) {
    G.r++;
    call(100);
  }
  if (st == 2) {
    n = stp(r);
    if (!n) return;
    stp = r = 0;
    if (n == 2) { st = 6; con = 3; return; }
    // Registered: the next tick loads ext7.js as on a reconnect (a 101 arriving first still wins: LOST, as in any setup).
    if (n == 3) { lk = 100; return; }
    st = 4;
    if (prof.k) con = 1;
  }
  if (st != 4) return;
  // Poll cycle: (SensorPush: write the trigger, then) read temperature, then humidity. The timer restarts when it ends.
  if (r && ps) {
    if (r == 1 && (ps == 1 || (ps == 2 && prof.h))) {
      ps++;
      call(102, ps == 2 ? prof.t : prof.h);
      return;
    }
    if (r > 1) {
      fails++;
      // Notify profiles: a failed fallback read moves on to the next registered id of the same kind (ext15.js). It is
      // loaded on the first failed read and kept (prototype dropped): a sensor whose reads keep failing would otherwise
      // compile it every poll cycle.
      if (prof.k == 1) {
        if (!prof.r) {
          prof.r = evalFile('{file_path}/ext15.js');
          prof.r.prototype = null;
        }
        prof.r(prof, rc, ps == 3);
      }
    }
    ps = 0;
    pollT = G.p;
  }
  // Notify profiles read instead when no data came 10 s after setup, or for one expected interval + 5 s since.
  if (--pollT <= 0 && prof.t && (!prof.k || (prof.k == 1 && nw > (nn ? prof.iv + 5 : 10)))) {
    if (prof.k) { ps = 2; call(102, prof.t); }
    else { ps = 1; call(104, prof.t, prof.tw); }
  }
};

// Once per tick after step() (and by the demo variant's pre-seed): the age counters, con, the exercise stats and the
// trend ring.
var stat = function () {
  var j, v, n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, a = -1, b = 0;
  age++;
  hAge++;
  la++;
  nw++;
  // Never trapped in Searching: until con has once been non-zero, 60 s after load closes the view whatever the link does
  // (no 100, a 101 with no reconnect). After that, a 101 sets con 0 as in the template. On the Race S the watch's own
  // Searching view gives up first, after about 24 s with no link, and treats con 3 as not found (hardware 2026-10-04).
  if ((!G.y && !con && tk >= 60) || st == 7) con = 3;
  if (st == 4 && has && age <= la) con = 1;
  if (con) G.y = 1;
  if (has && age <= S && st != 5) {
    if (run) {
      sC += tC;
      nC++;
      if (tC < mn) mn = tC;
      if (tC > mx) mx = tC;
      if (rh === rh && hAge <= S) { sH += rh; nH++; }
    }
    wS += tC;
    wN++;
  }
  if (++wT < 20) return;
  ring[ri] = wN >= 10 ? wS / wN * 10 : NaN;
  ri = (ri + 1) % 30;
  wT = wS = wN = 0;
  // Least-squares slope over the valid 20 s slots (oldest first), in C/h.
  for (j = 0; j < 30; j++) {
    v = ring[(ri + j) % 30];
    if (v === v) {
      n++;
      sx += j;
      sy += v;
      sxx += j * j;
      sxy += j * v;
      if (a < 0) a = j;
      b = j;
    }
  }
  rate = n >= 9 && b - a >= 8 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) * 18 : NaN;
};

// Text for element i from its change key k (only called when k changed). Numbers are integer tenths; 1e9 is "no value"
// and 1e9 + n hint n.
var str = function (i, k) {
  var v, s = '';
  if (!i) {
    v = k % 100000;
    // Time since the last sample (NO DATA) or the disconnect (LOST): "35s", then "1:05".
    return TX[(k / 100000) | 0] + (k < 300000 || k >= 600000 ? '' : ' ' + (v < 60 ? v + 's' : ((v / 60) | 0) + ':' + (v % 60 < 10 ? '0' : '') + v % 60));
  }
  if (i == 2) return k ? '{{TXT_FAHRENHEIT}}' : '{{TXT_CELSIUS}}';
  // The arrows exist only in f-b-m (#ar is sp-b-m) on n, o and q.
  if (i == 3) return '-→↗↑↘↓'.charAt(k);
  // Humidity, whole percent, on the top line.
  if (i == 7) return (k == 1e9 ? '--' : k) + '% RH';
  if (k > 1e9) return TX[k - 1e9 + 8];
  // Min and max carry their label: "MIN -8.0".
  if (i > 4) s = i == 5 ? '{{min}} ' : '{{max}} ';
  if (k == 1e9) return i == 4 ? '--°/h' : s + '--';
  // Tenths as text, e.g. -123 -> "-12.3"; the trend always carries a sign.
  v = k < 0 ? -k : k;
  s += (k < 0 ? '-' : i == 4 ? '+' : '') + ((v / 10) | 0) + '.' + v % 10;
  return i == 4 ? s + '°/h' : s;
};

// Send slot i only when its key changed: text slots 0-7, visibility slot 9 (the state word, or else the humidity), and
// slot 11, which
// shows the grey group while the value is not fresh: the grey copy of the number row (#g #v) instead of the bright one
// (#t #u), and the centred hint line (#hn) instead of the trend line (#tr, which the hidden arrow would push off centre).
// Number, unit and line go to the group that is visible, so a switch re-sends them (setText is not proven on hidden
// elements).
var put = function (i, k) {
  var j;
  if (k !== K[i]) {
    K[i] = k;
    if (i > 10) {
      // Each div and, with ' *', its contents: the element's own visibility alone does not show its text again on the watch
      // (reference doc setStyle example; the air value stayed blank on the Race S, 2026-10-04).
      for (j = 0; j < 8; j++) setStyle(TX[29 + (j >> 1)] + (j & 1 ? ' *' : ''), 'visibility', ((j >> 1) > 1) == k ? 'VISIBLE' : 'HIDDEN');
      K[1] = K[2] = K[3] = K[4] = NaN;
    } else if (i > 7) {
      for (j = 0; j < 4; j++) setStyle(TX[j < 2 ? 27 : 25] + (j & 1 ? ' *' : ''), 'visibility', (j < 2) == k ? 'VISIBLE' : 'HIDDEN');
      K[7] = NaN;
    }
    else setText(TX[K[11] && i && i < 5 && i != 3 ? (i == 4 ? 32 : 32 + i) : i + 18], str(i, k));
  }
};

// Push changed values to the screen; everything is re-sent every 10 ticks and for 3 ticks after a view (re)load.
// draw() does the top half and returns the UI state; evaluate() then calls rows() for the rest. Two functions keep each
// compiled block small, and calling them one after the other (not nested) keeps the value stack shallow.
var draw = function (f) {
  var i, us, m = imp ? 18 : 10;
  if (rs-- > 0 || !(tk % 10)) for (i = 0; i < 12; i++) K[i] = NaN;
  us = st == 7 ? 7 : st == 6 ? 6 : !ever ? 0 : st == 5 ? (la >= 120 ? 5 : 4)
    : f ? 2 : (!has || age > la) && la <= S && fails < 3 ? 1 : 3;
  // The (orange) state word shows only when something needs attention: none while LIVE, except BAT LOW (word 2) while
  // the sensor's battery is low (under 2.5 V or 15 %; a percentage p is stored as -1 - p). It is shown before its text
  // is sent; a hidden word keeps its last text and key.
  i = us != 2 || (bat < 0 ? bat > -16 : bat < 2500);
  put(9, i);
  // Otherwise the top line shows the humidity, under the same freshness rule as the logged output.
  if (!i) put(7, f && rh === rh && hAge <= S ? rnd(rh) : 1e9);
  // State word, with m'ss for NO DATA (since the last sample) and LOST (since the disconnect).
  if (i) put(0, us * 100000 + (us == 3 ? Math.min(has ? age : la, 99999) : us == 4 || us == 5 ? Math.min(la, 99999) : 0));
  // A value that is not fresh is drawn grey and stays (with a hint right under it) until LOST passes 2 minutes or the
  // sample is 2 minutes past S, then '--': a glance must never take an old value for a live one. Min and max keep the
  // history.
  put(11, !f);
  put(1, has && us != 5 && age < S + 120 ? rnd(tC * m + (imp ? 320 : 0)) : 1e9);
  put(2, imp);
  return us;
};

// Numbers are tenths of the shown unit: x * m + o.
var rows = function (f, us) {
  var c = (tk / 4) | 0, m = imp ? 18 : 10, o = imp ? 320 : 0, k = rate === rate && f ? rnd(rate * m) : 1e9, a;
  // Trend only while fresh, in tenths of the shown unit. The arrow is chosen from that printed number with the same
  // thresholds in either unit (1 and 3 degrees/h), so arrow and number never disagree; '-' until there is a trend. The
  // arrow is sent only while its line is shown (setText is not proven on hidden elements).
  a = k == 1e9 ? 0 : k >= 30 ? 3 : k >= 10 ? 2 : k <= -30 ? 5 : k <= -10 ? 4 : 1;
  if (f) put(3, a);
  // Under the number: the trend and the humidity while the value is fresh (CONNECTING keeps "trend …"), otherwise what
  // to do. LOST: "Reconnecting …", after 2 minutes alternating the restart hint with "Bring sensor close"; WRONG SENSOR
  // "Check Sensor setting"; BT ERROR the restart hint; NO DATA after the sensor delivered alternates "Sensor stopped
  // sending" and "Bring sensor close"; SEARCHING and NO DATA before any sample cycle hints 1-3, plus the sensor-name
  // problem if there is one. The restart hint is "Restart exercise" once an exercise ran, else "Reselect the app"
  // (device apps connect from the start menu).
  if (!f && us != 1) {
    a = run || nC ? 4 : 6;
    k = 1e9 + (us == 4 ? 5 : us == 5 ? (c % 2 ? a : 1) : us == 6 ? 3 : us == 7 ? a : us == 3 && has ? (c % 2 ? 1 : 7)
      : (a = c % (G.x ? 4 : 3)) < 3 ? 1 + a : 7 + G.x);
  }
  put(4, k);
  put(5, nC ? rnd(mn * m + o) : 1e9);
  put(6, nC ? rnd(mx * m + o) : 1e9);
};

function onLoad(input, output) {
  // Settings (localStorage is read only here: every call buffers the whole data.jsn; ext6 also clears the trend ring), then
  // the sensor profile's resident part (label, timing, parser). ext6 also drops the prototype object of every helper:
  // each function gets one that points back to it, none of them is a constructor, and the minifier discards a top-level
  // statement that would do it here.
  G = evalFile('{file_path}/ext6.js')(localStorage, ring, call, onBle, step, stat, str, put, draw, rows);
  if (G.m) {
    prof = evalFile('{file_path}/ext14.js');
    prof.prototype = null;
    prof(G, G.m);
  }
  G.m = 0;
  prof = evalFile('{file_path}/ext' + G.s + '.js')();
  S = Math.max(30, 3 * (prof.iv || G.p) + 5);
  output.con = 0;
}

function evaluate(input, output) {
  var f;
  tk++;
  if (!st) call(0);
  if (isFinite(input.units)) imp = input.units == 1 ? 1 : 0;
  step();
  stat();
  // Fresh: a recent sample, fewer than 3 failed polls in a row, and the link up (on 101 values go stale at once).
  f = has && age <= S && fails < 3 && st != 5;
  output.con = con;
  output.airT = f ? tC + 273.15 : undefined;
  output.rh = f && rh === rh && hAge <= S ? rh : undefined;
  // The graph's feed (not logged) keeps the last fresh value, so the graph never gets an undefined sample that the firmware
  // might draw as 0 K.
  if (f) output.gT = tC + 273.15;
  rows(f, draw(f));
}

function onExerciseStart() {
  run = 1;
  mn = 999;
  mx = -999;
  sC = nC = sH = nH = 0;
}

function onExercisePause() {
  run = 0;
}

function onExerciseContinue() {
  run = 1;
}

function onExerciseEnd() {
  run = 0;
}

function onLap() {
  rs = 3;
}

function onAutoLap() {
  rs = 3;
}

function getUserInterface() {
  rs = 3;
  return { template: 't' };
}

function getSummaryOutputs(input, output) {
  return nC ? evalFile('{file_path}/ext8.js')(mn, sC / nC, mx, nH ? sH / nH : NaN) : [];
}
