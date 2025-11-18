/**
 * A garbage-collector-friendly cache for expensive objects with asynchronous loading.
 *
 * Asynchronous version of {@link WeakCache} with perfect promise deduplication: concurrent
 * requests for the same key always share the same promise and resolve to the same object instance.
 * This prevents duplicate network requests, database queries, or other async operations.
 *
 * **Best for:** Network requests, database queries, file I/O, async decoding, or any async
 * operation that's expensive and can be identified by a key.
 *
 * **Key behaviors:**
 * - Asynchronous loading with promise deduplication
 * - Automatic cleanup when objects are garbage collected
 * - Multiple concurrent requests for the same key share one promise
 * - Supports both sync and async loaders, with sync fast-path optimization
 * - Manual eviction available via {@link WeakCacheAsync.del | del()} (also cancels pending loads)
 *
 * **Memory characteristics:** Like {@link WeakCache}, values are held weakly and automatically
 * cleaned up by garbage collection. Pending promises are also held weakly and cleaned up when resolved.
 *
 * @template Item - Type of cached objects (must be an object, not a primitive).
 * @template Id - Type of cache keys (string or symbol by default).
 *
 * @example
 * ```typescript
 * // Cache network-fetched avatar data
 * const avatarCache = new WeakCacheAsync(async userId => {
 *   const response = await fetch(`/avatars/${userId}.jpg`);
 *   const blob = await response.blob();
 *   return {
 *     url: `/avatars/${userId}.jpg`,
 *     bitmap: await createImageBitmap(blob)
 *   };
 * });
 *
 * const avatar = await avatarCache.get('alice'); // Single network request
 * const same = await avatarCache.get('alice');    // Returns same instance immediately
 * ```
 *
 * @example
 * ```typescript
 * // Perfect deduplication of concurrent requests
 * const [avatar1, avatar2, avatar3] = await Promise.all([
 *   avatarCache.get('bob'),
 *   avatarCache.get('bob'),
 *   avatarCache.get('bob')
 * ]);
 * // Only one network request made, all three get the same object
 * console.log(avatar1 === avatar2 && avatar2 === avatar3); // true
 * ```
 *
 * @see {@link WeakCache} for synchronous loading without network/async I/O.
 */
export class WeakCacheAsync<
  Item extends object,
  Id extends string | symbol = string | symbol,
