// ABOUTME: Load-time helper for AirTemp for Suunto: reads the settings (localStorage is passed in), clears the trend ring, drops prototypes.
// ABOUTME: main.js evaluates it once in onLoad and keeps the returned object as G; main.js parses a non-empty sensor name (G.m) with ext14.js.
function (ls, ring, f1, f2, f3, f4, f5, f6, f7, f8) {
  // sensor and poll: 0-3, the default is the index (sensor 0 SensorPush, poll 1 = 10 s). No helper closure, so nothing of
  // this scope outlives the call.
  var i, x, nm = ls.getItem('name'), v = [ls.getItem('sensor'), ls.getItem('poll')];
  for (i = 0; i < 2; i++) {
    x = v[i];
    x = x == null || x === '' ? i : +x | 0;
    v[i] = x < 0 || x > 3 ? i : x;
  }
  for (i = 0; i < 30; i++) ring[i] = NaN;
  // main.js's eight helpers: none is a constructor, so the prototype object each function gets (and which points back to
  // it) is dropped. The minifier discards a top-level statement in main.js that would do it there.
  f1.prototype = f2.prototype = f3.prototype = f4.prototype = f5.prototype = f6.prototype = f7.prototype = f8.prototype = null;
  // G (fields in main.js). Every field is declared here, so none is added at run time; c stays undefined until connect
  // returns an id, so a connect that throws or returns nothing ends in BT ERROR.
  // m carries the sensor name to main.js, which loads ext14.js: an ext file cannot evalFile on the watch.
  x = { s: v[0] + 1, p: [5, 10, 30, 60][v[1]], a: 0, b: 0, x: 0, c: undefined, y: 0, r: 0, w: 0, m: nm ? '' + nm : 0 };
  return x;
}
