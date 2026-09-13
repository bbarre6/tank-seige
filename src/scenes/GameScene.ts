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
const ENEMY_RESPAWN_DELAY_MS = 1500; // delay before a replacement spawns in to keep the current wave topped up

const PROJECTILE_LIFESPAN_MS = 1500;

type EnemyColor = "red" | "purple" | "blue" | "gold" | "boss";
type RegularColor = Exclude<EnemyColor, "boss">;

interface EnemyTier {
  color: EnemyColor;
  tint: number;
  label: string;
  maxHealth: number;
  damage: number;
  speed: number;
  fireCooldownMs: number;
}

// Level order: red(1) -> blue(2) -> purple(3) -> gold(4) -> boss(5), then
// repeats. Regular tiers keep damage below PLAYER_PROJECTILE_DAMAGE so the
// player always out-damages them; the boss is the deliberate exception.
const ENEMY_TIERS: Record<EnemyColor, EnemyTier> = {
  red: { color: "red", tint: 0xe53935, label: "1", maxHealth: 30, damage: 3, speed: 80, fireCooldownMs: 1500 },
  blue: { color: "blue", tint: 0x2196f3, label: "2", maxHealth: 60, damage: 5, speed: 95, fireCooldownMs: 1200 },
  purple: { color: "purple", tint: 0x9c27b0, label: "3", maxHealth: 100, damage: 7, speed: 110, fireCooldownMs: 950 },
  gold: { color: "gold", tint: 0xffc400, label: "4", maxHealth: 150, damage: 9, speed: 125, fireCooldownMs: 750 },
  boss: {
    color: "boss",
    tint: 0x1a1a1a,
    label: "BOSS",
    maxHealth: 500,
    damage: 50, // intentionally exceeds PLAYER_PROJECTILE_DAMAGE, unlike every regular tier
    speed: 90,
    fireCooldownMs: 1000,
  },
};

const LEVEL_COLOR_SEQUENCE: RegularColor[] = ["red", "blue", "purple", "gold"];
const KILLS_TO_ADVANCE = 5; // a boss level only ever needs 1 kill (itself)
const CONCURRENT_ENEMIES_PER_LEVEL = 3;
const SESSION_LENGTH = LEVEL_COLOR_SEQUENCE.length + 1; // one lap of red/blue/purple/gold/boss = one "session"
const SESSION_ANNOUNCEMENT_DURATION_MS = 1000;
const LEVEL_TRANSITION_DELAY_MS = 2000; // pause between a level clearing and the next one's enemies spawning in

// Every level cleared makes newly-spawned regular-tier enemies a bit
// tougher, applied only at spawn time (existing enemies aren't
// retroactively buffed) -- so the game gets harder each time you loop
// back around through red -> blue -> purple -> gold -> boss.
const LEVEL_HEALTH_SCALE_PER_CLEAR = 0.15;
const LEVEL_SPEED_SCALE_PER_CLEAR = 0.05;
const LEVEL_SPEED_SCALE_CAP = 1.6;
const LEVEL_FIRE_RATE_SCALE_PER_CLEAR = 0.05;
const LEVEL_FIRE_RATE_SCALE_FLOOR = 0.5;
const LEVEL_DAMAGE_PER_CLEAR = 0.4; // still hard-capped below PLAYER_PROJECTILE_DAMAGE, see getScaledTier

const BOSS_SCALE = TANK_SCALE * 1.6;

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
 * Enemies now come in sequential single-color waves, not the real wave
 * spawner (US-1.2 will replace this with a proper system): level 1 spawns
 * only red tanks, level 2 only blue, 3 purple, 4 gold, and level 5 spawns a
 * single boss -- then it repeats from level 6 (red again, but tougher).
 * Defeating KILLS_TO_ADVANCE tanks (or the boss, which only takes 1)
 * clears the level; any stragglers of the old color are removed and the
 * next level's wave spawns in after a short pause. The player has no
 * game-over flow yet, so it simply respawns at full health when defeated.
 */
