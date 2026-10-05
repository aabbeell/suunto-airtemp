<!-- ABOUTME: Store listing for AirTemp for Suunto v1.0 (screen v3, SPEC §22.18): the API Zone form map, store description, release notes, FAQ and the upload package. -->
<!-- ABOUTME: Upload-ready files are in store/upload/; the description is pasted into the signed-in API Zone SuuntoPlus console by the owner. -->

# AirTemp for Suunto: store listing (v1.0)

Prepared 2026-10-05 for the API Zone form "Add new SuuntoPlus app" (playbook: the `suuntoplus-store-submission` skill, §2-3). This replaces the earlier draft, which described the old screen (WRIST row, SensorPush as the main sensor, Xiaomi experimental). The current app is the one in SPEC §22.18.

## API Zone form map

| Form field | Value | File / source |
|---|---|---|
| App name (no form field; taken from the manifest) | AirTemp for Suunto | `manifest.json` `name` (18 of 60 bytes; app ID airtem..); contains "Suunto", so the description and banner must say the app is independent |
| Banner image (PNG, exactly 600 × 300) | Text left, app screen right | `upload/1-banner-600x300.png` (source `banner-600.html`) |
| Description (Markdown) | The "Store description" section below, pasted as is | this file |
| Categories (max 3) | **Outdoor**, **Training Tools** | see "Categories" |
| Submission role | Made by Suunto Community | |
| Connection to external device/sensor | Yes | |
| App image (PNG, 466 × 466) | Live screen in the simulator | `upload/2-app-image-466.png` |
| Sports app package (.zip) | Source package, v1.0 | `upload/3-package-airtem-source-v1.0.zip` |
| Submit (accepts Suunto's licence agreement) | The owner's action | |

Manifest values: `version` 1.0, `author` "O. Vitya", `description` "Off-wrist air temp" (18 bytes, shown under the name in the watch's app list), `type` device, `usage` workout, English only (`en.json`).

### Categories

Recommended: **Outdoor** and **Training Tools**. Outdoor fits best (hiking, mountaineering, ski touring, cold-weather sports are where an off-wrist air reading matters). Training Tools fits a data field logged to the exercise. **Physiology** is left out: the app measures the weather, not the body, and a Physiology tag would mislead. Do not add a third category just to fill the slot.

## Store description

Paste everything between the two rules into the Description field.

---

**AirTemp for Suunto** (an independent app, not made by or affiliated with Suunto) shows the real air temperature and humidity from a Bluetooth sensor you carry away from your body. The watch's own temperature sensor sits against your wrist and reads warmer than the air.

### On the screen

- Humidity on the top line
- A big air temperature reading with 0.1° resolution
- A 1-hour graph of the air temperature
- The exercise's MIN and MAX
- A trend arrow with the change per hour (°/h)

When something needs attention, an orange word replaces the humidity: SEARCHING, CONNECTING, NO DATA, LOST (with the time since the last reading), WRONG SENSOR, BT ERROR or BAT LOW, and the bottom line shows a hint such as "Bring sensor close". A reading that is not current turns grey, and after 2 minutes without data it is replaced by "--".

### Saved to your exercise

Air temperature and humidity are logged to the exercise. The summary shows minimum, average and maximum air temperature and average humidity. Units follow your watch (°C or °F).

### Sensors

Choose the sensor type in the Suunto app under the app's "Sensor" setting:

- **Auto: Xiaomi or standard sensor** (default). Tested with a Xiaomi LYWSD03MMC with stock firmware on a Suunto Race S. Sensors with the standard Bluetooth Environmental Sensing service are not tested yet.
- **SensorPush HT.w/HTP.xw (beta)**
- **RuuviTag fw 3.x (beta)**
- **Standard ESS sensor (beta)**

A Xiaomi sensor with pvvx/ATC custom firmware may need its full Bluetooth name (for example ATC_A1B2C3) in the "Sensor name" setting. The app connects to the first matching sensor in range; enter a "Sensor name" to pin one sensor.

### Watches

Tested on the Suunto Race S. Built for the round-display watches with the current SuuntoPlus interface (Race, Race S, Race 2, Vertical, Vertical 2, 9 Peak Pro, Ocean, Ocean Lite); watches other than the Race S have not been tested.

### Setup

1. In the Suunto app, open the app's settings and choose your sensor under "Sensor".
2. Add AirTemp for Suunto to a sport mode as the **only** SuuntoPlus app in that mode.
3. Close the sensor's own phone app (force-quit it): the sensor accepts only one connection.
4. Hang the sensor in shade with airflow, away from your body, for example on the outside of your pack.
5. Start the sport mode and wait for the app to connect.

### Limits

- AirTemp for Suunto must be the only SuuntoPlus app in its sport mode; with a second app the watch can run out of memory and unload one of them.
- The sensor accepts one connection at a time, so close its phone app and any gateway.
- Not supported: broadcast-only hygrometers (Govee, ThermoBeacon, Inkbird and similar), Shelly BLU, Garmin Tempe and the 1st-generation SensorPush HT1.
- English only.

### Privacy

The app talks only to your sensor, over Bluetooth, and has no internet access. It sends nothing anywhere. Its readings are stored in your exercise like the watch's own data.

### Support

Questions and problem reports: borosaabel@gmail.com

### Links

- Source code, FAQ and how to add a sensor: [github.com/aabbeell/suunto-airtemp](https://github.com/aabbeell/suunto-airtemp)
- More SuuntoPlus apps by O. Vitya: [Suuntopo](https://github.com/aabbeell/suuntopo), climbing topos on your wrist, with its [topo editor](https://topo-editor.vercel.app); [VarioLink](https://github.com/aabbeell/suunto-variolink), a paragliding vario display for Bluetooth varios
- Developer tools used to build these apps: [suuntoplus-agentic-dev-env](https://github.com/aabbeell/suuntoplus-agentic-dev-env)

AirTemp for Suunto is an independent app. It is not affiliated with or endorsed by Suunto, Xiaomi, SensorPush or Ruuvi; product names are trademarks of their owners.

---

## Release notes (v1.0)

For a "what's new" field, if the console shows one.

First release. Air temperature (0.1°) and humidity from a Bluetooth sensor off your wrist, with a 1-hour graph, exercise min and max, and a trend arrow with °/h. Logged to the exercise, with min/avg/max air temperature and average humidity in the summary. Sensors: Auto (Xiaomi LYWSD03MMC or a standard Environmental Sensing sensor), plus SensorPush HT.w/HTP.xw, RuuviTag fw 3.x and Standard ESS sensor in beta. Must be the only SuuntoPlus app in its sport mode.

## FAQ

For a public FAQ page, or for answering support mail (the store has no FAQ field).

**Which sensor setting should I choose?**
"Auto: Xiaomi or standard sensor" for a Xiaomi LYWSD03MMC or a sensor with the standard Environmental Sensing service. Choose "SensorPush HT.w/HTP.xw (beta)" or "RuuviTag fw 3.x (beta)" for those sensors. "Standard ESS sensor (beta)" is for an Environmental Sensing sensor that Auto does not find or read.

**My Xiaomi sensor with pvvx/ATC firmware is not found.**
Enter its full Bluetooth name (for example ATC_A1B2C3) in "Sensor name".

**I have several sensors. Which one does it use?**
The first matching sensor in range. Enter a "Sensor name" to pin one.

**The screen says SEARCHING and never connects.**
Bring the sensor close, force-quit the sensor's phone app and switch off any gateway (the sensor accepts only one connection), and check the "Sensor" setting.

**What do NO DATA and LOST mean?**
NO DATA: the sensor is connected but no fresh reading arrived. LOST: the Bluetooth link dropped and the watch keeps reconnecting. The time next to the word shows how long ago the last reading came. The last value stays in grey, and after 2 minutes it is replaced by "--".

**What does WRONG SENSOR mean?**
The sensor found does not offer the data of the type chosen under "Sensor". Check that setting.

**What does BT ERROR mean?**
The watch could not start the Bluetooth connection, for example because too many sensors are connected. Follow the hint on the bottom line.

**What does BAT LOW mean?**
The sensor reports a low battery. Readings continue; replace its battery soon.

**The app stops or disappears when the exercise starts.**
Make sure AirTemp for Suunto is the only SuuntoPlus app in that sport mode.

**Why not Govee, Shelly BLU or Garmin Tempe?**
Govee, ThermoBeacon, Inkbird and similar hygrometers only broadcast and accept no connection. Shelly BLU needs Bluetooth bonding. Garmin Tempe uses ANT+. The 1st-generation SensorPush HT1 is not supported either.

**Does the app send my data anywhere?**
No. It has no internet access and talks only to your sensor.

## Images

| File | Size | Shows |
|---|---|---|
| `upload/1-banner-600x300.png` | 600 × 300 | App name, one-line pitch, three features; the app image in a round frame on the right |
| `upload/2-app-image-466.png` | 466 × 466 | Live screen from the simulator (display q), demo variant `node test/variant.js demo /tmp/at-shot demo=0`, bridge `screenshot` with `wait_seconds` 45. The data is synthetic; every element is the real UI. |

No Suunto, Xiaomi, SensorPush or Ruuvi logos, product photos or watch photos. Re-render the banner after changing `banner-600.html` or the app image:

```
"$HOME/Library/Application Support/Code/User/globalStorage/suunto.suuntoplus-editor/chrome-headless-shell/mac_arm-128.0.6613.119/chrome-headless-shell-mac-arm64/chrome-headless-shell" --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=600,300 --screenshot=upload/1-banner-600x300.png "file://$PWD/banner-600.html"
```

(run from `store/`), then `sips -g pixelWidth -g pixelHeight upload/1-banner-600x300.png`.

## Package

`upload/3-package-airtem-source-v1.0.zip`, made with the Editor's `createSourcePackage` from a copy of `src/air_temperature` in `/tmp/at-pkg` whose only change is a fresh `modificationTime`:

```
node -e "require('$HOME/.vscode/extensions/suunto.suuntoplus-editor-1.42.0/node_modules/@suunto-internal/suuntoplus-tools/lib/source-package.js').createSourcePackage('/tmp/at-pkg', '<repo>/store/upload/3-package-airtem-source-v1.0.zip')"
```

- **`modificationTime` in the package: 1791231767** (2026-10-05). `src/air_temperature/manifest.json` still has 1791068180; **set it to 1791231767 before submitting** so the repo matches the uploaded package (owner / main thread). A rebuilt package needs a new value again.
- `data.json` in the package: `sensor` "1" (Auto), `name` "", `poll` "1"; no demo or debug keys.

`unzip -l` of the package:

```
  Length      Date    Time    Name
---------  ---------- -----   ----
       49  10-05-2026 21:54   data.json
      567  10-05-2026 21:54   en.json
     1380  10-05-2026 21:54   ext1.js
     1726  10-05-2026 21:54   ext10.js
      793  10-05-2026 21:54   ext11.js
     1268  10-05-2026 21:54   ext12.js
     2027  10-05-2026 21:54   ext13.js
      806  10-05-2026 21:54   ext14.js
      519  10-05-2026 21:54   ext15.js
     1550  10-05-2026 21:54   ext2.js
     1158  10-05-2026 21:54   ext3.js
     1269  10-05-2026 21:54   ext4.js
     1540  10-05-2026 21:54   ext6.js
     1835  10-05-2026 21:54   ext7.js
      676  10-05-2026 21:54   ext8.js
     1224  10-05-2026 21:54   ext9.js
    19139  10-05-2026 21:54   main.js
     1038  10-05-2026 21:54   manifest.json
     2287  10-05-2026 21:54   t.html
---------                     -------
    40851                     19 files
```

## Before submitting

1. Done: `modificationTime` in `src/air_temperature/manifest.json` is 1791231767, the same as the package.
2. Done: the 2026-10-04 Race S run is recorded in `docs/HW-RESULTS.md`. Still open: one watch run of screen v3 (graph) and Auto before submitting.
2b. The GitHub links in the description only work once those repos are public.
3. The upload itself (three files, description, categories, role, external device "Yes", licence) is the owner's action in the API Zone console.
4. Any change to `src/air_temperature/` after this: new `version` once 1.0 is uploaded, new `modificationTime`, rebuild the zip, re-check with `unzip -l`, and retake the app image if the screen changed.
