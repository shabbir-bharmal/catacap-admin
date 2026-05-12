import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/helpers/format";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";

import { cn } from "@/lib/utils";
import { fetchAllAccountBalanceHistories, exportAccountBalanceHistoryData, deleteAccountHistory } from "../api/account-history/accountHistoryApi";
import { currency_format } from "@/helpers/format";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";


type SortField = "changeDate" | "investmentName";

export default function AccountHistoryPage() {
  const { user: authUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>();

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [isExporting, setIsExporting] = useState(false);

  // Delete state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openDeleteDialog = (id: number) => {
    setDeleteTargetId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteAccountHistory(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["account-history"] });
      toast({
        title: "Transaction Deleted",
        description: "The transaction history record has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete transaction history", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the record. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const {
    data: queryData,
    isLoading,
    error
  } = useQuery({
    queryKey: ["account-history", currentPage, rowsPerPage, sortField, sortDir, effectiveSearch],
    queryFn: () =>
      fetchAllAccountBalanceHistories({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        searchValue: effectiveSearch.trim() || undefined
      }),
    staleTime: 0,
    gcTime: 0
  });

  const data = queryData?.items ?? [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Account History
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Search</Label>
                <div className="relative w-[320px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Username, Investment Name, Payment Type"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-9"
                    data-testid="input-search-history"
                  />
                </div>
              </div>
            </div>
            <Button
              size="sm"
              className="bg-[#405189] text-white"
              data-testid="button-export-all"
              disabled={isExporting}
              onClick={async () => {
                setIsExporting(true);
                try {
                  await exportAccountBalanceHistoryData();
                } catch {
                  // silently ignore or could add toast
                } finally {
                  setIsExporting(false);
                }
              }}
            >
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-account-history">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">User Name</th>
                    <SortHeader field="changeDate" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Change Date
                    </SortHeader>
                    <SortHeader field="investmentName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Investment Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Payment Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Gross Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Fees</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Net Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Old Value</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">New Value</th>
                    {authUser?.isSuperAdmin && (
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading && error && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-destructive">
                        {error?.message || "Failed to load data"}
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && data.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No records found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    !error &&
                    data.map((entry) => (
                      <tr key={entry.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-history-${entry.id}`}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium" data-testid={`text-username-${entry.id}`}>
                            {entry.userName || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-date-${entry.id}`}>
                            {formatDate(entry.changeDate)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-investment-${entry.id}`}>
                            {entry.investmentName || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1.5" data-testid={`text-payment-${entry.id}`}>
                            <div className="flex items-center gap-2 flex-wrap">
                                {entry.paymentType ? (() => {
                                  const lower = entry.paymentType.toLowerCase();
                                  let badgeClass = "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";

                                  if (lower.includes("revert") || lower.includes("rollback")) {
                                    badgeClass = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
                                  } else if (lower.includes("return") || lower.includes("credit")) {
                                    badgeClass = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
                                  } else if (
                                    lower.includes("balance update") ||
                                    lower.includes("balance  updated") ||
                                    lower.includes("updated by admin") ||
                                    lower.includes("updated by group")
                                  ) {
                                    badgeClass = "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300";
                                  }

                                  return (
                                    <Badge className={cn("no-default-hover-elevate no-default-active-elevate border-0 whitespace-normal text-left", badgeClass)}>
                                      {entry.paymentType}
                                    </Badge>
                                  );
                                })() : <span className="text-muted-foreground">—</span>}
                            </div>
                            {entry.comment && (
                              <span className="text-xs text-muted-foreground whitespace-pre-wrap">
                                <strong className="text-foreground">Comment: </strong> {entry.comment}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-gross-amount-${entry.id}`}>
                            {entry.grossAmount === null ? "—" : currency_format(entry.grossAmount, false, 2, "$0.00")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-fees-${entry.id}`}>
                            {entry.fees === null ? "—" : currency_format(entry.fees, false, 2, "$0.00")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-net-amount-${entry.id}`}>
                            {entry.netAmount === null ? "—" : currency_format(entry.netAmount, false, 2, "$0.00")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-old-value-${entry.id}`}>
                            {currency_format(entry.oldValue, false, 2)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-new-value-${entry.id}`}>
                            {currency_format(entry.newValue, false, 2)}
                          </span>
                        </td>
                        {authUser?.isSuperAdmin && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end">
                              <div className="inline-flex rounded-md shadow-sm">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                      onClick={() => openDeleteDialog(entry.id)}
                                      data-testid={`button-delete-${entry.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete record</TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalCount={totalCount}
              rowsPerPage={rowsPerPage}
              onPageChange={setCurrentPage}
              onRowsPerPageChange={(v: number) => {
                setRowsPerPage(v);
                setCurrentPage(1);
              }}
              dataTestId="pagination-account-history"
            />
          </CardContent>
        </Card>
      </div>
      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Transaction Record"
        description="Are you sure you want to delete this transaction history record? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
        dataTestId="dialog-delete"
      />
    </AdminLayout>
  );
}
