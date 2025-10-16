import { useEffect } from 'react';

interface KeyboardNavigationOptions {
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

export const useKeyboardNavigation = ({
  onArrowLeft,
  onArrowRight,
  onArrowUp,
  onArrowDown,
  onEnter,
  onEscape,
  enabled = true
}: KeyboardNavigationOptions) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          onArrowLeft?.();
          break;
        case 'ArrowRight':
          event.preventDefault();
          onArrowRight?.();
          break;
        case 'ArrowUp':
          event.preventDefault();
          onArrowUp?.();
          break;
        case 'ArrowDown':
          event.preventDefault();
          onArrowDown?.();
          break;
        case 'Enter':
          onEnter?.();
          break;
        case 'Escape':
          onEscape?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onArrowLeft, onArrowRight, onArrowUp, onArrowDown, onEnter, onEscape, enabled]);
};
