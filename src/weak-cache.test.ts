import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WeakCache } from '.';

describe('WeakCache', () => {
  let cache: WeakCache<{ value: string; }, string>;
  let loader: Mock<
    (id: string) => {
      value: string;
    }
  >;

  beforeEach(() => {
    loader = vi.fn((id: string) => ({ value: `Loaded ${id}` }));
    cache = new WeakCache(loader);
  });

  describe('size', () => {
    it('reflects current live entries', () => {
      expect(cache.size).toBe(0);
      cache.get('key1');
      cache.get('key2');
      expect(cache.size).toBe(2);
      cache.del('key1');
      expect(cache.size).toBe(1);
    });
  });

  describe('ids', () => {
    it('returns current keys', () => {
      cache.get('key1');
      cache.get('key2');
      expect(cache.ids.sort()).toEqual(['key1', 'key2'].sort());
    });
  });

  describe('entries', () => {
    it('yields only live values', () => {
      cache.get('key1');
      cache.get('key2');
      const entries = [...cache.entries()].map(([k]) => k).sort();
      expect(entries).toEqual(['key1', 'key2'].sort());
    });
  });

  describe('has', () => {
    it('returns correct live status', () => {
      expect(cache.has('key')).toBe(false);
      cache.get('key');
      expect(cache.has('key')).toBe(true);
    });
  });

  describe('get', () => {
    it('loads item using loader if not cached', () => {
      const item = cache.get('key');
      expect(item).toEqual({ value: 'Loaded key' });
      expect(loader).toHaveBeenCalledWith('key');
    });

    it('returns same instance on subsequent gets', () => {
      const item1 = cache.get('key');
      const item2 = cache.get('key');
      expect(item1).toBe(item2);
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('uses provided create function instead of loader', () => {
      const create = vi.fn(() => ({ value: 'Custom' }));
      const item = cache.get('key', create);
      expect(item).toEqual({ value: 'Custom' });
      expect(create).toHaveBeenCalled();
      expect(loader).not.toHaveBeenCalled();
    });

    it('calls init after creation', () => {
      const init = vi.fn((item: { value: string; }) => {
        item.value += ' init';
      });
      const item = cache.get('key', undefined, init);
      expect(item.value).toBe('Loaded key init');
      expect(init).toHaveBeenCalledWith(item);
    });
  });

  describe('peek', () => {
    it('loads item using loader if not cached', () => {
      cache.get('key');
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

  describe('trySet', () => {
    it('adds item when key is missing', () => {
      const item = { value: 'TrySet' };
      cache.trySet('key', item);
      expect(cache.get('key')).toBe(item);
    });

    it('does not overwrite existing item', () => {
      const item1 = cache.get('key');
      const item2 = { value: 'New' };
      cache.trySet('key', item2);
      expect(cache.get('key')).toBe(item1);
    });
  });

  describe('forceSet', () => {
    it('adds item when key is missing', () => {
      const item = { value: 'ForceSet' };
      cache.forceSet('key', item);
      expect(cache.get('key')).toBe(item);
    });

    it('overwrites existing item', () => {
      cache.get('key');
      const item = { value: 'ForceSet' };
      cache.forceSet('key', item);
      expect(cache.get('key')).toBe(item);
    });
  });

  describe('del', () => {
    it('removes entry (next get reloads)', () => {
      cache.get('key');
      cache.del('key');
      expect(cache.has('key')).toBe(false);
      cache.get('key'); // should reload
      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('watch', () => {
    it('executes callback immediately on get', () => {
      const watcher = vi.fn<(item: { value: string; }) => void>();
      cache.watch('key', watcher);

      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher.mock.calls[0][0].value).toBe('Loaded key');
    });

    it('executes callback on set', () => {
      const watcher = vi.fn<(item: { value: string; }) => void>();
      cache.watch('key', watcher);

      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(2);
      expect(watcher.mock.calls[1][0].value).toBe('value');
    });

    it("doesn't execute callback after del", () => {
      const watcher = vi.fn<(item: { value: string; }) => void>();
      cache.watch('key', watcher);

      cache.del('key');
      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('unwatch', () => {
    it('stops callback call', () => {
      const watcher = vi.fn<(item: { value: string; }) => void>();
      cache.watch('key', watcher);

      cache.unwatch('key', watcher);
      cache.forceSet('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('removes everything', () => {
      const value1 = cache.get('key1');
      const value2 = cache.get('key2');
      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.ids.length).toBe(0);
      cache.get('key1'); // reloads
      expect(loader).toHaveBeenCalledTimes(3);
      void value1;
      void value2;
    });
  });
});
