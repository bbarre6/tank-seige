import { describe, expect, it } from "vitest";

describe("test environment", () => {
  it("runs AAA-style unit tests", () => {
    // Arrange
    const values = [1, 2, 3];

    // Act
    const sum = values.reduce((total, value) => total + value, 0);

    // Assert
    expect(sum).toBe(6);
  });
});
