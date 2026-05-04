import { useState, useEffect, Fragment } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchInvestments,
  exportInvestmentsData,
  fetchInvestmentNotes,
  cloneInvestment,
  updateInvestmentStatus,
  deleteInvestment,
  exportInvestmentRecommendations,
  downloadInvestmentDocument,
} from "../api/investment/investmentApi";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Search, Download, Copy, ClipboardCopy, Pencil, Trash2, ChevronLeft, ChevronRight, ChevronDown, Check, FileText, History } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { AuditLogModal } from "../components/AuditLogModal";
import catacapLogo from "@assets/CataCap-Logo.png";
import { getUrlBlobContainerImage } from "@/lib/image-utils";
import { currency_format, formatDate } from "@/helpers/format";

interface NoteEntry {
  date: string;
  username: string;
  from: string;
  to: string;
  note: string;
}

export enum InvestmentStage {
  Private = 1,
  Public = 2,
  Invested = 3,
  Not_Invested = 4,
  New = 5,
  Compliance_Review = 6,
  Ongoing_Completed = 7,
  Vetting = 8,
  Completed_Ongoing_Private = 9,
  CataCap_Portfolio = 10
}

const STAGE_ID_TO_NAME: Record<number, string> = {
  [InvestmentStage.Private]: "Private",
  [InvestmentStage.Public]: "Public",
  [InvestmentStage.Invested]: "Closed - Invested",
  [InvestmentStage.Not_Invested]: "Closed - Not Invested",
  [InvestmentStage.New]: "New",
  [InvestmentStage.Compliance_Review]: "Compliance Review",
  [InvestmentStage.Ongoing_Completed]: "Completed - Ongoing",
  [InvestmentStage.Vetting]: "Vetting",
  [InvestmentStage.Completed_Ongoing_Private]: "Completed - Ongoing/Private",
  [InvestmentStage.CataCap_Portfolio]: "CataCap Portfolio"
};

const STAGE_NAME_TO_ID: Record<string, number> = {
  Private: InvestmentStage.Private,
  Public: InvestmentStage.Public,
  "Closed - Invested": InvestmentStage.Invested,
  "Closed - Not Invested": InvestmentStage.Not_Invested,
  New: InvestmentStage.New,
  "Compliance Review": InvestmentStage.Compliance_Review,
  "Completed - Ongoing": InvestmentStage.Ongoing_Completed,
  Vetting: InvestmentStage.Vetting,
  "Completed - Ongoing/Private": InvestmentStage.Completed_Ongoing_Private,
  "CataCap Portfolio": InvestmentStage.CataCap_Portfolio
};

function getStageName(val: any) {
  if (typeof val === "number" && STAGE_ID_TO_NAME[val]) return STAGE_ID_TO_NAME[val];
  return "-";
}

interface InvestmentData {
  id: number;
  name: string;
  stage: string;
  fundingClose: string;
  catacapFunding: number;
  totalInvestors: number;
  dateCreated: string;
  isActive: boolean;
  hasNotes?: boolean;
  property?: string;
  noteEntries?: NoteEntry[];
  pdfFileName: string;
  originalPdfFileName: string;
  imageFileName: string;
  ownerFullName: string | null;
  ownerEmail: string | null;
}

const stageOptions = ["New", "Compliance Review", "Private", "Public", "Completed - Ongoing", "Closed - Invested", "Closed - Not Invested", "Vetting", "Completed - Ongoing/Private"];

const statusOptions = ["Active", "Inactive", "All"];

type SortField = "name" | "catacapFunding" | "totalInvestors" | "createdDate";

