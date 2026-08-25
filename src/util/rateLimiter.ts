/**
 * Token bucket plus a hard daily budget.
 *
 * eBay's Browse quota is 5,000 calls per DAY, per application, and the window
 * does not slide — once it is gone it is gone until reset. A retry loop bug
 * can drain it in minutes, so the budget is enforced here, before the request
 * goes out, rather than being discovered from a 429.
 */

export interface RateLimiterOptions {
  /** Sustained calls per second. */
  ratePerSecond: number;
  /** Burst size. */
  burst: number;
  /** Hard ceiling per UTC day. */
  dailyBudget: number;
}

export class DailyBudgetExceeded extends Error {
  constructor(readonly used: number, readonly budget: number) {
    super(`Daily API budget exhausted (${used}/${budget}). It resets at midnight UTC.`);
    this.name = 'DailyBudgetExceeded';
  }
}

export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private dayKey = utcDayKey();
  private usedToday = 0;

  constructor(private readonly opts: RateLimiterOptions) {
    this.tokens = opts.burst;
  }

  /** Calls consumed so far today, and what remains. */
  status(): { usedToday: number; dailyBudget: number; remaining: number } {
    this.rolloverIfNeeded();
    return {
      usedToday: this.usedToday,
      dailyBudget: this.opts.dailyBudget,
      remaining: Math.max(0, this.opts.dailyBudget - this.usedToday),
    };
  }

  /** Waits for a token. Throws DailyBudgetExceeded rather than blocking forever. */
  async acquire(cost = 1): Promise<void> {
    this.rolloverIfNeeded();
    if (this.usedToday + cost > this.opts.dailyBudget) {
      throw new DailyBudgetExceeded(this.usedToday, this.opts.dailyBudget);
    }

    for (;;) {
      this.refill();
      if (this.tokens >= cost) {
        this.tokens -= cost;
        this.usedToday += cost;
        return;
      }
      const deficit = cost - this.tokens;
      const waitMs = Math.ceil((deficit / this.opts.ratePerSecond) * 1000);
      await sleep(Math.min(waitMs, 5_000));
    }
  }

  /** Records usage that happened outside acquire (e.g. a retried request). */
  charge(cost: number): void {
    this.rolloverIfNeeded();
    this.usedToday += cost;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.lastRefill = now;
    this.tokens = Math.min(this.opts.burst, this.tokens + elapsedSec * this.opts.ratePerSecond);
  }

  private rolloverIfNeeded(): void {
    const key = utcDayKey();
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.usedToday = 0;
    }
  }
}

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
