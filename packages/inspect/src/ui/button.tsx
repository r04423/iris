import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "../lib/utils.js";

const buttonVariants = cva(
  "idt:inline-flex idt:shrink-0 idt:items-center idt:justify-center idt:gap-2 idt:rounded-md idt:text-sm idt:font-medium idt:whitespace-nowrap idt:transition-all idt:outline-none idt:focus-visible:border-ring idt:focus-visible:ring-[3px] idt:focus-visible:ring-ring/50 idt:disabled:pointer-events-none idt:disabled:opacity-50 idt:aria-invalid:border-destructive idt:aria-invalid:ring-destructive/20 idt:dark:aria-invalid:ring-destructive/40 idt:[&_svg]:pointer-events-none idt:[&_svg]:shrink-0 idt:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "idt:bg-primary idt:text-primary-foreground idt:hover:bg-primary/90",
        destructive:
          "idt:bg-destructive idt:text-white idt:hover:bg-destructive/90 idt:focus-visible:ring-destructive/20 idt:dark:bg-destructive/60 idt:dark:focus-visible:ring-destructive/40",
        outline:
          "idt:border idt:bg-background idt:shadow-xs idt:hover:bg-accent idt:hover:text-accent-foreground idt:dark:border-input idt:dark:bg-input/30 idt:dark:hover:bg-input/50",
        secondary: "idt:bg-secondary idt:text-secondary-foreground idt:hover:bg-secondary/80",
        ghost: "idt:hover:bg-accent idt:hover:text-accent-foreground idt:dark:hover:bg-accent/50",
        link: "idt:text-primary idt:underline-offset-4 idt:hover:underline",
      },
      size: {
        default: "idt:h-9 idt:px-4 idt:py-2 idt:has-[>svg]:px-3",
        xs: "idt:h-6 idt:gap-1 idt:rounded-md idt:px-2 idt:text-xs idt:has-[>svg]:px-1.5 idt:[&_svg:not([class*=size-])]:size-3",
        sm: "idt:h-8 idt:gap-1.5 idt:rounded-md idt:px-3 idt:has-[>svg]:px-2.5",
        lg: "idt:h-10 idt:rounded-md idt:px-6 idt:has-[>svg]:px-4",
        icon: "idt:size-9",
        "icon-xs": "idt:size-6 idt:rounded-md idt:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "idt:size-8",
        "icon-lg": "idt:size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
