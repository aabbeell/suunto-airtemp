// ABOUTME: Sensor profile 2 for AirTemp for Suunto: RuuviTag fw 3.x, data format 5 heartbeat over Nordic UART (NUS) TX notifications.
// ABOUTME: Resident part (main.js keeps it): timing, setup state and the parser; UUIDs and connect params are in ext11.js.
function () {
  // The parser's prototype object is dropped (a function and its prototype reference each other).
  var o = {
    k: 2,
    iv: 3,
    // Setup state kept across reconnects: candidates registered so far (-1 once all are), LED done, preferred T and H ids.
    rg: 0,
    ld: 0,
    t: 0,
    h: 0,
    // DF5, big-endian: T sint16 x 0.005 C at 1, RH uint16 x 0.0025 % at 3, power info at 13 (battery = top 11 bits + 1600 mV).
    p: function (r, d, o) {
      var v;
      if (r != 6 || d.length < 15 || (d[0] & 255) != 5) return 0;
      v = (d[1] & 255) << 8 | (d[2] & 255);
      if (v != 0x8000) o[0] = (v << 16 >> 16) * 0.005;
      v = (d[3] & 255) << 8 | (d[4] & 255);
      if (v != 0xFFFF) o[1] = v * 0.0025;
      v = ((d[13] & 255) << 8 | (d[14] & 255)) >> 5;
      if (v != 2047) { o[2] = v + 1600; o[3] = 0; }
      return 1;
    }
  };
  o.p.prototype = null;
  return o;
}
