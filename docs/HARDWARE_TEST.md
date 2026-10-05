<!-- ABOUTME: Step-by-step hardware test of Air Temperature v1.0 on the user's Suunto Race S with a SensorPush HT.w. -->
<!-- ABOUTME: Procedure only; results go in HW-RESULTS.md (one row per H-step of SPEC §17c). -->

# Air Temperature v1.0: hardware test on the Race S

About 1.5 hours. The H-numbers point to SPEC §17c and to the rows of [HW-RESULTS.md](HW-RESULTS.md), where every result goes. The store upload waits for H1-H5, H7, H8 and H10-H14.

**Two rules for the whole test:**
- **Any sync with the Suunto app deletes the sideloaded app.** Force-quit the Suunto app on the phone (or switch the phone's Bluetooth off) until step 14, which syncs on purpose.
- **Settings cannot be changed on a sideloaded app.** Both builds use the defaults: sensor SensorPush, read interval 10 s, no sensor name.

## Builds

| Build | File | Use |
|---|---|---|
| Debug | `builds/v1.0-dbg/airtem01-q-en.dev` | steps 3-11: writes `[AT] …` lines to the watch's system events |
| Release | `builds/v1.0/airtem01-q-en.dev` | step 12: exactly what the store will build from the zip |

Since review round 3 (SPEC §22.16) the store source has no debug code. Build both from the repository root (the debug variant is the store source plus the trace lines, with `debug` "1" in its data.json):

```
node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-build/sp-build.js src/air_temperature builds/v1.0
node test/variant.js debug /tmp/at-debug
node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-build/sp-build.js /tmp/at-debug builds/v1.0-dbg
```

The debug build holds about 1.7 KB more JS heap than the release build (17.2 KB against 15.5 KB steady in sp-mem, SPEC §22.16: the trace code plus the logger closure and its strings). Step 5's memory check is therefore pessimistic by that much, and step 12 repeats it with the release build.

## Steps

1. **Prepare.** Note the watch firmware (the watch's About screen). Check the sensor is a SensorPush **HT.w** (not the older HT1) and its coin cell is not low. Force-quit the SensorPush phone app and switch off any SensorPush gateway: the sensor accepts one connection only.
2. **Scan the sensor (H1).** With nRF Connect on the phone, scan the HT.w and save the advertising data and the scan response (screenshots are fine). Record whether the service UUID `EF090000-11D6-42BA-93B8-9DD7EC090AB0` is in the advertising packet, and the advertised name. Force-quit nRF Connect afterwards.
3. **Sideload the debug build (H2).** Connect the watch by USB, open VS Code with the SuuntoPlus Editor; the watch appears under Explorer → "Suunto Watch". Run the command "SuuntoPlus: Add SuuntoPlus Binary to Watch" and pick the debug `.dev`. On the watch, add Air Temperature as a SuuntoPlus app of the Hike sport mode (or another outdoor mode). Pass: the app is in the list.
4. **First connect (H3, H14).** Sensor about 1 m away. In the Hike start view, select Air Temperature. Expect: the watch's Searching screen; the sensor's LED blinks 3 times; Searching closes (only after the first good reading, so the app is already live by then) and the app shows a white value with no word above it, and the trend line with the humidity (`trend … · 55%`). The battery voltage is not on screen any more: `BAT LOW` (orange, at the top) would mean the sensor reported below 2.5 V. Breathe on the sensor: humidity should rise within about 30 s. Record the seconds from selecting the app to Searching closing. Then open Explorer → Suunto Watch → "View system events" and copy every line starting `[AT]`. Pass: `[AT] connect called number …` (not `function`, the connect result not `undefined`), events `100`, `107`, `102`, `104` in the trace, no `BLE API err`, and `DEMO` never on screen.
5. **Second app and HR belt (H13), the memory check.** Add a second SuuntoPlus app to the same sport mode and pair an HR belt. Select Air Temperature again and record a 10-minute exercise. Pass: it connects and stays LIVE; no "Maximum SuuntoPlus apps reached"; no `releaseMemoryCb` in the system events. Copy the `[AT] mem …` lines and any `JsTotMem` line. If this fails, stop and report: it decides whether v1.0 ships at all.
6. **Never found (H4).** Remove the second app again. Put the sensor in a closed metal tin (or leave it 50 m away) and select the app. Expect the Searching screen to close by itself after about 60 s, and the app to show `SEARCHING`, `--` and hints under it ("Bring sensor close", "Quit sensor app", "Check Sensor setting"). Record whether you could close the Searching screen earlier, and whether the watch shows the sensor as connected. Take the sensor out: does it connect by itself?
7. **Accuracy and wrist (H5, H7).** Clip the sensor on the outside of the pack shoulder strap in shade, watch on the bare wrist. Start a Hike exercise and walk at least 10 minutes. Compare with a reference thermometer next to the sensor (or with the SensorPush app before and after, closing it again). Pass: within ±0.5 °C after 10 minutes in one place; the trend arrow and °/h appear after about 3 minutes; the WRIST row (shown only when the wrist is more than 3 °C off the air) reads a plausible +5 to +10 °C above the air and its two numbers add up with the big number.
8. **Dropout (H8).** During the same exercise walk about 30 m away for 3 minutes, then come back. Expect `LOST 0'xx` in orange with "Reconnecting …" under the last value, which turns grey; after 2 minutes `--` and the hint alternating "Restart exercise" / "Bring sensor close"; then back to LIVE. Record the time to recover, or that it never recovered (the reported Race S reconnect bug).
9. **Buttons (H10).** From the app screen: pause, resume, lap and end the exercise with the buttons only, once with the display awake and once with it off or in always-on mode. Pass: every action works as on any other screen.
10. **Summary (H11, first half).** Save the exercise. Pass: the watch summary shows Air min, Air avg, Air max and Air humidity in your units.
11. **Imperial (H12).** Switch the watch to imperial units, run a 5-minute exercise and save it. Pass: °F on the app screen and in the summary. Switch back to metric.
12. **Release build.** Install the release `.dev` the same way (it replaces the debug one) and repeat step 4 (without the system-event part) and step 5 for 5 minutes. Pass: same results.
13. **Optional: BT ERROR (H22).** Before an exercise, with two other Bluetooth sensors connected to the watch, select the app. If it shows `BT ERROR` with "Reselect the app": leave the start view, select the app again, and record whether that restarts it and connects.
14. **Last: sync (H11, second half).** Open the Suunto app and sync; this deletes the sideloaded app. Pass: the Hike exercise shows "Air temperature" and "Air humidity" graphs, with a gap where the link was lost. If you can, export the FIT file and note that the air temperature values are in kelvin (about 273 + °C).

## What to report back

- `HW-RESULTS.md` filled in: the header (firmware, sensor, build, second app, date) and pass / fail / not run plus a short note for every H-step above.
- The timings: Searching closing in step 4, Searching closing in step 6, recovery in step 8.
- The system-event lines from steps 4 and 5: everything starting `[AT]`, and any line with `BLE`, `Zapp`, `releaseMemoryCb`, `JsTotMem`, `Exec` or `failed`.
- For anything that failed: the step, a photo of the watch screen, and what you did just before.
- The answers the store listing is waiting for: did the Race S reconnect in step 8, did reselecting the app restart it in step 13, and can the SensorPush label drop "(beta)"?
