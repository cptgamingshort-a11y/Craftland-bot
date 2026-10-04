export class RateLimiter {
  private entries = new Map<string, number[]>();
  constructor(
    private limit = 5,
    private windowMs = 60000,
  ) {}
  allow(key: string, now = Date.now()): boolean {
    if (this.entries.size > 10000)
      for (const [k, values] of this.entries)
        if ((values.at(-1) ?? 0) < now - this.windowMs) this.entries.delete(k);
    const times = (this.entries.get(key) ?? []).filter(
      (t) => t > now - this.windowMs,
    );
    if (times.length >= this.limit) return false;
    times.push(now);
    this.entries.set(key, times);
    return true;
  }
}