export default function InvestmentsPage() {
  const { hasActionPermission } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";

  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [stageFilterOpen, setStageFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("Active");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>();

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [investments, setInvestments] = useState<InvestmentData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notesData, setNotesData] = useState<Record<number, NoteEntry[]>>({});
  const [loadingNotes, setLoadingNotes] = useState<Record<number, boolean>>({});

  // Download State
  const [downloadingIds, setDownloadingIds] = useState<number[]>([]);

  // Delete Modal State
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Clone Modal State
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
  const [cloneTargetId, setCloneTargetId] = useState<number | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [isCloning, setIsCloning] = useState(false);

  // Audit Log State
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (searchQuery !== debouncedSearch) {
      return;
    }
    loadInvestments();
  }, [effectiveSearch, selectedStages, statusFilter, sortField, sortDir, currentPage, rowsPerPage, searchQuery, debouncedSearch]);

  const loadInvestments = async (setLoader: boolean = true) => {
    setLoader && setIsLoading(true);
    try {
      const response = await fetchInvestments({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField || undefined,
        sortDirection: sortDir || undefined,
        searchValue: effectiveSearch,
        status: statusFilter,
        stages: selectedStages.length > 0
          ? selectedStages.map((s) => STAGE_NAME_TO_ID[s]).filter((n) => n !== undefined).join(",")
          : undefined,
        investmentStatus: statusFilter === "Active" ? true : statusFilter === "Inactive" ? false : undefined
      });
      if (response && response.items) {
        const mappedItems = response.items.map((item: any) => ({
          id: item.id,
          name: item.name || "N/A",
          stage: getStageName(item.stage),
          fundingClose: item.fundraisingCloseDate || "N/A",
          catacapFunding: item.currentBalance || 0,
          totalInvestors: item.numberOfInvestors || 0,
          dateCreated: formatDate(item.createdDate, "N/A"),
          isActive: item.isActive,
          hasNotes: item.hasNotes,
          property: item.property,
          noteEntries: [],
          pdfFileName: item.pdfFileName,
          originalPdfFileName: item.originalPdfFileName,
          imageFileName: item.imageFileName || "",
          ownerFullName: item.ownerFullName || null,
          ownerEmail: item.ownerEmail || null,
        }));
        setInvestments(mappedItems);
        setTotalCount(response.totalCount);
      } else if (Array.isArray(response)) {
        setInvestments(response);
        setTotalCount((response as any).length);
      } else {
        setInvestments([]);
        setTotalCount(0);
      }
    } catch (error) {
      console.error("Failed to fetch investments", error);
      toast({
        title: "Error",
        description: "Failed to load investments. Please refresh the page.",
        variant: "destructive"
      });
    } finally {
      setLoader && setIsLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await exportInvestmentsData();
      toast({
        title: "Export Successful",
        description: "Investments data has been exported successfully."
      });
    } catch (error) {
      console.error("Failed to export investments", error);
      toast({
        title: "Export Failed",
        description: "Failed to export investments. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadDocumentWrapper = async (id: number, pdfFileName: string, originalPdfFileName: string) => {
    if (!pdfFileName || !originalPdfFileName) return;
    setDownloadingIds((prev) => [...prev, id]);
    try {
      await downloadInvestmentDocument("download", pdfFileName, originalPdfFileName);
    } catch (error) {
      console.error("Failed to download document", error);
      toast({
        title: "Error",
        description: "Failed to download document. Please try again.",
        variant: "destructive"
      });
    } finally {
      setDownloadingIds((prev) => prev.filter((dId) => dId !== id));
    }
  };

  const handleToggleNotes = async (id: number) => {
    if (expandedRow === id) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(id);
    if (!notesData[id]) {
      setLoadingNotes((prev) => ({ ...prev, [id]: true }));
      try {
        const notes = await fetchInvestmentNotes(id);
        const mappedNotes = (notes || []).map((n: any) => ({
          date: formatDate(n.createdAt, "N/A"),
          username: n.userName || "N/A",
          from: getStageName(n.oldStatus),
          to: getStageName(n.newStatus),
          note: n.note || "N/A"
        }));
        setNotesData((prev) => ({ ...prev, [id]: mappedNotes }));
      } catch (error) {
        console.error("Failed to fetch notes", error);
        setNotesData((prev) => ({ ...prev, [id]: [] }));
        toast({
          title: "Error",
          description: "Failed to fetch investment notes. Please try again.",
          variant: "destructive"
        });
      } finally {
        setLoadingNotes((prev) => ({ ...prev, [id]: false }));
      }
    }
  };

  const openCloneDialog = (id: number, currentName: string) => {
    setCloneTargetId(id);
    setCloneName(`${currentName} (Clone)`);
    setIsCloneDialogOpen(true);
  };

  const handleCloneSubmit = async () => {
    if (!cloneTargetId || !cloneName.trim()) return;
    setIsCloning(true);
    try {
      await cloneInvestment(cloneTargetId, cloneName);
      setIsCloneDialogOpen(false);
      setCloneTargetId(null);
      setCloneName("");
      loadInvestments();
      toast({
        title: "Investment Cloned",
        description: `"${cloneName}" has been cloned successfully.`
      });
    } catch (error) {
      console.error("Failed to clone investment", error);
      toast({
        title: "Clone Failed",
        description: "Failed to clone the investment. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsCloning(false);
    }
  };

  const openDeleteDialog = (id: number) => {
    setDeleteTargetId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteInvestment(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      loadInvestments();
      toast({
        title: "Investment Deleted",
        description: "The investment has been deleted successfully."
      });
    } catch (error) {
      console.error("Failed to delete investment", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the investment. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopyInvestmentLink = async (identifier: string) => {
    const frontendUrl = import.meta.env.VITE_FRONTEND_URL || "";
    const campaignToUrl = `${frontendUrl}/investments/${identifier}`;
    try {
      await navigator.clipboard.writeText(campaignToUrl);
      toast({
        title: "Success",
        description: "Copied investment link to clipboard!"
      });
    } catch (err) {
      console.error("Failed to copy: ", err);
      toast({
        title: "Error",
        description: "Failed to copy link. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleToggleActive = async (id: number, currentStatus: boolean) => {
    // Optimistically update the UI
    setInvestments((prev) => prev.map((inv) => (inv.id === id ? { ...inv, isActive: !currentStatus } : inv)));

    try {
      await updateInvestmentStatus(id, !currentStatus);
      toast({
        title: "Status Updated",
        description: `Investment has been marked as ${!currentStatus ? "Active" : "Inactive"}.`
      });
      await loadInvestments(false);
    } catch (error) {
      console.error("Failed to update active status", error);
      // Revert fallback on error
      setInvestments((prev) => prev.map((inv) => (inv.id === id ? { ...inv, isActive: currentStatus } : inv)));
      toast({
        title: "Update Failed",
        description: "Failed to update investment status. Please try again.",
        variant: "destructive"
      });
    }
  };

  const openAuditLog = (id: number, name: string) => {
    setAuditTarget({ id: id.toString(), name });
    setIsAuditModalOpen(true);
  };

  const totalPages = Math.ceil(totalCount / rowsPerPage) || 1;
  const paginatedInvestments = investments; // Pagination is handled by the backend
  const startIdx = (currentPage - 1) * rowsPerPage + 1;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Investments
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Search</Label>
                <div className="relative w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSearchQuery(value);
                      if (value.trim()) {
                        setStatusFilter("All");
                      } else {
                        setStatusFilter("Active");
                      }
                      setCurrentPage(1);
                    }}
                    className="pl-9"
                    data-testid="input-search-investments"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter By Stage</Label>
                <Popover open={stageFilterOpen} onOpenChange={setStageFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={stageFilterOpen}
                      className={cn(
                        "flex h-9 w-[300px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal"
                      )}
                      data-testid="select-stage-filter"
                    >
                      <span className="truncate">
                        {selectedStages.length === 0 ? "All Stages" : selectedStages.join(", ")}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0 bg-popover" align="start">
                    <Command className="bg-transparent">
                      <CommandInput placeholder="Search stage..." />
                      <CommandList className="max-h-[264px]">
                        <CommandEmpty>No stage found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            onSelect={() => {
                              if (selectedStages.length === 0) return;
                              setSelectedStages([]);
                              setCurrentPage(1);
                            }}
                            data-testid="stage-filter-option-all"
                          >
                            <Check className={`h-4 w-4 ${selectedStages.length === 0 ? "opacity-100" : "opacity-0"}`} />
                            All Stages
                          </CommandItem>
                          {stageOptions.map((opt) => (
                            <CommandItem
                              key={opt}
                              onSelect={() => {
                                setSelectedStages((prev) =>
                                  prev.includes(opt) ? prev.filter((s) => s !== opt) : [...prev, opt]
                                );
                                setCurrentPage(1);
                              }}
                              data-testid={`stage-filter-option-${opt}`}
                            >
                              <Check
                                className={`h-4 w-4 ${selectedStages.includes(opt) ? "opacity-100" : "opacity-0"}`}
                              />
                              {opt}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button size="sm" className="bg-[#405189] text-white" onClick={handleExport} disabled={isExporting} data-testid="button-export-all">
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-investments">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Image</th>
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Owner
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Stage / Funding Close
                    </th>
                    <SortHeader field="catacapFunding" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      CataCap Funding
                    </SortHeader>
                    <SortHeader field="totalInvestors" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Total Investors
                    </SortHeader>
                    <SortHeader field="createdDate" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Date Created
                    </SortHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Is Active</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                        Loading investments...
                      </td>
                    </tr>
                  ) : paginatedInvestments.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                        No investments found.
                      </td>
                    </tr>
                  ) : (
                    paginatedInvestments.map((inv) => (
                      <Fragment key={inv.id}>
                        <tr className="border-b last:border-b-0 odd:bg-card even:bg-muted/30 hover:bg-muted/20 transition-colors" data-testid={`row-investment-${inv.id}`}>
                          <td className="px-4 py-3">
                            <div className="h-12 w-16 flex items-center justify-center" data-testid={`img-investment-${inv.id}`}>
                              <img src={getUrlBlobContainerImage(inv.imageFileName)} alt={inv.name} className="max-h-12 max-w-16 object-contain" />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-medium" data-testid={`text-name-${inv.id}`}>
                              {inv.name}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {(inv.ownerFullName || inv.ownerEmail) ? (
                              <div className="text-sm" data-testid={`text-owner-${inv.id}`}>
                                {inv.ownerFullName && (
                                  <div className="font-medium">{inv.ownerFullName}</div>
                                )}
                                {inv.ownerEmail && (
                                  <div className="text-xs text-muted-foreground">{inv.ownerEmail}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground" data-testid={`text-owner-${inv.id}`}>—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm" data-testid={`text-stage-${inv.id}`}>
                              <div className="font-medium">{inv.stage}</div>
                              <div className="text-xs text-muted-foreground">
                                {!inv.fundingClose || inv.fundingClose === "N/A" ? inv.fundingClose : formatDate(inv.fundingClose)}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {inv.catacapFunding > 0 ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/investments/${inv.id}/investors`)}
                                className="text-sm text-[#405189] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#405189] rounded-sm"
                                title="View investors"
                                data-testid={`button-funding-${inv.id}`}
                              >
                                {currency_format(inv.catacapFunding)}
                              </button>
                            ) : (
                              <span className="text-sm" data-testid={`text-funding-${inv.id}`}>
                                {currency_format(inv.catacapFunding)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {inv.totalInvestors > 0 ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/investments/${inv.id}/investors`)}
                                className="text-sm text-[#405189] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#405189] rounded-sm"
                                title="View investor breakdown"
                                data-testid={`button-investors-${inv.id}`}
                              >
                                {inv.totalInvestors}
                              </button>
                            ) : (
                              <span className="text-sm" data-testid={`text-investors-${inv.id}`}>
                                {inv.totalInvestors}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm" data-testid={`text-date-${inv.id}`}>
                              {inv.dateCreated}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center">
                              <Checkbox
                                checked={inv.isActive}
                                onCheckedChange={() => handleToggleActive(inv.id, inv.isActive)}
                                className="data-[state=checked]:bg-[#405189] data-[state=checked]:border-[#405189]"
                                data-testid={`checkbox-active-${inv.id}`}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end">
                              <div className="inline-flex rounded-md shadow-sm">
                                {inv.hasNotes && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 rounded-r-none border-r-0 text-[#64748b] hover:text-[#405189] hover:bg-[#405189]/5",
                                          expandedRow === inv.id ? "text-[#405189] bg-[#405189]/5" : ""
                                        )}
                                        onClick={() => handleToggleNotes(inv.id)}
                                        data-testid={`button-notes-${inv.id}`}
                                      >
                                        <FileText className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View notes</TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className={cn(
                                        "h-8 w-8 rounded-none border-r-0 text-[#64748b] hover:text-[#405189] hover:bg-[#405189]/5",
                                        !inv.hasNotes && "rounded-l-md"
                                      )}
                                      onClick={() => handleCopyInvestmentLink(inv.property ?? inv.id.toString())}
                                      data-testid={`button-copy-${inv.id}`}
                                    >
                                      <ClipboardCopy className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Copy investment link</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                      onClick={() => openAuditLog(inv.id, inv.name)}
                                      data-testid={`button-audit-${inv.id}`}
                                    >
                                      <History className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View audit logs</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-none border-r-0 text-[#64748b] hover:text-[#405189] hover:bg-[#405189]/5"
                                      onClick={() => openCloneDialog(inv.id, inv.name)}
                                      data-testid={`button-clone-${inv.id}`}
                                    >
                                      <Copy className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Clone investment</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className={cn(
                                        "h-8 w-8 rounded-none border-r-0 text-[#64748b] hover:text-[#405189] hover:bg-[#405189]/5",
                                        (downloadingIds.includes(inv.id) || !inv.pdfFileName) && "opacity-30"
                                      )}
                                      disabled={downloadingIds.includes(inv.id) || !inv.pdfFileName}
                                      onClick={() => handleDownloadDocumentWrapper(inv.id, inv.pdfFileName, inv.originalPdfFileName ? inv.originalPdfFileName : inv.pdfFileName)}
                                      data-testid={`button-download-${inv.id}`}
                                    >
                                      <Download className={cn("h-4 w-4", downloadingIds.includes(inv.id) ? "animate-pulse text-[#405189]" : "")} />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{!inv.pdfFileName ? "Investment data not available" : "Download investment data"}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className={cn(
                                        "h-8 w-8 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5",
                                        hasActionPermission("investment", "delete") ? "rounded-none border-r-0" : "rounded-l-none rounded-r-md"
                                      )}
                                      onClick={() => {
                                        navigate(`/raisemoney/edit/${inv.property || inv.id}?id=${inv.id}`);
                                      }}
                                      data-testid={`button-edit-${inv.id}`}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit investment</TooltipContent>
                                </Tooltip>
                                {hasActionPermission("investment", "delete") && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-l-none rounded-r-md text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                        onClick={() => openDeleteDialog(inv.id)}
                                        data-testid={`button-delete-${inv.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete investment</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {expandedRow === inv.id && (
                          <tr className="border-b" data-testid={`row-notes-${inv.id}`}>
                            <td colSpan={9} className="p-4 bg-muted/30">
                              <div className="overflow-x-auto rounded-lg border shadow-sm">
                                <table className="w-full" data-testid={`table-notes-${inv.id}`}>
                                  <thead>
                                    <tr className="bg-[#405189]">
                                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Date</th>
                                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Username</th>
                                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">From</th>
                                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">To</th>
                                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Note</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {loadingNotes[inv.id] ? (
                                      <tr>
                                        <td colSpan={5} className="px-4 py-8 text-sm text-muted-foreground text-center bg-white dark:bg-background">
                                          Loading notes...
                                        </td>
                                      </tr>
                                    ) : notesData[inv.id] && notesData[inv.id].length > 0 ? (
                                      notesData[inv.id].map((entry, idx) => (
                                        <tr key={idx} className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-card" : "bg-muted/30"}`}>
                                          <td className="px-4 py-3 text-sm">{entry.date}</td>
                                          <td className="px-4 py-3 text-sm">{entry.username}</td>
                                          <td className="px-4 py-3 text-sm">{entry.from}</td>
                                          <td className="px-4 py-3 text-sm">{entry.to}</td>
                                          <td className="px-4 py-3 text-sm min-w-[300px]">
                                            <span dangerouslySetInnerHTML={{ __html: entry.note }} />
                                          </td>
                                        </tr>
                                      ))
                                    ) : (
                                      <tr>
                                        <td colSpan={5} className="px-4 py-8 text-sm text-muted-foreground text-center bg-white dark:bg-background">
                                          No notes available for this investment.
                                        </td>
                                      </tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
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
              dataTestId="pagination-investments"
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={isCloneDialogOpen}
        onOpenChange={(open) => {
          setIsCloneDialogOpen(open);
          if (!open) {
            setCloneTargetId(null);
            setCloneName("");
          }
        }}
        title="Clone Investment"
        description="Enter a name for the cloned investment."
        confirmLabel="Clone"
        cancelLabel="Cancel"
        onConfirm={handleCloneSubmit}
        isSubmitting={isCloning}
        dataTestId="dialog-clone"
      >
        <div className="py-2">
          <Label htmlFor="cloneName" className="text-right">
            New Investment Name
          </Label>
          <Input id="cloneName" value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="mt-2" placeholder="Investment Name" data-testid="input-clone-name" />
        </div>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Investment"
        description="Are you sure you want to delete this investment? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
        dataTestId="dialog-delete"
      />

      <AuditLogModal
        isOpen={isAuditModalOpen}
        onOpenChange={setIsAuditModalOpen}
        entityId={auditTarget?.id || ""}
        entityType="campaigns"
        title={`Audit Logs - ${auditTarget?.name}`}
      />

    </AdminLayout>
  );
}
