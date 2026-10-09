import { describe, expect, it } from "vitest";
import { Health } from "./Health";

describe("Health", () => {
  it("starts at the given max value", () => {
    // Arrange
    const health = new Health(30);

    // Act (no action, just reading initial state)

    // Assert
    expect(health.value).toBe(30);
    expect(health.isDead).toBe(false);
  });

  it("reduces value by the damage amount", () => {
    // Arrange
    const health = new Health(30);

    // Act
    health.takeDamage(10);

    // Assert
    expect(health.value).toBe(20);
    expect(health.isDead).toBe(false);
  });

  it("does not drop below zero", () => {
    // Arrange
    const health = new Health(10);

    // Act
    health.takeDamage(999);

    // Assert
    expect(health.value).toBe(0);
    expect(health.isDead).toBe(true);
  });

  it("ignores non-positive damage amounts", () => {
    // Arrange
    const health = new Health(10);

    // Act
    health.takeDamage(0);
    health.takeDamage(-5);

    // Assert
    expect(health.value).toBe(10);
  });

  it("restores to max on reset", () => {
    // Arrange
    const health = new Health(10);
    health.takeDamage(10);

    // Act
    health.reset();

    // Assert
    expect(health.value).toBe(10);
    expect(health.isDead).toBe(false);
  });

  it("raises current by the same amount on increaseMax", () => {
    // Arrange
    const health = new Health(100);
    health.takeDamage(40);

    // Act
    health.increaseMax(20);

    // Assert
    expect(health.value).toBe(80);
  });

  it("restores to the new (raised) max on reset after increaseMax", () => {
    // Arrange
    const health = new Health(100);

    // Act
    health.increaseMax(20);
    health.takeDamage(999);
    health.reset();

    // Assert
    expect(health.value).toBe(120);
  });

  it("ignores non-positive increaseMax amounts", () => {
    // Arrange
    const health = new Health(100);
    health.takeDamage(50);

    // Act
    health.increaseMax(0);
    health.increaseMax(-10);

    // Assert
    expect(health.value).toBe(50);
  });
});
