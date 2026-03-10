import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WeakCacheAsync } from '.';

function getPromiseWithResolvers<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe('WeakCacheAsync', () => {
  let cache: WeakCacheAsync<{ value: string }, string>;
  let loader: Mock<
    (id: string) => Promise<{
      value: string;
    }>
  >;

  beforeEach(() => {
    loader = vi.fn((id: string) => Promise.resolve({ value: `Loaded ${id}` }));
    cache = new WeakCacheAsync(loader);
  });

  describe('size', () => {
    it('reflects current live entries', async () => {
      expect(cache.size).toBe(0);
      await cache.get('key1');
      await cache.get('key2');
      expect(cache.size).toBe(2);
      cache.del('key1');
      expect(cache.size).toBe(1);
    });
  });

  describe('ids', () => {
    it('returns current keys', async () => {
      await cache.get('key1');
      await cache.get('key2');
      expect(cache.ids.sort()).toEqual(['key1', 'key2'].sort());
    });
  });

  describe('entries', () => {
    it('yields only live values', async () => {
      await cache.get('key1');
      await cache.get('key2');
      const entries = [...cache.entries()].map(([k]) => k).sort();
      expect(entries).toEqual(['key1', 'key2'].sort());
    });
  });

  describe('has', () => {
    it('returns correct live status', async () => {
      expect(cache.has('key')).toBe(false);
      await cache.get('key');
      expect(cache.has('key')).toBe(true);
    });
  });

  describe('get', () => {
    it('loads item using loader if not cached', async () => {
      const item = await cache.get('key');
      expect(item).toEqual({ value: 'Loaded key' });
      expect(loader).toHaveBeenCalledWith('key');
    });

    it('returns same instance on subsequent gets', async () => {
      const item1 = await cache.get('key');
      const item2 = await cache.get('key');
      expect(item1).toBe(item2);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('uses provided create function instead of loader', async () => {
      const create = vi.fn(() => ({ value: 'Custom' }));
      const item = await cache.get('key', create);
      expect(item).toEqual({ value: 'Custom' });
      expect(create).toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
    });

    it('uses provided async create function instead of loader', async () => {
      const create = vi.fn(() => Promise.resolve({ value: 'Custom' }));
      const item = await cache.get('key', create);
      expect(item).toEqual({ value: 'Custom' });
      expect(create).toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
    });

    it('calls init after creation', async () => {
      const init = vi.fn((item: { value: string }) => {
        item.value += ' init';
      });
      const item = await cache.get('key', undefined, init);
      expect(item.value).toBe('Loaded key init');
      expect(init).toHaveBeenCalledWith(item);
    });

    it('calls async init after creation', async () => {
      const init = vi.fn((item: { value: string }) => {
        item.value += ' init';
        return Promise.resolve();
      });
      const item = await cache.get('key', undefined, init);
      expect(item.value).toBe('Loaded key init');
      expect(init).toHaveBeenCalledWith(item);
    });
  });

  describe('peek', () => {
    it('loads item using loader if not cached', async () => {
      await cache.get('key');
      const item = cache.peek('key');
      expect(item).toEqual({ value: 'Loaded key' });
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('returns undefined if not loaded', () => {
      const item = cache.peek('key');
      expect(item).toBe(undefined);
      expect(loader).toHaveBeenCalledTimes(0);
    });
  });

  describe('tryGet', () => {
    it('loads item using loader if not cached', async () => {
      await cache.get('key');
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const item = cache.tryGet('key');
      expect(item).toEqual({ value: 'Loaded key' });
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('returns null if not loaded', () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const item = cache.tryGet('key');
      expect(item).toBe(null);
      expect(loader).toHaveBeenCalledTimes(0);
    });
  });

  describe('trySet', () => {
    it('adds item when key is missing', async () => {
      const item = { value: 'TrySet' };
      cache.trySet('key', item);
      expect(await cache.get('key')).toBe(item);
    });

    it('does not overwrite existing item', async () => {
      const item1 = await cache.get('key');
      const item2 = { value: 'New' };
      cache.trySet('key', item2);
      expect(await cache.get('key')).toBe(item1);
    });
  });

  describe('forceSet', () => {
    it('adds item when key is missing', async () => {
      const item = { value: 'ForceSet' };
      cache.forceSet('key', item);
      expect(await cache.get('key')).toBe(item);
    });

    it('overwrites existing item', async () => {
      await cache.get('key');
      const item = { value: 'ForceSet' };
      cache.forceSet('key', item);
      expect(await cache.get('key')).toBe(item);
    });
  });

  //

  it('should load item async using loader if not cached', async () => {
    const item = await cache.get('key1');
    expect(item).toEqual({ value: 'Loaded key1' });
    expect(loader).toHaveBeenCalledWith('key1');
  });

  it('should return cached item on subsequent gets', async () => {
    const item1 = await cache.get('key1');
    const item2 = await cache.get('key1');
    expect(item1).toBe(item2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate concurrent loads', async () => {
    const [item1, item2] = await Promise.all([cache.get('key2'), cache.get('key2')]);
    expect(item1).toBe(item2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('should use async create if provided', async () => {
    const create = vi.fn(() => Promise.resolve({ value: 'Custom' }));
    const item = await cache.get('key3', create);
    expect(item).toEqual({ value: 'Custom' });
    expect(create).toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  describe('del', () => {
    it('removes entry (next get reloads)', async () => {
      await cache.get('key');
      cache.del('key');
      expect(cache.has('key')).toBe(false);
      await cache.get('key'); // should reload
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('watch', () => {
    it('executes callback immediately on get', async () => {
      const { promise, resolve } = getPromiseWithResolvers<{ value: string }>();
      const watcher = vi.fn<(item: { value: string }) => void>(resolve);

      cache.watch('key', watcher);
      await promise;

      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher.mock.calls[0][0].value).toBe('Loaded key');
    });

    it('executes callback on set', async () => {
      const { promise, resolve } = getPromiseWithResolvers<{ value: string }>();
      const watcher = vi.fn<(item: { value: string }) => void>(resolve);

      cache.watch('key', watcher);
      await promise;

      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(2);
      expect(watcher.mock.calls[1][0].value).toBe('value');
    });

    it("doesn't execute callback after del", async () => {
      const { promise, resolve } = getPromiseWithResolvers<{ value: string }>();
      const watcher = vi.fn<(item: { value: string }) => void>(resolve);

      cache.watch('key', watcher);
      await promise;

      cache.del('key');
      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('unwatch', () => {
    it('stops callback call', async () => {
      const { promise, resolve } = getPromiseWithResolvers<{ value: string }>();
      const watcher = vi.fn<(item: { value: string }) => void>(resolve);

      cache.watch('key', watcher);
      await promise;

      cache.unwatch('key', watcher);
      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('removes everything', async () => {
      const value1 = cache.get('key1');
      const value2 = cache.get('key2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.ids.length).toBe(0);
      await cache.get('key1'); // reloads
      expect(loader).toHaveBeenCalledTimes(3);
      void value1;
      void value2;
    });
  });

  it('should call async init after creation', async () => {
    const init = vi.fn(async (item: { value: string }) => {
      item.value = 'Initialized';
      await Promise.resolve();
    });
    const item = await cache.get('key4', undefined, init);
    expect(item.value).toBe('Initialized');
    expect(init).toHaveBeenCalledWith(item);
  });

  describe('tryGet', () => {
    it('should return cached item or null', async () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      expect(cache.tryGet('key5')).toBeNull();
      await cache.get('key5');
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      expect(cache.tryGet('key5')).not.toBeNull();
    });
  });

  describe('trySet', () => {
    it('should add item if not present or loading', async () => {
      const item = { value: 'TrySet' };
      expect(cache.trySet('key6', item)).toBe(true);
      expect(await cache.get('key6')).toBe(item);
    });

    it('should not set if present or loading', async () => {
      const item1 = await cache.get('key7');
      const item2 = { value: 'New' };
      expect(cache.trySet('key7', item2)).toBe(false);
      expect(await cache.get('key7')).toBe(item1);

      // Simulate loading
      void cache.get('key8'); // Start async load
      expect(cache.trySet('key8', item2)).toBe(false);
      const item3 = await cache.get('key8');
      expect(item3).not.toBe(item2);
    });

    it('should not interrupt loading', async () => {
      const pending = cache.get('key9'); // Start load
      const newItem = { value: 'Forced' };
      expect(cache.trySet('key9', newItem)).toBe(false);
      expect(await cache.get('key9')).toEqual({ value: 'Loaded key9' });
      await expect(pending).resolves.toEqual({ value: 'Loaded key9' });
    });
  });

  describe('forceSet', () => {
    it('should overwrite existing item', async () => {
      await cache.get('key10');
      const newItem = { value: 'Forced' };
      cache.forceSet('key10', newItem);
      expect(await cache.get('key10')).toBe(newItem);
    });

    it('should interrupt loading', async () => {
      const pending = cache.get('key11'); // Start load
      const newItem = { value: 'Forced' };
      cache.forceSet('key11', newItem);
      expect(await cache.get('key11')).toBe(newItem);
      await expect(pending).resolves.toBe(newItem);
    });
  });
});
