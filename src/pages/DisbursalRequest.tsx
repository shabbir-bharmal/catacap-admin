import { useState, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { currency_format, formatDate } from "@/helpers/format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, ChevronLeft, ChevronRight, Eye, FileText, Trash2 } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import {
  fetchDisbursalRequests,
  exportDisbursalRequests,
  fetchDisbursalRequestNotes,
  downloadInvestmentDocument,
  updateDisbursalRequestStatus,
  deleteDisbursalRequest,
  DisbursalRequestStatus,
  DisbursalRequestEntry,
  NoteEntry
} from "../api/disbursal-request/disbursalRequestApi";


const AdminDisbursalNotes = ({ id }: { id: number }) => {
  const { data: notes, isLoading } = useQuery({
    queryKey: ["disbursalRequestNotes", id],
    queryFn: () => fetchDisbursalRequestNotes(id),
    staleTime: 0,
    gcTime: 0
  });

  if (isLoading) {
    return <div className="p-4 text-center text-sm text-muted-foreground">Loading notes...</div>;
  }

  if (!notes || notes.length === 0) {
    return <div className="p-4 text-center text-sm text-muted-foreground">No notes found.</div>;
  }

  return (
    <div className="p-4 bg-muted/50">
      <div className="overflow-x-auto rounded-lg border shadow-sm bg-white dark:bg-background">
        <table className="w-full" data-testid={`table-notes-${id}`}>
          <thead>
            <tr className="bg-[#405189]">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Username</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Note</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note, idx) => (
              <tr key={note.id} className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-white dark:bg-background" : "bg-muted/50"}`} data-testid={`row-note-entry-${id}-${idx}`}>
                <td className="px-4 py-3 text-sm" data-testid={`text-note-date-${id}-${idx}`}>
                  {formatDate(note.createdAt)}
                </td>
                <td className="px-4 py-3 text-sm" data-testid={`text-note-username-${id}-${idx}`}>
                  {note.userName}
                </td>
                <td className="px-4 py-3 text-sm" data-testid={`text-note-note-${id}-${idx}`}>
                  {note.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type SortField = "name" | "date" | "amount";

export default function AdminDisbursalRequest() {
  const { user: authUser } = useAuth();
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [statusUpdate, setStatusUpdate] = useState<{ entry: DisbursalRequestEntry; nextStatus: DisbursalRequestStatus } | null>(null);

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
      await deleteDisbursalRequest(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["disbursalRequests"] });
      toast({
        title: "Disbursal Request Deleted",
        description: "The disbursal request has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete disbursal request", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the disbursal request. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: DisbursalRequestStatus }) =>
      updateDisbursalRequestStatus(id, status),
    onSuccess: (res, variables) => {
      if (res.success) {
        const successMessage =
          variables.status === DisbursalRequestStatus.Cancelled
            ? "Disbursal request cancelled successfully"
            : variables.status === DisbursalRequestStatus.Completed
              ? "Disbursal request marked as completed successfully"
              : variables.status === DisbursalRequestStatus.Pending
                ? "Disbursal request marked as pending successfully"
                : res.message || "Status updated successfully";
        toast({
          title: successMessage,
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["disbursalRequests"] });
        setStatusUpdate(null);
      } else {
        toast({
          title: res.message || "Failed to update status",
          variant: "destructive",
          duration: 4000
        });
      }
    },
    onError: (err: any) => {
      toast({
        title: err.message || "An error occurred",
        variant: "destructive",
        duration: 4000
      });
    }
  });

  const handleUpdateStatus = () => {
    if (!statusUpdate) return;
    updateStatusMutation.mutate({
      id: statusUpdate.entry.id,
      status: statusUpdate.nextStatus
    });
  };

  const { data, isLoading } = useQuery({
    queryKey: ["disbursalRequests", currentPage, rowsPerPage, sortField, sortDir, effectiveSearch],
    queryFn: () =>
      fetchDisbursalRequests({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField || undefined,
        sortDirection: sortDir || undefined,
        searchValue: effectiveSearch || undefined
      }),
    staleTime: 0,
    gcTime: 0
  });

  const handleDocumentDownload = (pdfFileName: string, originalPdfFileName: string) => {
    downloadInvestmentDocument("download", pdfFileName, originalPdfFileName);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportDisbursalRequests();
      toast({
        title: "The disbursal requests list has been exported.",
        duration: 4000
      });
    } catch (err: any) {
      toast({
        title: "Failed to export disbursal requests",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsExporting(false);
    }
  };

  const paginatedData = data?.items || [];
  const totalCount = data?.totalCount || 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = (currentPage - 1) * rowsPerPage + 1;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Disbursal Request
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="relative w-[320px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Investment Name and Email"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
            </div>
            <Button size="sm" className="bg-[#405189] text-white" data-testid="button-export-all" onClick={handleExport} disabled={isExporting}>
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-disbursal-requests">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Investment
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Email</th>
                    <SortHeader field="date" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Disbursement Date
                    </SortHeader>
                    <SortHeader field="amount" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Amount
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment Instruments</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Pitch
                      <br />
                      Deck
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Investment
                      <br />
                      Terms
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Impact
                      <br />
                      Metrics
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap min-w-[200px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading disbursal requests...
                      </td>
                    </tr>
                  ) : paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No disbursal requests found.
                      </td>
                    </tr>
                  ) : (
                    paginatedData.map((entry) => (
                      <Fragment key={entry.id}>
                        <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-disbursal-${entry.id}`}>
                          <td className="px-4 py-3">
                            <Link href={`/raisemoney/edit/${entry.investmentId}`}>
                              <span className="text-sm text-[#405189] underline cursor-pointer" data-testid={`text-disbursal-investment-${entry.id}`}>
                                {entry.name}
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-muted-foreground" data-testid={`text-disbursal-email-${entry.id}`}>
                              {entry.email}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm" data-testid={`text-disbursal-date-${entry.id}`}>
                              {formatDate(entry.receiveDate)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm" data-testid={`text-disbursal-amount-${entry.id}`}>
                              {currency_format(entry.distributedAmount)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
                                entry.status === DisbursalRequestStatus.Pending
                                  ? "bg-[#f7b84b]/10 text-[#f7b84b]"
                                  : entry.status === DisbursalRequestStatus.Cancelled
                                    ? "bg-[#f06548]/10 text-[#f06548]"
                                    : "bg-[#0ab39c]/10 text-[#0ab39c]"
                              )}
                              data-testid={`text-disbursal-status-${entry.id}`}
                            >
                              {entry.status === DisbursalRequestStatus.Completed
                                ? "Completed"
                                : entry.status === DisbursalRequestStatus.Cancelled
                                  ? "Cancelled"
                                  : "Pending"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-muted-foreground max-w-[300px] block" data-testid={`text-disbursal-type-${entry.id}`}>
                              {entry.investmentType}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {entry.pitchDeck && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-[#0ab39c]"
                                data-testid={`button-pitch-deck-${entry.id}`}
                                onClick={() => handleDocumentDownload(entry.pitchDeck!, entry.pitchDeckName || entry.pitchDeck!)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {entry.investmentDocument && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-[#0ab39c]"
                                data-testid={`button-investment-terms-${entry.id}`}
                                onClick={() => handleDocumentDownload(entry.investmentDocument!, entry.investmentDocumentName || entry.investmentDocument!)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {entry.metricsReport && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-[#0ab39c]"
                                data-testid={`button-impact-metrics-${entry.id}`}
                                onClick={() => handleDocumentDownload(entry.metricsReport!, entry.metricsReportName || entry.metricsReport!)}
                              >
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              {entry.status === DisbursalRequestStatus.Pending && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-[#0ab39c] border-[#0ab39c] hover:bg-[#0ab39c]/5 text-[11px] font-bold uppercase transition-colors"
                                      onClick={() => {
                                        setStatusUpdate({ entry, nextStatus: DisbursalRequestStatus.Completed });
                                      }}
                                      data-testid={`button-mark-completed-${entry.id}`}
                                    >
                                      MARK COMPLETED
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Mark as Completed</TooltipContent>
                                </Tooltip>
                              )}
                              {(entry.status === DisbursalRequestStatus.Completed || entry.status === DisbursalRequestStatus.Cancelled) && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-[#f7b84b] border-[#f7b84b] hover:bg-[#f7b84b]/5 text-[11px] font-bold uppercase transition-colors"
                                      onClick={() => {
                                        setStatusUpdate({ entry, nextStatus: DisbursalRequestStatus.Pending });
                                      }}
                                      data-testid={`button-mark-pending-${entry.id}`}
                                    >
                                      MARK PENDING
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Mark as Pending</TooltipContent>
                                </Tooltip>
                              )}
                              {entry.status !== DisbursalRequestStatus.Cancelled && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 px-2 text-[#f06548] border-[#f06548] hover:bg-[#f06548]/5 text-[11px] font-bold uppercase transition-colors"
                                      onClick={() => {
                                        setStatusUpdate({ entry, nextStatus: DisbursalRequestStatus.Cancelled });
                                      }}
                                      data-testid={`button-cancel-${entry.id}`}
                                    >
                                      CANCEL
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Cancel disbursal request</TooltipContent>
                                </Tooltip>
                              )}
                              <div className="inline-flex rounded-md shadow-sm">
                                {entry.hasNotes && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 rounded-r-none border-r-0 text-[#64748b] hover:text-[#405189] hover:bg-[#405189]/5",
                                          expandedRow === entry.id ? "text-[#405189] bg-[#405189]/5 font-bold" : ""
                                        )}
                                        onClick={() => setExpandedRow(expandedRow === entry.id ? null : entry.id)}
                                        data-testid={`button-notes-${entry.id}`}
                                      >
                                        <FileText className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View notes</TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link href={`/disbursal-request-detail/${entry.id}`}>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                          entry.hasNotes ? "rounded-l-none" : "",
                                          authUser?.isSuperAdmin ? "border-r-0 rounded-r-none" : ""
                                        )}
                                        data-testid={`button-disbursal-details-${entry.id}`}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>Disbursal request details</TooltipContent>
                                </Tooltip>
                                {authUser?.isSuperAdmin && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                        onClick={() => openDeleteDialog(entry.id)}
                                        data-testid={`button-delete-${entry.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete disbursal request</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {expandedRow === entry.id && (
                          <tr className="border-b border-border" data-testid={`row-notes-${entry.id}`}>
                            <td colSpan={10} className="p-0">
                              <AdminDisbursalNotes id={entry.id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalCount={totalCount}
              rowsPerPage={rowsPerPage}
              onPageChange={setCurrentPage}
              onRowsPerPageChange={(v) => {
                setRowsPerPage(v);
                setCurrentPage(1);
              }}
              dataTestId="pagination-disbursal-requests"
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={!!statusUpdate}
        onOpenChange={(open) => {
          if (!open) setStatusUpdate(null);
        }}
        title={
          statusUpdate?.nextStatus === DisbursalRequestStatus.Cancelled
            ? "Cancel Disbursal Request?"
            : `Mark Disbursal Request as ${statusUpdate?.nextStatus === DisbursalRequestStatus.Completed ? "Completed" : "Pending"}?`
        }
        description={
          statusUpdate?.nextStatus === DisbursalRequestStatus.Cancelled
            ? "Are you sure you want to cancel this disbursal request?"
            : `Are you sure you want to mark this request as ${statusUpdate?.nextStatus === DisbursalRequestStatus.Completed ? "completed" : "pending"}?`
        }
        onConfirm={handleUpdateStatus}
        isSubmitting={updateStatusMutation.isPending}
        confirmLabel={
          statusUpdate?.nextStatus === DisbursalRequestStatus.Cancelled
            ? "CANCEL REQUEST"
            : statusUpdate?.nextStatus === DisbursalRequestStatus.Completed
              ? "COMPLETE"
              : "PENDING"
        }
        confirmButtonClass={
          statusUpdate?.nextStatus === DisbursalRequestStatus.Cancelled
            ? "bg-[#f06548] text-white hover:bg-[#d0543c]"
            : statusUpdate?.nextStatus === DisbursalRequestStatus.Completed
              ? "bg-[#0ab39c] text-white"
              : "bg-[#f7b84b] text-white"
        }
        dataTestId="dialog-status-update"
      />

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Disbursal Request"
        description="Are you sure you want to delete this disbursal request? This action cannot be undone."
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
