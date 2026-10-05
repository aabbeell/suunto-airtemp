// ABOUTME: sp-mem scenario for Air Temperature, idle: the sensor is never found (no event 100), so SEARCHING, the 60 s escape and hints.
// ABOUTME: Params: sensor (default 0), name (sensor name setting, default empty).
scenario({
  name: 'at-idle',
  ticks: 300,
  setup: function (sp) {
    sp.storage.setItem('sensor', sp.param('sensor', '0'));
    sp.storage.setItem('name', sp.param('name', ''));
    sp.ble.setAutoConnect(false);
    sp.input('wrist', 290.15);
    sp.input('units', 0);
  }
});
