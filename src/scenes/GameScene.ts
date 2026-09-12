import Phaser from "phaser";
import { Joystick, type Vector2 } from "../gameplay/input/Joystick";
import { spawnProjectile } from "../gameplay/combat/Projectile";
import { Health } from "../gameplay/combat/Health";

const TANK_SPEED = 220; // px/s
const TANK_SIZE = 36;
const JOYSTICK_RADIUS = 60;
const PROJECTILE_SPEED = 520;
const PROJECTILE_DAMAGE = 10;
const PROJECTILE_LIFESPAN_MS = 1500;
const FIRE_COOLDOWN_MS = 200;
const TARGET_MAX_HEALTH = 30;

/**
 * US-1.1: basic tank movement (AC-1.1.1) and independent aim/fire (AC-1.1.2).
 * Supports both a touch virtual joystick (left = move, right = aim/fire,
 * release-to-fire) and desktop WASD + mouse (click to fire), since the PRD
 * targets both desktop and mobile web.
 *
 * The health-bearing target on the right is a throwaway stand-in for a real
 * enemy so AC-1.1.2's "can damage an enemy on hit" is demonstrable; US-1.2
 * (wave spawning) replaces it with actual enemy tanks.
 */
export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private tankFacing: Vector2 = { x: 0, y: -1 };
  private projectiles!: Phaser.Physics.Arcade.Group;
  private target!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private targetHealth = new Health(TARGET_MAX_HEALTH);
  private targetHealthText!: Phaser.GameObjects.Text;

  private moveStick = new Joystick(JOYSTICK_RADIUS);
  private aimStick = new Joystick(JOYSTICK_RADIUS);
  private moveVector: Vector2 = { x: 0, y: 0 };
  private aimTouchPointerId: number | null = null;
  private moveTouchPointerId: number | null = null;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
  private lastFiredAt = 0;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const { width, height } = this.scale;

    this.tank = this.add.rectangle(width / 2, height / 2, TANK_SIZE, TANK_SIZE, 0x4caf50) as typeof this.tank;
    this.physics.add.existing(this.tank);
    this.tank.body.setCollideWorldBounds(true);

    this.target = this.add.rectangle(width * 0.8, height * 0.3, 40, 40, 0xe53935) as typeof this.target;
    this.physics.add.existing(this.target, true);

    this.targetHealthText = this.add.text(this.target.x, this.target.y - 32, `${this.targetHealth.value}`, {
      fontFamily: "monospace",
      fontSize: "16px",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.projectiles = this.physics.add.group();
    this.physics.add.overlap(this.projectiles, this.target, (_target, projectile) => {
      this.handleProjectileHit(projectile as Phaser.GameObjects.Arc);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.setupTouchControls(width);

    // Desktop: click anywhere to fire toward the pointer.
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < width / 2 || !this.isDesktopPointer(pointer)) return;
      this.fireToward({ x: pointer.worldX, y: pointer.worldY });
    });
  }

  update(_time: number, delta: number): void {
    this.updateMoveVector();
    this.applyMovement(delta);
    this.updateDesktopAim();
  }

  private setupTouchControls(width: number): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.wasTouch) return;

      if (pointer.x < width / 2 && this.moveTouchPointerId === null) {
        this.moveTouchPointerId = pointer.id;
        this.moveStick.start({ x: pointer.x, y: pointer.y });
      } else if (pointer.x >= width / 2 && this.aimTouchPointerId === null) {
        this.aimTouchPointerId = pointer.id;
        this.aimStick.start({ x: pointer.x, y: pointer.y });
      }
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.moveTouchPointerId) {
        const state = this.moveStick.move({ x: pointer.x, y: pointer.y });
        this.moveVector = { x: state.vector.x * state.magnitude, y: state.vector.y * state.magnitude };
      } else if (pointer.id === this.aimTouchPointerId) {
        const state = this.aimStick.move({ x: pointer.x, y: pointer.y });
        if (state.magnitude > 0) this.tankFacing = state.vector;
      }
    });

    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.moveTouchPointerId) {
        this.moveTouchPointerId = null;
        this.moveStick.end();
        this.moveVector = { x: 0, y: 0 };
      } else if (pointer.id === this.aimTouchPointerId) {
        const finalAim = this.tankFacing;
        this.aimTouchPointerId = null;
        this.aimStick.end();
        this.fireToward(null, finalAim);
      }
    });
  }

  private isDesktopPointer(pointer: Phaser.Input.Pointer): boolean {
    return !pointer.wasTouch;
  }

  private updateMoveVector(): void {
    if (this.moveTouchPointerId !== null) return; // touch drives moveVector directly

    const left = this.cursors.left?.isDown || this.wasd.a.isDown;
    const right = this.cursors.right?.isDown || this.wasd.d.isDown;
    const up = this.cursors.up?.isDown || this.wasd.w.isDown;
    const down = this.cursors.down?.isDown || this.wasd.s.isDown;

    const x = (right ? 1 : 0) - (left ? 1 : 0);
    const y = (down ? 1 : 0) - (up ? 1 : 0);
    const length = Math.hypot(x, y);

    this.moveVector = length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
  }

  private applyMovement(_delta: number): void {
    this.tank.body.setVelocity(this.moveVector.x * TANK_SPEED, this.moveVector.y * TANK_SPEED);
  }

  private updateDesktopAim(): void {
    if (this.aimTouchPointerId !== null) return; // touch drives aim directly

    const pointer = this.input.activePointer;
    if (pointer.wasTouch) return;

    const dx = pointer.worldX - this.tank.x;
    const dy = pointer.worldY - this.tank.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      this.tankFacing = { x: dx / distance, y: dy / distance };
    }
  }

  private fireToward(worldPoint: Vector2 | null, direction?: Vector2): void {
    const now = this.time.now;
    if (now - this.lastFiredAt < FIRE_COOLDOWN_MS) return;

    let aim = direction ?? this.tankFacing;
    if (worldPoint) {
      const dx = worldPoint.x - this.tank.x;
      const dy = worldPoint.y - this.tank.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) return;
      aim = { x: dx / distance, y: dy / distance };
    }
    if (aim.x === 0 && aim.y === 0) return;

    this.lastFiredAt = now;

    const spawn = spawnProjectile({ x: this.tank.x, y: this.tank.y }, aim, PROJECTILE_SPEED, PROJECTILE_DAMAGE);
    const projectile = this.add.circle(spawn.x, spawn.y, 5, 0xffeb3b);
    this.projectiles.add(projectile);
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(spawn.velocityX, spawn.velocityY);
    (projectile as unknown as { damage: number }).damage = spawn.damage;

    this.time.delayedCall(PROJECTILE_LIFESPAN_MS, () => projectile.destroy());
  }

  private handleProjectileHit(projectile: Phaser.GameObjects.Arc): void {
    const damage = (projectile as unknown as { damage: number }).damage ?? PROJECTILE_DAMAGE;
    projectile.destroy();

    this.targetHealth.takeDamage(damage);
    this.targetHealthText.setText(`${this.targetHealth.value}`);

    if (this.targetHealth.isDead) {
      this.targetHealth.reset();
      this.targetHealthText.setText(`${this.targetHealth.value}`);
    }
  }
}
