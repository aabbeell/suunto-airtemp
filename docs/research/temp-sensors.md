# BLE temperature sensors a SuuntoPlus device app can read over GATT

Research date: 2026-10-03. "Inferred" marks claims I reasoned out but could not confirm in a primary source or on hardware.

---

## 0. What the watch API allows (from the local reference and real apps)

**API surface** (SuuntoPlus reference, BLE Device Connection section, `suuntoplus_reference_docs.md` lines ~2459-2880. The Editor 1.42.0 template is `templates/New-SuuntoPlus-BLE-Sport-App/`):
- `appConn.connect(enabledZappId, handler, searchParam1, searchParam2?)` returns a connectionId. Each search param is a byte array of up to 16 bytes. **Byte 0 is the advertising AD type** and the remaining bytes are the value to match. The documented types are 2/3 (16-bit service UUID list, partial/complete), 4/5 (32-bit), 6/7 (128-bit), 8 (short local name), 9 (complete local name) and 255 (manufacturer specific data). These match the SIG AD-type numbers 0x02-0x09 and 0xFF. **Service Data (AD 0x16) is not in the documented list.**
- `appConn.regUuid(conn, charId, serviceUuidLE[], charUuidLE[])` raises event 107, or 108 on failure. Every real example uses 16-byte little-endian UUIDs. **No documented example uses a 16-bit UUID.**
- `readChar` raises 102 (done) or 103 (failed). `writeChar` accepts at most 20 bytes ("MTU negotiation is not supported") and raises 104 or 105. `enaCharNotf` raises 109 or 110, and afterwards each incoming value arrives as event **106 NOTIFICATION**.
- Other events: 100 connected, 101 disconnected (the system reconnects on its own), 111 connect done, 112 connect failed. The template's commented-out list also names **113 disconnect done, 114 disconnect failed and 115 Indication**. These are undocumented, but the template expects them.
- ATT MTU: **23** on Suunto 3/5/5 Peak/9/9 Baro/9 Peak, which allow 1 connection. **127** on 9 Peak Pro, Vertical, Vertical 2, Race, Race S, Race 2, Ocean and Ocean Lite, which allow 2 connections.
- From firmware 2.22.32, the manifest needs `"type": "device"` and an `out` variable `con`. The "Searching" view closes when `output.con != 0`. The system disconnects automatically when the app unloads.
- BLE works **only on a physical watch**, not in the simulator (forum 14783, Nikolai Simonov, 2026-04-01).
- **No PIN or passkey pairing.** A developer asked how to enter a PIN on 2026-04-07 (14783, pid 188604) and got no answer. A separate question on whether a device must be paired first (pid 186718) was also unanswered. Treat bonded or encrypted sensors as unsupported.
- **Units:** the watch's temperature resources and all `Temperature_*` output formats are in **kelvin with 0 decimals** (ref lines 205, 511, 6729-6737). To show 0.1 °C the app must format the value itself and read `/Settings/Unit/UnitsMode` for °F. To log a value with a Temperature format, add 273.15. At most 5 logged `out` variables. The Suunto FIT export of CORE data is also in kelvin (forum 9024).

**Evidence from real apps on GitHub:**
- **BoschEBikeSuunto** finds its device with a 128-bit service UUID, using `[7,…]` and `[6,…]`, then registers a notify characteristic and parses protobuf from event 106.
- **zestuart/suunto-form** (FORM swim goggles) was verified in open water on a Vertical 2. It connects with the manufacturer-data filter `[255, 0x7D, 0x06]`, which is company ID 0x067D only. **So type 255 matches on a company-ID prefix.**
- **slavikpi/nuki_suunto** handles both 106 and **115** in one case branch. Its README says an exact name filter `Nuki` never matched real locks that advertise `Nuki_44793FEC`. That points to exact (not prefix) name matching, or to the name sitting only in the scan response. Its later commits then tried manufacturer-data and short-name filters. The evidence is weak either way.

---

## 1. Bluetooth SIG services

### 1a. Environmental Sensing Service (ESS) 0x181A
Sources: SIG GSS YAML and the ESS 1.0 PDF (doc_id 294797).

| Characteristic | UUID | Format | Not-known value |
|---|---|---|---|
| Temperature | **0x2A6E** | sint16 LE, 0.01 °C (M=1, d=-2), range -273.15 to 327.67 | 0x8000 |
| Humidity | **0x2A6F** | uint16 LE, 0.01 %, range 0-100.00 | 0xFFFF |
| (legacy) Temperature Celsius | 0x2A1F | sint16 LE, 0.1 °C (as used by pvvx). No longer in the current SIG characteristic list. | – |

