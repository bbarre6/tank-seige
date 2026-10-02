import type { Vector2 } from "../input/Joystick";

export const BRAIN_INPUT_SIZE = 12;
export const BRAIN_HIDDEN_SIZE = 12;
export const BRAIN_OUTPUT_SIZE = 4; // moveX, moveY, aimX, aimY
export const BRAIN_MOOD_COUNT = 4;
export const MOOD_NAMES = ["confident", "mocking", "frustrated", "determined"] as const;
export type MoodName = (typeof MOOD_NAMES)[number];

const WEIGHT_INIT_RANGE = 0.3; // keeps a fresh brain's tanh units un-saturated at birth
const WEIGHT_CLAMP = 5; // hard ceiling against runaway growth from many online updates
const EXPLORATION_STDDEV = 0.25; // Gaussian noise sigma added to each output for exploration
const NOISE_CLAMP_SIGMAS = 3;
const LEARNING_RATE = 0.05;

// Strong hand-picked weight so a brand-new, untrained brain already
// approximates today's chase-and-shoot heuristic (see applyAggressionBias)
// instead of starting as unrefined random noise.
const AGGRESSION_BIAS_WEIGHT = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function randomInRange(rng: () => number, range: number): number {
  return (rng() * 2 - 1) * range;
}

function randomArray(length: number, rng: () => number, range: number): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) arr[i] = randomInRange(rng, range);
  return arr;
}

/** Box–Muller transform: one standard-normal sample from two uniform ones. */
function sampleStandardNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9); // avoid log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function normalizeOrNull(x: number, y: number): Vector2 | null {
  const length = Math.hypot(x, y);
  return length > 1e-6 ? { x: x / length, y: y / length } : null;
}

export interface SerializedBrainWeights {
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number[];
  w2b: number[];
  b2b: number[];
}

function isFiniteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

/** Shared shape/finiteness check, used both for deserializing a brain and validating a persisted baseline. */
export function isValidSerializedWeights(value: unknown): value is SerializedBrainWeights {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SerializedBrainWeights>;
  return (
    isFiniteArray(data.w1, BRAIN_HIDDEN_SIZE * BRAIN_INPUT_SIZE) &&
    isFiniteArray(data.b1, BRAIN_HIDDEN_SIZE) &&
    isFiniteArray(data.w2, BRAIN_OUTPUT_SIZE * BRAIN_HIDDEN_SIZE) &&
    isFiniteArray(data.b2, BRAIN_OUTPUT_SIZE) &&
    isFiniteArray(data.w2b, BRAIN_MOOD_COUNT * BRAIN_HIDDEN_SIZE) &&
    isFiniteArray(data.b2b, BRAIN_MOOD_COUNT)
  );
}

/**
 * Inputs the brain senses each decision -- loosely themed as a simplified,
 * fly-visual-system-inspired feature set (relative position/motion, akin to
 * optic-flow/motion-detector neurons), NOT real connectome data.
 */
export interface BrainInputParams {
  toPlayer: Vector2; // unit vector, enemy -> player
  distance: number;
  preferredDistance: number;
  playerVelocity: Vector2;
  enemyVelocity: Vector2;
  maxPlayerSpeed: number;
  maxEnemySpeed: number;
}

/**
 * Builds the 12-float input vector. Indices 10/11 ("moveBias") precompute
 * `distDelta * toPlayer`, i.e. the direction today's heuristic AI would
 * move in (toward the player when too far, away when too close) -- see
 * ConnectomeBrain.createRandom's aggression-bias wiring, which gives this
 * feature a direct pass-through to the move output.
 */
export function buildEnemyBrainInputs(p: BrainInputParams): Float32Array {
  const out = new Float32Array(BRAIN_INPUT_SIZE);

  out[0] = p.toPlayer.x;
  out[1] = p.toPlayer.y;
  out[2] = clamp(p.distance / (p.preferredDistance * 3), 0, 1);
  const distDelta = clamp((p.distance - p.preferredDistance) / p.preferredDistance, -1, 1);
  out[3] = distDelta;

  const playerSpeed = Math.hypot(p.playerVelocity.x, p.playerVelocity.y);
  if (playerSpeed > 1e-3) {
    out[4] = p.playerVelocity.x / playerSpeed;
    out[5] = p.playerVelocity.y / playerSpeed;
  }
  out[6] = clamp(playerSpeed / Math.max(p.maxPlayerSpeed, 1e-3), 0, 1);

  const enemySpeed = Math.hypot(p.enemyVelocity.x, p.enemyVelocity.y);
  if (enemySpeed > 1e-3) {
    out[7] = p.enemyVelocity.x / enemySpeed;
    out[8] = p.enemyVelocity.y / enemySpeed;
  }
  out[9] = clamp(enemySpeed / Math.max(p.maxEnemySpeed, 1e-3), 0, 1);

  out[10] = clamp(distDelta * p.toPlayer.x, -1, 1);
  out[11] = clamp(distDelta * p.toPlayer.y, -1, 1);

  return out;
}

