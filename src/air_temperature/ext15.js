// ABOUTME: Read-fallback rotation for AirTemp for Suunto (notify profiles): after a failed read, try the next registered id of that kind.
// ABOUTME: main.js loads it on the first failed fallback read of a notify profile and keeps it as prof.r; at most 15 steps, wrapping back to the same id.
function (prof, rc, hu) {
  var j, v, n = hu ? prof.h : prof.t;
  for (j = 0; j < 15; j++) {
    n = n % 15 + 1;
    v = rc[n];
    if (hu ? v == 3 : v && (v < 3 || v == 6)) break;
  }
  if (hu) prof.h = n;
  else prof.t = n;
}
