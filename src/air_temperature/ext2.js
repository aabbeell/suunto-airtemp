// ABOUTME: Sensor profile 1 for Suunto AirTemp (Auto): Xiaomi LYWSD03MMC stock firmware (ebe0ccc1 frame), or any sensor with ESS characteristics (pvvx/ATC, standard sensors).
// ABOUTME: Resident part (main.js keeps it): timing, setup state and the parser; UUIDs and connect params are in ext10.js.
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
    // Stock frame: sint16 LE x 0.01 C, uint8 %RH, uint16 LE mV. ESS: 0x2A6E sint16 x 0.01, 0x2A6F uint16 x 0.01, 0x2A19 %.
    p: function (r, d, o) {
      var v;
      if (r == 6) {
        if (d.length < 5) return 0;
        o[0] = ((d[0] & 255 | (d[1] & 255) << 8) << 16 >> 16) / 100;
        o[1] = d[2] & 255;
        o[2] = (d[3] & 255) | (d[4] & 255) << 8;
        o[3] = 0;
        return 1;
      }
      if (r == 5) {
        if (d.length < 1) return 0;
        if ((d[0] & 255) <= 100) { o[2] = d[0] & 255; o[3] = 1; }
        return 1;
      }
      if (d.length < 2) return 0;
      v = (d[0] & 255) | (d[1] & 255) << 8;
      if (r == 3) { if (v != 0xFFFF) o[1] = v / 100; }
      else if (v != 0x8000) o[0] = (v << 16 >> 16) / 100;
      return 1;
    }
  };
  o.p.prototype = null;
  return o;
}
