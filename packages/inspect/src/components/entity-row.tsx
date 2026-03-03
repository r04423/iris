import { extractId, isPair } from "iris-ecs";
import type { EntitySnapshot } from "../types.js";
import { TableCell, TableRow } from "../ui/table.js";

// ============================================================================
// Entity Row
// ============================================================================

type EntityRowProps = {
  entity: EntitySnapshot;
};

/** @internal */
export function EntityRow({ entity }: EntityRowProps) {
  const rawId = isPair(entity.id) ? 0 : extractId(entity.id);
  const paddedId = String(rawId).padStart(3, "0");

  return (
    <TableRow>
      <TableCell className="idt:py-1 idt:font-mono idt:text-xs idt:text-muted-foreground">#{paddedId}</TableCell>
      <TableCell className="idt:py-1">
        {entity.name ?? <span className="idt:text-muted-foreground idt:italic">(unnamed)</span>}
      </TableCell>
      <TableCell className="idt:py-1 idt:text-right idt:tabular-nums idt:text-muted-foreground idt:pr-3 idt:font-mono idt:text-xs">
        {entity.componentCount}c
      </TableCell>
    </TableRow>
  );
}
