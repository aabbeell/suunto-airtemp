<!-- ABOUTME: Product and technical specification for the ble_temperature SuuntoPlus device app (off-wrist BLE air temperature and humidity). -->

## BINDING DECISIONS (2026-10-03, after this spec was written; these override the spec below)

**HARDWARE RESULTS 2026-10-04, Xiaomi LYWSD03MMC stock - binding:** (1) `evalFile('{file_path}/…')` works only in main.js; from an ext file it fails ("opening {file_path}/ext10.js failed", app disabled), so every ext file is loaded by main.js. (2) The watch's own Searching view gives up after about 24 s ("could not find") and disables the app, while the Xiaomi needs about 25 s from load to its first frame (14 s scan, 7 regUuid ticks, enable). A 15 s `con = 3` escape was tried and failed: the watch treats `con = 3` as not found and disables the app at once (10:52:12, exactly 15 s after load, mid-registration). Binding: `con = 1` on every 100 (the link itself), which closes Searching at about 12 s; `con = 3` only for WRONG and BT ERROR, where dropping the app is right; the 60 s never-found rule stays but the watch's 24 s timeout fires first. Mac capture: `docs/hw/`.

**HARDWARE RESULTS 2026-10-04 (Race S fw 2.53.42) - binding:** with LiftLink Vario v1.0 and Air Temperature v1.0 enabled together the firmware logged "WRN UI_FRAMEWORK : JsTotMem 131072/133120" (heap practically full). For 16-bit SIG UUIDs the plain 2-byte regUuid form works and the base-expanded 16-byte form gets 110 CONFIG_FAILED (measured with the UltraBip's FFE1): try the 2-byte form first. The user owns Xiaomi sensors (model to be confirmed), not a SensorPush: the default sensor for test builds should be Xiaomi.

1. Discovery: follow docs/research/deep-dive/ble-discovery.md for what each sensor actually advertises (confirmed from source): SensorPush HT.w has its 128-bit service UUID in the advertising packet (filter [7,...]/[6,...]); RuuviTag has manufacturer data 0x0499 in the advertising packet while its name and NUS UUID are only in the scan response; whether sp2 is used at all is unproven, so the decisive filter goes in sp1.
2. Do not depend on indicate-only characteristics (HTS 0x2A1C); use 0x2A1E when exposed. For 16-bit UUIDs register both the 2-byte and the base-expanded 16-byte form under separate characteristic ids and keep the one that delivers data (deep-dive ble-gatt.md).
- Platform rules found after this spec was written are in `docs/research/deep-dive/` (limits.md, ble-gatt.md, refresh-rate.md, ble-discovery.md, suuntopo-crash.md). They are binding and override this spec where they differ. The most important:
  - No single allocation above ~4,000 B (string, array of more than ~500 elements, typed-array buffer, compiled function or ext file); oversize requests fail outright and try/catch does not contain them. Keep anything (re)created during an exercise under ~2 KB.
  - data.json (settings + localStorage, one file) must stay under ~2 KB, never above ~3.5 KB; every localStorage call allocates a buffer the size of the whole file, so call it only in onLoad, on rare user actions or at exercise end.
  - Never use `output` as a bare value: only `output.<name>` inside lifecycle functions (or passed as an argument to a module-level helper). Never write outputs from the BLE handler, closures or ext files, never alias `output`.
  - Every appConn call goes in try/catch (an uncaught BLE error disables the app); no appConn call before event 100; 107 means 'registered locally' only; treat 106 and 115 alike; one GATT request in flight; a handler firing faster than 1 Hz must allocate nothing (no new, literals, string concatenation or closures).
  - The display is guaranteed to update only once per evaluate (~1 Hz).
  - Race S: 2 SuuntoPlus app slots per sport mode.
- **Memory budgets (binding, measured with the calibrated Duktape harness; its numbers match real watch allocation logs byte for byte):** run `bash ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/build.sh` once, then `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/sp-mem.js <appDir>` (see its README; write scenarios for your app). Use the lowmem est32 columns. Targets: BLE display app peak <= 12 KB and steady <= 10 KB; canvas topo app peak <= 20 KB and steady <= 16 KB including the topo; every compiled function block <= ~1.9 KB; no allocation per BLE notification; no cyclic garbage per frame (hoist callbacks out of draw loops). For reference: SUUNTOPO v0.3 is 31 KB steady with empty slots and has a 6.9 KB function block (both fail); the hardware-test app hwtest3 that ran fine on the user's Race S is 15.7 KB steady.

<!-- ABOUTME: Source of truth for implementation, tests, simulator checks, hardware checks and the store listing; written 2026-10-03, before any code. -->

# ble_temperature: specification

Status: v1.0 implemented 2026-10-03: unit-tested, built and checked in the simulator; the hardware checks in §17c are still open. Where implementation showed this spec to be wrong, the text below carries a **[Corrected …]** marker and §22 gives the replacement. Store name: **Air Temperature**. App folder: `src/air_temperature/`. Review round 2 (§22.15) changed the screen rules, the memory layout and several BLE edge cases. Review round 3 (§22.16) applied the memory savings plan: 15.4-15.6 KB steady, 19.6 KB load peak, 22.4 KB run peak; the binding 10 KB / 12 KB budget is still not met, and §22.16 shows it cannot be by trimming this app. The screen pass of §22.17 removed the sensor row and the LIVE/DEMO word, greys a stale value and moved humidity onto the trend line.

## How to read the citations

| Tag | Source |
|---|---|
| `[ref L123]` | `../SUUNTOPO/reference/suuntoplus_reference_docs.md`, the authoritative API reference |
| `[ex: Folder/file Lnn]` | `../SUUNTOPO/reference/suunto_plus_examples/` (official examples) |
| `[tpl: file Lnn]` | `~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/templates/New-SuuntoPlus-BLE-Sport-App/` |
| `[tools: path]` | `~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/` |
| `[temp Lnn]`, `[crit Lnn]`, `[fble Lnn]`, `[store Lnn]`, `[fproj Lnn]` | `docs/research/temp-sensors.md`, `critique.md`, `forum-ble.md`, `store.md`, `forum-projects.md` |
| `[verified here]` | Checked on 2026-10-03 while writing this spec, by running the Editor 1.42.0 build library and reading its data tables (details in §20) |

Where research reports disagree, the critique wins [task rule]. **(inferred)** marks a design assumption that no source confirms; each one has a matching test in §17.

---

## 0. Key decisions

1. **One sensor profile per session, chosen by an inline-enum phone setting.** The default in `data.json` is SensorPush HT.w (`"sensor": "0"`). A sideloaded build always uses that default, because settings of sideloaded apps cannot be edited [crit L196-198, L233]. To test another profile on a sideloaded watch, rebuild with a different default.
2. **Each profile lives in its own `extN.js`, loaded once with `evalFile`.** Only the selected profile's UUIDs and parser are in memory [ref L1204-1226, L3246-3290; tpl: main.js L132-137]. Within a profile, the app picks the GATT variant by which `regUuid` succeeds: Xiaomi stock firmware vs pvvx/ATC, and ESS 0x2A6E vs the legacy 0x2A1F. **[Corrected in implementation, see §22.2]**
3. **Optional "Sensor name" string setting.** When set, it replaces the profile's discovery filter with an exact name match. This pins one sensor when several are nearby and makes pvvx/ATC sensors findable. **[Corrected, §22.14: Xiaomi and ESS only; ignored for SensorPush and Ruuvi]**
4. **Units follow `/Settings/Unit/UnitsMode`** (0 metric, 1 imperial) [ref L893-899]. There is no separate temperature-unit resource; I checked every `/Settings/Unit/*` path [verified here]. The app has no unit override setting, so its 0.1° values always match the native summary and graph units.
5. **On screen: 0.1° resolution, drawn by main.js with `setText`.** In the FIT file: kelvin with format `Temperature_Fourdigits`, the only negative-safe temperature format [ref L6729-6737; verified here: `OneDecimal`/`TwoDecimal` have `System.Min 0`].
6. **No buttons overridden, no canvas, no images.** Pause, lap and exit stay native [crit L199]. The canvas render budget is not used at all [crit L19-23].
7. **A two-condition demo guard.** Demo runs only when `appConn.connect` returns `undefined` **and** `typeof enabledZappId === 'function'`, matching the simulator's known shape positively [fble L180]. A watch where `enabledZappId` is unset or a number therefore never starts demo. Demo drives the real state machine through a fake `appConn`, so the simulator exercises the shipping parsers and UI.
8. **The user is never trapped in "Searching".** After 60 s without a connection, `con` becomes non-zero and the app screen explains what to try. The connection attempt stays pending. **[Corrected, §22.14: the escape applies until `con` has once been non-zero, whatever the link does]**
9. **English-only v1, structured for translation.** All text goes through `{{key}}` tokens. Built-in `TXT_*` tokens are translated automatically for every language that gets a `<lang>.json` [verified here].
10. **Tooling blocker.** `tools/sp-build.js` currently rejects every `ext*.js`, including the official template's. See §19.1. Code work needs that fixed first. **[Resolved: commit 394cc28 makes sp-build validate only main.js; the app builds with the plain tool, §22.1]**

---

## 1. Problem, users, use cases

**Problem.** The watch's temperature sensor sits against the wrist. Body heat pushes it 7-9 °C above air temperature when the watch is not under a sleeve [temp L82; forum 6535]. Users ask for an off-body sensor ("like Tempe") or a calibration [temp L83]. Garmin Tempe is ANT+ only, and Suunto has no temperature pod [temp L76, L83]. No SuuntoPlus app reads an ambient-temperature sensor yet [temp L89; fble L207].

**Target users**
- Alpinists, ski tourers and winter hikers who want true air temperature without taking a glove off [temp L82]. This includes the user: Race S, alpinism, sensor listed in the kit [crit L51-56].
- Trail runners and cyclists who want the real conditions in their FIT file, for example for heat-acclimation notes.
- Owners of a SensorPush, Xiaomi LYWSD03MMC or RuuviTag who already have the sensor for home or van use.

**Use cases**
1. *Glanceable now-value.* The sensor is clipped outside the pack in the shade. The user glances at the watch and sees "-12.3 °C ↘" and 78 % humidity.
2. *Trend.* "Is it getting colder as we gain height, or as the sun drops?" The trend arrow and °/h answer it.
3. *Extremes.* "How cold did it get on the ridge?" The screen shows exercise min/max, and the summary shows min/avg/max.
4. *Wrist vs air.* Shows how far the wrist sensor is off. Useful for calibrating one's own sense of the native field.
5. *Post-activity record.* Air temperature and humidity graphs in the Suunto app; min/avg/max in the summary.

**Non-goals for v1:** body/core temperature (the official CORE app exists [temp L71]), weather forecasting, alarms (vibration only comes through `playIndication` with sound [crit L44]), sensor configuration, history download from the sensor, and two sensors at once.

---

## 2. Supported and unsupported sensors

| # | Enum label (setting) | Discovery (search params) | GATT | Confidence |
|---|---|---|---|---|
| 0 | `SensorPush HT.w/HTP.xw (beta)` **[§22.14]** | 128-bit service UUID, complete and incomplete lists | Poll: write 4 bytes, then read int32 LE ×0.01 | Protocol documented [crit L155-186]. Whether the UUID is in the ADV packet or only in the scan response is **unverified** [crit L174, L212]. |
| 1 | `Xiaomi LYWSD03MMC (beta)` | Exact name `LYWSD03MMC`, plus `ATC_` (matches only if the watch prefix-matches names) | Stock: notify `ebe0ccc1`, 5-byte frame. pvvx/ATC: ESS 0x2A6E/0x2A6F notify | Name location (ADV or scan response) and match semantics are **unverified** [temp L69, L114, L186, L212] |
| 2 | `RuuviTag fw 3.x (beta)` | Manufacturer data 0x0499; NUS UUID | NUS TX notify, DF5 18-byte heartbeat | Manufacturer-ID prefix match proven on hardware by FORM [temp L22]; protocol documented [temp L70] |
| 3 | `Other ESS sensor (beta)` | 16-bit 0x181A, complete and incomplete lists | ESS 0x2A6E/0x2A6F notify, `readChar` poll fallback | Spec-level; the notify trigger trap [temp L38-42] |

A profile loses its "(beta)" label after it passes the §17c hardware checklist with a real sensor. Labels can be renamed safely; **values must never be reordered**, because the setting stores an index [ref L2229].

**Cannot work, and the store text and FAQ say so:**
- **Shelly BLU H&T.** It accepts connections only from a bonded peer, and SuuntoPlus has no bonding or PIN [crit L57, L191; fble L132-134].
- **Garmin Tempe.** ANT+ only; current Suunto watches have no ANT+ [temp L76].
- **Broadcast-only hygrometers**: Govee, ThermoBeacon, Inkbird IBS-TH, Qingping stock, BlueMaestro, SwitchBot. Their data is in advertisements, and `appConn` has no scan or observer mode [temp L74-75, L121; fble L19, L209].
- **SensorPush HT1 (1st gen)** [temp L72].
- **CORE body temperature.** Use the official SuuntoPlus CORE app [temp L71].

---

## 3. Architecture

### 3.1 Files (`src/air_temperature/`, all top-level, since the source package ignores subfolders [store L33-37]) **[Corrected, §22.16: ext1-4 resident parts, ext9-12 tables, ext13 registration, ext14 name, ext15 rotation; ext5 is in the demo variant only]**

| File | Role |
|---|---|
| `manifest.json` | `type: device`, 2 inputs, 3 outputs, 3 settings (§11) |
| `data.json` | Setting defaults plus hidden `demo`/`debug` keys (§11) |
| `main.js` | State machine, event handler, validation, stats, trend, formatting, UI updates |
| `ext1.js` | Profile 0: SensorPush |
| `ext2.js` | Profile 1: Xiaomi stock + pvvx/ATC |
| `ext3.js` | Profile 2: RuuviTag |
| `ext4.js` | Profile 3: generic ESS |
| `ext5.js` | Demo shim (fake `appConn` + synthetic weather). Loaded only in demo mode. |
| `ext6.js` | Load-time helper: settings, name override, debug logger (§22.3) |
| `ext7.js` | Connection setup stepper, loaded on each event 100 and released when done (§22.2) |
| `ext8.js` | Exercise summary builder, loaded once from `getSummaryOutputs` (§22.3) |
| `t.html` | One display-independent template for n, o and q [ref L1566] |
| `en.json` | All custom UI strings |

Tests go in `test/`, store assets in `store/` and builds in `builds/v<version>/` [CLAUDE.md].

### 3.2 Profile module contract (ext1-ext4) **[Corrected in implementation, see §22.2 and §22.16]**

Each file is a single function expression returning a plain object. This is the template's form [tpl: ext1.js L7-27]. The Editor's `minifyExt` wraps the source in parentheses and emits the expression [verified here: tools `project/minify.js`; the built `.dev` contains `function(evHandler){...}`]. `main.js` does `prof = evalFile('{file_path}/ext' + (sensor + 1) + '.js')();` once and keeps only the returned object.

```js
// ABOUTME: ...
// ABOUTME: ...
function () {
  return {
    lb: 'SensorPush',          // short label for the sensor row [removed with the sensor row, §22.17]
    s1: [7, 0xB0, ...],         // default search param 1 (type byte + up to 16 bytes)
    s2: [6, 0xB0, ...],         // default search param 2
    k: 0,                       // kind: 0 poll write-then-read, 1 notify with read fallback, 2 notify only
    iv: 0,                      // expected sample interval in s; 0 = use the poll setting
    g: [                        // registration groups, tried in order; first group whose REQUIRED char registers wins
      [ /* [charId, role, required, svcLE16, chrLE16, sig16] ... */ ]
    ],
    p: function (role, d) { ... } // parse one payload; writes module result vars via return code (see §6)
  };
}
```

- Roles: `T` temperature, `T1` legacy temperature ×0.1, `H` humidity, `B` battery (mV), `BP` battery (%), `F` combined frame (temperature + humidity + battery mV), `L` LED.
- `sig16` = 1 marks a SIG 16-bit UUID. For these, a 108 failure is retried once with 2-byte arrays (§5.4).
- `p` returns its results through 3 numbers: `pT` (°C or `NaN`), `pH` (% or `NaN`) and `pB` (mV, percent, or `NaN`, with `pBk` = 0 for mV and 1 for %). It writes them to a 4-slot `Float32Array` that main.js passes in. That avoids allocating an object per notification [fproj L142].

### 3.3 Data flow

```
phone settings / data.json ──► onLoad: sensor, name, poll, demo, debug (localStorage.getItem)
                                   │
                                   ▼
                     evalFile(extN) ─► profile {s1,s2,k,g,p}
                                   │
evaluate() 1 Hz ── state machine ──┼─► bt.connect / regUuid / enaCharNotf / writeChar / readChar
   ▲                               │        (bt = appConn, or the demo shim; one op in flight)
   │                               ▼
   │        bleEventHandler(ch, ev, d): 100/101/102/103/104/105/106/107/108/109/110/111/112/115
   │            │  records events and op completions; on 102/106/115 calls prof.p(role, d)
   │            ▼
   │      accept(): sentinels → plausibility → jump filter → tC, rh, bat, ageTicks = 0
   │
   └── each tick: stats (if exercise running), trend ring, stale check,
                 outputs con / airT (K) / rh (%), then UI strings via setText/setStyle (only on change)
                                   │
                                   ▼
               t.html (static elements with ids)      FIT: airT, rh logged at ~1 Hz [ref L101, L2054-2067]
                                                     Summary: getSummaryOutputs() min/avg/max air, avg RH
```

All `appConn` calls are made from `evaluate()` [ref L2611-3168; fble L81-93; task rule]. The event handler only stores state and parses bytes. Output changes reach the firmware after `evaluate` [ref L1129; crit L37-38], so every UI and output update also happens in `evaluate`.

---

## 4. Sensor selection and discovery

### 4.1 Mechanism
- `appConn.connect(enabledZappId, handler, sp1[, sp2])`. Byte 0 of each search param is the AD type: 2/3 for 16-bit UUID lists, 6/7 for 128-bit lists, 8/9 for short/complete name, 255 for manufacturer data [ref L2490-2521]. The documented maximum is 16 bytes, but the template uses 17-byte params (type byte + 16) [tpl: ext1.js L24-25; fble L71]. So the 16-byte limit applies to the bytes after the type byte (inferred from the template).
- There is no disconnect, scan, RSSI, MAC filter or device picker. The first matching device wins [fble L19, L136-139].
- **Discovery is fixed when `connect()` is called.** A `connect()` that never finds a device cannot be cancelled. The official MultiSensor example does call `connect()` twice, but only after the first device has connected [ex: MultiSensor/main.js L22-25, L100-112]. A "try profile A, then B" sequence is therefore impossible. Two parallel pending connects are undocumented, and each would hold one of the watch's 2 connection slots [ref L2470-2472].

### 4.2 Name override (setting `name`) **[Corrected, §22.14: used by Xiaomi and ESS only]**
- If `name` (trimmed by hand, since main.js cannot use regex [fproj L141]) is 1-15 characters of printable ASCII (0x20-0x7E), then `sp1 = [9].concat(bytes)` and `sp2 = [8].concat(bytes)`. Otherwise the profile's `s1`/`s2` are used.
- If the name contains non-ASCII characters, the setting is ignored and the sensor row shows `{{nameBad}}` ("Name must be ASCII").
- Limits: names are exact or prefix matches (undocumented), and the name may sit only in the scan response, which matters if the watch scans passively [temp L114, L185-186, L211-212; fble L73]. Hardware test H6 settles both questions.

### 4.3 Trade-offs considered

| Option | Verdict |
|---|---|
| A. Enum setting chooses the profile (search params, UUIDs, parser) | **Chosen.** Deterministic, cheap, documented setting type [ref L2224-2229]. Inline `values` only: `valuePath` crashed the Suunto app [crit L73]. Cost: the user must pick the type in the Suunto app, and sideloaded builds use the `data.json` default. |
| B. Detect the profile after connecting, by which `regUuid` succeeds | **Used only inside a profile.** It cannot widen discovery beyond the 2 search params set at connect time. It relies on 108 firing when the UUID is absent (inferred from error code 6 "characteristic map failed" [ref L3176-3183]; H9). If `regUuid` succeeds anyway and the later 110/103 fails, that failure moves on to the next group too. |
| C. "Auto" over SensorPush + Ruuvi | **Rejected.** SensorPush needs both the 6 and 7 UUID-list params (which list type it uses is unknown [crit L174]), so no param is left for Ruuvi. |
| D. Two parallel `connect()` calls | **Deferred to v2 experiment (H15).** Pending connects cannot be cancelled. They may consume both connection slots, and native sensors may share the limit [temp L214; fble L106-109]. |
| E. Name-based discovery | **Optional override (§4.2).** Pins one device and makes pvvx findable; same unknowns as C/D. |

### 4.4 Sideloading consequence
Sideloaded builds cannot have settings edited [crit L196-198, L233; store L70-71]. So `data.json` decides what a test build connects to:
- `"sensor": "0"`: SensorPush. This is the shipped default and the user's kit sensor [crit L51-53].
- Variant test builds change only that one key. They are built into `builds/v<ver>-s<N>/` and never shipped.

The name setting, and any non-default setting, can only be verified after the first store release [crit L196]. Plan a fast 1.1 release.

---

## 5. BLE protocol per profile

### 5.1 Common UUID encoding
- `regUuid(conn, charId, svcLE[16], chrLE[16])` takes 16-byte arrays in reversed canonical byte order [ref L2529-2550; fble L76-78].
- SIG 16-bit UUIDs are expanded onto the base `0000xxxx-0000-1000-8000-00805F9B34FB`. The LE form is `[0xFB,0x34,0x9B,0x5F,0x80,0x00,0x00,0x80,0x00,0x10,0x00,0x00, lo, hi, 0x00,0x00]` [temp L133-134; fble L79; task rule].
- Profiles store canonical bases plus 2 varying bytes. A helper builds the arrays **only when registering**, never per tick.

| Name | Canonical | LE array (bytes 0..15) |
|---|---|---|
| SP service | `EF090000-11D6-42BA-93B8-9DD7EC090AB0` | `B0 0A 09 EC D7 9D B8 93 BA 42 D6 11 00 00 09 EF` [crit L168] |
| SP temperature | `EF090080-11D6-42BA-93B8-9DD7EC090AA9` | `A9 0A 09 EC D7 9D B8 93 BA 42 D6 11 80 00 09 EF` [crit L169] |
| SP humidity | `EF090081-…0AA9` | `… 81 00 09 EF` |
| SP battery | `EF090007-…0AA9` | `… 07 00 09 EF` |
| SP LED | `EF09000C-…0AA9` | `… 0C 00 09 EF` [crit L163] |
| SP Device ID (**never write**) | `EF090001-…` | not registered; writing it disconnects the sensor [crit L164] |
| Mi service | `ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6` | `A6 A3 7D 99 F2 6F 1A 8A 0C 4B 0A 7A B0 CC E0 EB` [temp L140] |
| Mi data | `ebe0ccc1-…` | `A6 A3 7D 99 F2 6F 1A 8A 0C 4B 0A 7A C1 CC E0 EB` [temp L141] |
| NUS service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` | `9E CA DC 24 0E E5 A9 E0 93 F3 A3 B5 01 00 40 6E` [temp L136] |
| NUS TX | `6E400003-…` | `9E CA DC 24 0E E5 A9 E0 93 F3 A3 B5 03 00 40 6E` [temp L137] |
| ESS / BAS service | 0x181A / 0x180F | base with `1A 18` / `0F 18` |
| ESS temperature / legacy / humidity | 0x2A6E / 0x2A1F / 0x2A6F | base with `6E 2A` / `1F 2A` / `6F 2A` |
| Battery level | 0x2A19 | base with `19 2A` |

A unit test (T1) derives every array from its canonical string and compares it with the literal in the ext file. Transcription errors are the most likely bug here.

### 5.2 Search params per profile (when `name` is empty)

| Profile | sp1 | sp2 |
|---|---|---|
| SensorPush | `[7, B0 0A 09 EC D7 9D B8 93 BA 42 D6 11 00 00 09 EF]` | `[6, same 16 bytes]` [crit L176] |
| Xiaomi | `[9, 0x4C,0x59,0x57,0x53,0x44,0x30,0x33,0x4D,0x4D,0x43]` ("LYWSD03MMC") [temp L149] | `[9, 0x41,0x54,0x43,0x5F]` ("ATC_"; matches only if names prefix-match, otherwise harmless) **[Corrected, §22.4: sp2 = sp1]** |
| Ruuvi | `[255, 0x99, 0x04]` (company 0x0499 LE) [temp L146; prefix match proven, temp L22] | `[7, NUS service LE]` (scan response, used only if the watch scans actively) [temp L70] **[Corrected, §22.4: sp2 = sp1]** |
| ESS | `[3, 0x1A, 0x18]` | `[2, 0x1A, 0x18]` [ref L2521 pattern; temp L144] |

### 5.3 Registration groups (charId: role, required) **[Corrected in implementation, see §22.2]**

| Profile | Group A | Group B (if a required char in A gets 108) |
|---|---|---|
| SensorPush | 1:T req · 2:H opt · 3:B opt · 4:L opt | none; on failure → WRONG SENSOR |
| Xiaomi | 1:F (Mi data) req | 5:T (0x2A6E) req · 6:H (0x2A6F) opt · 7:BP (0x2A19 in 0x180F) opt (pvvx/ATC [temp L68]) |
| Ruuvi | 1:F (NUS TX) req | none |
| ESS | 5:T (0x2A6E) req · 6:H opt · 7:BP opt | 8:T1 (0x2A1F, ×0.1) req · 6:H opt · 7:BP opt |

- CharIds are unique within the app. A failed id is never reused.
- Once `registered = 1`, registration is never repeated after a reconnect [ref L2700-2706; fble L84].

### 5.4 State machine (main.js, 1 tick = 1 `evaluate` ≈ 1 s [ref L989, L1044]) **[Corrected in implementation, see §22.2, §22.5]**

States: `INIT 0`, `LINK 1` (waiting for 100), `REG 2`, `CFG 3`, `RUN 4`, `LOST 5` (after 101), `WRONG 6`, `FAIL 7` (connect call failed 3 times).

- **One operation in flight.** `op` holds the pending call (`R` regUuid, `N` enaCharNotf, `W` writeChar, `D` readChar) and `opAge` counts ticks. A new call is issued only when `op == 0`. Multiple writes in one tick raise "Duktape BLE API 9" and the firmware disables the app [fble L124-126].
- **Timeout.** An op with no completion event after 5 ticks counts as failed (as if 103/105/108/110 arrived).
- **INIT, tick 1.** Build the search params (§4.2/5.2) and `cid = appConn.connect(enabledZappId, bleEventHandler, sp1, sp2)`.
  - Demo check (§13).
  - Otherwise go to `LINK`.
  - If `typeof cid === 'undefined'` but this is not demo, go to `FAIL` immediately. This is a real-watch anomaly; show `{{stFail}}`.
- **LINK.**
  - On 100: if `registered`, go to `CFG` (notify kinds) or `RUN` (poll kind); else go to `REG`.
  - On 112: retry `connect` after 30 ticks, at most 3 times, then `FAIL`.
  - Never-found rule: after 60 ticks in `LINK` before the first ever 100, set `con = 3` so the Searching view closes, and keep waiting (§12).
- **REG.** Issue the next registration of the current group.
  - 107: next char.
  - 108 on a `sig16` char: retry once with 2-byte arrays `[lo,hi]` for both service and characteristic (open question whether `regUuid` accepts them [temp L183, L210]).
  - 108 on an optional char: mark it absent and continue.
  - 108 on a required char: abandon the group and go to the next. If there is none, go to `WRONG` (`con = 3`, state text `{{stWrong}}`).
  - When the group is done: `registered = 1`, `grp` fixed.
- **CFG (k = 1, 2).** `enaCharNotf` for each notify role, in order F/T then H (not B or BP: read those once). 109 → next; 110 → for k = 1, mark that role `poll`; for k = 2 (Ruuvi), retry once, then show `{{stNoData}}`.
  - Then: read BP (char 7) once if registered, set `con = 1` and go to `RUN` [ref L2770-2800].
  - **Ruuvi deadline:** TX notifications must be enabled within 12 s of connecting, or the tag reboots [temp L70]. The machine needs about 3 ticks after 100 on first connect (100 → REG → 107 → CFG → 109) and about 1 tick on reconnects. Both are well inside 12 s, and test T7 asserts ≤ 4 ticks.
- **RUN, poll (k = 0, SensorPush)** [crit L178-186]:
  1. After every 100: read B (char 3) once → 102 (the battery value is refreshed per connection [crit L162]).
  2. Only on the first connection: write `[3]` to L (char 4), so the LED blinks 3 times and shows which sensor is connected [crit L163]. Ignore 105.
  3. Every `P` s (poll setting): `writeChar(1, [1,0,0,0])` → 104 → next tick `readChar(1)` → 102 → parse T → next tick `readChar(2)` (if H is registered) → 102 → parse H. The poll timer restarts when a cycle completes or fails, never on a fixed clock. A `P = 5 s` setting with a 3-tick cycle plus a timeout therefore cannot queue a second write while one is in flight.
  4. The research states one trigger fills both temperature and humidity [crit L160]. H3 verifies it. If it turns out false, set profile flag `hw = 1` to write `[1,0,0,0]` to char 2 before reading H. That is a one-line change.
  5. Set `con = 1` after the first good T read [crit L184].
  6. Three consecutive failed cycles show `{{stNoData}}`; polling continues.
- **RUN, notify (k = 1, 2).** Data arrives as 106. 115 (undocumented "Indication") is treated the same [tpl: main.js L105-127; temp L125, L194]. For k = 1:
  - If no valid sample arrives within 15 ticks after the last 109, or a role was marked `poll`, then `readChar` that role every `P` ticks (ESS trigger trap [temp L38-42]).
  - A 102 restarts the 15-tick notify watch.
- **LOST.**
  - On 101: `con = 0` (as the template does [tpl: main.js L182-193]), clear `op`, keep the last value (it greys out by staleness), go to `LOST` and show `{{stReconn}}`.
  - The system reconnects on its own [ref L2597].
  - On 100: `registered` is set, so go straight to `CFG` (re-enable notifications [fble L84-87; task rule]) or `RUN` (poll: battery read, then resume).
  - After 300 ticks in `LOST` show `{{stLost}}` in red. This is the Race S external-sensor reconnection bug, still unfixed on 2.53.42 [fble L154; crit L146]. Keep waiting; the API has no reconnect call.
- **Events 111, 113, 114:** log only (debug).

### 5.5 Timing constants

| Constant | Value | Why |
|---|---|---|
| Op timeout | 5 ticks | Doc examples wait one evaluate per step [crit L89] |
| Never-found give-up | 60 ticks | Do not trap the user in Searching |
| Notify watch | 15 ticks | [temp L42] **[Corrected, §22.5: 10 s after setup, then interval + 5 s]** |
| Connect retry after 112 | 30 ticks, ×3 | (inferred) |
| LOST escalation | 300 ticks | Race S reconnection bug [crit L146] **[Corrected, §22.6: 120 ticks]** |
| Poll `P` | setting 5/10/30/60 s, default 10 | Battery vs freshness [crit L186] |

---

## 6. Byte formats, parsing and validation

The `data` argument is array-like: index with `d[i]` and check `d.length` only. No `slice`/`concat` on it, and no `DataView` (not in the supported built-ins list [ref L949]; the docs examples use it, but avoid it) [fble L54-59]. Bit operations only:
- `s16le = (d[i] | d[i+1]<<8) << 16 >> 16`
- `u16le = d[i] | d[i+1]<<8`
- `s16be = (d[i]<<8 | d[i+1]) << 16 >> 16`
- `u16be = d[i]<<8 | d[i+1]`
- `s32le = d[i] | d[i+1]<<8 | d[i+2]<<16 | d[i+3]<<24` (already a signed int32)

| Role / profile | Min length | Decode | Invalid / sentinel |
|---|---|---|---|
| SP T | 4 | `s32le / 100` °C [crit L159] | n/a |
| SP H | 4 | `s32le / 100` % [crit L160] | n/a |
| SP B | 2 | `u16le` mV (bytes 2-3 are the sensor's °C, ignored) [crit L162] | 0 |
| Mi F | 5 | T `s16le(0)/100`; H `d[2]`; mV `u16le(3)` [temp L69, L176] | n/a |
| ESS T (0x2A6E) | 2 | `s16le / 100` [temp L34] | `0x8000` |
| ESS T1 (0x2A1F) | 2 | `s16le / 10` [temp L36] | `0x8000` |
| ESS H (0x2A6F) | 2 | `u16le / 100` [temp L35] | `0xFFFF` |
| BAS (0x2A19) | 1 | `d[0]` % | > 100 |
| Ruuvi F | 15 and `d[0] == 5` | T `s16be(1) × 0.005`; H `u16be(3) × 0.0025`; mV `(u16be(13) >> 5) + 1600` [temp L70, L172-174] | T `0x8000`; H `0xFFFF`; battery raw 2047 |

**Acceptance pipeline (`accept()`), applied to every decoded sample:**
1. Drop the sample on a sentinel or `NaN`.
2. Plausibility: −60 ≤ T ≤ +85 °C. H must be 0-100 %; values in (100, 105] are clamped to 100, anything else is dropped.
3. Jump filter: if the last accepted T is younger than 60 s and |ΔT| > 10 °C, hold the new value as a candidate. Accept it only if the next sample is within 2 °C of it; otherwise drop the candidate.
4. On accept: `tC`, `rh` and the battery value update, and `age = 0`.

Bad frames never throw, never clear the last good value, and in debug builds add one `systemEvent` line.

---

## 7. Derived values

### 7.1 Units and formatting
- Units: `u = (input.units == 1) ? F : C`. Read in `evaluate` when `isFinite`, cached, and re-read every 60 ticks. Inputs arrive as NaN on the first ticks on the watch [fproj L149].
- All temperatures are integer tenths of °C: `c10 = Math.round(c × 10)`.
  - °F: `f10 = Math.round(c × 18 + 320)`.
  - Formatter: sign + integer part + "." + tenths, without `toFixed`. `-0.0` prints as `0.0`.
  - Widest strings: `-40.0`, `104.5` (5 characters).
- Differences (wrist − air) and rates (°/h) are **not** offset by 32. °F multiplies by 1.8. Always show a sign. They are never routed through a `Temperature_*` format: a 5 K difference would render as −268 °C [ref L6729-6737].
- Unit label strings come from built-in tokens `{{TXT_CELSIUS}}` / `{{TXT_FAHRENHEIT}}` ("°C"/"°F") [verified here: tools `ng/translations.js`].
- Humidity is shown as an integer with "%"; it is logged with 0.1 resolution.

### 7.2 Exercise statistics
- `running` is 1 between `onExerciseStart` and `onExerciseEnd`, except while paused (`onExercisePause` / `onExerciseContinue` [ref L991-997, L1142-1165]).
- **Min/max** update on every accepted sample while running.
- **Average:** each tick while `running` and the sample is fresh, add the current value to `sumC` and increment `nC`. This sample-and-hold gives a time-weighted mean that does not depend on sensor cadence. Humidity is accumulated the same way.
- Pre-start readings are displayed but do not count. `onExerciseStart` resets the accumulators.

### 7.3 Trend
- Every 20 ticks, push the mean of the fresh ticks in that window, in tenths of °C, into a ring `Int16Array(30)`. That covers 10 min in 60 bytes, as one typed array [ref L949-962]. **[Corrected in implementation, see §22.7]**
  - A window with fewer than 10 fresh ticks pushes the gap sentinel −32768.
- Rate = least-squares slope over the non-gap slots × 180 slots/h, in °C/h. It needs ≥ 9 valid slots spanning ≥ 3 min; before that the arrow is hidden and the text is `{{trendWait}}` ("trend …").
- Display:

| Rate | Icon (`f-ico-l`) **[Corrected, §22.8: Unicode arrows in `sp-b-m`; §22.17: the thresholds apply to the number shown, 1 and 3 °/h in °C and in °F alike]** | Colour **[Removed, §22.15: theme colour only]** |
|---|---|---|
| \|rate\| < 1.0 °C/h | `` → | grey (`cm-mid`) |
| +1.0 to 3.0 | `` ↗ (inferred code) | orange `#F90` |
| ≥ +3.0 | `` ↑ | orange |
| −1.0 to −3.0 | `` ↘ (inferred code) | cyan `#0FF` |
| ≤ −3.0 | `` ↓ | cyan |

- F280 (up), F284 (right) and F288 (down) are documented by the official DynamicIcons example [ex: DynamicIcons/t.html L9-11]. The diagonals are inferred from their 22.5° spacing. Simulator check S5 verifies them; if they are wrong, use only the three documented arrows.
- The trend text beside the icon, for example `+1.4°/h`, uses the user's unit (×1.8 for °F).
- Thresholds are (inferred): the standard lapse rate is about 6.5 °C/km, so climbing 500-600 m/h changes the reading 3-4 °C/h.

### 7.4 Wrist vs air
- `input.wrist` comes from `/Device/Measurement/Temperature.Measurement` in kelvin [ref L508-512; crit L193]. It is accepted only if `isFinite` and 200-350 K.
- Row text: `WRIST 31° (+43.3)`. The wrist value is a whole degree (the native field precision); the difference has one decimal, wrist − air. **[Corrected, §22.15: the difference is taken between the two numbers as shown, so they add up; while the air value is not fresh the row is `WRIST 31°` without a difference]**
- If either value is missing: `WRIST --`. **[Corrected, §22.17: the row shows only while the air value is fresh and the wrist reads more than 3 °C (5 °F) away from it, on the numbers as shown; otherwise it is hidden]**

### 7.5 Staleness
- `age` increments every tick.
- Stale threshold `S = max(30, 3 × interval + 5)` s, where interval is Ruuvi 3, Xiaomi stock 20, ESS notify 20, poll profiles `P` (inferred cadences [temp L68-70]).
- When `age > S` **[also after 3 failed polls in a row, and at once on 101: §22.6]**:
  - the big number goes to opacity 0.4; **[Corrected, §22.15: no opacity; a hint goes right under the number, and after 2 minutes the number becomes `--`. §22.17: the number is drawn in the theme grey by a pre-built grey copy of its row, switched with `visibility`]**
  - the state text becomes `NO DATA m'ss` in orange; **[Corrected, §22.15: no colour; §22.17: orange again, as a static class in the template]**
  - outputs `airT` and `rh` become `undefined`, as the template does on disconnect [tpl: main.js L182-193], so the FIT graph has gaps instead of a flat line. H11 checks how the gap appears.

---

## 8. Outputs, FIT logging and summary

**manifest `in`** (2 of the 10 allowed [ref L133]):

```json
[{ "name": "units", "source": "/Settings/Unit/UnitsMode", "type": "get" },
 { "name": "wrist", "source": "/Device/Measurement/Temperature.Measurement", "type": "subscribe" }]
```

Both paths are in the build library's resource table [verified here: tools `project/resource-common.js`]. A nonexistent path stops the app loading [ref L133].

**manifest `out`** (3 of 20; 2 logged of 5 [crit L65-66; ref L101]):

```json
[{ "name": "con" },
 { "name": "airT", "log": true, "shownName": "Air temperature", "format": "Temperature_Fourdigits" },
 { "name": "rh",   "log": true, "shownName": "Air humidity",    "format": "Percentage_Fourdigits" }]
```

- `airT` is °C + 273.15. Logged samples store the float value; the format only drives the app graph [ref L2088-2097, L2054-2067]. Users therefore get a whole-degree graph in their own unit [ref L6729-6737], while third-party FIT tools see kelvin (as with CORE [temp L18, L71]).
- `rh` is in % (the `Percentage` system unit is "%", 1 decimal [verified here: tools `formatter/data.js`; ref L6588]).
- `con`:

| Value | Meaning |
|---|---|
| 0 | No link yet, or link lost (101) |
| 1 | Linked and configured (notify) / first good read (poll) |
| 3 | Gave up waiting at start, or wrong sensor: closes Searching while the attempt continues |
| 4 | Demo |

Any non-zero value closes the Searching view [ref L2480-2486].

**`getSummaryOutputs`** (4 entries; hard limit 8, practical 4-5 [ref L2081]). Values are in kelvin, so the summary converts units natively:

```js
[{ id:'n', name:'{{sMin}}', format:'Temperature_Fourdigits', value: minC + 273.15 },
 { id:'a', name:'{{sAvg}}', format:'Temperature_Fourdigits', value: sumC / nC + 273.15 },
 { id:'x', name:'{{sMax}}', format:'Temperature_Fourdigits', value: maxC + 273.15 },
 { id:'h', name:'{{sRh}}',  format:'Percentage_Threedigits', value: sumH / nH }]
```

- Return `[]` when `nC == 0` (no data, or the user backed out of the start screen [tpl: main.js L279-281]).
- Omit the humidity entry when `nH == 0`.

---

## 9. Screens

### 9.1 Principles
- One template `t.html` for n, o and q. Positions are in % with `calc(X% - 50%e)` centring [ref L2025-2050], and fonts use `sp-*` classes [ref L1922-1936].
- One wrapper div under `<uiView>` [store L220].
- No template script: `<uiView>` has no `onLoad`/`onActivate` JS, so the UI JS context stays empty. Fallback in §9.6.
- Every dynamic element has a non-space placeholder ("-" or "--.-"), because `setText` only changes elements that already contain text [ref L1307].
- **Font constraint** [verified here: `generated/charset-{q,n,o}.js`]:
  - Data fonts `f-d-*` have 74 glyphs: digits, `. - − % °` and punctuation, **no letters**.
  - Letters live in `f-t-*`/`f-b-*`. Arrows `↑↓↗↘` exist only in `f-b-m`.
  - So: numbers go in `sp-d-*`, units and labels in `sp-t-*`/`sp-b-*`, and arrows use the icon font.
- **Font sizes** [verified here: tools `ng/font.js`; ref L1924-1963]:

| Class | q (466) | o (280) | n (240) |
|---|---|---|---|
| `sp-d-xl` (q → f-d-xxl) | 118 px (line 122) | 65 px | 57 px (line 59) |
| `sp-d-xs` | 46 px (49) | 28 px | 25 px (27) |
| `sp-t-m` | 33 px (47) | 20 px | 18 px (26) |
| `sp-t-s` | 27 px (38) | 16 px | 14 px (20) |
| `sp-b-s` | 29 px (41) | 17 px | 15 px (22) |
| `f-ico-l` | line 61 | line 38 | line 32 |

- I rejected `sp-d-xxl` for the big number: it is 155 px on q, and "-23.4 °C" would not fit beside its unit inside the circle.

### 9.2 Main screen layout (top = vertical centre of the row; everything horizontally centred unless noted) **[Rewritten for the screen pass, §22.17; the original rows had a sensor row `#sn` and a MIN/HUMIDITY/MAX row]**

| Id | Example | Classes | top | q px | o px | n px | Notes |
|---|---|---|---|---|---|---|---|
| `#st` | `NO DATA 0'50` | `sp-t-s sp-c-orange` | 14% | 65 | 39 | 34 | Problem or transitional state only (§9.4); hidden while LIVE unless BAT LOW |
| label | `AIR` | `sp-t-s cm-mid` | 22% | 103 | 62 | 53 | Static `{{air}}` |
| row | `-12.3` `°C` | div `p-hc sp-text-bottom`: span `#t` `sp-d-xl f-num`, span `#u` `sp-t-m` | 35.5% | 165 | 99 | 85 | Big number + unit while the value is fresh |
| row | `-12.3` `°C` in grey | the same row with `cm-mid`: spans `#g`, `#v` | 35.5% | 165 | 99 | 85 | Not fresh, or no value (`--`); exactly one of the two rows is visible |
| row | `↘` `-1.7°/h · 82%` | div `p-hc sp-vertical-center`: span `#ar` `sp-b-m`, span `#tr` `sp-t-m` | 55% | 256 | 154 | 132 | Trend and humidity while fresh |
| `#hn` | `Sensor stopped sending` | `sp-t-m p-hc` | 55% | 256 | 154 | 132 | Instead of the trend row while not fresh: the hint (§9.5), or `trend …` while CONNECTING; centred, which the trend row with its hidden arrow is not |
| labels | `MIN` `MAX` | `sp-t-s cm-mid` at left 33% / 67% | 64.5% | 301 | 181 | 155 | Static |
| values | `-14.1` `-8.2` | `sp-d-xs f-num`, ids `#mn #mx`, same lefts | 72.5% | 338 | 203 | 174 | `--` until an exercise sample exists |
| `#w` | `WRIST 31° (+43.3)` | `sp-b-s cm-mid` | 83% | 387 | 232 | 199 | Only while fresh and the wrist is more than 3 °C (5 °F) off the air |

**Fit checks** (chord of the round display at the text's outer edge vs estimated text width, with glyphs about 0.5-0.6 em wide):

| Display | Element | Estimated width | Chord | Fits |
|---|---|---|---|---|
| q | `-12.3 °C` | ≈ 275 + 45 px | ≈ 440 | ✓ |
| q | `RECONNECTING` | ≈ 170 | 221 | ✓ |
| q | `WRIST 31° (+43.3)` | ≈ 255 | ≈ 296 | ✓ |
| n | big row | ≈ 165 | 219 | ✓ |
| n | `#st` | ≈ 95 | 112 | ✓ |
| n | `#w` | ≈ 128 | 156 | ✓ |

These are estimates. The build adds hidden text padding to `sp-d-*` (q `sp-d-xl` 29 px [verified here: tools `html/css-transform.js`]), so simulator screenshots at q, n and o are the acceptance check (S1-S4). If something clips: first shorten the strings, then on n/o drop the decimal of min/max, and only then shrink the big number to `sp-d-l`.

ASCII sketch of q (LIVE, then NO DATA):
```
                                             NO DATA 0'50        (orange)
              AIR                                 AIR
          -12.3 °C                            -12.3 °C           (grey)
       ↘ -1.7°/h · 82%                     Sensor stopped sending
      MIN          MAX                      MIN          MAX
     -14.1         -8.2                    -14.1         -8.2
      WRIST 31° (+43.3)
```

### 9.3 Colours **[Superseded, §22.15 and §22.17: no runtime colour or opacity; colour is static in the template and switched with `visibility`]**
- Theme classes (`cm-mid`, default text) keep light and dark themes working [ref L1894-1910; store L213-217].
- Accent colours are set from main.js with `setStyle(sel, 'color', hex)`. Hex values match the `sp-c-*` palette: green `#0F5`, yellow `#FD3`, orange `#F90`, red `#F00`, cyan `#0FF`, purple `#919` [verified here: tools `html/css-transform.js`].
- Staleness uses `setStyle('#t','opacity','0.4')` and `'1'` to restore. `opacity` is in the supported CSS subset [store L138-142].

### 9.4 States shown in `#st` **[Rewritten for the screen pass, §22.17; earlier: §22.6]**

| State | Text key (en) | `#st` | Big number |
|---|---|---|---|
| Searching (first connect) | `stSearch` "SEARCHING" | orange | grey `--` |
| Linked, no sample yet | `stConn` "CONNECTING" | orange | grey `--` |
| Linked, fresh data | none | hidden | value |
| Fresh data, sensor battery low (< 2.5 V or < 15 %) | `batLow` "BAT LOW" | orange | value |
| Linked, stale (age > S, or 3 failed polls) | `stNoData` "NO DATA" + ` m'ss` | orange | grey last value, `--` once the sample is S + 120 s old |
| Disconnected (101) | `stLost` "LOST" + ` m'ss` | orange | grey last value, `--` after 2 min |
| Wrong device | `stWrong` "WRONG SENSOR" | orange | grey `--` |
| Connect call failed | `stFail` "BT ERROR" | orange | grey `--` |

There is no sensor row any more: the profile label, "Looking for …", the battery voltage or percentage, and the DEMO tag are gone. A low battery is the one word LIVE can show; a sensor-name problem is a hint while searching (§9.5).

### 9.5 Hints under the number **[Rewritten for the screen pass, §22.17; earlier: §22.14, §22.15]**
While the value is not fresh, `#tr` shows what to do instead of the trend, changing every 4 ticks:
- SEARCHING, and NO DATA before any sample: `{{h1}}` "Bring sensor close", `{{h2}}` "Quit sensor app" (a sensor's own phone app or gateway can hold its only connection [fble L141-142; crit L188]), `{{h3}}` "Check Sensor setting", plus `{{nameBad}}` "Name must be ASCII" or `{{nameOff}}` "Sensor name not used" when the Sensor name setting cannot be used.
- NO DATA after the sensor delivered: `{{h7}}` "Sensor stopped sending" and `{{h1}}`.
- LOST: `{{h5}}` "Reconnecting …"; after 2 minutes the restart hint (`{{h4}}` "Restart exercise" once an exercise ran, else `{{h6}}` "Reselect the app") and `{{h1}}`.
- WRONG SENSOR: `{{h3}}`. BT ERROR: the restart hint.

Hints are at most 20 characters, except h7 (22), which the safe-area check of the n screenshots clears.

### 9.6 UI update rules
- All `setText`/`setStyle` calls happen in `evaluate`, and only when the cached string or colour changed.
- Full re-send of every element:
  - every 10 ticks;
  - on the 3 ticks after `getUserInterface`, `onLap` and `onAutoLap`. Templates need a cycle or two after load [fproj L150], and `onActivate` re-runs after laps and overlays [fproj L157].
- `getUserInterface()` returns `{ template: 't' }` and takes no `input` argument, which crashes the simulator [fproj L153].
- Icon strings are JS escapes (`''`), not HTML entities.
- **Fallback if S6 shows main.js `setStyle` has no effect:** add one template `onActivate` that subscribes to an extra numeric output `ui` (state/trend code) and applies `getStyle('css:.c-green','color')`-style colours exactly as DynamicIcons does [ex: DynamicIcons/t.html L7-31], unsubscribing in `onDeactivate`. Never subscribe in `onLoad` [ref L1466; fproj L157].

### 9.7 Summary screen
Native. The summary entries from §8 appear after the exercise in the user's unit [ref L1179-1200, L2069-2083].

---

## 10. Buttons and lifecycle

- **No `<userInput>` / `<pushButton>` in v1.** Overriding buttons blocks pause and end from that screen [crit L199; fproj via 14766 #37]. With no overrides, every native button behaviour stays: start/pause, lap, view switch, long-press menus, button lock, AMOLED display-off rules [ref L1804-1870; store L231-238]. H10 verifies pause, lap and end from the app screen.
- No second view in v1. A details view would need a button or touch (touch is often off [fproj L159]). v2 question: can a `pushButton` define only `onLongPress` without blocking the default click?
- Lifecycle:
  - `onLoad`: read settings, load the profile, init vars, `output.con = 0`.
  - `evaluate`: everything else.
  - `onExerciseStart`/`Pause`/`Continue`: the `running` flag.
  - `onExerciseEnd`: no BLE calls (the framework disconnects [fble L88]).
  - `getSummaryOutputs`: §8.
  - Laps do not reset stats.
- Race S is AMOLED and the app takes no clicks, so `enabledWhileDisplayOff` / `disabledWhileAOD` do not apply [ref L1830-1839; crit L142].

---

## 11. Settings and data.json **[Labels corrected, §22.14; `demo`/`debug` keys only in the build variants, §22.16]**

Settings work on n, o and q only [crit L96]. Types follow [ref L2154-2235]: inline `values` only [crit L73], and no `[ ]` at the end of `shownName`, because that is parsed as a unit [ref L2233].

```json
"settings": [
  { "shownName": "Sensor", "path": "sensor", "type": "enum",
    "values": ["SensorPush HT.w/HTP.xw (beta)", "Xiaomi LYWSD03MMC (beta)", "RuuviTag fw 3.x (beta)", "Other ESS sensor (beta)"] },
  { "shownName": "Sensor name (Xiaomi/ESS only)", "path": "name", "type": "string", "maxLength": 15 },
  { "shownName": "Update interval (SensorPush)", "path": "poll", "type": "enum", "values": ["5 s", "10 s", "30 s", "60 s"] }
]
```

`data.json` (top-level values are strings [ref L2182; store L147]):

```json
{ "sensor": "0", "name": "", "poll": "1", "demo": "0", "debug": "0" }
```

- Read with `localStorage.getItem(key)`, as SuuntoPo does (`../SUUNTOPO/src/suuntopo_canvas/main.js` L27). Parse with `+v | 0`, clamp to range, and use the default on `null` [fproj L178].
- `demo` (scenario 0-6, §13) and `debug` (1 = `systemEvent` trace of every BLE event and state change [fble L189-192]) are **not** declared as settings. The store build must ship `"demo": "0", "debug": "0"` (test T18).
- `poll` is an enum rather than an int: iOS has an int-field entry bug [fproj L179] (inferred to apply here).
- Poll is used by SensorPush and by the ESS/Xiaomi read fallback. Faster polling drains the sensor faster (inferred [crit L186]).

---

## 12. The Searching view

- Selecting a device app opens a system "Searching" view in the workout options menu. It closes when `output.con != 0` [ref L2480-2486; tpl: main.js L196-198].
- Rule: `con` stays 0 until the link is ready, as in the template.
- After 60 s without any 100 since app load, `con = 3` closes the view. The app screen then shows `SEARCHING`, the profile name and the hints from §9.5, and a late 100 continues the normal flow. **[Corrected, §22.14: 60 s after load, `con = 3` whenever `con` has never been non-zero: also a link whose setup or reads never complete, and a 101 with no reconnect]**
- Unknowns, checked in H4:
  - whether the user can dismiss the view anyway;
  - whether firmware 2.39.20's device-status display [fble L15] treats `con = 3` as connected.

---

## 13. Demo mode (simulator only) **[Corrected in implementation, see §22.11; a build variant since §22.16]**

- **Detection, in evaluate tick 1:**

```js
cid = appConn.connect(enabledZappId, bleEventHandler, sp1, sp2);
demo = (typeof cid === 'undefined') && (typeof enabledZappId === 'function');
```

  - In the simulator, `appConn` methods are empty stubs and `enabledZappId = () => {}` [fble L179-181].
  - On a watch, `enabledZappId` is an integer, so demo can never start there, even if `connect` misbehaves. The test is positive (`=== 'function'`), not `!== 'number'`: if a future watch firmware left `enabledZappId` undefined and `connect` returned `undefined`, the app must show `BT ERROR`, never fake data. The fail-safe direction is "no demo in some future simulator", never "demo on a watch". H14 confirms `typeof enabledZappId == 'number'` on the Race S.
  - A returned `0` is a valid connection id, not demo (T10).
- **Mechanism:**
  - `bt = evalFile('{file_path}/ext5.js')(prof, scenario)` returns a fake object with the 5 `appConn` methods [fble L19-20].
  - Every call queues the matching success event (100 after 2 ticks, then 107/109/104/102). Events are delivered from `evaluate` on the next tick through the same `bleEventHandler`.
  - Data arrives as **real byte frames** for the selected profile: int32 LE for SensorPush reads, DF5 for Ruuvi, and so on. The real state machine, parsers, filters, stats and UI therefore all run in the simulator [fble L185].
  - The ext5 code is never loaded on a watch.
- **Synthetic weather** (deterministic LCG, no `Math.random` so screenshots are reproducible):
  - T(t) = base + slow ramp + 20-min sinusoid ± 1.5 °C + noise ± 0.05 °C;
  - RH = 82 − 1.5 × (T − base) %;
  - battery 2950 mV;
  - wrist uses `input.wrist` when finite, else T + 9 °C [temp L82].
- **Pre-seeding:** demo pre-seeds 10 min of history into the trend ring and min/max/avg (it treats the exercise as running). That way a 4-second screenshot shows every element.
- **Scenarios** (`data.json` `demo`):

| # | Scenario |
|---|---|
| 0 | Cold live: base −8 °C, falling −2 °C/h |
| 1 | Stale: data stops after 5 s |
| 2 | Searching forever |
| 3 | Reconnecting (101 at 5 s) |
| 4 | Wrong sensor (all 108) |
| 5 | Hot, forced °F: base 40 °C ≈ 104 °F, widest strings |
| 6 | Store screenshot: as 0, but `#st` shows `• LIVE` instead of `DEMO` **[§22.17: no demo tag any more, so 6 looks like 0; store images set their weather with variant.js store-shot keys]**|

- Scenario 6 is for producing store images only. It is still gated by the two-condition guard, and the shipped `data.json` must have `"demo": "0"`.
- In scenarios 0-5, `#st` shows `DEMO` in purple and `#sn` shows `<label> · {{sim}}` ("simulated"). **[Removed, §22.17: the demo shows no tag; it exists only in the simulator variant]**

---

## 14. Memory, size and render budgets (numbers to design to) **[Corrected in implementation, see §22.12; measured against the binding budget in §22.15 and §22.16]**

| Budget | Design target | Limit / evidence |
|---|---|---|
| Usable JS heap on Race S | App runtime state ≤ 12 KB (code + data); data structures ≤ 4 KB | About 28 KB usable on Race S, shared with the second enabled app [crit L10, L70, L220]; 133,120 B total measured on Vertical 2 [crit L11] |
| Minified `main.js` | ≤ 6 KB | The official BLE template minifies 9.1 KB of source to 1.2 KB [verified here] |
| Each profile ext (minified) | ≤ 1.2 KB; demo `ext5` ≤ 2 KB | `evalFile` keeps only the selected profile in memory [ref L1212] |
| Built template `t.xml` | ≤ 8 KB per display | Template build 4.7 KB [verified here] |
| `.dev` per display | ≤ 24 KB | Template `.dev` 7.5 KB [verified here] |
| Module-level functions in main.js | ≤ 12 (`var f = function`) | The leak on app toggling scales with module-level functions [fble L160-161] |
| Module-level variables | ≤ 45 scalars + 1 `Int16Array(30)` (trend) + 1 `Float32Array(4)` (parser scratch) | The reference prefers one large typed array over several small ones [ref L949-962, L3226-3245]. Two small buffers cost about one extra header; merging them into a single `Float32Array(34)` is an allowed implementation choice |
| Per-tick allocation | None: no array or object literals in `evaluate`, the handler or parsers; strings rebuilt only when a shown value changes | Hot-path allocation exhausts the heap [crit L112; fproj L142] |
| Regex, `Date`, large literal arrays | None | Regex fails on the watch and shows up as "Maximum SuuntoPlus apps reached" [crit L100; fproj L141]; `Date` is unsupported [ref L964] |
| Canvas | **0 canvases, 0 units** | Race S: ≤ ~24 `lineTo` per path, `2×strokes + lineTo ≤ ~200` per canvas per frame, silent black screen beyond that [crit L19-23; fproj L155] |
| Images | 0 (icons from `f-ico-l`) | ≤ 2 per app [ref L1581; crit L67] |
| inputs / outputs / logged / summary | 2 / 3 / 2 / 4 | 10 / 20 / 5 / 8 (practical 4-5) [ref L101, L133, L2081; crit L65-66, L91-95] |
| UI elements | ≤ 16 in `t.html`, no template JS | UI-context memory errors show as `releaseMemoryCb (exec. ui)` [ref L3339] |

**Measuring.** Debug builds (`"debug": "1"`) log `systemEvent('[AT] mem ' + v)` from `$.get('/Ui/Script/MemoryPool/Allocated'|'Peak', cb)`. These undocumented resources are in the build library's table [verified here], and `$.get` works like `$.put` [ref L1506]. Probe them **only with `$.get` in debug builds, never in the manifest `in`**: a nonexistent path stops the app loading [ref L133]. Also read the `JsTotMem` lines in system events [crit L101].

---

## 15. Error and edge-case handling

| Case | Detection | Behaviour |
|---|---|---|
| No sensor in range / asleep | No 100 | `SEARCHING`; after 60 s `con = 3` and hints (§12) |
| Sensor's phone app or gateway holds the link | No 100 | Same, with hint h2 [crit L188] |
| Wrong device type matched | Required chars get 108 in every group | `WRONG SENSOR`, `con = 3`, hint h3. The link stays up until the app unloads: there is no disconnect [fble L19] |
| Connect call fails | 112, or `cid` undefined on a watch | Retry ×3 every 30 s, then `BT ERROR`. A connection-limit error (BLE err 2) appears in system events [ref L3169-3186] |
| Disconnect | 101 | `RECONNECTING`, `con = 0`, re-enable notifications on 100 |
| Never reconnects (Race S bug) | 300 s in LOST | `SENSOR LOST` (red); keep waiting [crit L146] |
| Notify never fires (ESS trigger) | 15 ticks without data after 109 | `readChar` polling every P [temp L38-42] |
| Notify config fails | 110 | k = 1: poll; Ruuvi: retry once, then `NO DATA` |
| Write/read fails | 105/103 or 5-tick timeout | Retry next cycle; after 3 failed cycles, `NO DATA` |
| Malformed or short frame | Length or format check | Ignored; debug log |
| Sentinel or out-of-range value | §6 | Ignored |
| Spike | Jump filter | Held until confirmed |
| Stale data | `age > S` | Greyed value, `NO DATA m'ss`, logged outputs `undefined` |
| Wrist input NaN at start | `!isFinite` | `WRIST --` [fproj L149] **[§22.17: wrist row hidden]** |
| Units input NaN | `!isFinite` | Assume metric until valid |
| Name setting invalid | Non-ASCII or > 15 characters | Ignore it; `#sn` shows `{{nameBad}}` **[§22.17: a hint in the SEARCHING cycle]** |
| Several identical sensors nearby | Not detectable | First match wins [fble L136-139]; SensorPush LED blink identifies it; name setting pins it |
| App evicted under memory pressure | Link gone for the rest of the exercise [fble L157-161] | Prevented by the §14 budgets; tested in H13 with 2 apps enabled |
| Event 115 | Undocumented indication | Treated as 106 |
| Events 111/113/114 | Undocumented or informational | Ignored (debug log) |
| Summary with no data | `nC == 0` | `[]` |

---

## 16. Localization

- Every visible string is a `{{key}}` token in `t.html` or `main.js`. The build applies handlebars to `main.js`, `ext*.js` and HTML with the language data [verified here: tools `util/template.js`, `project/minify.js`].
- v1 ships **`en.json` only**. For any language without a file, the build falls back to a full English build [verified here: a `de` build without `de.json` produced `-en.fea` files with English built-ins].
- Built-in tokens (`TXT_CELSIUS`, `TXT_FAHRENHEIT`, and later `TXT_UC_MIN`, `TXT_UC_MAX`, `TXT_HUMIDITY`, `TXT_BATTERY_LOW`, `TXT_NO_DATA`, `TXT_SEARCHING`, `TXT_DEMOMODE`) are translated automatically for every language that has a `<lang>.json` [verified here: with `de.json` present, `{{TXT_HUMIDITY}}` became "Luftfeuchtigkeit"]. Translators therefore only translate the custom keys.
- Before adding a language, re-run the S1-S4 width checks with its strings: built-ins can be long, for example German "Luftfeuchtigkeit".
- CJK languages need `sp-b-cjk` (renders as `f-b-m`) on text elements. The `f-t-*` fonts have about 3,000 glyphs and lack CJK, while `f-b-m` has 14,720 [ref L1936; verified here].
- Hungarian and Slovak are not watch languages [crit L105, L204].
- en.json keys: `air, wrist, min, hum, max, stSearch, stLive, stNoData, stReconn, stLost, stWrong, stFail, stDemo, lookFor, batLow, sim, nameBad, trendWait, h1, h2, h3, sMin, sAvg, sMax, sRh`. **[Corrected, §22.10]**

---

## 17. Test plan

### 17a. Automated tests (runnable here, plain Node, no installs)
`node test/run.js`. It loads the **shipping** `main.js` and `ext*.js` with `vm.runInNewContext`, using the suunto-form/nuki pattern [fble L186] and these stubs:
- `appConn` mock: records calls, enforces one op in flight and ≤ 20-byte writes, and delivers scripted events;
- `enabledZappId`, `setText`, `setStyle`, `getStyle`, `systemEvent`, `localStorage` (backed by a data.json object);
- `evalFile` (reads `ext*.js`, wraps the source in parentheses, evaluates in the same context);
- `$`, `Uint8Array`, `Int16Array`, `Float32Array`.

| Id | What it checks |
|---|---|
| T1 | UUID and search-param literals: every LE array derived from its canonical string; ASCII name bytes; 0x0499 order |
| T2 | Parsers. SensorPush: `[0x0A,0x09,0,0]` → 23.14; `[0x2E,0xFB,0xFF,0xFF]` → −12.34; `[0xD7,0x11,0,0]` → 45.67 %; battery `[0xA6,0x0B,…]` → 2982 mV. Xiaomi `[0x1E,0x09,0x37,0x7B,0x0B]` → 23.34 °C, 55 %, 2939 mV. ESS `[0x8A,0x09]` → 24.42; `[0x0C,0xFE]` → −5.00; `[0x00,0x80]` → invalid; humidity `[0x10,0x17]` → 59.04; `[0xFF,0xFF]` → invalid; 0x2A1F `[0xF4,0x00]` → 24.4; BAS `[0x57]` → 87. Ruuvi DF5 vectors (first 18 bytes): valid `05 12FC 5394 C37C … AC36 42 00CD` → 24.3 °C, 53.49 %, 2977 mV; max `05 7FFF FFFE FFFE … FFDE` → 163.835 °C (decoded, then rejected by acceptance); min `05 8001 0000 0000 … 0000` → −163.835 °C, 1600 mV; invalid `05 8000 FFFF FFFF … FFFF` → all invalid. Cross-check the vectors against docs.ruuvi.com DF5 when writing the test. |
| T3 | SensorPush happy path: exact `connect` params; `regUuid` order and arrays; LED `[3]` once; battery read after each 100; `[1,0,0,0]` → 104 → read T → read H; `con = 1` after the first good read; poll period follows the setting; never a write to `EF090001` |
| T4 | Reconnect: 101 → `con = 0`, `LOST m'ss` with "Reconnecting …" under the value (§22.15), op cleared; 100 → no `regUuid`; notify re-enabled ≤ 1 tick (notify profiles); poll resumes with a battery read |
| T5 | Xiaomi: 108 on `ebe0ccc1` → ESS group; pvvx frames parsed; stock frames parsed |
| T6 | ESS: no 106 for 15 ticks → `readChar` every P; 110 → poll; 2A6E 108 → 2A1F group; 108 on a SIG UUID → one 2-byte retry |
| T7 | Ruuvi: `enaCharNotf` ≤ 4 ticks after the first 100 and ≤ 2 ticks after a reconnect 100; non-DF5 frames ignored |
| T8 | Wrong sensor: every required char 108 → `WRONG`, `con = 3`, hints shown |
| T9 | Name override: `" ATC_A1B2C3 "` → `[9, …]`/`[8, …]` trimmed; non-ASCII ignored; 16+ characters ignored |
| T10 | Demo guard: (undefined, function) → demo; (undefined, number) and (undefined, undefined) → `BT ERROR`, no fake data; (0, number) and (5, number) → real path. **[§22.16: on the demo variant; the store build shows BT ERROR in the simulator]** |
| T11 | Formatting: °C/°F, `-0.04` → `0.0`, −40 °C → `-40.0` in both units, 40.28 °C → `104.5`, delta and rate without the +32 offset, sign always shown |
| T12 | Stats: nothing counted before start or while paused; time-weighted average with uneven cadence; min/max; summary in K; `[]` without data; humidity entry omitted when absent |
| T13 | Trend: synthetic ramps 0, +2, +5, −2, −5 °C/h → icon (no runtime colour, §22.15); < 9 slots → hidden; gaps skipped |
| T14 | Staleness: past S → a hint under the number, `NO DATA m'ss`, `airT`/`rh` undefined; recovery restores them (§22.15; T20 checks `--` after S + 120 s and after 2 min LOST) |
| T20 | Review round 2 regressions (§22.15): jump filter on a fast real change, late completion events, thrown connect retry, thrown regUuid retry, stale value cue, no runtime colour, released setup tables, no prototype objects |
| T15 | Jump filter: one spike dropped; a confirmed step accepted |
| T16 | Allocation regression: 7,200 ticks with a notification every 3 ticks; `setText` calls ≤ (changed values + periodic refresh); the trend ring is the same object throughout; `Float32Array` constructed once |
| T17 | Static source rules on `main.js` and `ext*.js`: 2-line ABOUTME header; no `=>`, `let `, `const `, backticks, `class `, `Date`, regex literals; ext files are one expression |
| T18 | `manifest.json`/`data.json`: name ≤ 60 B; description ≤ 100 B; version ≤ 4 characters; 2 in, 3 out, 2 logged; inline `values` only; defaults valid; `sensor` = "0" **[§22.16: no `demo`/`debug` keys; every key is a setting]** |
| T21 | Review round 3 (§22.16): at most 56 module-level names; the setup re-entry after registration with a 101 or 112 in the same window; no demo or debug hooks in the store build; the variants keep the static rules |

Also run `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-build/sp-build.js src/air_temperature builds/v1.0`. It must exit 0 with no warnings about unknown resources or CSS classes. This needs the §19.1 tool fix.

### 17b. Simulator checks (shared VS Code bridge, display q first)
For each case: `node tools/bridge-call.js screenshot '{"app":"<abs src/air_temperature>","display":"q","wait_seconds":4,"name":"bt_q_<case>"}' <png>`, read the PNG, then `sim_log '{"lines":60}'`. **[§22.16: "app" is a demo-variant folder from `test/variant.js`, and `wait_seconds` follows §22.11]**

| Id | Builds / displays | Pass criterion |
|---|---|---|
| S1 | demo 0 at q, o, n (`bt_q_live`, `bt_o_live`, `bt_n_live`) | Every element visible, nothing clipped by the circle, no overlaps, `DEMO` (theme colour since §22.15), trend arrow shown, min/max/humidity/wrist populated **[§22.17: no state word; `tools/safe-area.js --inflate 1.15` passes on every state at q, o and n]** |
| S2 | demo 5 (°F, hot) at q and n | `104.5 °F` and `WRIST …(+…)` fit |
| S3 | demo 0 with base −30 °C (scratch build) at q and n | `-30.0`/`-31.4` fit |
| S4 | demo 1 / 2 / 3 / 4 at q | `NO DATA 0'41` with a hint under the value (and `--` after S + 120 s); `SEARCHING` with the hint under `--`; `LOST m'ss` + "Reconnecting …"; `WRONG SENSOR` + "Check Sensor setting" (§22.15) |
| S5 | Arrow icons | F282/F286 render as diagonals; otherwise switch to the 3 documented arrows |
| S6 | Colours and opacity **[Obsolete, §22.15: none are set at run time]** | – |
| S7 | `sim_log` after each screenshot | No `Exec. event x failed` [ref L3315-3330], no `releaseMemoryCb`, no JS errors |
| S8 | Store shots, demo 6 at q | 3 clean 466×466 PNGs saved to `store/` |

The simulator is more permissive than the watch (QuickJS-like, inputs always valid, no BLE) [fproj L144-154; store L245]. Passing S1-S8 does not replace §17c.

### 17c. Hardware checklist (user, Race S; SensorPush HT.w first)
Before starting:
- Confirm you own a **2nd-gen** HT.w [crit L53, L241].
- Note the watch firmware version.
- Force-quit the SensorPush phone app and switch off any G1 gateway [crit L188].
- Sideloaded apps are wiped on every phone sync. Keep the watch unpaired from the phone during tests, or use SyncFix [fble L198; store L70].

| # | Step | Record / pass |
|---|---|---|
| H1 | In nRF Connect, scan the HT.w and save the raw ADV and scan-response data | Is `EF090000…0AB0` in the **ADV packet** (type 0x06 or 0x07)? Advertised name? [crit L212] |
| H2 | Build with `"debug": "1"`, deploy the `.dev` ("SuuntoPlus: Deploy to Watch"), add the app to a Hike sport mode | App appears in the list |
| H3 | Select the app; watch the Searching view; the LED should blink 3× | Time until Searching closes. System events show 111 → 100 → 107×4 → 102 (battery) → 104 (LED) → 104 (trigger) → 102 (T) → 102 (H), with no `BLE API err` [fble L37-52]. Breathe on the sensor: humidity rises within 2 polls (one trigger fills humidity [crit L160]) |
| H4 | Repeat with the sensor in a closed metal tin | After 60 s Searching closes and the app shows `SEARCHING` + hints. Can the Searching view be dismissed earlier? Does the watch's device status show "connected" for `con = 3`? |
| H5 | Start the exercise; compare against a reference thermometer, or the SensorPush app before and after | Within ±0.5 °C after 10 min in the same spot |
| H6 | (If pvvx/ATC or a named sensor is available) build with `name` set in `data.json` | Exact vs prefix name matching; ADV vs scan response [temp L185-186] |
| H7 | Wrist vs air: watch on the bare wrist, sensor clipped on the pack shoulder strap in shade | The difference makes sense (+5 to +10 °C typical [temp L82]) |
| H8 | Walk 30 m away for 2 min, then come back | `LOST m'ss` with "Reconnecting …" right under the last value; after 2 min the value becomes `--` and the hint alternates "Restart exercise" / "Bring sensor close"; then recovers to LIVE. Record the time to recover and whether the Race S bug appears [crit L146] |
| H9 | Variant build `sensor = 3` (ESS) against the HT.w | `WRONG SENSOR` appears, which proves 108 fires for absent UUIDs (§4.3 B) |
| H10 | From the app screen: pause, resume, lap, end the exercise with buttons only; try with the display off and in AOD | Every native action works [crit L199] |
| H11 | End and save; check the watch summary (min/avg/max/humidity); sync; check the Suunto app graphs; export the FIT | Units follow the watch; graphs present; gaps look sane; FIT values in K |
| H12 | Switch the watch to imperial and repeat H5 briefly | °F everywhere, summary in °F |
| H13 | Enable a second SuuntoPlus app in the same sport mode, plus an HR belt | The app still connects and is not evicted; record `JsTotMem` / memory-pool debug lines [crit L209] and compare with the sp-mem estimate in §22.15 (about 18.7 KB steady, 26 KB peak) |
| H14 | Read the debug line `typeof enabledZappId` and the `connect` return value | `number`, and an id that is not `undefined`; `DEMO` never appears |
| H15 | (Optional, v2) Scratch build with two parallel `connect()` calls | Does a second pending connect work or return error 1/2? |
| H16 | Battery: 1 h exercise with the app vs without | Watch battery % drop (no published data [fble L173-175]) |
| H17 | (Per extra sensor owned) Xiaomi / Ruuvi / ESS variant builds | Each profile can drop "(beta)" only after passing H3, H5, H8 and H11 |
| H18 | (Optional since §22.15) Light theme (n and o are MIP and often set light; q too if offered) | No colour is set at run time any more, so every text uses the theme colour; only check that nothing is unreadable |
| H19 | During an exercise, swipe to another view for 30 s while the value changes (or walk away until LOST), then swipe back | Does the app screen show current values at once, or the old ones until the 10 s refresh? If old: add `<uiView onActivate="$.put('/Zapp/{zapp_index}/Event', 1, null, 'int32');">` and `function onEvent() { rs = 3; }` (needs `HAS_ON_EVENT`), §22.14 |
| H20 | (Optional, scratch build) `regUuid` twice for the same characteristic id | 107 again, 108, or a thrown error? Tells whether an answer lost to a link drop during first registration matters (§22.14 keeps the role in that case) |
| H21 | (If an ESS sensor that only supports reads is available) build with `sensor = 3` | Data within about 3 read cycles: failed reads move on to the next registered id (§22.14) |
| H22 | BT ERROR before an exercise (for example with two other sensors connected) | The hint under `--` is "Reselect the app": does leaving the start view and selecting the app again restart it? If not, find the action that does and reword h6 (§22.15) |

---

## 18. Store listing plan **[Superseded by `store/listing.md`, §22.14]**

- **Name:** `Air Temperature` (15 B ≤ 60 [ref L64]; app id `airtem01`, per `getAppId`: the first 6 ASCII characters of the name, lowercased, + "01" [verified here: tools `suunto-plus.js`]).
- **Manifest description:** `Off-wrist air temp` (18 B; ≤ 100 B, about 22 characters recommended [ref L76; store L85]).
- **Version** `1.0`; `modificationTime` = Unix seconds of the build. Bump on every upload [store L53-55].
- **Long description** (store field, single line per field [store L42]). Draft:
  > Shows the real air temperature and humidity from a Bluetooth sensor you carry off your wrist. The watch's own sensor is warmed by your body and can read several degrees too high. Big 0.1° reading, trend arrow (°/h), min/max for the exercise, and wrist vs air difference. Air temperature and humidity are saved to your exercise as graphs, with min/avg/max in the summary. Units follow your watch. Supported: SensorPush HT.w / HTP.xw (2nd gen); beta: Xiaomi LYWSD03MMC (stock or ATC/pvvx firmware), RuuviTag (fw 3.x), and sensors with the standard Bluetooth Environmental Sensing service. Choose your sensor type in the Suunto app (My apps > Air Temperature). **[Corrected, §22.4: add "For ATC/pvvx firmware, enter the sensor's full name (e.g. ATC_A1B2C3) as Sensor name."]** Tips: hang the sensor in shade, with airflow, away from your body (e.g. outside of the pack); close the sensor's own phone app, which can block the connection. Not supported: Shelly BLU (needs Bluetooth bonding, which SuuntoPlus apps cannot do), Garmin Tempe (ANT+ only), broadcast-only hygrometers (Govee, ThermoBeacon, Inkbird), SensorPush HT1. Works on Suunto Race, Race S, Race 2, Vertical, Vertical 2, 9 Peak Pro, Ocean. Support: <email>.
- Brand names appear in text only. No logos or product photos, because the store blocks "unauthorized images" [store L27; crit L144]. Compatibility is stated in text because the store cannot filter by watch [store L72].
- **FAQ** (store text or support page):
  - Why not Shelly / Tempe? (above)
  - Why does it connect to the wrong sensor? (first match wins; set Sensor name)
  - Why does it say SEARCHING? (sensor asleep, out of range, held by its phone app, wrong type selected)
  - Why are graph values whole degrees? (Suunto's graph format)
  - Why kelvin in FIT exports? (platform unit for temperature [temp L18])
- **Screenshots:** 3 × 466×466 PNG from S8 (live cold, warm humid, trend). The 466×466 "screen image" is attested [store L40, L253]; the editor screenshot tool is not required [store L41].
- **Banner:** dimensions undocumented [store L258]. Draft a 2:1 master (1600×800, neutral: watch outline + thermometer glyph, no brand marks) and crop once the console shows the real size.
- **Submission:** Source Package zip (Editor "Create Source Package"), not the `.dev` [store L28-37]. It contains only top-level files; check that every `ext*.js` and `en.json` is included.
- **Privacy:** no data leaves the watch except through the normal FIT sync.

---

## 19. Open issues and risks

1. **Tooling blocker (must fix before coding).** `tools/sp-build.js` runs `javascript.validateAndMinify` on every `ext*.js`.
   - The official template's bare `function(…){…}` ext files fail with "Parsing error: Unexpected token (".
   - Parenthesized ones fail with "Missing required function 'getUserInterface'".
   - The Editor's own build is fine: it skips that lint and `minifyExt` wraps the source in parentheses. A scratch copy without the ext loop built the template successfully [verified here].
   - Suggested fix (outside this spec's write scope): in sp-build, validate ext files with a parse-only ES5 check of `'(' + src + ')'` plus the forbidden-syntax rules from T17, and keep `validateAndMinify` for `main.js` only. The vario app will hit the same issue.
2. **Ownership.** The HT.w is listed in the kit but not marked owned [crit L53, L241]. Confirm before hardware tests.
3. **Discovery unknowns:** ADV vs scan response for each sensor; exact vs prefix names; Service Data (0x16) not supported [temp L183-188, L209-215]. They decide whether Xiaomi and pvvx work at all. Hence "(beta)".
4. **`regUuid` semantics:** whether 108 fires for an absent UUID (H9), and whether 2-byte SIG UUIDs are accepted.
5. **Searching view behaviour** with `con = 3` (H4).
6. **Race S reconnection bug** [crit L146; fble L154]. It can only be surfaced in the UI, not fixed.
7. **Connection limit:** whether native sensors count against the 2 slots [temp L214]. Show `BT ERROR` and document it in the FAQ.
8. **Settings cannot be tested before publishing** [crit L196]. The first store release is the first test of the `sensor`/`name`/`poll` settings.
9. **Inferred icon codes F282/F286** (S5) and main.js `setStyle` (S6).
10. **Battery thresholds and cadences** are inferred (§7.5, §9.4).

## 20. What I verified while writing this spec

These are runs of the Editor 1.42.0 build library and reads of its data tables, done in a scratch folder on 2026-10-03. No app code exists yet.
- **Font charsets** (`lib/generated/charset-{q,n,o}.js`):
  - `f-d-*` have 74 glyphs and no letters.
  - `f-b-m` has arrows; `f-t-s` and `f-b-s` have letters, `°` and `•` but no arrows.
- **Font sizes and padding** per display: `lib/ng/font.js`, `fonts-{q,n,o}.js`, `lib/html/css-transform.js`. q maps `sp-d-xl` to f-d-xxl (118 px); n and o use f-d-xl (57/65 px).
- **Formatter tables** (`lib/formatter/data.js`): Temperature has system unit K, `Min 0`; OneDecimal and TwoDecimal have `Min 0` (so they are unusable for negative °C); Percentage has system unit %.
- **Resource table** (`lib/project/resource-common.js`): both input paths exist; `/Settings/Unit/*` has no temperature unit; `/Ui/Script/MemoryPool/{Size,Allocated,Peak}` exist (undocumented).
- **Builds:**
  - The official BLE template built with ext validation skipped: `.dev` 7.5 KB, minified `main.js` 1.2 KB, `t.xml` 4.7 KB. Ext files ship as bare function or object expressions.
  - `tools/sp-build.js` rejects ext files (§19.1).
- **Localization:** `{{TXT_HUMIDITY}}` → "Humidity" (en), "Luftfeuchtigkeit" (de, with `de.json` present), "湿度" (zh-Hans); without a `<lang>.json` the build falls back to `en`.
- **App id:** "Air Temperature" → `airtem01` (`getAppId`).

## 21. Acceptance criteria: "store-ready"

1. `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-build/sp-build.js src/air_temperature builds/v1.0` exits 0 with no warnings (after the §19.1 fix). Every source file has the 2-line ABOUTME header.
2. `node test/run.js` passes T1-T21 with 0 failures.
3. S1-S8 pass on q, and S1-S3 on n and o. The PNGs are saved, and `sim_log` is clean after each.
4. The §14 budgets are met:
   - minified `main.js` ≤ 6 KB;
   - each profile ext ≤ 1.2 KB;
   - `.dev` ≤ 24 KB per display;
   - 0 canvas, 0 images, no button overrides;
   - module-level functions ≤ 12.
5. Hardware H1-H5, H7, H8, H10-H14 pass with the SensorPush HT.w on the user's Race S, and the results are written to `docs/HW-RESULTS.md` (template with one row per step, §22.15). Any profile not hardware-tested keeps "(beta)" in its enum label and in the store text.
6. The shipped `data.json` has `sensor` 0 (and, since §22.16, no `demo` or `debug` key), and the manifest version and `modificationTime` are bumped.
7. Store package: Source Package zip with all top-level files, name/description within limits, long description + FAQ, 3 screenshots at 466×466, banner draft, support email.
8. No claim in the store text goes beyond what §17c verified (Ruuvi, Xiaomi and ESS stay "beta" until tested).
9. Memory (binding header): `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem/sp-mem.js src/air_temperature --scenario test/mem/<sensorpush|xiaomi|flap>.js` (flap with `--set flap=7`, sensor 0 and 2), lowmem est32, shipped form: steady ≤ 10 KB, peak ≤ 12 KB, no compiled block > ~1.9 KB, no cyclic garbage at setup end. **Status (§22.15): the block and setup-garbage parts pass; steady (18.7 KB) and peak (26 KB) do not. Status (§22.16): blocks ≤ 1,736 B and no cyclic garbage from the app pass; steady 15.6 KB and run peak 22.4 KB do not, and no feature cut reaches the budget.** The other scenarios in `test/mem/` (`node test/mem/summary.js`) cover the idle, name, ESS, failing-read, worst-case and 2-hour cases.

## 22. Implementation notes and corrections (2026-10-03)

Implementation and the deep-dive research (`docs/research/deep-dive/`, binding per the header) showed parts of this spec to be wrong. The sections above carry **[Corrected …]** markers that point here. Where this section and the text above disagree, this section is current.

### 22.1 Build tooling
- The §19.1 blocker is gone: commit 394cc28 makes `tools/sp-build.js` validate only `main.js` and leaves the ext files to `buildApp`. `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-build/sp-build.js src/air_temperature builds/v1.0` exits 0 with no warnings.
- The minified `main.js` has no free `output`.
- Ext files are still checked by the unit tests: each must be a single ES5 function expression, with no `Date`, regex or ES6.

### 22.2 Registration: every candidate is registered and data decides (replaces §0.2, §3.2, §5.3) **[Layout corrected, §22.16: tables in ext9-12.js, registration in ext13.js, `prof.rg` −1 when done]**
- **Why the groups had to go.** Event 107 only means "registered locally". It arrives even without a connection (deep-dive ble-gatt, forum 14783 #117). So neither 107 nor 108 can tell stock Xiaomi from pvvx, or 0x2A6E from 0x2A1F. Nor can they say whether a 2-byte or a base-expanded 16-byte SIG UUID works.
- **Profile contract v2.** A profile has these fields:
  - `lb`, `s1`, `s2`, `k` (0 poll, 1 notify + read fallback, 2 notify only) and `iv`;
  - `tw` / `lw` (SensorPush trigger and LED payloads);
  - `u` (16-byte LE base arrays);
  - `c`, the candidates `[id, role, svcBase, s12, s13, chrBase, c12, c13, form]`, where form 0 = 128-bit, 2 = 2-byte SIG, 16 = expanded SIG;
  - `rg`, `ld`, `t`, `h` (setup state kept across reconnects; declared up front so nothing is added at run time);
  - `p(role, data, out)`.
- **Candidates per profile.** Every SIG characteristic appears twice, once in each form, under its own id:
  - SensorPush: T, H, battery, LED.
  - Xiaomi: the stock frame, plus 0x2A6E, 0x2A6F and 0x2A19.
  - Ruuvi: NUS TX.
  - ESS: 0x2A6E, 0x2A1F, 0x2A6F, 0x2A19.
- **`ext7.js` setup stepper.** It is loaded on every 100 and released when done. It issues one call per tick:
  1. On the first link only, it registers every candidate.
  2. It enables notifications on every registered T/T1/H/frame candidate. The first one in preference order that answers 109 becomes the id polled if reads are needed. Ruuvi retries a failed enable once.
  3. It reads the battery candidates.
  4. It blinks the SensorPush LED once per app run.
- **The handler.** It accepts data from any registered candidate and switches the polled id to the one that actually delivers.
- **WRONG SENSOR.** It now means every candidate failed registration (108, a thrown error or a timeout). In every other case, a sensor that delivers nothing shows NO DATA with the hints.

### 22.3 Code layout and budgets (deep-dive limits)
- `main.js` holds only the hot path. Cold code lives in ext files that are evaluated once and released:
  - `ext6.js`: settings, the name override and the debug logger. `localStorage` is passed to it, and read only in onLoad.
  - `ext7.js`: setup.
  - `ext8.js`: summary.
  - `ext5.js`: the demo, simulator only.
- Initial values are top-level `var` initialisers. That keeps the lifecycle dispatcher the minifier builds small.
- **Measured** (Editor 1.42.0 build):

  | Item | Size |
  |---|---|
  | Minified `main.js` | 4,765 B |
  | Lifecycle dispatcher | ~1.2 KB |
  | `draw` | ~0.9 KB |
  | Every other function | < 0.7 KB |
  | Module-level function objects | 7 |
  | Ext files | 284-917 B each; `ext5` (demo) 1,623 B |
  | `t.xml` | 3,566 B |
  | `.dev` (q) | 16.4 KB |
  | `data.json` | 80 B |

- **[Superseded by §22.15]** The sizes above are minified source bytes, not the compiled blocks the binding header limits; §22.15 has the sp-mem measurements.
- **Gap.** `main.js` is 0.7 KB over the deep-dive's "≤ 4 KB for a BLE app" guideline. Closing it means dropping a feature: the wrist row is about 0.25 KB, the battery read-out about 0.2 KB, and the least-squares trend about 0.1 KB more than a two-point slope. That trade-off is the user's call. Every function is under the 1.5 KB cap, and there are fewer than 8 module-level functions.
- The only literal data table in `main.js` is the translated string table. Tokens have to stay in `main.js`, because the simulator does not translate ext files (verified: an ext returning `'{{hello}}'` shows the raw token in the simulator, while the watch build substitutes it). **[Reversed for the summary names in ext8.js, §22.16: only the simulator's summary shows raw tokens]**

### 22.4 Discovery parameters (deep-dive ble-discovery)
- The decisive filter is in sp1, and sp1 and sp2 are equally specific:
  - **Ruuvi:** `[255,0x99,0x04]` twice. The NUS UUID was removed: it is scan-response only, and under OR semantics it would match any NUS device.
  - **Xiaomi:** `[9,'LYWSD03MMC']` twice. The `ATC_` prefix filter was removed, because prefix matching is unproven. pvvx users enter their sensor's full name in the Sensor name setting.
  - **SensorPush and ESS:** unchanged.

### 22.5 State machine details (replaces parts of §5.4 and §5.5)
- **appConn timing.** `appConn` is first touched in `evaluate` tick 1, as the template does. In the simulator `appConn` does not exist during `onLoad` (a ReferenceError there gave a black screen, found with the replayed simulator page). No appConn call is made before event 100. `connect` and every other call go through one try/catch wrapper; a thrown connect on a watch shows BT ERROR.
- **SensorPush poll cycle.** write → 104 → read T → read H. The timer restarts when the cycle ends, so the period is P + 3 s.
- **Notify watch.** If no notification arrives within 10 s after setup, the app falls back to `readChar` (deep-dive rule). After that, the fallback starts whenever notifications are missing for the expected interval + 5 s (25 s for Xiaomi and ESS). A 20 s cadence would otherwise trigger polling between every two notifications.
- **Bytes.** Every byte is masked with `& 255`, in case the firmware delivers signed bytes.

### 22.6 States, LOST and staleness (replaces §9.4 and parts of §7.5)
- **New state, CONNECTING (yellow).** The sensor is linked but no sample has arrived yet.
- **DEMO** replaces only LIVE, so scenario states stay visible in the simulator. **[Removed, §22.17]**
- **On 101:**
  - values go stale at once (outputs `undefined`, number greyed);
  - `#st` shows `LOST m'ss` in orange, and the hint row shows "Reconnecting …";
  - after 120 s it turns red, and the hint row alternates "Bring sensor close" and "Restart exercise". Restarting the exercise restarts the app without the leaky in-menu toggle.
  - The deep-dive asks for a lost mm:ss state with restart advice after 60-120 s. RECONNECTING and SENSOR LOST are gone.
- **Fresh** now means: age ≤ S, fewer than 3 failed polls in a row, and the link up.
- **NO DATA** also cycles the hints.

### 22.7 Typed arrays
- Int16Array is not in the documented built-ins (reference L949), so the trend ring is `Float32Array(30)` with NaN for gaps.
- The parser scratch is a plain `Array(4)`, which keeps samples as doubles.
- The characteristic-role map is `Int8Array(16)`.

### 22.8 Trend arrows (S5 result)
- `f-ico-l` has no F280-F288 glyphs on n, o or q (`generated/charset-*.js`).
- A simulator render shows F280-F288 are route-turn icons with dashed tails, not trend arrows. Only F280, F284 and F288 read as rising, flat and falling. F282 is a "turn down" icon and F286 a V shape.
- The app therefore uses the Unicode arrows ↑ ↗ → ↘ ↓ in `sp-b-m`. **[Corrected in review round 1]** They exist only in `f-b-m` on n, o and q (`generated/charset-*.js`); `f-b-l`, `f-b-s`, `f-t-*` have none of them, so the earlier `sp-b-l` would have drawn missing glyphs on the watch (the simulator uses desktop fonts and hid it, and the `&#x2192;` entity placeholder slipped past the Editor's charset check, which reads literal template text only). The placeholder is now a literal `→`, and unit test T19 checks every glyph main.js writes against each element's font.
- UI1 (s, m, l; not supported): `sp-b-m` maps to `f-xs`, which lacks ↗ and ↘.
- The arrow is hidden with `visibility` until 9 slots are valid.

### 22.9 Final layout (replaces the §9.2 tops) **[Superseded by §9.2 as rewritten in §22.17]**

| Row | top |
|---|---|
| `#st` | 8% |
| `#sn` | 15.5% |
| AIR | 23.5% |
| Number and unit | 36% |
| Trend | 55.5% |
| Labels | 66% |
| Values | 74% |
| `#w` | 86% |

- The no-value placeholder is `--`. The data font draws the dot of `--.-` on the baseline, which looked broken.
- The S1 to S4 fit checks pass on q, o and n, including `-31.4 °C`, `104.1 °F` and `LOST 0'08`.

### 22.10 Strings
- en.json keys: `air, wrist, min, hum, max, stSearch, stConn, stLive, stNoData, stLost, stWrong, stFail, stDemo, lookFor, batLow, sim, nameBad, trendWait, h1-h5, sMin, sAvg, sMax, sRh`. **[§22.17: `air, wrist, min, max, stSearch, stConn, stNoData, stLost, stWrong, stFail, batLow, nameBad, nameOff, trendWait, h1-h7, sMin, sAvg, sMax, sRh`]**
- Script strings cannot contain quotes or apostrophes (the build substitutes tokens without escaping), hence "Close phone app" (was "Close sensor app"; §22.14).
- The summary names are passed from `main.js` to `ext8.js`. **[§22.16: they are tokens in ext8.js now]**

### 22.11 Demo (replaces parts of §13) **[§22.16: the demo is a build variant, `test/variant.js demo`]**
- **Synthetic weather.** The wave is ±0.05 °C over 40 min. A ±1.5 °C wave over 20 min would add up to ±28 °C/h to the trend.
- **Pre-seed.** `ext5.js` pre-seeds 10 min through a callback into the real `stat()`.
- **Candidate exercise.** In the demo, 2-byte UUID forms refuse enable and read, so the "keep the form that delivers" logic runs.
- **Wrist.** There is no synthetic wrist value; the simulator feeds 20 °C.
- **con.** `con` = 4 in the demo.
- **Screenshot timing.** Connection setup takes about 10 ticks, so screenshots need `wait_seconds` 15 (stale scenario: 50; lost: 22).
- **Store images.** They are scenario 6 from scratch copies with a changed base and ramp.

### 22.12 Colours **[Superseded, §22.15: no runtime colour or opacity; §22.17: static template colour]**
- Runtime `setStyle` is proven on hardware only for `visibility` (deep-dive refresh-rate). Colour and opacity therefore only repeat what the text already says: the state word, LOST, NO DATA and BAT LOW.
- The theme-grey lookup and the low-battery recolouring of `#sn` were removed.
- The flat-trend arrow uses `#999`.

### 22.13 Verification status and open items
- **Verified here:**
  - `node test/run.js`: 380 checks, 0 failures. They cover parsers with vendor vectors, signed and short frames, every profile's setup and polling, reconnect, LOST, WRONG, thrown BLE errors, no call before 100, one op in flight, the name override, the demo guard, formatting, stats, trend, staleness, the jump filter, a 2-hour run, static rules (including no stray `output`), the manifest and every demo scenario.
  - The plain `tools/sp-build.js` build is clean.
  - Simulator screenshots on q, o and n (`docs/sim/`), plus 3 store images (`store/`).
  - The simulator's own staged copy of the app, replayed in Node for 4 profiles × 7 scenarios, ran with no errors.
- **Not verifiable without hardware:** everything in §17c, plus:
  - whether setStyle colour and opacity work on the watch;
  - whether the Unicode arrows render in the watch font;
  - whether `localStorage` can be passed to an ext file;
  - real heap use with two apps.
- **Review round 1 (§22.14):** 468 checks, 0 failures (T4b, T19 and the regression cases added); the build is clean; minified `main.js` is 5,013 B; screenshots retaken on q, n and o.
- **Open (§19 still applies, plus):**
  - **UI1 displays (s/m/l).** They build and render but are cramped: on `l` the demo sensor row touches the bezel and the MIN/HUMIDITY/MAX labels nearly meet (both rows are gone since §22.17; UI1 was not re-checked).
  - **4 KB guideline.** `main.js` is 4,765 B (§22.3).

### 22.14 Review round 1 (2026-10-03)
Three reviews (platform, adversarial, product). Each finding was checked against the code; the regression tests fail on the pre-fix code and pass now.
- **Trend arrow font.** `#ar` is `sp-b-m` with a literal `→` placeholder (§22.8). T19 runs every string any test writes into each element through the Editor's own class mapping (`html/css-transform.js`) and charset tables (`ng/charset.js`) for n, o and q, plus every printable ASCII name in `#sn`.
- **Wrist below zero.** The wrist key is negative for any wrist reading below -0.5°; `str()` treated every negative key as a hint and wrote `undefined`. Only -1..-5 are hint keys now.
- **Searching escape.** `cx` records that `con` was once non-zero. Until then, 60 s after load sets `con = 3` whatever the link does: no 100, a 100 whose setup or reads never complete (SensorPush with failing reads used to stay at 0), a 101 with no reconnect. After that a 101 sets `con = 0` as in the template.
- **Registration across a link drop.** `prof.rg` counts the candidates already sent, and is `n + 1` once phase 0 is done. A drop during phase 0 resumes after the last sent candidate, so no id is registered twice. A candidate's role is entered when its `regUuid` is made and cleared when it fails, so an answer lost to the drop keeps the role and data decides. (Re-registering from id 1 could turn every id into 108 and end in a terminal WRONG SENSOR.)
- **Read fallback rotation.** For notify profiles (`k = 1`), a failed fallback read of T (or H) moves `prof.t` (or `prof.h`) to the next registered id of that role (T roles 1, 2, 6; H role 3), in a loop of at most 15 steps. A read-only sensor that exposes only the legacy 0x2A1F, or only the expanded UUID form, is found within a few cycles. The handler still switches to whichever id delivers.
- **Spike filter.** Its window is `age <= S` instead of `age < 60`, so it also works at 60 s polling (cycle 63 s, S = 185).
- **Freshness of the secondary values.** Humidity is shown only while fresh (`f && hAge <= S`, the rule the logged output uses). The trend is shown only while fresh; otherwise the arrow is hidden and the text waits. The arrow is made visible before its glyph is sent.
- **Imperial trend.** The arrow is chosen from the printed tenths: 1 and 3 °C/h, or 2 and 5 °F/h. **[Corrected, §22.17: 1 and 3 °/h in both units]**
- **Event 112** no longer overwrites a 100 or 101 received in the same tick.
- **Hints by state.** WRONG SENSOR shows "Check Sensor setting", BT ERROR "Restart exercise"; SEARCHING and NO DATA cycle three hints; h2 is "Close phone app".
- **Sensor name.** Used by Xiaomi and ESS only. SensorPush and Ruuvi advertise their own filter in the advertising packet but their name in the scan response only (SensorPush's is 20 bytes), so a name would replace a working filter with one that most likely never matches: it is ignored and `#sn` shows `{{nameOff}}` "Sensor name not used". A name that is used is shown bare while searching (15 characters after "Looking for" clipped on every display).
- **Labels.** "SensorPush HT.w/HTP.xw (beta)" until the §17c checks pass (§21.5, §21.8); "Sensor name (Xiaomi/ESS only)"; "Update interval (SensorPush)". Values (indices) are unchanged.
- **`#st`** has no inline colour any more: if runtime `setStyle` colour does not work on the watch, the state word stays the theme colour instead of a permanent yellow.
- **Demo.** `ext5.js` supplies a synthetic wrist value (air + 8 °C; 34 °C on the hot day) through `bt.w`. The store images were retaken from scratch copies with different temperatures and humidity, and the third shows SEARCHING with a hint.
- **Store listing.** `store/listing.md` replaces the §18 draft: honest compatibility by display (q: Race, Race S, Race 2, Vertical 2, Ocean, Ocean Lite; o: Vertical; n: 9 Peak Pro; not UI1), the 2-slot note for the Race S, not-affiliated and synthetic-data notes, the FAQ, and the blockers before submitting.
- **Deferred.**
  - Re-sending everything when the user swipes back to the app (`onActivate` → `onEvent`): it needs a template script and `HAS_ON_EVENT`, and the simulator cannot show it. H19 decides; until then the 10 s full re-send bounds the staleness.
  - Light-theme contrast of the accent colours: H18.
  - The WRIST row wording ("+8.0" has no label): a longer text risks clipping on n; the FAQ explains it.
  - A quieter "trend …" placeholder while SEARCHING: cosmetic.
  - UI1 arrows (↗ ↘ missing in `f-xs`): UI1 is not supported.
- **Budget.** Minified `main.js` grew from 4,765 B to 5,013 B: still under the §21.4 cap of 6 KB, further over the 4 KB guideline (§22.3). Module-level function objects: 7.

### 22.15 Review round 2 (2026-10-04)
Three reviews (platform, adversarial, product). Each finding was checked against the code. Unit test section T20 (30 checks) holds the regression cases; on the round-1 code 13 of them fail before the section aborts. `node test/run.js`: 504 checks, 0 failures.

**Memory against the binding header.** sp-mem, lowmem est32, shipped form (scenarios in `test/mem/`; flap = SensorPush with a 101/100 cycle every 7 ticks):

| | Round 1 | Round 2 |
|---|---|---|
| Steady, SensorPush (`sensorpush.js`) | 20,151 B | 18,725 B |
| Steady, Xiaomi (`xiaomi.js`) | 20,356 B | 18,540 B |
| Load peak (compile + onLoad + mount) | 25,872 B | 24,749 B |
| Run peak (within a tick; the 100 that loads `ext7.js`) | 26,278 B | 26,105 B (Xiaomi 26,798 B) |
| Largest compiled function block | 2,684 B (dispatcher) | 1,784 B (dispatcher) |
| Module scope record | 2,004 B | 1,876 B |
| Cyclic garbage when setup ends | 2,810 B host | 0 |
| Flap: cyclic garbage per tick, average / max | 568 / 2,788 B host | 127 / 928 B host |
| Largest request within a tick (value stack) | 4,416 B host | 3,808 B host |
| Minified `main.js` | 5,013 B | 4,947 B |

- **What changed.**
  - The dispatcher lost onLoad's settings code (`ext6.js` now returns one settings object, `G`, and clears the trend ring) and the tick-1 bootstrap (now `call(0)`); the age counters and `con` moved into `stat()`.
  - `draw()` is split into `draw()` (state, sensor row, number) and `rows()` (trend line, min/humidity/max, wrist), called one after the other from evaluate so the call chain stays short.
  - The candidate tables (`prof.c`, `prof.u`) are dropped once every candidate is registered; the later setup phases walk `rc` by id, and T1 checks that ids ascend in preference order. The connect params are `G.a`/`G.b`, written by the profile unless a sensor name replaced them, and dropped on the first link (the system reconnects by itself).
  - Every module function's prototype object is set to null at load (none is a constructor), and so are the prototypes of `ext7.js`'s function and of the stepper it returns. `ext7.js` holds no closure besides the stepper, which it returns directly, so releasing it frees everything by refcount. The ~0.9 KB left per evalFile is the harness's own compile wrapper.
  - `ext6.js` creates the debug logger only in debug builds and has no helper closure.
  - No colour or opacity `setStyle` (below).
- **What is left** **[Superseded by §22.16]**. Steady 18.7 KB against 10 KB; peak 26 KB against 12 KB. The peak is the compile of `ext7.js` on each event 100, and of `main.js` at load. Feature cuts, measured on scratch variants (steady, SensorPush): debug trace −483 B, battery read-out −526 B, wrist row −477 B, two-point slope instead of least squares −64 B; all four −1,550 B (17.1 KB). None of them reaches the budget: a 12 KB peak means a `main.js` of roughly 2 KB minified, a different, much smaller app. The only Race S data point is hwtest3, which ran at 15.7 KB steady. Whether to cut scope or to test this build on the Race S with a second app (H13) first is the user's decision; §21.9 stays open until then.

**BLE.**
- **Late completion events.** `call()` records the characteristic id (`oc`) with the pending event; a completion event counts only if it names that id (reference: the handler's characteristicId is the one "this event relates to"). A late 110 for an enable that timed out used to complete the next enable, shifting every later result by one.
- **opRes.** 1 done, 2 refused (op + 1), 3 threw or timed out. Phase 0 sends a candidate once more after a 3, never after a 108; the Ruuvi enable retry and the read rotation treat 2 and 3 alike. A single thrown `regUuid(1)` used to end SensorPush and Ruuvi in WRONG SENSOR and stock Xiaomi in permanent NO DATA.
- **Thrown connect.** `call()`'s catch turns a thrown connect into a 112, so a retry after 112 that throws gets the same bounded retries (3, 30 s apart) and then BT ERROR. It used to stay SEARCHING forever with no search running.
- **Jump filter.** A second out-of-band sample on the same side of the value as the held one is accepted (it also covers the old "within 2 °C" rule). A fall from +30 to −20 °C (tau 120 s) read every 60 s showed LIVE more than 10 °C off for 154 s; now at most about one poll cycle (one held sample is inherent to a spike filter). Trade-off: two consecutive glitches in the same direction are accepted.

**Screen.**
- **No runtime colour or opacity.** Both are unproven on hardware, `setStyle` cannot return to the theme colour once a colour is set, and the accents were about 1.3:1 on the light theme (H18). The state is in the text; only the arrow's `visibility` (proven) is set at run time. H18 is optional now.
- **Stale value.** While the value is not fresh, the line right under the number shows the hint instead of the trend: LOST "Reconnecting …", after 2 minutes alternating the restart hint (below) and "Bring sensor close"; NO DATA and SEARCHING cycle hints 1-3; WRONG SENSOR "Check Sensor setting". The number itself becomes `--` once LOST passes 2 minutes or the sample is 2 minutes past S (S + 120 s: 155 s for SensorPush at 10 s, 305 s at 60 s). Min and max keep the history.
- **Empty states.** The hint is the bold line under `--` (it used to be "trend …" there, with the hint in small grey at the bottom). The bottom row is always the wrist row; while the air value is not fresh it shows only the wrist reading (`WRIST 14°`).
- **WRIST difference** is taken between the numbers as shown (wrist whole degrees, air tenths), so `WRIST -7° (+7.6)` under `-14.6` adds up.
- **Hints.** h2 is "Quit sensor app" (it meant the sensor's app, not the Suunto app). The restart hint of BT ERROR and of LOST after 2 minutes is "Restart exercise" once an exercise ran, and "Reselect the app" (h6) before, because device apps connect from the start menu; H22 checks that wording. CONNECTING (short-lived) still shows "trend …" under the number.
- **Setting label** "Read interval" (it also sets the read fallback of Xiaomi and ESS sensors). Values unchanged.

**Store.** Screenshots retaken (`docs/sim/`, 3 store images); `store/banner.svg` drafted; listing: Xiaomi (stock and pvvx) marked experimental because both are found by name, the essential SEARCHING / wrong-sensor / LOST answers moved into the long description, the FAQ to go on a public page, the UI1 reason corrected. `docs/HW-RESULTS.md` is a template with one row per H-step.

**Not changed.** The value stack still grows to 3,808 B host in a full-refresh tick (about 1.9 KB on 32 bits; MultiSensor: 2,224 B host); the watch's value-stack policy is unknown. The per-evalFile compile wrapper garbage is outside the app's reach.

### 22.16 Review round 3: memory savings (2026-10-04)
The ranked savings plan from the sp-mem profile, applied in order of value and risk. All numbers are sp-mem, lowmem est32, shipped (minified) form, app bytes above the harness baseline. Every scenario is in `test/mem/` and `node test/mem/summary.js [appDir]` runs them all. `node test/run.js`: 580 checks, 0 failures (new section T21, and T5, T6, T9, T10, T10b, T13, T17, T18, T20 updated for the new internals; the demo and debug checks run on the variants). `tools/sp-build.js` builds the store source and both variants with no warnings.

**For watch users nothing changes**, except that the first connection's setup takes one tick (1 s) longer (A5). The simulator shows the store build as BT ERROR; the demo is now a build variant (below).

**Result** (round 2 → round 3):

| | Round 2 | Round 3 |
|---|---|---|
| Steady, SensorPush (`sensorpush.js`) | 18,725 B | 15,553 B |
| Steady, Xiaomi / Ruuvi / ESS (`xiaomi.js`, `flap.js` sensor 2, `ess.js`) | 18,540 / 18,456 / 18,396 B | 15,580 / 15,452 / 15,436 B |
| Steady, sensor never found (`idle.js`), the highest state before | 19,893 B | 15,553 B |
| Steady, never found, with a sensor name | 20,190 B | 15,822 B |
| Steady, ESS whose reads all fail (`readfail.js`) | 18,382 B | 15,810 B (the rotation, ext15.js, is kept after the first failed read) |
| Load peak (compile + onLoad + mount) | 24,749 B (24,992 B with a name) | 19,555 B (20,377 B with a name) |
| Run peak, connect / first link / reconnect (SensorPush) | 22,192 / 26,105 / 25,023 B | 19,510 / 22,001 / 20,071 B |
| Run peak, highest of all scenarios | 26,798 B (Xiaomi) | 22,392 B (Xiaomi) |
| Largest compiled function block | 1,784 B (dispatcher) | 1,736 B (`step`) |
| Module scope record | 1,876 B (63 names, with a 256-slot hash part) | < 748 B (54 names, no hash part) |
| Cyclic garbage per frame | 0 | 0 |
| Cyclic garbage per link event (host) | 928 B per 100 | 956 B connect, 1,904 B first link + 812 B (ext7.js one tick later), 812 B per reconnect |
| Flap every 7 ticks: garbage per tick, average / max (host) | 127 / 928 B | 121 / 1,904 B |
| Largest request within a tick (value stack, host) | 3,808 B | 3,552 B |
| 2-hour session (`long.js`) | no growth | no growth |
| Minified `main.js` / `.dev` (q) | 4,947 / 16,710 B | 4,589 / 15,605 B |

Every link-event garbage figure above is the harness's own `evalFile` wrapper: it compiles each ext inside a constructable function, which is cyclic with its prototype and keeps the ext's compiled code alive until a mark-and-sweep (about 812-1,120 B host per load). Every function the app loads, calls and releases on a repeating path drops its prototype first, so the app itself leaves no cycle (test T20). How the firmware's `evalFile` compiles is unknown.

**What changed, with the measured step** (steady SensorPush / steady never found / load peak / run peak, the higher of SensorPush and the worst case / largest block; cumulative, each step measured on the previous one, with the plan's prototype chain rebuilt and re-measured before the source was changed):

| Step | Change | Steady | Idle | Load peak | Run peak | Block |
|---|---|---|---|---|---|---|
| Round 2 | | 18,725 | 19,893 | 24,749 | 26,784 | 1,784 |
| A3 | Prototype objects really dropped. The minifier discarded main.js's top-level `call.prototype = … = null` (only the two inside `step` survived), so all 8 helpers kept one. ext6.js now takes the 8 helpers as named parameters and nulls theirs; each profile nulls its parser's. | 18,337 | 19,505 | 24,880 | 26,401 | 1,840 |
| A1 | 63 → 56 module-level names (54 after A9), below lowmem's 64-slot hash-part limit: `rok` folded into `rate` (NaN when invalid); a battery percentage p is stored in `bat` as −1 − p (no `batK`); the wrist value is a `rows()` parameter; `cid`, `cx`, `tries` and `wait` became `G.c`, `G.y`, `G.r`, `G.w`. A comment in main.js keeps the limit. | 17,120 | 18,288 | 23,696 | 25,106 | 1,820 |
| A10 | Debug trace out of the store build (the debug variant adds it back). | 16,657 | 17,825 | 23,235 | 24,559 | 1,768 |
| A9 | Demo out of the store build (the demo variant adds it back). | 15,897 | 17,065 | 22,461 | 23,669 | 1,776 |
| A2 | UUID tables and connect params out of the resident profile: ext1-4.js keep label, timing, poll payloads, setup state and parser; ext9-12.js (one per profile) hold connect params, UUID bases and candidates and are loaded only for each connect call and for registration. | 15,757 | 15,757 | 21,663 | 23,665 | 1,796 |
| A5 | Registration split from setup: ext13.js registers (first link, or resumed after a drop during it) and loads the table file; ext7.js enables, reads the battery and blinks the LED on every 100. When ext13.js is done, `step` re-enters setup on the next tick to load ext7.js (a 101 arriving first wins, test T21). | 15,813 | 15,813 | 21,733 | 22,851 | 1,876 |
| A4 | ext6.js slimmed: no logger, no demo field; the sensor-name parsing moved to ext14.js, loaded only when the name is not empty. | 15,777 | 15,777 | 20,050 | 22,823 | 1,876 |
| A8 | The table function's prototype is dropped in main.js and ext13.js. | 15,809 | 15,809 | 20,079 | 22,647 | 1,876 |
| A6 | Summary names as tokens in ext8.js instead of strings passed from main.js. | 15,644 | 15,644 | 19,656 | 22,484 | 1,876 |
| A7 | Read-fallback rotation out of `step` into ext15.js. | 15,497 | 15,497 | 19,497 | 22,280 | 1,688 |
| Final | A7 changed: ext15.js is loaded on the first failed fallback read and kept as `prof.r` (prototype dropped). Loading it on every failed read, as planned, compiled it every poll cycle while a sensor's reads kept failing (`readfail.js`: 141 B host of garbage per tick, against 14 B now). Also: ext14.js's prototype dropped, `data.json` without the demo/debug keys, comments. | 15,553 | 15,553 | 19,555 | 22,378 | 1,736 |

**Reversed decisions.**
- §22.3 "tokens only in main.js": ext8.js now holds the four summary names as tokens. The watch build translates ext files (verified: the built package's ext8.js contains "Air min"); only the simulator's summary shows `{{sMin}}`-style raw tokens.
- §13 / §22.11 / §22.14 demo and debug in the shipped code: both are build variants now (below), the store package has neither, and `ext5.js` moved to `test/demo/ext5.js`. The demo reads its candidate table from the profile's table file.
- §22.2 profile contract: the candidate tables and connect params (`u`, `c`, `s1`/`s2`) live in ext9-12.js and are never resident; `prof.rg` is −1 once registration is done; `prof.r` holds the rotation once needed.
- §11 / §21.6: `data.json` is `{ "sensor": "0", "name": "", "poll": "1" }`. Every localStorage call buffers the whole file, so it holds the three settings only.

**Variants** (`test/variant.js`). `node test/variant.js <demo|debug|demo,debug> <outDir> [key=value …]` writes a copy of the store source with the hooks added back by exact text patches (each must match once, so a source change that moves an anchor fails the unit tests, which build every variant) and the `key=value` overrides applied to `data.json`.
- `demo`: the fake appConn (`demo/ext5.js`), the DEMO state word and "simulated" (both gone since §22.17), forced °F, the demo wrist value, `con` 4 and the stats guard; `data.json` `demo` "0". Simulator screenshots and store images come from this variant, for example `node test/variant.js demo /tmp/at-demo demo=6` and then the bridge `screenshot` with `"app":"/tmp/at-demo"`.
- `debug`: the `[AT] …` system-event trace and the memory-pool probe (`G.d`, `G.g`); `data.json` `debug` "1". Built for the hardware test as in HARDWARE_TEST.md. In sp-mem it holds 16,060 B steady with `debug` "0" and 17,218 B with "1" (SensorPush).
- The store build in the simulator shows BT ERROR with "Restart exercise" (`docs/sim/bt_q_store_build.png`), because `appConn.connect` returns nothing there.

**Screens.** q, n and o screenshots of the demo variant (scenarios 0-5, sensor name, name not used) are byte-identical to the round-2 images, except that the LOST and NO DATA counters read one second less (the extra setup tick): `bt_q_scn1`, `bt_q_scn3` and `bt_n_scn3` were retaken. `sim_log` after the store-build and demo screenshots shows no failed event, JS error or `releaseMemoryCb`.

**Budget: not met, and not reachable by trimming this app.** Against the binding 10 KB steady and 12 KB peak, the floor without removing features is 15.4-15.6 KB steady (15.8 KB with a sensor name or after a failed read), 19.6 KB load peak (20.4 KB with a name) and 22.4 KB run peak. That is the size of hwtest3, which ran on the user's Race S at 15.7 KB steady. Two measured facts set the floor: compiled functions are about 11 KB of the steady state, and every `evalFile` costs at least about 2.2 KB of compile transient (about 1.7 KB of it value stack), even for a 264 B file. Feature cuts measured on the round-3 prototype (15,644 B steady; steady / load peak / run peak):

| Feature removed | Steady | Load peak | Run peak |
|---|---|---|---|
| Trend (arrow, °/h, ring, least squares) | −1,531 | −1,797 | −1,587 |
| Wrist row | −544 | −551 | −602 |
| Battery read-out | −519 | −571 | −537 |
| Per-state hints and m'ss counters | −470 | −480 | −487 |
| Exercise summary | −321 | −451 | −333 |
| Read-fallback rotation | −260 | −276 | −321 |
| Sensor-name override | −260 | −264 | −267 |
| Jump filter | −167 | −167 | −177 |
| Min/max rows | −136 | −142 | −146 |
| LED blink | −71 | +10 | −273 |
| 10 s full re-send | −32 | −32 | −33 |

All eleven together leave 11.2 KB steady, 14.5 KB load peak and 17.2-17.8 KB run peak: still over budget. A 12 KB peak needs about 9.5 KB steady and a `main.js` of roughly 2 KB minified, which is a different app (one sensor profile, no candidate or dual-UUID registration, fixed setup calls). No feature was cut: none of the cuts, alone or together, reaches the budget. Whether to cut scope, or to test this build on the Race S with a second app (H13) first, stays the user's decision.

**Open.**
- The A1 saving (about 1.2 KB) assumes the watch's Duktape adds the hash part at 64 entries (lowmem). Property tables were never calibrated against the watch; without a hash part A1 saves about 90 B and the round-2 build was about 1 KB smaller on the watch than measured.
- Link-event garbage depends on how the firmware's `evalFile` compiles (above); if it never runs a mark-and-sweep, garbage from the first connection (about 3.7 KB host in the harness) and from each reconnect (812 B) builds up.
- The functions run once at load and at exercise end (ext6.js, the profile factory, ext8.js) are called straight from `evalFile` and keep their prototype: a one-time cycle each, freed only by a mark-and-sweep. Dropping them would add code to the resident dispatcher.
- The value stack is still the largest request within a tick (3,552 B host); the watch's value-stack policy is unknown.
- Outside this app's folders: `builds/` still holds the round-2 builds, and `store/listing.md` still describes a 13-file package with `demo`/`debug` keys and store shots taken by editing a copy of `src/` (now: the demo variant).

### 22.17 Screen pass (2026-10-04)
After seeing all six demo states the user asked to drop the sensor row ("SensorPush · simulated", "Looking for SensorPush") and the DEMO tag, which only took space, and to make sure nothing is cut off at the round edge on the watch (SuuntoPo had text clipped there). The rest of the pass came with it: the LIVE word goes too, a stale value must not look live, a little colour where it carries meaning, consistent trend arrows, humidity next to the trend, a clean MIN | MAX row, a hint for a sensor that stopped sending, and a wrist row only when it says something. §9.2, §9.4 and §9.5 are rewritten to match.

**What changed**
- **No sensor row.** `#sn` is gone with everything it carried: the profile label (`lb` left ext1-4.js, `G.l` left ext6.js and ext14.js), "Looking for …", the battery voltage or percentage, "simulated", and the name problems. The battery is still read: a low battery (under 2.5 V or 15 %) is the one state word LIVE shows, `BAT LOW` (§9.4). The name problems ("Name must be ASCII", "Sensor name not used") are a fourth hint in the SEARCHING cycle (§9.5).
- **No LIVE or DEMO word.** `#st` is hidden (`visibility`) while LIVE and shown, before its text is sent, for SEARCHING, CONNECTING, NO DATA, LOST, WRONG SENSOR, BT ERROR and BAT LOW. A hidden word keeps its last text and change key, so it is re-sent only when it changes. The demo variant shows no tag at all: it exists only in the simulator, and every scenario now looks like a real sensor (scenario 6 equals 0).
- **Colour, static only.** `#st` carries `sp-c-orange` in the template (the build writes `color:#F90` inline), so every visible state word is orange; nothing sets colour at run time. Light-theme contrast of orange on white is about 2.1:1 (H18).
- **Stale value in grey.** `t.html` has a second copy of the number row (`#g`, `#v`, class `cm-mid`, the theme grey) at the same position as `#t` `#u`, and a centred hint line `#hn` at the position of the trend row (`#ar` `#tr`). Slot 11 shows exactly one group, bright (`#t #u #tr`) or grey (`#g #v #hn`), with six `visibility` calls when freshness changes, and re-sends the number, the unit and the line to the group that became visible: `setText` is not proven on hidden elements, and test T22 checks that no text ever goes to an element that is hidden at that moment. A value with no data yet (`--`) is grey as well. The grey group costs three template elements in the UI/DOM pool, which sp-mem does not model. A template `<eval>` binding was not used: the app has no template script (§9.1), and bindings count against the firmware's simultaneous path-parameter limit (deep-dive refresh-rate).
- **Trend thresholds** are 1 and 3 °/h on the number shown, in °C and in °F alike. With 2 and 5 °F/h, F showed a flat arrow next to `+1.7°/h` while C showed a tilted one next to `-1.7°/h`.
- **Humidity on the trend line**: `↘ -1.7°/h · 82%`, `trend … · 82%` while the trend waits. The humidity rides in the thousandths of the line's change key (127: none), so one text slot and one change check serve both. When the value is not fresh the hint replaces the line, without humidity.
- **Centred hints.** A hidden element keeps its width, so in the trend row the hidden arrow pushed every hint about 20 px (q) or 12 px (n) right of centre, and "Sensor stopped sending" crossed the safe edge on n (-6.5 px) and o (-1.3 px). The hint now has its own centred element in the grey group; centred, it clears the edge on every display (below). The bottom block is MIN | MAX at left 33 % / 67 %.
- **Hints.** NO DATA after the sensor had delivered alternates "Sensor stopped sending" (h7) and "Bring sensor close"; NO DATA before any sample and SEARCHING keep hints 1-3, so "Check Sensor setting" now appears only where the setting can be the cause (and for WRONG SENSOR).
- **Wrist row** only while the air value is fresh and the wrist reads more than 3 °C (5 °F) away from it, on the numbers as shown; otherwise hidden. `WRIST --` and the bare `WRIST 14°` are gone.
- **The arrow glyph** is sent only while the arrow is visible.
- **Not done: a tinted trend arrow.** The arrow shares a centred flow row with the trend text, and a hidden element keeps its width, so colour variants of the arrow need duplicates of the whole trend row (two more rows, four more elements and a third switching path). That is not nearly free, so the arrow stays in the theme colour.
- **variant.js store-shot keys.** `base`, `ramp`, `rh`, `f=1` and `drop=1` patch the demo's copy of ext5.js (not data.json), so each store image is one command (listing.md, "Images").

**Memory** (sp-mem, lowmem est32, shipped form; `node test/mem/summary.js`):

| | Round 3 (§22.16) | Screen pass |
|---|---|---|
| Steady, SensorPush / never found | 15,553 / 15,553 B | 15,549 / 15,549 B |
| Steady, never found with a sensor name | 15,822 B | 15,778 B |
| Steady, Xiaomi / Ruuvi / ESS / failing reads | 15,580 / 15,452 / 15,436 / 15,810 B | 15,536 / 15,450 / 15,388 / 15,762 B |
| Load peak, SensorPush / with a name / worst | 19,555 / 20,377 / 20,361 B | 19,769 / 20,275 / 20,259 B |
| Run peak, SensorPush / Xiaomi / worst | 22,001 / 22,392 / 22,378 B | 22,004 / 22,362 / 22,348 B |
| Largest compiled function block | 1,736 B (`step`) | 1,728 B (`step`) |
| Largest request within a tick (value stack, host) | 3,552 B | 3,888 B (about 1.9 KB on 32 bits, under the ~4 KB single-allocation limit) |
| Minified `main.js` | 4,589 B | 4,603 B |
| Cyclic garbage per frame / 2-hour growth | 0 / none | 0 / none |

The load peak rises 214 B (the longer string and id table and the new switching code compile at load); steady state and run peaks stay within ±50 B, because the sensor-row formatting is gone. The value stack grows by 21 slots (`str` and `rows` hold more temporaries).

**Edge check.** `node tools/safe-area.js --inflate 1.15` (6 % margin, glyphs widened ×1.15 for the watch font) passes on all 35 final screenshots: the six demo states on q, o and n, the four store images, the n/o store shots, the store build, and three worst-case builds on n and o (every hint replaced by the longest one, "Sensor stopped sending", with "NO DATA 1 0'35" and "WRONG SENSOR" as state words; and the widest realistic wrist row, `WRIST -15° (+10.0)` under `-25.0`, also on q). The tightest clearances: the widest wrist row 1.0 px (n), 3.1 px (o), 2.2 px (q); "Sensor stopped sending" 5.2 px (n); `WRONG SENSOR` 5.8 px (n). The first layout of this pass failed two of these (the hint, off centre, at −6.5 px on n; a wrist row at 1.2 px with one character less), which moved the state word down to 14 %, the MIN/MAX block and the wrist row up (64.5 / 72.5 / 83 %) and gave the hint its own centred element.

**Screens.** `docs/sim/states-q.png` is a contact sheet of the six states on q (LIVE, NO DATA with the grey value, SEARCHING, LOST with the grey value, WRONG SENSOR, LIVE in °F), composed from `bt_q_live.png` and `bt_q_scn1-5.png` by `uv run --with pillow python test/sheet.py docs/sim/states-q.png 3 "LIVE=bt_q_live.png" …` (run in the sim folder); the same states on n and o are `bt_{n,o}_live.png` and `bt_{n,o}_scn1-5.png`. `bt_{n,o}_store*.png`, `bt_q_store_build.png` and the four store images were retaken; `banner.png` was re-rendered from `banner.html` with the new `air-temperature-1.png`. `bt_n_name.png`, `bt_n_nameoff.png`, `bt_n_scn1_nodata3min.png` and `bt_o_scn3_lost2min.png` still show the layout before this pass. Waits: 15 s, 45 s for NO DATA (it starts about 33 s in), 25 s for LOST (22 s for store image 4).

**Tests.** `node test/run.js`: 613 checks, 0 failures. New section T22 (no sensor row, no LIVE/DEMO word, static orange class, grey group switching including the centred hint line, no text to a hidden element in any state, CONNECTING still shown); T21 also checks the store-shot keys; T3-T6, T9-T11, T13, T14, T19-T21 and the demo section updated for the new screen (the harness's `text()` now reads what the screen shows: '' for a hidden element, the visible group, the trend line split into trend and humidity). `tools/sp-build.js` builds the store source and the demo and debug variants with no warnings.

**Open.**
- H18 now matters again: the orange state word and the grey stale number on the light theme.
- Whether a hidden element keeps its text across a view reload is moot: the full re-send after `getUserInterface`, laps and every 10 ticks re-sends every visibility and every text that is visible.

### 22.18 Hardware fixes, redesign v3 and Auto (2026-10-04/05)

**Hardware findings (Race S fw 2.53.42, Xiaomi LYWSD03MMC stock), binding:**
- `evalFile('{file_path}/…')` resolves only in main.js; an ext file that loads another ext file fails and the app is disabled. main.js loads every ext file (the tables for ext13.js, ext14.js for the name).
- The watch's own Searching view gives up about 24 s after load and treats `con = 3` as "not found" (the app is dropped at once). `con = 1` is set on every event 100; `con = 3` only for WRONG and BT ERROR.
- Showing a hidden element needs `setStyle('#id','visibility',V)` and `setStyle('#id *','visibility',V)` (reference doc setStyle example). Without the second call the air value stayed blank. Only divs are switched.
- Two apps in one sport mode: at exercise start the watch unloads one (`relMemCb`, `RelMem->unload`). Air Temperature must be the only SuuntoPlus app in its mode.
- The Xiaomi notifies every ~6 s and the link drops and recovers about once a minute (101, then 100 after 3-25 s).

**Screen v3 (owner's choices):** humidity on the top line (the orange problem word replaces it), the big value, a 1 h firmware `<graph>` fed by the non-logged output `gT` (last fresh value, never undefined after the first sample), MIN | MAX, and the trend (or a hint) at the bottom. No title, no AIR label, no wrist row (and no wrist input). Elapsed times read `35s` / `1:05`. Graph behaviour on the watch (window, autoscale, stale samples, laps) is not yet verified.

**Auto (setting value 1, now the default):** the Xiaomi profile with a broader second search filter: sp1 the name `LYWSD03MMC` (proven), sp2 the 0x181A service in the complete 16-bit UUID list. Registration already tries the stock Mi characteristic and the ESS characteristics, so the data decides. Whether the watch ORs sp2 is unproven (deep-dive ble-discovery): if it ignores sp2, Auto behaves exactly like the old Xiaomi option. pvvx sensors advertise 0x181A as service data only and may still need the Sensor name. SensorPush and RuuviTag keep their own options; "Other ESS sensor" is now "Standard ESS sensor (beta)" (it adds the 0x2A1F and read-fallback paths Auto lacks).

### 22.19 Graph over the whole activity (2026-10-10)

The owner wants the graph to run from the start of the activity to now, filling the width at 1 s steps first and then thinning older points so the whole activity always fits. The firmware `<graph>` subscribe mode compiles the live feed itself; without `windowType`/`windowSize` it is expected to keep the whole run and autoscale the time axis, managing its own memory. This costs no app heap, and the graph element already renders on the watch. Unverified until a longer watch run. Fallback if the firmware keeps a fixed window: a template-owned sample buffer that merges pairs and doubles the interval when full, drawn on a canvas. That is held back while canvas rendering on the Race S is unproven (Suuntopo and the VarioLink map). The Xiaomi sends a reading about every 6 s, so 1 s sampling means every sample.
