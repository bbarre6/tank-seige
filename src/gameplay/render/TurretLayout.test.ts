import { describe, expect, it } from "vitest";
import { turretOffsets, turretPosition } from "./TurretLayout";

describe("turretOffsets", () => {
  it("returns a single centered offset for one turret", () => {
    // Arrange / Act
    const offsets = turretOffsets(1, 10);

    // Assert
    expect(offsets).toEqual([0]);
  });

  it("returns a symmetric pair for two turrets", () => {
    // Arrange / Act
    const offsets = turretOffsets(2, 10);

    // Assert
    expect(offsets).toEqual([-5, 5]);
  });

  it("centers one turret at 0 among an odd count", () => {
    // Arrange / Act
    const offsets = turretOffsets(5, 10);

    // Assert
    expect(offsets).toEqual([-20, -10, 0, 10, 20]);
  });

  it("returns an empty array for a non-positive count", () => {
    // Arrange / Act / Assert
    expect(turretOffsets(0, 10)).toEqual([]);
    expect(turretOffsets(-3, 10)).toEqual([]);
  });
});

describe("turretPosition", () => {
  it("returns the tank's own position for an offset of 0", () => {
    // Arrange
    const tank = { x: 100, y: 200 };
    const facing = { x: 1, y: 0 };

    // Act
    const pos = turretPosition(tank, facing, 0);

    // Assert
    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it("offsets perpendicular to a rightward facing direction", () => {
    // Arrange
    const tank = { x: 0, y: 0 };
    const facing = { x: 1, y: 0 }; // facing +x -> perpendicular is +y

    // Act
    const pos = turretPosition(tank, facing, 10);

    // Assert
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(10);
  });

  it("offsets perpendicular to an upward facing direction", () => {
    // Arrange
    const tank = { x: 0, y: 0 };
    const facing = { x: 0, y: -1 }; // facing up -> perpendicular is +x

    // Act
    const pos = turretPosition(tank, facing, 10);

    // Assert
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(0);
  });
});
