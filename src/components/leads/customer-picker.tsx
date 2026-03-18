"use client";

import { useState, useEffect } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { getCustomers } from "@/lib/actions/customers";

export interface CustomerOption {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface CustomerPickerProps {
  selectedId: string | null;
  onSelect: (customer: CustomerOption | null) => void;
  onNewCustomer: () => void;
}

export function CustomerPicker({
  selectedId,
  onSelect,
  onNewCustomer,
}: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (open && !loaded) {
      getCustomers().then((data) => {
        setCustomers(data as CustomerOption[]);
        setLoaded(true);
      });
    }
  }, [open, loaded]);

  const selected = customers.find((c) => c.id === selectedId);
  const label = selected
    ? `${selected.first_name} ${selected.last_name}`
    : "Search existing customer...";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name, phone, email..." />
          <CommandList>
            <CommandEmpty>No customers found.</CommandEmpty>
            <CommandGroup>
              {customers.map((c) => {
                const name = `${c.first_name} ${c.last_name}`;
                const detail = c.phone || c.email || "";
                return (
                  <CommandItem
                    key={c.id}
                    value={`${name} ${detail} ${c.address || ""}`}
                    onSelect={() => {
                      onSelect(selectedId === c.id ? null : c);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedId === c.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{name}</span>
                      {detail && (
                        <span className="text-xs text-muted-foreground">
                          {detail}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onSelect(null);
                  onNewCustomer();
                  setOpen(false);
                }}
              >
                <UserPlus className="mr-2 h-4 w-4" />
                New Customer
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
