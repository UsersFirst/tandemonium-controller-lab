// ============================================================
// SwitchProDriver.parseReport — button / stick / trigger mapping
// ============================================================
//
// Locks the report 0x30 button+stick decode added for the WebHID-first path
// (previously the Switch Pro's inputs came ONLY from the Gamepad API, leaving an
// all-WebHID session gyro-only). Nintendo's rotated face layout maps into the
// standard cross/circle/square/triangle slots — a bit-swap regression trips here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SwitchProDriver } from '../src/drivers/switch-pro-driver.js';

const approx = (a, b, eps = 0.02) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const drv = () => new SwitchProDriver({ opened: true, collections: [] }, 'usb', null);

// Build a report 0x30 DataView (excludes the report id). 48 bytes = BT size.
function build0x30({ b2 = 0, b3 = 0, b4 = 0, ls = [0x800, 0x800], rs = [0x800, 0x800] } = {}) {
  const buf = new Uint8Array(48);
  buf[2] = b2; buf[3] = b3; buf[4] = b4;
  const pack = (o, x, y) => {
    buf[o] = x & 0xFF;
    buf[o + 1] = ((x >> 8) & 0x0F) | ((y & 0x0F) << 4);
    buf[o + 2] = (y >> 4) & 0xFF;
  };
  pack(5, ls[0], ls[1]);
  pack(8, rs[0], rs[1]);
  return new DataView(buf.buffer);
}

test('Switch Pro: Nintendo face layout → standard slots (B=cross, A=circle, Y=square, X=triangle)', () => {
  const d = drv();
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x04 })).buttons.cross, true);    // B → bottom
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x08 })).buttons.circle, true);   // A → right
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x01 })).buttons.square, true);   // Y → left
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x02 })).buttons.triangle, true); // X → top
  // A pressed must NOT also flag cross (the classic Nintendo swap bug).
  const a = d.parseReport(0x30, build0x30({ b2: 0x08 }));
  assert.equal(a.buttons.cross, false);
});

test('Switch Pro: shoulders, ZL/ZR digital triggers, system + dpad', () => {
  const d = drv();
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x40 })).buttons.r1, true);  // R
  assert.equal(d.parseReport(0x30, build0x30({ b4: 0x40 })).buttons.l1, true);  // L
  assert.equal(d.parseReport(0x30, build0x30({ b2: 0x80 })).triggers.r2, 1);    // ZR digital
  assert.equal(d.parseReport(0x30, build0x30({ b4: 0x80 })).triggers.l2, 1);    // ZL digital
  assert.equal(d.parseReport(0x30, build0x30({ b3: 0x10 })).buttons.ps, true);       // Home
  assert.equal(d.parseReport(0x30, build0x30({ b3: 0x01 })).buttons.create, true);   // Minus
  assert.equal(d.parseReport(0x30, build0x30({ b3: 0x02 })).buttons.options, true);  // Plus
  assert.equal(d.parseReport(0x30, build0x30({ b3: 0x08 })).buttons.l3, true);       // L-stick
  assert.equal(d.parseReport(0x30, build0x30({ b3: 0x04 })).buttons.r3, true);       // R-stick
  assert.equal(d.parseReport(0x30, build0x30({ b4: 0x02 })).buttons.dpadUp, true);
  assert.equal(d.parseReport(0x30, build0x30({ b4: 0x01 })).buttons.dpadDown, true);
});

test('Switch Pro: sticks normalize to [-1,1] with Gamepad-API Y inversion', () => {
  const d = drv();
  const center = d.parseReport(0x30, build0x30({ ls: [0x800, 0x800], rs: [0x800, 0x800] }));
  approx(center.sticks.lx, 0); approx(center.sticks.ly, 0);
  approx(center.sticks.rx, 0); approx(center.sticks.ry, 0);
  // Left stick physical X full → +1; physical Y full → ly negated to -1.
  const pushed = d.parseReport(0x30, build0x30({ ls: [0x800 + 0x5A8, 0x800 + 0x5A8] }));
  approx(pushed.sticks.lx, 1);
  approx(pushed.sticks.ly, -1);
});
