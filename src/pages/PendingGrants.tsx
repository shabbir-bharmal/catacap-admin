import { useState, useMemo, useEffect, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Download, ChevronLeft, ChevronRight, ChevronDown, FileText, Ban, SendHorizonal, X, Loader2, Trash2, ListFilter, Check, Paperclip } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPendingGrants, updatePendingGrant, exportPendingGrants, fetchPendingGrantNotes, deletePendingGrant, fetchDafProviders, PendingGrantEntry, NoteEntry } from "../api/pending-grant/pendingGrantApi";
import { AttachmentsPicker, SelectedAttachment } from "../components/AttachmentsPicker";
import { currency_format, formatDate } from "../helpers/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

type SortField = "fullName" | "amount" | "status" | "daysCount" | "createdDate";

const STATUS_OPTIONS = ["Pending", "In Transit", "Received", "Rejected"];

function PendingGrantNotes({ grantId }: { grantId: number }) {
  const {
    data: notes,
    isLoading,
    error
  } = useQuery({
    queryKey: ["pendingGrantNotes", grantId],
    queryFn: () => fetchPendingGrantNotes(grantId),
    staleTime: 0,
    gcTime: 0
  });

  if (isLoading) {
    return <div className="px-4 py-8 text-center text-sm text-muted-foreground whitespace-normal">Loading notes...</div>;
  }

  if (error) {
    return <div className="px-4 py-8 text-center text-sm text-destructive whitespace-normal">Failed to load notes: {(error as Error).message}</div>;
  }

  return (
    <div className="p-4 bg-muted/30">
      <div className="overflow-x-auto rounded-lg border shadow-sm bg-card">
        <table className="w-full" data-testid={`table-notes-${grantId}`}>
          <thead>
            <tr className="bg-[#405189]">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">User Name</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Old Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">New Status</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Note</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-white uppercase tracking-wider whitespace-nowrap">Attachments</th>
            </tr>
          </thead>
          <tbody>
            {notes && notes.length > 0 ? (
              notes.map((entry: NoteEntry, idx: number) => (
                <tr key={idx} className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-card" : "bg-muted/30"}`} data-testid={`row-note-entry-${grantId}-${idx}`}>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-date-${grantId}-${idx}`}>
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-username-${grantId}-${idx}`}>
                    {entry.userName}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-old-status-${grantId}-${idx}`}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${entry.oldStatus === entry.newStatus ? "bg-[#2185d0]/10 text-[#2185d0]" : "bg-[#f7b84b]/10 text-[#f7b84b]"}`}>
                      {entry.oldStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-new-status-${grantId}-${idx}`}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${entry.oldStatus === entry.newStatus ? "bg-[#2185d0]/10 text-[#2185d0]" : "bg-[#0ab39c]/10 text-[#0ab39c]"}`}>
                      {entry.newStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-note-${grantId}-${idx}`}>
                    {entry.note}
                  </td>
                  <td className="px-4 py-3 text-sm align-top max-w-[260px]" data-testid={`text-note-attachments-${grantId}-${idx}`}>
                    {entry.attachments && entry.attachments.length > 0 ? (
                      <ul className="space-y-1">
                        {entry.attachments.map((att, ai) => (
                          <li key={att.id} className="flex items-center gap-1.5 min-w-0">
                            <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                            {att.url ? (
                              <a
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#405189] hover:underline truncate"
                                title={att.fileName}
                                data-testid={`link-note-attachment-${grantId}-${idx}-${ai}`}
                              >
                                {att.fileName}
                              </a>
                            ) : (
                              <span className="truncate" title={att.fileName}>{att.fileName}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-sm text-muted-foreground text-center bg-white dark:bg-background">
                  No notes available for this grant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const getStatusClasses = (status: string) => {
  switch (status) {
    case "Pending":
      return "bg-[#f7b84b]/10 text-[#f7b84b]";
    case "In Transit":
      return "bg-[#2185d0]/10 text-[#2185d0]";
    case "Received":
      return "bg-[#0ab39c]/10 text-[#0ab39c]";
    case "Rejected":
      return "bg-[#f06548]/10 text-[#f06548]";
    default:
      return "bg-muted text-muted-foreground";
  }
};

export default function AdminPendingGrants() {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const [tempSelectedStatuses, setTempSelectedStatuses] = useState<(string | "All")[]>(["Pending", "In Transit"]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["Pending", "In Transit"]);
  const [tempSelectedDafProviders, setTempSelectedDafProviders] = useState<(string | "All")[]>(["All"]);
  const [selectedDafProviders, setSelectedDafProviders] = useState<string[]>([]);
  const [dafProviderPopoverOpen, setDafProviderPopoverOpen] = useState(false);
  const [foundationGrantsOnly, setFoundationGrantsOnly] = useState(false);
  const [savedDafProviderSelection, setSavedDafProviderSelection] = useState<{
    temp: (string | "All")[];
    selected: string[];
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { data: dafProviders = [] } = useQuery({
    queryKey: ["daf-providers"],
    queryFn: fetchDafProviders,
  });
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>();

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<PendingGrantEntry | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectAttachments, setRejectAttachments] = useState<SelectedAttachment[]>([]);

  const [transitDialogOpen, setTransitDialogOpen] = useState(false);
  const [transitTarget, setTransitTarget] = useState<PendingGrantEntry | null>(null);
  const [transitNote, setTransitNote] = useState("");
  const [transitAttachments, setTransitAttachments] = useState<SelectedAttachment[]>([]);

  const [receivedDialogOpen, setReceivedDialogOpen] = useState(false);
  const [receivedTarget, setReceivedTarget] = useState<PendingGrantEntry | null>(null);
  const [receivedNote, setReceivedNote] = useState("");
  const [receivedAttachments, setReceivedAttachments] = useState<SelectedAttachment[]>([]);

  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<PendingGrantEntry | null>(null);
  const [followUpNote, setFollowUpNote] = useState("");
  const [followUpAttachments, setFollowUpAttachments] = useState<SelectedAttachment[]>([]);

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
      await deletePendingGrant(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["pendingGrants"] });
      toast({
        title: "Pending Grant Deleted",
        description: "The pending grant has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete pending grant", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the pending grant. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const statusFilterValue = selectedStatuses.length === STATUS_OPTIONS.length || selectedStatuses.length === 0 ? "All" : selectedStatuses.join(",");

  const toggleStatus = (value: string) => {
    let newTempStatus: (string | "All")[];

    if (value === "All") {
      if (tempSelectedStatuses.includes("All")) {
        return;
      }
      newTempStatus = ["All"];
    } else {
      const current = tempSelectedStatuses.filter((s) => s !== "All");
      const isSelected = current.includes(value);
      let parsed: string[];
      if (isSelected) {
        parsed = current.filter((s) => s !== value);
      } else {
        parsed = [...current, value];
      }
      newTempStatus = parsed.length === STATUS_OPTIONS.length ? ["All"] : parsed.length > 0 ? parsed : ["All"];
    }

    setTempSelectedStatuses(newTempStatus);

    const newStatus = newTempStatus.includes("All") ? [] : (newTempStatus as string[]);

    setSelectedStatuses(newStatus);
    setCurrentPage(1);
  };

  const sortedDafProviders = useMemo(() => {
    return [...dafProviders].sort((a, b) => a.value.localeCompare(b.value));
  }, [dafProviders]);

  const dafProviderFilterValue = selectedDafProviders.length === sortedDafProviders.length || selectedDafProviders.length === 0 ? "All" : selectedDafProviders.join(",");

  const toggleDafProvider = (value: string) => {
    let newTempDaf: (string | "All")[];

    if (value === "All") {
      if (tempSelectedDafProviders.includes("All")) {
        return;
      }
      newTempDaf = ["All"];
    } else {
      const current = tempSelectedDafProviders.filter((d) => d !== "All");
      const isSelected = current.includes(value);
      let parsed: string[];
      if (isSelected) {
        parsed = current.filter((d) => d !== value);
      } else {
        parsed = [...current, value];
      }
      newTempDaf = parsed.length === sortedDafProviders.length ? ["All"] : parsed.length > 0 ? parsed : ["All"];
    }

    setTempSelectedDafProviders(newTempDaf);

    const newDaf = newTempDaf.includes("All") ? [] : (newTempDaf as string[]);

    setSelectedDafProviders(newDaf);
    setCurrentPage(1);
  };

  const {
    data: queryData,
    isLoading,
    error
  } = useQuery({
    queryKey: ["pendingGrants", currentPage, rowsPerPage, sortField, sortDir, statusFilterValue, dafProviderFilterValue, effectiveSearch, foundationGrantsOnly],
    queryFn: () =>
      fetchPendingGrants({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        status: statusFilterValue,
        dafProvider: foundationGrantsOnly ? "All" : dafProviderFilterValue,
        searchValue: effectiveSearch.trim() || undefined,
        foundationGrantsOnly: foundationGrantsOnly || undefined,
      }),
    staleTime: 0,
    gcTime: 0
  });

  const paginatedData = queryData?.items ?? [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  const onUpdateStatus = async (
    id: number,
    status: string,
    note: string,
    attachments: SelectedAttachment[] = []
  ) => {
    setIsSubmitting(true);
    try {
      const res = await updatePendingGrant({
        id,
        status,
        note,
        noteEmail: [],
        attachments: attachments.map((a) => ({
          fileName: a.fileName,
          mimeType: a.mimeType,
          base64Data: a.base64Data,
        })),
      });
      if (res.success) {
        toast({
          title: res.message || "Status updated successfully",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["pendingGrants"] });
        queryClient.invalidateQueries({ queryKey: ["pendingGrantNotes", id] });
        setRejectDialogOpen(false);
        setTransitDialogOpen(false);
        setReceivedDialogOpen(false);
        setFollowUpDialogOpen(false);
        setRejectNote("");
        setTransitNote("");
        setReceivedNote("");
        setFollowUpNote("");
        setRejectAttachments([]);
        setTransitAttachments([]);
        setReceivedAttachments([]);
        setFollowUpAttachments([]);
        setRejectTarget(null);
        setTransitTarget(null);
        setReceivedTarget(null);
        setFollowUpTarget(null);
      } else {
        toast({
          title: res.message || "Failed to update status",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (err: any) {
      toast({
        title: err.message || "An error occurred",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportPendingGrants();
      toast({
        title: "The pending grants list has been exported.",
        duration: 4000
      });
    } catch (err: any) {
      toast({
        title: "Failed to export pending grants",
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
          Pending Grants
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Name, Email"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-8 h-9 w-[300px]"
                    data-testid="input-search-grants"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">DAF Provider</Label>
                <Popover
                  open={dafProviderPopoverOpen && !foundationGrantsOnly}
                  onOpenChange={(open) => {
                    if (foundationGrantsOnly) return;
                    setDafProviderPopoverOpen(open);
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={dafProviderPopoverOpen && !foundationGrantsOnly}
                      disabled={foundationGrantsOnly}
                      className={cn(
                        "flex h-9 w-[300px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal",
                        tempSelectedDafProviders.includes("All") && "text-muted-foreground"
                      )}
                      data-testid="select-daf-provider-filter"
                    >
                      <span className="truncate">
                        {tempSelectedDafProviders.includes("All") ? "All Providers" : tempSelectedDafProviders.join(", ")}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0 bg-popover" align="start">
                    <Command className="bg-transparent">
                      <CommandInput placeholder="Search provider..." />
                      <CommandList className="max-h-[264px]">
                        <CommandEmpty>No provider found.</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            onSelect={() => {
                              toggleDafProvider("All");
                            }}
                          >
                            <Check className={`h-4 w-4 ${tempSelectedDafProviders.includes("All") ? "opacity-100" : "opacity-0"}`} />
                            All Providers
                          </CommandItem>
                          {sortedDafProviders.map((provider) => (
                            <CommandItem
                              key={provider.id}
                              onSelect={() => {
                                toggleDafProvider(provider.value);
                              }}
                            >
                              <Check
                                className={`h-4 w-4 ${
                                  tempSelectedDafProviders.includes("All") || tempSelectedDafProviders.includes(provider.value)
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              />
                              {provider.value}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter</Label>
                <div className="flex h-9 items-center gap-2">
                  <Checkbox
                    id="foundation-grants-only"
                    checked={foundationGrantsOnly}
                    onCheckedChange={(checked) => {
                      const next = checked === true;
                      if (next) {
                        setSavedDafProviderSelection({
                          temp: tempSelectedDafProviders,
                          selected: selectedDafProviders,
                        });
                        setTempSelectedDafProviders(["All"]);
                        setSelectedDafProviders([]);
                        setDafProviderPopoverOpen(false);
                      } else if (savedDafProviderSelection) {
                        setTempSelectedDafProviders(savedDafProviderSelection.temp);
                        setSelectedDafProviders(savedDafProviderSelection.selected);
                        setSavedDafProviderSelection(null);
                      }
                      setFoundationGrantsOnly(next);
                      setCurrentPage(1);
                    }}
                    data-testid="checkbox-foundation-grants-only"
                  />
                  <Label
                    htmlFor="foundation-grants-only"
                    className="text-sm font-normal cursor-pointer select-none"
                  >
                    Foundation Grants
                  </Label>
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter By Status</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "flex h-9 w-[250px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-normal"
                      )}
                      data-testid="select-status-filter"
                    >
                      <span className="truncate">{tempSelectedStatuses.includes("All") ? "All" : tempSelectedStatuses.join(", ")}</span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[200px] p-2 bg-popover" align="start">
                    <div className="flex flex-col gap-0.5 bg-transparent">
                      <div
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                        onClick={() => toggleStatus("All")}
                      >
                        <Check className={cn("h-4 w-4", tempSelectedStatuses.includes("All") ? "opacity-100" : "opacity-0")} />
                        All
                      </div>
                      {STATUS_OPTIONS.map((status) => (
                        <div
                          key={status}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm"
                          onClick={() => toggleStatus(status)}
                        >
                          <Check
                            className={cn(
                              "h-4 w-4",
                              tempSelectedStatuses.includes("All") || tempSelectedStatuses.includes(status) ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {status}
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <Button size="sm" className="bg-[#405189] text-white" data-testid="button-export-all" onClick={handleExport} disabled={isExporting}>
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-pending-grants">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="fullName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Full Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Email</th>
                    <SortHeader field="amount" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="whitespace-nowrap">
                      Original amount
                      <br />
                      Amount after fees
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      DAF Provider
                      <br />
                      DAF Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Investment Name
                      <br />
                      Grant Source
                    </th>
                    <SortHeader field="status" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Status
                    </SortHeader>
                    <SortHeader field="daysCount" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Day Count
                    </SortHeader>
                    <SortHeader field="createdDate" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Date Created
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground whitespace-normal">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading && error && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-destructive whitespace-normal">
                        {(error as Error).message || "Failed to load data"}
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && paginatedData.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground whitespace-normal">
                        No records found.
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && paginatedData.map((grant: PendingGrantEntry) => (
                    <Fragment key={grant.id}>
                      <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-grant-${grant.id}`}>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-grant-name-${grant.id}`}>
                            {grant.fullName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-muted-foreground" data-testid={`text-grant-email-${grant.id}`}>
                            {grant.email}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div data-testid={`text-grant-amount-${grant.id}`}>
                            <span className="text-sm font-medium">{currency_format(Number(grant.amount || 0))}</span>
                            <br />
                            <span className="text-xs text-muted-foreground">{currency_format(grant.amountAfterFees || 0)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div data-testid={`text-grant-daf-${grant.id}`}>
                            <span className="text-sm">{grant.dafProvider}</span>
                            {grant.dafName && (
                              <>
                                <br />
                                <span className="text-xs text-muted-foreground">{grant.dafName}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div data-testid={`text-grant-investment-${grant.id}`}>
                            <span className="text-sm">{grant.investmentName || "-"}</span>
                            {grant.reference && (
                              <>
                                <br />
                                <span className="text-xs text-muted-foreground">{grant.reference}</span>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusClasses(grant.status)}`} data-testid={`text-grant-status-${grant.id}`}>
                            {grant.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-grant-daycount-${grant.id}`}>
                            {grant.daysCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-grant-created-${grant.id}`}>
                            {formatDate(grant.createdDate, "-")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-start gap-1.5">
                            {(grant.status === "Pending" || grant.status === "In Transit") && (
                              <Button
                                size="sm"
                                className="bg-[#82b64b] hover:bg-[#72a341] text-white text-[11px] h-7 px-3 uppercase font-semibold"
                                onClick={() => {
                                  setRejectTarget(grant);
                                  setRejectDialogOpen(true);
                                }}
                                disabled={isSubmitting}
                                data-testid={`button-reject-grant-${grant.id}`}
                              >
                                Reject
                              </Button>
                            )}
                            {grant.status === "Pending" && (
                              <Button
                                size="sm"
                                className="bg-[#2185d0] hover:bg-[#1e77ba] text-white text-[11px] h-7 px-3 uppercase font-semibold"
                                onClick={() => {
                                  setTransitTarget(grant);
                                  setTransitDialogOpen(true);
                                }}
                                disabled={isSubmitting}
                                data-testid={`button-transit-grant-${grant.id}`}
                              >
                                Set in Transit
                              </Button>
                            )}
                            {grant.status === "In Transit" && (
                              <Button
                                size="sm"
                                className="bg-[#1b4370] hover:bg-[#16375c] text-white text-[11px] h-7 px-3 uppercase font-semibold"
                                onClick={() => {
                                  setReceivedTarget(grant);
                                  setReceivedDialogOpen(true);
                                }}
                                disabled={isSubmitting}
                                data-testid={`button-received-grant-${grant.id}`}
                              >
                                Received
                              </Button>
                            )}
                            <Button
                              size="sm"
                              className="bg-[#299cdb] hover:bg-[#258cc5] text-white text-[11px] h-7 px-3 uppercase font-semibold"
                              onClick={() => {
                                setFollowUpTarget(grant);
                                setFollowUpDialogOpen(true);
                              }}
                              disabled={isSubmitting}
                              data-testid={`button-follow-up-grant-${grant.id}`}
                            >
                              Add Note
                            </Button>
                            {(grant.hasNotes || authUser?.isSuperAdmin) && (
                              <div className="inline-flex rounded-md shadow-sm ml-1">
                                {grant.hasNotes && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 text-muted-foreground hover:text-[#405189] hover:bg-[#405189]/5",
                                          authUser?.isSuperAdmin ? "rounded-r-none border-r-0" : "rounded-md"
                                        )}
                                        onClick={() => setExpandedRow(expandedRow === grant.id ? null : grant.id)}
                                        data-testid={`button-notes-${grant.id}`}
                                      >
                                        <FileText className={`h-4 w-4 ${expandedRow === grant.id ? "text-[#405189]" : ""}`} />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{expandedRow === grant.id ? "Hide notes" : "View notes"}</TooltipContent>
                                  </Tooltip>
                                )}
                                {authUser?.isSuperAdmin && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5",
                                          grant.hasNotes ? "rounded-l-none" : "rounded-md"
                                        )}
                                        onClick={() => openDeleteDialog(grant.id)}
                                        data-testid={`button-delete-${grant.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete grant</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedRow === grant.id && (
                        <tr className="border-b" data-testid={`row-notes-${grant.id}`}>
                          <td colSpan={9} className="p-0">
                            <PendingGrantNotes grantId={grant.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
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
              dataTestId="pagination-pending-grants"
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={rejectDialogOpen}
        onOpenChange={(open) => {
          setRejectDialogOpen(open);
          if (!open) {
            setRejectNote("");
            setRejectAttachments([]);
            setRejectTarget(null);
          }
        }}
        title="Do you want to set this grant to rejected?"
        noteLabel="Please include the reason for the rejection"
        noteValue={rejectNote}
        onNoteChange={setRejectNote}
        onConfirm={() => onUpdateStatus(rejectTarget!.id, "Rejected", rejectNote, rejectAttachments)}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#82b64b] text-white"
        dataTestId="dialog-reject"
      >
        <AttachmentsPicker
          attachments={rejectAttachments}
          onChange={setRejectAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-reject-attachments"
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={transitDialogOpen}
        onOpenChange={(open) => {
          setTransitDialogOpen(open);
          if (!open) {
            setTransitNote("");
            setTransitAttachments([]);
            setTransitTarget(null);
          }
        }}
        title="Did you receive confirmation the grant is in transit?"
        noteLabel="Add a note"
        noteValue={transitNote}
        onNoteChange={setTransitNote}
        onConfirm={() => onUpdateStatus(transitTarget!.id, "In Transit", transitNote, transitAttachments)}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#2185d0] text-white"
        dataTestId="dialog-transit"
      >
        <AttachmentsPicker
          attachments={transitAttachments}
          onChange={setTransitAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-transit-attachments"
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={receivedDialogOpen}
        onOpenChange={(open) => {
          setReceivedDialogOpen(open);
          if (!open) {
            setReceivedNote("");
            setReceivedAttachments([]);
            setReceivedTarget(null);
          }
        }}
        title="Was the email confirmation for this grant received?"
        noteLabel="Add a note"
        noteValue={receivedNote}
        onNoteChange={setReceivedNote}
        onConfirm={() => onUpdateStatus(receivedTarget!.id, "Received", receivedNote, receivedAttachments)}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#1b4370] text-white"
        dataTestId="dialog-received"
      >
        <AttachmentsPicker
          attachments={receivedAttachments}
          onChange={setReceivedAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-received-attachments"
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={followUpDialogOpen}
        onOpenChange={(open) => {
          setFollowUpDialogOpen(open);
          if (!open) {
            setFollowUpNote("");
            setFollowUpAttachments([]);
            setFollowUpTarget(null);
          }
        }}
        title="Add Note to this grant"
        noteLabel="Add a note"
        noteValue={followUpNote}
        onNoteChange={setFollowUpNote}
        onConfirm={() => onUpdateStatus(followUpTarget!.id, followUpTarget!.status, followUpNote, followUpAttachments)}
        isSubmitting={isSubmitting}
        confirmLabel="SAVE"
        confirmButtonClass="bg-[#299cdb] text-white"
        dataTestId="dialog-follow-up"
      >
        <AttachmentsPicker
          attachments={followUpAttachments}
          onChange={setFollowUpAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-follow-up-attachments"
        />
      </ConfirmationDialog>

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Pending Grant"
        description="Are you sure you want to delete this pending grant? This action cannot be undone."
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
