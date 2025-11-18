# weak-cache-ts

A lightweight, garbage-collector-friendly cache library for
TypeScript/JavaScript that automatically cleans up unused objects. Built on
modern JavaScript features (WeakRef and FinalizationRegistry), `weak-cache-ts`
provides intelligent caching without memory leaks.

Perfect for caching expensive objects like DOM nodes, API responses, decoded
images, database results, or computed values—all while letting the garbage
collector reclaim memory when objects are no longer needed.

## Why weak-cache-ts?

Traditional caches using `Map` or `Object` keep strong references to cached
values, preventing garbage collection even when those values are no longer used
anywhere else in your application. This leads to memory leaks and bloat.

**weak-cache-ts solves this elegantly:**

- **Automatic cleanup**: Values are held weakly and disappear when garbage
  collected
- **Zero memory leaks**: No need to manually track and clean up cache entries
- **Perfect deduplication**: Concurrent requests for the same resource share one
  load operation
- **Type-safe**: Full TypeScript support with comprehensive generics
- **Async-ready**: Built-in promise deduplication for network requests and I/O
- **Zero dependencies**: Lightweight, modern JavaScript implementation

## Installation

```bash
npm install weak-cache-ts
```

Or with your preferred package manager:

```bash
yarn add weak-cache-ts
pnpm add weak-cache-ts
bun add weak-cache-ts
```

**Requirements:**

- Node.js 14+ or modern browsers (ES2021+)
- WeakRef and FinalizationRegistry support (available in all modern
  environments)

## Quick Start

### Synchronous Caching with WeakCache

Use `WeakCache` when your loader function returns values immediately:

```typescript
import { WeakCache } from 'weak-cache-ts';

// Cache expensive DOM element creation
const componentCache = new WeakCache(id => {
  console.log(`Creating component ${id}`);
  const element = document.createElement('div');
  element.id = id;
  element.className = 'expensive-component';
  // ... expensive setup ...
  return element;
});

const comp1 = componentCache.get('header'); // Creates element
const comp2 = componentCache.get('header'); // Returns same instance
console.log(comp1 === comp2); // true

console.log(componentCache.size); // 1
console.log(componentCache.ids); // ['header']
```

### Asynchronous Caching with WeakCacheAsync

Use `WeakCacheAsync` for network requests, file I/O, or any async operation:

```typescript
import { WeakCacheAsync } from 'weak-cache-ts';

// Cache API responses with automatic deduplication
const avatarCache = new WeakCacheAsync(async userId => {
  console.log(`Fetching avatar for ${userId}`);
  const response = await fetch(`/api/avatars/${userId}`);
  const blob = await response.blob();
  return {
    url: response.url,
    bitmap: await createImageBitmap(blob),
  };
});

// Multiple concurrent requests = single network call
const [avatar1, avatar2, avatar3] = await Promise.all([
  avatarCache.get('alice'),
  avatarCache.get('alice'),
  avatarCache.get('alice'),
]);

console.log('Only one fetch!');
console.log(avatar1 === avatar2 && avatar2 === avatar3); // true
```

## Core Concepts

### Weak References and Garbage Collection

Objects cached by `weak-cache-ts` are held with **weak references**. This means:

1. **You control lifetime**: Objects stay alive as long as _your code_ holds
   references to them
2. **Automatic cleanup**: When you release all references, the GC can collect
   the object
3. **Cache cleans itself**: Collected objects automatically disappear from the
   cache
4. **No manual management**: No need to call `delete()` or track object
   lifetimes

```typescript
const cache = new WeakCache(id => ({ data: id }));

let obj = cache.get('key'); // Object created and cached
// ... use obj ...
obj = null; // Release your reference

// Later: GC runs, object is collected, cache entry removed automatically
```

### Perfect Deduplication

`WeakCacheAsync` ensures that concurrent requests for the same key share a
single load operation:

```typescript
const expensiveCache = new WeakCacheAsync(async id => {
  await new Promise(r => setTimeout(r, 1000)); // Simulate slow operation
  return { data: `Loaded ${id}` };
});

// All three calls happen simultaneously
const start = Date.now();
const [a, b, c] = await Promise.all([
  expensiveCache.get('resource'),
  expensiveCache.get('resource'),
  expensiveCache.get('resource'),
]);

console.log(`Took ${Date.now() - start}ms`); // ~1000ms, not 3000ms!
console.log(a === b && b === c); // true - same object instance
```

