/**
 * Damage/health resolution shared by anything that can be hit, starting
 * with the AC-1.1.2 demo target and later reused by real enemies (US-1.2)
 * and the God Gun's instant-defeat effect (US-2.1).
 */
export class Health {
  private current: number;

  constructor(private readonly max: number) {
    this.current = max;
  }

  get value(): number {
    return this.current;
  }

  get isDead(): boolean {
    return this.current <= 0;
  }

  takeDamage(amount: number): void {
    if (amount <= 0) return;
    this.current = Math.max(0, this.current - amount);
  }

  reset(): void {
    this.current = this.max;
  }
}
