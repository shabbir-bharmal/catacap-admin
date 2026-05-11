import { useState, useMemo } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Trash2, Download } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import * as eventApi from "../api/event/eventApi";
import { useAuth } from "@/contexts/AuthContext";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { useDebounce } from "../hooks/useDebounce";
import { PaginationControls } from "../components/ui/pagination-controls";
import { formatDateTime } from "@/helpers/format";

type Registration = eventApi.EventRegistrationItem;

function YesNoBadge({ value }: { value: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
        value
          ? "bg-[#0ab39c]/10 text-[#0ab39c]"
          : "bg-muted text-muted-foreground"
      )}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

export default function EventRegistrationsList() {
  const { toast } = useToast();
  const { hasActionPermission } = useAuth();
  const [search, setSearch] = useState("");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<keyof Registration>(null, null);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingRegistration, setDeletingRegistration] = useState<Registration | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleSort = (field: keyof Registration) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };

  const debouncedSearch = useDebounce(search, 500);

  const effectiveSearch = useMemo(() => {
    const trimmed = debouncedSearch.trim();
    if (trimmed.length === 0) return "";
    if (trimmed.length < 3) return "";
    return trimmed;
  }, [debouncedSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-event-registrations", currentPage, rowsPerPage, effectiveSearch, sortField, sortDir],
    queryFn: () =>
      eventApi.fetchEventRegistrations({
        currentPage,
        perPage: rowsPerPage,
        searchValue: effectiveSearch || undefined,
        sortField: sortField || undefined,
        sortDirection: sortDir || undefined,
      }),
    staleTime: 0,
    gcTime: 0,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => eventApi.deleteEventRegistration(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-event-registrations"] });
      toast({ title: result.message || "Event registration deleted" });
      setDeleteDialogOpen(false);
      setDeletingRegistration(null);
    },
    onError: () => {
      toast({ title: "Failed to delete event registration", variant: "destructive" });
    },
  });

  const rows = data?.items || [];
  const totalCount = data?.totalRecords || 0;
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;

  const canDelete = hasActionPermission("event registrations", "delete");

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      const all = await eventApi.fetchEventRegistrations({
        currentPage: 1,
        perPage: 100000,
        searchValue: effectiveSearch || undefined,
        sortField: sortField || undefined,
        sortDirection: sortDir || undefined,
      });
      const items = all.items || [];
      if (items.length === 0) {
        toast({ title: "Nothing to export", description: "No registrations match the current filter." });
        return;
      }

      const escape = (val: unknown) => {
        const s = val === null || val === undefined ? "" : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const headers = [
        "Event Slug",
        "First Name",
        "Last Name",
        "Email",
        "Attending In Person",
        "Guest Name",
        "Wants Future Event Info",
        "Wants 1:1 Call",
        "Referred By",
        "Registered At",
      ];
      const yesNo = (v: boolean) => (v ? "Yes" : "No");
      const lines = [headers.join(",")];
      for (const r of items) {
        lines.push(
          [
            r.eventSlug,
            r.firstName,
            r.lastName,
            r.email,
            yesNo(r.attending),
            r.guestName ?? "",
            yesNo(r.interestedInFutureEvents),
            yesNo(r.requestedIntroCall),
            r.referredBy ?? "",
            formatDateTime(r.createdAt),
          ]
            .map(escape)
            .join(",")
        );
      }
      const csv = "\uFEFF" + lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `event-registrations-${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({ title: `Exported ${items.length} registration${items.length === 1 ? "" : "s"}` });
    } catch (err) {
      toast({ title: "Failed to export registrations", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AdminLayout title="Event Registrations">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-event-registrations-title">
              Event Registrations
            </h1>
            <p className="text-sm text-muted-foreground">
              View RSVPs submitted via the public event registration form
            </p>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search registrations..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
                data-testid="input-search-event-registrations"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={isExporting || isLoading || totalCount === 0}
              data-testid="button-export-event-registrations"
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">
                      #
                    </th>
                    <SortHeader field="eventSlug" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Event Slug
                    </SortHeader>
                    <SortHeader field="firstName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      First Name
                    </SortHeader>
                    <SortHeader field="lastName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Last Name
                    </SortHeader>
                    <SortHeader field="email" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Email
                    </SortHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      In Person
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Guest Name
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Future Events
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      1:1 Call
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Referred By
                    </th>
                    <SortHeader field="createdAt" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Registered At
                    </SortHeader>
                    {canDelete && (
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {isLoading ? (
                    <tr>
                      <td colSpan={canDelete ? 12 : 11} className="text-center py-10 text-muted-foreground">
                        Loading registrations...
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={canDelete ? 12 : 11} className="text-center py-10 text-muted-foreground">
                        {search ? "No registrations match your search." : "No registrations yet."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((r, idx) => (
                      <tr
                        key={r.id}
                        className="hover:bg-muted/20 transition-colors"
                        data-testid={`row-event-registration-${r.id}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground">{startIdx + idx}</td>
                        <td className="px-4 py-3" data-testid={`text-event-slug-${r.id}`}>
                          {r.eventSlug || "—"}
                        </td>
                        <td className="px-4 py-3">{r.firstName || "—"}</td>
                        <td className="px-4 py-3">{r.lastName || "—"}</td>
                        <td className="px-4 py-3">{r.email || "—"}</td>
                        <td className="px-4 py-3 text-center" data-testid={`text-attending-${r.id}`}>
                          <YesNoBadge value={r.attending} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.guestName || "—"}</td>
                        <td className="px-4 py-3 text-center" data-testid={`text-future-events-${r.id}`}>
                          <YesNoBadge value={r.interestedInFutureEvents} />
                        </td>
                        <td className="px-4 py-3 text-center" data-testid={`text-intro-call-${r.id}`}>
                          <YesNoBadge value={r.requestedIntroCall} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.referredBy || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatDateTime(r.createdAt)}
                        </td>
                        {canDelete && (
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn("h-8 w-8 text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5")}
                                    onClick={() => {
                                      setDeletingRegistration(r);
                                      setDeleteDialogOpen(true);
                                    }}
                                    data-testid={`button-delete-event-registration-${r.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete Registration</TooltipContent>
                              </Tooltip>
                            </div>
                          </td>
                        )}
                      </tr>
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
            />
          </CardContent>
        </Card>
      </div>

      <ConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialogOpen(false);
            setDeletingRegistration(null);
          }
        }}
        title="Delete Event Registration"
        description={
          deletingRegistration ? (
            <>
              Are you sure you want to delete the registration for{" "}
              <span className="font-medium text-foreground break-words">
                {deletingRegistration.firstName} {deletingRegistration.lastName}
              </span>{" "}
              (<span className="break-all">{deletingRegistration.email}</span>)? This action cannot be undone from this page.
            </>
          ) : (
            "Are you sure you want to delete this event registration?"
          )
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmButtonClass="bg-[#f06548] hover:bg-[#f06548]/90 text-white"
        isSubmitting={deleteMutation.isPending}
        onConfirm={() => {
          if (deletingRegistration) deleteMutation.mutate(deletingRegistration.id);
        }}
        dataTestId="dialog-delete-event-registration"
      />
    </AdminLayout>
  );
}
