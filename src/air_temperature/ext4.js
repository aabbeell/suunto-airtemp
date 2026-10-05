// ABOUTME: Sensor profile 3 for AirTemp for Suunto: any sensor exposing the Bluetooth Environmental Sensing Service (0x181A).
// ABOUTME: Resident part (main.js keeps it): timing, setup state and the parser; UUIDs and connect params are in ext12.js.
function () {
  // The parser's prototype object is dropped (a function and its prototype reference each other).
  var o = {
    k: 1,
    iv: 20,
    // Setup state kept across reconnects: candidates registered so far (-1 once all are), LED done, preferred T and H ids.
    rg: 0,
    ld: 0,
    t: 0,
    h: 0,
    // Read-fallback rotation (ext15.js): main.js loads it on the first failed fallback read and keeps it here.
    r: 0,
    // 0x2A6E sint16 LE x 0.01 C (0x8000 unknown), 0x2A1F sint16 x 0.1 C, 0x2A6F uint16 x 0.01 % (0xFFFF unknown), 0x2A19 %.
    p: function (r, d, o) {
      var v;
      if (r == 5) {
        if (d.length < 1) return 0;
        if ((d[0] & 255) <= 100) { o[2] = d[0] & 255; o[3] = 1; }
        return 1;
      }
      if (d.length < 2) return 0;
      v = (d[0] & 255) | (d[1] & 255) << 8;
      if (r == 3) { if (v != 0xFFFF) o[1] = v / 100; }
      else if (v != 0x8000) o[0] = (v << 16 >> 16) / (r == 2 ? 10 : 100);
      return 1;
    }
  };
  o.p.prototype = null;
  return o;
}
