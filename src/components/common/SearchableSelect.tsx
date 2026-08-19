import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { filterSelectOptionsByPrefix, type SearchableSelectOption } from '../../utils/searchableSelect';

type OptionElementProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};

type GroupElementProps = {
  label?: string;
  disabled?: boolean;
  children?: ReactNode;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const textFromNode = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textFromNode(node.props.children);
  return '';
};

const collectOptions = (children: ReactNode) => {
  const options: SearchableSelectOption[] = [];

  const visit = (nodes: ReactNode, group?: string, groupDisabled = false) => {
    Children.forEach(nodes, child => {
      if (!isValidElement(child)) return;
      if (child.type === Fragment) {
        visit((child as ReactElement<{ children?: ReactNode }>).props.children, group, groupDisabled);
        return;
      }
      if (child.type === 'optgroup') {
        const props = (child as ReactElement<GroupElementProps>).props;
        visit(props.children, props.label || group, groupDisabled || Boolean(props.disabled));
        return;
      }
      if (child.type !== 'option') return;
      const props = (child as ReactElement<OptionElementProps>).props;
      const label = textFromNode(props.children).replace(/\s+/g, ' ').trim();
      options.push({
        value: String(props.value ?? label),
        label,
        disabled: groupDisabled || Boolean(props.disabled),
        group,
      });
    });
  };

  visit(children);
  return options;
};

const normaliseValues = (value: string | number | readonly string[] | undefined) => {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined ? [] : [String(value)];
};

const usePhoneLayout = () => {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)');
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return phone;
};

