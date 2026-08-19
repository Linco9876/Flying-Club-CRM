import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { filterSelectOptionsByPrefix } from '../../utils/searchableSelect';

type SearchableSuggestionInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'list' | 'onChange' | 'value'> & {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

export const SearchableSuggestionInput = ({
  value,
  options,
  onValueChange,
  className = '',
  disabled,
  onFocus,
  onBlur,
  onKeyDown,
  ...inputProps
}: SearchableSuggestionInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const listboxId = `searchable-suggestions-${useId().replace(/:/g, '')}`;
  const uniqueOptions = useMemo(() => [...new Set(options.map(option => option.trim()).filter(Boolean))], [options]);
  const filteredOptions = useMemo(
    () => filterSelectOptionsByPrefix(uniqueOptions.map(option => ({ label: option })), value).map(option => option.label),
    [uniqueOptions, value],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open]);

  const updateMenuPosition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const phone = viewportWidth <= 640;
    const gap = 6;
    const below = viewportTop + viewportHeight - rect.bottom - gap;
    const above = rect.top - viewportTop - gap;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.max(112, Math.min(phone ? 240 : 280, openUp ? above : below));
    const width = phone
      ? Math.max(220, viewportWidth - 16)
      : Math.min(Math.max(rect.width, 220), viewportWidth - 16);
    const left = phone
      ? viewportLeft + 8
      : Math.min(Math.max(rect.left, viewportLeft + 8), viewportLeft + viewportWidth - width - 8);
    setMenuPosition(openUp
      ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap }
      : { left, width, maxHeight, top: rect.bottom + gap });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const update = () => updateMenuPosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    const observer = new ResizeObserver(update);
    if (inputRef.current) observer.observe(inputRef.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeForOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeForOutsidePress);
    return () => document.removeEventListener('pointerdown', closeForOutsidePress);
  }, [open]);

  const chooseOption = (option: string) => {
    onValueChange(option);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex(index => Math.min(filteredOptions.length - 1, index + 1));
    } else if (event.key === 'ArrowUp' && open) {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
      event.preventDefault();
      chooseOption(filteredOptions[activeIndex]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const menu = open && uniqueOptions.length > 0 ? (
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      className="fixed z-[999999] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ ...menuPosition, maxHeight: menuPosition?.maxHeight } as CSSProperties}
    >
      {filteredOptions.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No saved options start with &ldquo;{value}&rdquo;</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">You can keep typing to use a new value.</p>
        </div>
      ) : filteredOptions.map((option, index) => (
        <button
          id={`${listboxId}-option-${index}`}
          key={option}
          type="button"
          role="option"
          aria-selected={option === value}
          onPointerDown={event => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => chooseOption(option)}
          className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${index === activeIndex ? 'bg-blue-50 text-blue-950 dark:bg-blue-950/60 dark:text-blue-100' : 'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800'}`}
        >
          <span className="min-w-0 flex-1 break-words">{option}</span>
          {option === value ? <Check className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" /> : null}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <input
        {...inputProps}
        ref={inputRef}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        value={value}
        onChange={event => {
          onValueChange(event.target.value);
          setOpen(true);
        }}
        onFocus={event => {
          onFocus?.(event);
          if (!disabled && uniqueOptions.length > 0) setOpen(true);
        }}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        className={className}
      />
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </>
  );
};
