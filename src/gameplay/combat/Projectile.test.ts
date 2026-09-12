import { describe, expect, it } from "vitest";
import { spawnProjectile } from "./Projectile";

describe("spawnProjectile", () => {
  it("spawns at the tank's origin position", () => {
    // Arrange
    const origin = { x: 10, y: 20 };
    const aim = { x: 1, y: 0 };

    // Act
    const projectile = spawnProjectile(origin, aim, 300, 10);

    // Assert
    expect(projectile.x).toBe(10);
    expect(projectile.y).toBe(20);
  });

  it("scales velocity by the aim direction and the given speed", () => {
    // Arrange
    const origin = { x: 0, y: 0 };
    const aim = { x: 0, y: -1 }; // aiming straight up

    // Act
    const projectile = spawnProjectile(origin, aim, 500, 10);

    // Assert
    expect(projectile.velocityX).toBe(0);
    expect(projectile.velocityY).toBe(-500);
  });

  it("carries the given damage value", () => {
    // Arrange
    const origin = { x: 0, y: 0 };
    const aim = { x: 1, y: 0 };

    // Act
    const projectile = spawnProjectile(origin, aim, 300, 25);

    // Assert
    expect(projectile.damage).toBe(25);
  });
});
