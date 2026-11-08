// ============================================================
// fake-gamepads — a scripted Gamepad API for the core tests
// ============================================================
//
// Ported from Tandemonium's scripts/lib/fake-gamepads.mjs, plus the two
// Chromium behaviours the TV playtests (Tandemonium #581) ran into:
//
//   hidden  — Chromium reveals a pad only after its first button press, so a
//             pad plugged with { hidden: true } is absent from snapshot()
//             until something presses it (pad counts drift exactly while
//             players press A/B).
//   frozen  — a DualSense listed from its compat-mode (0x01) reports, then
//             switched to full reports (0x31) by the WebHID driver: Chromium
//             keeps listing it but it never changes again. freeze(i) makes
//             every later hold/stick on it a no-op.
//
// Steam's virtual XInput twin of a captured controller is just a pad with the
// XInput id (PAD_IDS.xbox); a test presses it a few ms after (or before) the
// hardware, which is what Steam does.
//
//   const pads = new FakeGamepads();
//   const i = pads.plug('dualsense');
//   pads.hold(i, 'A', true);
//   pads.snapshot();            // what navigator.getGamepads() returns

/** Chrome's Gamepad.id for each model. */
export const PAD_IDS = {
  xbox: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)',
  dualsense: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
  ds4: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  ds4v1: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 05c4)',
  switchpro: 'Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)',
  generic: 'Some Pad (Vendor: 1234 Product: 5678)',
};

/** Standard-mapping button indices. */
export const BUTTONS = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9,
  LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
};
export const AXES = { LX: 0, LY: 1, RX: 2, RY: 3 };

const btn = () => ({ pressed: false, touched: false, value: 0 });

export class FakeGamepads {
  constructor({ now = () => performance.now() } = {}) {
    this.slots = [null, null, null, null];
    this.parked = {};
    this._now = now;
  }

  plug(model, { index = null, hidden = false } = {}) {
    const id = PAD_IDS[model] || model;
    const i = index != null ? index : this.slots.findIndex((s) => s === null);
    if (i < 0) throw new Error('fake gamepads: all 4 slots full');
    this.slots[i] = {
      id, index: i, connected: true, mapping: 'standard', timestamp: this._now(),
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn),
      _hidden: !!hidden, _frozen: false,
    };
    return i;
  }
  unplug(i) {
    const p = this.slots[i]; if (!p) return false;
    p.connected = false; this.parked[i] = p; this.slots[i] = null;
    return true;
  }
  replug(i) {
    const p = this.parked[i]; if (!p || this.slots[i]) return false;
    p.connected = true; p._frozen = false;
    p.buttons.forEach((b) => { b.pressed = false; b.value = 0; });
    p.axes.fill(0); p.timestamp = this._now();
    this.slots[i] = p; delete this.parked[i];
    return true;
  }
  hold(i, name, down) {
    const p = this.slots[i]; if (!p || p._frozen) return false;
    const b = p.buttons[typeof name === 'number' ? name : BUTTONS[name]];
    b.pressed = !!down; b.touched = !!down; b.value = down ? 1 : 0;
    if (down) p._hidden = false;   // Chromium reveals the pad on its first press
    p.timestamp = this._now();
    return true;
  }
  stick(i, axis, v) {
    const p = this.slots[i]; if (!p || p._frozen) return false;
    p.axes[typeof axis === 'number' ? axis : AXES[axis]] = v;
    p.timestamp = this._now();
    return true;
  }
  /** Chromium stops updating this entry but keeps listing it (DualSense switched to 0x31). */
  freeze(i) { const p = this.slots[i]; if (!p) return false; p._frozen = true; return true; }

  /** navigator.getGamepads(): hidden pads read as null slots. */
  snapshot() { return this.slots.map((p) => (p && !p._hidden ? p : null)); }
}
