# weak-cache-ts

Lightweight, GC-friendly cache for TypeScript/JavaScript. Values are held via `WeakRef` and
automatically cleaned up when garbage collected. Zero dependencies.

- **Automatic cleanup**: Cached values disappear when no longer referenced
- **Perfect deduplication**: Concurrent async requests share one load operation
- **Watch support**: Subscribe to value changes per key
- **Type-safe**: Full TypeScript generics for keys and values

## Installation

```bash
npm install weak-cache-ts
```

## WeakCache

Synchronous cache for expensive-to-create objects.

```typescript
import { WeakCache } from 'weak-cache-ts';

const cache = new WeakCache(id => {
  console.log(`Creating ${id}`);
  return { data: expensiveComputation(id) };
});

const a = cache.get('key'); // Creates
const b = cache.get('key'); // Returns same instance
console.log(a === b); // true

// Peek without triggering load
const maybe = cache.peek('key'); // Item | undefined

// Force replace
cache.forceSet('key', newValue);

// Watch for changes
cache.watch('key', item => console.log('Updated:', item));
cache.unwatch('key', callback);

// Inspect
console.log(cache.size); // number
console.log(cache.ids); // Id[]
console.log(cache.has('key')); // boolean
for (const [id, item] of cache.entries()) {
  /* ... */
}
```

## WeakCacheAsync

Asynchronous cache with promise deduplication.

```typescript
import { WeakCacheAsync } from 'weak-cache-ts';

const cache = new WeakCacheAsync(async id => {
  const res = await fetch(`/api/${id}`);
  return await res.json();
});

// Concurrent requests = single network call
const [a, b] = await Promise.all([cache.get('user-1'), cache.get('user-1')]);
console.log(a === b); // true

// Peek without triggering load
const maybe = cache.peek('user-1'); // Item | undefined

// Force replace (cancels pending load)
cache.forceSet('user-1', freshData);

// Delete (cancels pending load)
cache.del('user-1');
```

## API Reference

### WeakCache

| Member                    | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `get(id, create?, init?)` | Retrieve or create a cached value                |
| `peek(id)`                | Inspect cache without triggering load            |
| `trySet(id, item)`        | Insert only if key is free, returns `boolean`    |
| `forceSet(id, item)`      | Replace value unconditionally, returns `boolean` |
| `del(id)`                 | Remove entry immediately                         |
| `watch(id, callback)`     | Subscribe to value changes (fires immediately)   |
| `unwatch(id, callback)`   | Unsubscribe from value changes                   |
| `clear()`                 | Remove all entries and watchers                  |
| `has(id)`                 | Whether key has a live value                     |
| `entries()`               | Iterate over live `[id, item]` pairs             |
| `size`                    | Approximate count of live entries                |
| `ids`                     | Array of keys with live values                   |

### WeakCacheAsync

| Member                    | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `get(id, create?, init?)` | Retrieve or load a cached value (async)              |
| `peek(id)`                | Inspect cache without triggering load                |
| `trySet(id, item)`        | Insert only if no value and no pending load          |
| `forceSet(id, item)`      | Replace value and cancel pending load                |
| `del(id)`                 | Remove entry and cancel pending load                 |
| `watch(id, callback)`     | Subscribe to value changes (fires on load)           |
| `unwatch(id, callback)`   | Unsubscribe from value changes                       |
| `clear()`                 | Remove all entries, pending loads, and watchers      |
| `has(id)`                 | Whether key has a live, fully loaded value           |
| `entries()`               | Iterate over live `[id, item]` pairs                 |
| `size`                    | Approximate count of live entries (excludes pending) |
| `ids`                     | Array of keys with live values (excludes pending)    |
| `tryGet(id)`              | Deprecated: use `peek()` instead                     |

## Notes

- Only objects can be cached (`WeakRef` requirement). Wrap primitives: `{ value: 42 }` instead of
  `42`.
- `size` and `ids` are snapshots — values may be GC'd at any time.
- Loader errors propagate to the caller; nothing is cached on failure.

## License

MIT
