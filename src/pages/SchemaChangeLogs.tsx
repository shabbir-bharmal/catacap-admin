import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Search,
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmationDialog } from "@/components/ConfirmationDialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  fetchSchemaChanges,
  rollbackSchemaChange,
  type SchemaChangeListParams,
  type SchemaChangeLog,
  type SchemaChangeStatus,
} from "@/api/schema-changes/schemaChangesApi";

const QUERY_KEY = "admin-schema-changes";
const POLL_INTERVAL_MS = 15_000;
const PAGE_SIZE = 100;

const OPERATION_OPTIONS = [
  "CREATE TABLE",
  "ADD COLUMN",
  "ALTER COLUMN",
  "DROP COLUMN",
  "DROP TABLE",
  "DROP INDEX",
  "DROP CONSTRAINT",
  "TRUNCATE",
  "RENAME",
];

const STATUS_OPTIONS: { label: string; value: SchemaChangeStatus | "all" }[] = [
  { label: "All statuses", value: "all" },
  { label: "Applied", value: "applied" },
  { label: "Rolled back", value: "rolled_back" },
  { label: "Failed", value: "failed" },
];

const DESTRUCTIVE_OPS = new Set([
  "DROP TABLE",
  "DROP COLUMN",
  "DROP INDEX",
  "DROP CONSTRAINT",
  "TRUNCATE",
  "RENAME",
  "ALTER COLUMN",
]);

function isDestructive(op: string | null | undefined): boolean {
  if (!op) return false;
  const u = op.toUpperCase();
  return u.startsWith("DROP ") || DESTRUCTIVE_OPS.has(u);
}

function operationBadgeClasses(op: string | null | undefined): string {
  if (!op) return "bg-muted text-muted-foreground";
  const u = op.toUpperCase();
  if (u.startsWith("DROP ") || u === "TRUNCATE" || u === "RENAME") {
    return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900";
  }
  if (u === "ALTER COLUMN") {
    return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900";
  }
  if (u === "ADD COLUMN" || u === "CREATE TABLE") {
    return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900";
  }
  return "bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
}

function statusBadge(status: SchemaChangeStatus): { label: string; className: string } {
  switch (status) {
    case "applied":
      return {
        label: "Applied",
        className:
          "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900",
      };
    case "rolled_back":
      return {
        label: "Rolled back",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
      };
    case "failed":
      return {
        label: "Failed",
        className:
          "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900",
      };
    default:
      return { label: status, className: "bg-muted text-muted-foreground" };
  }
}

