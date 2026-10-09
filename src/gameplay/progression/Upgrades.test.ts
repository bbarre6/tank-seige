import { describe, expect, it } from "vitest";
import { UPGRADE_DEFS, costForNextLevel, defaultUpgradeLevels, parseUpgradeLevels, valueAtLevel } from "./Upgrades";

describe("costForNextLevel", () => {
  it("returns the base cost at level 0", () => {
    // Arrange
    const def = UPGRADE_DEFS.damage;

    // Act
    const cost = costForNextLevel(def, 0);

    // Assert
    expect(cost).toBe(def.baseCost);
  });

  it("grows the cost geometrically with owned levels", () => {
    // Arrange
    const def = UPGRADE_DEFS.damage;

    // Act
    const cost = costForNextLevel(def, 2);

    // Assert
    expect(cost).toBe(Math.round(def.baseCost * Math.pow(def.costGrowth, 2)));
  });

  it("returns null once the upgrade is maxed out", () => {
    // Arrange
    const def = UPGRADE_DEFS.damage;

    // Act
    const cost = costForNextLevel(def, def.maxLevel);

    // Assert
    expect(cost).toBeNull();
  });
});

describe("valueAtLevel", () => {
  it("returns the base value at level 0", () => {
    // Arrange / Act
    const value = valueAtLevel(100, 20, 0);

    // Assert
    expect(value).toBe(100);
  });

  it("adds perLevel for each owned level", () => {
    // Arrange / Act
    const value = valueAtLevel(100, 20, 3);

    // Assert
    expect(value).toBe(160);
  });

  it("supports a negative perLevel (e.g. cooldown reduction)", () => {
    // Arrange / Act
    const value = valueAtLevel(200, -20, 5);

    // Assert
    expect(value).toBe(100);
  });
});

describe("parseUpgradeLevels", () => {
  it("returns all-zero levels when nothing was saved", () => {
    // Arrange / Act
    const levels = parseUpgradeLevels(null);

    // Assert
    expect(levels).toEqual(defaultUpgradeLevels());
  });

  it("restores previously saved levels", () => {
    // Arrange
    const raw = JSON.stringify({ damage: 2, fireRate: 1, moveSpeed: 0, maxHealth: 3 });

    // Act
    const levels = parseUpgradeLevels(raw);

    // Assert
    expect(levels).toEqual({ damage: 2, fireRate: 1, moveSpeed: 0, maxHealth: 3 });
  });

  it("falls back to 0 for a level above that upgrade's max", () => {
    // Arrange
    const raw = JSON.stringify({ damage: 999, fireRate: 0, moveSpeed: 0, maxHealth: 0 });

    // Act
    const levels = parseUpgradeLevels(raw);

    // Assert
    expect(levels.damage).toBe(0);
  });

  it("falls back to all-zero levels for malformed JSON", () => {
    // Arrange / Act
    const levels = parseUpgradeLevels("{not valid json");

    // Assert
    expect(levels).toEqual(defaultUpgradeLevels());
  });

  it("ignores unknown keys and fills in defaults for missing ones", () => {
    // Arrange
    const raw = JSON.stringify({ damage: 1, somethingElse: 5 });

    // Act
    const levels = parseUpgradeLevels(raw);

    // Assert
    expect(levels).toEqual({ damage: 1, fireRate: 0, moveSpeed: 0, maxHealth: 0 });
  });
});
