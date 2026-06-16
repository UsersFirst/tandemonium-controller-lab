// ============================================================
// ROLL HUD WINDOW — detached lean/roll indicator (issue #64)
// ============================================================
//
// Mirrors the in-overlay Roll HUD (arc band + ticks + needle + lean arrows).
// The main overlay forwards {leanDeg, active, colors} each frame over IPC
// ('hud-state-update', kind 'roll'); the arc/needle math is copied from
// initGyroHud/updateGyroHud in app.js. Green-screen carries over (initial via
// the open query, live via broadcast).

const GYRO_HUD_MAX_DEG = 40; // ±40°, matches the main overlay

const arcBand = document.getElementById('arc-band');
const arcTicks = document.getElementById('arc-ticks');
const arcNeedle = document.getElementById('arc-needle');
const arrowLeft = document.getElementById('lean-arrow-left');
const arrowRight = document.getElementById('lean-arrow-right');

let leanColors = { normal: '#ffffff', mid: '#ffaa22', high: '#ff4444' };
function leanColor(t) {
  const abs = Math.min(1, Math.abs(t));
  if (abs < 0.5) return leanColors.normal;
  if (abs < 0.75) return leanColors.mid;
  return leanColors.high;
}

function initArc() {
  const R = 100, bandW = 10;
  const maxRad = GYRO_HUD_MAX_DEG * Math.PI / 180;
  const steps = 40;
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const a = -maxRad + (2 * maxRad * i / steps);
    d += (i === 0 ? 'M' : 'L') + (Math.sin(a) * (R - bandW / 2)).toFixed(2) + ',' + (-Math.cos(a) * (R - bandW / 2)).toFixed(2);
  }
  for (let i = steps; i >= 0; i--) {
    const a = -maxRad + (2 * maxRad * i / steps);
    d += 'L' + (Math.sin(a) * (R + bandW / 2)).toFixed(2) + ',' + (-Math.cos(a) * (R + bandW / 2)).toFixed(2);
  }
  d += 'Z';
  arcBand.setAttribute('d', d);

  let ticks = '';
  for (const pct of [0, 0.25, 0.5, 0.75, 1.0]) {
    for (const sign of (pct === 0 ? [1] : [-1, 1])) {
      const a = sign * pct * maxRad;
      const isMajor = pct === 0 || pct === 1.0;
      const inner = R - (isMajor ? 14 : 10), outer = R + (isMajor ? 14 : 10);
      ticks += `<line x1="${(Math.sin(a) * inner).toFixed(2)}" y1="${(-Math.cos(a) * inner).toFixed(2)}" x2="${(Math.sin(a) * outer).toFixed(2)}" y2="${(-Math.cos(a) * outer).toFixed(2)}" stroke-width="${isMajor ? 1.2 : 0.6}" opacity="${isMajor ? 0.5 : 0.25}"/>`;
    }
  }
  arcTicks.innerHTML = ticks;
}

function update(leanDeg) {
  const R = 100;
  const maxRad = GYRO_HUD_MAX_DEG * Math.PI / 180;
  const t = Math.max(-1, Math.min(1, leanDeg / GYRO_HUD_MAX_DEG));
  const absT = Math.abs(t);
  const needleAngle = t * maxRad;
  arcNeedle.setAttribute('x1', (Math.sin(needleAngle) * 4).toFixed(2));
  arcNeedle.setAttribute('y1', (-Math.cos(needleAngle) * 4).toFixed(2));
  arcNeedle.setAttribute('x2', (Math.sin(needleAngle) * (R - 2)).toFixed(2));
  arcNeedle.setAttribute('y2', (-Math.cos(needleAngle) * (R - 2)).toFixed(2));
  const color = leanColor(t);
  arcNeedle.setAttribute('stroke', color);
  arrowLeft.style.opacity = t < -0.05 ? Math.min(1, absT * 1.5) : 0.1;
  arrowLeft.style.color = t < -0.05 ? color : '#888';
  arrowRight.style.opacity = t > 0.05 ? Math.min(1, absT * 1.5) : 0.1;
  arrowRight.style.color = t > 0.05 ? color : '#888';
}

// Window chrome (drag / close / green-screen) is handled by hud-window-chrome.js.

initArc();
update(0);

if (window.electronAPI?.onHudState) {
  window.electronAPI.onHudState((s) => {
    if (!s) return;
    if (s.colors) leanColors = s.colors;
    update(s.active ? (s.leanDeg || 0) : 0);
  });
}
