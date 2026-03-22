"use client";

if (typeof window !== "undefined" && !window.__DEMO_CONSOLE_FILTER_INSTALLED) {
  window.__DEMO_CONSOLE_FILTER_INSTALLED = true;

  const shouldIgnore = (value) => {
    if (typeof value !== "string") return false;

    return (
      value.includes("XNNPACK") ||
      value.includes("TensorFlow Lite") ||
      value.includes("MediaPipe") ||
      value.includes("vision_wasm_internal")
    );
  };

  const originalError = console.error;
  console.error = (...args) => {
    if (args.some(shouldIgnore)) return;
    originalError.apply(console, args);
  };

  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args.some(shouldIgnore)) return;
    originalWarn.apply(console, args);
  };

  window.addEventListener(
    "error",
    (event) => {
      const message = event.message || "";
      const filename = event.filename || "";

      if (
        shouldIgnore(message) ||
        filename.includes("vision_wasm_internal")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true
  );
}

export function ConsoleSilencer() {
  return null;
}
