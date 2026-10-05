// ABOUTME: Registration for Suunto AirTemp, loaded on event 100 until every candidate is registered (first link, or resumed after a drop).
// ABOUTME: Takes the profile's table function (main.js loads ext9-12.js: an ext file cannot evalFile on the watch), registers one candidate per tick; returns 0 busy, 3 registered (main.js then loads ext7.js), 2 unusable.
function (prof, rc, call, T) {
  // Registration resumes at prof.rg after a link drop, so no id is ever registered twice (registration is local and outlives
  // the link); prof.rg is -1 once every candidate is sent. The tables live only as long as this stepper. As in ext7.js, the
  // stepper is the only closure and main.js drops its prototype; the table function's prototype is dropped here.
  var c, i = prof.rg, again = 0;
  T.prototype = null;
  T = T(prof);
  c = T.c;
  return function (r) {
    var e, id, ro, a, b;
    // 107 only means "registered locally". The role is entered when the call is made and cleared when it fails. A call that
    // threw or timed out (3) is sent once more first; a refusal (108) clears the role at once.
    if (r == 3 && !again) {
      again = 1;
      i--;
    } else {
      again = 0;
      if (r > 1) rc[c[i - 1][0]] = 0;
    }
    if (i < c.length) {
      e = c[i];
      rc[e[0]] = e[1];
      prof.rg = ++i;
      if (e[8] == 2) call(107, e[0], [e[3], e[4]], [e[6], e[7]]);
      else {
        // 128-bit (or base-expanded) UUIDs: a copy of the base with bytes 12-13 replaced.
        a = T.u[e[2]].slice(0);
        a[12] = e[3];
        a[13] = e[4];
        b = T.u[e[5]].slice(0);
        b[12] = e[6];
        b[13] = e[7];
        call(107, e[0], a, b);
      }
      return 0;
    }
    prof.rg = -1;
    T = c = 0;
    // Start with the first registered candidates; the BLE handler switches to whichever id delivers data.
    for (id = 15; id > 0; id--) {
      ro = rc[id];
      if (ro == 3) prof.h = id;
      else if (ro && (ro < 3 || ro == 6)) prof.t = id;
    }
    return prof.t ? 3 : 2;
  };
}
