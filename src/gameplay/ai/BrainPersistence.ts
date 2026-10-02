import { isValidSerializedWeights, type SerializedBrainWeights } from "./ConnectomeBrain";

const ENEMY_BRAIN_BASELINE_STORAGE_KEY = "tank-siege:enemyBrainBaseline";

/**
 * The single best-known enemy brain so far (shared across every tier,
 * including the boss) plus the lifetime reward score it earned. New enemies
 * seed their own independent brain from this baseline; it's only ever
 * overwritten by a later enemy that scored strictly higher, so it ratchets
 * upward over time even though no single enemy lives long enough to learn
 * much on its own.
 */
export interface StoredBrainBaseline {
  weights: SerializedBrainWeights;
  score: number;
}

function isValidBaseline(value: unknown): value is StoredBrainBaseline {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<StoredBrainBaseline>;
  return typeof data.score === "number" && Number.isFinite(data.score) && isValidSerializedWeights(data.weights);
}

export function loadBrainBaseline(): StoredBrainBaseline | null {
  try {
    const raw = window.localStorage.getItem(ENEMY_BRAIN_BASELINE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidBaseline(parsed) ? parsed : null;
  } catch {
    return null; // localStorage/JSON can throw (privacy mode, disabled storage, corrupt data, etc.)
  }
}

export function saveBrainBaseline(baseline: StoredBrainBaseline): void {
  try {
    window.localStorage.setItem(ENEMY_BRAIN_BASELINE_STORAGE_KEY, JSON.stringify(baseline));
  } catch {
    // Best-effort only; losing persistence shouldn't break gameplay.
  }
}
