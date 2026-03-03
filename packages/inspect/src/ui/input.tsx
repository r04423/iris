import type * as React from "react";

import { cn } from "../lib/utils.js";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "idt:h-9 idt:w-full idt:min-w-0 idt:rounded-md idt:border idt:border-input idt:bg-transparent idt:px-3 idt:py-1 idt:text-base idt:shadow-xs idt:transition-[color,box-shadow] idt:outline-none idt:selection:bg-primary idt:selection:text-primary-foreground idt:file:inline-flex idt:file:h-7 idt:file:border-0 idt:file:bg-transparent idt:file:text-sm idt:file:font-medium idt:file:text-foreground idt:placeholder:text-muted-foreground idt:disabled:pointer-events-none idt:disabled:cursor-not-allowed idt:disabled:opacity-50 idt:md:text-sm idt:dark:bg-input/30",
        "idt:focus-visible:border-ring idt:focus-visible:ring-[3px] idt:focus-visible:ring-ring/50",
        "idt:aria-invalid:border-destructive idt:aria-invalid:ring-destructive/20 idt:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  );
}

export { Input };