function formatJson(v: unknown): string {
  if (v === null || v === undefined) return "(none)";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function JsonSideBySide({ left, right }: { left: unknown; right: unknown }) {
  const leftText = formatJson(left);
  const rightText = formatJson(right);
  const leftLines = leftText.split("\n");
  const rightLines = rightText.split("\n");
  const max = Math.max(leftLines.length, rightLines.length);
  const rows: { a: string; b: string; diff: boolean }[] = [];
  for (let i = 0; i < max; i++) {
    const a = leftLines[i] ?? "";
    const b = rightLines[i] ?? "";
    rows.push({ a, b, diff: a !== b });
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs font-mono">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Old definition
        </div>
        <pre
          className="bg-muted/40 rounded border p-2 overflow-auto max-h-96"
          data-testid="pre-old-definition"
        >
          {rows.map((r, i) => (
            <div
              key={`l-${i}`}
              className={cn(
                "whitespace-pre",
                r.diff && r.a ? "bg-red-100 dark:bg-red-950/40" : "",
              )}
            >
              {r.a || "\u00A0"}
            </div>
          ))}
        </pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          New definition
        </div>
        <pre
          className="bg-muted/40 rounded border p-2 overflow-auto max-h-96"
          data-testid="pre-new-definition"
        >
          {rows.map((r, i) => (
            <div
              key={`r-${i}`}
              className={cn(
                "whitespace-pre",
                r.diff && r.b ? "bg-emerald-100 dark:bg-emerald-950/40" : "",
              )}
            >
              {r.b || "\u00A0"}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function SqlBlock({ label, sql, testId }: { label: string; sql: string | null; testId: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      <pre
        className="bg-muted/40 rounded border p-2 overflow-auto max-h-60 text-xs font-mono whitespace-pre-wrap break-words"
        data-testid={testId}
      >
        {sql && sql.trim().length > 0 ? sql : <span className="text-muted-foreground">(none)</span>}
      </pre>
    </div>
  );
}

export default function SchemaChangeLogs() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<SchemaChangeStatus | "all">("all");
  const [operationFilter, setOperationFilter] = useState<string | "all">("all");
  const [tableFilter, setTableFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pendingRollback, setPendingRollback] = useState<SchemaChangeLog | null>(null);
  const [failedRollbackIds, setFailedRollbackIds] = useState<Set<string>>(new Set());

  const queryParams: SchemaChangeListParams = useMemo(
    () => ({
      status: statusFilter === "all" ? undefined : statusFilter,
      operation: operationFilter === "all" ? undefined : operationFilter,
      table: tableFilter.trim() || undefined,
      // Interpret HTML date input ("YYYY-MM-DD") in the user's LOCAL timezone:
      // From = local 00:00:00.000 of that date; To = local 23:59:59.999 of that date.
      // `new Date("YYYY-MM-DD")` would parse as UTC midnight, which shifts a PST
      // user's "May 2" filter to start at 4 PM May 1 — confusing. The "T00:00:00"
      // suffix forces the parser to use local time.
      dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`).toISOString() : undefined,
      dateTo: dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [statusFilter, operationFilter, tableFilter, dateFrom, dateTo, page],
  );

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: [QUERY_KEY, queryParams],
    queryFn: () => fetchSchemaChanges(queryParams),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((row) => {
      const haystack = [
        row.executedSql,
        row.rollbackSql ?? "",
        row.promptReference ?? "",
        row.tableName,
        row.columnName ?? "",
      ]
        .join("\n")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search]);

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => rollbackSchemaChange(id),
    onSuccess: (resp, id) => {
      if (resp.success) {
        setFailedRollbackIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast({
          title: "Rollback succeeded",
          description: `Change ${id.slice(0, 8)}… is now rolled back.`,
        });
        queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      } else {
        setFailedRollbackIds((prev) => new Set(prev).add(id));
        toast({
          title: "Rollback failed",
          description: resp.error || resp.message || "Unknown error",
          variant: "destructive",
        });
      }
    },
    onError: (err: unknown, id) => {
      setFailedRollbackIds((prev) => new Set(prev).add(id));
      let message = "Unknown error";
      if (err && typeof err === "object") {
        const axiosLike = err as {
          response?: { data?: { error?: string; message?: string } };
          message?: string;
        };
        message =
          axiosLike.response?.data?.error ??
          axiosLike.response?.data?.message ??
          axiosLike.message ??
          message;
      } else if (typeof err === "string") {
        message = err;
      }
      toast({
        title: "Rollback failed",
        description: message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setPendingRollback(null);
    },
  });

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resetFilters = () => {
    setStatusFilter("all");
    setOperationFilter("all");
    setTableFilter("");
    setDateFrom("");
    setDateTo("");
    setSearch("");
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminLayout title="DB Schema Logs">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
              DB Schema Logs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every schema mutation that flows through{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">apply_schema_change()</code> is
              recorded here. Auto-refreshes every {POLL_INTERVAL_MS / 1000}s.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isFetching && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Refreshing
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
              <div className="lg:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Search SQL / prompt</label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search executed SQL, rollback SQL, or prompt reference"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Table</label>
                <Input
                  placeholder="e.g. users"
                  value={tableFilter}
                  onChange={(e) => {
                    setPage(0);
                    setTableFilter(e.target.value);
                  }}
                  data-testid="input-filter-table"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Operation</label>
                <Select
                  value={operationFilter}
                  onValueChange={(v) => {
                    setPage(0);
                    setOperationFilter(v);
                  }}
                >
                  <SelectTrigger data-testid="select-filter-operation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All operations</SelectItem>
                    {OPERATION_OPTIONS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setPage(0);
                    setStatusFilter(v as SchemaChangeStatus | "all");
                  }}
                >
                  <SelectTrigger data-testid="select-filter-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setPage(0);
                    setDateFrom(e.target.value);
                  }}
                  data-testid="input-filter-date-from"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setPage(0);
                    setDateTo(e.target.value);
                  }}
                  data-testid="input-filter-date-to"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="text-xs text-muted-foreground" data-testid="text-result-count">
                Showing {filteredItems.length} of {total} change{total === 1 ? "" : "s"}
                {search && items.length !== filteredItems.length
                  ? ` (filtered from ${items.length} on this page)`
                  : ""}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                data-testid="button-reset-filters"
              >
                Reset filters
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead className="w-48">Timestamp</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>Table</TableHead>
                    <TableHead>Column</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Triggered by</TableHead>
                    <TableHead>Prompt reference</TableHead>
                    <TableHead className="text-right w-32">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
                      </TableCell>
                    </TableRow>
                  ) : error ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-red-600">
                        Failed to load schema changes: {(error as Error).message}
                      </TableCell>
                    </TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                        No schema changes match the current filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((row) => {
                      const isOpen = expanded.has(row.id);
                      const destructive = isDestructive(row.operationType);
                      const sb = statusBadge(row.status);
                      const opCls = operationBadgeClasses(row.operationType);
                      const failedHere = failedRollbackIds.has(row.id);
                      return (
                        <Fragment key={row.id}>
                          <TableRow
                            className={cn(
                              "cursor-pointer hover-elevate",
                              destructive && "bg-red-50/40 dark:bg-red-950/10",
                            )}
                            onClick={() => toggleExpand(row.id)}
                            data-testid={`row-schema-change-${row.id}`}
                          >
                            <TableCell>
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-nowrap">
                              {row.createdAt
                                ? format(new Date(row.createdAt), "yyyy-MM-dd HH:mm:ss")
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {destructive && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertTriangle
                                        className="h-3.5 w-3.5 text-red-600"
                                        data-testid={`icon-destructive-${row.id}`}
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      Destructive operation — review carefully before rollback.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                <Badge
                                  variant="outline"
                                  className={cn("font-mono text-xs", opCls)}
                                  data-testid={`badge-op-${row.id}`}
                                >
                                  {row.operationType || "—"}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">{row.tableName}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {row.columnName ?? <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={sb.className}
                                data-testid={`badge-status-${row.id}`}
                              >
                                {sb.label}
                              </Badge>
                              {failedHere && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <XCircle
                                      className="inline h-3.5 w-3.5 text-red-600 ml-1.5"
                                      data-testid={`icon-rollback-failed-${row.id}`}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Last rollback attempt in this session failed.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{row.triggeredBy || "—"}</TableCell>
                            <TableCell
                              className="text-xs max-w-[280px] truncate"
                              title={row.promptReference ?? undefined}
                            >
                              {row.promptReference ?? (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {row.status === "applied" && row.rollbackSql ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingRollback(row);
                                  }}
                                  data-testid={`button-rollback-${row.id}`}
                                >
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                  Rollback
                                </Button>
                              ) : row.status === "rolled_back" ? (
                                <span className="inline-flex items-center text-xs text-muted-foreground gap-1">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Reverted
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/20">
                              <TableCell colSpan={9} className="p-4">
                                <div className="space-y-4">
                                  {row.status === "rolled_back" && (
                                    <div className="text-xs text-muted-foreground">
                                      Rolled back
                                      {row.rolledBackAt
                                        ? ` at ${format(new Date(row.rolledBackAt), "yyyy-MM-dd HH:mm:ss")}`
                                        : ""}
                                      {row.rolledBackBy ? ` by ${row.rolledBackBy}` : ""}.
                                    </div>
                                  )}
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    <SqlBlock
                                      label="Executed SQL"
                                      sql={row.executedSql}
                                      testId={`pre-executed-${row.id}`}
                                    />
                                    <SqlBlock
                                      label="Rollback SQL"
                                      sql={row.rollbackSql}
                                      testId={`pre-rollback-${row.id}`}
                                    />
                                  </div>
                                  <JsonSideBySide
                                    left={row.oldDefinition}
                                    right={row.newDefinition}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between p-3 border-t">
                <div className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    data-testid="button-page-prev"
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    data-testid="button-page-next"
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={!!pendingRollback}
        onOpenChange={(open) => {
          if (!open) setPendingRollback(null);
        }}
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Roll back schema change?
          </span>
        }
        description={
          pendingRollback ? (
            <div className="space-y-2">
              <p>
                This will execute the recorded rollback SQL for{" "}
                <strong>{pendingRollback.operationType}</strong> on{" "}
                <strong className="font-mono">{pendingRollback.tableName}</strong>
                {pendingRollback.columnName ? (
                  <>
                    {" "}
                    (<span className="font-mono">{pendingRollback.columnName}</span>)
                  </>
                ) : null}
                . Rollback is itself a schema change and may fail or have side-effects.
              </p>
              {pendingRollback.rollbackSql && (
                <pre className="text-[11px] bg-muted/50 border rounded p-2 overflow-auto max-h-40 font-mono whitespace-pre-wrap break-words">
                  {pendingRollback.rollbackSql}
                </pre>
              )}
            </div>
          ) : null
        }
        confirmLabel="Roll back"
        cancelLabel="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        isSubmitting={rollbackMutation.isPending}
        onConfirm={() => {
          if (pendingRollback) rollbackMutation.mutate(pendingRollback.id);
        }}
        dataTestId="dialog-confirm-rollback"
      />
    </AdminLayout>
  );
}
