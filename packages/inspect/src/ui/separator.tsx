import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils.js";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "idt:shrink-0 idt:bg-border idt:data-[orientation=horizontal]:h-px idt:data-[orientation=horizontal]:w-full idt:data-[orientation=vertical]:h-full idt:data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
