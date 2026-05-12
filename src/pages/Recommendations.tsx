import { useState, useRef, useEffect, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "../components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, Check, X, Download, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSort } from "../hooks/useSort";

import { fetchRecommendations, updateRecommendation, exportRecommendations, deleteRecommendation, RecommendationEntry, fetchInvestmentNames, InvestmentOption } from "../api/recommendation/recommendationApi";
import { currency_format, formatDate } from "../helpers/format";
import { SortHeader } from "@/components/ui/table-sort";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { PaginationControls } from "@/components/ui/pagination-controls";

const STATUS_OPTIONS = ["Pending", "Approved", "Rejected"] as const;
type RecommendationStatus = (typeof STATUS_OPTIONS)[number];

type SortField = "id" | "userFullName" | "campaignName" | "amount" | "dateCreated" | "status";

export default function RecommendationsPage() {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>();

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [tempRecommendationStatus, setTempRecommendationStatus] = useState<(RecommendationStatus | "All")[]>(["All"]);
  const [recommendationStatus, setRecommendationStatus] = useState<RecommendationStatus[]>([...STATUS_OPTIONS]);

  const handleStatusChange = (value: string) => {
    let newTempStatus: (RecommendationStatus | "All")[];

    if (value === "All") {
      if (tempRecommendationStatus.includes("All")) {
        return;
      }
      newTempStatus = ["All"];
    } else {
      const current = tempRecommendationStatus.filter((s) => s !== "All") as RecommendationStatus[];
      const isSelected = current.includes(value as RecommendationStatus);
      let parsed: RecommendationStatus[];
      if (isSelected) {
        parsed = current.filter((s) => s !== value);
      } else {
        parsed = [...current, value as RecommendationStatus];
      }
      newTempStatus = parsed.length === STATUS_OPTIONS.length ? ["All"] : parsed.length > 0 ? parsed : ["All"];
    }

    setTempRecommendationStatus(newTempStatus);

    const newStatus = newTempStatus.includes("All") ? [...STATUS_OPTIONS] : (newTempStatus as RecommendationStatus[]);

    setRecommendationStatus(newStatus);
    setCurrentPage(1);
  };

  const [selectedInvestmentIds, setSelectedInvestmentIds] = useState<number[]>([]);
  const [investmentPopoverOpen, setInvestmentPopoverOpen] = useState(false);
  const [investmentSearchQuery, setInvestmentSearchQuery] = useState("");
  const investmentListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (investmentListRef.current) {
      investmentListRef.current.scrollTop = 0;
    }
  }, [investmentSearchQuery, investmentPopoverOpen]);

  const { data: investmentOptions = [] } = useQuery({
    queryKey: ["investmentNames"],
    queryFn: fetchInvestmentNames,
    staleTime: 0,
    gcTime: 0
  });

  const {
    data: queryData,
    isLoading,
    error
  } = useQuery({
    queryKey: ["recommendations", currentPage, rowsPerPage, sortField, sortDir, recommendationStatus, selectedInvestmentIds],
    queryFn: () =>
      fetchRecommendations({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        status: recommendationStatus.length < STATUS_OPTIONS.length ? recommendationStatus.join(",") : undefined,
        investmentId: selectedInvestmentIds.length > 0 ? selectedInvestmentIds.join(",") : undefined
      }),
    staleTime: 0,
    gcTime: 0
  });

  const data = queryData?.items ?? [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);
  const approved = queryData?.approved ?? 0;
  const pending = queryData?.pending ?? 0;
  const total = queryData?.total ?? 0;

  const pendingTotal = pending;
  const approvedTotal = approved;
  const totalRecommendations = total;

  const [isSubmitting, setIsSubmitting] = useState(false);
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
      await deleteRecommendation(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      toast({
        title: "Recommendation Deleted",
        description: "The recommendation has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete recommendation", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the recommendation. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<RecommendationEntry | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<RecommendationEntry | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectDetailsTarget, setRejectDetailsTarget] = useState<RecommendationEntry | null>(null);

  const REJECT_REASON_PREVIEW_LENGTH = 100;
  const { toast } = useToast();

  const openApproveDialog = (rec: RecommendationEntry) => {
    setApproveTarget(rec);
    setApproveDialogOpen(true);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    setIsSubmitting(true);
    try {
      const res = await updateRecommendation({
        id: approveTarget.id,
        userEmail: approveTarget.userEmail,
        userFullName: approveTarget.userFullName,
        campaignId: approveTarget.campaignId,
        campaignName: approveTarget.campaignName,
        status: "approved",
        amount: approveTarget.amount,
        dateCreated: approveTarget.dateCreated,
        rejectionMemo: ""
      });
      if (res.success) {
        toast({
          title: res.message || "The recommendation has been successfully approved.",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      } else {
        toast({
          title: res.message || "Failed to approve recommendation",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Failed to approve recommendation",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
      setApproveDialogOpen(false);
      setApproveTarget(null);
    }
  };

  const openRejectDialog = (rec: RecommendationEntry) => {
    setRejectTarget(rec);
    setRejectReason("");
    setRejectDialogOpen(true);
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast({
        title: "Please include the reason for the rejection.",
        variant: "destructive",
        duration: 4000
      });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await updateRecommendation({
        id: rejectTarget.id,
        userEmail: rejectTarget.userEmail,
        userFullName: rejectTarget.userFullName,
        campaignId: rejectTarget.campaignId,
        campaignName: rejectTarget.campaignName,
        status: "rejected",
        amount: rejectTarget.amount,
        dateCreated: rejectTarget.dateCreated,
        rejectionMemo: rejectReason.trim()
      });
      if (res.success) {
        toast({
          title: res.message || "The recommendation has been rejected.",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      } else {
        toast({
          title: res.message || "Failed to reject recommendation",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Failed to reject recommendation",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
      setRejectDialogOpen(false);
      setRejectTarget(null);
      setRejectReason("");
    }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      await exportRecommendations();
      toast({
        title: "The recommendations list has been exported.",
        duration: 4000
      });
    } catch (error) {
      console.error("Error exporting recommendations", error);
      toast({
        title: "Failed to export recommendations",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Recommendations
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Select Investment</Label>
                <Popover open={investmentPopoverOpen} onOpenChange={(open) => {
                  setInvestmentPopoverOpen(open);
                  if (!open) {
                    setInvestmentSearchQuery("");
                  }
                }}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={investmentPopoverOpen}
                      className={cn(
                        "flex h-9 w-[300px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                        selectedInvestmentIds.length === 0 && "text-muted-foreground"
                      )}
                      data-testid="select-investment"
                    >
                      <span className="truncate">
                        {selectedInvestmentIds.length === 0
                          ? "All"
                          : investmentOptions
                              .filter((opt) => selectedInvestmentIds.includes(opt.id))
                              .map((opt) => opt.name)
                              .join(", ")}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0 bg-popover" align="start">
                    <Command
                      className="bg-transparent"
                      filter={(value, search) => {
                        const normalizedSearch = search.trim().toLowerCase();
                        if (!normalizedSearch) return 1;
                        return value.toLowerCase().includes(normalizedSearch) ? 1 : 0;
                      }}
                    >
                      <CommandInput
                        placeholder="Search investment..."
                        value={investmentSearchQuery}
                        onValueChange={setInvestmentSearchQuery}
                      />
                      <div
                        role="option"
                        aria-selected={selectedInvestmentIds.length === 0}
                        onClick={() => {
                          setSelectedInvestmentIds([]);
                          setCurrentPage(1);
                        }}
                        className="relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 mx-1 my-1 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
                        data-testid="option-all-investments"
                      >
                        <Check className={`h-4 w-4 ${selectedInvestmentIds.length === 0 ? "opacity-100" : "opacity-0"}`} />
                        All Investments
                      </div>
                      <CommandList ref={investmentListRef} className="max-h-[264px]">
                        <CommandEmpty>No investment found.</CommandEmpty>
                        <CommandGroup>
                          {investmentOptions.map((opt) => (
                            <CommandItem
                              key={opt.id}
                              value={`${opt.name} __${opt.id}`}
                              onSelect={() => {
                                setSelectedInvestmentIds((prev) => {
                                  const isSelected = prev.includes(opt.id);
                                  let next: number[];
                                  if (isSelected) {
                                    next = prev.filter((id) => id !== opt.id);
                                  } else {
                                    next = [...prev, opt.id];
                                  }
                                  if (next.length === investmentOptions.length) {
                                    return [];
                                  }
                                  return next;
                                });
                                setCurrentPage(1);
                              }}
                            >
                              <Check className={`h-4 w-4 ${selectedInvestmentIds.includes(opt.id) ? "opacity-100" : "opacity-0"}`} />
                              {opt.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter By Status</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "flex h-9 w-[200px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal"
                      )}
                      data-testid="select-status-filter"
                    >
                      {tempRecommendationStatus.includes("All") ? "All" : tempRecommendationStatus.join(", ")}
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-2 bg-popover" align="start">
                    <div className="flex flex-col gap-0.5 bg-transparent">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm" onClick={() => handleStatusChange("All")}>
                        <Check className={cn("h-4 w-4", tempRecommendationStatus.includes("All") ? "opacity-100" : "opacity-0")} />
                        All
                      </div>
                      {STATUS_OPTIONS.map((status) => (
                        <div key={status} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm" onClick={() => handleStatusChange(status)}>
                          <Check className={cn("h-4 w-4", tempRecommendationStatus.includes("All") || tempRecommendationStatus.includes(status) ? "opacity-100" : "opacity-0")} />
                          {status}
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <Button size="sm" className="bg-[#405189] text-white" data-testid="button-export-all" onClick={handleExportAll} disabled={isExporting}>
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-6 py-4 border-b">
              <div data-testid="card-pending-total">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Pending Recommendations</p>
                <p className="text-lg font-semibold mt-0.5" data-testid="text-pending-total">
                  {currency_format(pendingTotal)}
                </p>
              </div>
              <div data-testid="card-approved-total">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Approved Recommendations</p>
                <p className="text-lg font-semibold mt-0.5" data-testid="text-approved-total">
                  {currency_format(approvedTotal)}
                </p>
              </div>
              <div data-testid="card-total-recommendations">
                <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Total Recommendations</p>
                <p className="text-lg font-semibold mt-0.5" data-testid="text-total-recommendations">
                  {currency_format(totalRecommendations)}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-recommendations">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="id" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      ID
                    </SortHeader>
                    <SortHeader field="userFullName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      User Full Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">User Email</th>
                    <SortHeader field="campaignName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Investment Name
                    </SortHeader>
                    <SortHeader field="amount" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Amount
                    </SortHeader>
                    <SortHeader field="dateCreated" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Date Created
                    </SortHeader>
                    <SortHeader field="status" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Status
                    </SortHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading && error && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-destructive">
                        {error?.message || "Failed to load data"}
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && data.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No records found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    !error &&
                    data.map((rec, idx) => (
                      <tr key={rec.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-recommendation-${rec.id}`}>
                        <td className="px-4 py-3 text-sm text-muted-foreground" data-testid={`text-row-number-${rec.id}`}>
                          {rec.id}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-fullname-${rec.id}`}>
                            {rec.userFullName}
                            {rec.isMatch ? " - Match" : ""}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-muted-foreground" data-testid={`text-email-${rec.id}`}>
                            {rec.userEmail}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-investment-${rec.id}`}>
                            {rec.campaignName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-amount-${rec.id}`}>
                            {currency_format(rec.amount)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-date-${rec.id}`}>
                            {formatDate(rec.dateCreated)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={`no-default-hover-elevate no-default-active-elevate border-0 capitalize ${rec.status === "approved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : rec.status === "rejected" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
                            data-testid={`text-status-${rec.id}`}
                          >
                            {rec.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {rec.status === "pending" ? (
                            <div className="flex items-center justify-center">
                              <div className="inline-flex rounded-md shadow-sm">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-r-none border-r-0 text-[#22c55e] hover:text-[#22c55e] hover:bg-[#22c55e]/5"
                                      onClick={() => openApproveDialog(rec)}
                                      data-testid={`button-approve-${rec.id}`}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Approve recommendation</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className={cn(
                                        "h-8 w-8 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5",
                                        authUser?.isSuperAdmin ? "rounded-none border-r-0" : "rounded-l-none"
                                      )}
                                      onClick={() => openRejectDialog(rec)}
                                      data-testid={`button-reject-${rec.id}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Reject recommendation</TooltipContent>
                                </Tooltip>
                                {authUser?.isSuperAdmin && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                        onClick={() => openDeleteDialog(rec.id)}
                                        data-testid={`button-delete-${rec.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete recommendation</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                          ) : rec.status === "rejected" ? (
                            <div className="flex flex-col items-center gap-1">
                              <div className="max-w-[280px] text-xs text-muted-foreground mx-auto" data-testid={`text-reject-info-${rec.id}`}>
                                {rec.rejectionMemo && (
                                  <p>
                                    <strong>Reason:</strong>{" "}
                                    {rec.rejectionMemo.length > REJECT_REASON_PREVIEW_LENGTH
                                      ? rec.rejectionMemo.substring(0, REJECT_REASON_PREVIEW_LENGTH) + "..."
                                      : rec.rejectionMemo}
                                    {rec.rejectionMemo.length > REJECT_REASON_PREVIEW_LENGTH && (
                                      <>
                                        {" "}
                                        <button
                                          type="button"
                                          onClick={() => setRejectDetailsTarget(rec)}
                                          className="text-[#405189] underline hover:no-underline"
                                          data-testid={`button-show-more-reject-${rec.id}`}
                                        >
                                          Show More
                                        </button>
                                      </>
                                    )}
                                  </p>
                                )}
                                {rec.rejectedBy && (
                                  <p>
                                    <strong>Rejected by:</strong> {rec.rejectedBy}
                                  </p>
                                )}
                              </div>
                              {authUser?.isSuperAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button size="icon" variant="outline" className="h-7 w-7 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5" onClick={() => openDeleteDialog(rec.id)} data-testid={`button-delete-${rec.id}`}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete recommendation</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          ) : authUser?.isSuperAdmin ? (
                            <div className="flex items-center justify-center">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="icon" variant="outline" className="h-7 w-7 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5" onClick={() => openDeleteDialog(rec.id)} data-testid={`button-delete-${rec.id}`}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete recommendation</TooltipContent>
                              </Tooltip>
                            </div>
                          ) : null}
                        </td>
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
              onRowsPerPageChange={(v) => {
                setRowsPerPage(v);
                setCurrentPage(1);
              }}
              dataTestId="pagination-recommendations"
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={approveDialogOpen}
        onOpenChange={(open) => {
          setApproveDialogOpen(open);
          if (!open) setApproveTarget(null);
        }}
        title="Do you want to accept recommendation?"
        onConfirm={confirmApprove}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#405189] text-white"
        dataTestId="dialog-approve"
      />

      <ConfirmationDialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) {
            setRejectReason("");
            setRejectTarget(null);
          }
        }}
        title="Do you want to reject this recommendation?"
        noteLabel="Please include the reason for the rejection"
        noteValue={rejectReason}
        onNoteChange={setRejectReason}
        onConfirm={confirmReject}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#405189] text-white"
        dataTestId="dialog-reject"
      />

      <Dialog
        open={!!rejectDetailsTarget}
        onOpenChange={(open) => {
          if (!open) setRejectDetailsTarget(null);
        }}
      >
        <DialogContent
          className="sm:max-w-[560px]"
          data-testid={rejectDetailsTarget ? `dialog-reject-details-${rejectDetailsTarget.id}` : undefined}
        >
          <div className="text-base font-semibold py-2">Rejection Details</div>
          {rejectDetailsTarget && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <span className="text-muted-foreground">User:</span>
                <span className="min-w-0 break-words" data-testid="text-reject-details-user">
                  {rejectDetailsTarget.userFullName}
                  {rejectDetailsTarget.userEmail ? ` (${rejectDetailsTarget.userEmail})` : ""}
                </span>
                <span className="text-muted-foreground">Investment:</span>
                <span className="min-w-0 break-words" data-testid="text-reject-details-investment">{rejectDetailsTarget.campaignName}</span>
                {rejectDetailsTarget.rejectedBy && (
                  <>
                    <span className="text-muted-foreground">Rejected by:</span>
                    <span className="min-w-0 break-words" data-testid="text-reject-details-by">{rejectDetailsTarget.rejectedBy}</span>
                  </>
                )}
              </div>
              <div>
                <p className="text-muted-foreground mb-1">Reason:</p>
                <div
                  className="max-h-[300px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm"
                  data-testid="text-reject-details-reason"
                >
                  {rejectDetailsTarget.rejectionMemo}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => setRejectDetailsTarget(null)}
              data-testid="button-reject-details-close"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Recommendation"
        description="Are you sure you want to delete this recommendation? This action cannot be undone."
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
