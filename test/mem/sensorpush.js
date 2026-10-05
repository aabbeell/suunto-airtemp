// ABOUTME: sp-mem scenario for Air Temperature with the SensorPush profile (poll 5 s): answers the write/read poll cycle.
// ABOUTME: Disconnect at tick 120, reconnect at tick 125. Run: node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/sp-mem.js src/air_temperature --scenario test/mem/sensorpush.js
scenario({
  name: 'at-sensorpush',
  ticks: 300,
  setup: function (sp) {
    sp.storage.setItem('sensor', '0');
    sp.storage.setItem('poll', '0');
    sp.input('wrist', 300.15);
    sp.input('units', 0);
    // -5.23 C int32 LE, 65.43 % int32 LE, battery 2950 mV
    sp.ble.readResponse(1, [0x8D, 0xFD, 0xFF, 0xFF]);
    sp.ble.readResponse(2, [0x8F, 0x19, 0x00, 0x00]);
    sp.ble.readResponse(3, [0x86, 0x0B, 0x00, 0x00]);
  },
  onTick: function (sp, t) {
    if (t === 120) sp.ble.emit(1, 101, null, 1);
    if (t === 125) sp.ble.emit(1, 100, null, 1);
  }
});
