import Phaser from "phaser";

interface TankPalette {
  hullBase: number;
  hullHighlight: number;
  hullShadow: number;
  camoDark: number;
  camoLight: number;
  tread: number;
  treadLink: number;
  rivet: number;
  turretBase: number;
  hatch: number;
  outline: number;
}

// Original palettes, not sampled from any reference asset.
const PLAYER_PALETTE: TankPalette = {
  hullBase: 0x4b5320,
  hullHighlight: 0x6b7a3a,
  hullShadow: 0x33380f,
  camoDark: 0x333c14,
  camoLight: 0x5c6b2a,
  tread: 0x2b2b2b,
  treadLink: 0x1a1a1a,
  rivet: 0x14150a,
  turretBase: 0x5a6b2e,
  hatch: 0x40481f,
  outline: 0x1f2210,
};

// Neutral gunmetal palette so setTint() can recolor it per difficulty tier
// (red/purple/blue/gold) while keeping the camo/rivet/highlight shading.
const ENEMY_PALETTE: TankPalette = {
  hullBase: 0x8a8f94,
  hullHighlight: 0xbfc4c8,
  hullShadow: 0x54585c,
  camoDark: 0x6b7075,
  camoLight: 0xa3a8ac,
  tread: 0x2b2b2b,
  treadLink: 0x1a1a1a,
  rivet: 0x14150a,
  turretBase: 0x9aa0a5,
  hatch: 0x6f7478,
  outline: 0x2a2c2e,
};

const PLAYER_HULL_KEY = "tank-hull";
const PLAYER_TURRET_KEY = "tank-turret";
const ENEMY_HULL_KEY = "enemy-tank-hull";
const ENEMY_TURRET_KEY = "enemy-tank-turret";

const HULL_W = 40;
const HULL_H = 24;
const HULL_BODY_TOP = 4;
const HULL_BODY_BOTTOM = 20;

/**
 * Procedurally draws small pixel-art-style tank textures (hull + turret,
 * both authored facing +x/right so a 0 rotation means "facing right").
 * Generated once per scene and cached by key, so no external art asset or
 * reference image is used or copied. The player and enemy share the same
 * detailed drawing routines -- the player is a fixed olive-drab palette,
 * while the enemy texture is neutral gunmetal gray meant to be recolored
 * per difficulty tier via setTint() (see GameScene's ENEMY_TIERS).
 */
export function ensureTankTextures(scene: Phaser.Scene): { hullKey: string; turretKey: string } {
  drawHullTexture(scene, PLAYER_HULL_KEY, PLAYER_PALETTE);
  drawTurretTexture(scene, PLAYER_TURRET_KEY, PLAYER_PALETTE);
  return { hullKey: PLAYER_HULL_KEY, turretKey: PLAYER_TURRET_KEY };
}

export function ensureEnemyTankTextures(scene: Phaser.Scene): { hullKey: string; turretKey: string } {
  drawHullTexture(scene, ENEMY_HULL_KEY, ENEMY_PALETTE);
  drawTurretTexture(scene, ENEMY_TURRET_KEY, ENEMY_PALETTE);
  return { hullKey: ENEMY_HULL_KEY, turretKey: ENEMY_TURRET_KEY };
}

function drawHullTexture(scene: Phaser.Scene, key: string, palette: TankPalette): void {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({}, false);

  drawTreadBand(g, 0, palette);
  drawTreadBand(g, HULL_H - 4, palette);

  // Hull body base
  g.fillStyle(palette.hullBase, 1);
  g.fillRect(2, HULL_BODY_TOP, HULL_W - 4, HULL_BODY_BOTTOM - HULL_BODY_TOP);

  // Broken-up camo blotches over the base color
  g.fillStyle(palette.camoDark, 1);
  g.fillRect(4, 6, 6, 4);
  g.fillRect(23, 15, 8, 3);
  g.fillRect(31, 6, 5, 4);
  g.fillStyle(palette.camoLight, 1);
  g.fillRect(12, 7, 7, 3);
  g.fillRect(19, 14, 6, 3);
  g.fillRect(34, 13, 4, 3);

  // Top/bottom bevel to keep a bit of depth over the camo
  g.fillStyle(palette.hullHighlight, 1);
  g.fillRect(2, HULL_BODY_TOP, HULL_W - 4, 2);
  g.fillStyle(palette.hullShadow, 1);
  g.fillRect(2, HULL_BODY_BOTTOM - 2, HULL_W - 4, 2);

  // Rivets along the hull edges
  g.fillStyle(palette.rivet, 1);
  for (const x of [5, 13, 21, 29, 35]) {
    g.fillRect(x, HULL_BODY_TOP + 1, 2, 2);
    g.fillRect(x, HULL_BODY_BOTTOM - 3, 2, 2);
  }

  g.lineStyle(1, palette.outline, 1);
  g.strokeRect(0.5, 0.5, HULL_W - 1, HULL_H - 1);

  g.generateTexture(key, HULL_W, HULL_H);
  g.destroy();
}

function drawTurretTexture(scene: Phaser.Scene, key: string, palette: TankPalette): void {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({}, false);
  const cx = 10;
  const cy = 10;
  const radius = 8;
  const barrelEnd = 32;

  // Barrel (drawn first so the turret body overlaps its base, leaving
  // only the protruding tip visible)
  g.fillStyle(palette.tread, 1);
  g.fillRect(cx, cy - 2, barrelEnd - cx, 4);
  g.fillStyle(palette.hullHighlight, 1);
  g.fillRect(cx + radius, cy - 2, barrelEnd - cx - radius, 1);
  g.fillStyle(palette.rivet, 1);
  g.fillRect(barrelEnd - 3, cy - 2, 2, 4); // muzzle cap

  g.fillStyle(palette.turretBase, 1);
  g.fillCircle(cx, cy, radius);

  // A camo patch and a hatch detail break up the flat turret circle
  g.fillStyle(palette.camoDark, 1);
  g.fillCircle(cx + 3, cy + 3, 3);
  g.fillStyle(palette.hatch, 1);
  g.fillCircle(cx - 1, cy - 1, 3);

  g.fillStyle(palette.hullHighlight, 1);
  g.fillCircle(cx - 2, cy - 2, radius / 3.5);

  // Rim rivets around the turret
  g.fillStyle(palette.rivet, 1);
  for (const angle of [45, 135, 225, 315]) {
    const rad = Phaser.Math.DegToRad(angle);
    const rx = cx + Math.cos(rad) * (radius - 1.5);
    const ry = cy + Math.sin(rad) * (radius - 1.5);
    g.fillRect(rx - 0.75, ry - 0.75, 1.5, 1.5);
  }

  g.lineStyle(1, palette.outline, 1);
  g.strokeCircle(cx, cy, radius);

  g.generateTexture(key, barrelEnd + 2, 20);
  g.destroy();
}

function drawTreadBand(g: Phaser.GameObjects.Graphics, y: number, palette: TankPalette): void {
  g.fillStyle(palette.tread, 1);
  g.fillRect(0, y, HULL_W, 4);

  g.fillStyle(palette.treadLink, 1);
  for (let x = 0; x < HULL_W; x += 5) {
    g.fillRect(x, y, 3, 4);
  }
}