export const SearchableSelect = ({
  children,
  className = '',
  style,
  value,
  defaultValue,
  multiple = false,
  disabled = false,
  required = false,
  ...selectProps
}: SelectHTMLAttributes<HTMLSelectElement>) => {
  const options = useMemo(() => collectOptions(children), [children]);
  const initialValues = useMemo(() => {
    if (defaultValue !== undefined) return normaliseValues(defaultValue);
    if (multiple) return [];
    return options[0] ? [options[0].value] : [];
  }, [defaultValue, multiple, options]);
  const [uncontrolledValues, setUncontrolledValues] = useState<string[]>(initialValues);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const phoneSearchRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = `searchable-select-${useId().replace(/:/g, '')}`;
  const phone = usePhoneLayout();
  const controlled = value !== undefined;
  const selectedValues = controlled ? normaliseValues(value) : uncontrolledValues;
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabels = options.filter(option => selectedSet.has(option.value)).map(option => option.label);
  const displayValue = selectedLabels.join(', ');
  const filteredOptions = useMemo(() => filterSelectOptionsByPrefix(options, query), [options, query]);
  const fullWidth = /(?:^|\s)(?:w-full|flex-1|block|input)(?:\s|$)/.test(className);
  const visibleInputId = selectProps.id;
  const nativeSelectId = visibleInputId ? `${visibleInputId}--native` : undefined;

  useEffect(() => {
    if (controlled || multiple || uncontrolledValues.length > 0 || options.length === 0) return;
    setUncontrolledValues([options[0].value]);
  }, [controlled, multiple, options, uncontrolledValues.length]);

  useEffect(() => {
    const firstEnabledIndex = filteredOptions.findIndex(option => !option.disabled);
    setActiveIndex(firstEnabledIndex >= 0 ? firstEnabledIndex : 0);
  }, [filteredOptions, open]);

  useEffect(() => {
    if (!open || !phone) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, phone]);

  useEffect(() => {
    if (controlled) return;
    const select = nativeRef.current;
    const form = select?.form;
    if (!select || !form) return;
    const syncAfterReset = () => window.setTimeout(() => {
      const resetValues = multiple
        ? Array.from(select.selectedOptions, option => option.value)
        : [select.value];
      setUncontrolledValues(resetValues);
      setOpen(false);
      setQuery('');
    });
    form.addEventListener('reset', syncAfterReset);
    return () => form.removeEventListener('reset', syncAfterReset);
  }, [controlled, multiple]);

  const updateMenuPosition = useCallback(() => {
    if (!wrapperRef.current || phone) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const gap = 6;
    const below = viewportTop + viewportHeight - rect.bottom - gap;
    const above = rect.top - viewportTop - gap;
    const openUp = below < 220 && above > below;
    const maxHeight = Math.max(140, Math.min(300, openUp ? above : below));
    const width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
    const left = Math.min(Math.max(rect.left, viewportLeft + 8), viewportLeft + viewportWidth - width - 8);
    setMenuPosition(openUp
      ? { left, width, maxHeight, bottom: window.innerHeight - rect.top + gap }
      : { left, width, maxHeight, top: rect.bottom + gap });
  }, [phone]);

  useLayoutEffect(() => {
    if (!open || phone) return;
    updateMenuPosition();
    const update = () => updateMenuPosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, [open, phone, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeForOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', closeForOutsidePress);
    return () => document.removeEventListener('pointerdown', closeForOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open || !phone) return;
    const timer = window.setTimeout(() => phoneSearchRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, phone]);

  const openMenu = () => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    setQuery('');
    if (!phone) inputRef.current?.focus();
  };

  const dispatchSelection = (nextValues: string[]) => {
    const select = nativeRef.current;
    if (!select) return;
    const nextSet = new Set(nextValues);
    if (multiple) {
      Array.from(select.options).forEach(option => {
        option.selected = nextSet.has(option.value);
      });
    } else {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, nextValues[0] ?? '');
    }
    setUncontrolledValues(nextValues);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const chooseOption = (option: SearchableSelectOption) => {
    if (option.disabled) return;
    if (multiple) {
      const next = selectedSet.has(option.value)
        ? selectedValues.filter(item => item !== option.value)
        : [...selectedValues, option.value];
      dispatchSelection(next);
      setQuery('');
      if (phone) phoneSearchRef.current?.focus();
      else inputRef.current?.focus();
      return;
    }
    dispatchSelection([option.value]);
    closeMenu();
  };

  const moveActiveOption = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    let index = activeIndex;
    for (let checked = 0; checked < filteredOptions.length; checked += 1) {
      index = Math.min(filteredOptions.length - 1, Math.max(0, index + direction));
      if (!filteredOptions[index]?.disabled) {
        setActiveIndex(index);
        return;
      }
      if (index === 0 || index === filteredOptions.length - 1) return;
    }
  };

  const handleDesktopKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) openMenu();
      else moveActiveOption(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveOption(-1);
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      const index = filteredOptions.findIndex(option => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      let index = -1;
      for (let candidate = filteredOptions.length - 1; candidate >= 0; candidate -= 1) {
        if (!filteredOptions[candidate].disabled) {
          index = candidate;
          break;
        }
      }
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = filteredOptions[activeIndex];
      if (option) chooseOption(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu();
    }
  };

  const menuContent = open ? (
    <>
      {phone ? <button type="button" aria-label="Close dropdown" className="fixed inset-0 z-[999998] cursor-default bg-slate-950/35" onClick={closeMenu} /> : null}
      <div
        ref={menuRef}
        className={phone
          ? 'fixed inset-x-0 bottom-0 z-[999999] flex max-h-[min(72dvh,36rem)] flex-col rounded-t-3xl border border-slate-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl dark:border-slate-700 dark:bg-slate-900'
          : 'fixed z-[999999] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900'}
        style={phone ? undefined : menuPosition as CSSProperties}
      >
        {phone ? (
          <div className="border-b border-slate-200 p-3 dark:border-slate-700">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Choose an option</p>
              <button type="button" aria-label="Close dropdown" onClick={closeMenu} className="flex h-11 w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={phoneSearchRef}
                aria-label="Filter dropdown options"
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={handleDesktopKeyDown}
                className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-base text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
                placeholder="Type to filter from the beginning…"
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}
        <div
          id={listboxId}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
          style={phone ? undefined : { maxHeight: menuPosition?.maxHeight }}
        >
          {filteredOptions.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No options start with “{query}”</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Try fewer letters.</p>
            </div>
          ) : filteredOptions.map((option, index) => {
            const selected = selectedSet.has(option.value);
            const showGroup = option.group && (index === 0 || filteredOptions[index - 1]?.group !== option.group);
            return (
              <Fragment key={`${option.value}-${index}`}>
                {showGroup ? <div className="px-3 pb-1 pt-2 text-[0.68rem] font-black uppercase tracking-wider text-slate-400">{option.group}</div> : null}
                <button
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onPointerDown={event => { if (!phone) event.preventDefault(); }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseOption(option)}
                  className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${index === activeIndex ? 'bg-blue-50 text-blue-950 dark:bg-blue-950/60 dark:text-blue-100' : 'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800'} ${option.disabled ? 'cursor-not-allowed opacity-45' : ''}`}
                >
                  <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  {selected ? <Check className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" /> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
        {multiple ? (
          <div className="border-t border-slate-200 p-2 dark:border-slate-700">
            <button type="button" onClick={closeMenu} className="min-h-11 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Done · {selectedValues.length} selected</button>
          </div>
        ) : null}
      </div>
    </>
  ) : null;

  return (
    <div ref={wrapperRef} className={`searchable-select relative min-w-0 align-middle ${fullWidth ? 'block w-full' : 'inline-block max-w-full'}`}>
      <select
        {...selectProps}
        ref={nativeRef}
        id={nativeSelectId}
        value={value}
        defaultValue={defaultValue}
        multiple={multiple}
        disabled={disabled}
        required={required}
        className="searchable-select-native"
        tabIndex={-1}
        aria-hidden="true"
        onChange={event => {
          if (!controlled) {
            const nextValues = multiple
              ? Array.from(event.currentTarget.selectedOptions, option => option.value)
              : [event.currentTarget.value];
            setUncontrolledValues(nextValues);
          }
          selectProps.onChange?.(event);
        }}
        onFocus={event => {
          selectProps.onFocus?.(event);
          inputRef.current?.focus();
          openMenu();
        }}
        onInvalid={event => {
          selectProps.onInvalid?.(event);
          inputRef.current?.focus();
          openMenu();
        }}
      >
        {children}
      </select>
      <input
        ref={inputRef}
        id={visibleInputId}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-label={selectProps['aria-label']}
        aria-describedby={selectProps['aria-describedby']}
        aria-invalid={selectProps['aria-invalid']}
        aria-required={required || undefined}
        disabled={disabled}
        readOnly={phone}
        value={open && !phone ? query : displayValue}
        onFocus={openMenu}
        onClick={openMenu}
        onChange={event => {
          setQuery(event.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleDesktopKeyDown}
        autoComplete="off"
        title={selectProps.title}
        className={`${className} searchable-select-input pr-10`}
        style={style}
        placeholder="Select or type to filter…"
      />
      <ChevronDown aria-hidden="true" className={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform dark:text-slate-300 ${open ? 'rotate-180' : ''}`} />
      {typeof document !== 'undefined' && menuContent ? createPortal(menuContent, document.body) : null}
    </div>
  );
};
