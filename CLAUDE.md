# AirTemp for Suunto

SuuntoPlus sports app (Suunto Race S and other UI2 watches) that shows air temperature, humidity, a 1 h graph and min/max from a Bluetooth sensor. Author: O. Vitya.

- App: `src/air_temperature/` (top-level files only; the store's source package ignores subfolders). Spec: `docs/SPEC.md` (binding hardware rules in §22.18 and at the top).
- Tests: `node test/run.js` (must stay at 0 failures). Memory: `node test/mem/summary.js` (needs `../SUUNTOPLUS-AGENTIC-DEV-ENV/tools/sp-mem` built).
- Builds: `node test/variant.js <demo|debug> <outDir> [key=value]`. Deploy the debug build always from `builds/watch/` (git-ignored): the watch's app ID is assigned per source folder, so another folder installs a second copy.
- Tooling (bridge, sp-build, watch-log, safe-area, sp-mem) lives in the sibling repo `aabbeell/suuntoplus-agentic-dev-env`; its `docs/WATCH_QUIRKS.md` lists what the watch does differently from the simulator. Store submission: its `suuntoplus-store-submission` skill.
- Work on `main`; commit messages short and plain.
