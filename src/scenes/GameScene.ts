import Phaser from "phaser";
import { Joystick, type Vector2 } from "../gameplay/input/Joystick";
import { spawnProjectile } from "../gameplay/combat/Projectile";
import { Health } from "../gameplay/combat/Health";
import { ensureTankTextures, ensureEnemyTankTextures } from "../gameplay/render/TankTextures";
import { ensureGroundTexture } from "../gameplay/render/GroundTexture";

const TANK_SPEED = 220; // px/s
const TANK_SCALE = 1.5;
const JOYSTICK_RADIUS = 60;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_PROJECTILE_SPEED = 520;
const PLAYER_PROJECTILE_DAMAGE = 10;
const PLAYER_FIRE_COOLDOWN_MS = 200;
const SPACE_FIRE_COOLDOWN_MS = 300; // separate cap on the spacebar auto-fire shortcut

const ENEMY_PROJECTILE_SPEED = 260;
const ENEMY_PROJECTILE_DAMAGE_FALLBACK = 5;
const ENEMY_PREFERRED_DISTANCE = 260; // holds roughly this far from the player to shoot from
const ENEMY_DISTANCE_DEADZONE = 20;
const ENEMY_RESPAWN_DELAY_MS = 1500;

const PROJECTILE_LIFESPAN_MS = 1500;

type EnemyColor = "red" | "purple" | "blue" | "gold";

interface EnemyTier {
  color: EnemyColor;
  tint: number;
  label: string;
  maxHealth: number;
  damage: number; // kept below PLAYER_PROJECTILE_DAMAGE at every tier, so the player always out-damages enemies
  speed: number;
  fireCooldownMs: number;
}

// Red = easy, purple = medium, blue = harder, gold = hard: health, damage,
// speed, and fire rate all scale up together with tier difficulty.
const ENEMY_TIERS: Record<EnemyColor, EnemyTier> = {
  red: { color: "red", tint: 0xe53935, label: "Easy", maxHealth: 30, damage: 3, speed: 80, fireCooldownMs: 1500 },
  purple: { color: "purple", tint: 0x9c27b0, label: "Medium", maxHealth: 60, damage: 5, speed: 95, fireCooldownMs: 1200 },
  blue: { color: "blue", tint: 0x2196f3, label: "Harder", maxHealth: 100, damage: 7, speed: 110, fireCooldownMs: 950 },
  gold: { color: "gold", tint: 0xffc400, label: "Hard", maxHealth: 150, damage: 9, speed: 125, fireCooldownMs: 750 },
};
const ENEMY_COLORS: EnemyColor[] = ["red", "purple", "blue", "gold"];

type EnemyHullSprite = Phaser.GameObjects.Image & { body: Phaser.Physics.Arcade.Body };

interface EnemyInstance {
  hull: EnemyHullSprite;
  turret: Phaser.GameObjects.Image;
  healthText: Phaser.GameObjects.Text;
  health: Health;
  tier: EnemyTier;
  lastFiredAt: number;
}

/**
 * US-1.1: basic tank movement (AC-1.1.1) and independent aim/fire (AC-1.1.2).
 * Supports both a touch virtual joystick (left = move, right = aim/fire,
 * release-to-fire) and desktop WASD + mouse (click to fire), since the PRD
 * targets both desktop and mobile web.
 *
 * Multiple enemy tanks are on the field at once, each with simple chase-and-
 * shoot AI and a color-coded difficulty tier (ENEMY_TIERS) -- not the real
 * wave spawner (US-1.2 will replace this with proper wave-based spawning).
 * Every tier deals less damage than the player by design. Defeating an
 * enemy destroys it and a new, randomly-tiered one respawns elsewhere after
 * a short delay, keeping the field populated since there's no wave/win-
 * condition system yet. The player has no game-over flow yet either, so it
 * simply respawns at full health when defeated.
 */
