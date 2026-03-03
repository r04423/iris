import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils.js";

const badgeVariants = cva(
  "idt:inline-flex idt:w-fit idt:shrink-0 idt:items-center idt:justify-center idt:gap-1 idt:overflow-hidden idt:rounded-full idt:border idt:border-transparent idt:px-2 idt:py-0.5 idt:text-xs idt:font-medium idt:whitespace-nowrap idt:transition-[color,box-shadow] idt:focus-visible:border-ring idt:focus-visible:ring-[3px] idt:focus-visible:ring-ring/50 idt:aria-invalid:border-destructive idt:aria-invalid:ring-destructive/20 idt:dark:aria-invalid:ring-destructive/40 idt:[&>svg]:pointer-events-none idt:[&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "idt:bg-primary idt:text-primary-foreground idt:[a&]:hover:bg-primary/90",
        secondary: "idt:bg-secondary idt:text-secondary-foreground idt:[a&]:hover:bg-secondary/90",
        destructive:
          "idt:bg-destructive idt:text-white idt:focus-visible:ring-destructive/20 idt:dark:bg-destructive/60 idt:dark:focus-visible:ring-destructive/40 idt:[a&]:hover:bg-destructive/90",
        outline: "idt:border-border idt:text-foreground idt:[a&]:hover:bg-accent idt:[a&]:hover:text-accent-foreground",
        ghost: "idt:[a&]:hover:bg-accent idt:[a&]:hover:text-accent-foreground",
        link: "idt:text-primary idt:underline-offset-4 idt:[a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
