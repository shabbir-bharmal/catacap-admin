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

interface InvestmentReportingItem {
  id: number;
  name: string;
  stage: number;
  isActive: boolean;
  amountCutoff: number;
  amountToday: number;
  amountIncrease: number;
  amountPctChange: number;
  donationsCutoff: number;
  donationsToday: number;
  donorsCutoff: number;
  donorsToday: number;
  donorPctChange: number;
}

interface InvestmentReportingResponse {
  items: InvestmentReportingItem[];
  cutoffLabel: string;
}

type SortField = keyof InvestmentReportingItem;

export default function InvestmentReportingPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const { sortField, sortDir, handleSort } = useSort<SortField>("amountIncrease", "desc");
  const [isExporting, setIsExporting] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const { data, isLoading, isError, refetch } = useQuery<InvestmentReportingResponse>({
    queryKey: ["/api/admin/reporting/investment-reporting"],
    queryFn: async () => {
      const res = await axiosInstance.get<InvestmentReportingResponse>("/api/admin/reporting/investment-reporting");
      return res.data;
    },
  });

  const cutoffLabel = data?.cutoffLabel || "12/31/2025";

  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (hideZero) {
      items = items.filter((inv) => inv.amountToday > 0 || inv.amountCutoff > 0);
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length >= 2) {
      items = items.filter((inv) => inv.name.toLowerCase().includes(q));
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
      amountCutoff: filtered.reduce((s, inv) => s + inv.amountCutoff, 0),
      amountToday: filtered.reduce((s, inv) => s + inv.amountToday, 0),
      donationsCutoff: filtered.reduce((s, inv) => s + inv.donationsCutoff, 0),
      donationsToday: filtered.reduce((s, inv) => s + inv.donationsToday, 0),
      donorsCutoff: filtered.reduce((s, inv) => s + inv.donorsCutoff, 0),
      donorsToday: filtered.reduce((s, inv) => s + inv.donorsToday, 0),
    };
  }, [filtered]);

  const totalAmtIncrease = totals.amountToday - totals.amountCutoff;
  const totalAmtPct = totals.amountCutoff > 0
    ? Math.round(((totalAmtIncrease / totals.amountCutoff) * 100) * 100) / 100
    : totals.amountToday > 0 ? 100 : 0;

  const totalDonorChange = totals.donorsToday - totals.donorsCutoff;
  const totalDonorPct = totals.donorsCutoff > 0
    ? Math.round(((totalDonorChange / totals.donorsCutoff) * 100) * 100) / 100
    : totals.donorsToday > 0 ? 100 : 0;

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const escape = (val: unknown) => {
        const s = val === null || val === undefined ? "" : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = ["Investment Name", `Amount ${cutoffLabel}`, "Amount Today", "$ Increase", "% Increase", `Donations ${cutoffLabel}`, "Donations Today", `Donors ${cutoffLabel}`, "Donors Today", "Donor % Change"];
      const lines = [headers.join(",")];
      for (const inv of sorted) {
        lines.push([
          escape(inv.name),
          inv.amountCutoff.toFixed(2),
          inv.amountToday.toFixed(2),
          inv.amountIncrease.toFixed(2),
          inv.amountPctChange.toFixed(2) + "%",
          inv.donationsCutoff,
          inv.donationsToday,
          inv.donorsCutoff,
          inv.donorsToday,
          inv.donorPctChange.toFixed(2) + "%",
        ].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `investment-reporting-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${sorted.length} investment${sorted.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Failed to export", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout title="Investment Reporting">
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">Investment Reporting</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-amount-cutoff">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Raised {cutoffLabel}</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-amount-cutoff">
                {isLoading ? "—" : currency_format(totals.amountCutoff, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-amount-today">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Raised Today</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-amount-today">
                {isLoading ? "—" : currency_format(totals.amountToday, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-amount-increase">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Overall $ Increase</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-semibold", totalAmtIncrease > 0 ? "text-[#0ab39c]" : totalAmtIncrease < 0 ? "text-red-500" : "")} data-testid="text-amount-increase">
                  {isLoading ? "—" : currency_format(totalAmtIncrease, true, 0)}
                </span>
                {!isLoading && (
                  <span className={cn("text-sm font-medium", totalAmtPct > 0 ? "text-[#0ab39c]" : totalAmtPct < 0 ? "text-red-500" : "text-muted-foreground")}>
                    ({totalAmtPct > 0 ? "+" : ""}{totalAmtPct}%)
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isError && (
          <Card className="border-destructive">
            <CardContent className="py-6 flex items-center justify-between gap-4">
              <p className="font-medium">Failed to load investment reporting data.</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search investments..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-investments"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none" data-testid="filter-hide-zero">
                <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} className="accent-[#405189] h-3.5 w-3.5" />
                Hide $0 investments
              </label>
              <span className="text-sm text-muted-foreground">{sorted.length} investment{sorted.length !== 1 ? "s" : ""}</span>
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
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Investment Name</SortHeader>
                    <SortHeader field="amountCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Amount {cutoffLabel}</SortHeader>
                    <SortHeader field="amountToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Amount Today</SortHeader>
                    <SortHeader field="amountIncrease" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>$ Increase</SortHeader>
                    <SortHeader field="amountPctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>% Increase</SortHeader>
                    <SortHeader field="donationsCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donations {cutoffLabel}</SortHeader>
                    <SortHeader field="donationsToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donations Today</SortHeader>
                    <SortHeader field="donorsCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donors {cutoffLabel}</SortHeader>
                    <SortHeader field="donorsToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donors Today</SortHeader>
                    <SortHeader field="donorPctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Donor % Change</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={11} className="text-center py-10 text-muted-foreground">Loading...</td></tr>
                  ) : sorted.length === 0 ? (
                    <tr><td colSpan={11} className="text-center py-10 text-muted-foreground">{search ? "No investments match your search." : "No investments found."}</td></tr>
                  ) : sorted.map((inv, idx) => {
                    const amtColor = inv.amountIncrease > 0 ? "text-[#0ab39c]" : inv.amountIncrease < 0 ? "text-red-500" : "text-muted-foreground";
                    const AmtIcon = inv.amountIncrease > 0 ? TrendingUp : inv.amountIncrease < 0 ? TrendingDown : Minus;
                    const donorChange = inv.donorsToday - inv.donorsCutoff;
                    const donorColor = donorChange > 0 ? "text-[#0ab39c]" : donorChange < 0 ? "text-red-500" : "text-muted-foreground";
                    return (
                      <tr key={inv.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-investment-${inv.id}`}>
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium" data-testid={`text-inv-name-${inv.id}`}>{inv.name}</td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-amt-cutoff-${inv.id}`}>{currency_format(inv.amountCutoff, true, 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-amt-today-${inv.id}`}>{currency_format(inv.amountToday, true, 0)}</td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", amtColor)} data-testid={`text-amt-increase-${inv.id}`}>
                          <span className="inline-flex items-center gap-1">
                            <AmtIcon className="h-3.5 w-3.5" />
                            {currency_format(Math.abs(inv.amountIncrease), true, 0)}
                          </span>
                        </td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", amtColor)} data-testid={`text-amt-pct-${inv.id}`}>
                          {inv.amountPctChange > 0 ? "+" : ""}{inv.amountPctChange}%
                        </td>
                        <td className="px-4 py-3 text-center tabular-nums">{inv.donationsCutoff}</td>
                        <td className="px-4 py-3 text-center tabular-nums">{inv.donationsToday}</td>
                        <td className="px-4 py-3 text-center tabular-nums" data-testid={`text-donors-cutoff-${inv.id}`}>{inv.donorsCutoff}</td>
                        <td className="px-4 py-3 text-center tabular-nums" data-testid={`text-donors-today-${inv.id}`}>{inv.donorsToday}</td>
                        <td className={cn("px-4 py-3 text-center tabular-nums", donorColor)} data-testid={`text-donor-pct-${inv.id}`}>
                          {inv.donorPctChange > 0 ? "+" : ""}{inv.donorPctChange}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {!isLoading && sorted.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      <td className="px-4 py-3" colSpan={2}>Totals</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.amountCutoff, true, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.amountToday, true, 0)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalAmtIncrease > 0 ? "text-[#0ab39c]" : totalAmtIncrease < 0 ? "text-red-500" : "")}>
                        {currency_format(Math.abs(totalAmtIncrease), true, 0)}
                      </td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalAmtPct > 0 ? "text-[#0ab39c]" : totalAmtPct < 0 ? "text-red-500" : "")}>
                        {totalAmtPct > 0 ? "+" : ""}{totalAmtPct}%
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.donationsCutoff}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.donationsToday}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.donorsCutoff}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.donorsToday}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums", totalDonorPct > 0 ? "text-[#0ab39c]" : totalDonorPct < 0 ? "text-red-500" : "")}>
                        {totalDonorPct > 0 ? "+" : ""}{totalDonorPct}%
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
