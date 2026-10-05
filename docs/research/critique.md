# Completeness critique of the six research reports (2026-10-03)

How I checked: I re-read the local reference (`suuntoplus_reference_docs.md`), the Editor 1.42.0 tooling (`lib/ng/limit.js`, `suunto-plus.js`, `source-package.js`, `javascript/check.js`, `schema/manifest.json`, the BLE template) and forum threads already cached in the scratchpad (14766, 14768, 14783, 14940, 15279, 15332, 15490, 15692, 15754, 15859). On the web I used sensorpush.com/bluetooth-api, the Bluetooth-Devices/sensorpush-ble source and the Shelly BLU docs. I also read the user's own vault (gear notes for the UltraBip, the Race S and the electronics kit). Anything marked **(inferred)** is my own reasoning and was not confirmed in a primary source.

---

## 0. Five findings that change the plans

### 0.1 SuuntoPo: the JS heap limits topo size, not the length of the settings field
- **Race S evidence.** matram found he could allocate seven 4,000-byte Uint8Arrays on a Race S before running out of memory (15279 #0). In 14940 #8 he estimates the usable heap on a Race S at about 28 KB.
- **The 133,120 B figure is from other watches.** It is a `JsTotMem` line logged by UI_FRAMEWORK on a Vertical 2 (15490), with similar logs in 15692. Nobody has measured a Race S, which is the user's watch.
- **Current SuuntoPo design:**
  - It declares three settings strings with `maxLength` 100,000 each.
  - It parses topos twice: in `main.js` onLoad and again in the template's `parseTopo`.
  - It stores each route point as its own `[x,y]` array. Every small Duktape array carries object overhead (inferred).
- **Consequence:** a topo has to be a few KB at most. Only the selected topo should be parsed, in one JS context, into flat numeric arrays or one typed array. The reference recommends a single large typed array (around L951-960).
- **Change to the suuntopo-gaps P0-9 test.** "Measure the phone-field limit" is the wrong first test. Measure heap headroom on the Race S instead: log `systemEvent` / `JsTotMem` after `getItem` and `JSON.parse` of 2, 5 and 10 KB topos, with 1 app and then 2 apps enabled.

### 0.2 SuuntoPo: the canvas render budget explains the black or misrendered screen
- **matram's Race S limits (15279):**
  - about 24 `lineTo` per path;
  - per canvas per frame, 2 × strokes + lineTo must stay at or below about 200;
  - past that budget **everything** on the canvas is dropped silently, including `fillRect` and `fillText`.
- **SuuntoPo sits on one full-screen canvas.**
  - `t.html` has 45 `beginPath`, 36 `stroke()` and 14 `fillText` call sites, many inside per-feature and per-tick loops.
  - Each crack tick and roof hatch is drawn as its own path.
  - A real topo will exceed the budget (inferred). That fits guderaber's own Race S reports of misrendering and crashes (14766 #27, #77).
- The suuntopo-gaps report did not connect this limit to the app.
- **Fixes:**
  - Cull to the viewport and batch one path per feature type.
  - Split drawing across several canvases. Each canvas has its own budget (Pottu 14766 #33; matram's tiling in 15279).
  - Count units in the renderer and cap them.
  - Make the editor enforce a maximum feature budget.

### 0.3 Vario: screen updates may be capped at about 1 Hz, and no report raised it
- **What the reference says:**
  - `evaluate` runs about once per second (L989, L1044).
  - For callbacks other than evaluate, output changes reach the watch firmware (ESW) only after the next evaluate. This is stated explicitly for `onAccelerometer` (around L1129). That the BLE handler behaves the same way is **inferred**.
  - LK8EX1 arrives at 10 Hz.
- **Possible faster paths, both untested from a BLE handler:**
  - `setText` is a native function callable from main.js (L1202, L1296). Whether it repaints immediately when called from inside the 106 handler is unknown.
  - `/Dev/Time/Tick10hz` exists in `resource-common.js` but is undocumented. matram used it on hardware to REFRESH canvases from the template. The template can only see main.js state through outputs, though.
- **Design rule:** the UltraBip is itself the audio vario, so the watch is a display only, and 1 Hz is acceptable as the baseline. Test `setText` from the handler as a 2-5 Hz path.
- **No silent haptic.** `playIndication` only plays one of six named sounds, and vibration comes with it only if the user has vibration enabled in watch settings (L1257-1274). TracerLink-style climb taps cannot be reproduced silently. A lap trigger (`$.put('Activity/Trigger',24)`) would vibrate but also creates laps, so do not use it.

### 0.4 Race S: 2 SuuntoPlus apps per sport mode, not 3
- The store report says "3 since FW 2.50.26" with no qualification.
- The forum (15692/15817) and the user's vault note `20_Gear/guides/general/Suunto Race S fields and widgets.md` (citing DC Rainmaker, Jan 2026, and the release notes) say the increase applies to Race 2 and Vertical 2 only. The Race S allows 2 apps, or 1 app plus 1 guide.
- The user's watch is a Race S, so plan for 2.

### 0.5 Temperature app: start with the sensor the user has listed, not Ruuvi
- **What the user's vault lists:**
  - `20_Gear/lists/Electronics kit.md` (multi-day / cold weather section) lists a **Sensorpush HTW** as the temperature sensor. Unlike the VOLTME charger it is not marked "(owned)", so **confirm ownership with the user**.
  - `Power and electronics.md` lists the candidates SensorPush HTW, Shelly BLU H&T, Teltonika, tempi.fi and Inkbird IBS-TH1 Mini.
- The temp-sensors report ranks Ruuvi first and puts SensorPush in the second wave.
- **Why SensorPush fits appConn:** reading is write 4 bytes, then read. That maps onto one write in flight → event 104 → `readChar` → event 102, with no notifications needed. Details are in 3b.
- **Shelly BLU H&T is ruled out.** Shelly's common BLE docs say the devices accept connections only from a paired (bonded) peer, after holding the button for 10 s to enter pairing mode. SuuntoPlus has no bonding.

---

## 1. Contradictions between reports, and how they resolve

| Topic | Reports say | Primary-source resolution |
|---|---|---|
| `out` entries | 25 (forum-ble; SUUNTOPO CLAUDE.md) vs 20 (store) | `limit.js` `MAX_RESOURCES_OUT=20` is a validator error; the schema allows `maxItems 25`. **Design for 20 or fewer.** |
| Logged outputs | 5 vs 6 | The reference says 5 (L101, L2067); the validator allows 6. **Design for 5.** |
| Images | 2 vs 16 | The reference says at most two per app (L1581); the validator allows 16 per display. **Design for 2.** Whether firmware or review enforces 2 is unknown. |
| Apps per sport mode | 3 (store) vs 2 on Race S (forum-projects) | 2 on Race S (see 0.4). |
| BLE pairing | temp-sensors: "pairing question unanswered" | Wrong. Community manager Dimitrios Kanellopoulos answered "no, afaik" on 2026-03-11 (14783 #5). The **PIN-entry** question (brechtvb) was indeed unanswered; AYamshanov switched his device to NO_PIN. Conclusion unchanged: no pairing and no PIN. |
| Heap budget | "30-40 KB per app" | Measured on Vertical 2, Race 2 and 9 Peak Pro. Race S evidence points to roughly 28 KB of usable data (14940, 15279). The per-app rule of thumb may be too generous on the user's watch (inferred). |
| "No arrays in settings" | forum-projects | True only for **phone-editable** setting types. `data.json` can hold nested objects and arrays (reference example around L2160-2180), enum `valuePath` points at an array, and `localStorage.setObject` persists objects. |
| Notes app "150-180 chars" | forum-projects | That is the on-watch display capacity without scrolling (14766), **not** a settings-field limit. The settings string limit is still undocumented apart from `maxLength` in bytes. |
| valuePath enum crash | forum-projects | Confirmed in 14766: a `valuePath` dropdown crashed the Suunto phone app, while inline `values` worked. In 15332 another enum worked only after several reinstalls. **Use inline `values`.** |
| "15 apps per watch" | suuntopo-gaps (from the SUUNTOPO CLAUDE.md) | Not in the reference. **Unverified.** |
| localStorage / JSON in the template context | suuntopo-gaps: unknown | Partial evidence that it works. Markus Hornof, a published developer, reads `localStorage.getItem` in a template's onActivate (15332). guderaber's own app parses topo JSON in the template and ran on a Race S (14766 #27/#77), probably from baked `data.json` because sideloaded settings cannot be edited (inferred). |
| Function declarations | store: "nested functions are not allowed" | The check applies to main.js. The reference's own canvas example declares `function doBuild(ctx)` inside the template onLoad (around L1680). Template scripts may use declarations (inferred from that doc example). |

---

## 2. Load-bearing claims I checked

**Verified:**

- **BLE API** (reference L2459-2610):
  - `connect(enabledZappId, handler, sp1[, sp2])`, with search-parameter types 2-9 and 255.
  - The handler receives `(characteristicId, eventId, data)` and **no connection id**.
  - Events 100-112. Writes are capped at 20 bytes and "MTU negotiation is not supported".
  - Race S is in the group with two connections and MTU 127.
  - In the official example, each state step waits for one evaluate tick, so connecting takes several seconds.
- **Undocumented events.** 113 (disconnect done), 114 (disconnect failed) and 115 (indication) appear as comments in `templates/New-SuuntoPlus-BLE-Sport-App/main.js` lines 122-126.
- **Validator limits** (`limit.js`):
  - 10 inputs and 20 outputs;
  - 6 logged outputs and 8 summary outputs;
  - `version` at most 4 characters, `name` at most 60 bytes, `description` at most 100 bytes;
  - 16 images, with image names of at most 10 characters.
- **Settings support.** `supportsSettings()` returns true only for displays n, o and q.
- **Source package contents.** `createSourcePackage` zips only top-level files: `main.js`, `manifest.json`, `data.json`, `*.html`, `*.png`, `<lang>.json` and files matching `/ext\w*.js/`.
  - That regex is unanchored, so files such as `text.js` or `next.js` would also be shipped. Minor.
- **App id.** `getAppId` takes the first 6 ASCII characters of the name plus "01". SuuntoPo's current name therefore gives `suunto01`, which matches the build file names.
- **Regex fails on the watch** (14940 #7, RunWarden). **Large literal arrays** also fail (14940 #8, matram).
- **Heap.** The 133,120 B figure is a real `JsTotMem 132180/133120` log line from a Vertical 2 (15490).
- **Canvas limits on Race S** (15279).
- **Canvas API.** `strokeRect` is not in the supported canvas list. `setTimeout` is usable in template script (L1656).
- **Activity IDs** (reference table): 16 Climbing, 74 Mountaineering, 77 Ski mountaineering, **92 Paragliding**. The manifest `activities` field exists only in the schema, as an integer array; what it does is undocumented.
- **Languages.** The schema's `languages` enum has no `hu` and no `sk`.
- **UltraBip report.** I recomputed the XOR checksums of the four sample lines: 2A, 05, 6D and 21 all match. ISA altitude for 98,705 Pa is 220.41 m. `xct976.log` has 224 LK8EX1 lines and 0 LXWP0.

**Wrong or overstated:**
- Store report: "3 apps per sport mode" (see 0.4).
- Temp-sensors report: "pairing question unanswered" (see section 1).
- UltraBip report: "haptic climb pulses" as a feature. This is not possible silently (see 0.3).
- UltraBip parser design: it builds strings with `String.fromCharCode` and `split` on every notification at 10-20 Hz. matram measured that allocating inside functions called at 10 Hz exhausts the heap over time (15279), and regex is banned. Use the byte-level parser in 3a.

---

## 3. Gaps answered by my own research

### 3a. UltraBip vario app (the user owns an UltraBip and a Race S, per the vault notes)

**Altitude calibration from sources on the watch** (reference L515-640):
- `/Fusion/Altitude/SeaLevelPressure` gives the current sea-level pressure in Pa. Use it as QNH: `h = 44330.77·(1 − (p_LK8EX1/QNH)^0.190263)`.
- Alternatively, compute an offset against `/Fusion/Altitude`.
- A put of `true` to `/Fusion/Altitude/FusedAlti` runs GPS+baro fusion for up to 15 minutes.
- `/Fusion/Altitude/VerticalSpeed` is a fallback vario when the BLE link goes stale. `/Fusion/Altitude/AltiBaroPressure` is a cross-check.
- Ground speed for glide on a BlueBip can come from the watch's own GPS: `Activity/Move/-1/Speed/Current`, following the parameter pattern around L170-190.
- Stay within the 10-input limit.

**Parser for Duktape** (inferred design, built on the constraints above):
- Keep a preallocated `Uint8Array` line buffer of about 96 B and a module-level state machine:
  1. Wait for `$`.
  2. XOR each byte as it arrives until `*`, then read the 2 hex digits.
  3. Identify the sentence by comparing bytes against `L K 8 E X 1`.
  4. Accumulate signed integer fields digit by digit.
  5. Skip LXWP0, GGA and RMC unless they are needed.
- No strings, no regex, no `split`, and no closures or variables created per event.
- Keep 30 s of history in an `Int16Array` ring buffer of 300 samples at 10 Hz (about 600 B) for time-weighted averages. Push outputs from `evaluate`.

**Logging.** Up to 5 `out` entries with `log:true` go into the FIT file at 1 Hz and appear as graphs in the Suunto app. Good candidates: vario, altitude, height above take-off.

**Activity.** 92 Paragliding exists in the activity table. Whether the `activities` field filters the app list is undocumented.

**Display-off.** Race S is AMOLED; button presses while the display is off are ignored unless the button has `enabledWhileDisplayOff`. For flight, tell users to set the paragliding sport mode's display to always-on (the per-sport display settings are noted in the user's Race S guide).

**Branding (inferred).** The store blocks "unauthorized images", so avoid Stodeus or UltraBip logos in the banner and screenshots. TracerLink names device support in its description text instead.

**Reconnection on Race S.** In 15754, Race S users report that external sensors do not reconnect after a dropout. Suunto support gives no timeline; the Renesas BT fix went to Run 2, Race 2 and Vertical 2. Whether appConn's automatic reconnect shares the bug is **inferred**. The app must show a stale or lost state clearly, and this must be tested on hardware.

**Test protocol the user can run in minutes** (resolves the UltraBip report's BLOCKING items):
1. In nRF Connect, scan for the UltraBip and open its raw advertising data. Note which AD types appear in the ADV packet versus the scan response: 0x02/0x03 containing `E0 FF`, and 0x08/0x09 containing the name.
2. Build a minimal `.dev` with `sp1 = [9, 0x55,0x6C,0x74,0x72,0x61,0x42,0x69,0x70]` and `sp2 = [3, 0xE0, 0xFF]`. Call `systemEvent` on every event, logging `eventId` and `data.length`.
3. Deploy to the Race S and read the system events.
4. Repeat with a type-8 name filter and with the full name including the emoji, to settle prefix versus exact matching.
5. The `data.length` values from event 106 show how the device splits notifications at MTU 127.

### 3b. Temperature app with SensorPush HT.w (primary source: sensorpush.com/bluetooth-api)

**GATT:**
- Service `EF090000-11D6-42BA-93B8-9DD7EC090AB0`. **Note the different base:** the characteristics end in `…EC090AA9`, the service in `…0AB0`.
- Read Temperature `EF090080`: write any 4 bytes, for example `01 00 00 00`. Within about 100 ms, read an int32 LE in units of 0.01 °C.
- Humidity `EF090081`: int32 LE in 0.01 %RH, filled by the same trigger.
- Pressure `EF090082`: HTP.xw only.
- Battery `EF090007`: int16[2] = (mV, °C), refreshed on each connection.
- LED `EF09000C`: writing 1-127 blinks the LED that many times. With no device picker, this is a useful "which sensor am I connected to" check.
- **Never write Device ID `EF090001`**: the docs say it disconnects the device immediately.
- Default advertising interval is 1,285 ms. The HT1 (1st generation) is not supported.

**Little-endian arrays** (computed):
- Service: `B0 0A 09 EC D7 9D B8 93 BA 42 D6 11 00 00 09 EF`
- Temperature: `A9 0A 09 EC D7 9D B8 93 BA 42 D6 11 80 00 09 EF`
- Humidity: `…81 00 09 EF`
- Battery: `…07 00 09 EF`

**Discovery:**
- The sensorpush-ble test fixture shows an HT.w exposing `service_uuids=[ef090000-…-0ab0]`. bleak merges ADV and scan-response data, so this proves the UUID is advertised, not that it sits in the ADV packet. Space arithmetic says it fits in the ADV packet (flags 3 + 128-bit UUID 18 + manufacturer data about 7 = 28 bytes, under 31), but this is **inferred**.
- The manufacturer-data company-ID field rotates because it carries packed readings, so a type-255 filter is unusable.
- Search parameters: `[7, B0 0A … 09 EF]` with `[6, …]` as the second.
- The name format for the HT.w is not documented. The docs' example name is "SensorPush HTP F6D6".

**Flow:**
1. connect → 100.
2. `regUuid` temperature → 107, then humidity → 107.
3. Each poll: `writeChar(temp, [1,0,0,0])` → 104.
4. On the next evaluate tick: `readChar(temp)` → 102, then `readChar(hum)` → 102.
5. Set `con = 1` after the first good read.

Keep one operation in flight. Make the poll interval a setting, 10-60 s (battery trade-off, inferred).

**Conflict (inferred).** The SensorPush phone app or a G1 gateway connecting to download history will probably block the watch while it holds the link.

**Other candidates in the user's list:**
- Shelly BLU H&T: out, because it requires bonding. It does have a "Sample BTHome data" read characteristic `d52246df-98ac-4d21-be1b-70d5f66a5ddb`, but a connection still needs a paired peer.
- Teltonika and tempi.fi: not researched. Teltonika EYE sensors are mainly advertisement-based (inferred), and appConn has no observer or scan mode.
- Show the watch's own `/Device/Measurement/Temperature.Measurement` (in kelvin) next to the sensor reading as a wrist-versus-air comparison.

### 3c. SuuntoPo additions
- **Settings cannot be tested before publishing.** SuuntoPartnerTeam said the only way to verify settings is to upload to the store and edit there (14768 #2). The paste-JSON-into-settings pipeline therefore cannot be validated by sideloading.
  - Plan an early store release (1.0) with a conservative `maxLength` and one demo topo in `data.json`.
  - Sideload tests should rely on `data.json` defaults.
- **Overriding buttons blocks pause and end.** surfboomerang confirms that while his Notes app maps the buttons, the user cannot pause or end the exercise from that screen (14766 #37). This supports suuntopo-gaps P0-7 with hardware evidence.
- **No arrays from main.js to the UI.** matram says main.js has no way to pass an array to the UI side (14766 #92), so parsing has to stay in the template. To remove the double parse:
  - main.js should not parse topos at all;
  - store small per-slot counts separately, or move navigation bounds into the template. The latter is an architecture change that needs Vitya's approval under the repo rule (inferred).
- **Name and trademark (inferred risk).** The name begins with "Suunto", which yields app id `suunto01`. None of the community store apps catalogued by forum-projects has "Suunto" in its name. Expect the store to ask for a rename.
- **Localization.** Hungarian and Slovak are not supported (verified), so English is the fallback for the primary audience.

---

## 4. Remaining gaps (need hardware or the user)
1. **Race S heap headroom** with the real topo sizes, with 1 and with 2 apps enabled. This replaces the "settings field limit" test as the first measurement.
2. **Display refresh.** Does `setText` called from the BLE 106 handler repaint before the next evaluate? Do output changes made in the handler only appear after evaluate?
3. **UltraBip discovery:** the advertising dump and the name-matching semantics (protocol in 3a).
4. **SensorPush HT.w:** is the 128-bit UUID in the ADV packet or only in the scan response (the watch's scan mode is unknown), and what is its name format?
5. **appConn reconnection on Race S** after the vario or sensor goes out of range and comes back (15754 bug scope).
6. **Canvas budget for SuuntoPo:** units per frame for the demo topo, and whether `arc` and `fillText` consume budget.
7. **Whether the store accepts names containing "Suunto"**, and the terms of the developer licence. Neither can be checked without a signed-in ApiZone account.


## Key facts
- The user's watch is a Race S: 2 SuuntoPlus apps per sport mode (or 1 app + 1 guide). The 3-app increase in FW 2.50.26 applies to Race 2 and Vertical 2 only, so the store report's unqualified '3' is wrong for this watch [vault: 20_Gear/guides/general/Suunto Race S fields and widgets.md citing DC Rainmaker Jan 2026; forum 15692]
- The 133,120 B JS heap figure was measured on Vertical 2 / Race 2 / 9 Peak Pro (UI_FRAMEWORK JsTotMem log). On a Race S, matram could allocate only 7 x 4000 B Uint8Arrays before running out (about 28 KB of usable data) [forum 15490, 15279 #0, 14940 #8]
- SuuntoPo declares 3 settings strings of maxLength 100,000 and parses them in both main.js and the template. Given the Race S heap, a topo must be a few KB, parsed once into flat or typed arrays [SUUNTOPO manifest.json; forum 15279; reference ~L951]
- Race S canvas: about 24 lineTo per path, and 2*strokes + lineTo <= ~200 per canvas per frame. Exceeding it silently drops EVERYTHING on that canvas, including fillRect and fillText. Each canvas has its own budget [forum 15279, 14766 #33]
- evaluate runs about 1 Hz, and output changes made outside evaluate reach the firmware only after the next evaluate (documented for onAccelerometer; applying it to the BLE handler is inferred). setText is callable from main.js; /Dev/Time/Tick10hz exists but is undocumented [reference L989, ~L1129, L1296; suuntoplus-tools resource-common.js]
- playIndication only plays one of 6 named sounds, and vibration comes with it only if the user enabled it in watch settings. There is no silent haptic API [reference L1257-1274]
- Validator limits: 10 in, 20 out (error; schema says 25), 6 logged (doc says 5), 8 summary, version <=4 chars, name <=60 B, description <=100 B, 16 images (doc L1581 says 2) [suuntoplus-tools lib/ng/limit.js; reference]
- BLE template main.js lists undocumented events 113 disconnect done, 114 disconnect failed and 115 indication. Documented events are 100-112 [templates/New-SuuntoPlus-BLE-Sport-App/main.js L122-126; reference L2594-2609]
- SensorPush 2nd gen: service EF090000-11D6-42BA-93B8-9DD7EC090AB0. Temperature EF090080-...-9DD7EC090AA9: write any 4 bytes, then read int32 LE x0.01 C. Humidity EF090081 (same trigger). Battery EF090007 int16[2]. Writing Device ID EF090001 disconnects [sensorpush.com/bluetooth-api]
- SensorPush HT.w advertises its 128-bit service UUID (ADV vs scan response unproven). Its manufacturer-data company ID rotates with packed readings, so filter with [7,...]/[6,...] UUID params, not 255 [Bluetooth-Devices/sensorpush-ble parser.py and tests]
- The user's vault lists a Sensorpush HTW as the kit temperature sensor (not marked owned) and Shelly BLU H&T, Teltonika, tempi.fi and Inkbird IBS-TH1 Mini as candidates. The user owns a Stodeus UltraBip and a Suunto Race S [vault 20_Gear/lists/Electronics kit.md; Power and electronics.md; Stodeus UltraBip.md; Suunto Race S.md]
- Shelly BLU devices accept connections only from a paired (bonded) peer, so the Shelly BLU H&T is unusable from SuuntoPlus [shelly-api-docs.shelly.cloud/docs-ble/common]
- On-watch altitude calibration for the vario: /Fusion/Altitude/SeaLevelPressure (Pa) as QNH, a FusedAlti put for GPS+baro fusion up to 15 min, and /Fusion/Altitude/VerticalSpeed as a fallback vario [reference L515-640]
- Activity IDs: 16 Climbing, 74 Mountaineering, 77 Ski mountaineering, 92 Paragliding. The manifest 'activities' field exists in the schema only; its effect is undocumented [reference activity table ~L5671; schema/manifest.json]
- Phone settings can only be verified by publishing to the store and editing there; sideloaded apps cannot have settings edited [forum 14768 #2 SuuntoPartnerTeam]
- When an app overrides the buttons, the user cannot pause or end the exercise from that screen [forum 14766 #37, Notes app]
- valuePath enum crashed the Suunto phone app while inline 'values' worked; use inline values [forum 14766]
- The pairing question was answered: Suunto community manager said no pairing is needed (14783 #5). The PIN-entry question went unanswered; the workaround is the device's NO_PIN mode [forum 14783]
- Source package zips only top-level main.js, manifest.json, data.json, *.html, *.png, <lang>.json and files matching the unanchored /ext\w*.js/. getAppId = first 6 ASCII chars of name + '01', so the current SuuntoPo name gives 'suunto01' [suuntoplus-tools source-package.js, suunto-plus.js]
- UltraBip report checks out: XOR checksums of the 4 sample lines verified (2A, 05, 6D, 21); ISA altitude for 98705 Pa = 220.41 m; the 2023 XCTrack log has 224 LK8EX1 and 0 LXWP0 [recomputed; xct976.log]

## Open questions
- Does the user actually own the SensorPush HT.w (it is listed in Electronics kit but not marked owned), or should the temperature app target another sensor? Teltonika and tempi.fi were not researched.
- Usable JS heap on the Race S with 1 and 2 apps enabled, after loading and parsing 2/5/10 KB topo strings. This now matters more than the phone settings-field length.
- Does setText called from the BLE 106 handler repaint before the next evaluate, or are all screen updates capped at about 1 Hz?
- UltraBip advertising: is 0xFFE0 in the ADV packet or the scan response? Is the name in ADV? Does the watch match type-9 names exactly or by prefix? The user can test this with nRF Connect plus a minimal .dev on their Race S.
- SensorPush HT.w: is the 128-bit service UUID in the ADV packet (the watch's scan mode is unknown), and what is the advertised name format?
- Does appConn's automatic reconnection on Race S suffer from the native-sensor reconnection bug reported in forum 15754?
- Do canvas arc and fillText calls consume the ~200-unit per-frame budget, and how many units does a realistic SuuntoPo topo need?
- Will the store accept an app name containing 'Suunto' (SuuntoPo), or images and names referencing Stodeus/UltraBip? Needs the signed-in ApiZone developer licence terms.
- Is the 2-image limit in the reference (vs 16 in the validator) enforced by firmware or store review?
- What does the manifest 'activities' field (e.g. 92 Paragliding, 16 Climbing) actually do on the watch or in the store?

## Sources
- ../SUUNTOPO/reference/suuntoplus_reference_docs.md — Local SuuntoPlus reference: BLE API L2459-2610; lifecycle L989-1044; onAccelerometer output-propagation note ~L1129; native functions L1201-1340; canvas API ~L1636-1656; images L1581; settings/localStorage L2155-2250; Fusion/Altitude resources L515-640; activity IDs ~L5671
- ~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/ng/limit.js — Validator limits (out 20, logged 6, images 16, etc.)
- ~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/source-package.js — Source package file inclusion rules
- ~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/suunto-plus.js — supportsSettings (n/o/q only) and getAppId
- ~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/templates/New-SuuntoPlus-BLE-Sport-App/main.js — Undocumented BLE events 113/114/115 at L122-126
- https://forum.suunto.com/topic/15279 — matram: Race S canvas render budget, heap allocation test, Tick10hz usage
- https://forum.suunto.com/topic/14940 — Regex and large literal arrays fail on watch; ~28 KB Race S heap estimate
- https://forum.suunto.com/topic/15490 — JsTotMem 133120 B log line (Vertical 2), toggle leak
- https://forum.suunto.com/topic/14766 — SuuntoPo posts (guderaber), Nikolai Simonov advice, Pottu multi-canvas, Notes app button override, valuePath enum crash, no-array main.js-to-UI note
- https://forum.suunto.com/topic/14768 — Settings only verifiable after store upload
- https://forum.suunto.com/topic/15332 — localStorage.getItem used in template onActivate; enum valuePath issues
- https://forum.suunto.com/topic/14783 — Community manager: no pairing needed (#5); PIN question unanswered; NO_PIN workaround
- https://forum.suunto.com/topic/15754 — Race S external-sensor reconnection bug, no fix timeline
- https://www.sensorpush.com/bluetooth-api — SensorPush 2nd-gen GATT protocol (service/characteristic UUIDs, write-then-read flow, battery, LED, advertising interval)
- https://github.com/Bluetooth-Devices/sensorpush-ble — parser.py and tests: HT.w advertises service UUID ef090000-...-0ab0; rotating manufacturer-data IDs carry packed readings
- https://shelly-api-docs.shelly.cloud/docs-ble/common — Shelly BLU devices connectable only from a paired peer; Sample BTHome data characteristic
- https://shelly-api-docs.shelly.cloud/docs-ble/Devices/BLU/ht — Shelly BLU H&T: BTHome beacon every minute; no device-specific GATT data
- (owner's private notes) — User vault: Race S 2-app limit per sport mode, 3-app increase is Race 2/Vertical 2 only
- (owner's private notes) — User vault: Sensorpush HTW listed as the kit temperature sensor (ownership not marked)
- (owner's private notes) — User vault: UltraBip status owned
