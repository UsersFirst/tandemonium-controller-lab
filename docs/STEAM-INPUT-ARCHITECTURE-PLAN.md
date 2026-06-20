# Steam Input × WebHID — Architecture & Design Plan

**Status:** Proposed · **Date:** 2026-06-20 · **Owner:** pete
**Scope:** `tandemonium`, `tandemonium-controller-lab` (and a new `@usersfirst/controller-steam` package within the lab)

> **One-sentence thesis.** WebHID is the foundational input spine; Steam Input is an
> optional, removable adapter that conforms to the same normalized `InputFrame`
> contract — *forced* only where raw HID is impossible (Steam Deck built-in controls)
> and *opt-in* everywhere else. Nothing in `core`, `visualizer`, or the Tandemonium
> game logic may depend on Steam Input.

---

## 0. Why this document exists

Two systems consume controllers today and they disagree about what a controller *is*:

- **The lab (`tandemonium-controller-lab`)** treats a controller as a *specific physical
  device*: a DualSense with a known HID report layout, a real gyro, a serial/MAC, a 3D
  model. Its whole value proposition — per-vendor 3D visualization + true sensor-fusion
  gyro — depends on reading the **raw device** via WebHID.

- **Steam Input** treats a controller as an *abstract action surface*: the game asks "is
  `Steer` deflected?" and Steam decides which physical input answers, deliberately hiding
  the device identity, collapsing extra inputs, and (on Steam Deck) stripping gyro from
  anything that isn't the `ISteamInput` API.

These two world-views are **mutually exclusive per physical controller** (see §2). You
cannot read the same controller through both channels at once without double-input bugs.
So the central architectural question is not "how do we use Steam Input" — it's **"which
channel owns each controller, and how do both channels feed one consistent model so the
game and overlay never have to care which won."**

This plan answers that with a WebHID-first design.

---

## 1. Steam Input in 10 minutes (the parts that bite)

> Sourced from Valve partner docs + 2024–2026 developer reports. Confidence tags:
> **[H]** high, **[M]** medium, **[L]** uncertain. Items marked ⚠️ must be verified
> empirically on real hardware before shipping.

### 1.1 Two completely different modes

| Mode | What the game sees | How you opt in | Device identity? | Gyro? |
|---|---|---|---|---|
| **Emulation** (default) | A virtual **Xbox/XInput** pad injected into the process via OS API hooks (XInput/DirectInput/RawInput/WGI). No code. **[H]** | Per-controller-type toggle in Steamworks backend; no integration. | **Lost** — everything looks like an Xbox pad; PS trackpad-click + Options both collapse to XInput Start. **[H]** | Only if the player's config binds gyro→mouse/joystick. The game can't tell gyro is involved. |
| **Native API** (`ISteamInput`) | Nothing through XInput. The game calls `Init()` / `RunFrame()` / `GetDigitalActionData()` / `GetAnalogActionData()` and reads **action handles**. **[H]** | Link `steam_api`, ship an **action manifest (IGA)**, designate the controller type as "uses the API" in the backend. | Available via `GetInputTypeForHandle` + `controller_type`, **but the raw device is gone** — you get Steam's abstraction, not the HID stream. | Via `GetMotionData()` (quaternion + accel + angular velocity) **iff** the active config isn't already consuming the gyro. |

**The load-bearing fact [H]:** *a controller bound to the Steam Input API will **not**
return a handle through `GetControllerForGamepadIndex()`*. Native API and emulated-XInput
are two doors to the same controller and Steam only opens one. This is the anti-double-input
design — and the reason WebHID-first works (see §2).

### 1.2 The two files (the thing that confused us in May 2026)

- **IGA / action manifest** — `game_actions_<appid>.vdf`. The *schema*: declares actions
  (`Steer`, `Confirm`) and action sets (`InGameControls`). Hand-authored, lives in source.
  See `tandemonium/steam/game_actions_4510250.vdf`.
- **Binding config** — `controller_<type>.vdf`. The *mapping*: which physical input invokes
  which action, per controller type. **Authored in Big Picture and exported — never
  hand-written.** See `tandemonium/steam/controller_ps5.vdf`.

