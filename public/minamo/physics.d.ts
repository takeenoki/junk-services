export interface Leaf {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  createdAt: number;
  updatedAt: number;
}
export interface Ripple {
  id: string;
  x: number;
  y: number;
  createdAt: number;
  hit: string[];
}
export interface Surface { leaves: Leaf[]; ripples: Ripple[] }
export const PARAMETERS: Readonly<{
  worldSize: number; flowSpeed: number; drag: number; rippleSpeed: number;
  rippleLifetime: number; rippleForce: number; step: number;
  stoneCooldown: number; leafCooldown: number; maxLeaves: number;
}>;
export function advance(state: Surface, now: number): void;