export class GameScene extends Phaser.Scene {
  private tank!: Phaser.GameObjects.Image & { body: Phaser.Physics.Arcade.Body };
  private turretSprite!: Phaser.GameObjects.Image;
  private tankFacing: Vector2 = { x: 1, y: 0 }; // matches the hull/turret art's neutral "facing right" orientation
  private playerHealth = new Health(PLAYER_MAX_HEALTH);
  private playerHealthText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private playerProjectiles!: Phaser.Physics.Arcade.Group;

  private enemies: EnemyInstance[] = [];
  private enemyHullKey!: string;
  private enemyTurretKey!: string;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private totalLevelsCleared = 0; // persists across cycles; drives stat scaling
  private killsThisLevel = 0;

  private moveStick = new Joystick(JOYSTICK_RADIUS);
  private aimStick = new Joystick(JOYSTICK_RADIUS);
  private moveVector: Vector2 = { x: 0, y: 0 };
  private aimTouchPointerId: number | null = null;
  private moveTouchPointerId: number | null = null;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private lastFiredAt = 0;
  private lastSpaceFiredAt = 0;

  private isPaused = false;
  private pauseButtonBg!: Phaser.GameObjects.Rectangle;
  private pauseButtonText!: Phaser.GameObjects.Text;
  private pauseOverlay!: Phaser.GameObjects.Rectangle;
  private pauseMenuContainer!: Phaser.GameObjects.Container;
  private sessionsMenuContainer!: Phaser.GameObjects.Container;

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

