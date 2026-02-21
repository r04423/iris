type Cell = Set<number>;

// Grid-based spatial index for broad-phase collision detection. Divides 2D
// space into fixed-size cells so nearby-entity queries only check a small
// neighborhood instead of every entity in the world.
export class SpatialHashMap {
  cellSize: number;
  private cells = new Map<string, Cell>();
  private entityToCell = new Map<number, Cell>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  setEntity(entity: number, x: number, y: number): void {
    const cell = this.getCell(x, y);

    // Remove from previous cell if known
    const oldCell = this.entityToCell.get(entity);

    if (oldCell) {
      if (oldCell === cell) return;
      oldCell.delete(entity);
    }

    cell.add(entity);
    this.entityToCell.set(entity, cell);
  }

  removeEntity(entity: number): void {
    const cell = this.entityToCell.get(entity);
    cell?.delete(entity);
    this.entityToCell.delete(entity);
  }

  // Find entities within radius by scanning the AABB of cells that overlap
  // the query circle. Callers do the precise distance check themselves.
  getNearbyEntities(x: number, y: number, radius: number, entities: number[] = [], maxEntities = Infinity): number[] {
    let count = 0;
    entities.length = 0;

    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const cell = this.getCell(cx * this.cellSize, cy * this.cellSize);

        for (const entity of cell) {
          entities.push(entity);
          count++;

          if (count >= maxEntities) return entities;
        }
      }
    }

    return entities;
  }

  reset(): void {
    this.cells.clear();
    this.entityToCell.clear();
  }

  // Lazily allocate cells on first access to avoid pre-allocating the grid.
  private getCell(x: number, y: number): Cell {
    const hash = this.calculateHash(x, y);

    if (!this.cells.has(hash)) {
      this.cells.set(hash, new Set());
    }

    return this.cells.get(hash)!;
  }

  // String keys because Map doesn't support composite numeric keys.
  private calculateHash(x: number, y: number): string {
    const hx = Math.floor(x / this.cellSize);
    const hy = Math.floor(y / this.cellSize);

    return `${hx}:${hy}`;
  }
}
