/**
 * A garbage-collector-friendly cache for expensive objects with synchronous loading.
 *
 * Values are held weakly: once your code releases all strong references to a cached object,
 * it becomes eligible for garbage collection and automatically disappears from the cache.
 * This prevents memory leaks while providing memoization benefits for expensive-to-create objects.
 *
 * **Best for:** DOM nodes, canvas/WebGL resources, large parsed data structures, heavy computation
 * results, or any object you want to reuse temporarily without keeping alive indefinitely.
 *
 * **Key behaviors:**
 * - Synchronous loading only - loader must return objects immediately
 * - Automatic cleanup when objects are garbage collected
 * - Multiple requests for the same key return the same object instance
 * - Manual eviction available via {@link WeakCache.del | del()} when needed
 *
 * **Memory characteristics:** The cache itself uses minimal memory (only weak references and keys).
 * Objects stay alive only as long as your code holds strong references to them.
 *
 * @template Item - Type of cached objects (must be an object, not a primitive).
 * @template Id - Type of cache keys (string or symbol by default).
 *
 * @example
 * ```typescript
 * // Cache expensive image decoding
 * const avatarCache = new WeakCache(userId => {
 *   const data = fetchAvatarSync(userId);
 *   return decodeImage(data);
 * });
 *
 * const img1 = avatarCache.get('alice');   // Loads and decodes
 * const img2 = avatarCache.get('alice');   // Returns same instance immediately
 * ```
 *
 * @example
 * ```typescript
 * // Cache DOM element creation
 * const componentCache = new WeakCache(id => {
 *   const element = document.createElement('div');
 *   element.id = id;
 *   element.className = 'heavy-component';
 *   // ... expensive setup ...
 *   return element;
 * });
 * ```
 *
 * @see {@link WeakCacheAsync} for asynchronous loading with network requests or async I/O.
 */
export class WeakCache<Item extends object, Id extends string | symbol = string | symbol> {
  /**
   * Removes an entry from the cache immediately.
   *
   * Use this when you know an object is no longer needed and want to free its cache slot
   * immediately rather than waiting for garbage collection (e.g., user logged out, document
   * closed, or resource explicitly invalidated).
   *
   * **Effect:** The key is removed and the next {@link WeakCache.get | get()} will reload.
   * This does not affect existing strong references - those objects remain usable.
   *
   * @param id - The key to remove from the cache.
   *
   * @example
   * ```typescript
   * avatarCache.del('alice'); // Forget alice's avatar immediately
   * ```
   */
  public readonly del = (id: Id) => {
    this.#cache.delete(id);
    this.#cacheWatchers.delete(id);
  };

  #loader: (id: Id) => Item;
  #cache = new Map<Id, WeakRef<Item>>();
  #cacheRegistry = new FinalizationRegistry<Id>(this.del);
  #cacheWatchers = new Map<Id, Set<(item: Item) => void>>();

  /**
   * Creates a new cache with a synchronous loader function.
   *
   * @param loader - Function that creates values when they're missing or have been garbage-collected.
   *   **Must return synchronously** - use {@link WeakCacheAsync} for async operations.
   *
   * @example
   * ```typescript
   * const avatarCache = new WeakCache(userId => {
   *   return decodeImage(fetchAvatarSync(userId));
   * });
   * ```
   */
  public constructor(loader: (id: Id) => Item) {
    this.#loader = loader;
  }

  /**
   * Approximate count of currently cached live objects.
   *
   * **Caveat:** This is a snapshot that may become stale immediately after reading. Objects
   * can be garbage collected at any time, reducing this number between checks. Useful for
   * monitoring or debugging, not for critical logic.
   *
   * @example
   * ```typescript
   * console.log(`Caching ${avatarCache.size} avatars`);
   * ```
   */
  public get size() {
    return this.#cache.size;
  }

