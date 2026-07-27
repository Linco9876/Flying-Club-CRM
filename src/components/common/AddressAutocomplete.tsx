import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Loader2, MapPin, Search } from 'lucide-react';
import { supabase } from '../../lib/supabase';

type AddressSuggestion = {
  id: string;
  address: string;
  provider: 'google' | 'openstreetmap';
};

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  id?: string;
  name?: string;
  autoComplete?: string;
}

export const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder = 'Start typing your street address',
  className = '',
  inputClassName = '',
  id,
  name,
  autoComplete = 'street-address',
}) => {
  const generatedId = useId();
  const inputId = id || `address-${generatedId.replace(/:/g, '')}`;
  const listboxId = `${inputId}-suggestions`;
  const rootRef = useRef<HTMLDivElement>(null);
  const requestSequence = useRef(0);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [provider, setProvider] = useState<'google' | 'openstreetmap' | 'unavailable' | 'none'>('none');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [message, setMessage] = useState('');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(true);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    const query = value.trim();
    const sequence = ++requestSequence.current;
    if (disabled || !suggestionsEnabled || query.length < 3 || query === selectedAddress) {
      setLoading(false);
      setSuggestions([]);
      setMessage('');
      setProvider('none');
      return;
    }

    setLoading(true);
    setMessage('');
    const timer = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('address-autocomplete', {
          body: { query },
        });
        if (sequence !== requestSequence.current) return;
        if (error) throw error;
        const nextSuggestions = Array.isArray(data?.suggestions)
          ? data.suggestions.filter((item: AddressSuggestion) => item?.id && item?.address)
          : [];
        setSuggestions(nextSuggestions);
        setProvider(data?.provider || 'none');
        setMessage(data?.message || '');
        setActiveIndex(nextSuggestions.length ? 0 : -1);
        setOpen(true);
      } catch (error) {
        if (sequence !== requestSequence.current) return;
        console.warn('Address suggestions are unavailable:', error);
        setSuggestions([]);
        setProvider('unavailable');
        setMessage('Suggestions are unavailable. You can still enter the address manually.');
        setOpen(true);
      } finally {
        if (sequence === requestSequence.current) setLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [disabled, selectedAddress, suggestionsEnabled, value]);

  const selectSuggestion = (suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion.address);
    onChange(suggestion.address);
    setSuggestions([]);
    setOpen(false);
    setMessage('');
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(current => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="relative">
        <MapPin aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          autoComplete={autoComplete}
          value={value}
          onChange={event => {
            setSelectedAddress('');
            onChange(event.target.value);
          }}
          onFocus={() => {
            if (suggestions.length || message) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          className={`w-full rounded-xl border border-slate-300 bg-white py-3 pl-9 pr-10 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 ${inputClassName}`}
        />
        {loading
          ? <Loader2 aria-label="Searching addresses" className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-blue-600" />
          : <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
      </div>

      {open && (suggestions.length > 0 || message) && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          {suggestions.length > 0 && (
            <ul id={listboxId} role="listbox" className="max-h-64 overflow-y-auto py-1">
              {suggestions.map((suggestion, index) => (
                <li
                  id={`${listboxId}-${index}`}
                  key={suggestion.id}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <button
                    type="button"
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => selectSuggestion(suggestion)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm ${
                      index === activeIndex ? 'bg-blue-50 text-blue-950' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {suggestion.address === value
                      ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                      : <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                    <span>{suggestion.address}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {message && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">{message}</p>}
          {provider === 'openstreetmap' && (
            <p className="border-t border-slate-100 px-3 py-1.5 text-right text-[10px] text-slate-500">
              Address data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap contributors</a>
            </p>
          )}
          {provider === 'google' && (
            <div className="flex justify-end border-t border-slate-100 px-3 py-1.5">
              <img
                src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png"
                alt="Powered by Google"
                className="h-[14px] w-auto"
              />
            </div>
          )}
        </div>
      )}
      <p className="mt-1 text-xs font-normal text-slate-500">
        {suggestionsEnabled ? 'Choose a suggestion when your address appears.' : 'Suggestions are off. Enter the complete address manually.'}{' '}
        <button
          type="button"
          onClick={() => {
            setSuggestionsEnabled(current => !current);
            setOpen(false);
            setSuggestions([]);
            setMessage('');
          }}
          className="font-semibold text-blue-700 underline hover:text-blue-900"
        >
          {suggestionsEnabled ? 'Enter without address lookup' : 'Turn suggestions on'}
        </button>
      </p>
    </div>
  );
};

export default AddressAutocomplete;