export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Image & { body: Phaser.Physics.Arcade.Body };
  private turretSprite!: Phaser.GameObjects.Image;
  private tankFacing: Vector2 = { x: 1, y: 0 }; // matches the hull/turret art's neutral "facing right" orientation
  private playerHealth = new Health(PLAYER_MAX_HEALTH);
  private playerHealthText!: Phaser.GameObjects.Text;
  private playerProjectiles!: Phaser.Physics.Arcade.Group;

  private enemies: EnemyInstance[] = [];
  private enemyHullKey!: string;
  private enemyTurretKey!: string;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;

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

    const groundKey = ensureGroundTexture(this);
    this.add.tileSprite(0, 0, width, height, groundKey).setOrigin(0, 0).setDepth(-1);

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
      .setScrollFactor(0)
      .setDepth(2);

    const enemyTextures = ensureEnemyTankTextures(this);
    this.enemyHullKey = enemyTextures.hullKey;
    this.enemyTurretKey = enemyTextures.turretKey;

    this.enemyGroup = this.physics.add.group();
    for (const color of ENEMY_COLORS) {
      this.spawnEnemy(color);
    }

    this.playerProjectiles = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();

    // Group-vs-Group overlap: Phaser preserves argument order here (unlike
    // the Group-vs-single-object case below, where the single object is
    // always reordered to come first), so the playerProjectiles member is
    // the first callback argument and the enemyGroup member is the second.
    this.physics.add.overlap(this.playerProjectiles, this.enemyGroup, (projectile, enemyHull) => {
      this.handleEnemyHit(projectile as Phaser.GameObjects.Arc, enemyHull as Phaser.GameObjects.GameObject);
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

  /** Spacebar: fire at most once per SPACE_FIRE_COOLDOWN_MS, auto-aimed at the nearest enemy. */
  private fireAtEnemy(): void {
    const target = this.findNearestEnemy();
    if (!target) return;

    const now = this.time.now;
    if (now - this.lastSpaceFiredAt < SPACE_FIRE_COOLDOWN_MS) return;

    const dx = target.hull.x - this.tank.x;
    const dy = target.hull.y - this.tank.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;

    this.lastSpaceFiredAt = now;
    this.tankFacing = { x: dx / distance, y: dy / distance };
    this.fireToward({ x: target.hull.x, y: target.hull.y });
  }

  private findNearestEnemy(): EnemyInstance | null {
    let nearest: EnemyInstance | null = null;
    let nearestDistance = Infinity;

    for (const enemy of this.enemies) {
      const distance = Math.hypot(enemy.hull.x - this.tank.x, enemy.hull.y - this.tank.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }

    return nearest;
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

  private spawnEnemy(color: EnemyColor): void {
    const tier = ENEMY_TIERS[color];
    const { width, height } = this.scale;
    const x = Phaser.Math.Between(width * 0.55, width * 0.95);
    const y = Phaser.Math.Between(height * 0.1, height * 0.9);

    const hull = this.add.image(x, y, this.enemyHullKey).setScale(TANK_SCALE).setTint(tier.tint) as EnemyHullSprite;
    this.physics.add.existing(hull);
    hull.body.setCollideWorldBounds(true);
    hull.setDepth(0);
    this.enemyGroup.add(hull);

    const turret = this.add.image(x, y, this.enemyTurretKey).setScale(TANK_SCALE).setTint(tier.tint).setDepth(1);

    const health = new Health(tier.maxHealth);
    const healthText = this.add
      .text(x, y - 32, `${tier.label} ${health.value}`, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setDepth(2);

    const instance: EnemyInstance = { hull, turret, healthText, health, tier, lastFiredAt: 0 };
    (hull as unknown as { enemyInstance: EnemyInstance }).enemyInstance = instance;

    this.enemies.push(instance);
  }

  private updateEnemyAI(): void {
    const now = this.time.now;

    for (const enemy of this.enemies) {
      const dx = this.tank.x - enemy.hull.x;
      const dy = this.tank.y - enemy.hull.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) continue;

      const toPlayer = { x: dx / distance, y: dy / distance };
      const speed = enemy.tier.speed;

      if (distance > ENEMY_PREFERRED_DISTANCE + ENEMY_DISTANCE_DEADZONE) {
        enemy.hull.body.setVelocity(toPlayer.x * speed, toPlayer.y * speed);
        enemy.hull.rotation = Math.atan2(toPlayer.y, toPlayer.x);
      } else if (distance < ENEMY_PREFERRED_DISTANCE - ENEMY_DISTANCE_DEADZONE) {
        enemy.hull.body.setVelocity(-toPlayer.x * speed, -toPlayer.y * speed);
        enemy.hull.rotation = Math.atan2(-toPlayer.y, -toPlayer.x);
      } else {
        enemy.hull.body.setVelocity(0, 0);
      }

      // Turret always tracks the player, independent of hull facing.
      enemy.turret.setPosition(enemy.hull.x, enemy.hull.y);
      enemy.turret.rotation = Math.atan2(toPlayer.y, toPlayer.x);
      enemy.healthText.setPosition(enemy.hull.x, enemy.hull.y - 32);

      if (now - enemy.lastFiredAt < enemy.tier.fireCooldownMs) continue;
      enemy.lastFiredAt = now;

      const spawn = spawnProjectile({ x: enemy.hull.x, y: enemy.hull.y }, toPlayer, ENEMY_PROJECTILE_SPEED, enemy.tier.damage);
      const projectile = this.add.circle(spawn.x, spawn.y, 5, enemy.tier.tint);
      this.enemyProjectiles.add(projectile);
      const body = projectile.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(spawn.velocityX, spawn.velocityY);
      (projectile as unknown as { damage: number }).damage = spawn.damage;

      this.time.delayedCall(PROJECTILE_LIFESPAN_MS, () => projectile.destroy());
    }
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

  private handleEnemyHit(projectile: Phaser.GameObjects.Arc, enemyHull: Phaser.GameObjects.GameObject): void {
    const damage = (projectile as unknown as { damage: number }).damage ?? PLAYER_PROJECTILE_DAMAGE;
    projectile.destroy();

    const instance = (enemyHull as unknown as { enemyInstance?: EnemyInstance }).enemyInstance;
    if (!instance) return;

    const index = this.enemies.indexOf(instance);
    if (index === -1) return; // already defeated by another projectile this frame

    instance.health.takeDamage(damage);
    instance.healthText.setText(`${instance.tier.label} ${instance.health.value}`);

    if (instance.health.isDead) {
      this.enemies.splice(index, 1);
      instance.hull.destroy();
      instance.turret.destroy();
      instance.healthText.destroy();
      this.time.delayedCall(ENEMY_RESPAWN_DELAY_MS, () => this.spawnEnemy(Phaser.Utils.Array.GetRandom(ENEMY_COLORS)));
    }
  }

  private handlePlayerHit(projectile: Phaser.GameObjects.Arc): void {
    const damage = (projectile as unknown as { damage: number }).damage ?? ENEMY_PROJECTILE_DAMAGE_FALLBACK;
    projectile.destroy();

    this.playerHealth.takeDamage(damage);
    this.playerHealthText.setText(`HP: ${this.playerHealth.value}`);

    if (this.playerHealth.isDead) {
      this.playerHealth.reset();
      this.playerHealthText.setText(`HP: ${this.playerHealth.value}`);
    }
  }
}