`controller_type` identifiers we care about: `controller_ps5`, `controller_xboxone`,
`controller_neptune` (**Steam Deck built-in** [H]), and `controller_triton` (**the new
2026 Steam Controller** — ⚠️ bug-tracker/RE evidence only, *not* in Steamworks docs; keep
a `controller_neptune` fallback and re-verify per client version).

### 1.3 Gyro: who should own it

- **Steam owns it** (gyro bound to mouse/joystick in config, or read via `GetMotionData`):
  free calibration, drift correction, real-world sensitivity, 1€ smoothing, Flick Stick,
  gyro-button ratcheting — all player-tunable in a trusted UI. But you only get
  mouse/stick, behavior drifts across Steam client versions, and **none of it exists
  off-Steam.**
- **You own it** (raw HID + sensor fusion): full control of feel and gyro-space, portable
  to web/Epic/GOG, but you implement calibration + fusion yourself. **The lab already does
  this** — `@usersfirst/controller-core/sensor-fusion` is a port of JibbSmart's
  GamepadMotionHelpers. This is a solved problem in your codebase.

→ **WebHID-first means: own gyro via fusion everywhere you can; only fall back to
`GetMotionData` where raw HID is occluded (Deck built-in).**

### 1.4 From Node/Electron

- **`steamworks.js`** (most popular) — its `input` namespace is **partial**: no
  `runFrame()`, no action origins, **no glyph functions**. Unusable for glyphs. **[H]**
- **`steamworks-ffi-node`** (koffi FFI) — the **only** Node binding exposing `runFrame`,
  action origins, and `getGlyphPNG/SVGForActionOrigin`. Young; "tested with virtual gamepad
  only." **[H]/[M]** — this is what Tandemonium already uses (`steamworks-ffi-node@0.10.3`).
- Gotchas [H]: you **must** call `RunFrame()` every frame or `GetConnectedControllers()`
  stays empty; call `setInputActionManifestFilePath()` **before** `init()`;
  `getConnectedControllers()` is empty for the first several frames after init.

### 1.5 Glyphs — and why we don't actually need Steam for them

Steam's `GetGlyph*ForActionOrigin` returns correct on-screen prompts for whatever the
player bound. It's genuinely useful — **but it's the only Steam-exclusive feature we'd
miss, and the lab can already produce its own glyphs**: `controller-profiles.js` carries
per-vendor `hudLabels` (✕ ○ □ △, L2/R2, …) and full 3D meshes. So **the lab is its own
glyph authority**; Steam glyphs become an optional enhancement for when a player is using
Steam's own remapping. This removes the last hard dependency on Steam Input.

---

## 2. The central conflict, and why WebHID-first is correct

When Steam Input is **active for a controller**, here is what happens to the raw device:

| Platform | Raw HID device | Virtual pad (Gamepad API) | Gyro available raw? |
|---|---|---|---|
| **Windows** | Still present, but Steam hooks the process. Reading raw HID *and* the virtual pad = **double input**. Tools like HidHide exist precisely to suppress one. ⚠️ WebHID×SteamInput interaction undocumented — test. **[M]** | Emitted **only if** the controller is in *emulation* mode (no API binding). | Yes, if you read raw HID and Steam isn't claiming the device exclusively. |
| **Steam Deck / Linux** | **Kernel-occluded.** `hid-steam` removes the classic gamepad node as soon as any client opens `hidraw`. Only Steam's virtual pad remains, and it is **gyro-stripped**. **[H]** | Always present (built-in pad always routes through Steam Input; cannot be disabled system-wide). | **No** — only via `ISteamInput::GetMotionData`. **[H]** |

Three conclusions fall out, and together they *are* the architecture:

1. **WebHID and Steam Input must never read the same physical controller at once.**
   One channel per controller, chosen by an arbiter. (This is already half-built in
   Tandemonium as the `tandemonium_dualsense_source` preference: `auto|steam-input|webhid`.)

2. **WebHID is the only channel that preserves what the lab exists to show** (device
   identity + real gyro), and the only one that works **off-Steam** (browser, Epic, GOG,
   itch). So it is the default/primary.

