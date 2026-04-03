---
name: schema
description: Schema type factories -- Type.f32, Type.i32, Type.u32, Type.string, Type.object, TypedArray mapping, vector fields
metadata:
  tags: schema, Type, f32, i32, u32, f64, i8, i16, bool, string, object, TypedArray, vector
---

# Schema Types

Schema types control how component and relation fields are stored. Numeric types map to TypedArrays. Non-numeric types use plain Arrays.

```typescript
import { Type } from "iris-ecs";
```

## Type Factories

| Factory | Storage | Range / Values |
|---------|---------|----------------|
| `Type.i8()` | `Int8Array` | -128 to 127 |
| `Type.i16()` | `Int16Array` | -32,768 to 32,767 |
| `Type.i32()` | `Int32Array` | -2,147,483,648 to 2,147,483,647 |
| `Type.u32()` | `Uint32Array` | 0 to 4,294,967,295 |
| `Type.f32()` | `Float32Array` | 32-bit float (~7 decimal digits) |
| `Type.f64()` | `Float64Array` | 64-bit float (~15 decimal digits) |
| `Type.bool()` | `Array` | `true` / `false` |
| `Type.string()` | `Array` | arbitrary strings |
| `Type.object<T>()` | `Array` | arbitrary objects |

Each call returns a new `Schema` descriptor. TypeScript infers the field type from the factory -- `Type.f32()` infers `number`, `Type.string()` infers `string`, `Type.object<Vec3>()` infers `Vec3`.

## Vector Fields

All numeric type factories accept an optional size parameter (2-16) to create vector fields. Vector fields store multiple elements per entity interleaved in a single TypedArray column (`[x0,y0,x1,y1,...]`).

```typescript
Type.f32()   // Schema<number>           -- scalar, kind: "typed"
Type.f32(2)  // Schema<[number, number]> -- vector, kind: "vector", stride: 2
Type.f32(3)  // Schema<[number, number, number]> -- vec3
```

TypeScript infers fixed-length tuple types: `Type.f32(2)` infers `[number, number]`, `Type.i32(4)` infers `[number, number, number, number]`. Sizes below 2 or above 16 throw `InvalidArgument` at runtime.

Only numeric factories support vector fields. `Type.bool()`, `Type.string()`, and `Type.object<T>()` do not accept a size parameter.

Vector fields use dedicated access functions -- see [components.md](./components.md) for `getComponentVectorValue`, `setComponentVectorValue`, `getComponentVectorView` and [resources.md](./resources.md) for `getResourceVectorValue`, `setResourceVectorValue`, `getResourceVectorView`.

## Choosing a Type

Use the smallest numeric type that fits your data. Smaller types mean denser TypedArray columns and better cache utilization during iteration.

`Type.bool()`, `Type.string()`, and `Type.object<T>()` use plain `Array` storage -- they work but don't benefit from TypedArray performance.

`Type.object<T>()` is for data that can't be decomposed into flat fields (variable-length arrays, nested structures). Each slot holds a JS object reference.

## See Also

- [components.md](./components.md) -- `defineComponent` schemas and field access
- [relations.md](./relations.md) -- data relations with typed schemas
