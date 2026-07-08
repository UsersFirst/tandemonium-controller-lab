// ============================================================
// isPresentableEntry / presentablePoolEntries — hide idle fan-out siblings
// ============================================================
//
// The single source of truth for the filter the overlay / multi / lobby
// controller lists share: a pooled Steam Puck receiver interface with no body
// streaming on it (fan-out driver + hidActiveSince === 0) is kept pooled so a
// later power-on is caught, but must NOT show as a phantom AVAILABLE row. A
// streaming Puck interface (a paired body) and any non-fan-out entry ARE
// presentable. See [[multi-steam-controller]].

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerManager, isPresentableEntry } from '../src/manager.js';

class FanoutDriver {}
FanoutDriver.needsSiblingFanout = true;
class PlainDriver {}

function entry({ fanout = false, streaming = false } = {}) {
  return { driver: fanout ? new FanoutDriver() : new PlainDriver(), hidActiveSince: streaming ? 1 : 0 };
}

test('isPresentableEntry: non-fan-out entries are always presentable', () => {
  assert.equal(isPresentableEntry(entry({ fanout: false, streaming: false })), true);
  assert.equal(isPresentableEntry(entry({ fanout: false, streaming: true })), true);
});

test('isPresentableEntry: a fan-out sibling is presentable ONLY while streaming', () => {
  assert.equal(isPresentableEntry(entry({ fanout: true, streaming: true })), true, 'paired body → shown');
  assert.equal(isPresentableEntry(entry({ fanout: true, streaming: false })), false, 'idle receiver iface → hidden');
});

test('isPresentableEntry: null/undefined is not presentable', () => {
  assert.equal(isPresentableEntry(null), false);
  assert.equal(isPresentableEntry(undefined), false);
});

test('presentablePoolEntries filters idle fan-out siblings but keeps streaming + non-fan-out', () => {
  const m = new ControllerManager({ slotIds: ['P1'] });
  const streamingPuck = entry({ fanout: true, streaming: true });
  const idlePuckA = entry({ fanout: true, streaming: false });
  const idlePuckB = entry({ fanout: true, streaming: false });
  const ds = entry({ fanout: false, streaming: false });
  m._hidPool.set({ id: 1 }, streamingPuck);
  m._hidPool.set({ id: 2 }, idlePuckA);
  m._hidPool.set({ id: 3 }, idlePuckB);
  m._hidPool.set({ id: 4 }, ds);

  const shown = m.presentablePoolEntries();
  assert.equal(shown.length, 2, 'the streaming Puck iface + the DualSense; both idle Puck siblings hidden');
  assert.ok(shown.includes(streamingPuck));
  assert.ok(shown.includes(ds));
  assert.ok(!shown.includes(idlePuckA) && !shown.includes(idlePuckB));
});
