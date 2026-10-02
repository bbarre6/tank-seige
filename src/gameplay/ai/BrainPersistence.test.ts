import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBrainBaseline, saveBrainBaseline, type StoredBrainBaseline } from "./BrainPersistence";
import { BRAIN_HIDDEN_SIZE, BRAIN_INPUT_SIZE, BRAIN_MOOD_COUNT, BRAIN_OUTPUT_SIZE, type SerializedBrainWeights } from "./ConnectomeBrain";

function fakeWeights(): SerializedBrainWeights {
  return {
    w1: new Array(BRAIN_HIDDEN_SIZE * BRAIN_INPUT_SIZE).fill(0.1),
    b1: new Array(BRAIN_HIDDEN_SIZE).fill(0.1),
    w2: new Array(BRAIN_OUTPUT_SIZE * BRAIN_HIDDEN_SIZE).fill(0.1),
    b2: new Array(BRAIN_OUTPUT_SIZE).fill(0.1),
    w2b: new Array(BRAIN_MOOD_COUNT * BRAIN_HIDDEN_SIZE).fill(0.1),
    b2b: new Array(BRAIN_MOOD_COUNT).fill(0.1),
  };
}

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadBrainBaseline / saveBrainBaseline", () => {
  it("returns null when nothing is stored", () => {
    // Arrange
    stubLocalStorage();

    // Act / Assert
    expect(loadBrainBaseline()).toBeNull();
  });

  it("round-trips a saved baseline exactly", () => {
    // Arrange
    stubLocalStorage();
    const baseline: StoredBrainBaseline = { weights: fakeWeights(), score: 4.5 };

    // Act
    saveBrainBaseline(baseline);
    const loaded = loadBrainBaseline();

    // Assert
    expect(loaded).toEqual(baseline);
  });

  it("returns null (never throws) when localStorage.getItem throws", () => {
    // Arrange
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("storage disabled");
        },
      },
    });

    // Act / Assert
    expect(() => loadBrainBaseline()).not.toThrow();
    expect(loadBrainBaseline()).toBeNull();
  });

  it("swallows errors when localStorage.setItem throws", () => {
    // Arrange
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new Error("storage disabled");
        },
      },
    });

    // Act / Assert
    expect(() => saveBrainBaseline({ weights: fakeWeights(), score: 1 })).not.toThrow();
  });

  it("returns null for malformed JSON", () => {
    // Arrange
    const store = stubLocalStorage();
    store.set("tank-siege:enemyBrainBaseline", "{not json");

    // Act / Assert
    expect(loadBrainBaseline()).toBeNull();
  });

  it("returns null when a stored baseline's weight arrays don't match the current architecture size", () => {
    // Arrange
    const store = stubLocalStorage();
    const mismatched = { weights: { w1: [0.1], b1: [], w2: [], b2: [] }, score: 1 };
    store.set("tank-siege:enemyBrainBaseline", JSON.stringify(mismatched));

    // Act / Assert
    expect(loadBrainBaseline()).toBeNull();
  });
});
