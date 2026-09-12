export interface Vector2 {
  x: number;
  y: number;
}

export interface JoystickState {
  vector: Vector2; // normalized direction, magnitude 0..1
  magnitude: number; // 0..1, 0 when idle
}

const IDLE_STATE: JoystickState = { vector: { x: 0, y: 0 }, magnitude: 0 };

/**
 * Pure vector-math core for a virtual joystick. Given a fixed base position
 * and the current drag position, produces a direction + magnitude clamped
 * to the joystick's radius. Has no knowledge of Phaser or DOM events so it
 * can be unit tested directly (AC-1.1.1).
 */
export class Joystick {
  private base: Vector2 | null = null;

  constructor(private readonly radius: number) {}

  start(position: Vector2): void {
    this.base = position;
  }

  move(position: Vector2): JoystickState {
    if (!this.base) return IDLE_STATE;

    const dx = position.x - this.base.x;
    const dy = position.y - this.base.y;
    const distance = Math.hypot(dx, dy);

    if (distance === 0) return IDLE_STATE;

    const magnitude = Math.min(distance, this.radius) / this.radius;
    return {
      vector: { x: dx / distance, y: dy / distance },
      magnitude,
    };
  }

  end(): JoystickState {
    this.base = null;
    return IDLE_STATE;
  }

  get active(): boolean {
    return this.base !== null;
  }
}
