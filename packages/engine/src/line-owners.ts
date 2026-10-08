const LIMIT = 1000;

/**
 * Which lines and turns a page plays. A page showing everyone plays everything; a page showing one persona plays only the
 * lines that named it (decided by the first message of each line) and the turns that name it.
 */
export class LineOwners {
  private readonly owners = new Map<string, string | undefined>();

  constructor(private readonly persona?: string) {}

  get size(): number {
    return this.owners.size;
  }

  /** A line was announced (its first message carries the persona, if any). Later messages of the same line change nothing. */
  see(id: string, persona: string | undefined): void {
    if (this.owners.has(id)) return;
    this.owners.set(id, persona);
    if (this.owners.size > LIMIT) this.owners.delete(this.owners.keys().next().value as string);
  }

  /** Is this line to be played by this page? */
  mine(id: string): boolean {
    if (this.persona === undefined) return true;
    return this.owners.get(id) === this.persona;
  }

  /** Is this turn this page's persona's? A page showing everyone shows every turn. */
  turnIsMine(persona: string | undefined): boolean {
    return this.persona === undefined || persona === this.persona;
  }

  forget(id: string): void {
    this.owners.delete(id);
  }
}
