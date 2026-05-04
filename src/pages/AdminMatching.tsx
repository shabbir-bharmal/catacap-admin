import { useState, useCallback, useEffect } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../api/axios";
import { currency_format, formatDate } from "../helpers/format";
import { Plus, Pencil, Trash2, GitMerge, Activity, ChevronDown, ChevronRight, Search, Loader2, Clock, Download } from "lucide-react";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //
interface Campaign { id: number; name: string; }
interface MatchGrant {
  id: number;
  name: string;
  donorUserId: string;
  donorEmail: string;
  donorFullName: string;
  donorBalance: number;
  totalCap: number | null;
  amountUsed: number;
  reservedAmount: number;
  matchType: "full" | "capped";
  perInvestmentCap: number | null;
  isActive: boolean;
  notes: string;
  expiresAt: string | null;
  retroactiveFrom: string | null;
  createdAt: string;
  timesUsed: number;
  pendingAmount?: number;
  pendingCount?: number;
  campaigns: Campaign[];
}
interface ActivityEntry {
  id: number;
  amount: number;
  createdAt: string;
  campaignName: string;
  investorFullName: string;
  investorEmail: string;
  triggeringRecommendationId: number | null;
  donorRecommendationId: number | null;
}
interface PendingActivityEntry {
  id: string;
  amount: number;
  triggerDate: string | null;
  campaignName: string;
  investorFullName: string;
  investorEmail: string;
  triggerType: "recommendation" | "pending_grant";
  triggerStatus: string;
  triggerAmount: number;
}
interface ActivityResponse {
  items: ActivityEntry[];
  pendingItems: PendingActivityEntry[];
  pendingTotal: number;
}
interface DonorOption { id: string; email: string; fullName: string; accountBalance: number; }

const EMPTY_FORM = {
  name: "",
  donorUserId: "",
  donorEmail: "",
  donorFullName: "",
  donorBalance: 0,
  reservedAmount: 0,
  amountUsed: 0,
  totalCap: "",
  matchType: "full" as "full" | "capped",
  perInvestmentCap: "",
  isActive: true,
  notes: "",
  expiresAt: "",
  applyRetroactive: false,
  retroactiveFrom: "",
  campaignIds: [] as number[],
};

// ------------------------------------------------------------------ //
// API helpers
// ------------------------------------------------------------------ //
async function fetchMatchGrants(): Promise<MatchGrant[]> {
  const { data } = await axiosInstance.get("/api/admin/matching");
  return data.items || [];
}
async function fetchActivity(grantId: number): Promise<ActivityResponse> {
  const { data } = await axiosInstance.get(`/api/admin/matching/${grantId}/activity`);
  return {
    items: data.items || [],
    pendingItems: data.pendingItems || [],
    pendingTotal: data.pendingTotal || 0,
  };
}
async function fetchCampaignOptions(): Promise<Campaign[]> {
  const { data } = await axiosInstance.get("/api/admin/investment/names?stage=11");
  return (data || []).map((c: any) => ({ id: Number(c.id), name: c.name }));
}
async function searchDonors(q: string): Promise<DonorOption[]> {
  if (q.length < 2) return [];
  const { data } = await axiosInstance.get(`/api/admin/matching/donor-search?q=${encodeURIComponent(q)}`);
  return data.items || [];
}

