// ABOUTME: Connection setup for Suunto AirTemp, loaded on every event 100 once registration is done (ext13.js): enable, battery, LED.
// ABOUTME: Returns a stepper main.js calls once per tick with the last call's result (0 none, 1 ok, 2 refused, 3 threw or timed out): 0 busy, 1 done.
function (prof, rc, call) {
  // Phases 1-3 walk rc (characteristic id -> role) in id order, which is each profile's preference order. The stepper is
  // returned directly and is the only closure: a function stored in a variable of this scope would form a cycle with the
  // scope, and releasing the stepper would then leave garbage that only a mark-and-sweep frees. main.js drops its
  // prototype (a function and its prototype object reference each other) for the same reason.
  var ph = 1, i = 1, again = 0, gt = 0, gh = 0;
  return function (r) {
    var id, ro;
    // Ruuvi reboots unless TX notifications are on within 12 s, so a failed enable is retried once.
    if (r > 1 && ph == 1 && prof.k == 2 && !again) { again = 1; i--; } else if (r) again = 0;
    // The first id (in preference order) whose notifications were accepted (109) becomes the one polled if reads are needed.
    if (r == 1 && ph == 1) {
      id = i - 1;
      if (rc[id] == 3) { if (!gh) prof.h = id, gh = 1; }
      else if (!gt) prof.t = id, gt = 1;
    }
    // Phase 1 enable notifications (notify profiles), 2 read the battery, 3 blink the LED once per app run. One call per tick.
    for (; ph < 4; ph++, i = 1) {
      for (; i < 16; i++) {
        ro = rc[i];
        if (ph == 1 && prof.k && ro && (ro < 4 || ro == 6)) { call(109, i++); return 0; }
        if (ph == 2 && (ro == 4 || ro == 5)) { call(102, i++); return 0; }
        if (ph == 3 && ro == 7 && !prof.ld) { prof.ld = 1; call(104, i++, prof.lw); return 0; }
      }
    }
    return 1;
  };
}
