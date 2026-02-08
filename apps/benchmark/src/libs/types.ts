import type { PresetFactory, PresetName, Suite } from "../types.js";

export type LibraryAdapter = {
  name: string;
  presets: Record<PresetName, PresetFactory>;
  suites: Suite[];
  /**
   * Called before discarding a world. Libraries that limit concurrent worlds
   * can use this to free resources. Libraries without cleanup needs can omit.
   */
  // biome-ignore lint/suspicious/noExplicitAny: world type varies per library adapter
  teardown?: (world: any) => void;
};
