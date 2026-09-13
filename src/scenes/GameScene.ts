import Phaser from "phaser";
import { Joystick, type Vector2 } from "../gameplay/input/Joystick";
import { spawnProjectile } from "../gameplay/combat/Projectile";
import { Health } from "../gameplay/combat/Health";
import { ensureTankTextures } from "../gameplay/render/TankTextures";

const TANK_SPEED = 220; // px/s
const TANK_SCALE = 1.5;
const JOYSTICK_RADIUS = 60;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_PROJECTILE_SPEED = 520;
const PLAYER_PROJECTILE_DAMAGE = 10;
const PLAYER_FIRE_COOLDOWN_MS = 200;
const SPACE_FIRE_COOLDOWN_MS = 300; // separate cap on the spacebar auto-fire shortcut

const ENEMY_MAX_HEALTH = 80;
const ENEMY_SPEED = 90; // slower than the player so it's chaseable, not oppressive
const ENEMY_PROJECTILE_SPEED = 260;
const ENEMY_PROJECTILE_DAMAGE = 5; // half the player's damage, per design: player should out-damage enemies
const ENEMY_FIRE_COOLDOWN_MS = 1200;
const ENEMY_PREFERRED_DISTANCE = 260; // holds roughly this far from the player to shoot from
const ENEMY_DISTANCE_DEADZONE = 20;
const ENEMY_RESPAWN_DELAY_MS = 1500;

const PROJECTILE_LIFESPAN_MS = 1500;

/**
 * US-1.1: basic tank movement (AC-1.1.1) and independent aim/fire (AC-1.1.2).
 * Supports both a touch virtual joystick (left = move, right = aim/fire,
 * release-to-fire) and desktop WASD + mouse (click to fire), since the PRD
 * targets both desktop and mobile web.
 *
 * The enemy tank here is a single hand-placed stand-in with simple chase-and-
 * shoot AI, not the real wave spawner (US-1.2 will replace this with proper
 * wave-based enemy spawning). It deals less damage than the player (design
 * intent: the player should out-damage enemies). Defeating it destroys it
 * and a fresh one respawns elsewhere after a short delay, since there's no
 * wave/win-condition system yet to give a permanent kill somewhere to go.
 * The player has no game-over flow yet either, so it simply respawns at
 * full health when defeated.
 */
