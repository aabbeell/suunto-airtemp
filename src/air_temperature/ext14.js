// ABOUTME: Sensor-name override for AirTemp for Suunto: trimmed, 1-15 printable ASCII characters, as complete (AD 9) and short (AD 8) name.
// ABOUTME: main.js loads it once in onLoad, only when the name setting is non-empty; it writes G.a, G.b and G.x.
function (r, name) {
  var i = 0, c = name.length, n, k, a = [9], b = [8];
  while (i < c && name.charCodeAt(i) == 32) i++;
  while (c > i && name.charCodeAt(c - 1) == 32) c--;
  if (c == i) return;
  // Only Xiaomi and ESS sensors are found by name; SensorPush and Ruuvi send theirs in the scan response only (x = 2).
  r.x = r.s == 2 || r.s == 4 ? 1 : 2;
  if (r.x > 1 || c - i > 15) return;
  for (n = i; n < c; n++) {
    k = name.charCodeAt(n);
    if (k < 32 || k > 126) return;
    a.push(k);
    b.push(k);
  }
  r.x = 0;
  r.a = a;
  r.b = b;
}
