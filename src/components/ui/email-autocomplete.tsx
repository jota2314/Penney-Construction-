"use client";

import { useState, useRef, useEffect } from "react";

interface Contact {
  name: string;
  email: string;
  type: string;
}

interface EmailAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export function EmailAutocomplete({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  label,
}: EmailAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Search contacts when input changes
  function handleInputChange(text: string) {
    onChange(text);

    // Get the last segment (after the last comma) for searching
    const lastSegment = text.split(",").pop()?.trim() || "";

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (lastSegment.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/search-contacts?q=${encodeURIComponent(lastSegment)}`
        );
        const data = await res.json();
        setSuggestions(data.contacts || []);
        setShowSuggestions((data.contacts || []).length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
  }

  function handleSelect(contact: Contact) {
    // Replace the last segment with the selected contact
    const parts = value.split(",").map((s) => s.trim());
    parts.pop(); // Remove the partial text
    const formatted = `${contact.name} <${contact.email}>`;
    parts.push(formatted);
    onChange(parts.join(", "));
    setShowSuggestions(false);
    setSuggestions([]);
    inputRef.current?.focus();
  }

  // Close suggestions on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative flex-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setShowSuggestions(true);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowSuggestions(false)}
          />
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-background border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
            {suggestions.map((contact, i) => (
              <button
                key={`${contact.email}-${i}`}
                onClick={() => handleSelect(contact)}
                className="w-full px-3 py-2 text-left hover:bg-muted flex items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{contact.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {contact.email}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0 px-1.5 py-0.5 rounded bg-muted">
                  {contact.type}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
