import { useStore } from "zustand";
import type { DevToolsStore } from "../store.js";
import { Button } from "../ui/button.js";
import { EntityListPanel } from "./entity-list-panel.js";
import { PanelHeader } from "./panel-header.js";

// ============================================================================
// DevTools Root
// ============================================================================

type DevToolsRootProps = {
  store: DevToolsStore;
};

/** @internal */
export function DevToolsRoot({ store }: DevToolsRootProps) {
  const expanded = useStore(store, (s) => s.expanded);
  const setExpanded = useStore(store, (s) => s.setExpanded);

  if (!expanded) {
    return (
      <Button
        variant="outline"
        onClick={() => setExpanded(true)}
        className="idt:fixed idt:bottom-4 idt:right-4 idt:z-[99999] idt:h-auto idt:rounded-full idt:px-3 idt:py-1.5 idt:shadow-lg hover:idt:shadow-xl idt:transition-all idt:gap-1.5 idt:text-xs"
      >
        <span className="idt:text-primary">&#9670;</span>
        <span>Iris</span>
      </Button>
    );
  }

  return (
    <div className="idt:fixed idt:bottom-4 idt:right-4 idt:z-[99999] idt:w-[360px] idt:h-[480px] idt:bg-background idt:border idt:border-border idt:rounded-xl idt:shadow-2xl idt:flex idt:flex-col idt:overflow-hidden idt:text-foreground idt:text-xs">
      <PanelHeader onClose={() => setExpanded(false)} />
      <EntityListPanel store={store} />
    </div>
  );
}
