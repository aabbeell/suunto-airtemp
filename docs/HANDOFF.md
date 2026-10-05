# Air Temperature handoff (2026-10-04)

Handoff from the setup thread to the Air Temperature thread. First read `../../../SUUNTOPO/tools/SHARED_RESOURCES.md`, which covers the watch lock, path ownership in this shared checkout, and the commit and push rules. Then read `SPEC.md`: the binding decisions and the 2026-10-04 hardware results are at the top.

## State

- **App:** `src/air_temperature` v1.0, store name "Air Temperature" (appId `airtem01`; it installed on the watch as `airtem02`). Author renamed to "O. Vitya" on 2026-10-04.
- **Sensor profiles:** SensorPush HT.w (current default), Xiaomi LYWSD03MMC (stock or pvvx firmware), RuuviTag 3.x, and generic Environmental Sensing sensors.
- **Builds:** the store build carries no demo or debug code. Make the demo and debug variants with `node test/variant.js <demo|debug> <outDir> [key=value]`.
- **Tests:** `node test/run.js` passes 613/613. Store, demo and debug builds are clean.
- **Memory (sp-mem, lowmem est32):** about 15.5 KB steady, 19.8 KB load peak, 22.0 KB run peak. That is the size of hwtest3, which ran on the Race S. The 10/12 KB budget is unreachable without a single-profile redesign (see the profile notes in SPEC).
- **UI pass, done today on Abel's feedback:**
  - Removed: the sensor-name row ("SensorPush · …") and the DEMO/LIVE word.
  - Stale values are greyed. State words are orange.
  - Trend arrow thresholds now apply in the displayed unit.
  - Humidity moved onto the trend line. MIN | MAX is now two columns.
  - New hint: "Sensor stopped sending".
  - The wrist row shows only when the wrist differs from the air by more than 3 °C / 5 °F.
  - BAT LOW now appears in the state slot.
  - All six states on q: `docs/sim/states-q.png`.
  - `tools/safe-area.js --inflate 1.15` passes on every screenshot. At 1.25 the wrist row and the "Sensor stopped sending" hint on n become tight; see the review notes.
- **Watch:** v1.0 (before this UI pass) is installed but has not run against a sensor.

## Decisions from Abel and open questions

- **He owns Xiaomi sensors, not a SensorPush (model still to confirm).** Sideloaded apps cannot have settings edited, so his test build must default to the Xiaomi profile (`sensor` in data.json).
- Name: "Air Temperature" (kept). Author: **"O. Vitya"**. Support email and FAQ URL: still open.
- To confirm with him: the UI changes he did not ask for himself (grey stale value, orange words, humidity on the trend line, wrist row hidden when close, BAT LOW in the state slot).

## Next steps

1. When Abel has a Xiaomi sensor on, scan it from the Mac to see what it broadcasts. Copy the `tools/ultrabip_capture.py` pattern and run it in Terminal, which has the Bluetooth permission. Check:
   - the name, and whether it is in the advertising packet
   - the service UUIDs
   - the GATT table and the notification format
   For the stock LYWSD03MMC, the notify characteristic is ebe0ccc1-….
2. Make a Xiaomi test build. If the name filter is needed, use the exact full name: exact names are proven to work on the watch (UltraBip probe), prefixes are not. Deploy it while holding the watch lock and read the watch log.
3. Rename the author, re-render the store images, and rebuild the source zip.

## Hardware facts (2026-10-04, Race S fw 2.53.42)

- For 16-bit SIG UUIDs, the 2-byte regUuid form works; the base-expanded 16-byte form gets event 110. Try the 2-byte form first.
- An exact local-name filter connects. A service-UUID filter failed for a device that does not advertise the UUID.
- With VarioLink v1.0 and Air Temperature v1.0 enabled together, the watch logged `WRN UI_FRAMEWORK : JsTotMem 131072/133120`.
- Inline `<eval>` inside a text line renders as a separate block on the watch, and overlapped neighbouring text on the probe. Keep each value in its own element.
