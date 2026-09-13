import Phaser from "phaser";
import { GameScene } from "./scenes/GameScene";

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#1d1f21",
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: "100%",
      height: "100%",
    },
    physics: {
      default: "arcade",
      arcade: { debug: false },
    },
    scene: [GameScene],
  });
}
