import { describe, expect, it } from "vitest";
import { MOOD_NAMES } from "./ConnectomeBrain";
import { pickChatLine, type ChatEventType } from "./EnemyChat";

const EVENT_TYPES: ChatEventType[] = ["hit", "miss", "spawn", "death", "idle"];

describe("pickChatLine", () => {
  for (const eventType of EVENT_TYPES) {
    for (const mood of MOOD_NAMES) {
      it(`returns a non-empty English line for (${eventType}, ${mood})`, () => {
        // Arrange / Act
        const line = pickChatLine(eventType, mood);

        // Assert
        expect(typeof line).toBe("string");
        expect(line.length).toBeGreaterThan(0);
      });
    }
  }

  it("uses the injected rng to pick a deterministic index", () => {
    // Arrange: rng() = 0 always picks index 0 of the pool
    const first = pickChatLine("hit", "confident", () => 0);

    // Act / Assert
    expect(first).toBe("Got you!");
  });

  it("picks the last line when rng approaches 1", () => {
    // Arrange / Act
    const last = pickChatLine("hit", "confident", () => 0.999);

    // Assert
    expect(last).toBe("Too easy.");
  });
});
