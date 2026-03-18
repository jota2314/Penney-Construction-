"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";
import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

interface AddressParts {
  address: string;
  city: string;
  state: string;
  zip: string;
}

interface AddressAutocompleteProps {
  defaultValue?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  className?: string;
  onPlaceSelect?: (parts: AddressParts) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled?: boolean;
}

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

let optionsSet = false;

export function AddressAutocomplete({
  defaultValue = "",
  name = "address",
  id = "address",
  placeholder = "Start typing an address...",
  className,
  onPlaceSelect,
  onChange,
  disabled,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const callbackRef = useRef(onPlaceSelect);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  callbackRef.current = onPlaceSelect;

  // Load the API
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) return;
    if (serviceRef.current) return;

    if (!optionsSet) {
      setOptions({ key: apiKey, v: "weekly", libraries: ["places", "geocoding"] });
      optionsSet = true;
    }

    let cancelled = false;

    importLibrary("places").then(() => {
      if (cancelled) return;
      serviceRef.current = new google.maps.places.AutocompleteService();
      return importLibrary("geocoding");
    }).then(() => {
      if (cancelled) return;
      geocoderRef.current = new google.maps.Geocoder();
      setReady(true);
    });

    return () => { cancelled = true; };
  }, []);

  // Fetch predictions when user types
  const fetchPredictions = useCallback((input: string) => {
    if (!serviceRef.current || !input.trim()) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    serviceRef.current.getPlacePredictions(
      {
        input,
        componentRestrictions: { country: "us" },
        types: ["address"],
      },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          setPredictions(results as unknown as Prediction[]);
          setOpen(true);
          setActiveIndex(-1);
        } else {
          setPredictions([]);
          setOpen(false);
        }
      }
    );
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange?.(e);
    const val = e.target.value;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(val), 250);
  }

  // Select a prediction — geocode it to get address components
  async function handleSelect(prediction: Prediction) {
    if (!geocoderRef.current) return;

    setPredictions([]);
    setOpen(false);

    try {
      const response = await geocoderRef.current.geocode({
        placeId: prediction.place_id,
      });

      const result = response.results[0];
      if (!result?.address_components) return;

      let streetNumber = "";
      let route = "";
      let city = "";
      let state = "";
      let zip = "";

      for (const comp of result.address_components) {
        const types = comp.types;
        if (types.includes("street_number")) streetNumber = comp.long_name;
        if (types.includes("route")) route = comp.short_name;
        if (types.includes("locality")) city = comp.long_name;
        if (types.includes("sublocality_level_1") && !city) city = comp.long_name;
        if (types.includes("administrative_area_level_1")) state = comp.short_name;
        if (types.includes("postal_code")) zip = comp.long_name;
      }

      const address = [streetNumber, route].filter(Boolean).join(" ");

      if (inputRef.current) {
        // Update the input value directly
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set;
        nativeSetter?.call(inputRef.current, address);
        inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
      }

      callbackRef.current?.({ address, city, state, zip });
    } catch {
      // Geocoding failed — just use the description text
      if (inputRef.current) {
        inputRef.current.value = prediction.structured_formatting.main_text;
      }
    }
  }

  // Keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < predictions.length) {
        handleSelect(predictions[activeIndex]);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, predictions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setPredictions([]);
      setOpen(false);
    }
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        ref={inputRef}
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={ready ? placeholder : "Enter address..."}
        className={className}
        disabled={disabled}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (predictions.length > 0) setOpen(true); }}
        autoComplete="off"
      />
      {open && predictions.length > 0 && (
        <ul className="absolute z-[9999] top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {predictions.map((p, i) => (
            <li
              key={p.place_id}
              className={`flex items-start gap-2 px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                i === activeIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent input blur
                handleSelect(p);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <span className="font-medium">{p.structured_formatting.main_text}</span>
                {" "}
                <span className="text-muted-foreground text-xs">
                  {p.structured_formatting.secondary_text}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
