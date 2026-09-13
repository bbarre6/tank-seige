import Phaser from "phaser";

const HULL_KEY = "tank-hull";
const TURRET_KEY = "tank-turret";

// Original olive-drab palette, not sampled from any reference asset.
const PALETTE = {
  hullBase: 0x4b5320,
  hullHighlight: 0x6b7a3a,
  hullShadow: 0x33380f,
  tread: 0x2b2b2b,
  turretBase: 0x5a6b2e,
  outline: 0x1f2210,
};

/**
 * Procedurally draws small pixel-art-style tank textures (hull + turret,
 * both authored facing +x/right so a 0 rotation means "facing right").
 * Generated once per scene and cached by key, so no external art asset
 * or reference image is used or copied.
 */
export function ensureTankTextures(scene: Phaser.Scene): { hullKey: string; turretKey: string } {
  if (!scene.textures.exists(HULL_KEY)) {
    const g = scene.make.graphics({}, false);

    // Tracks (top and bottom strips)
    g.fillStyle(PALETTE.tread, 1);
    g.fillRect(0, 0, 32, 4);
    g.fillRect(0, 16, 32, 4);

    // Hull body
    g.fillStyle(PALETTE.hullBase, 1);
    g.fillRect(2, 4, 28, 12);

    // Hull highlight (top bevel) and shadow (bottom bevel)
    g.fillStyle(PALETTE.hullHighlight, 1);
    g.fillRect(2, 4, 28, 3);
    g.fillStyle(PALETTE.hullShadow, 1);
    g.fillRect(2, 13, 28, 3);

    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeRect(0.5, 0.5, 31, 19);

    g.generateTexture(HULL_KEY, 32, 20);
    g.destroy();
  }

  if (!scene.textures.exists(TURRET_KEY)) {
    const g = scene.make.graphics({}, false);
    const cx = 9;
    const cy = 9;
    const radius = 8;

    // Barrel (drawn first so the turret body overlaps its base, leaving
    // only the protruding tip visible)
    g.fillStyle(PALETTE.tread, 1);
    g.fillRect(cx, cy - 2, 20, 4);

    g.fillStyle(PALETTE.turretBase, 1);
    g.fillCircle(cx, cy, radius);

    g.fillStyle(PALETTE.hullHighlight, 1);
    g.fillCircle(cx - 2, cy - 2, radius / 2.5);

    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, radius);

    g.generateTexture(TURRET_KEY, 29, 18);
    g.destroy();
  }

  return { hullKey: HULL_KEY, turretKey: TURRET_KEY };
}
