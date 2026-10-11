// Focus handling for the modal windows (top-up, "my data", frame versions, lightbox).
// While a window is open Tab and Shift+Tab stay inside it; when it closes focus goes back to what opened it.
// Windows are plain elements shown and hidden with the `hidden` attribute, so one observer per window is enough:
// no window code has to know about this module. `data-esc-close` makes Escape close a window that has no handler of its own.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const shown = (el) => el.getClientRects().length > 0;

export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(shown);
}

/** Starts trapping focus in `overlay`; returns the function that stops it. */
export function trapFocus(overlay) {
  const first = focusables(overlay)[0];
  if (first) first.focus();
  else {
    overlay.tabIndex = -1;
    overlay.focus();
  }
  const onKey = (e) => {
    if (e.key === "Escape" && overlay.hasAttribute("data-esc-close")) {
      overlay.hidden = true;
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables(overlay);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const firstEl = items[0];
    const lastEl = items[items.length - 1];
    const active = document.activeElement;
    if (!overlay.contains(active)) {
      e.preventDefault();
      firstEl.focus();
    } else if (e.shiftKey && active === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  };
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}

// The last element focused outside every window: the button that opened one. The window's own code may move focus
// into it before the observer below runs, so `document.activeElement` at that moment is too late.
let lastOutside = null;

function watch(overlay) {
  let release = null;
  let opener = null;
  const sync = () => {
    if (!overlay.hidden && !release) {
      opener = lastOutside?.isConnected ? lastOutside : document.activeElement;
      release = trapFocus(overlay);
    } else if (overlay.hidden && release) {
      release();
      release = null;
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
      opener = null;
    }
  };
  new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ["hidden"] });
  sync();
}

export function setupModalFocus(root = document) {
  document.addEventListener("focusin", (e) => {
    if (!e.target.closest?.(".overlay, .lightbox")) lastOutside = e.target;
  }, true);
  root.querySelectorAll(".overlay, .lightbox").forEach(watch);
}