    this.levelText = this.add
      .text(16, 40, `Level: ${this.getLevelNumber()}`, {
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
    this.playerProjectiles = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();

    this.startLevel();

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
    this.pauseKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);

    this.pauseOverlay = this.add
      .rectangle(0, 0, width, height, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(10)
      .setVisible(false);

    this.pauseMenuContainer = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(11).setVisible(false);
    const pauseTitle = this.add.text(0, -80, "PAUSED", { fontFamily: "monospace", fontSize: "32px", color: "#ffffff" }).setOrigin(0.5);
    const resumeButton = this.createMenuButton(0, -10, "Resume", () => this.togglePause());
    const sessionsButton = this.createMenuButton(0, 40, "Sessions", () => this.showSessionsView());
    this.pauseMenuContainer.add([pauseTitle, resumeButton.bg, resumeButton.text, sessionsButton.bg, sessionsButton.text]);

    this.sessionsMenuContainer = this.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(11).setVisible(false);

    // Always-visible on-screen button to open the pause menu -- P is the
    // desktop shortcut, but touch/mobile players have no keyboard at all.
    const pauseButton = this.createMenuButton(width - 60, 30, "Pause", () => this.togglePause());
    this.pauseButtonBg = pauseButton.bg.setScrollFactor(0).setDepth(2);
    this.pauseButtonText = pauseButton.text.setScrollFactor(0).setDepth(2);

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
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.togglePause();
    }
    if (this.isPaused) return;

    this.updateMoveVector();
    this.applyMovement(delta);
    this.updateTankVisuals();
    this.updateEnemyAI();

    if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
      this.fireAtEnemy();
    }
  }

  private togglePause(): void {
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      this.physics.pause();
      this.time.paused = true;
      this.pauseMenuContainer.setVisible(true);
    } else {
      this.physics.resume();
      this.time.paused = false;
      this.pauseMenuContainer.setVisible(false);
    }

    this.pauseOverlay.setVisible(this.isPaused);
    this.sessionsMenuContainer.setVisible(false); // always land back on the main pause view
    this.pauseButtonBg.setVisible(!this.isPaused);
    this.pauseButtonText.setVisible(!this.isPaused);
  }

  private createMenuButton(x: number, y: number, label: string, onClick: () => void): { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    const text = this.add.text(x, y, label, { fontFamily: "monospace", fontSize: "20px", color: "#ffffff" }).setOrigin(0.5);
    const bg = this.add.rectangle(x, y, text.width + 32, text.height + 16, 0x2e7d32).setStrokeStyle(2, 0xffffff);
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerover", () => bg.setFillStyle(0x388e3c));
    bg.on("pointerout", () => bg.setFillStyle(0x2e7d32));
    bg.on("pointerdown", onClick);
    return { bg, text };
  }

  private showSessionsView(): void {
    this.pauseMenuContainer.setVisible(false);
    this.rebuildSessionsView();
    this.sessionsMenuContainer.setVisible(true);
  }

  /** Rebuilt each time it's opened, since session progress changes as you play. */
  private rebuildSessionsView(): void {
    this.sessionsMenuContainer.removeAll(true);

    const completed = this.getCompletedSessionCount();
    const current = this.getCurrentSessionNumber();
    const windowSize = 6;
    const start = Math.max(1, current - 2);
    const end = start + windowSize - 1;
    const rowHeight = 30;

    const elements: Phaser.GameObjects.GameObject[] = [];
    elements.push(this.add.text(0, -150, "SESSIONS", { fontFamily: "monospace", fontSize: "26px", color: "#ffffff" }).setOrigin(0.5));

    let y = -100;
    if (start > 1) {
      elements.push(this.add.text(0, y, "...", { fontFamily: "monospace", fontSize: "16px", color: "#9e9e9e" }).setOrigin(0.5));
      y += rowHeight;
    }

    for (let session = start; session <= end; session++) {
      const status = session <= completed ? "Done" : session === current ? "In Progress" : "Not Done";
      const color = session <= completed ? "#8bc34a" : session === current ? "#ffeb3b" : "#9e9e9e";
      const marker = session <= completed ? "✓" : session === current ? "▶" : "•";
      elements.push(
        this.add
          .text(0, y, `${marker}  Session ${session}  —  ${status}`, { fontFamily: "monospace", fontSize: "16px", color })
          .setOrigin(0.5)
      );
      y += rowHeight;
    }

    elements.push(this.add.text(0, y, "...", { fontFamily: "monospace", fontSize: "16px", color: "#9e9e9e" }).setOrigin(0.5));
    y += rowHeight + 20;

    const back = this.createMenuButton(0, y, "Back", () => {
      this.sessionsMenuContainer.setVisible(false);
      this.pauseMenuContainer.setVisible(true);
    });
    elements.push(back.bg, back.text);

    this.sessionsMenuContainer.add(elements);
  }

  /** A "session" is one lap of SESSION_LENGTH levels (red -> blue -> purple -> gold -> boss). */
  private getCompletedSessionCount(): number {
    return Math.floor(this.totalLevelsCleared / SESSION_LENGTH);
  }

  private getCurrentSessionNumber(): number {
    return this.getCompletedSessionCount() + 1;
  }

  private getLevelNumber(): number {
    return this.totalLevelsCleared + 1;
  }

  private getCurrentLevelColor(): EnemyColor {
    const position = this.totalLevelsCleared % (LEVEL_COLOR_SEQUENCE.length + 1); // +1 slot for the boss
    return position === LEVEL_COLOR_SEQUENCE.length ? "boss" : LEVEL_COLOR_SEQUENCE[position];
  }

  private getKillsRequiredForCurrentLevel(): number {
    return this.getCurrentLevelColor() === "boss" ? 1 : KILLS_TO_ADVANCE;
  }

  /** Spawns the current level's wave: a boss alone, or a batch of the level's color. */
  private startLevel(): void {
    this.killsThisLevel = 0;
    this.levelText.setText(`Level: ${this.getLevelNumber()}`);

    if (this.totalLevelsCleared % SESSION_LENGTH === 0) {
      this.showSessionAnnouncement(this.getCurrentSessionNumber());
    }

    const color = this.getCurrentLevelColor();
    if (color === "boss") {
      this.spawnBoss();
    } else {
      for (let i = 0; i < CONCURRENT_ENEMIES_PER_LEVEL; i++) {
        this.spawnEnemy(color);
      }
    }
  }

  /** Banner shown for SESSION_ANNOUNCEMENT_DURATION_MS at the start of every session (including the first). */
  private showSessionAnnouncement(sessionNumber: number): void {
    const { width, height } = this.scale;
    const banner = this.add
      .text(width / 2, height / 2, `SESSION ${sessionNumber}`, {
        fontFamily: "monospace",
        fontSize: "40px",
        color: "#ffeb3b",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(20);

    this.time.delayedCall(SESSION_ANNOUNCEMENT_DURATION_MS, () => banner.destroy());
  }

  private clearAllEnemies(): void {
    for (const enemy of this.enemies) {
      enemy.hull.destroy();
      enemy.turret.destroy();
      enemy.healthText.destroy();
    }
    this.enemies = [];
  }

  /** Scales a base tier's stats up by levels cleared so far, applied at spawn time only. */
  private getScaledTier(baseTier: EnemyTier, levelsCleared: number): EnemyTier {
    const healthMultiplier = 1 + levelsCleared * LEVEL_HEALTH_SCALE_PER_CLEAR;
    const speedMultiplier = Math.min(1 + levelsCleared * LEVEL_SPEED_SCALE_PER_CLEAR, LEVEL_SPEED_SCALE_CAP);
    const fireRateMultiplier = Math.max(1 - levelsCleared * LEVEL_FIRE_RATE_SCALE_PER_CLEAR, LEVEL_FIRE_RATE_SCALE_FLOOR);
    const damage = Math.min(baseTier.damage + levelsCleared * LEVEL_DAMAGE_PER_CLEAR, PLAYER_PROJECTILE_DAMAGE - 1);

    return {
      ...baseTier,
      maxHealth: Math.round(baseTier.maxHealth * healthMultiplier),
      speed: Math.round(baseTier.speed * speedMultiplier),
      fireCooldownMs: Math.round(baseTier.fireCooldownMs * fireRateMultiplier),
      damage: Math.round(damage),
    };
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

  private spawnEnemy(color: RegularColor): void {
    const tier = this.getScaledTier(ENEMY_TIERS[color], this.totalLevelsCleared);
    this.createEnemyInstance(tier, TANK_SCALE, 32, "#ffffff", "14px");
  }

  /** Fixed stats, not scaled by levels cleared -- see ENEMY_TIERS.boss. */
  private spawnBoss(): void {
    this.createEnemyInstance(ENEMY_TIERS.boss, BOSS_SCALE, 40, "#ff5252", "18px");
  }

  private createEnemyInstance(tier: EnemyTier, scale: number, labelOffsetY: number, textColor: string, fontSize: string): EnemyInstance {
    const { width, height } = this.scale;
    const x = Phaser.Math.Between(width * 0.55, width * 0.95);
    const y = Phaser.Math.Between(height * 0.1, height * 0.9);

    const hull = this.add.image(x, y, this.enemyHullKey).setScale(scale).setTint(tier.tint) as EnemyHullSprite;
    this.physics.add.existing(hull);
    hull.body.setCollideWorldBounds(true);
    hull.setDepth(0);
    this.enemyGroup.add(hull);

    const turret = this.add.image(x, y, this.enemyTurretKey).setScale(scale).setTint(tier.tint).setDepth(1);

    const health = new Health(tier.maxHealth);
    const healthText = this.add
      .text(x, y - labelOffsetY, `${tier.label} ${health.value}`, {
        fontFamily: "monospace",
        fontSize,
        color: textColor,
      })
      .setOrigin(0.5)
      .setDepth(2);

    const instance: EnemyInstance = { hull, turret, healthText, health, tier, lastFiredAt: 0 };
    (hull as unknown as { enemyInstance: EnemyInstance }).enemyInstance = instance;

    this.enemies.push(instance);
    return instance;
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
    if (this.isPaused) return; // touch/mouse fire are event-driven, not gated by update()'s early return

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
    if (!instance.health.isDead) return;

    this.enemies.splice(index, 1);
    instance.hull.destroy();
    instance.turret.destroy();
    instance.healthText.destroy();

    this.killsThisLevel += 1;
    if (this.killsThisLevel < this.getKillsRequiredForCurrentLevel()) {
      // Keep the current wave topped up until the level's kill quota is reached.
      const color = this.getCurrentLevelColor();
      if (color !== "boss") {
        this.time.delayedCall(ENEMY_RESPAWN_DELAY_MS, () => this.spawnEnemy(color));
      }
      return;
    }

    // Level cleared: drop any stragglers of the old color and move on.
    this.totalLevelsCleared += 1;
    this.clearAllEnemies();
    this.time.delayedCall(LEVEL_TRANSITION_DELAY_MS, () => this.startLevel());
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
