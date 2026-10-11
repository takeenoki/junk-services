export const PARAMETERS = Object.freeze({
  worldSize: 1000,
  // A leaf placed at the center takes about two hours to reach the right edge.
  flowSpeed: 500 / (2 * 60 * 60),
  drag: 0.8,
  rippleSpeed: 85,
  rippleLifetime: 9000,
  rippleForce: 100,
  step: 50,
  stoneCooldown: 5000,
  leafCooldown: 3600000,
  maxLeaves: 20,
});

function move(leaf, milliseconds) {
  const seconds = milliseconds / 1000;
  const decay = Math.exp(-PARAMETERS.drag * seconds);
  leaf.x += PARAMETERS.flowSpeed * seconds +
    (leaf.vx - PARAMETERS.flowSpeed) * (1 - decay) / PARAMETERS.drag;
  leaf.y += leaf.vy * (1 - decay) / PARAMETERS.drag;
  leaf.vx = PARAMETERS.flowSpeed + (leaf.vx - PARAMETERS.flowSpeed) * decay;
  leaf.vy *= decay;
  leaf.updatedAt += milliseconds;
}

// Only ripple interactions need small steps; quiet periods use exact drag integration.
export function advance(state, now) {
  for (const leaf of state.leaves) {
    while (leaf.updatedAt < now) {
      const active = state.ripples.filter(ripple =>
        ripple.createdAt <= leaf.updatedAt &&
        ripple.createdAt + PARAMETERS.rippleLifetime > leaf.updatedAt);
      const duration = active.length ? Math.min(PARAMETERS.step, now - leaf.updatedAt) :
        now - leaf.updatedAt;
      move(leaf, duration);
      for (const ripple of active) {
        if (ripple.hit.includes(leaf.id)) continue;
        const dx = leaf.x - ripple.x;
        const dy = leaf.y - ripple.y;
        const distance = Math.hypot(dx, dy);
        const age = leaf.updatedAt - ripple.createdAt;
        if (distance <= PARAMETERS.rippleSpeed * age / 1000) {
          const force = PARAMETERS.rippleForce * Math.max(0, 1 - age / PARAMETERS.rippleLifetime);
          leaf.vx += (distance ? dx / distance : 1) * force;
          leaf.vy += (distance ? dy / distance : 0) * force;
          ripple.hit.push(leaf.id);
        }
      }
      if (leaf.x < 0 || leaf.y < 0 || leaf.x > PARAMETERS.worldSize || leaf.y > PARAMETERS.worldSize) break;
    }
  }
  state.leaves = state.leaves.filter(leaf => leaf.x >= 0 && leaf.y >= 0 &&
    leaf.x <= PARAMETERS.worldSize && leaf.y <= PARAMETERS.worldSize);
  state.ripples = state.ripples.filter(ripple => ripple.createdAt + PARAMETERS.rippleLifetime > now);
}
