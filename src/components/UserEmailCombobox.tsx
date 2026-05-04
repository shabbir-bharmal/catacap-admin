import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import axiosInstance from "@/api/axios";

export type UserEmailMatch = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
};

type SearchResponse = { items: UserEmailMatch[] };
type LookupResponse = { user: UserEmailMatch | null };

interface UserEmailComboboxProps {
  value: string;
  onChange: (email: string, user: UserEmailMatch | null) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  /** Called whenever the validity of the current `value` changes. */
  onValidityChange?: (valid: boolean) => void;
  /** When true, an empty value is considered valid (no error). Default: true. */
  allowEmpty?: boolean;
  className?: string;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function UserEmailCombobox({
  value,
  onChange,
  placeholder = "Search by email...",
  disabled,
  testId,
  onValidityChange,
  allowEmpty = true,
  className,
}: UserEmailComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const lastValidityRef = useRef<boolean | null>(null);
  const reportValidity = (valid: boolean) => {
    if (lastValidityRef.current !== valid) {
      lastValidityRef.current = valid;
      onValidityChange?.(valid);
    }
  };

  // Suggestion list: fetch when popover open and there's at least 2 chars typed.
  const searchQuery = useQuery<SearchResponse>({
    queryKey: ["user-email-search", debouncedQuery],
    queryFn: async () => {
      const res = await axiosInstance.get<SearchResponse>(
        "/api/admin/user/email-search",
        { params: { q: debouncedQuery, limit: 20 } },
      );
      return res.data;
    },
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  // Validation lookup for the current value (separate from suggestion search).
  const trimmedValue = (value || "").trim();
  const lookupQuery = useQuery<LookupResponse>({
    queryKey: ["user-email-lookup", trimmedValue.toLowerCase()],
    queryFn: async () => {
      const res = await axiosInstance.get<LookupResponse>(
        "/api/admin/user/email-lookup",
        { params: { email: trimmedValue } },
      );
      return res.data;
    },
    enabled: trimmedValue.length > 0,
    staleTime: 60_000,
  });

  const matchedUser = lookupQuery.data?.user ?? null;

  // Compute and report validity.
  useEffect(() => {
    if (!trimmedValue) {
      reportValidity(allowEmpty);
      return;
    }
    if (lookupQuery.isLoading) return; // don't toggle while loading
    reportValidity(!!matchedUser);
  }, [trimmedValue, matchedUser, lookupQuery.isLoading, allowEmpty]);

  const items = searchQuery.data?.items ?? [];

  const displayLabel = useMemo(() => {
    if (!trimmedValue) return null;
    if (matchedUser) {
      return matchedUser.fullName
        ? `${matchedUser.fullName} — ${matchedUser.email}`
        : matchedUser.email;
    }
    return trimmedValue;
  }, [trimmedValue, matchedUser]);

  const isInvalid = !!trimmedValue && !lookupQuery.isLoading && !matchedUser;

  const handleSelect = (user: UserEmailMatch) => {
    onChange(user.email, user);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", null);
    setQuery("");
  };

  return (
    <div className={cn("space-y-1", className)}>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              isInvalid && "border-[#f06548] focus-visible:ring-[#f06548]",
            )}
            data-testid={testId}
          >
            <span className={cn("truncate text-left", !displayLabel && "text-muted-foreground")}>
              {displayLabel ?? placeholder}
            </span>
            <span className="ml-2 flex items-center gap-1 shrink-0">
              {trimmedValue && !disabled && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label="Clear investment owner"
                  onClick={handleClear}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onChange("", null);
                    }
                  }}
                  className="inline-flex h-4 w-4 items-center justify-center rounded hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid={testId ? `${testId}-clear` : undefined}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[280px]" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type at least 2 characters..."
              value={query}
              onValueChange={setQuery}
              data-testid={testId ? `${testId}-input` : undefined}
            />
            <CommandList>
              {searchQuery.isFetching && (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching...
                </div>
              )}
              {!searchQuery.isFetching && debouncedQuery.length < 2 && (
                <div className="p-3 text-xs text-muted-foreground">
                  Type at least 2 characters to search.
                </div>
              )}
              {!searchQuery.isFetching && debouncedQuery.length >= 2 && items.length === 0 && (
                <CommandEmpty>No matching users found.</CommandEmpty>
              )}
              {items.length > 0 && (
                <CommandGroup>
                  {items.map((u) => {
                    const isSelected = u.email.toLowerCase() === trimmedValue.toLowerCase();
                    return (
                      <CommandItem
                        key={u.id}
                        value={u.email}
                        onSelect={() => handleSelect(u)}
                        data-testid={testId ? `${testId}-option-${u.id}` : undefined}
                      >
                        <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                        <div className="flex flex-col">
                          <span className="text-sm">{u.email}</span>
                          {u.fullName && (
                            <span className="text-xs text-muted-foreground">{u.fullName}</span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {isInvalid && (
        <p
          className="text-[#f06548] text-xs"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          User with such email address does not exist
        </p>
      )}
    </div>
  );
}
