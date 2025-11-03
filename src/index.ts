/**
 * WeakCache Class
 *
 * A cache implementation using WeakRefs, designed for storing items with synchronous loading.
 * This class leverages JavaScript's WeakRef and FinalizationRegistry to create a garbage-collectable cache,
 * ideal for managing large numbers of objects without preventing their GC when no longer strongly referenced.
 * It's perfect for scenarios like memoization, resource pooling, or caching expensive-to-create objects
 * in memory-constrained environments, such as browsers or Node.js servers.
 * The cache automatically cleans up entries when items are GC'd, reducing memory leaks.
 *
 * Supports custom loaders for on-demand creation, and optional initialization hooks.
 * Keys can be strings or symbols for flexibility in identifier types.
 *
 * @class WeakCache
 * @template Item The type of items stored in the cache, must be an object (for WeakRef compatibility).
 * @template Id The type of the cache keys, defaults to string | symbol.
 *
 * @example
 * ```typescript
 * const cache = new WeakCache((id: string) => ({ data: `Loaded ${id}` }));
 * const item = cache.get('key1');
 * console.log(item.data); // 'Loaded key1'
 * ```
 */
export class WeakCache<
  Item extends object,
  Id extends string | symbol = string | symbol,
> {
  /**
   * Deletes an item from the cache explicitly.
   * This removes the WeakRef entry but does not affect the item itself.
   * Called automatically by FinalizationRegistry on GC, but can be invoked manually.
   *
   * @param id - The unique identifier of the item to delete.
   */
  public readonly del = (id: Id) => {
    this.m_cache.delete(id);
  };

  private m_cache = new Map<Id, WeakRef<Item>>();
  private m_cacheRegistry = new FinalizationRegistry<Id>(this.del);

  /**
   * Creates a new WeakCache instance with a sync loader.
   *
   * @param m_loader - Function that loads the item, returning Item.
   */
  public constructor(private m_loader: (id: Id) => Item) {}

  /**
   * Retrieves the current keys (ids) in the cache.
   * Note: This returns only keys for currently live (non-GC'd) items.
   * Useful for introspection or cleanup operations.
   *
   * @returns An array of current cache keys.
   */
  public get ids() {
    return [...this.m_cache.keys()];
  }

  /**
   * Retrieves an item from the cache or loads it synchronously if not present.
   * If the item is not cached or has been GC'd, it uses the loader (or optional create) to fetch/create it.
   * Optional init function allows post-creation setup, such as property initialization.
   * Throws if trying to set an already cached item via internal set.
   *
   * @param id - The unique identifier for the item.
   * @param create - Optional function to create the item instead of using the constructor's loader.
   * @param init - Optional function to initialize the item after creation.
   * @returns The cached or newly created item.
   */
  public readonly get = (
    id: Id,
    create?: () => Item,
    init?: (item: Item) => void,
  ) => {
    let item = this.m_cache.get(id)?.deref();
    if (item !== undefined) return item;
    item = create?.() ?? this.m_loader(id);
    init?.(item);
    this.set(id, item);
    return item;
  };

  /**
   * Adds an item to the cache, throwing if already present.
   * Registers the item with FinalizationRegistry for auto-cleanup on GC.
   * Internal method; use get() for typical access.
   *
   * @param id - The unique identifier for the item.
   * @param item - The item to cache.
   * @throws Error if the item is already cached.
   */
  private set(id: Id, item: Item) {
    if (this.m_cache.get(id)?.deref() !== undefined) {
      throw new Error(`Item ${id.toString()} already cached`);
    }
    this.m_cache.set(id, new WeakRef(item));
    this.m_cacheRegistry.register(item, id, item);
  }

  /**
   * Attempts to add an item to the cache without throwing if already present.
   * No-op if the id is already cached. Useful for race-condition-prone environments.
   *
   * @param id - The unique identifier for the item.
   * @param item - The item to cache.
   */
  public trySet(id: Id, item: Item) {
    if (this.m_cache.get(id)?.deref() !== undefined) return;
    this.m_cache.set(id, new WeakRef(item));
    this.m_cacheRegistry.register(item, id, item);
  }
}

/**
 * WeakCacheAsync Class
 *
 * An asynchronous version of WeakCache, supporting promise-based loading and initialization.
 * Designed for caching items that require async operations to load, such as network fetches,
 * database queries, or file I/O. Prevents duplicate loads by tracking pending promises.
 * Like WeakCache, it uses WeakRef for GC-friendly storage, auto-cleaning via FinalizationRegistry.
 * Ideal for async-heavy applications like web servers, data loaders, or reactive systems.
 *
 * Handles both sync and async loaders/creators/initializers seamlessly.
 * Keys can be strings or symbols.
 *
 * @class WeakCacheAsync
 * @template Item The type of items stored in the cache, must be an object.
 * @template Id The type of the cache keys, defaults to string | symbol.
 *
 * @example
 * ```typescript
 * const cache = new WeakCacheAsync(async (id: string) => ({ data: await fetchData(id) }));
 * const item = await cache.get('key1');
 * console.log(item.data); // Data from async load
 * ```
 */