- **Properties** (ESS Table 3.1): **Read is mandatory**. Notify and Extended Properties are optional. Indicate applies only to the Descriptor Value Changed characteristic 0x2A7D.
- **Trap: under the spec, a server that supports notifications sends them only when its ES Trigger Setting descriptor(s) fire** (descriptor 0x290D; conditions in Table 3.11 include a fixed interval, value changed and thresholds). The watch API cannot write descriptors.
  - pvvx ignores this and notifies every measurement.
  - A strictly compliant third-party ESS device might never notify with its default trigger.
  - **The app therefore needs a `readChar` polling fallback**: if no event 106 arrives within about 15 s of event 109, poll every 5-10 s.
  - Related descriptors: ES Measurement 0x290C, ES Configuration 0x290B.
- **Advertising** (ESP 1.0 §3.1.1.1): a sensor *should* put 0x181A in a Service UUIDs AD field. Many cheap sensors instead put it in **Service Data** (AD 0x16), which the watch cannot match.

### 1b. Health Thermometer Service (HTS) 0x1809
Sources: HTS 1.0 PDF (doc_id 238688), GSS YAML, PHD transcoding white paper.

- **Temperature Measurement 0x2A1C**: **Indicate is the only mandatory property. Read and Notify are excluded** (HTS Table 3.1: "Properties not listed … are Excluded").
- **Intermediate Temperature 0x2A1E**: optional, **Notify**. The spec gives typical update intervals of 0.25-2 s, sent only while a measurement is in progress.
- Temperature Type 0x2A1D: read, uint8 (1 armpit, 2 body general, 3 ear, 4 finger, 5 GI tract, 6 mouth, 7 rectum, 8 toe, 9 tympanum).
- Measurement Interval 0x2A21: read, with optional indicate and write.
- **Payload** (little-endian): `flags(1)` + `FLOAT(4)` + optional `DateTime(7)` if flag bit 1 + optional `type(1)` if flag bit 2.
  - Flag bit 0: 0 = °C, 1 = °F. Bits 3-7 are reserved.
  - The maximum payload is 13 bytes, so it fits even MTU 23.
- **IEEE-11073-20601 FLOAT**: a 32-bit value. The MSB is a signed 8-bit base-10 exponent and the low 24 bits are a signed mantissa.
  - Special values: NaN 0x007FFFFF, NRes 0x00800000, +INF 0x007FFFFE, −INF 0x00800002, reserved 0x00800001.
  - Worked example from the white paper: 36.4 °C = exponent −1, mantissa 364 = 0xFF00016C, sent on air as `6C 01 00 FF`.
- HTP §3.1.1: a thermometer *should* advertise 0x1809 in its Service UUIDs AD field.
- **Watch support:** whether `enaCharNotf` writes CCCD 0x0002 for an indicate-only characteristic is undocumented. Event 115 "Indication" in the template suggests it does (inferred). **If indications are not supported, standard HTS is unusable, because Read is excluded on 0x2A1C and there is nothing to poll.** Handle both 106 and 115.

---

## 2. Real products