3. **There is exactly one place WebHID cannot reach: Steam Deck built-in controls.** There,
   and only there, the arbiter is *forced* to use Steam Input to recover gyro. Everywhere
   else Steam Input is opt-in.

**You already chose this once.** `tandemonium/forge.config.js` deliberately does *not*
ship the IGA to the depot, because shipping it would flag the app as "Steam Input SDK
exclusive" and **suppress the virtual XInput pad that the WebHID/Gamepad path depends on.**
That comment is, in effect, an undocumented statement of this plan's thesis. We're
promoting it to a named, deliberate architecture.

---

## 3. Current state (what exists today)

### 3.1 `tandemonium-controller-lab` — the WebHID spine (already strong)

- **`@usersfirst/controller-core`**
  - `drivers/*` — `PlayStationDriver`, `SwitchProDriver`, `XboxDriver`,
    `SteamControllerDriver` (HID parsers for the new 2026 Steam Controller, incl. Puck
    `0x28de:0x1304` lizard-mode suppression). Driver interface: `parseReport(reportId,
    data) → {gyro, accel, buttons, sticks, triggers, touchpad, grips, …}`.
  - `devices.js` — registry of `(vid,pid) → protocol + capabilities + profile + quirks`.
  - `sensor-fusion.js` — per-device gyro fusion (GamepadMotionHelpers port) →
    `getQuaternion()`. **This is our gyro engine.**
  - `manager.js` — `ControllerManager` + `Slot` slot/claim state machine; pools WebHID
    devices, builds synthetic gamepads, merges Gamepad API, arbitrates via
    `Slot.effectiveGamepad(gamepads)`.
  - `controller-inventory.js` — per-unit identity (BT MAC > vid:pid > name).
- **`@usersfirst/controller-visualizer`** — `ControllerOverlay.update(gamepad, gyroQuat)`,
  `PROFILES` (mesh maps + `hudLabels` + GLB per vendor), `GyroGimbal`,
  `detectControllerType(id)`.
- **`apps/overlay`** — Electron reference app; WebHID + Gamepad API only. **Zero Steam
  code.** README promises a future `@usersfirst/controller-steam`.

### 3.2 `tandemonium` — Steam Input bolted onto the game (works, but stranded)

- `electron/main.js` — `steamworks-ffi-node` init; `setInputActionManifestFilePath` →
  `input.init(true)` → 60 Hz `runFrame()` tick; reads `Steer` analog + 9 digital actions;
  pushes a snapshot to the renderer over IPC `steam:input:tick`; sync read via
  `window.steam.input.getLatest()`.
- `js/input-manager.js` — consumes either the Steam Input snapshot *or* the lab's WebHID
  fusion, gated by `tandemonium_dualsense_source` (`auto|steam-input|webhid`). Synthesizes
  a standard gamepad from the Steam snapshot when Steam Input wins. **This per-controller
  source arbitration is the seed of the design in §4.**
- `steam/*.vdf` — IGA (`game_actions_4510250.vdf` playtest, `…4482940` release) + exported
  bindings (`controller_ps5.vdf`, `controller_neptune.vdf`).
- `forge.config.js` — ships bindings but **not** IGAs (the WebHID-first hack).
- `tools/steam-controller-test/` — standalone Electron diagnostic harness (Steam Input
  panel / Gamepad API panel / WebHID panel) for isolating "is it Steam or is it us."
- Memory: `docs/steam-input.md` (excellent runbook), `docs/motion-controls-v2-analysis.md`
  (gyro tuning), `dualsense-steam-input-working-recipe`.

**The problem:** all the Steam Input knowledge and code live in the *game*, where the lab
and overlay can't reuse them, and where the Deck/new-Steam-Controller work gets stranded.

---

## 4. Target architecture

### 4.1 The contract: `InputFrame` (source-agnostic, normalized)

Everything below the line consumes this; nothing above the line knows where it came from.

