/**
 * Pure geometry for arranging multiple player turrets (one per Fire Rate
 * upgrade level, see US-1.4) side by side, perpendicular to the tank's aim
 * direction, symmetric around the hull's center.
 */

/** Lateral offsets (in world units, perpendicular to facing) for `count` turrets spaced `spacing` apart, centered on 0. */
export function turretOffsets(count: number, spacing: number): number[] {
  if (count <= 0) return [];
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    offsets.push((i - (count - 1) / 2) * spacing);
  }
  return offsets;
}

/** The world-space position for one turret: tank position shifted sideways (perpendicular to facing) by `offset`. */
export function turretPosition(
  tank: { x: number; y: number },
  facing: { x: number; y: number },
  offset: number
): { x: number; y: number } {
  const perpX = -facing.y;
  const perpY = facing.x;
  return { x: tank.x + perpX * offset, y: tank.y + perpY * offset };
}
