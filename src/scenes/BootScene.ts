import Phaser from "phaser";

/**
 * Placeholder scene proving the render/input pipeline is wired up.
 * Real gameplay (movement, shooting, waves, upgrades) lands with
 * US-1.1 - US-1.4 and US-2.1.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2, "TANK SIEGE", {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.add
      .rectangle(width / 2, height / 2 + 60, 48, 32, 0x4caf50)
      .setStrokeStyle(2, 0xffffff);
  }
}