/** Snapshot of one decide() call, needed later to attribute a reward to the right internal activations. */
export interface BrainTrace {
  input: Float32Array;
  hidden: Float32Array;
  mean: Float32Array;
  sample: Float32Array;
}

export interface BrainDecision {
  move: Vector2;
  aim: Vector2;
  trace: BrainTrace;
}

/** Result of a mood pick, carrying what reinforceMood() needs to credit it later. */
export interface MoodDecision {
  input: Float32Array;
  moodIndex: number;
  moodName: MoodName;
  hidden: Float32Array;
  probs: Float32Array;
}

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = Float32Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return Float32Array.from(exps, (v) => v / sum);
}

function sampleCategorical(probs: Float32Array, rng: () => number): number {
  const roll = rng();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i++) {
    cumulative += probs[i];
    if (roll < cumulative) return i;
  }
  return probs.length - 1; // floating-point fallback
}

/**
 * A small feedforward "brain" loosely inspired by a fly's visual-motor
 * pathway (motion-sensing inputs -> steering outputs) and reward-gated the
 * way a fly's mushroom-body dopaminergic circuit reinforces useful
 * behavior -- NOT a simulation of any real connectome dataset. Learns via a
 * REINFORCE-style policy-gradient update: outputs are the mean of a small
 * Gaussian policy, the actually-used action adds exploration noise, and a
 * later reward (positive on a landed hit, negative on a miss) nudges
 * weights so that whichever noise produced a hit becomes more likely and
 * whichever produced a miss becomes less likely.
 */
export class ConnectomeBrain {
  private lastTrace: BrainTrace | null = null;
  private lastMoodDecision: MoodDecision | null = null;

  private constructor(
    private w1: Float32Array,
    private b1: Float32Array,
    private w2: Float32Array,
    private b2: Float32Array,
    private w2b: Float32Array,
    private b2b: Float32Array,
    private rng: () => number,
  ) {}

  static createRandom(rng: () => number = Math.random): ConnectomeBrain {
    const w1 = randomArray(BRAIN_HIDDEN_SIZE * BRAIN_INPUT_SIZE, rng, WEIGHT_INIT_RANGE);
    const b1 = randomArray(BRAIN_HIDDEN_SIZE, rng, WEIGHT_INIT_RANGE);
    const w2 = randomArray(BRAIN_OUTPUT_SIZE * BRAIN_HIDDEN_SIZE, rng, WEIGHT_INIT_RANGE);
    const b2 = randomArray(BRAIN_OUTPUT_SIZE, rng, WEIGHT_INIT_RANGE);
    const w2b = randomArray(BRAIN_MOOD_COUNT * BRAIN_HIDDEN_SIZE, rng, WEIGHT_INIT_RANGE);
    const b2b = randomArray(BRAIN_MOOD_COUNT, rng, WEIGHT_INIT_RANGE);

    applyAggressionBias(w1, b1, w2);

    return new ConnectomeBrain(w1, b1, w2, b2, w2b, b2b, rng);
  }

  static deserialize(data: SerializedBrainWeights, rng: () => number = Math.random): ConnectomeBrain | null {
    if (!isValidSerializedWeights(data)) return null;
    return new ConnectomeBrain(
      Float32Array.from(data.w1),
      Float32Array.from(data.b1),
      Float32Array.from(data.w2),
      Float32Array.from(data.b2),
      Float32Array.from(data.w2b),
      Float32Array.from(data.b2b),
      rng,
    );
  }

  serialize(): SerializedBrainWeights {
    return {
      w1: Array.from(this.w1),
      b1: Array.from(this.b1),
      w2: Array.from(this.w2),
      b2: Array.from(this.b2),
      w2b: Array.from(this.w2b),
      b2b: Array.from(this.b2b),
    };
  }

