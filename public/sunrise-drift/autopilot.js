// Sunrise Drift autopilot (?auto, DESIGN.md §9) and the marker-bag ballistics (shared with the game).
import { windAt, PHYS } from "./balloon.js";

// a dropped marker: starts at the basket with the balloon's velocity, falls with drag, the ribbon drifts in the wind
export function makeMarker(b) { return { x: b.x, y: b.y, z: b.z + 0.6, vx: b.vx, vy: b.vy, vz: b.vz, landed: false, trail: [] }; }
export function stepMarker(m, dt, layers, groundH, t) {
  if (m.landed) return false;
  const [wx, wy] = windAt(layers, m.z, t);
  m.vz += (-9.81 - 0.045 * m.vz * Math.abs(m.vz)) * dt;
  m.vx += (wx * 0.35 - m.vx) * dt * 0.35; m.vy += (wy * 0.35 - m.vy) * dt * 0.35;
  m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
  const gz = groundH(m.x, m.y);
  if (m.z <= gz) { m.z = gz; m.landed = true; return true; }
  return false;
}
export function predictMarker(b, layers, groundH, t) {
  const m = makeMarker(b);
  for (let i = 0; i < 400 && !m.landed; i++) stepMarker(m, 0.05, layers, groundH, t);
  return m;
}

// returns { burn, vent, drop } for the current goal {x, y, kind: "target" | "land", r}
export function autopilot(b, goal, layers, t, groundH, st) {
  const dx = goal.x - b.x, dy = goal.y - b.y, dist = Math.hypot(dx, dy), ux = dx / (dist || 1), uy = dy / (dist || 1);
  const gz = groundH(b.x, b.y);
  let floor = gz + 25;
  for (let k = 1; k <= 6; k++) floor = Math.max(floor, groundH(b.x + b.vx * k * 6, b.y + b.vy * k * 6) + 28);
  let zt;
  // start the descent early enough that the drift during it ends inside the field; stay committed once started
  const hs = Math.max(0.4, Math.hypot(b.vx, b.vy));
  if (goal.kind === "land" && !st.landing && Math.max(0, dist - goal.r * 0.4) / hs < (b.z - gz) / 1.9 + 4) st.landing = true;
  if (st.landing && dist > goal.r * 2.5) st.landing = false;
  const landing = goal.kind === "land" && st.landing;
  if (landing) zt = gz - 5;
  else {
    // look ahead: for each candidate altitude, fly a kinematic path (climb/sink at 2 m/s, then hold) for 150 s
    // and keep the altitude whose path passes closest to the goal (re-planned every 2 s)
    if (st.planT === undefined || t - st.planT > 2 || st.planGoal !== goal) {
      let best = 1e9; st.zt = b.z; st.planT = t; st.planGoal = goal;
      for (let zc = Math.max(20, floor); zc <= 620; zc += 10) {
        let x = b.x, y = b.y, z = b.z, md = dist, mt = 0;
        for (let k = 1; k <= 75; k++) {
          z += Math.sign(zc - z) * Math.min(Math.abs(zc - z), 4);
          const [wx, wy] = windAt(layers, z, t + k * 2); x += wx * 2; y += wy * 2;
          const d = Math.hypot(goal.x - x, goal.y - y); if (d < md) { md = d; mt = k; }
        }
        const sc = md + mt * 0.15 + Math.abs(zc - b.z) * 0.02 + (goal.kind === "target" && md < 30 ? (zc - gz) * 0.05 : 0);
        if (sc < best) { best = sc; st.zt = zc; }
      }
    }
    zt = st.zt;
    zt = Math.max(zt, floor);
  }
  let vzDes = Math.max(-2.6, Math.min(2.6, (zt - b.z) * 0.04));
  if (landing && b.z - gz < 25) vzDes = -0.7;
  const P = PHYS;
  const Tneed = P.T_HOVER + (P.DRAG * vzDes * Math.abs(vzDes)) / P.K + (vzDes - b.vz) * 25;
  // lead the thermal lag: expected T drift over the next few seconds without burning
  const burn = b.T < Tneed - 1;
  const vent = b.T > Tneed + 18 && b.vz > vzDes + 0.4;
  let drop = false;
  if (goal.kind === "target" && dist < 90 && !st.dropCool) {
    const m = predictMarker(b, layers, groundH, t), md = Math.hypot(m.x - goal.x, m.y - goal.y);
    // drop when the predicted impact is close and getting no closer
    if (st.lastPred !== undefined && md < 48 && md >= st.lastPred - 0.02) drop = true;
    st.lastPred = md;
  }
  return { burn, vent, drop, zt };
}
