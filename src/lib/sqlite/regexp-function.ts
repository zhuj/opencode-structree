import type { SqlDatabase, SqlValue } from "./driver.ts";

/** A bounded cache for the supplied REGEXP helper; patterns remain trusted application input. */
export class RegexpFunction {
  private readonly cache = new Map<string, { expression: RegExp | null; expires: number }>();

  register(db: SqlDatabase): boolean {
    if (db.function === undefined) return false;
    db.function("regexp", { deterministic: true }, (pattern: SqlValue, value: SqlValue) => {
      if (
        typeof pattern !== "string" ||
        typeof value !== "string" ||
        pattern.length > 100 ||
        value.length > 16_384
      )
        return 0;
      let cached = this.cache.get(pattern);
      if (cached !== undefined && cached.expires <= Date.now()) {
        this.cache.delete(pattern);
        cached = undefined;
      }
      if (cached === undefined) {
        let expression: RegExp | null = null;
        // Reject the common nested-quantifier trap. This is not a general regex sandbox.
        if (!/\([^)]*[+*{][^)]*\)\s*[+*?{]/.test(pattern)) {
          try {
            expression = new RegExp(pattern);
          } catch {
            /* Invalid patterns simply do not match. */
          }
        }
        cached = { expression, expires: Date.now() + 5 * 60_000 };
      }
      this.cache.delete(pattern);
      this.cache.set(pattern, cached);
      if (this.cache.size > 100) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      return Number(cached.expression?.test(value) ?? false);
    });
    return true;
  }
}
