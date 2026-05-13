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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../api/axios";
import { currency_format, formatDate } from "../helpers/format";
import { Plus, Pencil, Trash2, GitMerge, Activity, ChevronDown, ChevronRight, Search, Loader2, Clock, Download, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ //
// Types
// ------------------------------------------------------------------ //
interface Campaign { id: number; name: string; }
interface CoverFeesPool {
  id: number;
  name: string;
  displaySponsorName: string;
  sponsorUserId: string;
  sponsorEmail: string;
  sponsorFullName: string;
  sponsorBalance: number;
  totalCap: number | null;
  amountUsed: number;
  reservedAmount: number;
  perInvestmentCap: number | null;
  coverInitialFee: boolean;
  coverLifecycleFee: boolean;
  isActive: boolean;
  notes: string;
  expiresAt: string | null;
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
  donationAmount: number;
  triggerStatus?: string;
  triggerAmount?: number | null;
  triggerPaymentType?: string;
  triggerDate?: string | null;
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
interface SponsorOption { id: string; email: string; fullName: string; accountBalance: number; }

const EMPTY_FORM = {
  name: "",
  displaySponsorName: "",
  sponsorUserId: "",
  sponsorEmail: "",
  sponsorFullName: "",
  sponsorBalance: 0,
  reservedAmount: 0,
  amountUsed: 0,
  totalCap: "",
  perInvestmentCap: "",
  coverInitialFee: true,
  coverLifecycleFee: true,
  isActive: true,
  notes: "",
  expiresAt: "",
  campaignIds: [] as number[],
};

// ------------------------------------------------------------------ //
// API helpers
// ------------------------------------------------------------------ //
async function fetchCoverFeesPools(): Promise<CoverFeesPool[]> {
  const { data } = await axiosInstance.get("/api/admin/cover-fees");
  return data.items || [];
}
async function fetchActivity(grantId: number): Promise<ActivityResponse> {
  const { data } = await axiosInstance.get(`/api/admin/cover-fees/${grantId}/activity`);
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
async function searchSponsors(q: string): Promise<SponsorOption[]> {
  if (q.length < 2) return [];
  const { data } = await axiosInstance.get(`/api/admin/cover-fees/sponsor-search?q=${encodeURIComponent(q)}`);
  return data.items || [];
}

// ------------------------------------------------------------------ //
// Sponsor search combobox
// ------------------------------------------------------------------ //
function SponsorSearch({
  value,
  displayName,
  onSelect,
}: {
  value: string;
  displayName: string;
  onSelect: (d: SponsorOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debouncedQ = useDebounce(query, 350);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["sponsor-search", debouncedQ],
    queryFn: () => searchSponsors(debouncedQ),
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
          data-testid="button-sponsor-search"
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
            data-testid="input-sponsor-query"
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
                  data-testid={`option-sponsor-${d.id}`}
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

  // Edit-mode cap adjuster: user picks "Add" or "Remove" + amount instead
  // of typing a new absolute cap. We translate the signed delta into the
  // absolute totalCap that the API expects.
  const [capAdjustMode, setCapAdjustMode] = useState<"add" | "subtract">("add");
  const [capAdjustAmount, setCapAdjustAmount] = useState<string>("");

  useEffect(() => {
    setForm(initial);
    setCapAdjustMode("add");
    setCapAdjustAmount("");
  }, [initial, open]);

  const upd = (key: keyof typeof EMPTY_FORM, val: any) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  // When editing, the sponsor has already had `reservedAmount` debited for
  // this grant. The `amountUsed` portion is locked (matches already paid
  // out and cannot be refunded). The unused part is mobile and can be
  // returned to the sponsor's wallet, so the maximum cap we can set is the
  // sponsor's live balance PLUS the entire current reservation. The minimum
  // is `amountUsed` (we can never set the cap below funds already spent).
  const unusedReservation = isEdit ? Math.max(0, form.reservedAmount - form.amountUsed) : 0;
  const remainingCap = isEdit ? Math.max(0, form.reservedAmount - form.amountUsed) : 0;
  const effectiveAvailable = isEdit
    ? form.sponsorBalance + form.reservedAmount
    : form.sponsorBalance;

  // Translate the cap delta (edit mode) into the absolute totalCap the
  // backend expects. The baseline is the grant's persisted cap (not the
  // reservation, which can diverge for over-cap grants). When the
  // adjust field is blank we leave form.totalCap untouched so the PUT
  // payload still carries the original cap unchanged.
  const initialCapNum =
    initial.totalCap !== "" && initial.totalCap != null
      ? Number(initial.totalCap)
      : 0;
  const currentCap = isEdit ? initialCapNum : 0;
  const adjustNumRaw = capAdjustAmount === "" ? NaN : Number(capAdjustAmount);
  const adjustNum = Number.isFinite(adjustNumRaw) && adjustNumRaw >= 0 ? adjustNumRaw : 0;
  const signedDelta =
    capAdjustAmount === "" ? 0 : (capAdjustMode === "add" ? 1 : -1) * adjustNum;
  const proposedCap = Math.round((currentCap + signedDelta) * 100) / 100;

  useEffect(() => {
    // Only sync form.totalCap when the user has explicitly entered an
    // adjustment. Otherwise the PUT payload retains the persisted cap.
    if (!isEdit || capAdjustAmount === "") return;
    setForm((prev) => ({ ...prev, totalCap: String(proposedCap) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposedCap, capAdjustAmount, isEdit]);

  // Sponsor-impact preview. Adds reserve more from the sponsor's wallet;
  // subtracts return funds to the sponsor's wallet. Only the unused
  // portion of the reservation is mobile, so a subtract that would push
  // the cap below amount_used is blocked.
  const capDeltaInvalidReason: string | null = (() => {
    if (!isEdit || capAdjustAmount === "") return null;
    if (!Number.isFinite(adjustNumRaw) || adjustNumRaw < 0) return "Enter a positive amount.";
    if (signedDelta > 0 && signedDelta > form.sponsorBalance) {
      return `Sponsor wallet only has ${currency_format(form.sponsorBalance)} — add funds to ${form.sponsorFullName || form.sponsorEmail || "the sponsor"}'s wallet first.`;
    }
    if (signedDelta < 0 && proposedCap < form.amountUsed) {
      const minSubtract = Math.max(0, currentCap - form.amountUsed);
      return `Cannot subtract more than ${currency_format(minSubtract)} — ${currency_format(form.amountUsed)} has already been covered.`;
    }
    return null;
  })();

  const handleSave = async () => {
    if (!form.sponsorUserId) {
      toast({ title: "Error", description: "Please select a sponsor.", variant: "destructive" });
      return;
    }
    if (form.campaignIds.length === 0) {
      toast({ title: "Error", description: "Please select at least one campaign.", variant: "destructive" });
      return;
    }
    if (form.totalCap !== "" && form.sponsorUserId) {
      const cap = Number(form.totalCap);
      if (cap > effectiveAvailable) {
        toast({
          title: "Cap exceeds available funds",
          description: isEdit
            ? `Total Grant Cap (${currency_format(cap)}) cannot exceed ${currency_format(effectiveAvailable)} (sponsor balance ${currency_format(form.sponsorBalance)} + current reservation ${currency_format(form.reservedAmount)}).`
            : `Total Grant Cap (${currency_format(cap)}) cannot exceed sponsor balance ${currency_format(form.sponsorBalance)}.`,
          variant: "destructive",
        });
        return;
      }
      if (isEdit && cap < form.amountUsed) {
        toast({
          title: "Cap too low",
          description: `Cap cannot be set below the amount already covered (${currency_format(form.amountUsed)}).`,
          variant: "destructive",
        });
        return;
      }
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        displaySponsorName: form.displaySponsorName.trim(),
        sponsorUserId: form.sponsorUserId,
        totalCap: form.totalCap !== "" ? Number(form.totalCap) : null,
        perInvestmentCap: form.perInvestmentCap !== "" ? Number(form.perInvestmentCap) : null,
        coverInitialFee: form.coverInitialFee,
        coverLifecycleFee: form.coverLifecycleFee,
        isActive: form.isActive,
        notes: form.notes.trim(),
        expiresAt: form.expiresAt || null,
        campaignIds: form.campaignIds,
      };
      const { data } = isEdit
        ? await axiosInstance.put(`/api/admin/cover-fees/${initial.id}`, payload)
        : await axiosInstance.post("/api/admin/cover-fees", payload);

      void data;
      toast({
        title: "Saved",
        description: `Cover Fees pool ${isEdit ? "updated" : "created"} successfully.`,
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
          <DialogTitle>{isEdit ? "Edit Cover Fees Pool" : "New Cover Fees Pool"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <Alert className="border-blue-200 bg-blue-50 text-blue-900">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-xs leading-relaxed">
              <strong>Scope:</strong> this program only covers the <strong>5% CataCap platform fee</strong>.
              If the donor pays by <strong>credit card or ACH</strong>, the payment processor's
              transaction fee is still deducted from their contribution and is <strong>not</strong> covered
              by this pool. The public investment page surfaces this disclaimer to donors automatically.
            </AlertDescription>
          </Alert>

          <div className="space-y-1.5">
            <Label className="text-sm">Pool Label</Label>
            <Input
              value={form.name}
              onChange={(e) => upd("name", e.target.value)}
              placeholder="e.g. Lily – Empower Her Fee Coverage 2026"
              data-testid="input-grant-name"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Name to show Investors</Label>
            <Input
              value={form.displaySponsorName}
              onChange={(e) => upd("displaySponsorName", e.target.value)}
              placeholder="e.g. The Kurtzig Family Foundation"
              data-testid="input-display-sponsor-name"
            />
            <p className="text-xs text-muted-foreground">
              Optional. When set, this name replaces the sponsor's name on the public investment page (e.g. "...generously covered by <em>this name</em>..."). Leave blank to use the sponsor's real name.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Cover Fees Sponsor *</Label>
            <SponsorSearch
              value={form.sponsorUserId}
              displayName={form.sponsorFullName || form.sponsorEmail}
              onSelect={(d) => {
                upd("sponsorUserId", d.id);
                upd("sponsorEmail", d.email);
                upd("sponsorFullName", d.fullName);
                upd("sponsorBalance", d.accountBalance);
              }}
            />
            {form.sponsorUserId && (
              <p className="text-xs text-muted-foreground">
                {form.sponsorEmail} · Current balance: {currency_format(form.sponsorBalance)}
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
              Donations to any selected investment will have their 5% CataCap fee covered by this pool.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Total Grant Cap ($)</Label>

              {isEdit ? (
                // ── Edit mode: delta-based adjuster ──────────────────
                <>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-0.5" data-testid="panel-current-cap-summary">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current cap</span>
                      <span className="font-medium tabular-nums" data-testid="text-current-cap">{currency_format(currentCap)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Already covered</span>
                      <span className="font-medium tabular-nums text-amber-600 dark:text-amber-400" data-testid="text-amount-covered">{currency_format(form.amountUsed)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-0.5 mt-1">
                      <span className="text-muted-foreground">Remaining</span>
                      <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400" data-testid="text-cap-remaining">{currency_format(remainingCap)}</span>
                    </div>
                    <div className="flex justify-between border-t pt-0.5 mt-1">
                      <span className="text-muted-foreground">Sponsor wallet balance</span>
                      <span className="font-medium tabular-nums" data-testid="text-sponsor-balance">{currency_format(form.sponsorBalance)}</span>
                    </div>
                  </div>

                  <div className="rounded-md border p-3 space-y-3 mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Adjust cap:</span>
                      <div className="inline-flex rounded-md border overflow-hidden text-xs" role="group">
                        <button
                          type="button"
                          onClick={() => setCapAdjustMode("add")}
                          data-testid="button-cap-mode-add"
                          className={cn(
                            "px-3 py-1 font-medium transition-colors",
                            capAdjustMode === "add"
                              ? "bg-emerald-600 text-white"
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          + Add funds
                        </button>
                        <button
                          type="button"
                          onClick={() => setCapAdjustMode("subtract")}
                          data-testid="button-cap-mode-subtract"
                          className={cn(
                            "px-3 py-1 font-medium transition-colors border-l",
                            capAdjustMode === "subtract"
                              ? "bg-amber-600 text-white"
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          − Remove funds
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {[1000, 5000, 10000, 25000, 100000].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCapAdjustAmount(String(preset))}
                          data-testid={`button-cap-preset-${preset}`}
                          className={cn(
                            "rounded border px-2 py-1 text-xs font-medium transition-colors",
                            capAdjustAmount === String(preset)
                              ? capAdjustMode === "add"
                                ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:bg-emerald-950"
                                : "border-amber-600 bg-amber-50 text-amber-700 dark:bg-amber-950"
                              : "bg-background hover:bg-muted",
                          )}
                        >
                          {capAdjustMode === "add" ? "+" : "−"}
                          {currency_format(preset)}
                        </button>
                      ))}
                      {capAdjustAmount !== "" && (
                        <button
                          type="button"
                          onClick={() => setCapAdjustAmount("")}
                          data-testid="button-cap-clear"
                          className="rounded border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Custom amount ($)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={capAdjustAmount}
                        onChange={(e) => setCapAdjustAmount(e.target.value)}
                        placeholder="e.g. 5000"
                        data-testid="input-cap-adjust-amount"
                        className={
                          capDeltaInvalidReason
                            ? "border-destructive focus-visible:ring-destructive"
                            : ""
                        }
                      />
                    </div>

                    {capAdjustAmount === "" ? (
                      <p className="text-xs text-muted-foreground" data-testid="text-cap-no-change">
                        No cap change. Pick an amount to add or remove.
                      </p>
                    ) : capDeltaInvalidReason ? (
                      <p className="text-xs text-destructive font-medium" data-testid="text-cap-delta-error">
                        {capDeltaInvalidReason}
                      </p>
                    ) : (
                      <div
                        className={cn(
                          "rounded-md border-l-4 px-3 py-2 text-xs space-y-1",
                          signedDelta > 0
                            ? "border-l-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
                            : "border-l-amber-600 bg-amber-50 dark:bg-amber-950/40",
                        )}
                        data-testid="panel-cap-delta-preview"
                      >
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">New cap will be</span>
                          <span className="font-semibold tabular-nums" data-testid="text-cap-proposed">
                            {currency_format(proposedCap)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            {signedDelta > 0 ? "Reserved from sponsor wallet" : "Returned to sponsor wallet"}
                          </span>
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              signedDelta > 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-amber-700 dark:text-amber-400",
                            )}
                            data-testid="text-cap-delta-impact"
                          >
                            {signedDelta > 0 ? "−" : "+"}{currency_format(Math.abs(signedDelta))}
                          </span>
                        </div>
                        <div className="flex justify-between border-t pt-1 mt-1">
                          <span className="text-muted-foreground">Sponsor wallet after</span>
                          <span className="font-medium tabular-nums" data-testid="text-sponsor-balance-after">
                            {currency_format(form.sponsorBalance - signedDelta)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                // ── Create mode: absolute cap input ──────────────────
                <>
                  <Input
                    type="number"
                    min={0}
                    value={form.totalCap}
                    onChange={(e) => upd("totalCap", e.target.value)}
                    placeholder="Leave empty for unlimited"
                    data-testid="input-total-cap"
                    className={
                      form.totalCap !== "" && form.sponsorUserId && Number(form.totalCap) > effectiveAvailable
                        ? "border-destructive focus-visible:ring-destructive"
                        : ""
                    }
                  />
                  {form.sponsorUserId && form.totalCap !== "" && Number(form.totalCap) > effectiveAvailable ? (
                    <p className="text-xs text-destructive font-medium" data-testid="text-cap-error-exceeds">
                      Exceeds sponsor wallet balance {currency_format(form.sponsorBalance)}
                    </p>
                  ) : form.sponsorUserId ? (
                    <p className="text-xs text-muted-foreground">
                      Available: {currency_format(form.sponsorBalance)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Max total fees covered across all donations.</p>
                  )}
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Max Fee Per Investment ($)</Label>
              <Input
                type="number"
                min="0"
                value={form.perInvestmentCap}
                onChange={(e) => upd("perInvestmentCap", e.target.value)}
                placeholder="optional, e.g. 250"
                data-testid="input-per-cap"
              />
              <p className="text-xs text-muted-foreground">
                Optional cap on the fee covered per donation. Fee rate is fixed at 5%.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Pool Expiry Date</Label>
            <Input
              type="date"
              value={form.expiresAt}
              onChange={(e) => upd("expiresAt", e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              data-testid="input-expires-at"
            />
            <p className="text-xs text-muted-foreground">
              Optional. On this date the grant is automatically deactivated and any unused reserved funds are returned to the sponsor.
            </p>
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

          <div className="space-y-3 rounded-md border p-3 bg-muted/20">
            <div className="text-sm font-medium">Which fees does this pool cover?</div>
            <div className="flex items-start gap-3">
              <Switch
                id="cover-initial-fee"
                checked={form.coverInitialFee}
                onCheckedChange={(v) => upd("coverInitialFee", v)}
                data-testid="switch-cover-initial-fee"
              />
              <div className="flex-1">
                <Label htmlFor="cover-initial-fee" className="text-sm cursor-pointer">
                  Cover initial 5% fee
                </Label>
                <p className="text-xs text-muted-foreground">
                  Covers the platform fee on a donor's first donation to a covered investment.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Switch
                id="cover-lifecycle-fee"
                checked={form.coverLifecycleFee}
                onCheckedChange={(v) => upd("coverLifecycleFee", v)}
                data-testid="switch-cover-lifecycle-fee"
              />
              <div className="flex-1">
                <Label htmlFor="cover-lifecycle-fee" className="text-sm cursor-pointer">
                  Cover fee during life of investment
                </Label>
                <p className="text-xs text-muted-foreground">
                  Covers the platform fee on later disbursements and payments tied to the investment over its lifetime.
                </p>
              </div>
            </div>
            {!form.coverInitialFee && !form.coverLifecycleFee && (
              <p className="text-xs text-destructive">
                At least one coverage phase must be enabled.
              </p>
            )}
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
          <Button
            onClick={handleSave}
            disabled={saving || !!capDeltaInvalidReason || (!form.coverInitialFee && !form.coverLifecycleFee)}
            data-testid="button-save-grant"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
            ) : isEdit && signedDelta > 0 ? (
              `Confirm: reserve ${currency_format(signedDelta)}`
            ) : isEdit && signedDelta < 0 ? (
              `Confirm: refund ${currency_format(-signedDelta)}`
            ) : (
              "Save"
            )}
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [cancelTarget, setCancelTarget] = useState<ActivityEntry | null>(null);
  const [cancelingId, setCancelingId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["cover-fees-activity", grantId],
    queryFn: () => fetchActivity(grantId),
    staleTime: 30_000,
  });

  const handleCancel = async (entry: ActivityEntry) => {
    setCancelingId(entry.id);
    try {
      const { data: resp } = await axiosInstance.post(
        `/api/admin/cover-fees/${grantId}/activity/${entry.id}/cancel`,
      );
      toast({
        title: "Coverage canceled",
        description: resp?.message || "Fee coverage removed and funds returned to the escrow pool.",
      });
      queryClient.invalidateQueries({ queryKey: ["cover-fees-activity", grantId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/cover-fees"] });
      setCancelTarget(null);
    } catch (err: any) {
      toast({
        title: "Cancel failed",
        description: err?.response?.data?.message || err.message,
        variant: "destructive",
      });
    } finally {
      setCancelingId(null);
    }
  };

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
        No cover fees activity recorded yet.
      </div>
    );
  }

  const triggerStatusLabel = (s: string) => {
    const v = (s || "").trim().toLowerCase();
    if (v === "" || v === "pending") return "Pending";
    if (v === "in transit") return "In Transit";
    if (v === "received") return "Received";
    if (v === "rejected") return "Rejected";
    if (v === "approved") return "Approved";
    return s;
  };

  const triggerTooltipCopy = (
    paymentType: string,
    status: string,
    context: "covered" | "pending",
  ) => {
    const v = (status || "").trim().toLowerCase();
    const subject = paymentType
      ? `the donor's ${paymentType.toLowerCase()}`
      : "the donor's direct recommendation";
    const lifecycle = (() => {
      switch (v) {
        case "":
        case "pending":
          return `${subject} has not been marked In Transit yet`;
        case "in transit":
          return `${subject} is on its way but has not been received`;
        case "received":
          return `${subject} has been received`;
        case "approved":
          return `${subject} has been approved`;
        case "rejected":
          return `${subject} was rejected`;
        default:
          return `${subject} is in "${status}" state`;
      }
    })();
    const tail =
      context === "covered"
        ? "This is independent of the coverage itself: the cover-fee has already been applied from the sponsor wallet (or escrow)."
        : "This is a projection only — the cover-fee has NOT been applied yet. It will fire from the sponsor's escrow when this trigger lands.";
    return `Trigger payment status — ${lifecycle}. ${tail}`;
  };

  const renderTriggerBadge = (
    paymentType: string,
    status: string,
    context: "covered" | "pending" = "covered",
  ) => {
    const label = `Trigger: ${paymentType ? `${paymentType} · ` : ""}${triggerStatusLabel(status)}`;
    return (
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground cursor-help">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {triggerTooltipCopy(paymentType, status, context)}
        </TooltipContent>
      </Tooltip>
    );
  };

  const CoveredPill = () => (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 cursor-help">
          <CheckCircle2 className="h-3 w-3" />
          Covered
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        The cover-fee has already been applied from the sponsor wallet (or escrow). The trigger badge below describes the donor's separate payment lifecycle, not the coverage status.
      </TooltipContent>
    </Tooltip>
  );

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
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Donation</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Trigger</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Fee Covered</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap w-12">&nbsp;</th>
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
                  <td className="px-3 py-2 text-right tabular-nums">
                    {currency_format(a.donationAmount)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex flex-col items-start gap-1">
                      <CoveredPill />
                      {renderTriggerBadge(a.triggerPaymentType || (a.triggeringRecommendationId != null ? "Direct" : ""), a.triggerStatus || "")}
                      {a.triggeringRecommendationId != null && (
                        <div className="text-muted-foreground">Rec #{a.triggeringRecommendationId}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {currency_format(a.amount)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      title="Cancel coverage"
                      aria-label="Cancel coverage"
                      onClick={() => setCancelTarget(a)}
                      disabled={cancelingId === a.id}
                      data-testid={`button-cancel-coverage-${a.id}`}
                    >
                      {cancelingId === a.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
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
              Pending fee coverage ({pendingItems.length})
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
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap">Will Cover</th>
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
                      <div className="mt-1">
                        {renderTriggerBadge("DAF Grant", p.triggerStatus, "pending")}
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

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent data-testid="dialog-cancel-coverage">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this fee coverage?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  This will remove the sponsor's <strong>{cancelTarget ? currency_format(cancelTarget.amount) : ""}</strong> fee coverage
                  contribution to <strong>{cancelTarget?.campaignName}</strong> and return that amount to the grant's available pool.
                </div>
                <div className="text-muted-foreground">
                  The triggering investor's own donation is left in place. The cancellation is logged to the sponsor's Account History.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-cancel-coverage-no"
              disabled={cancelingId !== null}
            >
              Keep coverage
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelingId !== null}
              onClick={(e) => {
                if (cancelingId !== null) {
                  e.preventDefault();
                  return;
                }
                if (cancelTarget) handleCancel(cancelTarget);
              }}
              data-testid="button-cancel-coverage-confirm"
            >
              {cancelingId !== null ? "Canceling…" : "Cancel coverage"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ------------------------------------------------------------------ //
// Main page
// ------------------------------------------------------------------ //
export default function AdminCoverFees() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<(typeof EMPTY_FORM & { id?: number }) | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CoverFeesPool | null>(null);
  const [exportingIds, setExportingIds] = useState<Set<number>>(new Set());

  const handleExport = async (g: CoverFeesPool) => {
    setExportingIds((prev) => {
      const next = new Set(prev);
      next.add(g.id);
      return next;
    });
    try {
      const response = await axiosInstance.get(`/api/admin/cover-fees/${g.id}/export`, {
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
      link.setAttribute("download", `CoverFeesPool_${safeName}_${dateStamp}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: "Report downloaded", description: `${g.name || `Pool #${g.id}`}` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message || "Unknown error", variant: "destructive" });
    } finally {
      setExportingIds((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
    }
  };

  const { data: grants = [], isLoading: grantsLoading } = useQuery({
    queryKey: ["/api/admin/cover-fees"],
    queryFn: fetchCoverFeesPools,
    staleTime: 30_000,
  });

  const { data: campaigns = [], isLoading: campaignsLoading } = useQuery({
    queryKey: ["/api/admin/investment-list-for-matching"],
    queryFn: fetchCampaignOptions,
    staleTime: 120_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/cover-fees"] });
  }, [queryClient]);

  const openCreate = () => {
    setEditTarget({ ...EMPTY_FORM });
    setFormOpen(true);
  };

  const openEdit = (g: CoverFeesPool) => {
    setEditTarget({
      id: g.id,
      name: g.name,
      displaySponsorName: g.displaySponsorName || "",
      sponsorUserId: g.sponsorUserId,
      sponsorEmail: g.sponsorEmail,
      sponsorFullName: g.sponsorFullName,
      sponsorBalance: g.sponsorBalance,
      reservedAmount: g.reservedAmount,
      amountUsed: g.amountUsed,
      totalCap: g.totalCap != null ? String(g.totalCap) : "",
      perInvestmentCap: g.perInvestmentCap != null ? String(g.perInvestmentCap) : "",
      coverInitialFee: g.coverInitialFee !== false,
      coverLifecycleFee: g.coverLifecycleFee !== false,
      isActive: g.isActive,
      notes: g.notes,
      expiresAt: g.expiresAt ? g.expiresAt.slice(0, 10) : "",
      campaignIds: g.campaigns.map((c) => c.id),
    });
    setFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await axiosInstance.delete(`/api/admin/cover-fees/${id}`);
      toast({ title: "Deleted", description: "Cover Fees pool removed." });
      setDeleteTarget(null);
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
  const totalCoverages = grants.reduce((s, g) => s + g.timesUsed, 0);

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GitMerge className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Investment Cover Fees</h1>
              <p className="text-sm text-muted-foreground">
                Configure sponsors whose wallets are pre-funded to cover the 5% CataCap fee on donations to selected campaigns.
              </p>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="button-new-grant">
            <Plus className="h-4 w-4 mr-2" /> New Cover Fees Pool
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
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Covered</p>
              <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400" data-testid="stat-used">
                {currency_format(totalUsed)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Times Triggered</p>
              <p className="text-2xl font-bold mt-1" data-testid="stat-triggers">{totalCoverages}</p>
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
              <p className="font-medium">No cover fees pools yet</p>
              <p className="text-sm mt-1">Create one to start automatically cover fees investments.</p>
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> New Cover Fees Pool
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
                          <span className="font-semibold text-base">{g.name || `Pool #${g.id}`}</span>
                          <Badge variant={g.isActive ? "default" : "secondary"}>
                            {g.isActive ? "Active" : "Inactive"}
                          </Badge>
                          <Badge variant="outline">
                            5% Fee Coverage{g.perInvestmentCap != null ? ` · max ${currency_format(g.perInvestmentCap)}/investment` : ""}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground">Sponsor:</span>{" "}
                            {g.sponsorFullName || g.sponsorEmail}
                          </span>
                          <span>
                            <span className="font-medium text-foreground">Fees Covered:</span>{" "}
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
                              <span className="font-medium text-foreground">Pending coverage:</span>{" "}
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
                          disabled={exportingIds.has(g.id)}
                          title="Download Excel report"
                          data-testid={`button-export-${g.id}`}
                        >
                          {exportingIds.has(g.id) ? (
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
                          onClick={() => setDeleteTarget(g)}
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
                          Coverage Activity
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

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && deletingId === null) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-delete-cover-fees-pool">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Cover Fees Pool?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>
                  This will permanently delete the pool{" "}
                  <strong>{deleteTarget?.name || (deleteTarget ? `Pool #${deleteTarget.id}` : "")}</strong>.
                </div>
                <div className="text-muted-foreground">
                  This action cannot be undone.
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="button-delete-cover-fees-pool-cancel"
              disabled={deletingId !== null}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingId !== null}
              onClick={(e) => {
                if (deletingId !== null || !deleteTarget) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                handleDelete(deleteTarget.id);
              }}
              data-testid="button-delete-cover-fees-pool-confirm"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
