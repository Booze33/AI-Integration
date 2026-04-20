import { RefObject, useEffect } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap<T extends HTMLElement>(
  isOpen: boolean,
  containerRef: RefObject<T | null>,
  onClose?: () => void
) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const previousFocused = document.activeElement as HTMLElement | null;
    const focusableElements = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((element) => !element.hasAttribute('disabled'));

    const firstFocusable = focusableElements[0] || container;
    firstFocusable.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onClose) {
          onClose();
          event.preventDefault();
        }
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => !element.hasAttribute('disabled'));

      if (elements.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocused) {
        previousFocused.focus();
      }
    };
  }, [containerRef, isOpen, onClose]);
}
