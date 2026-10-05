// ABOUTME: sp-mem scenario for Air Temperature with the Xiaomi profile: stock frame notifications every 6 s on id 1.
// ABOUTME: Disconnect at tick 120, reconnect at tick 125. Run: node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/sp-mem.js src/air_temperature --scenario test/mem/xiaomi.js
var XI_FRAME = [0x0C, 0xFE, 0x41, 0x86, 0x0B];
scenario({
  name: 'at-xiaomi',
  ticks: 300,
  setup: function (sp) {
    sp.storage.setItem('sensor', '1');
    sp.input('wrist', 300.15);
    sp.input('units', 0);
    sp.ble.readResponse(9, [80]);
    sp.ble.readResponse(10, [80]);
  },
  onTick: function (sp, t) {
    if (sp.bleNotif[1] && t % 6 === 0) { XI_FRAME[0] = t & 0xff; sp.ble.notify(1, XI_FRAME); }
    if (t === 120) sp.ble.emit(1, 101, null, 1);
    if (t === 125) sp.ble.emit(1, 100, null, 1);
  }
});
