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
 * - Event-based cleanup notifications via {@link WeakCache.on | on('dispose')}
 *
 * **Memory characteristics:** The cache itself uses minimal memory (only weak references and keys).
 * Objects stay alive only as long as your code holds strong references to them.
 *
 * @template Item - Type of cached objects (must be a WeakKey).
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
export class WeakCache<
  Item extends WeakKey,
  Id extends string | symbol = string | symbol,
> {
  /**
   * Removes an entry from the cache immediately and unregisters it from garbage collection tracking.
   *
   * Use this when you know an object is no longer needed and want to free its cache slot
   * immediately rather than waiting for garbage collection (e.g., user logged out, document
   * closed, or resource explicitly invalidated).
   *
   * **Effect:** The key is removed, watchers are cleaned up, and the next {@link WeakCache.get | get()}
   * will reload. This does not affect existing strong references - those objects remain usable.
   * The `'dispose'` event is **NOT** triggered for manual deletions.
   *
   * @param id - The key to remove from the cache.
   *
   * @example
   * ```typescript
   * avatarCache.del('alice'); // Forget alice's avatar immediately
   * ```
   */
  public readonly del = (id: Id) => {
    const item = this.peek(id);
    item !== undefined && this.#cacheRegistry.unregister(item);
    this.#cache.delete(id);
    this.#cacheWatchers.delete(id);
  };

  #loader: (id: Id) => Item;
  #cache = new Map<Id, WeakRef<Item>>();
  #cacheRegistry = new FinalizationRegistry<Id>(id => {
    this.#cache.delete(id);
    this.#cacheWatchers.delete(id);
    this.#trigger('dispose', id);
  });

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
   * Retrieves a cached value or creates it on demand. **Bound method** - safe for Array.map() and callbacks.
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
   * your code holds a reference to it. Calls watchers if this is the first time loading.
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
   *
   * @example
   * ```typescript
   * // Array.map() usage - bound method works perfectly
   * const ids = ['user-1', 'user-2', 'user-3'];
   * const users = ids.map(userCache.get);
   * ```
   */
  public readonly get = (
    id: Id,
    create?: () => Item,
    init?: (item: Item) => void,
  ) => {
    let item = this.peek(id);
    if (item !== undefined) return item;
    item = create?.() ?? this.#loader(id);
    init?.(item);
    this.set(id, item);
    return item;
  };

  /**
   * Inspects the cache without triggering a load. **Bound method** - safe for callbacks.
   *
   * Returns the cached value if it exists and is still alive, or `undefined` if the key
   * is missing or its value was garbage collected. Never calls the loader.
   *
   * **Use cases:** Checking if work can be avoided, conditional rendering without triggering loads,
   * or testing cache state without side effects.
   *
   * @param id - Key to inspect.
   * @returns The live value or `undefined` if not present/collected.
   *
   * @example
   * ```typescript
   * const img = avatarCache.peek('dave');
   * if (img) {
   *   // Already cached, use immediately
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
   * Inserts, replaces, or conditionally sets a cached value.
   *
   * @param id - Cache key.
   * @param item - Object to cache.
   * @param mode - Insertion mode:
   *   - `'force'` (default): Always insert, unconditionally overwriting any existing value
   *   - `'replace'`: Only insert if a value is already cached, returns `false` otherwise
   *   - `'try'`: Only insert if the key is completely empty, returns `false` if already cached
   * @returns `true` if insertion succeeded, `false` if blocked by mode constraints.
   *
   * **Behavior:** Registers the item for automatic garbage collection tracking. Unregisters the old
   * value's GC tracking when replaced. Fires registered watchers only if insertion succeeds.
   *
   * **Mode semantics:**
   * - `'force'`: Unconditional replacement. Use for cache invalidation, manual refresh, or forced updates.
   * - `'replace'`: Safe update for already-cached items. Ideal for refresh scenarios where you want to
   *   fail silently if nothing was cached yet.
   * - `'try'`: Safe speculative insertion. Perfect for preloading patterns—insert if free, otherwise discard.
   *
   * @example
   * ```typescript
   * // Force insert - always overwrites
   * cache.set('key', item1, 'force'); // Returns true
   * cache.set('key', item2);          // Returns true, 'force' is default
   * ```
   *
   * @example
   * ```typescript
   * // Replace only if already cached - manual refresh pattern
   * const refreshed = expensiveComputation('key');
   * if (cache.set('key', refreshed, 'replace')) {
   *   console.log('Cache updated');
   * } else {
   *   console.log('Key was not cached, refresh ignored');
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Try insert - speculative preloading pattern
   * const preloaded = expensiveComputation();
   * if (cache.set('key', preloaded, 'try')) {
   *   console.log('Preload successful');
   * } else {
   *   console.log('Already cached, preload discarded');
   * }
   * ```
   *
   * @example
   * ```typescript
   * // All modes trigger watchers when successful
   * cache.watch('key', item => {
   *   console.log('Watcher fired with:', item);
   * });
   *
   * cache.set('key', new Item(), 'force');   // Watcher fires
   * cache.set('key', another(), 'replace');  // Watcher fires (if key was cached)
   * cache.set('key', other(), 'try');        // Watcher fires (if key was empty)
   * ```
   */
  public set(
    id: Id,
    item: Item,
    mode: 'force' | 'replace' | 'try' = 'force',
  ): boolean {
    if (
      (mode === 'replace' && this.peek(id) === undefined) ||
      (mode === 'try' && this.peek(id) !== undefined)
    ) {
      return false;
    }
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    const watchers = this.#cacheWatchers.get(id);
    if (watchers !== undefined) {
      for (const watcher of watchers) {
        watcher(item);
      }
    }
    return true;
  }

  /**
   * Subscribes to value changes for a specific key.
   *
   * The callback fires:
   * 1. **Immediately** when calling `watch()` (loads the value if needed, then calls callback)
   * 2. **Every time a new instance appears** for this key (e.g., after GC + recreation, or after {@link WeakCache.set | set()})
   *
   * **Synchronous behavior:** The callback fires synchronously during the call to `watch()`.
   * The value must already exist or will be created immediately by the loader.
   *
   * **Memory safety:** Watchers are automatically cleaned up when the value is garbage collected
   * or explicitly deleted. You don't need to call {@link WeakCache.unwatch | unwatch()} to prevent
   * leaks, but you should call it if you want to stop receiving updates before the value is collected.
   *
   * **Caveat:** The callback may be called multiple times with different object instances for
   * the same key if the value gets garbage collected and recreated, or if {@link WeakCache.set | set()}}
   * is called with `'force'` mode.
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
   * for unsubscribing before that happens (e.g., component unmount, navigation away).
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

  #disposeHandlers: Set<(value: never) => void> | undefined;
  #trigger(event: 'dispose', id: Id): void;
  #trigger(event: string, value: never): void {
    if (this.#disposeHandlers !== undefined) {
      for (const callback of this.#disposeHandlers) {
        callback(value);
      }
    }
  }

  /**
   * Subscribes to garbage collection events for items in the cache.
   *
   * The callback fires when an item is automatically garbage collected by the JavaScript runtime.
   * **Important:** This event is **NOT** fired for manual deletions via {@link WeakCache.del | del()}}
   * or {@link WeakCache.clear | clear()}}.
   *
   * **Use cases:** Resource cleanup notifications, memory profiling, event logging, downstream cache
   * invalidation, or handling external dependencies tied to cached items.
   *
   * @param event - Event identifier (`'dispose'`).
   * @param callback - Function called with the ID of the garbage-collected item.
   *
   * @example
   * ```typescript
   * // Track automatic garbage collection
   * cache.on('dispose', id => {
   *   console.log(`Item ${id} was garbage collected`);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Clean up external resources when cached items are GC'd
   * cache.on('dispose', id => {
   *   releaseExternalResource(id);
   *   database.closeConnection(id);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Distinguish between manual deletion and GC
   * cache.on('dispose', id => {
   *   console.log('Item was garbage collected (automatic):', id);
   * });
   *
   * cache.del('key'); // No 'dispose' event fired
   * // Later when GC runs and no strong refs exist, 'dispose' fires
   * ```
   */
  public on(event: 'dispose', callback: (id: Id) => void): void;
  public on(event: string, callback: (value: never) => void): void {
    this.#disposeHandlers ??= new Set();
    this.#disposeHandlers.add(callback);
  }

  /**
   * Unsubscribes from garbage collection events.
   *
   * Removes a previously registered `'dispose'` event handler. You must pass the exact same
   * callback reference that was used in {@link WeakCache.on | on('dispose')}}.
   *
   * @param event - Event identifier (`'dispose'`).
   * @param callback - Exact callback function to remove.
   *
   * @example
   * ```typescript
   * const handleDispose = id => console.log(`${id} disposed`);
   *
   * cache.on('dispose', handleDispose);
   * // ... later ...
   * cache.off('dispose', handleDispose); // Stop listening
   * ```
   */
  public off(event: 'dispose', callback: (id: Id) => void): void;
  public off(event: string, callback: (value: never) => void): void {
    this.#disposeHandlers?.delete(callback);
  }

  /**
   * Removes all cached values and watchers.
   *
   * Clears all weak references and watchers, resetting the cache to its initial empty state.
   * Existing strong references in your code remain valid and usable - this only affects
   * the cache's internal bookkeeping.
   *
   * **Event behavior:** Does not fire `'dispose'` events for cleared items (they're cleared explicitly,
   * not garbage collected).
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
   *
   * @example
   * ```typescript
   * // Testing cleanup
   * afterEach(() => {
   *   avatarCache.clear(); // Fresh state for each test
   * });
   * ```
   */
  public clear(): void {
    this.#cache.clear();
    this.#cacheWatchers.clear();
  }
}
