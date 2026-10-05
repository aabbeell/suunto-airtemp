# ABOUTME: Mac-side BLE capture of a Xiaomi temperature sensor: advertising data, GATT table and 40 s of temperature notifications.
# ABOUTME: Run in Terminal (needs Bluetooth permission): uv run --with bleak python test/xiaomi_capture.py <outDir>
# Scan for Xiaomi / pvvx / ATC thermometers, record what each advertises (name, UUIDs, service data, ADV vs scan response
# is not separable on macOS), then connect to the strongest one and record its GATT table and notifications from the
# stock Mi characteristic ebe0ccc1 or the ESS characteristics 0x2A6E/0x2A6F that pvvx/ATC firmware exposes.
import asyncio, sys, time
from bleak import BleakScanner, BleakClient
OUT = sys.argv[1]
log = open(OUT + '/xiaomi_capture.txt', 'w')
def p(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); log.write(s + '\n'); log.flush()
NAME_HINTS = ('lywsd', 'atc_', 'mj_ht', 'mho-', 'xmwsdj', 'lywsdcgq', 'cgg1', 'mi temp')
def is_candidate(r):
    txt = ' '.join(r['names']).lower()
    sd = ' '.join(r['sd'].keys()).lower()
    return any(h in txt for h in NAME_HINTS) or 'fe95' in sd or '181a' in sd
STOCK = 'ebe0ccc1-7a0a-4b0c-8a1a-6ff2997da3a6'
ESS_T = '00002a6e-0000-1000-8000-00805f9b34fb'
ESS_H = '00002a6f-0000-1000-8000-00805f9b34fb'
def decode(uuid, b):
    if uuid == STOCK and len(b) >= 5:
        return 'stock T=%.2f C H=%d %% batt=%d mV' % (int.from_bytes(b[0:2], 'little', signed=True) / 100, b[2], int.from_bytes(b[3:5], 'little'))
    if uuid == ESS_T and len(b) >= 2:
        return 'ESS T=%.2f C' % (int.from_bytes(b[0:2], 'little', signed=True) / 100)
    if uuid == ESS_H and len(b) >= 2:
        return 'ESS H=%.2f %%' % (int.from_bytes(b[0:2], 'little') / 100)
    return ''
async def main():
    seen = {}
    def cb(dev, adv):
        r = seen.setdefault(dev.address, {'names': [], 'uuids': [], 'mfg': {}, 'sd': {}, 'rssi': adv.rssi, 'dev': dev})
        n = adv.local_name or dev.name
        if n and n not in r['names']: r['names'].append(n)
        for u in adv.service_uuids or []:
            if u not in r['uuids']: r['uuids'].append(u)
        for k, v in (adv.manufacturer_data or {}).items(): r['mfg'][hex(k)] = v.hex()
        for k, v in (adv.service_data or {}).items(): r['sd'][k] = v.hex()
        r['rssi'] = max(r['rssi'], adv.rssi)
    p('Scanning up to 2 minutes; stops 15 s after a Xiaomi-like sensor appears...')
    s = BleakScanner(detection_callback=cb); await s.start()
    t_found = None
    for i in range(120):
        await asyncio.sleep(1)
        if t_found is None and any(is_candidate(r) for r in seen.values()):
            t_found = i; p('found a candidate after', i, 's')
        if t_found is not None and i - t_found >= 15: break
    await s.stop()
    cands = sorted((r for r in seen.values() if is_candidate(r)), key=lambda r: -r['rssi'])
    p('\nall devices with a name:')
    for addr, r in sorted(seen.items(), key=lambda kv: -kv[1]['rssi']):
        if r['names'] or r['sd']:
            p('%s rssi=%s names=%s uuids=%s mfg=%s sd=%s' % (addr, r['rssi'], r['names'], r['uuids'], r['mfg'], r['sd']))
    if not cands:
        p('NO XIAOMI-LIKE SENSOR FOUND'); return
    p('\ncandidates:', [(r['names'], r['rssi']) for r in cands])
    target = cands[0]
    p('\nTARGET', target['dev'].address, target['names'], 'name bytes:', [n.encode('utf-8').hex() for n in target['names']])
    async with BleakClient(target['dev'], timeout=30) as c:
        p('connected, mtu', c.mtu_size)
        chars = {}
        for svc in c.services:
            p('service', svc.uuid)
            for ch in svc.characteristics:
                p('   char', ch.uuid, ch.properties, 'handle', ch.handle)
                chars[ch.uuid] = ch
        subs = [u for u in (STOCK, ESS_T, ESS_H) if u in chars and 'notify' in chars[u].properties]
        if not subs:
            p('no stock or ESS notify characteristic'); return
        t0 = time.time(); n = {u: 0 for u in subs}
        def mk(u):
            def on(_, data):
                n[u] += 1
                p('  t=%6.2f %s len=%d %s %s' % (time.time() - t0, u[:8], len(data), data.hex(), decode(u, data)))
            return on
        for u in subs: await c.start_notify(chars[u], mk(u))
        await asyncio.sleep(40)
        for u in subs: await c.stop_notify(chars[u])
        p('\nnotification counts in 40 s:', {u[:8]: k for u, k in n.items()})
asyncio.run(main())
