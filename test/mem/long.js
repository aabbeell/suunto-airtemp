// ABOUTME: sp-mem scenario for Air Temperature, long session: SensorPush polled every 5 s for `ticks` (default 7200 = 2 h),
// ABOUTME: a 101/100 flap every `flap` ticks (default 600), slowly drifting temperature so the trend, min and max keep changing.
var LG_T = [0x8D, 0xFD, 0xFF, 0xFF];
scenario({
  name: 'at-long',
  ticks: 7200,
  setup: function (sp) {
    sp.storage.setItem('sensor', '0');
    sp.storage.setItem('poll', '0');
    sp.input('wrist', function (t) { return 300.15 - t / 1000; });
    sp.input('units', 0);
    sp.ble.readResponse(1, LG_T);
    sp.ble.readResponse(2, [0x8F, 0x19, 0x00, 0x00]);
    sp.ble.readResponse(3, [0x86, 0x0B, 0x00, 0x00]);
  },
  onTick: function (sp, t) {
    var f = parseInt(sp.param('flap', '600'), 10), v = -523 - ((t / 10) | 0);
    LG_T[0] = v & 255; LG_T[1] = v >> 8 & 255; LG_T[2] = v >> 16 & 255; LG_T[3] = v >> 24 & 255;
    if (f > 0 && t >= f && t % f === 0) sp.ble.emit(1, 101, null, 1);
    if (f > 0 && t >= f && t % f === 5) sp.ble.emit(1, 100, null, 1);
  }
});
