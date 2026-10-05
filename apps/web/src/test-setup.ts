import "@testing-library/jest-dom/vitest";
import "./test-globals";
import "./lib/i18n";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount rendered trees between tests (vitest globals are off, so RTL can't do it automatically).
afterEach(() => cleanup());

// jsdom lacks matchMedia
if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom doesn't implement scrolling
window.scrollTo = (() => undefined) as typeof window.scrollTo;