## API Reference

### WeakCache<Item, Id>

A synchronous cache for expensive-to-create objects.

#### Constructor

```typescript
new WeakCache<Item, Id>(loader: (id: Id) => Item)
```

Creates a cache with a loader function that returns objects synchronously.

**Parameters:**

- `loader`: Function called when a value is missing or has been garbage
  collected

**Example:**

```typescript
const cache = new WeakCache(userId => {
  return decodeUserData(fetchUserSync(userId));
});
```

#### Methods

##### get(id, create?, init?)

Retrieves a cached value or creates it on demand.

```typescript
get(
  id: Id,
  create?: () => Item,
  init?: (item: Item) => void
): Item
```

**Parameters:**

- `id`: Cache key
- `create`: Optional one-time factory override (doesn't affect future calls)
- `init`: Optional post-creation initializer

**Returns:** The cached or newly created object

**Examples:**

```typescript
// Basic usage
const user = cache.get('user-123');

// One-time override with initialization
const admin = cache.get(
  'admin',
  () => createSpecialUser(),
  user => {
    user.isAdmin = true;
    user.addEventListener('change', handleAdminChange);
  },
);
```

##### peek(id)

Inspects the cache without triggering a load.

```typescript
peek(id: Id): Item | undefined
```

**Returns:** The cached value if present and alive, otherwise `undefined`

**Example:**

```typescript
const user = cache.peek('user-123');
if (user) {
  // Already cached, use immediately
  renderUser(user);
} else {
  // Not cached, show loading state
  showLoadingSpinner();
}
```

##### trySet(id, item)

Inserts a value only if the key is free.

```typescript
trySet(id: Id, item: Item): boolean
```

**Returns:** `true` if inserted, `false` if key already has a value

**Example:**

```typescript
// Speculative preloading
const preloaded = expensiveOperation();
if (cache.trySet('key', preloaded)) {
  console.log('Successfully cached');
} else {
  console.log('Already cached, discarding preload');
}
```

##### forceSet(id, item)

Forcefully replaces a cached value.

```typescript
forceSet(id: Id, item: Item): boolean
```

**Returns:** `true` if an existing value was replaced

**Example:**

```typescript
// Manual cache invalidation
const fresh = await refetchData();
cache.forceSet('key', fresh);
```

##### del(id)

Removes an entry from the cache immediately.

```typescript
del(id: Id): void
```

**Example:**

```typescript
// User logged out, remove their data
cache.del('user-123');
```

##### watch(id, callback)

Subscribes to value changes for a key.

```typescript
watch(id: Id, onSet: (item: Item) => void): void
```

The callback fires:

- Immediately (loads the value if needed)
- Every time a new instance appears (after GC + recreation, or after
  `forceSet()`)

**Example:**

```typescript
// Auto-update UI when value changes
cache.watch('user', user => {
  document.getElementById('username').textContent = user.name;
});
```

##### unwatch(id, callback)

Removes a watcher.

```typescript
unwatch(id: Id, onSet: (item: Item) => void): void
```

**Example:**

```typescript
const handleUpdate = user => updateUI(user);

cache.watch('user', handleUpdate);
// Later...
cache.unwatch('user', handleUpdate);
```

##### clear()

Removes all cached values and watchers.

```typescript
clear(): void
```

**Example:**

```typescript
// Reset cache on app reload
cache.clear();
```

##### has(id)

Checks whether a key has a live cached value.

```typescript
has(id: Id): boolean
```

**Example:**

```typescript
if (cache.has('user-123')) {
  showCachedData();
}
```

##### entries()

Iterates over currently live cache entries.

```typescript
entries(): Iterable<[Id, Item]>
```

**Example:**

```typescript
for (const [id, user] of cache.entries()) {
  console.log(`${id}: ${user.name}`);
}
```

#### Properties

##### size

Approximate count of currently cached objects (snapshot, may become stale).

```typescript
readonly size: number
```

##### ids

Array of all keys that currently have live cached values (snapshot).

```typescript
readonly ids: Id[]
```

---

### WeakCacheAsync<Item, Id>

An asynchronous cache with promise deduplication for network requests, I/O, and
async operations.

#### Constructor

```typescript
new WeakCacheAsync<Item, Id>(loader: (id: Id) => Item | Promise<Item>)
```

Creates an async cache with a loader that can return synchronously or
asynchronously.

**Parameters:**

- `loader`: Factory function returning a value or promise

**Example:**

```typescript
const cache = new WeakCacheAsync(async userId => {
  const response = await fetch(`/api/users/${userId}`);
  return response.blob();
});
```

#### Methods

##### get(id, create?, init?)

Retrieves a cached value or loads it asynchronously.

```typescript
async get(
  id: Id,
  create?: () => Item | Promise<Item>,
  init?: (item: Item) => Promise<void> | void
): Promise<Item>
```

Concurrent calls for the same key share the same promise and resolve to the same
object instance.

**Parameters:**

- `id`: Cache key
- `create`: Optional override factory (sync or async)
- `init`: Optional post-load initializer (sync or async)

**Returns:** Promise resolving to the object

**Examples:**

```typescript
// Basic usage
const user = await cache.get('user-123');

// Concurrent requests deduplicated
const [u1, u2] = await Promise.all([
  cache.get('user-456'),
  cache.get('user-456'),
]);
console.log(u1 === u2); // true

// One-time override with async initialization
const admin = await cache.get(
  'admin',
  async () => await fetchSpecialUser(),
  async user => {
    user.permissions = await loadPermissions(user.id);
  },
);
```

##### peek(id)

Inspects the cache without triggering a load.

```typescript
peek(id: Id): Item | undefined
```

**Returns:** The cached value if fully loaded and alive, otherwise `undefined`

**Example:**

```typescript
const user = cache.peek('user-123');
if (user) {
  renderUserImmediately(user);
} else {
  showLoadingPlaceholder();
}
```

##### tryGet(id) _[Deprecated]_

Legacy alias for `peek()` that returns `null` instead of `undefined`.

```typescript
tryGet(id: Id): Item | null
```

**Deprecated:** Use `peek()` instead.

##### trySet(id, item)

Inserts a value only if the slot is completely free (no value and no pending
load).

```typescript
trySet(id: Id, item: Item): boolean
```

**Returns:** `true` if inserted, `false` if key has a value or pending load

**Example:**

```typescript
// Preload without interrupting in-flight requests
const preloaded = await expensiveLoad();
if (cache.trySet('key', preloaded)) {
  console.log('Cached preloaded data');
} else {
  console.log('Already loading or cached');
}
```

##### forceSet(id, item)

Forcefully replaces a value and cancels any pending load.

```typescript
forceSet(id: Id, item: Item): void
```

Pending load promises will still resolve, but to the force-set value instead of
their original result.

**Example:**

```typescript
// Interrupt slow network request with cached data
const slowLoad = cache.get('data');

const cached = getFromLocalStorage('data');
cache.forceSet('data', cached); // Interrupt network

await slowLoad; // Resolves to cached, not network result
```

##### del(id)

Removes an entry and cancels any pending load.

```typescript
del(id: Id): void
```

**Example:**

```typescript
// User logged out, cancel pending requests
cache.del('user-session');
```

##### watch(id, callback)

Subscribes to value changes for a key.

```typescript
watch(id: Id, onSet: (item: Item) => void): void
```

The callback fires:

- When the initial load completes (async)
- Every time a new instance appears (after GC + recreation, or after
  `forceSet()`)

**Example:**

```typescript
// Auto-update UI when data loads or changes
cache.watch('user', user => {
  updateUserDisplay(user);
});
```

##### unwatch(id, callback)

Removes a watcher.

```typescript
unwatch(id: Id, onSet: (item: Item) => void): void
```

##### clear()

Removes all cached values, pending loads, and watchers.

```typescript
clear(): void
```

Pending load promises will still resolve, but their results won't be cached.

**Example:**

```typescript
// Clean slate on user logout
cache.clear();
```

##### has(id)

Checks whether a key has a live cached value (fully loaded).

```typescript
has(id: Id): boolean
```

##### entries()

Iterates over currently live, fully loaded cache entries.

```typescript
entries(): Iterable<[Id, Item]>
```

#### Properties

##### size

Approximate count of fully loaded cached objects (snapshot, excludes pending
loads).

```typescript
readonly size: number
```

##### ids

Array of all keys with live cached values (snapshot, excludes keys with only
pending loads).

```typescript
readonly ids: Id[]
```

## Usage Patterns

### Caching DOM Elements

```typescript
const elementCache = new WeakCache(id => {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'cached-component';
  // Expensive initialization...
  return el;
});

// Elements stay cached as long as they're in the DOM
const header = elementCache.get('header');
document.body.appendChild(header);

// Later: remove from DOM and release reference
document.body.removeChild(header);
// GC will eventually collect it
```

### Caching API Responses

```typescript
const apiCache = new WeakCacheAsync(async endpoint => {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
});

// Automatic deduplication
const data = await apiCache.get('/api/users');

// Manual refresh
const fresh = await fetch('/api/users').then(r => r.blob());
apiCache.forceSet('/api/users', fresh);
```

### Caching Expensive Computations

```typescript
const computationCache = new WeakCache(params => {
  const key = JSON.stringify(params);
  console.log(`Computing for ${key}`);

  // Expensive calculation
  const result = {
    data: heavyComputation(params),
    metadata: { computed: Date.now() },
  };

  return result;
});

const result = computationCache.get({ x: 10, y: 20 });
```

### React Integration

```typescript
// Cache expensive component instances
const componentCache = new WeakCache(props => {
  return {
    render: () => <ExpensiveComponent {...props} />,
  };
});

function MyComponent({ userId }) {
  const cached = componentCache.get(userId);
  return cached.render();
}
```

### Image Loading with Progress

```typescript
const imageCache = new WeakCacheAsync(async url => {
  const response = await fetch(url);
  const blob = await response.blob();
  return {
    url,
    bitmap: await createImageBitmap(blob),
    size: blob.size,
  };
});

// Watch for load completion
imageCache.watch('photo.jpg', image => {
  console.log('Image loaded:', image.size, 'bytes');
  canvas.drawImage(image.bitmap, 0, 0);
});
```

### Database Connection Pooling

```typescript
const connectionCache = new WeakCacheAsync(async dbName => {
  const conn = await createConnection(dbName);

  conn.on('close', () => console.log(`Connection to ${dbName} closed`));

  return conn;
});

// Connections automatically close when no longer referenced
const db = await connectionCache.get('main');
await db.query('SELECT * FROM users');
```

### Conditional Loading

```typescript
const cache = new WeakCacheAsync(async id => {
  return await expensiveLoad(id);
});

// Check before loading
const cached = cache.peek('data');
if (cached) {
  useImmediately(cached);
} else {
  showLoadingSpinner();
  const loaded = await cache.get('data');
  useAfterLoad(loaded);
}
```

## Best Practices

### ✅ Do's

- **Use for objects only**: WeakRef requires object types (not primitives)
- **Keep strong references**: While you need the object, hold a reference in
  your code
- **Use symbols for keys**: Prevents accidental key collisions
- **Handle loader errors**: Implement error handling in your loader functions
- **Leverage deduplication**: Let concurrent requests share load operations
- **Profile memory usage**: Monitor to ensure GC is working as expected

```typescript
// Good: Using symbols
const KEY = Symbol('user-data');
cache.get(KEY);

// Good: Error handling in loader
const cache = new WeakCacheAsync(async id => {
  try {
    return await fetchData(id);
  } catch (error) {
    console.error(`Failed to load ${id}:`, error);
    throw error;
  }
});
```

### ❌ Don'ts

- **Don't cache primitives**: Strings, numbers, booleans won't work with WeakRef
- **Don't rely on cache for critical data**: GC can collect at any time
- **Don't use as primary storage**: This is a cache, not a database
- **Don't forget about load errors**: Always handle failures in async loaders
- **Don't ignore memory pressure**: Even weak caches consume some memory

```typescript
// Bad: Caching primitives (won't work)
const badCache = new WeakCache(id => id.toString()); // ❌ String is primitive

// Good: Wrap in an object
const goodCache = new WeakCache(id => ({ value: id.toString() })); // ✅
```

### Performance Considerations

- **Loader efficiency**: Keep loaders fast; they block access
- **Init functions**: Use for one-time setup, not repeated operations
- **Check before loading**: Use `peek()` to avoid unnecessary loads
- **Batch operations**: Load multiple items concurrently with `Promise.all()`
- **Monitor cache size**: Large caches might need manual eviction

```typescript
// Efficient: Batch loading
const ids = ['user-1', 'user-2', 'user-3'];
const users = await Promise.all(ids.map(id => cache.get(id)));

// Efficient: Conditional loading
if (!cache.peek('data')) {
  showLoadingSpinner();
}
const data = await cache.get('data');
```

## TypeScript Support

Full TypeScript support with generic types:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

// Strongly typed cache
const userCache = new WeakCache<User, string>(userId => {
  return {
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@example.com`,
  };
});

const user = userCache.get('123'); // Type: User
user.name; // ✅ Type-safe
user.invalid; // ❌ TypeScript error
```

Symbol keys:

```typescript
const symbolCache = new WeakCache<Data, symbol>(key => {
  return loadData(key);
});

const KEY = Symbol('my-data');
const data = symbolCache.get(KEY);
```

## Browser Compatibility

`weak-cache-ts` requires ES2021 features:

- ✅ Chrome 84+
- ✅ Firefox 79+
- ✅ Safari 14.1+
- ✅ Edge 84+
- ✅ Node.js 14.6+

For older environments, consider:

- Using a polyfill for WeakRef/FinalizationRegistry
- Falling back to a traditional Map-based cache
- Upgrading your environment

## Debugging and Monitoring

### Inspecting Cache State

```typescript
const cache = new WeakCache(loader);

// Check current size
console.log(`Cache has ${cache.size} items`);

// List all keys
console.log('Cached keys:', cache.ids);

// Iterate entries
for (const [key, value] of cache.entries()) {
  console.log(`${key}:`, value);
}

// Check specific key
if (cache.has('key')) {
  console.log('Key is cached');
}
```

### Memory Profiling

```typescript
// Before
console.log('Initial size:', cache.size);

// Create many objects
for (let i = 0; i < 1000; i++) {
  cache.get(`key-${i}`);
}

console.log('After loading:', cache.size);

// Force GC in Node.js (with --expose-gc flag)
if (global.gc) {
  global.gc();
  setTimeout(() => {
    console.log('After GC:', cache.size);
  }, 100);
}
```

### Logging

```typescript
const cache = new WeakCacheAsync(async id => {
  console.log(`[CACHE] Loading: ${id}`);
  const result = await load(id);
  console.log(`[CACHE] Loaded: ${id}`);
  return result;
});

// Watch for cache updates
cache.watch('key', item => {
  console.log('[CACHE] New value:', item);
});
```

## FAQ

**Q: When should I use WeakCache vs WeakCacheAsync?**

A: Use `WeakCache` when your loader returns immediately (sync). Use
`WeakCacheAsync` for network requests, file I/O, database queries, or any async
operation.

**Q: How do I know when objects are garbage collected?**

A: You don't have direct control—the GC decides. Objects are collected when no
strong references exist. Use `cache.size` and `cache.ids` for monitoring.

**Q: Can I cache primitive values?**

A: No. WeakRef only works with objects. Wrap primitives in objects:
`{ value: 42 }` instead of `42`.

**Q: What happens if my loader throws an error?**

A: The error propagates to the caller. Nothing is cached. Implement error
handling in your loader.

**Q: Is this safe for server-side use?**

A: Yes, but be mindful: cached objects can be GC'd under memory pressure. Don't
rely on the cache for critical data persistence.

**Q: How do I invalidate cache entries?**

A: Use `del(id)` for single entries, `forceSet(id, newValue)` to replace, or
`clear()` for everything.

**Q: Can I use this with Vue/Angular/React?**

A: Absolutely! It's framework-agnostic. Great for caching component instances,
API responses, or computed values.

**Q: What's the difference between `trySet` and `forceSet`?**

A: `trySet` only inserts if the key is free (no-op on conflict). `forceSet`
always overwrites, even canceling pending async loads.

**Q: Does this work in Web Workers?**

A: Yes, as long as your environment supports WeakRef and FinalizationRegistry
(all modern environments do).

**Q: How much memory does the cache use?**

A: Minimal—just weak references and keys. The actual objects are held weakly, so
they don't count against the cache's memory footprint.

## Contributing

Contributions are welcome! Please open issues or pull requests on
[GitHub](https://github.com/orimay/weak-cache-ts).

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Dmitrii Baranov <dmitrii.a.baranov@gmail.com>

---

**Happy caching! 🚀** Star the repo if you find it useful!
