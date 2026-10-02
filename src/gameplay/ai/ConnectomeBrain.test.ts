import { describe, expect, it } from "vitest";
import {
  BRAIN_HIDDEN_SIZE,
  BRAIN_INPUT_SIZE,
  BRAIN_OUTPUT_SIZE,
  ConnectomeBrain,
  buildEnemyBrainInputs,
  type SerializedBrainWeights,
} from "./ConnectomeBrain";

/** A constant-0.5 rng makes every `(rng()*2-1)*range` draw exactly 0, eliminating randomness. */
const NO_RANDOMNESS_RNG = () => 0.5;

function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const value = values[i % values.length];
    i++;
    return value;
  };
}

function zeroWeights(): SerializedBrainWeights {
  return {
    w1: new Array(BRAIN_HIDDEN_SIZE * BRAIN_INPUT_SIZE).fill(0),
    b1: new Array(BRAIN_HIDDEN_SIZE).fill(0),
    w2: new Array(BRAIN_OUTPUT_SIZE * BRAIN_HIDDEN_SIZE).fill(0),
    b2: new Array(BRAIN_OUTPUT_SIZE).fill(0),
  };
}

describe("ConnectomeBrain", () => {
  it("decide() returns finite, unit-length-or-zero move/aim vectors", () => {
    // Arrange
    const brain = ConnectomeBrain.createRandom(NO_RANDOMNESS_RNG);
    const inputs = new Float32Array(BRAIN_INPUT_SIZE).fill(0.4);

    // Act
    const { move, aim } = brain.decide(inputs);

    // Assert
    for (const v of [move.x, move.y, aim.x, aim.y]) expect(Number.isFinite(v)).toBe(true);
    const moveLength = Math.hypot(move.x, move.y);
    const aimLength = Math.hypot(aim.x, aim.y);
    expect(moveLength === 0 || Math.abs(moveLength - 1) < 1e-5).toBe(true);
    expect(aimLength === 0 || Math.abs(aimLength - 1) < 1e-5).toBe(true);
  });

  it("keeps outputs bounded and finite even with extreme deserialized weights", () => {
    // Arrange
    const huge: SerializedBrainWeights = {
      w1: new Array(BRAIN_HIDDEN_SIZE * BRAIN_INPUT_SIZE).fill(999),
      b1: new Array(BRAIN_HIDDEN_SIZE).fill(999),
      w2: new Array(BRAIN_OUTPUT_SIZE * BRAIN_HIDDEN_SIZE).fill(999),
      b2: new Array(BRAIN_OUTPUT_SIZE).fill(999),
    };
    const brain = ConnectomeBrain.deserialize(huge, NO_RANDOMNESS_RNG);
    expect(brain).not.toBeNull();

    // Act
    const { move, aim } = brain!.decide(new Float32Array(BRAIN_INPUT_SIZE).fill(1));

    // Assert
    for (const v of [move.x, move.y, aim.x, aim.y]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it("a fresh, untrained brain's mean output already approximates approach-and-aim-at-player", () => {
    // Arrange: player is far away and due east -- today's heuristic would both move toward
    // and aim toward it. Using the no-randomness rng isolates the deliberate bias wiring.
    const brain = ConnectomeBrain.createRandom(NO_RANDOMNESS_RNG);
    const inputs = buildEnemyBrainInputs({
      toPlayer: { x: 1, y: 0 },
      distance: 600,
      preferredDistance: 260,
      playerVelocity: { x: 0, y: 0 },
      enemyVelocity: { x: 0, y: 0 },
      maxPlayerSpeed: 220,
      maxEnemySpeed: 100,
    });

    // Act
    const { trace } = brain.decide(inputs);

    // Assert: mean[0]=moveX, mean[2]=aimX should both be strongly positive (toward the player)
    expect(trace.mean[0]).toBeGreaterThan(0.5);
    expect(trace.mean[2]).toBeGreaterThan(0.5);
  });

  it("a positive reward shifts the policy mean toward the sampled action", () => {
    // Arrange: zero weights -> mean is always 0 regardless of input; a fixed non-zero-noise
    // rng gives a known, identical sample on every output component.
    const brain = ConnectomeBrain.deserialize(zeroWeights(), sequenceRng([0.5, 0]))!;
    const inputs = new Float32Array(BRAIN_INPUT_SIZE);
    const { trace } = brain.decide(inputs);
    expect(trace.sample.every((s) => s > 0)).toBe(true); // sanity: the fixed rng did produce positive noise

    // Act
    brain.reinforce(1, trace);
    const zeroNoiseRng = sequenceRng([0.5, 0.25]); // z = 0, so the next decide() reveals the mean directly
    const after = ConnectomeBrain.deserialize(brain.serialize(), zeroNoiseRng)!;
    const { mean } = after.decide(inputs).trace;

    // Assert: the mean moved toward the positive sample that earned the positive reward
    for (const m of mean) expect(m).toBeGreaterThan(0);
  });

  it("a negative reward shifts the policy mean away from the sampled action", () => {
    // Arrange (mirrors the positive-reward test above)
    const brain = ConnectomeBrain.deserialize(zeroWeights(), sequenceRng([0.5, 0]))!;
    const inputs = new Float32Array(BRAIN_INPUT_SIZE);
    const { trace } = brain.decide(inputs);

    // Act
    brain.reinforce(-1, trace);
    const zeroNoiseRng = sequenceRng([0.5, 0.25]);
    const after = ConnectomeBrain.deserialize(brain.serialize(), zeroNoiseRng)!;
    const { mean } = after.decide(inputs).trace;

    // Assert: the mean moved away from the positive sample that earned the negative reward
    for (const m of mean) expect(m).toBeLessThan(0);
  });

  it("reinforce() with no trace argument defaults to the most recent decide() call", () => {
    // Arrange
    const brain = ConnectomeBrain.deserialize(zeroWeights(), sequenceRng([0.5, 0]))!;
    const inputs = new Float32Array(BRAIN_INPUT_SIZE);
    brain.decide(inputs);

    // Act
    brain.reinforce(1);
    const after = ConnectomeBrain.deserialize(brain.serialize(), sequenceRng([0.5, 0.25]))!;
    const { mean } = after.decide(inputs).trace;

    // Assert
    for (const m of mean) expect(m).toBeGreaterThan(0);
  });

  it("weights stay within the clamp after many large-reward updates", () => {
    // Arrange
    const brain = ConnectomeBrain.createRandom(sequenceRng([0.5, 0.1, 0.9, 0.3]));
    const inputs = new Float32Array(BRAIN_INPUT_SIZE).fill(0.5);

    // Act
    for (let i = 0; i < 200; i++) {
      const { trace } = brain.decide(inputs);
      brain.reinforce(1000, trace);
    }

    // Assert
    const { w1, b1, w2, b2 } = brain.serialize();
    for (const value of [...w1, ...b1, ...w2, ...b2]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(5);
    }
  });

  it("serialize()/deserialize() round-trips the exact weights", () => {
    // Arrange
    const brain = ConnectomeBrain.createRandom(sequenceRng([0.1, 0.9, 0.3, 0.7]));
    const serialized = brain.serialize();

    // Act
    const restored = ConnectomeBrain.deserialize(serialized);

    // Assert
    expect(restored).not.toBeNull();
    expect(restored!.serialize()).toEqual(serialized);
  });

  it("deserialize() returns null for mismatched array lengths", () => {
    // Arrange
    const malformed = { w1: [0], b1: [], w2: [], b2: [] } as unknown as SerializedBrainWeights;

    // Act
    const result = ConnectomeBrain.deserialize(malformed);

    // Assert
    expect(result).toBeNull();
  });
});

describe("buildEnemyBrainInputs", () => {
  it("defaults velocity-direction terms to zero when the underlying speed is zero", () => {
    // Arrange / Act
    const inputs = buildEnemyBrainInputs({
      toPlayer: { x: 1, y: 0 },
      distance: 100,
      preferredDistance: 260,
      playerVelocity: { x: 0, y: 0 },
      enemyVelocity: { x: 0, y: 0 },
      maxPlayerSpeed: 220,
      maxEnemySpeed: 100,
    });

    // Assert
    expect(inputs[4]).toBe(0);
    expect(inputs[5]).toBe(0);
    expect(inputs[7]).toBe(0);
    expect(inputs[8]).toBe(0);
  });

  it("clamps the distance-delta and move-bias terms to [-1, 1] far beyond the preferred range", () => {
    // Arrange / Act
    const inputs = buildEnemyBrainInputs({
      toPlayer: { x: 1, y: 0 },
      distance: 10_000,
      preferredDistance: 260,
      playerVelocity: { x: 0, y: 0 },
      enemyVelocity: { x: 0, y: 0 },
      maxPlayerSpeed: 220,
      maxEnemySpeed: 100,
    });

    // Assert
    expect(inputs[3]).toBe(1); // distDelta
    expect(inputs[10]).toBe(1); // moveBiasX = distDelta * ux
    expect(inputs[11]).toBe(0); // moveBiasY = distDelta * uy
  });
});
