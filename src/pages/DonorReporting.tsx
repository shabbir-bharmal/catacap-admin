import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, TrendingUp, TrendingDown, Minus, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { currency_format } from "@/helpers/format";
import { useDebounce } from "../hooks/useDebounce";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import axiosInstance from "../api/axios";

interface DonorReportingItem {
  id: string;
  name: string;
  email: string;
  totalAssetsCutoff: number;
  totalAssetsToday: number;
  totalAssetsIncrease: number;
  totalAssetsPctChange: number;
  investmentsCutoff: number;
  investmentsToday: number;
  investmentPctChange: number;
}

interface DonorReportingResponse {
  items: DonorReportingItem[];
  cutoffLabel: string;
}

type SortField = keyof DonorReportingItem;

export default function DonorReportingPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const { sortField, sortDir, handleSort } = useSort<SortField>("totalAssetsIncrease", "desc");
  const [isExporting, setIsExporting] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const { data, isLoading, isError, refetch } = useQuery<DonorReportingResponse>({
    queryKey: ["/api/admin/reporting/donor-reporting"],
    queryFn: async () => {
      const res = await axiosInstance.get<DonorReportingResponse>("/api/admin/reporting/donor-reporting");
      return res.data;
    },
  });

  const cutoffLabel = data?.cutoffLabel || "12/31/2025";

  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (hideZero) {
      items = items.filter((d) => d.totalAssetsToday > 0 || d.totalAssetsCutoff > 0);
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length >= 2) {
      items = items.filter((d) => d.name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q));
    }
    return items;
  }, [data, debouncedSearch, hideZero]);

  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = Number(aVal) || 0;
      const numB = Number(bVal) || 0;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
    return copy;
  }, [filtered, sortField, sortDir]);

  const totals = useMemo(() => {
    return {
      totalAssetsCutoff: filtered.reduce((s, d) => s + d.totalAssetsCutoff, 0),
      totalAssetsToday: filtered.reduce((s, d) => s + d.totalAssetsToday, 0),
      investmentsCutoff: filtered.reduce((s, d) => s + d.investmentsCutoff, 0),
      investmentsToday: filtered.reduce((s, d) => s + d.investmentsToday, 0),
    };
  }, [filtered]);

  const totalAssetsIncrease = totals.totalAssetsToday - totals.totalAssetsCutoff;
  const totalAssetsPct = totals.totalAssetsCutoff > 0
    ? Math.round(((totalAssetsIncrease / totals.totalAssetsCutoff) * 100) * 100) / 100
    : totals.totalAssetsToday > 0 ? 100 : 0;

  const totalInvChange = totals.investmentsToday - totals.investmentsCutoff;
  const totalInvPct = totals.investmentsCutoff > 0
    ? Math.round(((totalInvChange / totals.investmentsCutoff) * 100) * 100) / 100
    : totals.investmentsToday > 0 ? 100 : 0;

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const escape = (val: unknown) => {
        const s = val === null || val === undefined ? "" : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = ["Donor Name", "Email", `Total Assets ${cutoffLabel}`, "Total Assets Today", "$ Increase", "% Increase", `Investments ${cutoffLabel}`, "Investments Today", "Inv % Change"];
      const lines = [headers.join(",")];
      for (const d of sorted) {
        lines.push([
          escape(d.name),
          escape(d.email),
          d.totalAssetsCutoff.toFixed(2),
          d.totalAssetsToday.toFixed(2),
          d.totalAssetsIncrease.toFixed(2),
          d.totalAssetsPctChange.toFixed(2) + "%",
          d.investmentsCutoff,
          d.investmentsToday,
          d.investmentPctChange.toFixed(2) + "%",
        ].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `donor-reporting-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${sorted.length} donor${sorted.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Failed to export", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout title="Donor Reporting">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">Donor Reporting</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-assets-cutoff">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Assets {cutoffLabel}</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-assets-cutoff">
                {isLoading ? "—" : currency_format(totals.totalAssetsCutoff, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-assets-today">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Assets Today</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-assets-today">
                {isLoading ? "—" : currency_format(totals.totalAssetsToday, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-assets-increase">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Overall Assets Increase</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-semibold", totalAssetsIncrease > 0 ? "text-[#0ab39c]" : totalAssetsIncrease < 0 ? "text-red-500" : "")} data-testid="text-assets-increase">
                  {isLoading ? "—" : currency_format(totalAssetsIncrease, true, 0)}
                </span>
                {!isLoading && (
                  <span className={cn("text-sm font-medium", totalAssetsPct > 0 ? "text-[#0ab39c]" : totalAssetsPct < 0 ? "text-red-500" : "text-muted-foreground")}>
                    ({totalAssetsPct > 0 ? "+" : ""}{totalAssetsPct}%)
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isError && (
          <Card className="border-destructive">
            <CardContent className="py-6 flex items-center justify-between gap-4">
              <p className="font-medium">Failed to load donor reporting data.</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search donors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-donors"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none" data-testid="filter-hide-zero">
                <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} className="accent-[#405189] h-3.5 w-3.5" />
                Hide $0 donors
              </label>
              <span className="text-sm text-muted-foreground">{sorted.length} donor{sorted.length !== 1 ? "s" : ""}</span>
              <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isExporting || isLoading || sorted.length === 0} data-testid="button-export-csv">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {isExporting ? "Exporting..." : "Export CSV"}
              </Button>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="How are these values calculated?"
                      data-testid="tooltip-donor-reporting-help"
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <HelpCircle className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-sm text-xs leading-relaxed space-y-2">
                    <p>
                      <span className="font-semibold">$ Increase</span> = Total Assets Today &minus; Total Assets {cutoffLabel} (per donor, rounded to cents).
                    </p>
                    <p>
                      <span className="font-semibold">% Increase</span> = ($ Increase &divide; Total Assets {cutoffLabel}) &times; 100. If the {cutoffLabel} total was $0 and today is greater than $0, shows +100%; if both are $0, shows 0%.
                    </p>
                    <p>
                      <span className="font-semibold">Inv % Change</span> = ((Investments Today &minus; Investments {cutoffLabel}) &divide; Investments {cutoffLabel}) &times; 100, rounded to two decimals. If the {cutoffLabel} count was 0 and today is greater than 0, shows +100%; if both are 0, shows 0%.
                    </p>
                    <p>
                      <span className="font-semibold">Overall Assets Increase</span> = sum of Total Assets Today across all donors &minus; sum of Total Assets {cutoffLabel}, with the percentage computed against the summed {cutoffLabel} total using the same zero-cutoff rule.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">#</th>
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donor Name</SortHeader>
                    <SortHeader field="totalAssetsCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Total Assets {cutoffLabel}</SortHeader>
                    <SortHeader field="totalAssetsToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Total Assets Today</SortHeader>
                    <SortHeader field="totalAssetsIncrease" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>$ Increase</SortHeader>
                    <SortHeader field="totalAssetsPctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>% Increase</SortHeader>
                    <SortHeader field="investmentsCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Investments {cutoffLabel}</SortHeader>
                    <SortHeader field="investmentsToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Investments Today</SortHeader>
                    <SortHeader field="investmentPctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Inv % Change</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">Loading...</td></tr>
                  ) : sorted.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">{search ? "No donors match your search." : "No donors found."}</td></tr>
                  ) : sorted.map((d, idx) => {
                    const assetColor = d.totalAssetsIncrease > 0 ? "text-[#0ab39c]" : d.totalAssetsIncrease < 0 ? "text-red-500" : "text-muted-foreground";
                    const AssetIcon = d.totalAssetsIncrease > 0 ? TrendingUp : d.totalAssetsIncrease < 0 ? TrendingDown : Minus;
                    const invChange = d.investmentsToday - d.investmentsCutoff;
                    const invColor = invChange > 0 ? "text-[#0ab39c]" : invChange < 0 ? "text-red-500" : "text-muted-foreground";
                    return (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-donor-${d.id}`}>
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium" data-testid={`text-donor-name-${d.id}`}>{d.name}</div>
                          <div className="text-xs text-muted-foreground">{d.email}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-assets-cutoff-${d.id}`}>{currency_format(d.totalAssetsCutoff, true, 2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-assets-today-${d.id}`}>{currency_format(d.totalAssetsToday, true, 2)}</td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", assetColor)} data-testid={`text-assets-increase-${d.id}`}>
                          <span className="inline-flex items-center gap-1">
                            <AssetIcon className="h-3.5 w-3.5" />
                            {currency_format(Math.abs(d.totalAssetsIncrease), true, 2)}
                          </span>
                        </td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", assetColor)} data-testid={`text-assets-pct-${d.id}`}>
                          {d.totalAssetsPctChange > 0 ? "+" : ""}{d.totalAssetsPctChange}%
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums" data-testid={`text-inv-cutoff-${d.id}`}>{d.investmentsCutoff}</td>
                        <td className="px-4 py-3 text-center tabular-nums" data-testid={`text-inv-today-${d.id}`}>{d.investmentsToday}</td>
                        <td className={cn("px-4 py-3 text-center tabular-nums", invColor)} data-testid={`text-inv-pct-${d.id}`}>
                          {d.investmentPctChange > 0 ? "+" : ""}{d.investmentPctChange}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {!isLoading && sorted.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      <td className="px-4 py-3" colSpan={2}>Totals</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.totalAssetsCutoff, true, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.totalAssetsToday, true, 0)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalAssetsIncrease > 0 ? "text-[#0ab39c]" : totalAssetsIncrease < 0 ? "text-red-500" : "")}>
                        {currency_format(Math.abs(totalAssetsIncrease), true, 0)}
                      </td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalAssetsPct > 0 ? "text-[#0ab39c]" : totalAssetsPct < 0 ? "text-red-500" : "")}>
                        {totalAssetsPct > 0 ? "+" : ""}{totalAssetsPct}%
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.investmentsCutoff}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.investmentsToday}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums", totalInvPct > 0 ? "text-[#0ab39c]" : totalInvPct < 0 ? "text-red-500" : "")}>
                        {totalInvPct > 0 ? "+" : ""}{totalInvPct}%
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
