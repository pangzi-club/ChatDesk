export type WindowEventBus<T> = {
  dispatch: (detail: T) => void;
  subscribe: (listener: (detail: T) => void) => () => void;
};

/**
 * Typed `window` CustomEvent channel. Replaces the repeated
 * dispatch + addEventListener/removeEventListener boilerplate in the
 * `*-events.ts` modules.
 */
export function createWindowEventBus<T>(name: string): WindowEventBus<T> {
  return {
    dispatch(detail: T) {
      window.dispatchEvent(new CustomEvent<T>(name, { detail }));
    },
    subscribe(listener: (detail: T) => void) {
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<T>).detail;
        if (detail !== undefined && detail !== null) listener(detail);
      };
      window.addEventListener(name, handler);
      return () => window.removeEventListener(name, handler);
    },
  };
}
