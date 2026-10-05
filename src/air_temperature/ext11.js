// ABOUTME: Setup tables for profile 2 (RuuviTag): connect params, the NUS UUID base and the TX candidate.
// ABOUTME: Loaded for each connect call (main.js) and for registration (ext13.js) only; nothing of it is kept.
function (G) {
  // Manufacturer data, company 0x0499 little-endian: in the advertising packet (the name and NUS UUID are scan-response only).
  var n = [255, 0x99, 0x04];
  return {
    a: n,
    b: n,
    // NUS 6E4000XX-B5A3-F393-E0A9-E50E24DCCA9E, little-endian; byte 12 is 01 (service) or 03 (TX).
    u: [[0x9E, 0xCA, 0xDC, 0x24, 0x0E, 0xE5, 0xA9, 0xE0, 0x93, 0xF3, 0xA3, 0xB5, 0x01, 0x00, 0x40, 0x6E]],
    // Candidate [charId, role, svcBase, svc12, svc13, chrBase, chr12, chr13, form]; form 0 = 128-bit UUID.
    c: [[1, 6, 0, 0x01, 0x00, 0, 0x03, 0x00, 0]]
  };
}
