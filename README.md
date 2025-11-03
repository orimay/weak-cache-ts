# weak-cache-ts

A lightweight, garbage-collectable cache library for TypeScript/JavaScript using
WeakRefs and FinalizationRegistry. `weak-cache-ts` provides two classes:
`WeakCache` for synchronous caching and `WeakCacheAsync` for asynchronous
loading scenarios. This package is designed to store objects efficiently without
strong references, allowing the garbage collector to reclaim memory when items
are no longer in use elsewhere. It's ideal for caching resources like DOM
elements, database connections, API responses, or computed objects in
performance-critical applications, reducing memory footprint and preventing
leaks.

Key features include:

- **GC-Friendly Caching**: Uses WeakRef to hold items, enabling automatic
  cleanup when objects are GC'd.
- **Synchronous & Asynchronous Support**: `WeakCache` for sync loaders;
  `WeakCacheAsync` handles promises for loads and inits.
- **Deduplication**: Prevents duplicate loads in async scenarios by tracking
  pending promises.
- **Flexible Keys**: Supports string or symbol keys for versatile
  identification.
- **Safe Insertion Modes**: `set` (throws on conflict), `trySet` (no-op on
  conflict), `forceSet` (overwrite).
- **Introspection**: Access current keys via `ids` getter.
- **No Dependencies**: Pure JS/TS implementation, compatible with browsers
  (ES2021+) and Node.js (v14+).
- **Type-Safe**: Generic types for items and ids, with full JSDoc for IDE
  support.

This library shines in scenarios like client-side rendering (e.g., caching
components), server-side data fetching, or any system managing transient
objects. It helps optimize resource usage, improve responsiveness, and simplify
memory management in modern JS ecosystems.

> **Note:** Requires ES2021 features (WeakRef, FinalizationRegistry). Polyfills
> may be needed for older environments. Items must be objects; primitives are
> not supported due to WeakRef limitations.

## Installation

Install via your favorite package manager:

```bash
npm install weak-cache-ts
# or
yarn add weak-cache-ts
# or
pnpm add weak-cache-ts
# or
bun add weak-cache-ts
```

## Usage

Import the classes and create instances with your loader functions. Below are
detailed examples.

### WeakCache (Synchronous)

For sync loading scenarios.

```typescript
import { WeakCache } from 'weak-cache-ts';

const cache = new WeakCache((id: string) => {
  console.log(`Loading ${id}`);
  return { value: id.toUpperCase() };
});

const item1 = cache.get('foo');
console.log(item1.value); // 'FOO' (loads)

const item2 = cache.get('foo');
console.log(item2.value); // 'FOO' (cached, no load)

cache.trySet('bar', { value: 'BAR' });
const item3 = cache.get('bar');
console.log(item3.value); // 'BAR'

console.log(cache.ids); // ['foo', 'bar']

cache.del('foo'); // Manual delete
```

With custom create and init:

```typescript
const item = cache.get(
  'baz',
  () => ({ value: '' }),
  item => {
    item.value = 'Initialized';
  },
);
console.log(item.value); // 'Initialized'
```

### WeakCacheAsync (Asynchronous)

For async loading scenarios.

```typescript
import { WeakCacheAsync } from 'weak-cache-ts';

const cache = new WeakCacheAsync(async (id: string) => {
  console.log(`Async loading ${id}`);
  await new Promise(resolve => setTimeout(resolve, 100));
  return { value: id.toUpperCase() };
});

const item1 = await cache.get('foo');
console.log(item1.value); // 'FOO' (loads async)

const item2 = await cache.get('foo');
console.log(item2.value); // 'FOO' (cached)

const pending = cache.get('bar'); // Starts load
const item3 = await cache.get('bar'); // Awaits same pending load
console.log(item3.value); // 'BAR'

console.log(cache.tryGet('baz')); // null (not cached)

await cache.trySet('qux', { value: 'QUX' }); // No-op if conflicting
const item4 = await cache.get('qux');
console.log(item4.value); // 'QUX'

cache.forceSet('foo', { value: 'NEW' });
const item5 = await cache.get('foo');
console.log(item5.value); // 'NEW' (overwritten)

console.log(cache.ids); // Current keys
```

With async create and init:

```typescript
const item = await cache.get(
  'baz',
  async () => {
    await someAsyncOp();
    return { value: '' };
  },
  async item => {
    item.value = await fetchValue();
  },
);
```

## Important Notes

- **Memory Management**: Items are weakly held; if no strong references exist
  elsewhere, they can be GC'd, and the cache entry auto-removes.
- **Error Handling**: Loaders should handle their own errors. `set` methods
  throw on conflicts for safety.
- **Performance**: WeakRefs have minimal overhead but check `deref()` on access.
  Use in hot paths judiciously.
- **Compatibility**: Ensure runtime supports WeakRef/FinalizationRegistry. For
  Node.js <14 or old browsers, consider alternatives.
- **Best Practices**: Use symbols for keys to avoid collisions. Avoid caching
  non-objects.
- **Integration**: Combines well with libraries like React (for component
  caching), Apollo (data normalization), or Node.js clusters.

For full API details, refer to the JSDoc in the source code.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Authors

- Dmitrii Baranov <dmitrii.a.baranov@gmail.com>

## Contributing

Contributions welcome! Open issues/PRs on GitHub for features, bugs, or
improvements.

## Why weak-cache-ts?

In memory-intensive apps, traditional Maps can cause leaks by holding strong
references. `weak-cache-ts` solves this with weak semantics, enabling scalable
caching. It's modern, type-safe, and async-ready—perfect for next-gen JS/TS
projects. Star the repo to boost its visibility!
