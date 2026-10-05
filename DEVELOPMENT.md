# Developer notes

How Suunto AirTemp is built, what the real watch allows, and how to extend it. Read this before changing `src/air_temperature/`.

## Tooling

Everything is driven from the command line on a Mac, through [suuntoplus-agentic-dev-env](https://github.com/aabbeell/suuntoplus-agentic-dev-env), cloned next to this repo:

- **Simulator screenshots and deploys**: the `suunto-mcp-bridge` VS Code extension and its client, `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/suunto-mcp-bridge/call.js <build|deploy|screenshot|sim_log> '<json>'`.
- **Watch log**: `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/watch-log/watch-log.js <serial> --grep "AT\]|airtem|relMem"`. The debug build writes `[AT] …` lines (every BLE event, the screen slots it sends, memory every 60 s).
- **Memory**: `node test/mem/summary.js` runs every scenario in `test/mem/` through sp-mem (real Duktape, lowmem, 32-bit estimate).
- **Round-screen check**: `node ../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/safe-area.js --inflate 1.15 <screenshots>`.
- **Watch quirks**: `../SUUNTOPLUS-AGENTIC-DEV-ENV/docs/WATCH_QUIRKS.md`. Store submission: its `suuntoplus-store-submission` skill.

## Daily loop

```bash
node test/run.js                                        # ~600 checks, must be 0 failures
node test/variant.js demo /tmp/at-demo demo=0          # simulator build with fake sensor data (demo=0..6 scenarios)
node test/variant.js debug builds/debug sensor=1        # watch build with the [AT] trace
```

Deploy `builds/debug` only from that folder: the watch assigns the app ID per source folder, and another folder installs a second "Suunto AirTemp".

## Architecture

- `main.js` is the hot path: BLE handler, link state machine (one BLE call in flight, 5-tick timeout), sample checks, polling, stats, trend (30 slots × 20 s, least squares), screen. Rarely used state lives in the object `G`, because Duktape doubles the scope record above 64 names.
- **Only `main.js` calls `evalFile`.** On the watch `{file_path}` resolves only there; an ext file that loads another ext file fails and the app is disabled.
- Cold code is loaded when needed and freed: `ext6.js` settings, `ext7.js` link setup, `ext8.js` summary, `ext13.js` registration, `ext14.js` sensor name, `ext15.js` read-fallback rotation, `ext9-12.js` the UUID tables of each profile.
- **Profiles** (`ext1-4.js`, setting `sensor` 0-3): timing, setup state and a parser. 1 is Auto (Xiaomi stock frame or ESS characteristics), 0 SensorPush, 2 RuuviTag, 3 standard ESS with read fallback.
- **Screen** (`t.html`): static layout. Colours never change at run time: a stale value is shown by swapping a white and a grey copy of the number. Showing a hidden element needs `setStyle('#id','visibility',V)` **and** `setStyle('#id *','visibility',V)`, and only divs are switched. Text goes only to visible elements.
- **Outputs**: `con` (1 on every link; 3 only for WRONG and BT ERROR, which the watch reads as "not found"), `airT` and `rh` (logged, undefined when not current), `gT` (not logged; last fresh value, feeds the firmware `<graph>`).

## Adding a sensor

1. Capture what it advertises and its GATT table from the Mac: `uv run --with bleak python test/xiaomi_capture.py <outDir>` (adapt the name hints). Run it from Terminal, which has the Bluetooth permission.
2. The watch can only read sensors that **accept a connection** and expose readable or notifying characteristics. Advertisement-only sensors cannot work.
3. If the sensor uses the standard Environmental Sensing service, Auto or "Standard ESS sensor" already covers it.
4. Otherwise add a profile: a parser in a new profile file and a table file with the search parameters (two filters, each one AD type byte plus at most 16 bytes; exact local names are proven on the Race S) and the candidate characteristics. Add an option to the `sensor` enum in `manifest.json`, vectors to T2 and a happy path to `test/run.js`, and a memory scenario in `test/mem/`.
5. Keep the option marked "(beta)" until it has passed a watch run recorded in `docs/HW-RESULTS.md`.

## Watch limits that shaped the design

- About 24 s after the app loads, the watch's own Searching screen gives up unless `con` is non-zero.
- With two of these apps in one sport mode, the watch unloads one at exercise start: Suunto AirTemp should be the only SuuntoPlus app in its mode.
- The JS heap is shared and small. This app runs at about 15.5 KB steady and 22 KB peak; check every change with `test/mem/summary.js`.
- Settings cannot be edited on a sideloaded app; bake test choices into `data.json` (`variant.js … sensor=N`).

Full detail and history: `docs/SPEC.md` (§22.18 for the current, hardware-proven rules).

## Related projects

- [suuntoplus-agentic-dev-env](https://github.com/aabbeell/suuntoplus-agentic-dev-env): the build, deploy, simulator, memory and watch-log tooling these apps use
- [Suuntopo](https://github.com/aabbeell/suuntopo) with its [browser topo editor](https://topo-editor.vercel.app): climbing topos on the watch
- [VarioLink](https://github.com/aabbeell/suuntoplus-sensors): paragliding vario display for Bluetooth varios