export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Image & { body: Phaser.Physics.Arcade.Body };
  private turretSprite!: Phaser.GameObjects.Image;
  private tankFacing: Vector2 = { x: 1, y: 0 }; // matches the hull/turret art's neutral "facing right" orientation
  private playerHealth = new Health(PLAYER_MAX_HEALTH);
  private playerHealthText!: Phaser.GameObjects.Text;
  private playerProjectiles!: Phaser.Physics.Arcade.Group;

  private enemy!: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private enemyHealth = new Health(ENEMY_MAX_HEALTH);
  private enemyHealthText!: Phaser.GameObjects.Text;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private enemyAlive = false;
  private enemyLastFiredAt = 0;

  private moveStick = new Joystick(JOYSTICK_RADIUS);
  private aimStick = new Joystick(JOYSTICK_RADIUS);
  private moveVector: Vector2 = { x: 0, y: 0 };
  private aimTouchPointerId: number | null = null;
  private moveTouchPointerId: number | null = null;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private lastFiredAt = 0;
  private lastSpaceFiredAt = 0;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const { width, height } = this.scale;
    const { hullKey, turretKey } = ensureTankTextures(this);

    this.tank = this.add.image(width / 2, height / 2, hullKey).setScale(TANK_SCALE) as typeof this.tank;
    this.physics.add.existing(this.tank);
    this.tank.body.setCollideWorldBounds(true);
    this.tank.setDepth(0);

    this.turretSprite = this.add.image(this.tank.x, this.tank.y, turretKey).setScale(TANK_SCALE).setDepth(1);

    this.playerHealthText = this.add
      .text(16, 16, `HP: ${this.playerHealth.value}`, {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff",
      })
      .setScrollFactor(0);

    this.enemyGroup = this.physics.add.group();
    this.spawnEnemy();

    this.playerProjectiles = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();

    // Group-vs-Group overlap: Phaser preserves argument order here (unlike
    // the Group-vs-single-object case below, where the single object is
    // always reordered to come first), so the playerProjectiles member is
    // the first callback argument and the enemyGroup member is the second.
    this.physics.add.overlap(this.playerProjectiles, this.enemyGroup, (projectile, _enemy) => {
      this.handleEnemyHit(projectile as Phaser.GameObjects.Arc);
    });
    this.physics.add.overlap(this.enemyProjectiles, this.tank, (_tank, projectile) => {
      this.handlePlayerHit(projectile as Phaser.GameObjects.Arc);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.setupTouchControls(width);

    // Desktop: mouse aim only updates on actual mouse movement (not polled
    // every frame), so it doesn't stomp a spacebar auto-aim shot the very
    // next frame. Click anywhere to fire toward the pointer.
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.wasTouch || this.aimTouchPointerId !== null) return;

      const dx = pointer.worldX - this.tank.x;
      const dy = pointer.worldY - this.tank.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 0) {
        this.tankFacing = { x: dx / distance, y: dy / distance };
      }
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < width / 2 || !this.isDesktopPointer(pointer)) return;
      this.fireToward({ x: pointer.worldX, y: pointer.worldY });
    });
  }

  update(_time: number, delta: number): void {
    this.updateMoveVector();
    this.applyMovement(delta);
    this.updateTankVisuals();
    this.updateEnemyAI();

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.fireAtEnemy();
    }
  }

  /** Spacebar: fire at most once per SPACE_FIRE_COOLDOWN_MS, auto-aimed at the current enemy. */
  private fireAtEnemy(): void {
    if (!this.enemyAlive) return;

    const now = this.time.now;
    if (now - this.lastSpaceFiredAt < SPACE_FIRE_COOLDOWN_MS) return;

    const target = { x: this.enemy.x, y: this.enemy.y };
    const dx = target.x - this.tank.x;
    const dy = target.y - this.tank.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;

    this.lastSpaceFiredAt = now;
    this.tankFacing = { x: dx / distance, y: dy / distance };
    this.fireToward(target);
  }

  private updateTankVisuals(): void {
    // Hull faces the direction of travel; holds its last heading while idle.
    if (this.moveVector.x !== 0 || this.moveVector.y !== 0) {
      this.tank.rotation = Math.atan2(this.moveVector.y, this.moveVector.x);
    }

    // Turret aims independently of the hull (AC-1.1.2).
    this.turretSprite.setPosition(this.tank.x, this.tank.y);
    this.turretSprite.rotation = Math.atan2(this.tankFacing.y, this.tankFacing.x);
  }

  private spawnEnemy(): void {
    const { width, height } = this.scale;
    const x = Phaser.Math.Between(width * 0.6, width * 0.9);
    const y = Phaser.Math.Between(height * 0.15, height * 0.6);

    this.enemy = this.add.rectangle(x, y, 40, 40, 0xe53935) as typeof this.enemy;
    this.physics.add.existing(this.enemy);
    this.enemy.body.setCollideWorldBounds(true);
    this.enemyGroup.add(this.enemy);

    this.enemyHealth.reset();
    this.enemyHealthText = this.add
      .text(this.enemy.x, this.enemy.y - 32, `${this.enemyHealth.value}`, {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.enemyAlive = true;
  }

  private updateEnemyAI(): void {
    if (!this.enemyAlive) return;

    const dx = this.tank.x - this.enemy.x;
    const dy = this.tank.y - this.enemy.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;

    const toPlayer = { x: dx / distance, y: dy / distance };

    if (distance > ENEMY_PREFERRED_DISTANCE + ENEMY_DISTANCE_DEADZONE) {
      this.enemy.body.setVelocity(toPlayer.x * ENEMY_SPEED, toPlayer.y * ENEMY_SPEED);
    } else if (distance < ENEMY_PREFERRED_DISTANCE - ENEMY_DISTANCE_DEADZONE) {
      this.enemy.body.setVelocity(-toPlayer.x * ENEMY_SPEED, -toPlayer.y * ENEMY_SPEED);
    } else {
      this.enemy.body.setVelocity(0, 0);
    }

    this.enemyHealthText.setPosition(this.enemy.x, this.enemy.y - 32);

    const now = this.time.now;
    if (now - this.enemyLastFiredAt < ENEMY_FIRE_COOLDOWN_MS) return;
    this.enemyLastFiredAt = now;

    const spawn = spawnProjectile({ x: this.enemy.x, y: this.enemy.y }, toPlayer, ENEMY_PROJECTILE_SPEED, ENEMY_PROJECTILE_DAMAGE);
    const projectile = this.add.circle(spawn.x, spawn.y, 5, 0xff8a65);
    this.enemyProjectiles.add(projectile);
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(spawn.velocityX, spawn.velocityY);
    (projectile as unknown as { damage: number }).damage = spawn.damage;

    this.time.delayedCall(PROJECTILE_LIFESPAN_MS, () => projectile.destroy());
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

  private fireToward(worldPoint: Vector2 | null, direction?: Vector2): void {
    const now = this.time.now;
    if (now - this.lastFiredAt < PLAYER_FIRE_COOLDOWN_MS) return;

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

    const spawn = spawnProjectile({ x: this.tank.x, y: this.tank.y }, aim, PLAYER_PROJECTILE_SPEED, PLAYER_PROJECTILE_DAMAGE);
    const projectile = this.add.circle(spawn.x, spawn.y, 5, 0xffeb3b);
    this.playerProjectiles.add(projectile);
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(spawn.velocityX, spawn.velocityY);
    (projectile as unknown as { damage: number }).damage = spawn.damage;

    this.time.delayedCall(PROJECTILE_LIFESPAN_MS, () => projectile.destroy());
  }

  private handleEnemyHit(projectile: Phaser.GameObjects.Arc): void {
    if (!this.enemyAlive) return;

    const damage = (projectile as unknown as { damage: number }).damage ?? PLAYER_PROJECTILE_DAMAGE;
    projectile.destroy();

    this.enemyHealth.takeDamage(damage);
    this.enemyHealthText.setText(`${this.enemyHealth.value}`);

    if (this.enemyHealth.isDead) {
      this.enemyAlive = false;
      this.enemy.destroy();
      this.enemyHealthText.destroy();
      this.time.delayedCall(ENEMY_RESPAWN_DELAY_MS, () => this.spawnEnemy());
    }
  }

  private handlePlayerHit(projectile: Phaser.GameObjects.Arc): void {
    const damage = (projectile as unknown as { damage: number }).damage ?? ENEMY_PROJECTILE_DAMAGE;
    projectile.destroy();

    this.playerHealth.takeDamage(damage);
    this.playerHealthText.setText(`HP: ${this.playerHealth.value}`);

    if (this.playerHealth.isDead) {
      this.playerHealth.reset();
      this.playerHealthText.setText(`HP: ${this.playerHealth.value}`);
    }
  }
}
