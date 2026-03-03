import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// ============================================================================
// Class Name Utility
// ============================================================================

/**
 * Merges class names with Tailwind CSS conflict resolution.
 *
 * @internal
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
