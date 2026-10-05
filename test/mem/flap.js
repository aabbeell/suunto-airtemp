// ABOUTME: sp-mem scenario for Air Temperature: SensorPush or Ruuvi, with a link flap (101 then 100) every `flap` ticks.
// ABOUTME: Params (--set): sensor (0 SensorPush, 2 Ruuvi), flap (ticks between 101/100 cycles, 0 = never), type (array|uint8array).
var AT_DF5 = [5, 0x04, 0x30, 0x53, 0x94, 0, 0, 0, 0, 0, 0, 0, 0, 0xA8, 0xD6];
scenario({
	name: 'at-flap',
	ticks: 300,
	setup: function (sp) {
		sp.storage.setItem('sensor', sp.param('sensor', '0'));
		sp.ble.setDataType(sp.param('type', 'array'));
		sp.ble.readResponse(1, [0x66, 0x08, 0, 0]);
		sp.ble.readResponse(2, [0xD7, 0x11, 0, 0]);
		sp.ble.readResponse(3, [0xA6, 0x0B, 0x2E, 0x09]);
	},
	onTick: function (sp, t) {
		var f = parseInt(sp.param('flap', '0'), 10);
		if (sp.param('sensor', '0') === '2' && sp.bleNotif[1] && t % 3 === 0) { AT_DF5[2] = t & 0xff; sp.ble.notify(1, AT_DF5); }
		if (f > 0 && t > 20 && t % f === 0) { sp.ble.emit(1, 101, null); sp.bleNotif[1] = false; }
		if (f > 0 && t > 20 && t % f === 2) { sp.ble.emit(1, 100, null); }
	}
});