| Product | GATT live temperature? | Service / characteristic | Notes |
|---|---|---|---|
| **Xiaomi LYWSD03MMC, pvvx firmware** (also MHO-C401, Qingping CGG1/CGDK2, MJWSD05MMC and others flashed with pvvx) | **Yes, ESS** | 0x181A: **0x2A1F** notify ×0.1 °C, **0x2A6E** notify ×0.01 °C, **0x2A6F** notify ×0.01 %RH. Battery 0x180F/0x2A19 notify. Custom 0x1F10/0x1F1F notify (frame 0x33: temperature, humidity, battery, mV). | The ESS characteristics are Read+Notify with no auth permission (`app_att.c`). `app.c` pushes each subscribed characteristic on every measurement (about every 10-20 s by default, inferred from `app.c` defaults). The default connect latency is 1000 ms. **Advertising carries only beacon Service Data** (0x181A custom/atc, 0xFCD2 BTHome, 0xFE95 Mi). **The name `ATC_xxxxxx` is only in the scan response**; it moves into the adv packet only on sensor failure or in LE Long Range mode. It can be renamed in TelinkMiFlasher. Keep the **PIN code disabled**: with a PIN, pvvx turns on SMP passkey pairing. pvvx notes a battery above 40 % is needed for reliable connections on LYWSD03MMC. |
| **Xiaomi LYWSD03MMC, stock firmware** | Yes, proprietary | Service `ebe0ccb0-7a0a-4b0c-8a1a-6ff2997da3a6`, characteristic `ebe0ccc1-…` notify, 5 bytes: sint16 LE ×0.01 °C, uint8 %RH, uint16 LE mV | MiTemperature2 connects without pairing. Advertising is Mi Service Data 0xFE95, mostly encrypted. Whether the `LYWSD03MMC` name is in the adv packet or the scan response is unverified. |
| **RuuviTag / Ruuvi Pro (fw 3.x)** | **Yes, NUS** | NUS `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, TX `6E400003-…` notify, RX `6E400002-…` write | The "heartbeat" sends the first **18 bytes** of the advertised data format (DF5) over NUS TX on every refresh. Default refresh is 1285 ms × 2 repeats ≈ **2.57 s** (`app_heartbeat.c`, `application_mode_default.h`). **TX notifications must be enabled within 12 s of connecting** (production firmware) or the tag reboots. The adv packet carries manufacturer data 0x0499. The scan response carries `Ruuvi XXXX` and the NUS UUID. DF5 is **big-endian**: temperature at [1..2] ×0.005 °C (0x8000 invalid), humidity at [3..4] ×0.0025 %, pressure at [5..6] +50000 Pa, power info at [13..14]. |
| **CORE / CORE 2 body temperature** | Yes, two ways | (a) Custom service `00002100-5B1E-4347-B07C-97B514DAE121`, Core Body Temperature characteristic `00002101-…` **Read + Notify**, about 1 Hz. Control point `00002102-…` is write + indicate. (b) HTS 0x1809: 0x2A1C (FLOAT, flags 0x04, type=2), NaN when off-body, **10 s** interval. 0x2A1D. Battery 0x180F. | CORE's own wearOS sample enables **notifications** (0x0001) on 0x2A1C, so CORE does not follow the HTS indicate-only rule and should work with `enaCharNotf`. The adv packet has flags, **0x1809 in the complete 16-bit list**, name `CORE` (do not rely on it), and manufacturer data 0xF60B. The 128-bit Core Temp UUID is only in the scan response; legacy firmware advertised `00004200-F366-40B2-AC37-70CCE0AA83B1`. **An official CORE SuuntoPlus app already exists** (forum 9024, 2023). It works on Race and Vertical, and its FIT export is in kelvin. |
| **SensorPush HT.w / HTP.xw (2nd gen)** | Poll only | Service `EF090000-11D6-42BA-93B8-9DD7EC090AB0`. Temperature `EF090080-11D6-42BA-93B8-9DD7EC090AA9` (int32 LE ×0.01 °C), humidity `…0081`, pressure `…0082`, battery `…0007` | Documented flow: write any 4 bytes (for example `01 00 00 00`), wait about 100 ms, then read. No notifications are documented. HT1 (1st gen) is excluded. |
| **SwitchBot Meter (WoSensorTH)** | Command/response | Service `cba20d00-224d-11e6-9fb8-0002a5d5c51b`. Write `cba20002-…` with `57 0F 31`, then read the response on notify `cba20003-…` (status byte + 3 bytes, 0.1 °C, integer %RH) | This is a request/response poll. It is a home device, and its service data lives in the scan response. |
| **Inkbird** | Model-dependent | iBBQ: service FFF0. Write login `21 07 06 05 04 03 02 01 B8 22 00 00 00 00 00` to FFF2, write `0B 01 00 00 00 00` to FFF5, then FFF4 notifies int16 LE ×0.1 per probe (go-ibbq). IBS-TH1/TH2: FFF2 **read** (int16 LE ×0.01 °C, uint16 ×0.01 %). | inkbird-ble lists most hygrometers (IBS-TH, TH2, P01B, ITH-xx) as passive-advertisement devices. Only IAM-T1, IHT-2PB and IDT-34c-B use GATT notify; INT-11x are GATT poll. BBQ use only. |
| **ThermoBeacon, Govee (H5075/H5074 etc.), Qingping stock, BlueMaestro Tempo Disc** | **Not verified** | – | Their Home Assistant / Bluetooth-Devices libraries are all passive advertisement parsers (BlueMaestro: manufacturer data with device IDs 0x0D/0x17/0x1B…). Any GATT path is proprietary and unconfirmed. Qingping CGG1/CGDK2 flashed with pvvx fall under the pvvx row. |
| **Garmin Tempe** | **No** | – | ANT+ only (forum 11194; Garmin manuals). Current Suunto watches have no ANT+. |

---

## 3. What outdoor users actually say

- **The wrist sensor reads body heat.** In 2021 a winter mountaineer wanted outside temperature without taking a glove off. An Ambit 3 owner estimated readings 7-9 °C above real air temperature when the watch is not under a sleeve (forum 6535).
- **Users keep asking for an external sensor.** One 2024 request asked to show the thermometer as a complication and to support a BLE sensor "like Tempe" for backpacking; the reply was that Tempe is ANT+ only (forum 11194). Another 2024 request asked for temperature calibration or an algorithm (forum 11253). Suunto has no first-party temperature pod.
- **Tempe's own failure modes** (forum 6535; Garmin "tempe observations"):
  - The black case heats in sun, with reports of over 50 °C and swings of several degrees as the wearer turns.
  - Accurate placements are shaded with airflow: between saddle rails, in a belt pocket, under a cap visor, or on the pack.
  - Users want a white or IR-reflective case and better mounts.
- **Body temperature.** CORE users rely on the official S+ app (forum 9024). The gap users describe is **ambient air temperature off the body**, not core temperature.
- In the SuuntoPlus dev category nobody has published a temperature-sensor app yet. BLE projects so far are Bosch eBike (with an ESP32 bridge), FORM goggles, a Nuki lock, GoPro questions and a glucose bridge.
- Developers complain about the 2-connection limit (forum 14783).

---

## 4. Recommendation for a first production app

Rank sensors by three constraints:
1. Can `connect()` find it from the adv packet?
2. Does it need pairing? It must not.
3. Is it notify-based, or at least readable?

**Ship first:**
1. **Ruuvi (NUS).** It passes all three constraints:
   - Its manufacturer data is in the adv packet; the FORM app proves a company-ID prefix match on hardware.
   - No pairing.
   - Notifications every ~2.6 s.
   - It is IP-rated, runs a year or more on a coin cell, and is common in Nordic outdoor and van use (the last point is inferred).
2. **Generic ESS 0x181A / 0x2A6E (+0x2A6F)** with a polling fallback. This covers:
   - pvvx-flashed Xiaomi / Qingping sensors (about €3-5);
   - DIY ESP32/nRF52 sensors;
   - any compliant ESS device.

   Discovery:
   - Compliant devices are found by service UUID.
   - pvvx devices are found by exact complete local name. Have the user rename the sensor, for example to `SUUNTOTEMP`, or enter its `ATC_xxxxxx` name in settings. This depends on the watch matching scan-response fields (open question).

**Second wave:**
- Stock LYWSD03MMC (proprietary UUID, no flashing needed; discovery unverified).
- Generic HTS 0x1809, to see whether indications work. This also covers CORE's HTS service, but CORE already has an official app.
- SensorPush (write-then-read).

**Skip:** Govee, ThermoBeacon, Qingping stock, BlueMaestro, Inkbird hygrometers, SwitchBot, Tempe.

**Architecture:**
- `connect()` takes only two search params, so offer a **sensor-type setting** (a `data.json` enum: Ruuvi / ESS / pvvx-by-name / Xiaomi stock / HTS). Use it to choose the search params, UUIDs and parser.
- Run the template state machine: connect → 100 → regUuid → 107 → enaCharNotf → 109 → `con = 1`. Treat events 106 **and 115** as data.
- On event 101, reset the outputs and enable notifications again after reconnecting.
- For ESS, poll with `readChar` every 5-10 s if no data arrives within ~15 s.
- Show temperature with 0.1 °C resolution from a custom formatter. Log kelvin (°C + 273.15) with a Temperature format.
- Add on-screen placement advice: shade, off the body, airflow.

### UUID byte arrays (little-endian)
```js
// SIG 16-bit -> 128-bit base form, in case regUuid does not accept 2-byte UUIDs (open question)
function sig(u){return [0xFB,0x34,0x9B,0x5F,0x80,0x00,0x00,0x80,0x00,0x10,0x00,0x00,u&255,u>>8,0,0];}
var ESS=[0x1A,0x18], T2A6E=[0x6E,0x2A], H2A6F=[0x6F,0x2A], HTS=[0x09,0x18], TM2A1C=[0x1C,0x2A];
var NUS=[0x9E,0xCA,0xDC,0x24,0x0E,0xE5,0xA9,0xE0,0x93,0xF3,0xA3,0xB5,0x01,0x00,0x40,0x6E];
var NUS_TX=[0x9E,0xCA,0xDC,0x24,0x0E,0xE5,0xA9,0xE0,0x93,0xF3,0xA3,0xB5,0x03,0x00,0x40,0x6E];
var CORE_S=[0x21,0xE1,0xDA,0x14,0xB5,0x97,0x7C,0xB0,0x47,0x43,0x1E,0x5B,0x00,0x21,0x00,0x00];
var CORE_C=[0x21,0xE1,0xDA,0x14,0xB5,0x97,0x7C,0xB0,0x47,0x43,0x1E,0x5B,0x01,0x21,0x00,0x00];
var MI_S=[0xA6,0xA3,0x7D,0x99,0xF2,0x6F,0x1A,0x8A,0x0C,0x4B,0x0A,0x7A,0xB0,0xCC,0xE0,0xEB];
var MI_C=[0xA6,0xA3,0x7D,0x99,0xF2,0x6F,0x1A,0x8A,0x0C,0x4B,0x0A,0x7A,0xC1,0xCC,0xE0,0xEB];
```
### Search params
- ESS: `[3,0x1A,0x18]`, `[2,0x1A,0x18]`
- HTS or CORE: `[3,0x09,0x18]`, `[2,0x09,0x18]`
- Ruuvi: `[255,0x99,0x04]`, optional second `[7].concat(NUS)` (scan response)
- pvvx by name: `[9]` followed by the ASCII bytes of the exact name
- Experimental, undocumented: Service Data `[0x16,0x1A,0x18]` (pvvx custom/atc beacon) or `[0x16,0xD2,0xFC]` (BTHome)
- Stock Xiaomi: `[9,76,89,87,83,68,48,51,77,77,67]` ("LYWSD03MMC", unverified)

### Parsers (ES5)
```js
function s16le(d,i){var v=d[i]|(d[i+1]<<8);return v>32767?v-65536:v;}
function u16le(d,i){return d[i]|(d[i+1]<<8);}
function s16be(d,i){var v=(d[i]<<8)|d[i+1];return v>32767?v-65536:v;}
function u16be(d,i){return (d[i]<<8)|d[i+1];}
// ESS 0x2A6E / 0x2A6F (pvvx 0x2A1F: s16le*0.1)
function essTemp(d){var v=s16le(d,0);return v===-32768?undefined:v/100;}
function essHum(d){var v=u16le(d,0);return v===65535?undefined:v/100;}
// IEEE-11073 32-bit FLOAT at offset i
function f11073(d,i){var m=d[i]|(d[i+1]<<8)|(d[i+2]<<16),e=d[i+3];
  if(e===0&&m>=0x7FFFFE&&m<=0x800002)return undefined; // NaN/NRes/±INF/RFU
  if(e>127)e-=256; if(m>=0x800000)m-=0x1000000; return m*Math.pow(10,e);}
