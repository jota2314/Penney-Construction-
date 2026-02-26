"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
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
  onPlaceSelect?: (parts: AddressParts) => void;
  disabled?: boolean;
}

let optionsSet = false;

export function AddressAutocomplete({
  defaultValue = "",
  name = "address",
  id = "address",
  placeholder = "Start typing an address...",
  onPlaceSelect,
  disabled,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const callbackRef = useRef(onPlaceSelect);
  const [hasApi, setHasApi] = useState(false);

  // Keep the callback ref up to date without triggering the effect
  callbackRef.current = onPlaceSelect;

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey || !inputRef.current) return;
    // Only set up once
    if (autocompleteRef.current) return;

    if (!optionsSet) {
      setOptions({ key: apiKey, v: "weekly", libraries: ["places"] });
      optionsSet = true;
    }

    let cancelled = false;

    importLibrary("places").then(() => {
      if (cancelled || !inputRef.current) return;
      setHasApi(true);

      const autocomplete = new google.maps.places.Autocomplete(
        inputRef.current,
        {
          componentRestrictions: { country: "us" },
          fields: ["address_components"],
          types: ["address"],
        }
      );

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (!place?.address_components) return;

        let streetNumber = "";
        let route = "";
        let city = "";
        let state = "";
        let zip = "";

        for (const comp of place.address_components) {
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
          inputRef.current.value = address;
        }

        callbackRef.current?.({ address, city, state, zip });
      });

      autocompleteRef.current = autocomplete;
    });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Input
      ref={inputRef}
      id={id}
      name={name}
      defaultValue={defaultValue}
      placeholder={hasApi ? placeholder : "Enter address..."}
      disabled={disabled}
      autoComplete="off"
    />
  );
}
