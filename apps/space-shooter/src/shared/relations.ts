import { defineRelation } from "iris-ecs";

// Enemy targets player (exclusive -- only one target at a time)
export const Targeting = defineRelation("Targeting", { exclusive: true });

// Bullet was fired by player (for scoring/attribution)
export const FiredBy = defineRelation("FiredBy");
