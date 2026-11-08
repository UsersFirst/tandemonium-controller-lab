# Controller units: one physical controller, its sources, its presence

**Status:** shipped in `@usersfirst/controller-core` **0.7.0** (lab #141, hand-off from Tandemonium #607 / the #581 TV playtests).
**Code:** `packages/core/src/units.js` (the unit record and platform helpers), `packages/core/src/manager.js` (`_reconcileUnits` and the claim, roster and presence paths).
**Tests:** `packages/core/test/units-acceptance.test.js` (the game's MC/IN cases), `units-bugs.test.js` (the #581 bug table), `units-api.test.js` (API and twin-rule edges), all on the fake-device rig in `packages/core/test/harness/`.

## 1. The problem

Up to 0.6.3 the `ControllerManager` modelled **sources**, not controllers. A WebHID `HidEntry` was one thing, a Gamepad-API pad another, and they were joined only by heuristics at bind time (`_entryMatchesSlot`, `_findUnownedPadForHidSlot`, `_correlateEntryByInput`) plus an app-supplied veto (`opts.padFilter`). It also knew device connect/disconnect, but not whether a controller was actually **there**. Two days of TV playtests (two Steam Controllers on one Puck, a Bluetooth DualSense, the Steam build) produced eight bugs from those two gaps, and the game papered over them with a layer of heuristics. The next app on the lab would have hit every one of them again.

## 2. Platform facts the lab owns

These are why the rules below look the way they do. Each is encoded in a test.

| # | Fact | Consequence |
|---|---|---|
| F1 | Chromium reveals a Gamepad pad only after its **first button press**. | Pad counts drift exactly while players press A/B. Any rule that ranks or counts pads breaks during joins. |
| F2 | Under Steam (emulation mode, no IGA) every captured controller is re-emitted as an **XInput pad**: `"Xbox 360 Controller (XInput STANDARD GAMEPAD)"`, no vid:pid. Its press lands **a few ms after** the hardware's. Across a frame boundary it can even read first. | A quick tap can be fully released on WebHID before the twin reads pressed. Twin detection needs a time window and has to hold a pending claim. |
| F3 | Steam always captures a Steam Controller. Other pads (DualSense, Switch Pro) only when the game's Steamworks settings let it. | A Steam Controller can have a twin even with no Steam map; any WebHID pad can when the page runs under Steam. |
| F4 | Switching a DualSense to full reports (0x31) **freezes** its Gamepad entry (Chromium can't parse 0x31) instead of removing it, when it was listed first. | A listed pad can be a source that will never show a press. It must never be what a claim waits for. |
| F5 | A Steam Controller streams STATE (IMU included) **continuously**, even lying still. | A few seconds of silence means it's switched off. |
| F6 | The Puck exposes **five** HID interfaces; each paired body streams on its own; the rest never stream. The Puck never disconnects while a body is off. | "Never streamed" (latent) and "stopped streaming" (silent) are different states. Neither arrives as a `disconnect`. |
| F7 | Steam's XInput slot map (`getControllerForGamepadIndex` + `getInputTypeForHandle`) can be matched to Chromium's XInput pads **by rank**, but only while the counts agree (see F1). A Steam Controller switched on after launch keeps type 0 (#535). | The map is evidence, not truth: used when sound, press correlation otherwise. |

## 3. The model

### 3.1 `ControllerUnit`

One per physical controller. The manager creates and maintains units every frame; apps only read them.

```
ControllerUnit
  id, key                 stable for the unit's life in the page ('u7')
  entry                   its WebHID HidEntry, or null
  padIndex, padId         its own Gamepad pad (live or frozen), or null
  padFrozen               that pad stopped changing while WebHID keeps pressing (F4)
  twinPadIndex, twinPadId Steam's XInput twin, or null (F2)
  steamSlot               { index, handle, type } from Steam's map, when known
  presence                'latent' | 'present' | 'silent' | 'gone'
  presenceSince, lastReportAt (never zeroed)
  slot                    the slot holding it, or null
  sources                 [{ kind: 'webhid' | 'gamepad' | 'steam-xinput', … }]
  identity, connection    what a UI calls it (driver entry first)
  frame()                 its input as one gamepad: buttons OR'd over live sources,
                          largest stick deflection; a frozen pad adds nothing,
                          the twin is left out (it echoes late and would stretch presses)
```

### 3.2 Merging sources (`_reconcileUnits`, every frame, before any claim)

1. **WebHID.** One unit per `HidEntry`, pooled or seated. Its presence comes from §3.3.
2. **Every Gamepad pad** is classified, sticky until its index empties or shows another id:
   1. A slot holds it **together with** a WebHID entry → it is that unit's own pad.
   2. It has a vid:pid, or its id contains a WebHID entry's product name (the same candidate rule seats bind by; vid:pid alone misbinds a GameSir that shows 0ce6 while its HID handle is 09cc) → that unit's own pad (`linked`). Several look-alike candidates → the 0.6 Tier 1/Tier 2 correlation, on a press only. Until a press decides, the pad is `ambiguous`: hidden, still claimable through the Gamepad path as before.
   3. An **XInput** pad (no vid:pid) is checked against the units Steam could be mirroring: present WebHID units with no twin yet that are Steam Controllers (F3), or any WebHID unit while the app says it runs under Steam.
      - **Rank evidence:** Steam's map resolves this pad by rank (F7) to a type of the same family as exactly one eligible unit → its twin. For type 0 the #535 rule applies: when WebHID holds more Steam Controllers than Steam named, the first unnamed slots are their twins.
      - **Press mirror:** every button the pad pressed within `twinWindowMs` (500) was also pressed on exactly one eligible unit within that window → its twin. Several match (two players hit A together) → a twin whose unit a later unique press settles, never more twins than eligible units.
      - **Pending:** a press nothing mirrors yet, while some unit could still be mirrored, holds the pad's claim for `twinClaimHoldMs` (200). A pad never seen before stays unlisted meanwhile (a twin must not flash up as a controller); an already-listed pad keeps its row. When the hold expires the press still claims, even if released (a real Xbox pad's quick tap still joins).
      - **Revocation:** a twin that presses while its unit pressed nothing around that moment was a real pad all along. It becomes a pad-only unit.
   4. Anything else is a **pad-only unit** (Xbox, a Steam-only Steam Controller, any pad with no WebHID driver). A Steam-captured one carries its `steamSlot`, so the app knows its stick may be Steam's gyro.

### 3.3 Presence

```
            first report                       silentAfterMs without a report
 latent ───────────────────▶ present ───────────────────────────────────▶ silent
 (fan-out interface,          ▲   (streamsWhileIdle drivers only)            │
  never streamed)             └───────────── next report ◀───────────────────┘
 any ── disconnect / unplug ──▶ gone (dropped)
```

- `latent`: a fan-out receiver interface (Puck) that has never streamed. Not a controller, never listed, can't claim (F6).
- `present`: connected. For drivers that declare `static streamsWhileIdle = true` (the Steam Controller, F5), it also means a report within `silentAfterMs` (4000).
- `silent`: connected device, controller switched off. Its slot reads `slot.connected === false` and emits `'presence'`. If `mgr.releaseSilentSeats` is true (the default), the seat is freed with reason `'silent'`, without a reclaim cooldown, so the first press back seats it again. Its first report back makes it `present` again with no press needed.
- Non-streaming sources (Gamepad pads, controllers that only report on change) can't tell "off" from "idle". They are `present` while listed, and their disconnect is the existing orphan path.
- `HidEntry.lastReportAt` / `firstReportAt` are **never zeroed**. `slot.effectiveGamepad()` no longer zeroes `hidActiveSince` when stale (0 used to mean both "never streamed" and "switched off").

### 3.4 Seats bind to units

- **Claims are per unit.** A unit is claimed once, by whichever source pressed first. The 0.6 HID-claim skip ("an unclaimed Gamepad pad shares this productName, leave it to the Gamepad claim") is gone; it deadlocked a frozen DualSense (bug 6).
- The Gamepad claim skips twins, pending pads, and pads whose unit is already seated over WebHID. Claiming a `linked` pad attaches **that** unit's entry.
- **A twin never holds a seat.** If one got a seat before it could be recognised (F2: twin first, hardware late), the next frame either **moves the seat to the twin's controller** (same seat, same player, now on its WebHID source; slot emits `'rebound'`) when that controller has no seat, or releases it with reason `'twin'` when the controller sits elsewhere. This runs even while `autoClaimSuspended`.
- `claimPadForSlot` on a twin seats its controller. `claimUnitForSlot(slotId, unit)` is the seat-screen call: WebHID source plus its own pad, never the twin.
- `Slot` keeps `_hidEntry` and `gamepadIndex` (the unit's seated sources) for compatibility. `slot.unit` and `slot.connected` are new.

### 3.5 Roster and lists

`controllerRoster()` and `units()` list **units**: claimed slots, present WebHID units, and pad-only units. A pad linked to a WebHID unit is that unit's row. Twins, pending pads, ambiguous look-alikes, latent and silent units, stuck-stick ghosts and `padFilter` rejects are not listed. Rows gain `connected` and `unitKey`.

## 4. Public API (0.7)

| API | What |
|---|---|
| `mgr.units()` | Present controllers, one per physical unit, oldest first, seated included. |
| `mgr.allUnits()` | Every unit incl. latent/silent (diagnostics). |
| `mgr.unitForSlot(slot\|id)`, `mgr.unitForPad(index)`, `mgr.unitForDevice(hidDevice)` | Lookups. `unitForPad` resolves a twin to its controller (rumble: send to `unit.twinPadIndex` / `unit.steamSlot.handle`). |
| `mgr.isTwinPad(gp\|index)` | Steam's echo of a controller already read over WebHID. |
| `mgr.claimUnitForSlot(slotId, unit)` | Seat a unit (seat screens with `autoClaimSuspended`). |
| `mgr.setSteamInputMap(map\|null)` | Feed Steam's XInput slots each frame before `ingestFrame`; `null` = not under Steam. Core never talks to Steam. |
| `mgr.releaseSilentSeats` | Writable policy: free a silent controller's seat. |
| `ingestFrame()` → `{ claimed, released, why }` | `why[slotId]` is `'gesture'`, `'silent'` or `'twin'`. |
| `slot.connected`, `slot.unit`, `slot.releaseReason` | Per seat. Slot events add `'presence'` ({ connected, presence }) and `'rebound'`. |
| `unit.frame()` | The unit's merged input (replaces app-side merges). |
| options | `silentAfterMs` 4000, `releaseSilentSeats` true, `twinWindowMs` 500, `twinClaimHoldMs` 200, `createFusion(device)` (tests inject a stub; default lazy `SensorFusion`). |
| `DEFAULT_YAW_RETURN_HALF_LIFE_S` | 2. `SensorFusion.yawReturnHalfLife` now defaults to it (#596). |

**One app hook remains:** `opts.padFilter`, the host's veto over Gamepad pads. Core no longer needs it for Steam twins; it stays for genuinely app-specific exclusions.

## 5. What moves out of apps (Tandemonium inventory)

| Game workaround | Replaced by |
|---|---|
| `isSteamTwinPad` + `steamSlotForGamepad` rank match, passed as `padFilter` | §3.2 rank evidence + press mirror; `mgr.isTwinPad`; no `padFilter` |
| `pressesMirrorSteamController` / `noteSteamControllerPresses` (500 ms history for every live Steam Controller) | `_recordInput` keeps history for seated **and** pooled entries; `twinWindowMs` |
| `claimedSteamTwinSlots` → release + unseat on lobby screens | §3.4 twin seats are moved or released by core; `ingestFrame().why` tells the app (`'twin'`) |
| `mergedPollGp` (frozen Gamepad entry + WebHID synthetic as one) | `unit.frame()` |
| `withoutHeldTwins` (drop a Gamepad candidate whose pad a slot holds over WebHID) | candidates come from `mgr.units()`; a linked pad is its unit |
| `frozenTwinHidEntries` → game-side claim | the HID claim has no same-name skip (bug 6 can't happen) |
| `isSilentSteamControllerSlot` (`PUCK_SILENT_MS`) → not `gamepadConnected`, seat freed in the lobby | `slot.connected`, `mgr.releaseSilentSeats = (state === 'lobby')`, `why: 'silent'` |
| `_lastStateAt` (remembered last report) | `HidEntry.lastReportAt` / `unit.lastReportAt`, never zeroed |
| `_twinLinks` / `steamTargetForEntry` rumble routing (#617) | `mgr.unitForDevice(d).twinPadIndex` / `.steamSlot.handle` |
| at-rest yaw return turned on by the game (#599) | core default |

## 6. The #581 bug table, and what prevents each

| # | TV symptom | Root cause | Prevented by | Test |
|---|---|---|---|---|
| 1 | DualSense listed, ✕ never seats it in versus | two claim paths (the game's Steam snapshot, since deleted) | one claim path per unit; Steam is evidence fed in, not a claim path; `claimUnitForSlot` | `bug 1` |
| 2 | Hot-plugged DualSense: the join card is the frozen Gamepad entry, ✕ only in the WebHID synthetic | two sources, no unit | linked pad + WebHID = one unit; `unit.frame()` reads the synthetic | `bug 2`, `MC-19` |
| 3 | Seated DualSense listed twice | two sources, no unit | roster lists units; a linked pad is never its own row | `bug 3` |
| 4 | Steam's "Xbox" twin shows, flickers, takes the stoker seat; the rank match breaks because of F1 | no twin model | press mirror (rank only as evidence); twins are never listed or claimed | `bug 4`, `MC-17` |
| 5 | Quick taps: twin JOINED, twice became P1 | twin late (F2) + no history for seated entries | history for all entries, `twinWindowMs`, pending hold, twin-seat move/release | `bug 5`, `bug 5b`, `MC-18` |
| 6 | DualSense switched on later: seen, presses seen, never P1 | HID claim skipped for a same-name unclaimed pad, which was frozen: deadlock | skip removed; the unit is claimed by whichever source pressed | `bug 6`, `MC-19` |
| 7 | Steam Controllers switched off stay JOINED, holding P1 | no presence | `silent` presence, `slot.connected`, `releaseSilentSeats` | `bug 7`, `MC-20` |
| 8 | "Switched off" read as "never streamed" | `effectiveGamepad` zeroed `hidActiveSince` | `lastReportAt` never zeroed; `latent` vs `silent` | `bug 8` |

On core 0.6.3, 14 of the 18 acceptance and bug tests fail (all eight bug rows, MC-12, MC-17, MC-18, MC-19, MC-20). IN-10, MC-11, MC-16 and IN-19 already passed there; they stay as regression guards.

## 7. Migration: 0.6.x → 0.7.0

0.7.0 is a minor bump, which pre-1.0 means **breaking where noted**:

- **Behaviour:** an XInput pad's first press waits up to 200 ms while a Steam-capturable WebHID controller has no twin. A Steam Controller silent for 4 s loses its seat by default (set `releaseSilentSeats = false` to keep seats, e.g. mid-game, and pause on `slot.connected`). A twin-claimed seat moves to its controller.
- **Breaking:** `isPresentableEntry(entry, now?, silentAfterMs?)` now means *present* (a silent Steam Controller is not presentable). `slot.effectiveGamepad()` no longer zeroes `entry.hidActiveSince`; read `lastReportAt` / unit presence for liveness. The roster no longer lists twins or pads linked to a WebHID controller. `SensorFusion.yawReturnHalfLife` defaults to 2 (set 0 to restore raw yaw).
- **Unchanged:** slot ids, `claimPadForSlot` / `claimHidDeviceForSlot` / `releaseSlotToPool`, `autoClaimSuspended`, `padFilter`, the Slot event names (plus two new ones), `controllerRoster` row shape (plus two fields).
- **Apps should:** call `setSteamInputMap()` each frame under Steam; drop twin and silence heuristics; build join lists from `units()` with `unit.frame()`; read `ingestFrame().why` to tell their seat UI why a seat emptied.

## 8. Engineering decisions taken (and why)

- **Units sit inside the existing manager**, not as a rewrite. Slots keep their source fields, so every 0.6 consumer keeps working and the change is testable increment by increment. Slots bind to units through those fields.
- **The press mirror is index-based to link, time-based to revoke.** Linking needs the same buttons (strong evidence). Revoking needs only "the unit pressed nothing then", so a Steam layout that remaps a paddle to A can't un-twin a real twin.
- **A twin-claimed seat moves rather than empties** when its controller is free. The player pressed to join; they keep the seat, now on the right source.
- **Silent release has no reclaim cooldown.** The cooldown guards against a held release gesture; a switched-off controller holds nothing.
- **The 200 ms hold applies only to XInput pads**, and only while a mirrorable unit lacks a twin. Pads with vid:pid never wait.

## 9. Hands-on verification (Steam build, TV): 3 → 4 → 5+ controllers

Run on the Windows Steam build. Between steps watch the Controls list / roster: **one row per physical controller, never an "Xbox" row for a Steam Controller.**

1. **3 controllers.** Two Steam Controllers on one Puck, both on, plus a Bluetooth DualSense **switched on after launch**.
   - Press A on SC-1, then SC-2: P1 and P2, each on its own body. Three rows: two seated, the DualSense connected.
   - Press ✕ on the DualSense: it becomes P3 (and P1 if P1 is free).
   - Quick-tap A/B on each Steam Controller ten times: no extra seat, no "Xbox Wireless" row, P1 never moves.
   - In versus seat select: B stands SC-2 up, A sits it back down on SC-2.
2. **4 controllers.** Add a wired or wireless **Xbox pad** after launch.
   - Its A joins it as the next player (a 0.2 s hold on its first press is expected).
   - The roster shows one Xbox row (the real pad), still no twin rows.
3. **5+ controllers.** Add a second DualSense (or any fifth pad).
   - Each joins on its own press; seats never cross-wire; two DualSenses each keep their own lightbar colour.
4. **Switch-off.** Switch SC-1 off in the lobby: within ~4 s its seat frees and its row disappears. Switch it on, press A: it seats again. Mid-ride, switch SC-2 off: the disconnect pause shows. Switch it on: the ride resumes without a press.
5. **Gyro.** The overlay's DualSense model doesn't drift in yaw when set down (at-rest yaw return on).
6. If anything misbehaves, attach `%USERPROFILE%\tandemonium-diag.log`. The manager logs `[manager] … twin` / `… went silent` lines.
