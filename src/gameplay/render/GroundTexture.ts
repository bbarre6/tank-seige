import Phaser from "phaser";

const GROUND_KEY = "battlefield-ground";
const TILE_SIZE = 48;

// Original palette, not sampled from any reference asset.
const PALETTE = {
  base: 0x3d5c3a,
  baseDark: 0x33502f,
  baseLight: 0x466844,
  patchDark: 0x2b3f28,
  patchLight: 0x53794f,
  grid: 0x2f4a2c,
};

/**
 * Procedurally draws a small tileable dirt/grass ground texture, used as a
 * repeating TileSprite background so the play field reads as a battlefield
 * map rather than a flat color. Generated once per scene and cached by key.
 */
export function ensureGroundTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GROUND_KEY)) return GROUND_KEY;

  const g = scene.make.graphics({}, false);

  g.fillStyle(PALETTE.base, 1);
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  g.fillStyle(PALETTE.patchDark, 1);
  g.fillRect(4, 6, 10, 6);
  g.fillRect(28, 30, 12, 8);

  g.fillStyle(PALETTE.patchLight, 1);
  g.fillRect(20, 4, 8, 6);
  g.fillRect(6, 30, 9, 7);

  g.fillStyle(PALETTE.baseDark, 1);
  g.fillRect(34, 12, 6, 5);

  g.fillStyle(PALETTE.baseLight, 1);
  g.fillRect(14, 18, 7, 5);

  // Faint sector grid line so the tiling reads as a map
  g.lineStyle(1, PALETTE.grid, 0.5);
  g.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

  g.generateTexture(GROUND_KEY, TILE_SIZE, TILE_SIZE);
  g.destroy();

  return GROUND_KEY;
}
