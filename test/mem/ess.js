// ABOUTME: sp-mem scenario for Air Temperature, generic ESS profile: only the base-expanded UUID forms deliver (ids 2 and 6), battery read on id 8.
// ABOUTME: Params: every (notification period in ticks, default 2), type (array|uint8array). Disconnect at 150, reconnect at 155.
var ES_T = [0x1F, 0x05], ES_H = [0x60, 0x19];
scenario({
  name: 'at-ess',
  ticks: 300,
  setup: function (sp) {
    sp.storage.setItem('sensor', '3');
    sp.ble.setDataType(sp.param('type', 'array'));
    sp.input('wrist', 300.15);
    sp.input('units', 0);
    sp.ble.readResponse(8, [77]);
    sp.ble.readResponse(2, [0x1F, 0x05]);
    sp.ble.readResponse(6, [0x60, 0x19]);
  },
  onTick: function (sp, t) {
    var e = parseInt(sp.param('every', '2'), 10);
    if (sp.bleNotif[2] && t % e === 0) { ES_T[0] = t & 0xff; sp.ble.notify(2, ES_T); }
    if (sp.bleNotif[6] && t % e === 1) { ES_H[0] = t & 0xff; sp.ble.notify(6, ES_H); }
    if (t === 150) { sp.ble.emit(2, 101, null, 1); sp.bleNotif[2] = sp.bleNotif[6] = false; }
    if (t === 155) sp.ble.emit(2, 100, null, 1);
  }
});