  private computeHidden(input: Float32Array): Float32Array {
    const hidden = new Float32Array(BRAIN_HIDDEN_SIZE);
    for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
      let sum = this.b1[j];
      for (let i = 0; i < BRAIN_INPUT_SIZE; i++) sum += this.w1[j * BRAIN_INPUT_SIZE + i] * input[i];
      hidden[j] = Math.tanh(sum);
    }
    return hidden;
  }

  decide(rawInputs: Float32Array): BrainDecision {
    const input = Float32Array.from(rawInputs, (v) => (Number.isFinite(v) ? v : 0));
    const hidden = this.computeHidden(input);

    const mean = new Float32Array(BRAIN_OUTPUT_SIZE);
    for (let k = 0; k < BRAIN_OUTPUT_SIZE; k++) {
      let sum = this.b2[k];
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) sum += this.w2[k * BRAIN_HIDDEN_SIZE + j] * hidden[j];
      mean[k] = Math.tanh(sum);
    }

    const noiseLimit = NOISE_CLAMP_SIGMAS * EXPLORATION_STDDEV;
    const sample = new Float32Array(BRAIN_OUTPUT_SIZE);
    for (let k = 0; k < BRAIN_OUTPUT_SIZE; k++) {
      const noise = clamp(sampleStandardNormal(this.rng) * EXPLORATION_STDDEV, -noiseLimit, noiseLimit);
      sample[k] = clamp(mean[k] + noise, -1, 1);
    }

    const trace: BrainTrace = { input, hidden, mean, sample };
    this.lastTrace = trace;

    const move = normalizeOrNull(sample[0], sample[1]) ?? normalizeOrNull(mean[0], mean[1]) ?? { x: 1, y: 0 };
    const aim = normalizeOrNull(sample[2], sample[3]) ?? normalizeOrNull(mean[2], mean[3]) ?? { x: 1, y: 0 };

    return { move, aim, trace };
  }

  /** Applies the REINFORCE update for `trace` (defaults to the most recent decide() call). */
  reinforce(reward: number, trace: BrainTrace | null = this.lastTrace): void {
    if (!trace || !Number.isFinite(reward)) return;

    const { input, hidden, mean, sample } = trace;
    const sigmaSq = EXPLORATION_STDDEV * EXPLORATION_STDDEV;

    const outputError = new Float32Array(BRAIN_OUTPUT_SIZE);
    for (let k = 0; k < BRAIN_OUTPUT_SIZE; k++) {
      const noise = sample[k] - mean[k];
      outputError[k] = reward * (noise / sigmaSq) * (1 - mean[k] * mean[k]);
    }

    // Backprop into the hidden layer using the PRE-update w2, before any
    // weight in this pass has been mutated.
    const hiddenError = new Float32Array(BRAIN_HIDDEN_SIZE);
    for (let k = 0; k < BRAIN_OUTPUT_SIZE; k++) {
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
        hiddenError[j] += outputError[k] * this.w2[k * BRAIN_HIDDEN_SIZE + j];
      }
    }
    for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
      hiddenError[j] *= 1 - hidden[j] * hidden[j];
    }

    for (let k = 0; k < BRAIN_OUTPUT_SIZE; k++) {
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
        const idx = k * BRAIN_HIDDEN_SIZE + j;
        this.w2[idx] = clamp(this.w2[idx] + LEARNING_RATE * outputError[k] * hidden[j], -WEIGHT_CLAMP, WEIGHT_CLAMP);
      }
      this.b2[k] = clamp(this.b2[k] + LEARNING_RATE * outputError[k], -WEIGHT_CLAMP, WEIGHT_CLAMP);
    }

    for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
      for (let i = 0; i < BRAIN_INPUT_SIZE; i++) {
        const idx = j * BRAIN_INPUT_SIZE + i;
        this.w1[idx] = clamp(this.w1[idx] + LEARNING_RATE * hiddenError[j] * input[i], -WEIGHT_CLAMP, WEIGHT_CLAMP);
      }
      this.b1[j] = clamp(this.b1[j] + LEARNING_RATE * hiddenError[j], -WEIGHT_CLAMP, WEIGHT_CLAMP);
    }
  }

  /**
   * Picks a "mood" via a second output head sharing the same hidden layer as
   * decide()'s movement/aim outputs -- a real part of the same brain, not a
   * bolted-on separate system. Called fresh at the moment a chat line is
   * needed (not tied to decide()'s periodic cadence), so mood reflects the
   * situation right then.
   */
  decideMood(rawInputs: Float32Array): MoodDecision {
    const input = Float32Array.from(rawInputs, (v) => (Number.isFinite(v) ? v : 0));
    const hidden = this.computeHidden(input);

    const logits = new Float32Array(BRAIN_MOOD_COUNT);
    for (let m = 0; m < BRAIN_MOOD_COUNT; m++) {
      let sum = this.b2b[m];
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) sum += this.w2b[m * BRAIN_HIDDEN_SIZE + j] * hidden[j];
      logits[m] = sum;
    }

    const probs = softmax(logits);
    const moodIndex = sampleCategorical(probs, this.rng);

    const decision: MoodDecision = { input, moodIndex, moodName: MOOD_NAMES[moodIndex], hidden, probs };
    this.lastMoodDecision = decision;
    return decision;
  }

  /**
   * Categorical-policy-gradient update for the mood head, defaulting to the
   * most recent decideMood() call (mirrors reinforce()'s trace default).
   * Standard softmax REINFORCE: push the chosen mood's logit up on a
   * positive reward (down on a negative one), proportional to how
   * surprising that choice was. Then backprop into the SAME shared hidden
   * layer that movement/aim also use, so a hit/miss shapes one brain, not
   * two independent ones.
   */
  reinforceMood(reward: number, decision: MoodDecision | null = this.lastMoodDecision): void {
    if (!decision || !Number.isFinite(reward)) return;

    const { input, moodIndex, hidden, probs } = decision;

    const gradient = new Float32Array(BRAIN_MOOD_COUNT);
    for (let m = 0; m < BRAIN_MOOD_COUNT; m++) {
      gradient[m] = reward * ((m === moodIndex ? 1 : 0) - probs[m]);
    }

    // Backprop into the hidden layer using the PRE-update w2b.
    const hiddenError = new Float32Array(BRAIN_HIDDEN_SIZE);
    for (let m = 0; m < BRAIN_MOOD_COUNT; m++) {
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
        hiddenError[j] += gradient[m] * this.w2b[m * BRAIN_HIDDEN_SIZE + j];
      }
    }
    for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
      hiddenError[j] *= 1 - hidden[j] * hidden[j];
    }

    for (let m = 0; m < BRAIN_MOOD_COUNT; m++) {
      for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
        const idx = m * BRAIN_HIDDEN_SIZE + j;
        this.w2b[idx] = clamp(this.w2b[idx] + LEARNING_RATE * gradient[m] * hidden[j], -WEIGHT_CLAMP, WEIGHT_CLAMP);
      }
      this.b2b[m] = clamp(this.b2b[m] + LEARNING_RATE * gradient[m], -WEIGHT_CLAMP, WEIGHT_CLAMP);
    }

    for (let j = 0; j < BRAIN_HIDDEN_SIZE; j++) {
      for (let i = 0; i < BRAIN_INPUT_SIZE; i++) {
        const idx = j * BRAIN_INPUT_SIZE + i;
        this.w1[idx] = clamp(this.w1[idx] + LEARNING_RATE * hiddenError[j] * input[i], -WEIGHT_CLAMP, WEIGHT_CLAMP);
      }
      this.b1[j] = clamp(this.b1[j] + LEARNING_RATE * hiddenError[j], -WEIGHT_CLAMP, WEIGHT_CLAMP);
    }
  }
}

