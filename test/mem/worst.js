// ABOUTME: sp-mem scenario for Air Temperature, worst case: Xiaomi with a sensor name (pvvx), imperial, three notifications per tick
// ABOUTME: (stock frame, 0x2A6E and 0x2A6F expanded), a link flap every `flap` ticks (setup reloads ext7.js). Params: flap (default 50), type.
var WX_F = [0x0C, 0xFE, 0x41, 0x86, 0x0B], WX_T = [0x0C, 0xFE], WX_H = [0x60, 0x19];
scenario({
  name: 'at-worst',
  ticks: 600,
  setup: function (sp) {
    sp.storage.setItem('sensor', '1');
    sp.storage.setItem('name', 'ATC_A1B2C3');
    sp.storage.setItem('poll', '0');
    sp.ble.setDataType(sp.param('type', 'array'));
    sp.input('wrist', function (t) { return 260.15 + (t % 50) / 10; });
    sp.input('units', 1);
    sp.ble.readResponse(9, [80]);
    sp.ble.readResponse(10, [80]);
    sp.ble.readResponse(1, WX_F);
  },
  onTick: function (sp, t) {
    var f = parseInt(sp.param('flap', '50'), 10);
    WX_F[0] = WX_T[0] = t & 0xff;
    WX_F[1] = WX_T[1] = 0xFE - ((t >> 6) & 3);
    if (sp.bleNotif[1]) sp.ble.notify(1, WX_F);
    if (sp.bleNotif[6]) sp.ble.notify(6, WX_T);
    if (sp.bleNotif[8]) sp.ble.notify(8, WX_H);
    if (f > 0 && t > 20 && t % f === 0) { sp.ble.emit(1, 101, null, 1); sp.bleNotif[1] = sp.bleNotif[6] = sp.bleNotif[8] = false; }
    if (f > 0 && t > 20 && t % f === 2) sp.ble.emit(1, 100, null, 1);
  }
});
