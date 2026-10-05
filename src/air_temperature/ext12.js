// ABOUTME: Setup tables for profile 3 (ESS): connect params (unless a sensor name replaced them), the base UUID and candidates.
// ABOUTME: Loaded for each connect call (main.js) and for registration (ext13.js) only; nothing of it is kept.
function (G) {
  // Complete and incomplete 16-bit service UUID lists with 0x181A, unless a name from the setting replaced them.
  return {
    a: G.a || [3, 0x1A, 0x18],
    b: G.b || [2, 0x1A, 0x18],
    // Bluetooth base UUID 0000xxxx-0000-1000-8000-00805F9B34FB, little-endian; bytes 12-13 hold the 16-bit UUID.
    u: [[0xFB, 0x34, 0x9B, 0x5F, 0x80, 0x00, 0x00, 0x80, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
    // Candidates [charId, role, svcBase, svc12, svc13, chrBase, chr12, chr13, form], ids ascending in preference order
    // (0x2A6E before the legacy 0x2A1F, x 0.1 C); form 2 = 2-byte, 16 = expanded.
    c: [
      [1, 1, 0, 0x1A, 0x18, 0, 0x6E, 0x2A, 2],
      [2, 1, 0, 0x1A, 0x18, 0, 0x6E, 0x2A, 16],
      [3, 2, 0, 0x1A, 0x18, 0, 0x1F, 0x2A, 2],
      [4, 2, 0, 0x1A, 0x18, 0, 0x1F, 0x2A, 16],
      [5, 3, 0, 0x1A, 0x18, 0, 0x6F, 0x2A, 2],
      [6, 3, 0, 0x1A, 0x18, 0, 0x6F, 0x2A, 16],
      [7, 5, 0, 0x0F, 0x18, 0, 0x19, 0x2A, 2],
      [8, 5, 0, 0x0F, 0x18, 0, 0x19, 0x2A, 16]
    ]
  };
}
