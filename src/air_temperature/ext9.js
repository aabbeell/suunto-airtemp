// ABOUTME: Setup tables for profile 0 (SensorPush): connect params, UUID bases and candidates.
// ABOUTME: Loaded for each connect call (main.js) and for registration (ext13.js) only; nothing of it is kept.
function (G) {
  // Service EF090000-11D6-42BA-93B8-9DD7EC090AB0, little-endian; bytes 12-13 vary per UUID. It is in the advertising packet.
  var S = [0xB0, 0x0A, 0x09, 0xEC, 0xD7, 0x9D, 0xB8, 0x93, 0xBA, 0x42, 0xD6, 0x11, 0x00, 0x00, 0x09, 0xEF];
  // Connect params: complete and incomplete 128-bit service lists (a sensor name from the setting is never used here).
  return {
    a: [7].concat(S),
    b: [6].concat(S),
    // Characteristic base EF09xxxx-11D6-42BA-93B8-9DD7EC090AA9 (not the service base). Device ID EF090001 is never used.
    u: [S, [0xA9, 0x0A, 0x09, 0xEC, 0xD7, 0x9D, 0xB8, 0x93, 0xBA, 0x42, 0xD6, 0x11, 0x00, 0x00, 0x09, 0xEF]],
    // Candidates [charId, role, svcBase, svc12, svc13, chrBase, chr12, chr13, form], ids ascending in preference order;
    // form 0 = 128-bit UUID.
    c: [
      [1, 1, 0, 0x00, 0x00, 1, 0x80, 0x00, 0],
      [2, 3, 0, 0x00, 0x00, 1, 0x81, 0x00, 0],
      [3, 4, 0, 0x00, 0x00, 1, 0x07, 0x00, 0],
      [4, 7, 0, 0x00, 0x00, 1, 0x0C, 0x00, 0]
    ]
  };
}