```
InputFrame {
  sourceId:  'webhid' | 'steam-input' | 'gamepad-api'
  identity: {
    profileKey,      // 'dualsense' | 'switch-pro' | 'xbox' | 'steam-controller' (drives the 3D model)
    vendorId, productId,
    unitId,          // BT MAC / serial / vid:pid  (per-unit identity, from controller-inventory)
    label            // human string
  }
  buttons:  StandardButton[]          // 18+ standard layout, {pressed, value}
  axes:     [lx, ly, rx, ry]
  triggers: { l2, r2 }                // 0..1
  motion:   { quaternion, gyro:{x,y,z}, accel:{x,y,z}, hasGyro } | null
  extras:   { touchpads?, paddles?, grips? } | null
  glyphs:   GlyphProvider | null      // null ⇒ consumer falls back to visualizer profile labels
}
```

This is essentially what the lab's `driver.parseReport()` + synthetic gamepad + fusion
*already* produce. WebHID is the canonical producer; the Steam adapter must conform to it.

### 4.2 The producers: `ControllerSource`

```
interface ControllerSource {
  id: 'webhid' | 'steam-input' | 'gamepad-api'
  list(): SourceController[]            // controllers this source currently sees, with identity
  read(controllerRef): InputFrame       // produce a normalized frame
  supportsGyro(controllerRef): boolean
  glyphProvider?: GlyphProvider         // only steam-input populates this
  start()/stop()
}
```

- **`WebHIDSource`** — thin wrapper over the *existing* `ControllerManager` pool + drivers +
  fusion. **This is ~all already written**; we're formalizing its output as `InputFrame`.
- **`GamepadAPISource`** — wraps `navigator.getGamepads()`; no gyro, no rich identity.
  Fallback for controllers with no driver (e.g. Xbox on Chromium).
- **`SteamInputSource`** — *new*, lives in `@usersfirst/controller-steam`. Wraps
  `ISteamInput` (`runFrame`, `getConnectedControllers`, action data, `GetMotionData`,
  glyphs). Produces `InputFrame`s with `motion` filled from `GetMotionData` and a real
  `glyphProvider`. **Optional and removable** — if the package is absent, the system loses
  nothing except Deck built-in gyro.

### 4.3 The arbiter (WebHID-first, dedup by identity)

The `ControllerManager` grows from "pool WebHID + merge Gamepad API" to "merge N
`ControllerSource`s." Per *physical* controller (deduped by `identity.unitId` /
`controller_type`):

```
choose source for controller C:
  1. if a per-controller/global preference forces a source → use it        (opt-in Steam Input)
  2. else if C is a Steam Deck BUILT-IN pad → SteamInputSource             (forced; raw HID occluded)
  3. else if WebHIDSource has C → WebHIDSource                             (DEFAULT — the spine)
  4. else if SteamInputSource has C → SteamInputSource                     (raw HID unavailable)
  5. else GamepadAPISource
```

**Dedup is the critical safety property:** the same DualSense can appear in *both*
`WebHIDSource` and `SteamInputSource`. Match them by identity; pick one; **never read both**
(this is what prevents double-input). When WebHID wins but a Steam glyph provider exists,
the arbiter may still expose Steam glyphs without reading Steam input.

The preference in rule 1 is the generalized, library-level successor to Tandemonium's
`tandemonium_dualsense_source` — now per-controller, in the lab, available to any consumer.
**This is the answer to "wouldn't the adapter also be the way to use Steam Input in other
games where it's desired?" — yes: rule 1 is that opt-in; rule 2 is the forced Deck case.**

### 4.4 Where it lives

```
tandemonium-controller-lab/
  packages/
    core/                      @usersfirst/controller-core
      src/input-frame.js       NEW — InputFrame + ControllerSource contracts (zero deps)
      src/sources/webhid.js    NEW — WebHIDSource (wraps existing manager/drivers/fusion)
      src/sources/gamepad.js   NEW — GamepadAPISource
      src/manager.js           EVOLVE — multi-source arbiter + identity dedup
    visualizer/                @usersfirst/controller-visualizer (consumes InputFrame; unchanged contract)
    steam/                     NEW @usersfirst/controller-steam   ← OPTIONAL package
      src/steam-input-source.js   SteamInputSource (ISteamInput → InputFrame)
      src/glyph-provider.js        GetGlyph*ForActionOrigin → file paths/SVG
      src/manifest/                IGA + controller_<type>.vdf authoring/validation tooling
      src/ffi/                     steamworks-ffi-node (or raw koffi) binding, isolated here
      README.md                    "Steamworks SDK is never bundled or auto-downloaded"
  apps/
    overlay/                   consumes core (+ steam only when running under Steam)
```

