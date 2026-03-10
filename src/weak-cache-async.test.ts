import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WeakCacheAsync } from '.';
import { mockGC } from './test-utils';

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

  const { gc } = mockGC();

  beforeEach(() => {
    loader = vi.fn((id: string) => Promise.resolve({ value: `Loaded ${id}` }));
    cache = new WeakCacheAsync(loader);
  });

  it('loses GC-collected objects', async () => {
    expect(cache.size).toBe(0);
    let item: null | { value: string } = await cache.get('key1');
    expect(cache.size).toBe(1);
    item = null;
    void item;
    gc();
    expect(cache.size).toBe(0);
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

  describe('set', () => {
    describe('force', () => {
      it('adds item when key is missing', async () => {
        const item = { value: 'ForceSet' };
        expect(cache.set('key', item, 'force')).toBe(true);
        expect(await cache.get('key')).toBe(item);
      });

      it('overwrites existing item', async () => {
        await cache.get('key');
        const item = { value: 'ForceSet' };
        expect(cache.set('key', item, 'force')).toBe(true);
        expect(await cache.get('key')).toBe(item);
      });
    });

    describe('replace', () => {
      it('does not add item when key is missing', () => {
        const item = { value: 'ReplaceSet' };
        expect(cache.set('key', item, 'replace')).toBe(false);
        expect(cache.size).toBe(0);
      });

      it('overwrites existing item', async () => {
        await cache.get('key');
        const item = { value: 'ReplaceSet' };
        expect(cache.set('key', item, 'replace')).toBe(true);
        expect(await cache.get('key')).toBe(item);
      });
    });

    describe('try', () => {
      it('adds item when key is missing', async () => {
        const item = { value: 'TrySet' };
        expect(cache.set('key', item, 'try')).toBe(true);
        expect(await cache.get('key')).toBe(item);
      });

      it('does not overwrite existing item', async () => {
        const item1 = await cache.get('key');
        const item2 = { value: 'TrySet' };
        expect(cache.set('key', item2, 'try')).toBe(false);
        expect(await cache.get('key')).toBe(item1);
      });
    });
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

      cache.set('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(2);
      expect(watcher.mock.calls[1][0].value).toBe('value');
    });

    it("doesn't execute callback after del", async () => {
      const { promise, resolve } = getPromiseWithResolvers<{ value: string }>();
      const watcher = vi.fn<(item: { value: string }) => void>(resolve);

      cache.watch('key', watcher);
      await promise;

      cache.del('key');
      cache.set('key', { value: 'value' });

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
      cache.set('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('on', () => {
    describe('dispose', () => {
      it('executes callback on dispose', async () => {
        const watcher = vi.fn<(id: string) => void>();
        cache.on('dispose', watcher);

        expect(watcher).toHaveBeenCalledTimes(0);

        await cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(0);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith('key');
      });
    });
  });

  describe('off', () => {
    describe('dispose', () => {
      it('stops callback call', async () => {
        const watcher = vi.fn<(id: string) => void>();
        cache.on('dispose', watcher);

        await cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(0);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith('key');

        cache.off('dispose', watcher);

        await cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(1);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
      });
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
});
