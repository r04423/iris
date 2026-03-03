import { Button } from "../ui/button.js";
import { Separator } from "../ui/separator.js";

// ============================================================================
// Panel Header
// ============================================================================

type PanelHeaderProps = {
  onClose: () => void;
};

/** @internal */
export function PanelHeader({ onClose }: PanelHeaderProps) {
  return (
    <div>
      <div className="idt:flex idt:items-center idt:justify-between idt:px-3 idt:h-8">
        <div className="idt:flex idt:items-center idt:gap-1.5">
          <span className="idt:text-primary">&#9670;</span>
          <span className="idt:font-semibold idt:text-foreground idt:text-xs">Iris DevTools</span>
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close DevTools">
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>
      <Separator />
    </div>
  );
}
