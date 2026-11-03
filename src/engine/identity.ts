import { piiHmac } from "./hash";

export class UnionFind {
  private parent = new Map<string, string>();
  private marks = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    this.add(id);
    let current = id;
    while (this.parent.get(current) !== current) current = this.parent.get(current)!;
    let cursor = id;
    while (cursor !== current) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, current);
      cursor = next;
    }
    return current;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    this.parent.set(ra, rb);
    const marks = (this.marks.get(ra) ?? 0) + (this.marks.get(rb) ?? 0);
    this.marks.delete(ra);
    if (marks) this.marks.set(rb, marks);
  }

  /** Mark a node as a visit. The flag follows the component across later unions. */
  mark(id: string): void {
    const root = this.find(id);
    this.marks.set(root, (this.marks.get(root) ?? 0) + 1);
  }

  marked(id: string): boolean {
    return (this.marks.get(this.find(id)) ?? 0) > 0;
  }
}

export function nodeKey(type: string, raw: string): string {
  return `${type}:${piiHmac(raw)}`;
}