  /**
   * All keys that currently have a live cached value.
   *
   * **Caveat:** Returns a snapshot - some values may become garbage collected immediately
   * after this call. The array represents keys that were live at the moment of access.
   *
   * @example
   * ```typescript
   * // Render all currently cached avatars
   * for (const userId of avatarCache.ids) {
   *   renderAvatar(userId);
   * }
   * ```
   */
  public get ids() {
    return [...this.#cache.keys()];
  }

  /**
   * Iterates over currently live cache entries.
   *
   * Yields only entries whose values are still alive at the moment of iteration. Dead
   * entries (garbage collected) are automatically skipped.
   *
   * **Caveat:** Values may become garbage collected during iteration. Each yielded value
   * is guaranteed to be alive when yielded, but may be collected before you finish processing it.
   *
   * @returns An iterable of `[key, value]` pairs for live entries.
   *
   * @example
   * ```typescript
   * // Process all currently cached images
   * for (const [userId, image] of avatarCache.entries()) {
   *   canvas.drawImage(image, 0, 0);
   * }
   * ```
   */
  public *entries(): Iterable<[Id, Item]> {
    for (const [key, value] of this.#cache) {
      const item = value.deref();
      if (item !== undefined) {
        yield [key, item];
      }
    }
  }

  /**
   * Checks whether a key currently has a live cached value.
   *
   * Returns `true` only if the entry exists **and** its value hasn't been garbage collected.
   * Returns `false` for missing keys or keys whose values were collected.
   *
   * **Caveat:** The result may become stale immediately due to garbage collection. Use
   * {@link WeakCache.peek | peek()} if you need to actually access the value.
   *
   * @param id - Key to check.
   *
   * @example
   * ```typescript
   * if (avatarCache.has('bob')) {
   *   showAvatarImmediately('bob');
   * } else {
   *   showLoadingPlaceholder();
   * }
   * ```
   */
  public has(id: Id) {
    return this.#cache.has(id);
  }

  /**
   * Retrieves a cached value or creates it on demand.
   *
   * Returns the same object instance for repeated calls with the same key (perfect deduplication).
   * If the value was garbage collected, it's transparently recreated using the loader.
   *
   * **Parameters:**
   * - `id`: The cache key
   * - `create`: Optional one-time factory override for this call only (doesn't affect other calls)
   * - `init`: Optional callback for post-creation setup (e.g., attach event listeners, configure object)
   *
   * **Behavior:** Always returns immediately (synchronous). The object is kept alive as long as
   * your code holds a reference to it.
   *
   * @param id - Cache key to retrieve or create.
   * @param create - Optional override factory for this specific call.
   * @param init - Optional initializer called once after object creation.
   * @returns The cached or newly created object.
   *
   * @example
   * ```typescript
   * // Normal usage - uses constructor loader
   * const avatar = avatarCache.get('charlie');
   * ```
   *
   * @example
   * ```typescript
   * // One-time override with special handling
   * const adminAvatar = avatarCache.get(
   *   'admin',
   *   () => createSpecialAvatar(),
   *   img => {
   *     img.classList.add('admin');
   *     img.addEventListener('click', handleAdminClick);
   *   }
   * );
   * ```
   */
  public readonly get = (id: Id, create?: () => Item, init?: (item: Item) => void) => {
    let item = this.#cache.get(id)?.deref();
    if (item !== undefined) return item;
    item = create?.() ?? this.#loader(id);
    init?.(item);
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    this.#onSet(id, item);
    return item;
  };

  /**
   * Inspects the cache without triggering a load.
   *
   * Returns the cached value if it exists and is still alive, or `undefined` if the key
   * is missing or its value was garbage collected. Never calls the loader.
   *
   * **Use cases:** Checking if work can be avoided, conditional rendering, or testing
   * cache state without side effects.
   *
   * @param id - Key to inspect.
   * @returns The live value or `undefined` if not present/collected.
   *
   * @example
   * ```typescript
   * const img = avatarCache.peek('dave');
   * if (img) {
   *   // Already cached, draw immediately
   *   canvas.drawImage(img, 0, 0);
   * } else {
   *   // Not cached, show placeholder
   *   showPlaceholder();
   * }
   * ```
   */
  public readonly peek = (id: Id): Item | undefined => {
    return this.#cache.get(id)?.deref();
  };

  /**
   * Inserts a pre-created value into the cache if the key is available.
   *
   * Succeeds only if the key has no live cached value. Does nothing if the key already
   * exists with a live value. This is useful for speculative caching or when multiple
   * code paths might create the same object independently.
   *
   * **Pattern:** Create object optimistically, then try to cache it. If someone else
   * cached it first, your object is simply discarded.
   *
   * @param id - Cache key.
   * @param item - Pre-created object to cache.
   * @returns `true` if inserted, `false` if key already had a live value.
   *
   * @example
   * ```typescript
   * // Speculative preloading
   * const preloaded = decodeImage(data);
   * if (avatarCache.trySet('dave', preloaded)) {
   *   console.log('Cached preloaded avatar');
   * } else {
   *   console.log('Avatar already cached, discarding preload');
   * }
   * ```
   */
  public trySet(id: Id, item: Item) {
    if (this.#cache.get(id)?.deref() !== undefined) return false;
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    this.#onSet(id, item);
    return true;
  }

  /**
   * Forcefully replaces a cached value (invalidation/refresh).
   *
   * Immediately overwrites any existing cached value with the new one, regardless of
   * whether the key exists. Cleans up the old value's weak reference properly.
   *
   * **Use cases:** Manual cache invalidation, data refresh, hot reload, or when external
   * state changes require a new object instance.
   *
   * @param id - Cache key.
   * @param item - New object to cache.
   * @returns `true` if an existing value was replaced, `false` if key was empty.
   *
   * @example
   * ```typescript
   * // Refresh after update
   * const updated = await fetchAndDecodeAvatar('frank');
   * avatarCache.forceSet('frank', updated);
   * ```
   */
  public forceSet(id: Id, item: Item) {
    const itemOld = this.#cache.get(id)?.deref();
    if (itemOld !== undefined) {
      this.#cacheRegistry.unregister(itemOld);
    }
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    this.#onSet(id, item);
    return itemOld !== undefined;
  }

  /**
   * Subscribes to value changes for a specific key.
   *
   * The callback fires:
   * 1. **Immediately** when calling `watch()` (triggers load if needed, calls callback with result)
   * 2. **Every time a new instance appears** for this key (e.g., after GC + recreation, or after {@link WeakCache.forceSet | forceSet()})
   *
   * **Memory safety:** Watchers are automatically cleaned up when the value is garbage collected
   * or explicitly deleted. You don't need to call {@link WeakCache.unwatch | unwatch()} to prevent
   * leaks, but you should call it if you want to stop receiving updates before the value is collected.
   *
   * **Caveat:** The callback may be called multiple times with different object instances for
   * the same key if the value gets garbage collected and recreated.
   *
   * @param id - Key to watch.
   * @param onSet - Callback receiving the current or new value.
   *
   * @example
   * ```typescript
   * // Auto-update UI when avatar changes
   * avatarCache.watch('eve', img => {
   *   document.getElementById('avatar').src = img.src;
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Attach event listeners that survive GC cycles
   * avatarCache.watch('user123', img => {
   *   img.addEventListener('click', handleAvatarClick);
   *   img.classList.add('interactive');
   * });
   * ```
   */
  public watch(id: Id, onSet: (item: Item) => void) {
    let watchers = this.#cacheWatchers.get(id);
    if (watchers === undefined) {
      watchers = new Set();
      this.#cacheWatchers.set(id, watchers);
    }
    watchers.add(onSet);
    this.get(id); // trigger watch callback
  }

  /**
   * Removes a watcher previously added with {@link WeakCache.watch | watch()}.
   *
   * Use this when you no longer want to receive updates for a key. If not called, the watcher
   * will automatically stop when the value is garbage collected or deleted, so this is primarily
   * for unsubscribing before that happens.
   *
   * **Note:** You must pass the exact same callback function reference that was used in `watch()`.
   *
   * @param id - Key being watched.
   * @param onSet - Exact callback function to remove.
   *
   * @example
   * ```typescript
   * const handleUpdate = img => updateUI(img);
   *
   * avatarCache.watch('user', handleUpdate);
   * // ... later ...
   * avatarCache.unwatch('user', handleUpdate); // Stop receiving updates
   * ```
   */
  public unwatch(id: Id, onSet: (item: Item) => void) {
    const set = this.#cacheWatchers.get(id);
    set?.delete(onSet);
    if (set?.size === 0) this.#cacheWatchers.delete(id);
  }

  /**
   * Removes all cached values and watchers.
   *
   * Clears all weak references and watchers, resetting the cache to its initial empty state.
   * Existing strong references in your code remain valid and usable - this only affects
   * the cache's internal bookkeeping.
   *
   * **Use cases:** App reset, testing cleanup, explicit memory management, or cache invalidation
   * after major state changes.
   *
   * **Effect:** Next {@link WeakCache.get | get()} for any key will recreate the object.
   *
   * @example
   * ```typescript
   * // Reset cache on app reload
   * avatarCache.clear();
   * ```
   */
  public clear(): void {
    this.#cache.clear();
    this.#cacheWatchers.clear();
  }

  #onSet(id: Id, item: Item) {
    const watchers = this.#cacheWatchers.get(id);
    if (watchers === undefined) return;
    for (const watcher of watchers) {
      watcher(item);
    }
  }
}
