// ABOUTME: sp-mem scenario for Air Temperature, ESS profile whose notifications never deliver and whose reads all fail (103):
// ABOUTME: the read fallback rotates ids every poll cycle (ext15.js). Params: poll (setting index, default 0 = 5 s).
scenario({
  name: 'at-readfail',
  ticks: 300,
  setup: function (sp) {
    sp.storage.setItem('sensor', '3');
    sp.storage.setItem('poll', sp.param('poll', '0'));
    sp.input('wrist', 300.15);
    sp.input('units', 0);
  }
});