> {
  /**
   * Removes an entry and cancels any pending load.
   *
   * Immediately removes the key from the cache and cancels its pending load operation if one
   * is in progress. Use this when you know data is no longer relevant (e.g., user logged out,
   * resource explicitly invalidated, or request should be aborted).
   *
   * **Effect:** Pending promises for this key will still resolve, but the result won't be cached.
   * The next {@link WeakCacheAsync.get | get()} will start a fresh load.
   *
   * @param id - The key to remove from the cache.
   *
   * @example
   * ```typescript
   * avatarCache.del('alice'); // Cancel pending load and forget cached value
   * ```
   */
  public readonly del = (id: Id) => {
    this.#cache.delete(id);
    this.#cacheLoading.delete(id);
    this.#cacheWatchers.delete(id);
  };

  #loader: (id: Id) => Item | Promise<Item>;
  #cache = new Map<Id, WeakRef<Item>>();
  #cacheLoading = new Map<Id, WeakRef<Promise<Item>>>();
  #cacheRegistry = new FinalizationRegistry<Id>(this.del);
  #cacheWatchers = new Map<Id, Set<(item: Item) => void>>();

  /**
   * Creates a new async cache with a loader function.
   *
   * @param loader - Factory that returns a value synchronously **or** a promise that resolves to a value.
   *   Sync loaders are optimized to avoid unnecessary promise overhead.
   *
   * @example
   * ```typescript
   * // Async loader
   * const avatarCache = new WeakCacheAsync(async userId => {
   *   return await loadAvatarFromNetwork(userId);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Sync loader also works (optimized fast path)
   * const configCache = new WeakCacheAsync(key => {
   *   return JSON.parse(localStorage.getItem(key));
   * });
   * ```
   */
  public constructor(loader: (id: Id) => Item | Promise<Item>) {
    this.#loader = loader;
  }

  /**
   * Approximate count of currently cached live objects.
   *
   * **Caveat:** This is a snapshot that may become stale immediately after reading. Objects
   * can be garbage collected at any time, reducing this number between checks. Does not include
   * pending loads. Useful for monitoring or debugging, not for critical logic.
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
   * after this call. Does not include keys with only pending loads. The array represents
   * keys that had live values at the moment of access.
   *
   * @example
   * ```typescript
   * // Render all currently cached avatars
   * for (const userId of avatarCache.ids) {
   *   await renderAvatar(userId);
   * }
   * ```
   */
  public get ids() {
    return [...this.#cache.keys()];
  }

  /**
   * Iterates over currently live cache entries.
   *
   * Yields only entries whose values are fully loaded and still alive. Skips pending loads
   * and garbage-collected entries automatically.
   *
   * **Caveat:** Values may become garbage collected during iteration. Each yielded value
   * is guaranteed to be alive when yielded, but may be collected before you finish processing it.
   *
   * @returns An iterable of `[key, value]` pairs for live entries.
   *
   * @example
   * ```typescript
   * // Process all currently cached images
   * for (const [userId, data] of avatarCache.entries()) {
   *   canvas.drawImage(data.bitmap, 0, 0);
   * }
   * ```
   */
  public* entries(): Iterable<[Id, Item]> {
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
   * Returns `true` only if the entry exists, is fully loaded, **and** its value hasn't been
   * garbage collected. Returns `false` for missing keys, pending loads, or garbage-collected values.
   *
   * **Caveat:** The result may become stale immediately due to garbage collection. Use
   * {@link WeakCacheAsync.peek | peek()} if you need to actually access the value.
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
    return this.peek(id) !== undefined;
  }

  /**
   * Retrieves a cached value or loads it asynchronously.
   *
   * Returns a promise that resolves to the same object instance for all concurrent and subsequent
   * calls with the same key (perfect deduplication). If a load is already in progress, the existing
   * promise is returned. If the value was garbage collected, it's transparently recreated.
   *
   * **Promise deduplication:** Multiple concurrent calls to `get('key')` result in only one load
   * operation, and all callers receive the same promise that resolves to the same object.
   *
   * **Parameters:**
   * - `id`: The cache key
   * - `create`: Optional one-time factory override (sync or async) for this call only
   * - `init`: Optional post-load initializer (sync or async) for setup after loading
   *
   * **Behavior:** If the loader returns synchronously, the promise resolves immediately in a microtask.
   * If the loader is async, the promise resolves when loading completes.
   *
   * @param id - Cache key to retrieve or load.
   * @param create - Optional override factory for this specific call (sync or async).
   * @param init - Optional initializer called after object loads (sync or async).
   * @returns Promise resolving to the cached or newly loaded object.
   *
   * @example
   * ```typescript
   * // Normal usage - uses constructor loader
   * const avatar = await avatarCache.get('charlie');
   * ```
   *
   * @example
   * ```typescript
   * // Concurrent requests share the same promise
   * const [a1, a2] = await Promise.all([
   *   avatarCache.get('dave'),
   *   avatarCache.get('dave')
   * ]);
   * console.log(a1 === a2); // true - same object instance
   * ```
   *
   * @example
   * ```typescript
   * // One-time override with async initialization
   * const adminAvatar = await avatarCache.get(
   *   'admin',
   *   async () => await fetchSpecialAvatar(),
   *   async img => {
   *     img.isAdmin = true;
   *     await attachAdminFeatures(img);
   *   }
   * );
   * ```
   */
  public readonly get = async (
    id: Id,
    create?: () => Item | Promise<Item>,
    init?: (item: Item) => Promise<void> | void,
  ): Promise<Item> => {
    // 1. Fast path – already cached and alive
    const cached = this.#cache.get(id)?.deref();
    if (cached !== undefined) return cached;

    // 2. Return existing pending promise if any
    const loading = this.#cacheLoading.get(id)?.deref();
    if (loading !== undefined) return loading; // 3. Start a new load

    const loadPromise = create?.() ?? this.#loader(id);
    const isAsyncLoad = loadPromise instanceof Promise;

    if (isAsyncLoad) {
      // Store the pending promise so other callers wait for it
      this.#cacheLoading.set(id, new WeakRef(loadPromise));

      const item = await loadPromise.finally(() =>
        this.#cacheLoading.delete(id),
      );
      await init?.(item);

      // making sure to return the item either loaded now or set in parallel
      return this.#trySet(id, item) ? item : this.get(id);
    }

    const item = loadPromise;
    const initPromise = init?.(item);

    if (initPromise instanceof Promise) {
      const wrapper = initPromise
        .then(() => {
          // making sure to return the item either loaded now or set in parallel
          return this.#trySet(id, item) ? item : this.get(id);
        })
        .finally(() => this.#cacheLoading.delete(id));
      this.#cacheLoading.set(id, new WeakRef(wrapper));
      return wrapper;
    }

    // making sure to return the item either loaded now or set in parallel
    return this.#trySet(id, item) ? Promise.resolve(item) : this.get(id);
  };

  /**
   * Inspects the cache without triggering a load.
   *
   * Returns the cached value if it exists, is fully loaded, and is still alive. Returns `undefined`
   * if the key is missing, load is pending, or value was garbage collected. Never starts a load.
   *
   * **Use cases:** Checking if work can be avoided, conditional rendering without triggering loads,
   * or testing cache state without side effects.
   *
   * @param id - Key to inspect.
   * @returns The live value or `undefined` if not present/loaded/collected.
   *
   * @example
   * ```typescript
   * const img = avatarCache.peek('dave');
   * if (img) {
   *   // Already loaded, show immediately
   *   showAvatar(img);
   * } else {
   *   // Not cached or still loading, show placeholder
   *   showPlaceholder();
   * }
   * ```
   */
  public readonly peek = (id: Id): Item | undefined => {
    return this.#cache.get(id)?.deref();
  };

  /**
   * Legacy alias for {@link WeakCacheAsync.peek | peek()}.
   *
   * @deprecated Use {@link WeakCacheAsync.peek | peek()} instead. This method returns `null`
   *   instead of `undefined` for missing values, which is less idiomatic.
   *
   * @param id - Key to inspect.
   * @returns The live value or `null` if not present/loaded/collected.
   */
  public readonly tryGet = (id: Id): Item | null => {
    return this.peek(id) ?? null;
  };

  /**
   * Inserts a pre-created value into the cache if the slot is completely free.
   *
   * Succeeds only if the key has no live cached value **and** no pending load. Does nothing if
   * the key already has a value or a load is in progress. This prevents interrupting in-flight
   * operations and ensures that concurrent async operations complete naturally.
   *
   * **Pattern:** Preload or speculatively create objects, then try to cache them. If someone else
   * is already loading or has cached it, your object is simply not stored.
   *
   * **Race safety:** If a load is pending, this returns `false` to avoid interrupting it, even
   * if the load hasn't completed yet. This is different from {@link WeakCache.trySet | WeakCache.trySet},
   * which only checks for existing values (since WeakCache has no async loading state).
   *
   * **Caveat:** To force-replace a value regardless of pending loads, use {@link WeakCacheAsync.forceSet | forceSet()} instead.
   *
   * @param id - Cache key.
   * @param item - Pre-created object to cache.
   * @returns `true` if inserted, `false` if key has a value or pending load.
   *
   * @example
   * ```typescript
   * // Speculative preloading that respects in-flight requests
   * const preloaded = await preloadAvatar('eve');
   * if (avatarCache.trySet('eve', preloaded)) {
   *   console.log('Cached preloaded avatar');
   * } else {
   *   console.log('Avatar already cached or loading, discarding preload');
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Safe concurrent preloading
   * const [result1, result2] = await Promise.all([
   *   loadAvatar('user123'),
   *   loadAvatar('user123')
   * ]);
   *
   * avatarCache.trySet('user123', result1); // First one succeeds
   * avatarCache.trySet('user123', result2); // Second one fails, result2 discarded
   * ```
   */
  public trySet(id: Id, item: Item) {
    const result = this.#trySet(id, item);
    if (result) {
      this.#onSet(id, item);
    }
    return result;
  }

  #trySet(id: Id, item: Item) {
    if (
      this.#cache.get(id)?.deref() !== undefined ||
      this.#cacheLoading.has(id)
    ) {
      return false;
    }
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    return true;
  }

  /**
   * Forcefully replaces a cached value and cancels any pending load.
   *
   * Immediately overwrites any existing cached value and interrupts any in-flight load operation
   * for this key. The interrupted load will still complete, but its result will be discarded and
   * the new value will be used instead.
   *
   * **Use cases:** Manual cache invalidation, data refresh, hot reload, forced revalidation,
   * or when external state changes require a new object instance immediately.
   *
   * **Load interruption:** Unlike {@link WeakCacheAsync.trySet | trySet()}, this method cancels
   * pending loads. Any promises from {@link WeakCacheAsync.get | get()} that were waiting for
   * the interrupted load will resolve to the force-set value instead.
   *
   * @param id - Cache key.
   * @param item - New object to cache.
   * @returns `void`
   *
   * @example
   * ```typescript
   * // Refresh after explicit update
   * const updated = await fetchFreshAvatar('frank');
   * avatarCache.forceSet('frank', updated);
   * ```
   *
   * @example
   * ```typescript
   * // Interrupt slow load with cached data
   * const slowLoad = avatarCache.get('user'); // Starts slow network request
   *
   * // User navigates away and back quickly, we have cached data now
   * const cachedData = getCachedFromLocalStorage('user');
   * avatarCache.forceSet('user', cachedData); // Interrupt network, use cache
   *
   * await slowLoad; // Resolves to cachedData, not the network result
   * ```
   */
  public forceSet(id: Id, item: Item) {
    const itemOld = this.#cache.get(id)?.deref();
    if (itemOld !== undefined) {
      this.#cacheRegistry.unregister(itemOld);
    }
    this.#cacheLoading.delete(id);
    this.#cache.set(id, new WeakRef(item));
    this.#cacheRegistry.register(item, id, item);
    this.#onSet(id, item);
  }

  /**
   * Subscribes to value changes for a specific key.
   *
   * The callback fires:
   * 1. **Immediately** when calling `watch()` (triggers async load if needed, calls callback when loaded)
   * 2. **Every time a new instance appears** for this key (e.g., after GC + recreation, or after {@link WeakCacheAsync.forceSet | forceSet()})
   *
   * **Async behavior:** Unlike {@link WeakCache.watch | WeakCache.watch}, the initial callback
   * may not fire synchronously if a load is required. The callback receives the value once the
   * async load completes.
   *
   * **Memory safety:** Watchers are automatically cleaned up when the value is garbage collected
   * or explicitly deleted. You don't need to call {@link WeakCacheAsync.unwatch | unwatch()} to
   * prevent leaks, but you should call it if you want to stop receiving updates before the value
   * is collected.
   *
   * **Caveat:** The callback may be called multiple times with different object instances for
   * the same key if the value gets garbage collected and recreated, or if {@link WeakCacheAsync.forceSet | forceSet()}
   * is called.
   *
   * @param id - Key to watch.
   * @param onSet - Callback receiving the loaded value (called async if load is needed).
   *
   * @example
   * ```typescript
   * // Auto-update UI when avatar loads or changes
   * avatarCache.watch('grace', data => {
   *   canvas.drawImage(data.bitmap, 0, 0);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // React to initial load and subsequent updates
   * avatarCache.watch('user123', async data => {
   *   await processAvatar(data);
   *   displayInUI(data);
   * });
   *
   * // Later: force refresh triggers the callback again
   * const fresh = await loadFreshAvatar('user123');
   * avatarCache.forceSet('user123', fresh); // Callback fires with fresh data
   * ```
   */
  public watch(id: Id, onSet: (item: Item) => void) {
    let watchers = this.#cacheWatchers.get(id);
    if (watchers === undefined) {
      watchers = new Set();
      this.#cacheWatchers.set(id, watchers);
    }
    watchers.add(onSet);

    // Fire immediately – this also ensures the value is loaded
    void this.get(id).then(onSet);
  }

  /**
   * Removes a watcher previously added with {@link WeakCacheAsync.watch | watch()}.
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
   * const handleUpdate = data => updateUI(data);
   *
   * avatarCache.watch('user', handleUpdate);
   * // ... later (e.g., component unmount) ...
   * avatarCache.unwatch('user', handleUpdate); // Stop receiving updates
   * ```
   */
  public unwatch(id: Id, onSet: (item: Item) => void) {
    const set = this.#cacheWatchers.get(id);
    set?.delete(onSet);
    if (set?.size === 0) this.#cacheWatchers.delete(id);
  }

  /**
   * Removes all cached values, pending loads, and watchers.
   *
   * Clears all weak references, cancels all pending async operations, and removes all watchers,
   * resetting the cache to its initial empty state. Existing strong references in your code
   * remain valid and usable - this only affects the cache's internal bookkeeping.
   *
   * **Load cancellation:** Pending load promises will still resolve, but their results won't be cached.
   * Any {@link WeakCacheAsync.get | get()} calls after `clear()` will start fresh loads.
   *
   * **Use cases:** App reset, testing cleanup, explicit memory management, cache invalidation after
   * major state changes, or clearing state between user sessions.
   *
   * **Effect:** Next {@link WeakCacheAsync.get | get()} for any key will start a new async load.
   *
   * @example
   * ```typescript
   * // Reset cache on app reload or user logout
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
    this.#cacheLoading.clear();
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
