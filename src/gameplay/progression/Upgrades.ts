/**
 * US-1.4: upgrade shop data table. Kept separate from GameScene and framework-
 * agnostic (no Phaser/DOM) so balancing is just editing numbers here, and the
 * cost/level math is unit-testable without booting a scene.
 */
export type UpgradeId = "damage" | "fireRate" | "moveSpeed" | "maxHealth" | "multiTurret";

export interface UpgradeDef {
  id: UpgradeId;
  label: string;
  description: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number; // cost multiplier applied per level already owned
  perLevel: number; // amount added to the base stat per level (negative = reduces, e.g. fire cooldown)
}

export const UPGRADE_IDS: readonly UpgradeId[] = ["damage", "fireRate", "moveSpeed", "maxHealth", "multiTurret"];

export const UPGRADE_DEFS: Record<UpgradeId, UpgradeDef> = {
  damage: {
    id: "damage",
    label: "Damage",
    description: "+2 projectile damage per level",
    maxLevel: 5,
    baseCost: 50,
    costGrowth: 1.6,
    perLevel: 2,
  },
  fireRate: {
    id: "fireRate",
    label: "Fire Rate",
    description: "-20ms fire cooldown per level",
    maxLevel: 5,
    baseCost: 60,
    costGrowth: 1.6,
    perLevel: -20,
  },
  moveSpeed: {
    id: "moveSpeed",
    label: "Move Speed",
    description: "+20px/s move speed per level",
    maxLevel: 5,
    baseCost: 50,
    costGrowth: 1.6,
    perLevel: 20,
  },
  maxHealth: {
    id: "maxHealth",
    label: "Max HP",
    description: "+20 max HP per level",
    maxLevel: 5,
    baseCost: 70,
    costGrowth: 1.6,
    perLevel: 20,
  },
  multiTurret: {
    id: "multiTurret",
    label: "Multi Turret",
    description: "+1 turret per level, each firing its own projectile; +15 damage per level",
    maxLevel: 4,
    baseCost: 100,
    costGrowth: 1.8,
    perLevel: 1,
  },
};

export const UPGRADE_LIST: readonly UpgradeDef[] = UPGRADE_IDS.map((id) => UPGRADE_DEFS[id]);

export type UpgradeLevels = Record<UpgradeId, number>;

export function defaultUpgradeLevels(): UpgradeLevels {
  return { damage: 0, fireRate: 0, moveSpeed: 0, maxHealth: 0, multiTurret: 0 };
}

/** The coin cost to buy the NEXT level of this upgrade, or null once it's maxed out (AC-1.4.1, AC-1.4.3). */
export function costForNextLevel(def: UpgradeDef, currentLevel: number): number | null {
  if (currentLevel >= def.maxLevel) return null;
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** The effective stat value (base + per-level bonus * owned levels). */
export function valueAtLevel(base: number, perLevel: number, level: number): number {
  return base + perLevel * level;
}

function isValidLevel(value: unknown, maxLevel: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maxLevel;
}

/** Parses persisted upgrade levels, clamping/discarding anything malformed back to 0 rather than trusting storage blindly. */
export function parseUpgradeLevels(raw: string | null): UpgradeLevels {
  const levels = defaultUpgradeLevels();
  if (raw === null) return levels;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return levels;

    for (const id of UPGRADE_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (isValidLevel(value, UPGRADE_DEFS[id].maxLevel)) {
        levels[id] = value;
      }
    }
  } catch {
    return defaultUpgradeLevels();
  }

  return levels;
}
