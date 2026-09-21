# WLED review — 2026-09-21

## Findings and fixes

- Native output registered a detached composite canvas but the sender rejected disconnected canvases. The native branch also did not tick WLED when a snapshot arrived. Native mirrors now have an explicit source role and notify WLED only after a fresh frame is decoded.
- Native snapshots already have top-origin rows. Native sampling now avoids the browser path's vertical flip.
- A pending mirror import could register WLED after disable or teardown. Registration now checks the current enable and lifecycle state.
- LED FX tempo now respects manual BPM before detected BPM.
- Realtime packets previously used timeout 255 (indefinite). DRGB packets now use two seconds, allowing WLED to resume its own state after output stops. This does not necessarily turn LEDs off.
- Packet construction validates whole RGB triples and the supported 1–490 LED range. IPC validates UDP port range.
- The settings text now describes the native shared-preview cadence, rather than claiming 60Hz.

## Verification

- WLED and context-help suites: 77 tests passed, including mapping, calibration, effects, native snapshot-to-sender delivery, upright sampling, manual BPM, in-flight backpressure, disable and release.
- Packet contract and actual localhost UDP delivery: 2 tests passed.
- Desktop type check: zero errors; existing 1,038 warnings remain.
- Electron main-process syntax check and documentation topic/route audit passed.
- Website production build passed with the new `/docs/wled` route.

These checks do not verify physical LEDs, controller firmware configuration, Wi-Fi behavior, or a packaged Windows build. Local UDP testing checks packet transport, not remote receipt. The LIVE badge indicates enable state and is not a device acknowledgement.

## Hardware acceptance before release

1. Restart the desktop app so the updated main-process packet sender is loaded.
2. Verify the strip using WLED's own UI; enable Receive UDP realtime with matching port (default 21324).
3. Add the controller in Settings → Integrations → WLED, enable it, and test Solid red, green, blue.
4. Use Chase and LED order to verify physical ordering. Check strip/matrix/serpentine/custom layouts as applicable.
5. Return to Content and play moving color bars in both mapping and VJ workspaces. Confirm orientation, live updates, and that switching workspaces does not retain stale output.
6. Test LED FX with manual BPM and calibration/smoothing settings.
7. Disable/remove the controller and quit the app; WLED should leave realtime mode about two seconds after the last frame. Reconnect and test again.
8. Repeat on Windows with the packaged build and local firewall permissions.

## Documentation

Website source: `ghostarcade-web/src/app/docs/wled/page.tsx`, listed under Output and linked from Settings documentation and the app's WLED panel. Covers setup, physical layout, color calibration, effects, test patterns, troubleshooting and protocol limits. Website edits require publication before the app's public guide link will work.

Official protocol: https://kno.wled.ge/interfaces/udp-realtime/
Official settings: https://kno.wled.ge/features/settings/
