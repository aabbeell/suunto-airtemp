// ABOUTME: Simulator-only demo for Air Temperature: a fake appConn that answers like a real sensor of the selected profile.
// ABOUTME: Only in the demo variant (test/variant.js), whose main.js loads it when appConn.connect returns undefined and enabledZappId is a function.
function (prof, G, seed) {
  // Scenarios (data.json "demo", G.n): 0 cold live, 1 data stops, 2 never found, 3 link lost, 4 wrong sensor, 5 hot in F,
  // 6 store shot. The candidate table comes from the profile's table file (ext9-12.js), as in registration.
  var scn = G.n, c = evalFile('{file_path}/ext' + (G.s + 8) + '.js')(G).c;
  var h, x = 0, s = 12345, q = [], ntf = [], nt = 0, frames = 0, up = 0, drop = 0, i, t, rl = [], fm = [];
  var base = scn == 5 ? 40 : -8, ramp = scn == 5 ? 0.6 : -2;
  // Air temperature at second u: ramp, a gentle 40-minute wave (at most 0.5 C/h of trend) and deterministic +-0.05 C noise.
  var temp = function (u) {
    s = s * 16807 % 2147483647;
    return base + ramp * u / 3600 + 0.05 * Math.sin(u * Math.PI / 1200) + (s / 2147483647 - 0.5) * 0.1;
  };
  // Humidity falls as the air warms (stays well inside 0-100 % for every scenario).
  var hum = function (v) {
    return 82 - 1.5 * (v - base);
  };
  // Role and UUID form per characteristic id.
  for (i = 0; i < c.length; i++) {
    rl[c[i][0]] = c[i][1];
    fm[c[i][0]] = c[i][8];
  }
  // A payload in the profile's real byte format: SensorPush int32, ESS int16, Xiaomi 5-byte frame, Ruuvi DF5.
  var frame = function (r) {
    var v = temp(x), w = hum(v);
    if (r > 0 && r < 4) {
      v = Math.round(r == 3 ? w * 100 : r == 2 ? v * 10 : v * 100);
      if (r < 3) frames++;
      return prof.k ? [v & 255, v >> 8 & 255] : [v & 255, v >> 8 & 255, v >> 16 & 255, v >> 24 & 255];
    }
    if (r > 3 && r < 6) return r == 4 ? [0x86, 0x0B, 0, 0] : [87];
    frames++;
    v = Math.round(prof.k == 1 ? v * 100 : v / 0.005);
    if (prof.k == 1) return [v & 255, v >> 8 & 255, Math.round(w), 0x86, 0x0B];
    w = Math.round(w / 0.0025);
    // DF5 start: format, T, RH, then pressure and acceleration left at 0, and the power info for 2950 mV.
    return [5, v >> 8 & 255, v & 255, w >> 8, w & 255, 0, 0, 0, 0, 0, 0, 0, 0, 0xA8, 0xD6];
  };
  var at = function (dt, ch, ev) {
    q.push([x + dt, ch, ev]);
  };
  // Pre-seed main.js with the last 10 minutes, one sample per simulated second (not when no sensor is ever found).
  if (scn != 2 && scn != 4) {
    for (i = -600; i < 0; i++) {
      t = temp(i);
      seed(t, hum(t));
    }
  }
  return {
    f: scn == 5,
    // Synthetic wrist sensor in kelvin: 8 C above the air (watch over a sleeve), or a 34 C bare wrist on the hot day.
    w: 0,
    connect: function (id, handler) {
      h = handler;
      if (scn != 2) at(2, 0, 100);
      return 7;
    },
    regUuid: function (c, id) {
      at(1, id, scn == 4 ? 108 : 107);
    },
    // 2-byte UUID forms refuse here, so the demo exercises the "keep the form that delivers" logic.
    enaCharNotf: function (c, id) {
      at(1, id, fm[id] == 2 ? 110 : 109);
    },
    writeChar: function (c, id) {
      at(1, id, 104);
    },
    readChar: function (c, id) {
      at(1, id, fm[id] == 2 || (scn == 1 && frames) ? 103 : 102);
    },
    // Called by main.js at the start of every evaluate: one simulated second.
    t: function () {
      var e, j;
      x++;
      this.w = 273.15 + (scn == 5 ? 34 : base + ramp * x / 3600 + 8);
      for (j = 0; j < q.length;) {
        e = q[j];
        if (e[0] > x) { j++; continue; }
        q.splice(j, 1);
        if (e[2] == 100) up = 1;
        if (e[2] == 109) { nt = x + 1; ntf.push(e[1]); }
        h(e[1], e[2], e[2] == 102 ? frame(rl[e[1]]) : undefined);
      }
      if (up && ntf.length && nt && x >= nt && !(scn == 1 && frames)) {
        nt = x + prof.iv;
        for (j = 0; j < ntf.length; j++) h(ntf[j], 106, frame(rl[ntf[j]]));
      }
      if (scn == 3 && up && frames && ++drop > 5) {
        up = 0;
        ntf = [];
        h(0, 101);
      }
    }
  };
}
