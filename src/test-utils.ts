export function mockGC() {
  const cleanups = new Map<WeakKey, () => void>();

  globalThis.FinalizationRegistry = class<T> {
    constructor(private readonly cleanup: (heldValue: T) => void) {}

    register(target: WeakKey, heldValue: T, unregisterToken?: WeakKey) {
      cleanups.set(unregisterToken ?? target, () => {
        this.cleanup(heldValue);
      });
    }

    unregister(unregisterToken: WeakKey) {
      return cleanups.delete(unregisterToken);
    }

    public readonly [Symbol.toStringTag] = 'FinalizationRegistry';
  };

  function cleanup() {
    cleanups.forEach(cleanup => {
      cleanup();
    });
    cleanups.clear();
  }

  function gc(minor?: boolean): void;
  function gc(
    options: NodeJS.GCOptions & { execution: 'async' },
  ): Promise<void>;
  function gc(options: NodeJS.GCOptions): void;
  function gc(
    options?:
      | boolean
      | NodeJS.GCOptions
      | (NodeJS.GCOptions & { execution: 'async' }),
  ) {
    if (typeof options === 'object' && options.execution === 'async') {
      return Promise.resolve().then(cleanup);
    } else {
      cleanup();
    }
  }

  globalThis.gc = gc;

  return { gc };
}