- `core` and `visualizer` **must not** `import` from `steam`. The dependency points one
  way: `steam` depends on `core` (for `InputFrame`, identity, registry). A consumer that
  never installs `@usersfirst/controller-steam` gets a fully working WebHID system.
- **Steamworks SDK stays un-bundled** (matches the lab's existing stance). The FFI binding
  and the `steam_api64.dll` loading are quarantined inside the `steam` package + the
  consuming app's Electron main process.

### 4.5 What changes in Tandemonium

Tandemonium stops hand-rolling Steam Input in `electron/main.js` + `js/input-manager.js`
and instead consumes the lab:

- `js/input-manager.js` → consume `InputFrame` from the lab's arbiter. Its current
  source-juggling and synthetic-gamepad-from-Steam logic move into `WebHIDSource` /
  `SteamInputSource`. The motion pipeline (`_applyTilt`, calibration, response curve in
  `config.js`) stays — it operates on the normalized `motion.quaternion`/`gyro` regardless
  of source.
- `electron/main.js` → its Steam Input tick/IPC becomes the Electron-side transport for
  `@usersfirst/controller-steam` (the FFI lives in main; renderer reads via the same
  `getLatest()` sync bridge).
- `steam/*.vdf` + the `forge.config.js` ship logic → migrate into the `steam` package's
  manifest tooling, but the **"don't ship the IGA in emulation mode" decision stays** (§5).
- `tools/steam-controller-test/` → graduate into the lab as the canonical multi-source
  diagnostic harness (it already tests all three panels).

---

## 5. The IGA / emulation decision (do NOT regress this)

This is the subtlest part and the easiest to break.

- **Default for both Tandemonium and the overlay: emulation mode, no IGA in depot.** Steam
  emits a virtual XInput pad; WebHID + Gamepad API see controllers normally; the lab owns
  gyro via fusion. This *is* WebHID-first. **Keep `forge.config.js` shipping bindings but
  not IGAs.**
- **Only opt a controller type into the native API path when you must** — i.e. Steam Deck
  built-in controls (to recover gyro via `GetMotionData`). Opting *everything* into the API
  would suppress the XInput pad and break the WebHID-first path on Windows. ⚠️ Verify on a
  real Deck that you can scope API usage to `controller_neptune`/`controller_triton` while
  leaving desktop controllers in emulation.
- The bindings we *do* ship (`controller_ps5.vdf`, `controller_neptune.vdf`) map gyro →
  Left-Stick-X so that **even in pure emulation mode**, a Steam player gets gyro-steering
  through the virtual pad without any API integration. That's a nice WebHID-independent
  bonus and should stay.

**Net:** Steam Input is invited in for two narrow jobs — Deck built-in gyro, and opt-in
remapping/glyphs — and is otherwise kept out of the input path on purpose.

---

## 6. Platform behavior matrix (the acceptance criteria)

| Environment | Source chosen | Gyro | Glyphs | Steam Input needed? |
|---|---|---|---|---|
| Browser (web Tandemonium / overlay) | WebHID (+ Gamepad API fallback) | Fusion | Visualizer profile labels | **No** |
| Electron, no Steam (Epic/GOG/itch/dev) | WebHID | Fusion | Visualizer labels | **No** |
| Electron + Steam, desktop controller (DualSense, etc.), **default** | WebHID (Steam in emulation, XInput pad ignored) | Fusion | Visualizer labels (Steam glyphs optional) | **No** (adapter may add glyphs) |
| Electron + Steam, desktop controller, **user opts into Steam Input** | SteamInputSource | `GetMotionData` | Steam glyphs | Yes (opt-in) |
| **Steam Deck, built-in controls** | SteamInputSource (**forced**) | `GetMotionData` | Steam glyphs | **Yes (unavoidable)** |
| Steam Deck + external WebHID controller | WebHID (if Steam Input disabled for it) | Fusion | Visualizer labels | No |

If `@usersfirst/controller-steam` is **not installed**, every "No" row works identically;
the two "Yes" rows degrade (Deck built-in loses gyro; no Steam glyphs). Nothing else breaks.
That degradation profile *is* the proof the dependency is truly optional.

---

## 7. Phased roadmap

Each phase is independently shippable and leaves the system working.

### Phase 1 — Define the contract & formalize the WebHID spine *(lab; no Steam)*
- Add `core/src/input-frame.js`: `InputFrame` + `ControllerSource` + `GlyphProvider` types.
- Wrap existing manager/drivers/fusion as `WebHIDSource`; add `GamepadAPISource`.
- Evolve `ControllerManager` into a multi-source arbiter with identity dedup (§4.3), default
  WebHID-first. Port the per-controller source preference (generalize Tandemonium's
  `dualsense_source`).
- Visualizer consumes `InputFrame` (it already takes `(gamepad, quat)` — adapt the shim).
- **Exit:** overlay + (optionally) Tandemonium web run entirely on the new contract,
  WebHID-only, zero Steam code touched. CI green.

### Phase 2 — Extract `@usersfirst/controller-steam` (skeleton, optional) *(lab)*
- Create the package; move the FFI binding (`steamworks-ffi-node`) + `steam_api64.dll`
  loading conventions out of Tandemonium into here.
- Implement `SteamInputSource` producing `InputFrame` (buttons/axes/triggers from action
  data; `motion` from `GetMotionData`; identity from `GetInputTypeForHandle`/`controller_type`).
- Implement `GlyphProvider` (`getGlyphSVGForActionOrigin` + `getStringForActionOrigin`),
  with `re-query on binding/controller change`.
- Move IGA + `controller_<type>.vdf` authoring/validation tooling here; carry over
  `docs/steam-input.md` as the package runbook.
- **Exit:** package installable; `apps/overlay` can opt a controller into Steam Input and
  get identical visuals; absent package = no change to WebHID behavior.

### Phase 3 — Steam Deck built-in support *(the forced case)*
- Arbiter rule 2: detect Deck built-in (`controller_neptune`) and force `SteamInputSource`.
- Validate gyro via `GetMotionData` feeds the same `motion.quaternion` the fusion path
  produces (units! ⚠️ confirm deg/s+g vs rad/s+m/s² against your `isteaminput.h`).
- ⚠️ Confirm you can scope API usage to the Deck while desktop controllers stay in emulation
  (don't suppress the XInput pad globally).
- **Exit:** overlay + Tandemonium run on a physical Deck with working gyro on built-in controls.

### Phase 4 — Migrate Tandemonium onto the lab *(game)*
- Replace `js/input-manager.js` source-juggling + `electron/main.js` Steam tick with the
  lab arbiter + `@usersfirst/controller-steam`. Keep the motion-processing pipeline.
- Preserve the `forge.config.js` emulation-mode shipping decision (§5).
- Keep `tools/steam-controller-test` parity (or use the lab's graduated harness).
- **Exit:** Tandemonium's Steam release behaves as today (or better), with all Steam Input
  logic now reusable library code.

### Phase 5 — New Steam Controller (Triton) + opt-in Steam Input polish
- `devices.js`: confirm new SC VID/PID by enumeration (⚠️ community says `0x28de:0x1302`).
- Author `controller_triton.vdf` via Big Picture export (fallback `controller_neptune`).
- Optional: surface Steam glyphs in-game when a player chooses Steam Input; gyro-button /
  Flick Stick exposure for those who opt in.
- **Exit:** new Steam Controller works on both raw-HID (overlay visuals) and, when forced/
  opted, Steam Input paths.

---

## 8. Risks & open questions (verify before shipping)

| # | Risk / unknown | Confidence | How to resolve |
|---|---|---|---|
| 1 | WebHID behaves while Steam Input is active (Windows) — double-input / occlusion | ⚠️ undocumented | Empirical test via `steam-controller-test` harness: read both, observe. |
| 2 | Can API usage be scoped per-controller-type (Deck on API, desktop in emulation) without killing the XInput pad? | [M] | Real Deck + desktop DualSense, both connected, inspect `getControllers`/`getGamepads`. |
| 3 | `GetMotionData` units (deg/s+±2G vs rad/s+m/s²) | [M] | Read the exact `isteaminput.h` you ship; calibrate against known fusion output. |
| 4 | New Steam Controller `controller_triton` identifier + VID/PID/report layout | [M]/[L] | Enumerate hardware; export a config and read the filename Steam writes. Keep `neptune` fallback. |
| 5 | `steamworks-ffi-node` robustness with real controllers ("tested with virtual gamepad only") | [M]/[L] | Exercise on real hardware early; be ready to drop to raw `koffi`. |
| 6 | Identity dedup across sources (WebHID MAC vs Steam `controller_type`) reliable enough to prevent double-read | [M] | Build a dedup test with a controller visible in both sources simultaneously. |
| 7 | Multi-player local co-op across mixed sources (P1 WebHID DualSense, P2 Deck built-in) | [M] | Extend `Slot` claim logic to be source-aware; covered by Phase 1 arbiter + Phase 3. |

---

## 9. Design principles (the rules we don't break)

1. **WebHID is the spine.** `core` + `visualizer` + game logic never import Steam.
2. **One source per physical controller**, chosen by the arbiter; dedup by identity; never
   double-read.
3. **`@usersfirst/controller-steam` is optional.** Its absence degrades only Deck built-in
   gyro and Steam glyphs — nothing else.
4. **Emulation mode by default; native API only where forced.** Don't ship the IGA into the
   depot for the general case (it suppresses the XInput pad WebHID relies on).
5. **The lab is its own glyph authority** (visualizer profile labels + 3D models); Steam
   glyphs are a bonus, not a dependency.
6. **Steamworks SDK is never bundled or auto-downloaded** by the lab.
7. **Verify on real hardware** before trusting any ⚠️ item — especially the Deck and the new
   Steam Controller.

---

## Appendix A — Key references

- Valve: ISteamInput — https://partner.steamgames.com/doc/api/ISteamInput
- Valve: Action manifest — https://partner.steamgames.com/doc/features/steam_controller/action_manifest_file
- Valve: Gamepad emulation best practices — https://partner.steamgames.com/doc/features/steam_controller/steam_input_gamepad_emulation_bestpractices
- Deck kernel occlusion — https://github.com/libsdl-org/SDL/issues/9148 ; https://github.com/torvalds/linux/blob/master/drivers/hid/hid-steam.c
- `controller_triton` evidence — https://github.com/ValveSoftware/steam-for-linux/issues/13251
- New Steam Controller — https://en.wikipedia.org/wiki/Steam_Controller_(2nd_generation)
- Chromium WebHID (no gamepad blocklist) — https://developer.chrome.com/docs/capabilities/hid
- Node FFI: steamworks-ffi-node Input — https://github.com/ArtyProf/steamworks-ffi-node/blob/main/docs/INPUT_MANAGER.md
- GamepadMotionHelpers (our fusion source) — https://github.com/JibbSmart/GamepadMotionHelpers

## Appendix B — In-repo sources

- `tandemonium/docs/steam-input.md` — runbook (author/export/ship workflow, pitfalls)
- `tandemonium/docs/motion-controls-v2-analysis.md` — gyro tuning constants & rationale
- `tandemonium/forge.config.js` — the emulation-mode "don't ship IGA" decision (§5)
- `tandemonium/electron/main.js`, `js/input-manager.js` — current Steam Input integration
- `tandemonium/tools/steam-controller-test/` — multi-source diagnostic harness
- `tandemonium-controller-lab/packages/core/src/{manager,sensor-fusion,devices}.js`,
  `drivers/*` — the WebHID spine
- `tandemonium-controller-lab/packages/visualizer/src/controller-profiles.js` — glyph/label
  authority
