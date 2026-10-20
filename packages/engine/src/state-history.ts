// Every table state the page has been sent, so a spectator can step back and look at what just happened (VIK-135). Pure: no DOM, tested alone.
// The page is either live (showing the newest state) or reviewing (showing an older one while newer ones keep arriving behind it).

export class StateHistory<T> {
  private items: T[] = [];
  /** The index being looked at while reviewing, or undefined when live. */
  private at: number | undefined;

  constructor(private readonly limit = 500) {}

  get length(): number {
    return this.items.length;
  }

  get reviewing(): boolean {
    return this.at !== undefined;
  }

  /** The 1-based place being looked at, out of `length`: the newest when live. */
  get position(): number {
    return (this.at ?? this.items.length - 1) + 1;
  }

  /** A new state arrived. Returns it when the page should show it now (live), or undefined when a reviewer is looking at an older one. */
  push(state: T): T | undefined {
    this.items.push(state);
    if (this.items.length > this.limit) {
      this.items.shift();
      if (this.at !== undefined) this.at = Math.max(0, this.at - 1);
    }
    return this.at === undefined ? state : undefined;
  }

  /** One state back, starting a review at the one before the newest. Undefined when there is nothing earlier. */
  back(): T | undefined {
    const from = this.at ?? this.items.length - 1;
    if (from <= 0) return undefined;
    this.at = from - 1;
    return this.items[this.at];
  }

  /** One state forward while reviewing; reaching the newest makes the page live again. Undefined when not reviewing. */
  forward(): T | undefined {
    if (this.at === undefined) return undefined;
    const next = this.at + 1;
    if (next >= this.items.length - 1) this.at = undefined;
    else this.at = next;
    return this.items[next];
  }

  /** Stop reviewing and return the newest state (undefined if there is none). */
  live(): T | undefined {
    this.at = undefined;
    return this.items.at(-1);
  }
}
