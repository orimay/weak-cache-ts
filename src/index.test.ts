import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WeakCache, WeakCacheAsync } from '.';

describe('WeakCache', () => {
  let cache: WeakCache<{ value: string }, string>;
  let loader: Mock<
    (id: string) => {
      value: string;
    }
  >;

  beforeEach(() => {
    loader = vi.fn((id: string) => ({ value: `Loaded ${id}` }));
    cache = new WeakCache(loader);
  });

  it('should load item using loader if not cached', () => {
    const item = cache.get('key1');
    expect(item).toEqual({ value: 'Loaded key1' });
    expect(loader).toHaveBeenCalledWith('key1');
  });

  it('should return cached item on subsequent gets', () => {
    const item1 = cache.get('key1');
    const item2 = cache.get('key1');
    expect(item1).toBe(item2);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('should use create function if provided', () => {
    const create = vi.fn(() => ({ value: 'Custom' }));
    const item = cache.get('key2', create);
    expect(item).toEqual({ value: 'Custom' });
    expect(create).toHaveBeenCalled();
    expect(loader).not.toHaveBeenCalled();
  });

  it('should call init function after creation', () => {
    const init = vi.fn((item: { value: string }) => {
      item.value = 'Initialized';
    });
    const item = cache.get('key3', undefined, init);
    expect(item.value).toBe('Initialized');
    expect(init).toHaveBeenCalledWith(item);
  });

  describe('trySet', () => {
    it('should add item if not present', () => {
      const item = { value: 'TrySet' };
      cache.trySet('key4', item);
      expect(cache.get('key4')).toBe(item);
    });

    it('should not overwrite existing item', () => {
      const item1 = cache.get('key5');
      const item2 = { value: 'New' };
      cache.trySet('key5', item2);
      expect(cache.get('key5')).toBe(item1);
    });
  });

  describe('del', () => {
    it('should remove item from cache', () => {
      cache.get('key6');
      cache.del('key6');
      expect(cache.get('key6')).not.toBeUndefined(); // But it will reload
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('ids', () => {
    it('should return current keys', () => {
      cache.get('key7');
      cache.get('key8');
      expect(cache.ids.sort()).toEqual(['key7', 'key8'].sort());
    });
  });
});

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
    const [item1, item2] = await Promise.all([
      cache.get('key2'),
      cache.get('key2'),
    ]);
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
      expect(cache.tryGet('key5')).toBeNull();
      await cache.get('key5');
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

  describe('ids', () => {
    it('should return current keys', async () => {
      await cache.get('key11');
      await cache.get('key12');
      expect(cache.ids.sort()).toEqual(['key11', 'key12'].sort());
    });
  });
});
