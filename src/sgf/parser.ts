import type { SgfGame, SgfNode, SgfColor } from "./types.js";

class Reader {
  private index = 0;
  constructor(private readonly input: string) {}

  parseCollection(): SgfNode {
    this.skipWhitespace();
    if (this.peek() !== "(") throw new Error("SGF collection must start with '('");
    const root = this.parseGameTree();
    this.skipWhitespace();
    if (this.index !== this.input.length) throw new Error(`Unexpected trailing SGF at offset ${this.index}`);
    return root;
  }

  private parseGameTree(): SgfNode {
    this.expect("(");
    this.skipWhitespace();
    const sequence: SgfNode[] = [];
    while (this.peek() === ";") {
      sequence.push(this.parseNode());
      this.skipWhitespace();
    }
    if (sequence.length === 0) throw new Error("SGF game tree contains no nodes");
    for (let i = 0; i < sequence.length - 1; i++) sequence[i]!.children.push(sequence[i + 1]!);

    const last = sequence[sequence.length - 1]!;
    while (this.peek() === "(") {
      last.children.push(this.parseGameTree());
      this.skipWhitespace();
    }
    this.expect(")");
    return sequence[0]!;
  }

  private parseNode(): SgfNode {
    this.expect(";");
    const properties: Record<string, string[]> = {};
    this.skipWhitespace();
    while (/[A-Z]/.test(this.peek() ?? "")) {
      const start = this.index;
      while (/[A-Z]/.test(this.peek() ?? "")) this.index++;
      const key = this.input.slice(start, this.index);
      const values: string[] = [];
      this.skipWhitespace();
      while (this.peek() === "[") {
        values.push(this.parseValue());
        this.skipWhitespace();
      }
      if (values.length === 0) throw new Error(`SGF property ${key} has no value`);
      properties[key] = [...(properties[key] ?? []), ...values];
    }
    return { properties, children: [] };
  }

  private parseValue(): string {
    this.expect("[");
    let value = "";
    while (this.index < this.input.length) {
      const char = this.input[this.index++]!;
      if (char === "]") return value;
      if (char === "\\") {
        if (this.index >= this.input.length) break;
        const escaped = this.input[this.index++]!;
        if (escaped === "\r") {
          if (this.peek() === "\n") this.index++;
        } else if (escaped !== "\n") {
          value += escaped;
        }
      } else {
        value += char;
      }
    }
    throw new Error("Unterminated SGF property value");
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.peek() ?? "")) this.index++;
  }
  private peek(): string | undefined { return this.input[this.index]; }
  private expect(char: string): void {
    if (this.peek() !== char) throw new Error(`Expected '${char}' at offset ${this.index}`);
    this.index++;
  }
}

function first(values: string[] | undefined): string | undefined {
  return values?.[0];
}

function parseCoord(raw: string, boardSize: number): { x: number; y: number } | null {
  if (raw === "" || raw === "tt") return null;
  if (raw.length !== 2) throw new Error(`Invalid SGF coordinate: ${raw}`);
  const x = raw.charCodeAt(0) - 97;
  const y = raw.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) {
    throw new Error(`Coordinate outside ${boardSize}x${boardSize} board: ${raw}`);
  }
  return { x, y };
}

export function parseSgf(sgf: string): SgfGame {
  const root = new Reader(sgf.trim()).parseCollection();
  const size = Number(first(root.properties.SZ) ?? "19");
  if (!Number.isInteger(size) || size < 2 || size > 25) throw new Error(`Unsupported board size: ${size}`);

  const setup: SgfGame["setup"] = [];
  for (const [property, color] of [["AB", "B"], ["AW", "W"]] as const) {
    for (const coord of root.properties[property] ?? []) {
      const point = parseCoord(coord, size);
      if (point) setup.push({ color, ...point });
    }
  }

  const explicitPlayer = first(root.properties.PL);
  let initialPlayer: SgfColor;
  if (explicitPlayer === "B" || explicitPlayer === "W") {
    initialPlayer = explicitPlayer;
  } else {
    let node: SgfNode | undefined = root;
    let inferred: SgfColor = "B";
    while (node) {
      if (node.properties.B) { inferred = "B"; break; }
      if (node.properties.W) { inferred = "W"; break; }
      node = node.children[0];
    }
    initialPlayer = inferred;
  }

  return { boardSize: size, initialPlayer, setup, root };
}

export function readMove(node: SgfNode, boardSize: number): { color: SgfColor; x: number; y: number } | null {
  const color: SgfColor | null = node.properties.B ? "B" : node.properties.W ? "W" : null;
  if (!color) return null;
  const raw = first(node.properties[color]);
  const point = parseCoord(raw ?? "", boardSize);
  if (!point) return null;
  return { color, ...point };
}
