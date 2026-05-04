import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
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
  balanceCutoff: number;
  balanceToday: number;
  balanceIncrease: number;
  balancePctChange: number;
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
  const { sortField, sortDir, handleSort } = useSort<SortField>("balanceIncrease", "desc");
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
      items = items.filter((d) => d.balanceToday > 0 || d.balanceCutoff > 0);
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
      balanceCutoff: filtered.reduce((s, d) => s + d.balanceCutoff, 0),
      balanceToday: filtered.reduce((s, d) => s + d.balanceToday, 0),
      investmentsCutoff: filtered.reduce((s, d) => s + d.investmentsCutoff, 0),
      investmentsToday: filtered.reduce((s, d) => s + d.investmentsToday, 0),
    };
  }, [filtered]);

  const totalBalIncrease = totals.balanceToday - totals.balanceCutoff;
  const totalBalPct = totals.balanceCutoff > 0
    ? Math.round(((totalBalIncrease / totals.balanceCutoff) * 100) * 100) / 100
    : totals.balanceToday > 0 ? 100 : 0;

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
      const headers = ["Donor Name", "Email", `Balance ${cutoffLabel}`, "Balance Today", "$ Increase", "% Increase", `Investments ${cutoffLabel}`, "Investments Today", "Inv % Change"];
      const lines = [headers.join(",")];
      for (const d of sorted) {
        lines.push([
          escape(d.name),
          escape(d.email),
          d.balanceCutoff.toFixed(2),
          d.balanceToday.toFixed(2),
          d.balanceIncrease.toFixed(2),
          d.balancePctChange.toFixed(2) + "%",
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
          <Card data-testid="card-balance-cutoff">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Balances {cutoffLabel}</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-balance-cutoff">
                {isLoading ? "—" : currency_format(totals.balanceCutoff, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-balance-today">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Balances Today</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-balance-today">
                {isLoading ? "—" : currency_format(totals.balanceToday, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-balance-increase">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Overall Balance Increase</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-semibold", totalBalIncrease > 0 ? "text-[#0ab39c]" : totalBalIncrease < 0 ? "text-red-500" : "")} data-testid="text-balance-increase">
                  {isLoading ? "—" : currency_format(totalBalIncrease, true, 0)}
                </span>
                {!isLoading && (
                  <span className={cn("text-sm font-medium", totalBalPct > 0 ? "text-[#0ab39c]" : totalBalPct < 0 ? "text-red-500" : "text-muted-foreground")}>
                    ({totalBalPct > 0 ? "+" : ""}{totalBalPct}%)
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
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">#</th>
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donor Name</SortHeader>
                    <SortHeader field="balanceCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Balance {cutoffLabel}</SortHeader>
                    <SortHeader field="balanceToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Balance Today</SortHeader>
                    <SortHeader field="balanceIncrease" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>$ Increase</SortHeader>
                    <SortHeader field="balancePctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>% Increase</SortHeader>
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
                    const balColor = d.balanceIncrease > 0 ? "text-[#0ab39c]" : d.balanceIncrease < 0 ? "text-red-500" : "text-muted-foreground";
                    const BalIcon = d.balanceIncrease > 0 ? TrendingUp : d.balanceIncrease < 0 ? TrendingDown : Minus;
                    const invChange = d.investmentsToday - d.investmentsCutoff;
                    const invColor = invChange > 0 ? "text-[#0ab39c]" : invChange < 0 ? "text-red-500" : "text-muted-foreground";
                    return (
                      <tr key={d.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-donor-${d.id}`}>
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium" data-testid={`text-donor-name-${d.id}`}>{d.name}</div>
                          <div className="text-xs text-muted-foreground">{d.email}</div>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-bal-cutoff-${d.id}`}>{currency_format(d.balanceCutoff, true, 2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-bal-today-${d.id}`}>{currency_format(d.balanceToday, true, 2)}</td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", balColor)} data-testid={`text-bal-increase-${d.id}`}>
                          <span className="inline-flex items-center gap-1">
                            <BalIcon className="h-3.5 w-3.5" />
                            {currency_format(Math.abs(d.balanceIncrease), true, 2)}
                          </span>
                        </td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", balColor)} data-testid={`text-bal-pct-${d.id}`}>
                          {d.balancePctChange > 0 ? "+" : ""}{d.balancePctChange}%
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
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.balanceCutoff, true, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.balanceToday, true, 0)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalBalIncrease > 0 ? "text-[#0ab39c]" : totalBalIncrease < 0 ? "text-red-500" : "")}>
                        {currency_format(Math.abs(totalBalIncrease), true, 0)}
                      </td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalBalPct > 0 ? "text-[#0ab39c]" : totalBalPct < 0 ? "text-red-500" : "")}>
                        {totalBalPct > 0 ? "+" : ""}{totalBalPct}%
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
