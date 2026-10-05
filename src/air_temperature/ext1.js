// ABOUTME: Sensor profile 0 for Suunto AirTemp: SensorPush HT.w / HTP.xw (2nd gen), polled by a 4-byte write then a read.
// ABOUTME: Resident part (main.js keeps it): timing, poll payloads, setup state and the parser; UUIDs and connect params are in ext9.js.
function () {
  // The parser's prototype object is dropped (a function and its prototype reference each other).
  var o = {
    k: 0,
    iv: 0,
    // Poll trigger (any 4 bytes) for the temperature characteristic; LED value: blink 3 times.
    tw: [1, 0, 0, 0],
    lw: [3],
    // Setup state kept across reconnects (declared up front, so no property is added at run time): candidates registered so
    // far (-1 once all are, see ext13.js), LED done, preferred temperature and humidity ids.
    rg: 0,
    ld: 0,
    t: 0,
    h: 0,
    // Temperature and humidity: int32 LE x 0.01. Battery: uint16 LE mV, then the sensor's own temperature (ignored).
    p: function (r, d, o) {
      var v;
      if (r == 4) {
        if (d.length < 2) return 0;
        v = (d[0] & 255) | (d[1] & 255) << 8;
        if (v) { o[2] = v; o[3] = 0; }
        return 1;
      }
      if (d.length < 4) return 0;
      v = ((d[0] & 255) | (d[1] & 255) << 8 | (d[2] & 255) << 16 | (d[3] & 255) << 24) / 100;
      if (r == 1) o[0] = v;
      else if (r == 3) o[1] = v;
      return 1;
    }
  };
  o.p.prototype = null;
  return o;
}
