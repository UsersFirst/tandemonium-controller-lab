// ============================================================
// INPUT ARBITER — WebHID-first multi-source selection
// ============================================================
//
// Composes N ControllerSources and, per PHYSICAL controller, decides which
// single source to read this tick — never two (that is the double-input
// failure mode the whole architecture exists to prevent). WebHID-first by
// default; Steam Input is forced only where raw HID is occluded (Steam Deck
// built-in controls) and otherwise opt-in via a per-controller preference.
//
// This is a thin coordinator on top of the existing ControllerManager (the
// manager remains the WebHID backend, wrapped by WebHIDSource). Keeping the
// arbiter separate makes the Steam adapter a true add-on: register the
// optional SteamInputSource and the arbiter starts considering it; omit it
// and nothing changes.
//
// Phase 1 scaffold (#80). The pure selection logic (dedup + chooseSource)
// is implemented and tested; live wiring notes are marked TODO(#80).
// ============================================================

import { identityMatchKey, chooseSource, SOURCE } from './input-frame.js';

export class InputArbiter {
  constructor(options = {}) {
    /** @type {import('./sources/base-source.js').ControllerSource[]} */
    this._sources = [];
    // Per-controller (keyed by identityMatchKey) source preference — the
    // library successor to Tandemonium's tandemonium_dualsense_source. A
    // value of SOURCE.STEAM_INPUT here is the "I want Steam Input for this
    // pad" opt-in. Seed via options.preferences (a plain object).
    this._preferences = new Map(Object.entries(options.preferences || {}));
    // Returns SOURCE.* | null for a controller that MUST use a given source
    // regardless of preference — e.g. () => isDeckBuiltin ? STEAM_INPUT : null.
    // Default: never force. The Steam package supplies the Deck detector.
    this._forcedSourceFor = options.forcedSourceFor || (() => null);
  }

  /** Register a source. WebHID should be added first (priority order is by SOURCE_PRIORITY, not registration). */
  addSource(source) {
    this._sources.push(source);
    return this;
  }

  start() { for (const s of this._sources) s.start?.(); }
  stop() { for (const s of this._sources) s.stop?.(); }

  /** Set/clear the preferred source for one controller (by its match key). */
  setPreference(matchKey, sourceId) {
    if (sourceId) this._preferences.set(matchKey, sourceId);
    else this._preferences.delete(matchKey);
  }

  /**
   * Resolve, for the current tick, exactly one InputFrame per physical
   * controller. Steps:
   *   1. Ask every source what it currently sees (list()).
   *   2. Group those across sources by identityMatchKey — this is the dedup
   *      that prevents reading the same DualSense via both WebHID and Steam
   *      Input. (Also catches phantom XInput pads, e.g. DS4Windows — see
   *      Tandemonium#35: the physical pad and its phantom share vid:pid.)
   *   3. For each group, chooseSource() WebHID-first (honoring force +
   *      preference), then read() only the winner.
   *
   * @returns {import('./input-frame.js').InputFrame[]} one frame per physical controller
   */
  resolve() {
    /** @type {Map<string, {available: Object, refs: Object}>} */
    const groups = new Map();
    for (const source of this._sources) {
      let seen;
      try { seen = source.list() || []; }
      catch (err) { console.warn(`[arbiter] ${source.id} list() threw`, err); continue; }
      for (const ctrl of seen) {
        const key = identityMatchKey(ctrl.identity);
        let g = groups.get(key);
        if (!g) { g = { available: {}, refs: {} }; groups.set(key, g); }
        g.available[source.id] = source;
        g.refs[source.id] = ctrl;
      }
    }

    const frames = [];
    for (const [key, g] of groups) {
      const chosen = chooseSource(g.available, {
        forced: this._forcedSourceFor(key, g),
        preference: this._preferences.get(key) || null,
      });
      if (!chosen) continue;
      const source = g.available[chosen];
      try {
        frames.push(source.read(g.refs[chosen]));
      } catch (err) {
        console.warn(`[arbiter] ${chosen} read() threw for ${key}`, err);
      }
    }
    return frames;
  }
}

export { SOURCE };