// ------------------------------------------------------------------ //
// Donor search combobox
// ------------------------------------------------------------------ //
function DonorSearch({
  value,
  displayName,
  onSelect,
}: {
  value: string;
  displayName: string;
  onSelect: (d: DonorOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQ = useDebounce(query, 350);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["donor-search", debouncedQ],
    queryFn: () => searchDonors(debouncedQ),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid="button-donor-search"
        >
          {value ? (
            <span className="truncate">{displayName}</span>
          ) : (
            <span className="text-muted-foreground">Search by name or email…</span>
          )}
          <Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Type name or email…"
            value={query}
            onValueChange={setQuery}
            data-testid="input-donor-query"
          />
          <CommandList>
            {isFetching && (
              <div className="py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching…
              </div>
            )}
            {!isFetching && results.length === 0 && debouncedQ.length >= 2 && (
              <CommandEmpty>No users found.</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((d) => (
                <CommandItem
                  key={d.id}
                  value={d.id}
                  onSelect={() => {
                    onSelect(d);
                    setQuery("");
                    setOpen(false);
                  }}
                  data-testid={`option-donor-${d.id}`}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{d.fullName || d.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.email} · Balance: {currency_format(d.accountBalance)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ //
// Campaign multi-select
// ------------------------------------------------------------------ //
function CampaignMultiSelect({
  options,
  selected,
  onChange,
}: {
  options: Campaign[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filtered = options.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const selectedNames = options
    .filter((c) => selected.includes(c.id))
    .map((c) => c.name);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-between font-normal min-h-[40px] h-auto whitespace-normal text-left"
          data-testid="button-campaign-select"
        >
          {selected.length === 0 ? (
            <span className="text-muted-foreground">Select campaigns…</span>
          ) : (
            <span className="line-clamp-2">{selectedNames.join(", ")}</span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(90vw,720px)] p-0"
        align="start"
        side="bottom"
        avoidCollisions={false}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Filter campaigns…"
            value={filter}
            onValueChange={setFilter}
          />
          <CommandList className="max-h-[60vh] overflow-y-auto">
            {filtered.length === 0 && <CommandEmpty>No campaigns found.</CommandEmpty>}
            <CommandGroup>
              {filtered.map((c) => (
                <CommandItem
                  key={c.id}
                  value={String(c.id)}
                  onSelect={() => toggle(c.id)}
                  data-testid={`option-campaign-${c.id}`}
                >
                  <div className={cn(
                    "mr-2 h-4 w-4 rounded border flex items-center justify-center text-xs",
                    selected.includes(c.id) ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground",
                  )}>
                    {selected.includes(c.id) && "✓"}
                  </div>
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t p-2 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">{selected.length} selected</span>
            <Button size="sm" variant="ghost" onClick={() => onChange([])} className="text-xs h-6">
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ //
// Grant form dialog (create + edit)
// ------------------------------------------------------------------ //
function GrantFormDialog({
  open,
  onOpenChange,
  initial,
  campaigns,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: typeof EMPTY_FORM & { id?: number };
  campaigns: Campaign[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const isEdit = !!initial.id;

  useEffect(() => { setForm(initial); }, [initial, open]);

  const upd = (key: keyof typeof EMPTY_FORM, val: any) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  // When editing, the donor has already had `reservedAmount` debited for
  // this grant. The `amountUsed` portion is locked (matches already paid
  // out and cannot be refunded). The unused part is mobile and can be
  // returned to the donor's wallet, so the maximum cap we can set is the
  // donor's live balance PLUS the entire current reservation. The minimum
  // is `amountUsed` (we can never set the cap below funds already spent).
  const unusedReservation = isEdit ? Math.max(0, form.reservedAmount - form.amountUsed) : 0;
  const remainingCap = isEdit ? Math.max(0, form.reservedAmount - form.amountUsed) : 0;
  const effectiveAvailable = isEdit
    ? form.donorBalance + form.reservedAmount
    : form.donorBalance;

  const handleSave = async () => {
    if (!form.donorUserId) {
      toast({ title: "Error", description: "Please select a donor.", variant: "destructive" });
      return;
    }
    if (form.campaignIds.length === 0) {
      toast({ title: "Error", description: "Please select at least one campaign.", variant: "destructive" });
      return;
    }
    if (form.applyRetroactive && !form.retroactiveFrom) {
      toast({
        title: "Start date required",
        description: "Please pick a start date for retroactive matching.",
        variant: "destructive",
      });
      return;
    }
    if (form.totalCap !== "" && form.donorUserId) {
      const cap = Number(form.totalCap);
      if (cap > effectiveAvailable) {
        toast({
          title: "Cap exceeds available funds",
          description: isEdit
            ? `Total Grant Cap (${currency_format(cap)}) cannot exceed ${currency_format(effectiveAvailable)} (donor balance ${currency_format(form.donorBalance)} + current reservation ${currency_format(form.reservedAmount)}).`
            : `Total Grant Cap (${currency_format(cap)}) cannot exceed donor balance ${currency_format(form.donorBalance)}.`,
          variant: "destructive",
        });
        return;
      }
      if (isEdit && cap < form.amountUsed) {
        toast({
          title: "Cap too low",
          description: `Cap cannot be set below the amount already matched (${currency_format(form.amountUsed)}).`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        donorUserId: form.donorUserId,
        totalCap: form.totalCap !== "" ? Number(form.totalCap) : null,
        matchType: form.matchType,
        perInvestmentCap: form.matchType === "capped" && form.perInvestmentCap !== "" ? Number(form.perInvestmentCap) : null,
        isActive: form.isActive,
        notes: form.notes.trim(),
        expiresAt: form.expiresAt || null,
        retroactiveFrom: form.applyRetroactive && form.retroactiveFrom ? form.retroactiveFrom : null,
        campaignIds: form.campaignIds,
      };
      const { data } = isEdit
        ? await axiosInstance.put(`/api/admin/matching/${initial.id}`, payload)
        : await axiosInstance.post("/api/admin/matching", payload);

      const retro = data?.retroactive;
      const retroMsg =
        retro && retro.matched > 0
          ? ` Retroactively matched ${retro.matched} investment${retro.matched === 1 ? "" : "s"} for ${currency_format(retro.totalAmount)}.`
          : retro && retro.scanned > 0
            ? ` Retroactive sweep ran — no new matches (already covered).`
            : "";

      toast({
        title: "Saved",
        description: `Match grant ${isEdit ? "updated" : "created"} successfully.${retroMsg}`,
      });
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Match Grant" : "New Match Grant"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-sm">Grant Label</Label>
            <Input
              value={form.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="e.g. Lily – Empower Her Fund 2 Match"
              data-testid="input-grant-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Matching Donor *</Label>
            <DonorSearch
              value={form.donorUserId}
              displayName={form.donorFullName || form.donorEmail}
              onSelect={(d) => {
                upd("donorUserId", d.id);
                upd("donorEmail", d.email);
                upd("donorFullName", d.fullName);
                upd("donorBalance", d.accountBalance);
              }}
            />
            {form.donorUserId && (
              <p className="text-xs text-muted-foreground">
                {form.donorEmail} · Current balance: {currency_format(form.donorBalance)}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Eligible Campaigns *</Label>
            <CampaignMultiSelect
              options={campaigns}
              selected={form.campaignIds}
              onChange={(ids) => upd("campaignIds", ids)}
            />
            <p className="text-xs text-muted-foreground">
              Investments into any selected campaign will trigger this match.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Total Grant Cap ($)</Label>
              {isEdit && form.reservedAmount > 0 && (
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-0.5" data-testid="panel-current-cap-summary">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current cap</span>
                    <span className="font-medium tabular-nums" data-testid="text-current-cap">{currency_format(form.reservedAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Already matched</span>
                    <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400" data-testid="text-amount-matched">{currency_format(form.amountUsed)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-0.5 mt-1">
                    <span className="text-muted-foreground">Remaining</span>
                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-cap-remaining">{currency_format(remainingCap)}</span>
                  </div>
                </div>
              )}
              <Input
                type="number"
                min={isEdit ? form.amountUsed : 0}
                value={form.totalCap}
                onChange={(e) => upd("totalCap", e.target.value)}
                placeholder="Leave empty for unlimited"
                data-testid="input-total-cap"
                className={
                  form.totalCap !== "" && form.donorUserId && (
                    Number(form.totalCap) > effectiveAvailable ||
                    (isEdit && Number(form.totalCap) < form.amountUsed)
                  )
                    ? "border-destructive focus-visible:ring-destructive"
                    : ""
                }
              />
              {form.donorUserId && form.totalCap !== "" && Number(form.totalCap) > effectiveAvailable ? (
                <p className="text-xs text-destructive font-medium" data-testid="text-cap-error-exceeds">
                  Exceeds maximum {currency_format(effectiveAvailable)}
                </p>
              ) : form.donorUserId && isEdit && form.totalCap !== "" && Number(form.totalCap) < form.amountUsed ? (
                <p className="text-xs text-destructive font-medium" data-testid="text-cap-error-too-low">
                  Cannot be below already-matched {currency_format(form.amountUsed)}
                </p>
              ) : form.donorUserId ? (
                <p className="text-xs text-muted-foreground">
                  {isEdit
                    ? `Min ${currency_format(form.amountUsed)} · Max ${currency_format(effectiveAvailable)} (donor balance ${currency_format(form.donorBalance)} + current reservation ${currency_format(form.reservedAmount)})`
                    : `Available: ${currency_format(form.donorBalance)}`
                  }
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Max total matched across all investments.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Match Type</Label>
              <Select value={form.matchType} onValueChange={(v) => upd("matchType", v)}>
                <SelectTrigger data-testid="select-match-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full match (1:1)</SelectItem>
                  <SelectItem value="capped">Up to a per-investment cap</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.matchType === "capped" && (
            <div className="space-y-1.5">
              <Label className="text-sm">Per-Investment Cap ($) *</Label>
              <Input
                type="number"
                min="0"
                value={form.perInvestmentCap}
                onChange={(e) => upd("perInvestmentCap", e.target.value)}
                placeholder="e.g. 5000"
                data-testid="input-per-cap"
              />
              <p className="text-xs text-muted-foreground">
                Max match per single investor investment.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-sm">Grant Expiry Date</Label>
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => upd("expiresAt", e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              data-testid="input-expires-at"
            />
            <p className="text-xs text-muted-foreground">
              Optional. On this date the grant is automatically deactivated and any unused reserved funds are returned to the donor.
            </p>
          </div>

          <div className="space-y-2 rounded-md border p-3 bg-muted/30">
            <div className="flex items-center gap-3">
              <Switch
                id="apply-retroactive"
                checked={form.applyRetroactive}
                onCheckedChange={(v) => upd("applyRetroactive", v)}
                data-testid="switch-apply-retroactive"
              />
              <Label htmlFor="apply-retroactive" className="text-sm cursor-pointer font-medium">
                Apply retroactively
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Match existing investments on the eligible campaigns made on/after the start date. Each investment is matched at most once per grant.
            </p>
            {form.applyRetroactive && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-sm">Match investments on or after *</Label>
                <Input
                  type="date"
                  value={form.retroactiveFrom}
                  onChange={(e) => upd("retroactiveFrom", e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  data-testid="input-retroactive-from"
                />
                {isEdit && (
                  <p className="text-xs text-muted-foreground">
                    Re-saving will scan again for newly eligible investments. Already-matched ones are skipped.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => upd("notes", e.target.value)}
              placeholder="Internal notes (optional)"
              rows={2}
              data-testid="input-notes"
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="is-active"
              checked={form.isActive}
              onCheckedChange={(v) => upd("isActive", v)}
              data-testid="switch-is-active"
            />
            <Label htmlFor="is-active" className="text-sm cursor-pointer">Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} data-testid="button-save-grant">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ //
// Activity panel (expandable per grant)
// ------------------------------------------------------------------ //
function ActivityPanel({ grantId }: { grantId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["match-activity", grantId],
    queryFn: () => fetchActivity(grantId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  const items = data?.items || [];
  const pendingItems = data?.pendingItems || [];
  const pendingTotal = data?.pendingTotal || 0;

  if (items.length === 0 && pendingItems.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No matching activity recorded yet.
      </div>
    );
  }

  const triggerStatusLabel = (s: string) => {
    const v = (s || "").toLowerCase();
    if (v === "in transit") return "In Transit";
    if (v === "received") return "Received";
    return "Pending";
  };

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#405189] text-white">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Date</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Campaign</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Investor</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Matched</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a, idx) => (
                <tr
                  key={a.id}
                  className={idx % 2 === 0 ? "bg-background" : "bg-muted/30"}
                  data-testid={`row-activity-${a.id}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{formatDate(a.createdAt)}</td>
                  <td className="px-3 py-2">{a.campaignName}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.investorFullName || "—"}</div>
                    <div className="text-xs text-muted-foreground">{a.investorEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {currency_format(a.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pendingItems.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <Clock className="h-4 w-4" />
              Pending matches ({pendingItems.length})
              <span className="text-xs font-normal text-amber-800/80 dark:text-amber-300/80">
                — escrowed; will fire when these investments land
              </span>
            </div>
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200 tabular-nums">
              {currency_format(pendingTotal)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-100">
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Trigger Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Campaign</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Investor</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Trigger</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Will Match</th>
                </tr>
              </thead>
              <tbody>
                {pendingItems.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-amber-200/60"
                    data-testid={`row-pending-activity-${p.id}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-amber-900 dark:text-amber-200">
                      {p.triggerDate ? formatDate(p.triggerDate) : "—"}
                    </td>
                    <td className="px-3 py-2">{p.campaignName}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{p.investorFullName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{p.investorEmail}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="tabular-nums">{currency_format(p.triggerAmount)}</div>
                      <div className="text-muted-foreground">
                        {p.triggerType === "pending_grant" ? "DAF · " : "Rec · "}
                        {triggerStatusLabel(p.triggerStatus)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-900 dark:text-amber-200">
                      {currency_format(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Main page
// ------------------------------------------------------------------ //
export default function AdminMatching() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(typeof EMPTY_FORM & { id?: number }) | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exportingId, setExportingId] = useState<number | null>(null);

  const handleExport = async (g: MatchGrant) => {
    setExportingId(g.id);
    try {
      const response = await axiosInstance.get(`/api/admin/matching/${g.id}/export`, {
        responseType: "blob",
      });
      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const safeName = (g.name || `Grant_${g.id}`).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
      const dateStamp = new Date().toISOString().slice(0, 10);
      link.setAttribute("download", `MatchGrant_${safeName}_${dateStamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: "Report downloaded", description: `${g.name || `Grant #${g.id}`}` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const { data: grants = [], isLoading: grantsLoading } = useQuery({
    queryKey: ["/api/admin/matching"],
    queryFn: fetchMatchGrants,
    staleTime: 30_000,
  });

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ["/api/admin/investment-list-for-matching"],
    queryFn: fetchCampaignOptions,
    staleTime: 120_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/matching"] });
  }, [queryClient]);

  const openCreate = () => {
    setEditTarget({ ...EMPTY_FORM });
    setFormOpen(true);
  };

  const openEdit = (g: MatchGrant) => {
    setEditTarget({
      id: g.id,
      name: g.name,
      donorUserId: g.donorUserId,
      donorEmail: g.donorEmail,
      donorFullName: g.donorFullName,
      donorBalance: g.donorBalance,
      reservedAmount: g.reservedAmount,
      amountUsed: g.amountUsed,
      totalCap: g.totalCap != null ? String(g.totalCap) : "",
      matchType: g.matchType,
      perInvestmentCap: g.perInvestmentCap != null ? String(g.perInvestmentCap) : "",
      isActive: g.isActive,
      notes: g.notes,
      expiresAt: g.expiresAt ? g.expiresAt.slice(0, 10) : "",
      applyRetroactive: !!g.retroactiveFrom,
      retroactiveFrom: g.retroactiveFrom ? g.retroactiveFrom.slice(0, 10) : "",
      campaignIds: g.campaigns.map((c) => c.id),
    });
    setFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await axiosInstance.delete(`/api/admin/matching/${id}`);
      toast({ title: "Deleted", description: "Match grant removed." });
      refresh();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Summary stats
  const totalActive = grants.filter((g) => g.isActive).length;
  const totalCommitted = grants.reduce((s, g) => s + (g.totalCap ?? 0), 0);
  const totalUsed = grants.reduce((s, g) => s + g.amountUsed, 0);
  const totalMatches = grants.reduce((s, g) => s + g.timesUsed, 0);

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitMerge className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Investment Matching</h1>
              <p className="text-sm text-muted-foreground">
                Configure donors whose wallets are automatically drawn on whenever someone else invests in a selected campaign.
              </p>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="button-new-grant">
            <Plus className="h-4 w-4 mr-2" /> New Match Grant
          </Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Active Grants</p>
              <p className="text-2xl font-bold mt-1" data-testid="stat-active">{totalActive}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Committed</p>
              <p className="text-2xl font-bold mt-1" data-testid="stat-committed">
                {totalCommitted > 0 ? currency_format(totalCommitted) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Matched</p>
              <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400" data-testid="stat-used">
                {currency_format(totalUsed)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Times Triggered</p>
              <p className="text-2xl font-bold mt-1" data-testid="stat-triggers">{totalMatches}</p>
            </CardContent>
          </Card>
        </div>

        {/* Grant list */}
        {grantsLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : grants.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <GitMerge className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No match grants yet</p>
              <p className="text-sm mt-1">Create one to start automatically matching investments.</p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> New Match Grant
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {grants.map((g) => {
              const pct = g.totalCap && g.totalCap > 0 ? Math.min(100, (g.amountUsed / g.totalCap) * 100) : null;
              const expanded = expandedIds.has(g.id);
              return (
                <Card key={g.id} className={cn(!g.isActive && "opacity-60")} data-testid={`card-grant-${g.id}`}>
                  <CardContent className="p-0">
                    {/* Row header */}
                    <div className="flex items-start gap-3 p-4">
                      <button
                        className="mt-1 text-muted-foreground hover:text-foreground shrink-0"
                        onClick={() => toggleExpand(g.id)}
                        aria-label={expanded ? "Collapse activity" : "Expand activity"}
                        data-testid={`button-expand-${g.id}`}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-base">{g.name || `Grant #${g.id}`}</span>
                          <Badge variant={g.isActive ? "default" : "secondary"}>
                            {g.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <Badge variant="outline">
                            {g.matchType === "full" ? "1:1 Full Match" : `Capped ${g.perInvestmentCap != null ? currency_format(g.perInvestmentCap) : ""}/investment`}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground">Donor:</span>{" "}
                            {g.donorFullName || g.donorEmail}
                          </span>
                          <span>
                            <span className="font-medium text-foreground">Matched:</span>{" "}
                            {currency_format(g.amountUsed)}
                            {g.totalCap != null ? ` / ${currency_format(g.totalCap)}` : " (unlimited cap)"}
                          </span>
                          {g.reservedAmount > 0 && (
                            <span>
                              <span className="font-medium text-foreground">Escrowed:</span>{" "}
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                {currency_format(g.reservedAmount)}
                              </span>
                              {g.amountUsed > 0 && (
                                <span className="text-xs ml-1">
                                  ({currency_format(Math.max(0, g.reservedAmount - g.amountUsed))} remaining)
                                </span>
                              )}
                            </span>
                          )}
                          {(g.pendingAmount ?? 0) > 0 && (
                            <span data-testid={`text-pending-${g.id}`}>
                              <span className="font-medium text-foreground">Pending matches:</span>{" "}
                              <span className="text-amber-700 dark:text-amber-300 font-medium">
                                {currency_format(g.pendingAmount || 0)}
                              </span>
                              <span className="text-xs ml-1 text-muted-foreground">
                                ({g.pendingCount} {g.pendingCount === 1 ? "trigger" : "triggers"})
                              </span>
                            </span>
                          )}
                          <span>
                            <span className="font-medium text-foreground">Times triggered:</span>{" "}
                            {g.timesUsed}
                          </span>
                          {g.expiresAt && (
                            <span className={cn(
                              "flex items-center gap-1",
                              new Date(g.expiresAt) < new Date() ? "text-destructive" : "",
                            )}>
                              <Clock className="h-3.5 w-3.5" />
                              <span className="font-medium text-foreground">Expires:</span>{" "}
                              {formatDate(g.expiresAt)}
                              {new Date(g.expiresAt) < new Date() && (
                                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 ml-1">Expired</Badge>
                              )}
                            </span>
                          )}
                        </div>

                        {pct !== null && (
                          <div className="w-full max-w-xs">
                            <div className="flex justify-between text-xs text-muted-foreground mb-0.5">
                              <span>Cap usage</span>
                              <span>{pct.toFixed(0)}%</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-green-500")}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1">
                          {g.campaigns.map((c) => (
                            <Badge key={c.id} variant="outline" className="text-xs font-normal">
                              {c.name}
                            </Badge>
                          ))}
                          {g.campaigns.length === 0 && (
                            <span className="text-xs text-destructive">No campaigns selected</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleExport(g)}
                          disabled={exportingId === g.id}
                          title="Download Excel report"
                          data-testid={`button-export-${g.id}`}
                        >
                          {exportingId === g.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(g)}
                          title="Edit"
                          data-testid={`button-edit-${g.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(g.id)}
                          disabled={deletingId === g.id}
                          title="Delete"
                          data-testid={`button-delete-${g.id}`}
                        >
                          {deletingId === g.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Expandable activity log */}
                    {expanded && (
                      <div className="border-t bg-muted/20 px-4 pb-4">
                        <div className="flex items-center gap-2 py-3 text-sm font-medium text-muted-foreground">
                          <Activity className="h-4 w-4" />
                          Match Activity
                        </div>
                        <ActivityPanel grantId={g.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Dialog */}
      {editTarget && (
        <GrantFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          initial={editTarget}
          campaigns={campaigns}
          onSaved={refresh}
        />
      )}
    </AdminLayout>
  );
}
