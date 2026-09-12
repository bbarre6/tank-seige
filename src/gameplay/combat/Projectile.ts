import type { Vector2 } from "../input/Joystick";

export interface ProjectileSpawn {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  damage: number;
}

/**
 * Turns a tank's position + normalized aim direction into a projectile
 * descriptor (AC-1.1.2). Pure so the math can be unit tested without a
 * running Phaser scene.
 */
export function spawnProjectile(
  origin: Vector2,
  aimDirection: Vector2,
  speed: number,
  damage: number
): ProjectileSpawn {
  return {
    x: origin.x,
    y: origin.y,
    velocityX: aimDirection.x * speed,
    velocityY: aimDirection.y * speed,
    damage,
  };
}