export class WeakCacheAsync<
  Item extends object,
  Id extends string | symbol = string | symbol,
> {
  /**
   * Deletes an item from the cache and any pending load.
   * Called automatically on GC, or manually for explicit removal.
   *
   * @param id - The unique identifier to delete.
   */
  public readonly del = (id: Id) => {
    this.m_cache.delete(id);
    this.m_cacheLoading.delete(id);
  };

  private m_cache = new Map<Id, WeakRef<Item>>();
  private m_cacheLoading = new Map<Id, WeakRef<Promise<Item>>>();
  private m_cacheRegistry = new FinalizationRegistry<Id>(this.del);

  /**
   * Creates a new WeakCacheAsync instance with an async-capable loader.
   *
   * @param m_loader - Function that loads the item, returning Item or Promise<Item>.
   */
  public constructor(private m_loader: (id: Id) => Item | Promise<Item>) {}

  /**
   * Retrieves the current keys (ids) in the cache.
   * Includes only keys for live items; pending loads are not included.
   *
   * @returns An array of current cache keys.
   */
  public get ids() {
    return [...this.m_cache.keys()];
  }

  /**
   * Retrieves an item asynchronously from the cache or loads it if not present.
   * Checks cache first, then pending loads, then initiates a new load if needed.
   * Supports optional async create and init functions for customization.
   * Ensures only one load per id at a time to avoid redundancy.
   *
   * @param id - The unique identifier for the item.
   * @param create - Optional async function to create/load the item instead of loader.
   * @param init - Optional async function to initialize the item post-creation.
   * @returns A promise resolving to the item.
   */
  public readonly get = async (
    id: Id,
    create?: () => Item | Promise<Item>,
    init?: (item: Item) => Promise<void> | void,
  ): Promise<Item> => {
    let item = this.m_cache.get(id)?.deref();
    if (item !== undefined) return Promise.resolve(item);

    const loading = this.m_cacheLoading.get(id)?.deref();
    if (loading !== undefined) return loading;

    const pItem = create?.() ?? this.m_loader(id);

    if (pItem instanceof Promise) {
      this.m_cacheLoading.set(id, new WeakRef(pItem));
      item = await pItem;
      await init?.(item);
      this.m_cacheLoading.delete(id);
      if (this.trySet(id, item)) return item;
      return this.get(id);
    }

    item = pItem;
    const pInit = init?.(item);

    if (pInit instanceof Promise) {
      const pLoad = pInit.then(() => {
        this.m_cacheLoading.delete(id);
        if (this.trySet(id, item)) return item;
        return this.get(id);
      });
      this.m_cacheLoading.set(id, new WeakRef(pLoad));
      return pLoad;
    }

    if (this.trySet(id, item)) return Promise.resolve(item);
    return this.get(id);
  };

  /**
   * Attempts to retrieve an item synchronously if already cached, without loading.
   * Returns null if not cached or GC'd. Useful for optimistic checks before async get.
   *
   * @param id - The unique identifier.
   * @returns The item if cached, else null.
   */
  public readonly tryGet = (id: Id): Item | null => {
    return this.m_cache.get(id)?.deref() ?? null;
  };

  /**
   * Attempts to add an item without throwing if already present or loading.
   * No-op if conflicted. Good for concurrent or uncertain insertion.
   *
   * @param id - The unique identifier.
   * @param item - The item to cache.
   * @returns true if the item was successfully set, false if it was already present or loading.
   */
  public trySet(id: Id, item: Item) {
    if (
      this.m_cache.get(id)?.deref() !== undefined ||
      this.m_cacheLoading.has(id)
    ) {
      return false;
    }
    this.m_cache.set(id, new WeakRef(item));
    this.m_cacheRegistry.register(item, id, item);
    return true;
  }

  /**
   * Forces the addition of an item, overwriting any existing entry or load.
   * Unregisters old item from registry, clears loading, and sets new item.
   * Use cautiously, as it may interrupt ongoing loads or discard cached items.
   *
   * @param id - The unique identifier.
   * @param item - The new item to cache.
   */
  public forceSet(id: Id, item: Item) {
    const itemOld = this.m_cache.get(id)?.deref();
    if (itemOld !== undefined) {
      this.m_cacheRegistry.unregister(itemOld);
    }
    this.m_cacheLoading.delete(id);
    this.m_cache.set(id, new WeakRef(item));
    this.m_cacheRegistry.register(item, id, item);
  }
}
