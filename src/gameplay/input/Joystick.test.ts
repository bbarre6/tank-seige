import { describe, expect, it } from "vitest";
import { Joystick } from "./Joystick";

describe("Joystick", () => {
  it("returns idle state before start() is called", () => {
    // Arrange
    const joystick = new Joystick(50);

    // Act
    const state = joystick.move({ x: 10, y: 10 });

    // Assert
    expect(state.magnitude).toBe(0);
    expect(state.vector).toEqual({ x: 0, y: 0 });
  });

  it("returns a proportional magnitude for a drag within the radius", () => {
    // Arrange
    const joystick = new Joystick(50);
    joystick.start({ x: 100, y: 100 });

    // Act
    const state = joystick.move({ x: 125, y: 100 }); // 25px right, half the radius

    // Assert
    expect(state.magnitude).toBeCloseTo(0.5);
    expect(state.vector.x).toBeCloseTo(1);
    expect(state.vector.y).toBeCloseTo(0);
  });

  it("clamps magnitude to 1 when the drag exceeds the radius", () => {
    // Arrange
    const joystick = new Joystick(50);
    joystick.start({ x: 100, y: 100 });

    // Act
    const state = joystick.move({ x: 100, y: 300 }); // 200px down, well past the radius

    // Assert
    expect(state.magnitude).toBe(1);
    expect(state.vector.x).toBeCloseTo(0);
    expect(state.vector.y).toBeCloseTo(1);
  });

  it("resets to idle state on end()", () => {
    // Arrange
    const joystick = new Joystick(50);
    joystick.start({ x: 0, y: 0 });
    joystick.move({ x: 20, y: 0 });

    // Act
    const state = joystick.end();

    // Assert
    expect(state.magnitude).toBe(0);
    expect(joystick.active).toBe(false);
  });
});
