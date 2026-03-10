import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { WeakCache } from '.';
import { mockGC } from './test-utils';

describe('WeakCache', () => {
  let cache: WeakCache<{ value: string }, string>;
  let loader: Mock<
    (id: string) => {
      value: string;
    }
  >;

  const { gc } = mockGC();

  beforeEach(() => {
    loader = vi.fn((id: string) => ({ value: `Loaded ${id}` }));
    cache = new WeakCache(loader);
  });

  it('loses GC-collected objects', () => {
    expect(cache.size).toBe(0);
    let item: null | { value: string } = cache.get('key1');
    expect(cache.size).toBe(1);
    item = null;
    void item;
    gc();
    expect(cache.size).toBe(0);
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
      const init = vi.fn((item: { value: string }) => {
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

  describe('set', () => {
    describe('force', () => {
      it('adds item when key is missing', () => {
        const item = { value: 'ForceSet' };
        expect(cache.set('key', item, 'force')).toBe(true);
        expect(cache.get('key')).toBe(item);
      });

      it('overwrites existing item', () => {
        cache.get('key');
        const item = { value: 'ForceSet' };
        expect(cache.set('key', item, 'force')).toBe(true);
        expect(cache.get('key')).toBe(item);
      });
    });

    describe('replace', () => {
      it('does not add item when key is missing', () => {
        const item = { value: 'ReplaceSet' };
        expect(cache.set('key', item, 'replace')).toBe(false);
        expect(cache.size).toBe(0);
      });

      it('overwrites existing item', () => {
        cache.get('key');
        const item = { value: 'ReplaceSet' };
        expect(cache.set('key', item, 'replace')).toBe(true);
        expect(cache.get('key')).toBe(item);
      });
    });

    describe('try', () => {
      it('adds item when key is missing', () => {
        const item = { value: 'TrySet' };
        expect(cache.set('key', item, 'try')).toBe(true);
        expect(cache.get('key')).toBe(item);
      });

      it('does not overwrite existing item', () => {
        const item1 = cache.get('key');
        const item2 = { value: 'TrySet' };
        expect(cache.set('key', item2, 'try')).toBe(false);
        expect(cache.get('key')).toBe(item1);
      });
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
      const watcher = vi.fn<(item: { value: string }) => void>();
      cache.watch('key', watcher);

      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher.mock.calls[0][0].value).toBe('Loaded key');
    });

    it('executes callback on set', () => {
      const watcher = vi.fn<(item: { value: string }) => void>();
      cache.watch('key', watcher);

      cache.set('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(2);
      expect(watcher.mock.calls[1][0].value).toBe('value');
    });

    it("doesn't execute callback after del", () => {
      const watcher = vi.fn<(item: { value: string }) => void>();
      cache.watch('key', watcher);

      cache.del('key');
      cache.set('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('unwatch', () => {
    it('stops callback call', () => {
      const watcher = vi.fn<(item: { value: string }) => void>();
      cache.watch('key', watcher);

      cache.unwatch('key', watcher);
      cache.set('key', { value: 'value' });

      expect(watcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('on', () => {
    describe('dispose', () => {
      it('executes callback on dispose', () => {
        const watcher = vi.fn<(id: string) => void>();
        cache.on('dispose', watcher);

        expect(watcher).toHaveBeenCalledTimes(0);

        cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(0);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith('key');
      });
    });
  });

  describe('off', () => {
    describe('dispose', () => {
      it('stops callback call', () => {
        const watcher = vi.fn<(id: string) => void>();
        cache.on('dispose', watcher);

        cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(0);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith('key');

        cache.off('dispose', watcher);

        cache.get('key');
        expect(watcher).toHaveBeenCalledTimes(1);

        gc();
        expect(watcher).toHaveBeenCalledTimes(1);
      });
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
