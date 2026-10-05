<!-- ABOUTME: Hardware test record for Suunto AirTemp: one row per SPEC §17c step, filled in on the user's Race S with a real sensor. -->
<!-- ABOUTME: Empty until the tests run; the store listing's "Tested on" sentence may only cite rows marked pass here. -->

# Suunto AirTemp: hardware results

## Recorded runs

| Date | Watch, firmware | Sensor | Build | Result (from the watch log) |
|---|---|---|---|---|
| 2026-10-04 | Race S, 2.53.42 | Xiaomi LYWSD03MMC, stock firmware | debug, Xiaomi profile (screen v1) | Pass after three fixes (SPEC §22.18): link at 8-25 s, all candidates registered, stock frame every ~6 s parsed (22.2-22.4 °C), value drawn once '#id *' visibility was used. The link drops and recovers about once a minute. With a second SuuntoPlus app in the mode the app was unloaded at exercise start (relMemCb). |
| pending | Race S | Xiaomi LYWSD03MMC | debug, screen v3 + Auto | Not run yet: graph (window, autoscale, stale samples, laps), Auto discovery, LOST/NO DATA timers, summary. |

The step table below is the original v1.0 plan; several rows (wrist row, 60 s searching escape, SensorPush-first) are superseded by SPEC §22.18.

Nothing has been tested on hardware yet. Fill in one row per step of SPEC §17c; "pass" only when the step's pass criterion held. The procedure for v1.0, in order, is in [HARDWARE_TEST.md](HARDWARE_TEST.md).

| Field | Value |
|---|---|
| Watch | Suunto Race S |
| Watch firmware | |
| Sensor (model, generation, firmware) | |
| App build (version; release, or the debug variant from `test/variant.js`) | |
| Second SuuntoPlus app in the same sport mode | |
| Date | |

| Step | What to record (short; the full step is in SPEC §17c) | Result (pass / fail / not run) | Notes |
|---|---|---|---|
| H1 | Raw ADV and scan response of the sensor: is the service UUID in the ADV packet? Advertised name? | not run | |
| H2 | Debug build deploys; the app appears in a Hike sport mode | not run | |
| H3 | Time until Searching closes; LED blinks 3 times; system events 111 → 100 → 107×4 → 102 (battery) → 104 (LED) → 104 (trigger) → 102 → 102; no `BLE API err`; humidity reacts within 2 polls | not run | |
| H4 | Sensor in a metal tin: Searching closes after 60 s, the app shows SEARCHING (orange) with hints under a grey "--" | not run | |
| H5 | Within ±0.5 °C of a reference after 10 min | not run | |
| H6 | (Optional) name setting: exact vs prefix match, ADV vs scan response | not run | |
| H7 | Wrist vs air difference makes sense (+5 to +10 °C typical); WRIST row adds up with the air value | not run | |
| H8 | Walk away 2 min: LOST m'ss with "Reconnecting …" under the value; after 2 min "--" and "Restart exercise"; recovers to LIVE; time to recover; Race S reconnect bug seen? | not run | |
| H9 | `sensor = 3` build against the HT.w shows WRONG SENSOR | not run | |
| H10 | Pause, resume, lap, end with buttons only, also with display off and in AOD | not run | |
| H11 | Summary min/avg/max/humidity; Suunto app graphs; FIT values in K | not run | |
| H12 | Imperial: °F everywhere, summary in °F | not run | |
| H13 | Second app + HR belt: still connects, not evicted; `JsTotMem` / memory-pool debug lines (compare with SPEC §22.16) | not run | |
| H14 | Debug line: `typeof enabledZappId` is `number`, connect returns an id; DEMO never appears | not run | |
| H15 | (Optional) two parallel `connect()` calls | not run | |
| H16 | Watch battery drop over 1 h with vs without the app | not run | |
| H17 | (Per extra sensor) Xiaomi / Ruuvi / ESS builds pass H3, H5, H8, H11 | not run | |
| H18 | Light theme: the orange state word and the grey stale number (static template colours since SPEC §22.17) read well | not run | |
| H19 | Swipe away 30 s and back: current values at once, or the old ones until the 10 s refresh? | not run | |
| H20 | (Optional) `regUuid` twice for the same id: 107, 108 or a throw? | not run | |
| H21 | (If available) read-only ESS sensor: data within about 3 read cycles | not run | |
| H22 | BT ERROR before an exercise (for example with 2 other sensors connected): does leaving the start view and selecting the app again, as the "Reselect the app" hint says, restart it? | not run | |
