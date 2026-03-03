import { useMemo } from "react";
import { useStore } from "zustand";
import { filterEntities } from "../lib/filter-entities.js";
import type { DevToolsStore } from "../store.js";
import { Input } from "../ui/input.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "../ui/table.js";
import { EntityRow } from "./entity-row.js";

// ============================================================================
// Entity List Panel
// ============================================================================

type EntityListPanelProps = {
  store: DevToolsStore;
};

/** @internal */
export function EntityListPanel({ store }: EntityListPanelProps) {
  const entities = useStore(store, (s) => s.entities);
  const entityCount = useStore(store, (s) => s.entityCount);
  const searchQuery = useStore(store, (s) => s.searchQuery);
  const setSearchQuery = useStore(store, (s) => s.setSearchQuery);

  const allEntities = useMemo(() => Array.from(entities.values()), [entities]);

  const filtered = useMemo(() => filterEntities(allEntities, searchQuery), [allEntities, searchQuery]);

  return (
    <div className="idt:flex idt:flex-col idt:flex-1 idt:min-h-0">
      <div className="idt:flex idt:items-center idt:gap-2 idt:px-3 idt:py-1.5 idt:border-b idt:border-border">
        <Input
          placeholder="Filter entities..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="idt:h-7 idt:text-xs idt:md:text-xs idt:bg-muted"
        />
        <span className="idt:text-xs idt:text-muted-foreground idt:tabular-nums idt:shrink-0">{entityCount}</span>
      </div>
      <ScrollArea className="idt:flex-1 idt:min-h-0">
        <Table className="idt:text-xs">
          <TableHeader className="idt:sticky idt:top-0 idt:bg-background idt:z-10">
            <TableRow className="hover:idt:bg-transparent">
              <TableHead className="idt:w-[3rem] idt:h-6 idt:text-xs idt:text-muted-foreground idt:font-normal">
                ID
              </TableHead>
              <TableHead className="idt:h-6 idt:text-xs idt:text-muted-foreground idt:font-normal">Name</TableHead>
              <TableHead className="idt:w-8 idt:h-6 idt:text-xs idt:text-muted-foreground idt:font-normal idt:text-right idt:pr-3">
                #
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((entity) => (
              <EntityRow key={entity.id} entity={entity} />
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
