// ABOUTME: Setup tables for profile 1 (Auto: Xiaomi or a standard ESS sensor): connect params (unless a sensor name replaced them), UUID bases and candidates.
// ABOUTME: Loaded for each connect call (main.js) and for registration (ext13.js) only; nothing of it is kept.
function (G) {
  // Auto: the complete local name "LYWSD03MMC" (stock Xiaomi, proven on the Race S) or the 0x181A service in the complete
  // 16-bit UUID list (standard ESS sensors), unless a name from the setting replaced them. The candidates below then
  // decide which data the sensor really has. pvvx sensors advertise 0x181A only as service data, so they may still need
  // their own name in the setting.
  return {
    a: G.a || [9, 0x4C, 0x59, 0x57, 0x53, 0x44, 0x30, 0x33, 0x4D, 0x4D, 0x43],
    b: G.b || [3, 0x1A, 0x18],
    // ebe0ccXX-7a0a-4b0c-8a1a-6ff2997da3a6 and the Bluetooth base UUID, little-endian; bytes 12-13 vary.
    u: [
      [0xA6, 0xA3, 0x7D, 0x99, 0xF2, 0x6F, 0x1A, 0x8A, 0x0C, 0x4B, 0x0A, 0x7A, 0x00, 0x00, 0xE0, 0xEB],
      [0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    ],
    // Candidates [charId, role, svcBase, svc12, svc13, chrBase, chr12, chr13, form], ids ascending in preference order;
    // SIG UUIDs in both forms (2 = 2-byte, 16 = expanded): 107 is only local, so the form that delivers data wins.
    c: [
      [1, 6, 0, 0xB0, 0xCC, 0, 0xC1, 0xCC, 0],
      [5, 1, 1, 0x1A, 0x18, 1, 0x6E, 0x2A, 2],
      [6, 1, 1, 0x1A, 0x18, 1, 0x6E, 0x2A, 16],
      [7, 3, 1, 0x1A, 0x18, 1, 0x6F, 0x2A, 2],
      [8, 3, 1, 0x1A, 0x18, 1, 0x6F, 0x2A, 16],
      [9, 5, 1, 0x0F, 0x18, 1, 0x19, 0x2A, 2],
      [10, 5, 1, 0x0F, 0x18, 1, 0x19, 0x2A, 16]
    ]
  };
}
