import { createGame } from "./game";

const parent = document.getElementById("app");
if (!parent) {
  throw new Error("Missing #app element to mount the game into");
}

createGame(parent);
