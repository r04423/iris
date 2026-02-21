# Space Shooter

[Play it live](https://r04423.github.io/iris/space-shooter/)

A space combat game built with [iris-ecs](../../packages/ecs). Enemies chase the player, bullets
destroy enemies, collisions activate a shield. All game state lives in ECS components and resources.

## Running

```bash
pnpm --filter iris-space-shooter dev
```

## Module Overview

| Module | Responsibility |
|--------|----------------|
| `input/` | DOM events -> Iris events -> InputState resource -> per-entity Input component |
| `combat/` | Shooting, bullet lifecycle, bullet-enemy collisions, shield activation |
| `enemy/` | Spawning, AI (follow + avoidance), explosions, auto-rotation |
| `player/` | Player entity setup, config resource |
| `physics/` | Velocity/force integration, spatial hashing for broad-phase collision |
| `render/` | 2D canvas drawing + WebGL post-processing (bloom, scanlines, vignette) |
| `shared/` | Cross-domain components (Transform, Movement, Visual, Time) and relations |

## Pipeline

```
First -> PreUpdate -> Update -> Combat -> Physics -> PostUpdate -> Last
```

- **First** -- delta time
- **PreUpdate** -- read DOM input events, write Input component
- **Update** -- AI, player movement, shooting, enemy pushing
- **Combat** -- bullet movement, collision detection, event responses
- **Physics** -- velocity integration, spatial hash rebuild
- **PostUpdate** -- shield blink, explosion animation
- **Last** -- render all entities to canvas