/**
 * Dedicates 4 of the 12 hidden units to direct pass-throughs (input -> hidden
 * -> output) so a freshly-created brain's default, un-noised output already
 * approximates today's heuristic -- aim at the player, approach when too
 * far, back off when too close -- before any learning has happened. Other
 * weights stay small and random, so the network keeps full capacity to
 * learn better leading/positioning on top of this floor.
 */
function applyAggressionBias(w1: Float32Array, b1: Float32Array, w2: Float32Array): void {
  const wireHiddenToInput = (hiddenIndex: number, inputIndex: number): void => {
    w1[hiddenIndex * BRAIN_INPUT_SIZE + inputIndex] = AGGRESSION_BIAS_WEIGHT;
    b1[hiddenIndex] = 0;
  };
  const wireOutputToHidden = (outputIndex: number, hiddenIndex: number): void => {
    w2[outputIndex * BRAIN_HIDDEN_SIZE + hiddenIndex] = AGGRESSION_BIAS_WEIGHT;
  };

  // input 0,1 = ux,uy (unit vector to player) -> output 2,3 = aimX,aimY
  wireHiddenToInput(0, 0);
  wireOutputToHidden(2, 0);
  wireHiddenToInput(1, 1);
  wireOutputToHidden(3, 1);

  // input 10,11 = moveBiasX,moveBiasY -> output 0,1 = moveX,moveY
  wireHiddenToInput(2, 10);
  wireOutputToHidden(0, 2);
  wireHiddenToInput(3, 11);
  wireOutputToHidden(1, 3);
}
