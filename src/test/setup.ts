import "@testing-library/jest-dom";

// Guard DOM-only polyfills — Node-environment tests (e.g. RLS security tests) don't have document/window
const inBrowser = typeof document !== "undefined" && typeof window !== "undefined";

// input-otp (and some other UI libs) use ResizeObserver — jsdom doesn't include it
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (inBrowser) {
  // input-otp uses elementFromPoint — jsdom doesn't implement it
  if (!document.elementFromPoint) {
    document.elementFromPoint = () => null;
  }

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
