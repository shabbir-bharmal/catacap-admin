import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Search, Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { fetchGroupReporting, type GroupReportingItem } from "../api/group/groupApi";
import { currency_format } from "@/helpers/format";
import { useDebounce } from "../hooks/useDebounce";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type SortField = keyof GroupReportingItem;

export default function GroupReportingPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const { sortField, sortDir, handleSort } = useSort<SortField>("increase", "desc");
  const [isExporting, setIsExporting] = useState(false);
  const [hideZero, setHideZero] = useState(true);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/admin/group/group-reporting"],
    queryFn: fetchGroupReporting,
  });

  const cutoffLabel = data?.cutoffLabel || "12/31/2025";

  const filtered = useMemo(() => {
    let items = data?.items || [];
    if (hideZero) {
      items = items.filter((g) => g.throughToday > 0 || g.throughCutoff > 0);
    }
    const q = debouncedSearch.trim().toLowerCase();
    if (q.length >= 2) {
      items = items.filter((g) => g.name.toLowerCase().includes(q));
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
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const numA = Number(aVal) || 0;
      const numB = Number(bVal) || 0;
      return sortDir === "asc" ? numA - numB : numB - numA;
    });
    return copy;
  }, [filtered, sortField, sortDir]);

  const totals = useMemo(() => {
    const items = filtered;
    return {
      membersCutoff: items.reduce((s, g) => s + g.membersCutoff, 0),
      membersToday: items.reduce((s, g) => s + g.membersToday, 0),
      throughCutoff: items.reduce((s, g) => s + g.throughCutoff, 0),
      throughToday: items.reduce((s, g) => s + g.throughToday, 0),
    };
  }, [filtered]);

  const totalMemberChange = totals.membersToday - totals.membersCutoff;
  const totalMemberPct = totals.membersCutoff > 0
    ? Math.round(((totalMemberChange / totals.membersCutoff) * 100) * 100) / 100
    : totals.membersToday > 0 ? 100 : 0;

  const totalIncrease = totals.throughToday - totals.throughCutoff;
  const totalPct = totals.throughCutoff > 0
    ? Math.round(((totalIncrease / totals.throughCutoff) * 100) * 100) / 100
    : totals.throughToday > 0 ? 100 : 0;

  const handleExportCsv = () => {
    setIsExporting(true);
    try {
      const escape = (val: unknown) => {
        const s = val === null || val === undefined ? "" : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const headers = ["Group Name", `Members ${cutoffLabel}`, "Members Today", "Member % Change", `Invested Through ${cutoffLabel}`, "Invested Through Today", "$ Increase", "% Increase"];
      const lines = [headers.join(",")];
      for (const g of sorted) {
        lines.push([
          escape(g.name),
          g.membersCutoff,
          g.membersToday,
          g.memberPctChange.toFixed(2) + "%",
          g.throughCutoff.toFixed(2),
          g.throughToday.toFixed(2),
          g.increase.toFixed(2),
          g.pctIncrease.toFixed(2) + "%",
        ].join(","));
      }
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `group-reporting-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${sorted.length} group${sorted.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Failed to export", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout title="Group Reporting">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/groups">
              <Button
                variant="outline"
                size="sm"
                className="text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                data-testid="button-back-to-groups"
              >
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to Groups
              </Button>
            </Link>
            <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
              Group Reporting
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card data-testid="card-total-cutoff">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Through {cutoffLabel}</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-total-cutoff">
                {isLoading ? "—" : currency_format(totals.throughCutoff, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-total-today">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Total Through Today</p>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-testid="text-total-today">
                {isLoading ? "—" : currency_format(totals.throughToday, true, 0)}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-total-increase">
            <CardHeader className="pb-2">
              <p className="text-sm font-medium text-muted-foreground">Overall Increase</p>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-semibold", totalIncrease > 0 ? "text-[#0ab39c]" : totalIncrease < 0 ? "text-red-500" : "")} data-testid="text-total-increase">
                  {isLoading ? "—" : currency_format(totalIncrease, true, 0)}
                </span>
                {!isLoading && (
                  <span className={cn("text-sm font-medium", totalPct > 0 ? "text-[#0ab39c]" : totalPct < 0 ? "text-red-500" : "text-muted-foreground")}>
                    ({totalPct > 0 ? "+" : ""}{totalPct}%)
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {isError && (
          <Card className="border-destructive">
            <CardContent className="py-6 flex items-center justify-between gap-4">
              <p className="font-medium">Failed to load group reporting data.</p>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">Retry</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search groups..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search-groups"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none" data-testid="filter-hide-zero">
                <input
                  type="checkbox"
                  checked={hideZero}
                  onChange={(e) => setHideZero(e.target.checked)}
                  className="accent-[#405189] h-3.5 w-3.5"
                />
                Hide $0 groups
              </label>
              <span className="text-sm text-muted-foreground">{sorted.length} group{sorted.length !== 1 ? "s" : ""}</span>
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
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Group Name</SortHeader>
                    <SortHeader field="membersCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Members {cutoffLabel}</SortHeader>
                    <SortHeader field="membersToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Members Today</SortHeader>
                    <SortHeader field="memberPctChange" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Member % Change</SortHeader>
                    <SortHeader field="throughCutoff" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Invested Through {cutoffLabel}</SortHeader>
                    <SortHeader field="throughToday" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>Invested Through Today</SortHeader>
                    <SortHeader field="increase" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>$ Increase</SortHeader>
                    <SortHeader field="pctIncrease" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>% Increase</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">Loading...</td></tr>
                  ) : sorted.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">{search ? "No groups match your search." : "No groups found."}</td></tr>
                  ) : sorted.map((g, idx) => {
                    const TrendIcon = g.increase > 0 ? TrendingUp : g.increase < 0 ? TrendingDown : Minus;
                    const trendColor = g.increase > 0 ? "text-[#0ab39c]" : g.increase < 0 ? "text-red-500" : "text-muted-foreground";
                    const memberChange = g.membersToday - g.membersCutoff;
                    const memberColor = memberChange > 0 ? "text-[#0ab39c]" : memberChange < 0 ? "text-red-500" : "text-muted-foreground";
                    return (
                      <tr key={g.id} className="hover:bg-muted/20 transition-colors" data-testid={`row-group-${g.id}`}>
                        <td className="px-4 py-3 text-muted-foreground">{idx + 1}</td>
                        <td className="px-4 py-3 font-medium" data-testid={`text-group-name-${g.id}`}>{g.name}</td>
                        <td className="px-4 py-3 text-center" data-testid={`text-members-cutoff-${g.id}`}>{g.membersCutoff}</td>
                        <td className="px-4 py-3 text-center" data-testid={`text-members-today-${g.id}`}>{g.membersToday}</td>
                        <td className={cn("px-4 py-3 text-center tabular-nums", memberColor)} data-testid={`text-member-pct-${g.id}`}>
                          {g.memberPctChange > 0 ? "+" : ""}{g.memberPctChange}%
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-cutoff-${g.id}`}>{currency_format(g.throughCutoff, true, 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums" data-testid={`text-today-${g.id}`}>{currency_format(g.throughToday, true, 0)}</td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", trendColor)} data-testid={`text-increase-${g.id}`}>
                          <span className="inline-flex items-center gap-1">
                            <TrendIcon className="h-3.5 w-3.5" />
                            {currency_format(Math.abs(g.increase), true, 0)}
                          </span>
                        </td>
                        <td className={cn("px-4 py-3 text-right tabular-nums", trendColor)} data-testid={`text-pct-${g.id}`}>
                          {g.pctIncrease > 0 ? "+" : ""}{g.pctIncrease}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {!isLoading && sorted.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/30 font-semibold">
                      <td className="px-4 py-3" colSpan={2}>Totals</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.membersCutoff}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{totals.membersToday}</td>
                      <td className={cn("px-4 py-3 text-center tabular-nums", totalMemberPct > 0 ? "text-[#0ab39c]" : totalMemberPct < 0 ? "text-red-500" : "")}>
                        {totalMemberPct > 0 ? "+" : ""}{totalMemberPct}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.throughCutoff, true, 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{currency_format(totals.throughToday, true, 0)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalIncrease > 0 ? "text-[#0ab39c]" : totalIncrease < 0 ? "text-red-500" : "")}>
                        {currency_format(Math.abs(totalIncrease), true, 0)}
                      </td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", totalPct > 0 ? "text-[#0ab39c]" : totalPct < 0 ? "text-red-500" : "")}>
                        {totalPct > 0 ? "+" : ""}{totalPct}%
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
