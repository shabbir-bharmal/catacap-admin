import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Search, Eye, Pencil, Loader2, ClipboardList, Trash2, FileText } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { fetchFormSubmissions, updateFormSubmissionStatus, deleteFormSubmission, fetchFormSubmissionNotes, type FormSubmission } from "../api/form-submission/formSubmissionApi";
import { formatDate, formatDateTime } from "@/helpers/format";
import { useDebounce } from "../hooks/useDebounce";
import { cn } from "@/lib/utils";
import { ConfirmationDialog } from "../components/ConfirmationDialog";

const FORM_TYPE_LABELS: Record<string, string> = {
  "1": "Companies",
  "2": "Home",
  "3": "Champion Deal",
  "4": "About",
  "5": "Group"
};

const FORM_TYPE_COLORS: Record<string, string> = {
  "1": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "2": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "3": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "4": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "5": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300"
};

const STATUS_LABELS: Record<string, string> = {
  "1": "New",
  "2": "Contacted",
  "3": "In Progress",
  "4": "Completed",
  "5": "Archived"
};

type SortField = "firstName" | "email" | "formType" | "createdAt";

export default function FormSubmissionsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const [filterType, setFilterType] = useState<string>("all");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [notesData, setNotesData] = useState<Record<number, any[]>>({});
  const [loadingNotes, setLoadingNotes] = useState<Record<number, boolean>>({});
  const [dialogMode, setDialogMode] = useState<"view" | "edit">("view");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const effectiveSearch = debouncedSearch.length >= 3 ? debouncedSearch : "";

  const { data, isLoading } = useQuery({
    queryKey: ["form-submissions", currentPage, rowsPerPage, sortField, sortDir, effectiveSearch, filterType],
    queryFn: () =>
      fetchFormSubmissions({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ? (sortField === "firstName" ? "FirstName" : sortField === "email" ? "Email" : sortField === "formType" ? "FormType" : "CreatedAt") : undefined,
        sortDirection: sortDir === "asc" ? "Asc" : sortDir === "desc" ? "Desc" : undefined,
        searchValue: effectiveSearch || undefined,
        formType: filterType === "all" ? undefined : filterType
      }),
    staleTime: 0,
    gcTime: 0
  });

  const submissions: FormSubmission[] = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, note }: { id: number; status: number; note: string }) => updateFormSubmissionStatus(id, status, note),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["form-submissions"] });
      toast({ title: "Saved", description: "Submission updated successfully." });

      setNotesData((prev) => {
        const updated = { ...prev };
        delete updated[variables.id];
        return updated;
      });

      if (expandedRow === variables.id) {
        setLoadingNotes((prev) => ({ ...prev, [variables.id]: true }));
        fetchFormSubmissionNotes(variables.id)
          .then((notes) => {
            setNotesData((prev) => ({ ...prev, [variables.id]: notes || [] }));
          })
          .catch(() => {
            setNotesData((prev) => ({ ...prev, [variables.id]: [] }));
          })
          .finally(() => {
            setLoadingNotes((prev) => ({ ...prev, [variables.id]: false }));
          });
      }

      setSelectedSubmission(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteFormSubmission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["form-submissions"] });
      toast({ title: "Deleted", description: "Submission deleted successfully." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete submission.", variant: "destructive" });
    }
  });

  const handleDelete = (id: number) => {
    setDeleteTargetId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteTargetId !== null) {
      await deleteMutation.mutateAsync(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
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
        const notes = await fetchFormSubmissionNotes(id);
        setNotesData((prev) => ({ ...prev, [id]: notes || [] }));
      } catch (error) {
        console.error("Failed to fetch notes", error);
        setNotesData((prev) => ({ ...prev, [id]: [] }));
        toast({
          title: "Error",
          description: "Failed to fetch submission notes. Please try again.",
          variant: "destructive"
        });
      } finally {
        setLoadingNotes((prev) => ({ ...prev, [id]: false }));
      }
    }
  };

  const getStatusLabel = (status: any) => {
    if (status === null || status === undefined) return "—";
    const key = String(status);
    if (STATUS_LABELS[key]) return STATUS_LABELS[key];
    const legacyMap: Record<string, string> = {
      "New": "New",
      "Contacted": "Contacted",
      "InProgress": "In Progress",
      "In Progress": "In Progress",
      "Completed": "Completed",
      "Archived": "Archived",
    };
    if (legacyMap[key]) return legacyMap[key];
    return key;
  };

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };

  const openView = (sub: FormSubmission) => {
    setSelectedSubmission(sub);
    setDialogMode("view");
    setEditNotes(sub.note ?? "");
    setEditStatus(sub.status ? String(sub.status) : "1");
  };

  const openEdit = (sub: FormSubmission) => {
    setSelectedSubmission(sub);
    setDialogMode("edit");
    setEditNotes(sub.note ?? "");
    setEditStatus(sub.status ? String(sub.status) : "1");
  };

  const handleSave = () => {
    if (!selectedSubmission) return;
    const statusInt = parseInt(editStatus) || 1;
    updateMutation.mutate({
      id: selectedSubmission.id,
      status: statusInt,
      note: editNotes
    });
  };

  const formTypeLabel = (type: number) => FORM_TYPE_LABELS[String(type)] ?? `Form ${type}`;
  const formTypeColor = (type: number) => FORM_TYPE_COLORS[String(type)] ?? "bg-muted text-muted-foreground";

  return (
    <AdminLayout>
      <TooltipProvider>
        <div className="space-y-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ClipboardList className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="heading-form-submissions">
                Form Submissions
              </h1>
              <p className="text-sm text-muted-foreground">{totalCount} total submissions</p>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, email, or message…"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-9 h-9"
                    data-testid="input-search-submissions"
                  />
                </div>
                <Select
                  value={filterType}
                  onValueChange={(v) => {
                    setFilterType(v);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-48 h-9" data-testid="select-filter-type">
                    <SelectValue placeholder="All form types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All form types</SelectItem>
                    {Object.entries(FORM_TYPE_LABELS).map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
              {isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : submissions.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">No submissions found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <SortHeader field="formType" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                          Form Type
                        </SortHeader>
                        <SortHeader field="firstName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                          Name
                        </SortHeader>
                        <SortHeader field="email" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                          Email
                        </SortHeader>
                        <SortHeader field="createdAt" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="hidden lg:table-cell">
                          Submitted
                        </SortHeader>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((sub) => (
                        <Fragment key={sub.id}>
                          <tr className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors" data-testid={`row-submission-${sub.id}`}>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${formTypeColor(sub.formType)}`}>{formTypeLabel(sub.formType)}</span>
                            </td>
                            <td className="px-4 py-3 font-medium text-foreground">
                              {sub.firstName} {sub.lastName}
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{sub.email}</td>
                            <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell whitespace-nowrap">{formatDateTime(sub.createdAt)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {sub.status ? (
                                  <Badge variant="outline" className="text-xs">
                                    {STATUS_LABELS[String(sub.status)] || sub.status}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                                {sub.isDeleted && (
                                  <Badge variant="destructive" className="text-[10px] h-4 px-1 uppercase">
                                    Deleted
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end">
                                <div className="inline-flex rounded-md shadow-sm">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 rounded-r-none border-r-0 text-slate-600 hover:text-[#405189] hover:bg-[#405189]/5",
                                          expandedRow === sub.id ? "text-[#405189] bg-[#405189]/5" : ""
                                        )}
                                        onClick={() => handleToggleNotes(sub.id)}
                                        data-testid={`button-notes-${sub.id}`}
                                      >
                                        <FileText className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View notes</TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-none border-r-0 text-[#0ab39c] hover:text-[#0ab39c] hover:bg-[#0ab39c]/5"
                                        onClick={() => openView(sub)}
                                        data-testid={`button-view-${sub.id}`}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>View details</TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-none border-r-0 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5"
                                        onClick={() => openEdit(sub)}
                                        data-testid={`button-edit-${sub.id}`}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Edit submission</TooltipContent>
                                  </Tooltip>

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                        onClick={() => handleDelete(sub.id)}
                                        disabled={deleteMutation.isPending}
                                        data-testid={`button-delete-${sub.id}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete submission</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {expandedRow === sub.id && (
                            <tr className="border-b border-border" data-testid={`row-notes-${sub.id}`}>
                              <td colSpan={7} className="p-4 bg-muted/50">
                                <div className="overflow-x-auto rounded-lg border shadow-sm bg-card">
                                  <table className="w-full" data-testid={`table-notes-${sub.id}`}>
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
                                      {loadingNotes[sub.id] ? (
                                        <tr>
                                          <td colSpan={5} className="px-4 py-8 text-sm text-muted-foreground text-center bg-white dark:bg-background">
                                            Loading notes...
                                          </td>
                                        </tr>
                                      ) : notesData[sub.id] && notesData[sub.id].length > 0 ? (
                                        notesData[sub.id].map((entry, idx) => (
                                          <tr key={idx} className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-card" : "bg-muted/30"}`}>
                                            <td className="px-4 py-3 text-sm">{formatDate(entry.createdAt, "N/A")}</td>
                                            <td className="px-4 py-3 text-sm">{entry.userName || "N/A"}</td>
                                            <td className="px-4 py-3 text-sm">{getStatusLabel(entry.oldStatus)}</td>
                                            <td className="px-4 py-3 text-sm">{getStatusLabel(entry.newStatus)}</td>
                                            <td className="px-4 py-3 text-sm">{entry.note || "N/A"}</td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={5} className="px-4 py-8 text-sm text-muted-foreground text-center bg-white dark:bg-background">
                                            No notes available for this submission.
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <PaginationControls
                currentPage={currentPage}
                totalCount={totalCount}
                rowsPerPage={rowsPerPage}
                onPageChange={setCurrentPage}
                onRowsPerPageChange={(rows) => {
                  setRowsPerPage(rows);
                  setCurrentPage(1);
                }}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            </CardContent>
          </Card>
        </div>

        {/* View / Edit Dialog */}
        <Dialog
          open={!!selectedSubmission}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedSubmission(null);
              setEditNotes("");
              setEditStatus("");
            }
          }}
        >
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-submission">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-r from-primary to-secondary p-2.5 rounded-lg">
                  <ClipboardList className="w-4 h-4 text-white" />
                </div>
                <div>
                  <DialogTitle className="text-lg">{dialogMode === "edit" ? "Edit Submission" : "View Submission"}</DialogTitle>
                  {selectedSubmission && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${formTypeColor(selectedSubmission.formType)}`}>
                        {formTypeLabel(selectedSubmission.formType)}
                      </span>
                      {" · "}
                      {formatDateTime(selectedSubmission.createdAt)}
                    </p>
                  )}
                </div>
              </div>
            </DialogHeader>

            {selectedSubmission && (
              <div className="space-y-4 pt-1">
                {/* Core fields */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">First Name</Label>
                    <p className="text-sm font-medium mt-0.5">{selectedSubmission.firstName || "—"}</p>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Last Name</Label>
                    <p className="text-sm font-medium mt-0.5">{selectedSubmission.lastName || "—"}</p>
                  </div>
                </div>

                {selectedSubmission.formType !== 3 && (
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email</Label>
                    <p className="text-sm font-medium mt-0.5 break-all">{selectedSubmission.email || "—"}</p>
                  </div>
                )}

                {selectedSubmission.description && (
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      {selectedSubmission.formType === 1
                        ? "Company Name & Foundation Name"
                        : selectedSubmission.formType === 2
                          ? "Themes of Interest"
                          : selectedSubmission.formType === 3
                            ? "Investment Name"
                            : selectedSubmission.formType === 4
                              ? "Are you interested in"
                              : selectedSubmission.formType === 5
                                ? "Theme(s) to focus on"
                                : "Description"}
                    </Label>
                    <p className="text-sm font-medium mt-0.5 break-words">{selectedSubmission.description}</p>
                  </div>
                )}

                {selectedSubmission.formType === 5 && (
                  <>
                    {selectedSubmission.launchPartners && (
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Launch Partners</Label>
                        <p className="text-sm mt-0.5">{selectedSubmission.launchPartners}</p>
                      </div>
                    )}
                    {selectedSubmission.targetRaiseAmount && (
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Target Raise Amount</Label>
                        <p className="text-sm font-medium mt-0.5">{selectedSubmission.targetRaiseAmount}</p>
                      </div>
                    )}
                    {selectedSubmission.selfRaiseAmountRange && (
                      <div>
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Self Raise Amount Range</Label>
                        <p className="text-sm mt-0.5">{selectedSubmission.selfRaiseAmountRange}</p>
                      </div>
                    )}
                  </>
                )}

                <div className="border-t border-border pt-4 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="dialog-status" className="text-xs text-muted-foreground uppercase tracking-wide">
                      Status
                    </Label>
                    {dialogMode === "edit" ? (
                      <Select value={String(editStatus)} onValueChange={setEditStatus}>
                        <SelectTrigger id="dialog-status" className="h-9" data-testid="select-submission-status">
                          <SelectValue placeholder="Set status…" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([val, label]) => (
                            <SelectItem key={val} value={val}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm font-medium">{STATUS_LABELS[String(selectedSubmission.status)] || selectedSubmission.status || "—"}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="dialog-notes" className="text-xs text-muted-foreground uppercase tracking-wide">
                      Internal Notes
                    </Label>
                    {dialogMode === "edit" ? (
                      <textarea
                        id="dialog-notes"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        rows={3}
                        placeholder="Add internal notes…"
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                        data-testid="textarea-submission-notes"
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">{selectedSubmission.note || "No notes yet."}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              {dialogMode === "view" ? (
                <>
                  <Button variant="outline" onClick={() => setSelectedSubmission(null)} data-testid="button-dialog-close">
                    Close
                  </Button>
                  <Button onClick={() => setDialogMode("edit")} data-testid="button-dialog-edit">
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />
                    Edit
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setDialogMode("view")} data-testid="button-dialog-cancel">
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={updateMutation.isPending} className="bg-[#405189] text-white" data-testid="button-dialog-save">
                    {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                    Save Changes
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmationDialog
          open={isDeleteDialogOpen}
          onOpenChange={(open) => {
            setIsDeleteDialogOpen(open);
            if (!open) setDeleteTargetId(null);
          }}
          title="Delete Submission"
          description="Are you sure you want to delete this submission? This action will move it to archived records and cannot be easily undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={handleConfirmDelete}
          isSubmitting={deleteMutation.isPending}
          confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
          dataTestId="dialog-delete-submission"
        />
      </TooltipProvider>
    </AdminLayout>
  );
}
