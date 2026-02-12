import type { LibraryAdapter } from "../types.js";
import { presets } from "./presets.js";
import { suite as componentSuite } from "./suites/component.js";
import { suite as entitySuite } from "./suites/entity.js";
import { suite as querySuite } from "./suites/query.js";

export const iris: LibraryAdapter = {
  name: "iris",
  presets,
  suites: [entitySuite, componentSuite, querySuite],
};
