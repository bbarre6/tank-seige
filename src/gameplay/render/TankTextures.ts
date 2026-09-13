import Phaser from "phaser";

const HULL_KEY = "tank-hull";
const TURRET_KEY = "tank-turret";

// Original olive-drab/camo palette, not sampled from any reference asset.
const PALETTE = {
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

const HULL_W = 40;
const HULL_H = 24;
const HULL_BODY_TOP = 4;
const HULL_BODY_BOTTOM = 20;

/**
 * Procedurally draws small pixel-art-style tank textures (hull + turret,
 * both authored facing +x/right so a 0 rotation means "facing right").
 * Generated once per scene and cached by key, so no external art asset
 * or reference image is used or copied.
 */
export function ensureTankTextures(scene: Phaser.Scene): { hullKey: string; turretKey: string } {
  if (!scene.textures.exists(HULL_KEY)) {
    const g = scene.make.graphics({}, false);

    drawTreadBand(g, 0);
    drawTreadBand(g, HULL_H - 4);

    // Hull body base
    g.fillStyle(PALETTE.hullBase, 1);
    g.fillRect(2, HULL_BODY_TOP, HULL_W - 4, HULL_BODY_BOTTOM - HULL_BODY_TOP);

    // Broken-up camo blotches over the base color
    g.fillStyle(PALETTE.camoDark, 1);
    g.fillRect(4, 6, 6, 4);
    g.fillRect(23, 15, 8, 3);
    g.fillRect(31, 6, 5, 4);
    g.fillStyle(PALETTE.camoLight, 1);
    g.fillRect(12, 7, 7, 3);
    g.fillRect(19, 14, 6, 3);
    g.fillRect(34, 13, 4, 3);

    // Top/bottom bevel to keep a bit of depth over the camo
    g.fillStyle(PALETTE.hullHighlight, 1);
    g.fillRect(2, HULL_BODY_TOP, HULL_W - 4, 2);
    g.fillStyle(PALETTE.hullShadow, 1);
    g.fillRect(2, HULL_BODY_BOTTOM - 2, HULL_W - 4, 2);

    // Rivets along the hull edges
    g.fillStyle(PALETTE.rivet, 1);
    for (const x of [5, 13, 21, 29, 35]) {
      g.fillRect(x, HULL_BODY_TOP + 1, 2, 2);
      g.fillRect(x, HULL_BODY_BOTTOM - 3, 2, 2);
    }

    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeRect(0.5, 0.5, HULL_W - 1, HULL_H - 1);

    g.generateTexture(HULL_KEY, HULL_W, HULL_H);
    g.destroy();
  }

  if (!scene.textures.exists(TURRET_KEY)) {
    const g = scene.make.graphics({}, false);
    const cx = 10;
    const cy = 10;
    const radius = 8;
    const barrelEnd = 32;

    // Barrel (drawn first so the turret body overlaps its base, leaving
    // only the protruding tip visible)
    g.fillStyle(PALETTE.tread, 1);
    g.fillRect(cx, cy - 2, barrelEnd - cx, 4);
    g.fillStyle(PALETTE.hullHighlight, 1);
    g.fillRect(cx + radius, cy - 2, barrelEnd - cx - radius, 1);
    g.fillStyle(PALETTE.rivet, 1);
    g.fillRect(barrelEnd - 3, cy - 2, 2, 4); // muzzle cap

    g.fillStyle(PALETTE.turretBase, 1);
    g.fillCircle(cx, cy, radius);

    // A camo patch and a hatch detail break up the flat turret circle
    g.fillStyle(PALETTE.camoDark, 1);
    g.fillCircle(cx + 3, cy + 3, 3);
    g.fillStyle(PALETTE.hatch, 1);
    g.fillCircle(cx - 1, cy - 1, 3);

    g.fillStyle(PALETTE.hullHighlight, 1);
    g.fillCircle(cx - 2, cy - 2, radius / 3.5);

    // Rim rivets around the turret
    g.fillStyle(PALETTE.rivet, 1);
    for (const angle of [45, 135, 225, 315]) {
      const rad = Phaser.Math.DegToRad(angle);
      const rx = cx + Math.cos(rad) * (radius - 1.5);
      const ry = cy + Math.sin(rad) * (radius - 1.5);
      g.fillRect(rx - 0.75, ry - 0.75, 1.5, 1.5);
    }

    g.lineStyle(1, PALETTE.outline, 1);
    g.strokeCircle(cx, cy, radius);

    g.generateTexture(TURRET_KEY, barrelEnd + 2, 20);
    g.destroy();
  }

  return { hullKey: HULL_KEY, turretKey: TURRET_KEY };
}

function drawTreadBand(g: Phaser.GameObjects.Graphics, y: number): void {
  g.fillStyle(PALETTE.tread, 1);
  g.fillRect(0, y, HULL_W, 4);

  g.fillStyle(PALETTE.treadLink, 1);
  for (let x = 0; x < HULL_W; x += 5) {
    g.fillRect(x, y, 3, 4);
  }
}