// HTS 0x2A1C / 0x2A1E -> °C
function hts(d){var t=f11073(d,1);if(t===undefined)return;return (d[0]&1)?(t-32)*5/9:t;}
// CORE 0x2101: flags; core s16 (0x7FFF = n/a); then optional fields in flag-bit order
function core(d){var f=d[0],i=3,o={},c=s16le(d,1);o.core=c===32767?undefined:c/100;
  if(f&1){o.skin=s16le(d,i)/100;i+=2;} if(f&2)i+=2; if(f&4){o.q=d[i]&7;i++;}
  if(f&16){o.hr=d[i];i++;} if(f&32){o.hsi=d[i]/10;}
  if(f&8){if(o.core!==undefined)o.core=(o.core-32)*5/9;} return o;}
// Ruuvi NUS heartbeat = first 18 bytes of DF5, big-endian
function ruuvi(d){if(d[0]!==5||d.length<18)return;var t=s16be(d,1),h=u16be(d,3),p=u16be(d,5);
  return {t:t===-32768?undefined:t*0.005,rh:h===65535?undefined:h*0.0025,
          pa:p===65535?undefined:p+50000,mv:(u16be(d,13)>>5)+1600,seq:u16be(d,16)};}
// Stock LYWSD03MMC ebe0ccc1
function mi(d){return {t:s16le(d,0)/100,rh:d[2],mv:u16le(d,3)};}
```
- In `core()`, I read the CORE flags as "field present". The spec labels them as validity bits but marks the fields "(if present)", so that reading is inferred.
- The Ruuvi `d[0]===5` check is inferred from `app_heartbeat.c`, which cuts the advertised payload to 18 bytes.
- In the event handler, use `case 106: case 115:` → pick the parser by characteristicId. For ESS, keep a `lastRx` timestamp in `evaluate()` and call `appConn.readChar(conn, id)` if it goes stale; event 102 then delivers the same payload format.

## 5. Things to test first on a watch
1. Does `regUuid` accept 2-byte UUIDs, or does it need the 128-bit base form?
2. Is event 115 delivered for indicate-only characteristics?
3. Does the watch scan actively, so that scan-response fields can match?
4. Is name matching exact or prefix?
5. Does the watch accept the undocumented AD 0x16 search type?
6. Does the 2-connection limit include the watch's own paired sensors?

## Key facts
- The connect() search param's first byte is the BLE AD type (2/3 for 16-bit service UUID lists, 6/7 for 128-bit, 8/9 for names, 255 for manufacturer data). Service Data (0x16) is not documented, so sensors that only broadcast Service Data (pvvx, Xiaomi, Qingping, BTHome) cannot be matched by their beacon. [suuntoplus_reference_docs.md BLE section; SIG ad_types.yaml]
- A manufacturer-data filter matches on a company-ID prefix on real hardware: the FORM goggles app uses [255,0x7D,0x06] and was verified on a Vertical 2. [github.com/zestuart/suunto-form README]
- writeChar is capped at 20 bytes and MTU negotiation is not supported. ATT MTU is 23 on Suunto 9/5/3-era watches (1 connection) and 127 on 9 Peak Pro, Vertical, Race and Ocean (2 connections). [reference doc BLE Technical section]
- The only documented subscription call is enaCharNotf, with data arriving as event 106. The editor template also lists undocumented events 113/114 (disconnect done/failed) and 115 (Indication); the Nuki app handles 106 and 115 together. [Editor 1.42.0 template main.js; slavikpi/nuki_suunto main.js]
- No PIN/passkey pairing path is known: a forum question about it went unanswered, so bonded or encrypted sensors are out. BLE works only on a physical watch, not in the simulator. [forum topic 14783, pids 188604, 188090]
- Watch temperature resources and Temperature_* output formats are in kelvin with 0 decimals, so a 0.1 °C display needs custom formatting and logged values need +273.15. [reference doc lines 205, 511, 6729-6737]
- ESS Temperature 0x2A6E is sint16 LE in 0.01 °C (0x8000 = unknown); Humidity 0x2A6F is uint16 LE in 0.01 % (0xFFFF = unknown). [Bluetooth SIG GSS YAML]
- ESS characteristics must support Read; Notify is optional and, per the spec, is sent only when the ES Trigger Setting descriptor (0x290D) fires. The watch cannot write descriptors, so an ESS app needs a readChar polling fallback. [ESS 1.0 Table 3.1, section 3.1.1, Table 3.11]
- HTS Temperature Measurement 0x2A1C allows only Indicate (Read and Notify are excluded). Payload is a flags byte (bit0 = °F, bit1 = timestamp present, bit2 = type present) plus an IEEE-11073 32-bit FLOAT. Intermediate Temperature 0x2A1E is Notify. [HTS 1.0 Table 3.1; GSS YAML]
- IEEE-11073 FLOAT: signed 8-bit exponent in the MSB and signed 24-bit mantissa; NaN 0x007FFFFF, NRes 0x00800000, +INF 0x007FFFFE, -INF 0x00800002. 36.4 °C = 0xFF00016C. [Bluetooth PHD Transcoding WP v16]
- pvvx firmware exposes ESS 0x181A with 0x2A1F (×0.1 °C), 0x2A6E (×0.01 °C) and 0x2A6F (×0.01 %), all Read+Notify with no auth, and notifies on every measurement. Its advertising is Service Data only; the name ATC_xxxxxx is in the scan response. [pvvx README; src/app_att.c, src/app.c, src/ble.c]
- RuuviTag fw 3.x sends the first 18 bytes of data format 5 (big-endian, temperature ×0.005 °C) as NUS TX (6E400003-B5A3-F393-E0A9-E50E24DCCA9E) notifications about every 2.57 s. TX notifications must be enabled within 12 s of connecting or the tag reboots. Its adv packet carries manufacturer data 0x0499. [docs.ruuvi.com bluetooth-connection, 3.x heartbeat, DF5; ruuvi.firmware.c app_heartbeat.c]
- CORE has a custom service 00002100-5B1E-4347-B07C-97B514DAE121 with characteristic 00002101 (Read+Notify, sint16 ×0.01 °C, about 1 Hz) and also HTS 0x2A1C at a 10 s interval. Its adv packet lists 0x1809, and an official CORE SuuntoPlus app already exists. [CoreBodyTemp GitHub spec V2.2 and implementation notes; forum topic 9024]
- Stock LYWSD03MMC notifies on ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6 (service ebe0ccb0-…): sint16 LE ×0.01 °C, uint8 %RH, uint16 LE mV, with no pairing needed. [JsBergbau/MiTemperature2 LYWSD03MMC.py; esp32.com thread]
- Garmin Tempe is ANT+ only, and current Suunto watches have no ANT+, so Tempe cannot work. Users ask for an off-body air-temperature sensor because the wrist reads 7-9 °C high from body heat; black sensors also overheat in sun. [forum topics 11194, 6535, 11253; Garmin forum 377660]
- SensorPush 2nd-gen devices are polled: write 4 bytes to EF090080-11D6-42BA-93B8-9DD7EC090AA9, then read an int32 LE ×0.01 °C (service EF090000-…-9DD7EC090AB0). [sensorpush.com/bluetooth-api]

## Open questions
- Does appConn.enaCharNotf write CCCD 0x0002 (indications) for an indicate-only characteristic such as HTS 0x2A1C, and does data then arrive as event 115? If not, standard HTS thermometers cannot work, because Read is excluded on 0x2A1C.
- Does appConn.regUuid accept 2-byte 16-bit SIG UUIDs (e.g. [0x1A,0x18]), or does it need the full 128-bit base form (FB 34 9B 5F 80 00 00 80 00 10 00 00 xx xx 00 00)? Every known working example uses 128-bit.
- Does the watch scan actively, so that scan-response fields can match a search param? This decides discovery for pvvx (name only in the scan response), Ruuvi's NUS UUID, CORE's 128-bit UUID and SwitchBot.
- Are AD 8/9 name filters exact, prefix or substring matches? The Nuki project reports an exact 'Nuki' filter never matched 'Nuki_44793FEC', but that may also be because the name was only in the scan response.
- Is the undocumented search type 0x16 (Service Data, e.g. [0x16,0x1A,0x18] for pvvx, [0x16,0xD2,0xFC] for BTHome, [0x16,0x95,0xFE] for Xiaomi stock) accepted by the firmware?
- Does the 2-connection limit on newer watches count the watch's own paired sensors (HR belt, power meter, foot pod)? If so, a temperature app may fail to connect for users who already run two sensors.
- When several devices match a filter (e.g. a group with several RuuviTags), which one does the watch pick, and can a user pin a specific device? There is no MAC filter in the API.
- Stock LYWSD03MMC: is the 'LYWSD03MMC' name in the adv packet or the scan response, how often does it notify, and does the connection stay stable with the watch?
- pvvx connected-mode notification cadence with default settings on LYWSD03MMC (inferred about 10-20 s), and whether any watch-initiated security request causes problems when the PIN code is off.
- Do strictly spec-compliant ESS devices with a default ES Trigger Setting notify at all without a descriptor write, or must the app rely on readChar polling?
- CORE 0x2101 optional fields: do the flag bits mean 'present' or 'present but valid/invalid'? Check against a real payload.
- Does the Suunto store review accept apps that target third-party or custom-firmware hardware (pvvx-flashed sensors)? Check with the Suunto Partner team.
- Kestrel DROP and other outdoor clip-on loggers were not researched; their GATT protocols are proprietary and unverified.

## Sources
- ../SUUNTOPO/reference/suuntoplus_reference_docs.md — BLE Device Connection section (~lines 2459-2880): appConn API, searchParam AD types, MTU and connection limits, event IDs, kelvin temperature resources and formats.
- ~/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/templates/New-SuuntoPlus-BLE-Sport-App/main.js — State machine pattern; lists undocumented events 113, 114 and 115 (Indication).
- https://github.com/SellA/BoschEBikeSuunto — Real BLE app: 128-bit service search [7,…]/[6,…], regUuid with 16-byte LE arrays, notification parsing.
- https://github.com/zestuart/suunto-form — Manufacturer-data filter [255,0x7D,0x06] verified on Vertical 2; 20-byte write pump.
- https://github.com/slavikpi/nuki_suunto — Handles events 106 and 115 together; README reports an exact complete-name filter never matched real locks.
- https://forum.suunto.com/topic/14783 — BLE only on physical watch; unanswered questions on PIN pairing and whether pairing is required; complaints about the 2-connection limit.
- https://forum.suunto.com/topic/14766 — BLE bridge experiences (glucose bridge, phone as peripheral, about 20-byte payload concerns).
- https://forum.suunto.com/topic/15217 — Example of a custom-UUID BLE integration.
- https://forum.suunto.com/topic/15534 — Confirms the SDK can talk to external BLE devices; debugging only via systemEvent logs.
- https://forum.suunto.com/topic/9024/core-bodytemperatur-sensor-dont-work-with-vertical — Official CORE S+ app exists; FIT export in kelvin.
- https://forum.suunto.com/topic/11194/feature-request-thermometer-complication — Wrist temperature skewed by body heat; request for BLE sensor like Tempe; Tempe is ANT+ only.
- https://forum.suunto.com/topic/6535/s9-s9b-s9p-temp-pod/5 — Winter mountaineering need; Tempe overheats in sun; Ambit3 about 7-9 °C bias on wrist.
- https://forum.suunto.com/topic/11253/calibrate-temperature-option-or-algorithm/2 — User demand for correcting the body-heat skew.
- https://forums.garmin.com/sports-fitness/running-multisport/f/accessories-sensors/377660/tempe-observations — Sun exposure error from black case; shaded placements; mount complaints.
- https://bitbucket.org/bluetooth-SIG/public/src/main/gss/ — Exact field definitions for 0x2A6E, 0x2A6F, 0x2A1C, 0x2A1E, 0x2A1D; descriptor and AD-type assigned numbers.
- https://www.bluetooth.org/docman/handlers/downloaddoc.ashx?doc_id=238688 — Table 3.1: 0x2A1C Indicate mandatory, Read/Notify excluded; 0x2A1E Notify; NaN usage.
- https://www.bluetooth.org/docman/handlers/downloaddoc.ashx?doc_id=294797 — Table 3.1 Read mandatory, Notify optional; notifications gated by ES Trigger Setting (Table 3.11).
- https://www.bluetooth.org/docman/handlers/downloaddoc.ashx?doc_id=238687 — Thermometer should advertise 0x1809 in Service UUIDs AD type.
- https://www.bluetooth.org/docman/handlers/downloaddoc.ashx?doc_id=294796 — Sensor should advertise 0x181A in Service UUIDs AD type; Service Data AD for low power.
- https://www.bluetooth.com/wp-content/uploads/2019/03/PHD_Transcoding_WP_v16.pdf — IEEE-11073 FLOAT layout, special values, 36.4 °C example.
- https://github.com/pvvx/ATC_MiThermometer — GATT table (ESS 0x2A1F/0x2A6E/0x2A6F notify), advertising formats, name only in scan response, PIN-code security, notify cadence.
- https://github.com/JsBergbau/MiTemperature2 — Stock LYWSD03MMC notification payload layout (temp/100, RH, mV).
- https://esp32.com/viewtopic.php?p=152635 — Stock service ebe0ccb0-… and characteristic ebe0ccc1-…
- https://docs.ruuvi.com/communication/bluetooth-connection — Scan response holds name and NUS UUID; 12 s deadline to enable TX notifications.
- https://docs.ruuvi.com/ruuvi-firmware/3.x/3.x-heartbeat — Sensor data sent via NUS TX notifications when connected.
- https://docs.ruuvi.com/communication/bluetooth-advertisements/data-format-5-rawv2 — Byte layout, scaling, big-endian, invalid values, manufacturer ID 0x0499.
- https://github.com/ruuvi/ruuvi.firmware.c — GATT heartbeat cut to 18 bytes; 1285 ms × 2 refresh.
- https://github.com/CoreBodyTemp/CoreBodyTemp — Custom service/characteristic UUIDs, payload, adv/scan-response layout, HTS implementation at 10 s, recommended discovery.
- https://github.com/CoreBodyTemp/wearos-app — Enables notifications (0x0001) on 0x2A1C, so CORE accepts notify on HTS.
- https://sensorpush.com/bluetooth-api — Service/characteristic UUIDs, write-trigger-then-read procedure, formats.
- https://github.com/OpenWonderLabs/SwitchBotAPI-BLE/blob/latest/devicetypes/meter.md — cba20d00 service, RX cba20002 / TX cba20003, command 0x57 0x0F 0x31.
- https://inkbird-ble.readthedocs.io/en/latest/supported_devices.html — Which Inkbird models are passive vs GATT notify vs GATT poll.
- https://github.com/sworisbreathing/go-ibbq — iBBQ FFF0 protocol: login on FFF2, enable realtime on FFF5, data on FFF4.
- https://github.com/Bluetooth-Devices/bluemaestro-ble — BlueMaestro Tempo Disc decoded from advertisements only.
- https://apizone.suunto.com/suuntoplus-sports-apps — High-level confirmation that S+ apps can use external BLE devices; no technical detail.
