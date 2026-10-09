import Phaser from "phaser";

const GROUND_KEY = "battlefield-ground";
const TILE_SIZE = 384;

// Original palette, not sampled from any reference asset.
const PALETTE = {
  base: 0x3d5c3a,
  baseDark: 0x33502f,
  baseLight: 0x466844,
  patchDark: 0x2b3f28,
  patchLight: 0x53794f,
  dirt: 0x4a3f2a,
  dirtDark: 0x362d1e,
  rock: 0x5a5a52,
  rockDark: 0x3f3f38,
  rockHighlight: 0x76766c,
  track: 0x2a3a27,
  grid: 0x2f4a2c,
};

/** Deterministic PRNG (mulberry32) so the generated texture is stable run to run. */
function createRandom(seed: number): () => number {
  let state = seed;
  return (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedurally draws a large tileable dirt/grass ground texture, used as a
 * repeating TileSprite background so the play field reads as real terrain
 * rather than a flat color or an obviously-repeating small tile. Generated
 * once per scene and cached by key.
 */
export function ensureGroundTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(GROUND_KEY)) return GROUND_KEY;

  const rand = createRandom(0xc0ffee);
  const g = scene.make.graphics({}, false);

  g.fillStyle(PALETTE.base, 1);
  g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  // Broad, soft-edged color patches (grass density/growth variation) built
  // from clusters of overlapping circles so borders look organic instead of
  // the old hard-edged rectangles.
  drawBlobCluster(g, rand, PALETTE.baseDark, 10, 14, 26);
  drawBlobCluster(g, rand, PALETTE.baseLight, 10, 14, 26);
  drawBlobCluster(g, rand, PALETTE.patchDark, 16, 7, 15);
  drawBlobCluster(g, rand, PALETTE.patchLight, 16, 7, 15);

  // A few bare dirt patches with a darker rim, like ground worn down by
  // tank treads -- kept small and sparse so they read as worn spots rather
  // than a repeating polka-dot pattern.
  drawDirtPatches(g, rand, 3);

  // Faint tire-track ruts crossing the field.
  drawTracks(g, rand, 2);

  // Scattered pebbles with a highlight and shadow for a bit of depth.
  drawRocks(g, rand, 28);

  // Fine speckle noise so flat color areas read as grainy dirt/grass rather
  // than a flat fill.
  drawSpeckle(g, rand, PALETTE.baseDark, 700);
  drawSpeckle(g, rand, PALETTE.baseLight, 700);

  // Faint sector grid line so the tiling still reads as a map.
  g.lineStyle(1, PALETTE.grid, 0.35);
  g.strokeRect(0.5, 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

  g.generateTexture(GROUND_KEY, TILE_SIZE, TILE_SIZE);
  g.destroy();

  return GROUND_KEY;
}

/**
 * Draws `shape` at all 9 positions offset by whole tile lengths in x/y.
 * Anything that lands outside the canvas is clipped away for free, so this
 * is how every feature below stays seamless across the TileSprite's edges:
 * a blob that pokes past the right edge also gets drawn one tile to the
 * left, filling in the matching sliver on that side.
 */
function drawWrapped(x: number, y: number, shape: (x: number, y: number) => void): void {
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      shape(x + dx * TILE_SIZE, y + dy * TILE_SIZE);
    }
  }
}

function drawBlobCluster(
  g: Phaser.GameObjects.Graphics,
  rand: () => number,
  color: number,
  count: number,
  minRadius: number,
  maxRadius: number,
): void {
  g.fillStyle(color, 1);
  for (let i = 0; i < count; i++) {
    const cx = rand() * TILE_SIZE;
    const cy = rand() * TILE_SIZE;
    const blobs = 3 + Math.floor(rand() * 3);
    for (let b = 0; b < blobs; b++) {
      const ox = cx + (rand() - 0.5) * maxRadius;
      const oy = cy + (rand() - 0.5) * maxRadius;
      const radius = minRadius + rand() * (maxRadius - minRadius);
      drawWrapped(ox, oy, (x, y) => g.fillCircle(x, y, radius));
    }
  }
}

function drawDirtPatches(g: Phaser.GameObjects.Graphics, rand: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cx = rand() * TILE_SIZE;
    const cy = rand() * TILE_SIZE;
    const radius = 8 + rand() * 10;

    g.fillStyle(PALETTE.dirtDark, 1);
    drawWrapped(cx, cy, (x, y) => g.fillCircle(x, y, radius + 2));
    g.fillStyle(PALETTE.dirt, 1);
    drawWrapped(cx, cy, (x, y) => g.fillCircle(x, y, radius));
  }
}

function drawTracks(g: Phaser.GameObjects.Graphics, rand: () => number, count: number): void {
  g.fillStyle(PALETTE.track, 0.5);
  for (let i = 0; i < count; i++) {
    const startX = rand() * TILE_SIZE;
    const startY = rand() * TILE_SIZE;
    const angle = rand() * Math.PI * 2;
    const length = 80 + rand() * 120;
    const steps = 24;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const wobble = Math.sin(t * 6 + i) * 6;
      const px = startX + Math.cos(angle) * length * t + Math.cos(angle + Math.PI / 2) * wobble;
      const py = startY + Math.sin(angle) * length * t + Math.sin(angle + Math.PI / 2) * wobble;
      drawWrapped(px, py, (x, y) => g.fillRect(x - 3, y - 3, 6, 6));
    }
  }
}

function drawRocks(g: Phaser.GameObjects.Graphics, rand: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const cx = rand() * TILE_SIZE;
    const cy = rand() * TILE_SIZE;
    const radius = 1 + rand() * 2;

    g.fillStyle(PALETTE.rockDark, 1);
    drawWrapped(cx + 0.5, cy + 0.5, (x, y) => g.fillCircle(x, y, radius));
    g.fillStyle(PALETTE.rock, 1);
    drawWrapped(cx, cy, (x, y) => g.fillCircle(x, y, radius));
    g.fillStyle(PALETTE.rockHighlight, 1);
    drawWrapped(cx - radius * 0.3, cy - radius * 0.3, (x, y) => g.fillCircle(x, y, radius * 0.4));
  }
}

function drawSpeckle(g: Phaser.GameObjects.Graphics, rand: () => number, color: number, count: number): void {
  g.fillStyle(color, 0.5);
  for (let i = 0; i < count; i++) {
    const x = rand() * TILE_SIZE;
    const y = rand() * TILE_SIZE;
    g.fillRect(x, y, 1, 1);
  }
}
