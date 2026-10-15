/**
 * Global modal behavior for hand-rolled modals (divs with "fixed inset-0").
 *
 * 1. Scroll lock: while any modal is open, background scrolling is blocked.
 *    - body overflow is locked via CSS (:has selector in index.css).
 *    - wheel/touchmove scroll chaining into page-level scroll containers is
 *      blocked here, while scrolling inside scrollable modal content (or
 *      portaled dropdowns) keeps working.
 *
 * 2. Backdrop click-to-close: a direct press on the backdrop (outside the
 *    dialog content) activates the modal's own close control
 *    ([aria-label*="close"] / [data-close-modal]), so existing close logic
 *    and disabled-state guards are preserved.
 */

const BACKDROP_SELECTOR = 'div[class*="fixed inset-0"]';
const CLOSE_CONTROL_SELECTOR = '[aria-label*="close" i], [data-close-modal]';
const CLOSE_TEXT_PATTERN = /^(cancel|close|keep backup|got it|ok|done)$/i;

const findCloseControl = (backdrop) => {
  const labeled = backdrop.querySelector(CLOSE_CONTROL_SELECTOR);
  if (labeled) return labeled;
  for (const control of backdrop.querySelectorAll("button, [role='button']")) {
    if (CLOSE_TEXT_PATTERN.test(control.textContent.trim())) return control;
  }
  return null;
};

const isModalBackdrop = (element) =>
  element instanceof HTMLElement &&
  element.tagName === "DIV" &&
  typeof element.className === "string" &&
  element.className.includes("fixed inset-0");

const getTopmostBackdrop = () => {
  const backdrops = document.querySelectorAll(BACKDROP_SELECTOR);
  return backdrops.length > 0 ? backdrops[backdrops.length - 1] : null;
};

const findScrollableAncestor = (start, stopAt = null) => {
  let node = start instanceof Element ? start : null;
  while (node && node !== stopAt) {
    if (node instanceof HTMLElement) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
        return node;
      }
    }
    node = node.parentElement;
  }
  return null;
};

const guardBackgroundScroll = (event) => {
  const backdrop = getTopmostBackdrop();
  if (!backdrop || !(event.target instanceof Element)) return;

  // Scrollable content inside the modal keeps working.
  if (findScrollableAncestor(event.target, backdrop)) return;
  // Portaled content (dropdowns, tooltips) outside the backdrop keeps working.
  if (!backdrop.contains(event.target) && findScrollableAncestor(event.target)) return;
  // A scrollable backdrop itself may still scroll.
  if (event.target === backdrop && backdrop.scrollHeight > backdrop.clientHeight) return;

  event.preventDefault();
};

const closeOnBackdropPress = (event) => {
  if (event.button !== 0) return;
  // Only react when the backdrop element itself was pressed (outside the dialog).
  if (!isModalBackdrop(event.target)) return;

  const closeControl = findCloseControl(event.target);
  if (closeControl instanceof HTMLElement && !closeControl.hasAttribute("disabled") && !closeControl.getAttribute("aria-disabled")) {
    closeControl.click();
  }
};

let installed = false;

export const installGlobalModalBehavior = () => {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("wheel", guardBackgroundScroll, { capture: true, passive: false });
  document.addEventListener("touchmove", guardBackgroundScroll, { capture: true, passive: false });
  document.addEventListener("mousedown", closeOnBackdropPress, true);
};
