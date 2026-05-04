import { useState, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Download, ChevronLeft, ChevronRight, ChevronDown, FileText, Ban, SendHorizonal, X, Mail, Phone, MessageSquare, MessageCircle, Trash2, Paperclip } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FaWhatsapp } from "react-icons/fa";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { PaginationControls } from "@/components/ui/pagination-controls";

import { fetchOtherAssets, updateOtherAsset, exportOtherAssets, fetchOtherAssetNotes, deleteOtherAsset, OtherAssetEntry } from "../api/other-asset/otherAssetApi";
import { AttachmentsPicker, SelectedAttachment } from "../components/AttachmentsPicker";
import { currency_format, formatDate } from "../helpers/format";

const STATUS_OPTIONS = ["All", "Pending", "In Transit", "Received", "Rejected"];

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

const ContactIcon = ({ method }: { method: string }) => {
  const normalizedMethod = method.toLowerCase();
  if (normalizedMethod.includes("email")) return <Mail className="h-3.5 w-3.5 shrink-0" />;
  if (normalizedMethod.includes("phone")) return <Phone className="h-3.5 w-3.5 shrink-0" />;
  if (normalizedMethod.includes("whatsapp")) return <FaWhatsapp className="h-3.5 w-3.5 shrink-0" />;
  if (normalizedMethod.includes("text") || normalizedMethod.includes("sms")) return <MessageSquare className="h-3.5 w-3.5 shrink-0" />;
  return <Mail className="h-3.5 w-3.5 shrink-0" />;
};

type SortField = "name" | "status" | "createdAt";

function OtherAssetNotes({ assetId }: { assetId: number }) {
  const {
    data: notes,
    isLoading,
    error
  } = useQuery({
    queryKey: ["otherAssetNotes", assetId],
    queryFn: () => fetchOtherAssetNotes(assetId),
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
    <div className="p-4 bg-muted/50">
      <div className="overflow-x-auto rounded-lg border shadow-sm bg-white dark:bg-background">
        <table className="w-full" data-testid={`table-notes-${assetId}`}>
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
              notes.map((entry, idx) => (
                <tr key={idx} className={`border-b last:border-0 ${idx % 2 === 0 ? "bg-white dark:bg-background" : "bg-muted/50"}`} data-testid={`row-note-entry-${assetId}-${idx}`}>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-date-${assetId}-${idx}`}>
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-username-${assetId}-${idx}`}>
                    {entry.userName}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-old-status-${assetId}-${idx}`}>
                    {entry.oldStatus}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-new-status-${assetId}-${idx}`}>
                    {entry.newStatus}
                  </td>
                  <td className="px-4 py-3 text-sm" data-testid={`text-note-note-${assetId}-${idx}`}>
                    {entry.note}
                  </td>
                  <td className="px-4 py-3 text-sm align-top max-w-[260px]" data-testid={`text-note-attachments-${assetId}-${idx}`}>
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
                                data-testid={`link-note-attachment-${assetId}-${idx}-${ai}`}
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

export default function AdminOtherAssets() {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("All");
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
  const [rejectTarget, setRejectTarget] = useState<OtherAssetEntry | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectAttachments, setRejectAttachments] = useState<SelectedAttachment[]>([]);

  const [transitDialogOpen, setTransitDialogOpen] = useState(false);
  const [transitTarget, setTransitTarget] = useState<OtherAssetEntry | null>(null);
  const [transitNote, setTransitNote] = useState("");
  const [transitAttachments, setTransitAttachments] = useState<SelectedAttachment[]>([]);

  const [receivedDialogOpen, setReceivedDialogOpen] = useState(false);
  const [receivedTarget, setReceivedTarget] = useState<OtherAssetEntry | null>(null);
  const [receivedNote, setReceivedNote] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedAttachments, setReceivedAttachments] = useState<SelectedAttachment[]>([]);

  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<OtherAssetEntry | null>(null);
  const [followUpNote, setFollowUpNote] = useState("");
  const [followUpAttachments, setFollowUpAttachments] = useState<SelectedAttachment[]>([]);

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
      await deleteOtherAsset(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["otherAssets"] });
      toast({
        title: "Other Asset Deleted",
        description: "The other asset has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete other asset", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the other asset. Please try again.",
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
    queryKey: ["otherAssets", currentPage, rowsPerPage, sortField, sortDir, statusFilter],
    queryFn: () =>
      fetchOtherAssets({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        status: statusFilter !== "All" ? statusFilter : undefined
      }),
    staleTime: 0,
    gcTime: 0
  });

  const data = queryData?.items ?? [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  const openRejectDialog = (grant: OtherAssetEntry) => {
    setRejectTarget(grant);
    setRejectNote("");
    setRejectAttachments([]);
    setRejectDialogOpen(true);
  };

  const mapAttachmentsForApi = (atts: SelectedAttachment[]) =>
    atts.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, base64Data: a.base64Data }));

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setIsSubmitting(true);
    try {
      const res = await updateOtherAsset({
        id: rejectTarget.id,
        status: "Rejected",
        note: rejectNote.trim(),
        noteEmail: [],
        attachments: mapAttachmentsForApi(rejectAttachments),
      });
      if (res.success) {
        toast({
          title: res.message || "Asset request has been rejected.",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["otherAssets"] });
        queryClient.invalidateQueries({ queryKey: ["otherAssetNotes", rejectTarget.id] });
        setRejectDialogOpen(false);
        setRejectTarget(null);
        setRejectNote("");
        setRejectAttachments([]);
      } else {
        toast({
          title: res.message || "Failed to reject asset",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Failed to reject asset",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openTransitDialog = (grant: OtherAssetEntry) => {
    setTransitTarget(grant);
    setTransitNote("");
    setTransitAttachments([]);
    setTransitDialogOpen(true);
  };

  const confirmTransit = async () => {
    if (!transitTarget) return;
    setIsSubmitting(true);
    try {
      const res = await updateOtherAsset({
        id: transitTarget.id,
        status: "In Transit",
        note: transitNote.trim(),
        noteEmail: [],
        attachments: mapAttachmentsForApi(transitAttachments),
      });
      if (res.success) {
        toast({
          title: res.message || "Asset request is now In Transit.",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["otherAssets"] });
        queryClient.invalidateQueries({ queryKey: ["otherAssetNotes", transitTarget.id] });
        setTransitDialogOpen(false);
        setTransitTarget(null);
        setTransitNote("");
        setTransitAttachments([]);
      } else {
        toast({
          title: res.message || "Failed to update status",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Failed to update status",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openReceivedDialog = (grant: OtherAssetEntry) => {
    setReceivedTarget(grant);
    setReceivedNote("");
    setReceivedAmount(String(grant.receivedAmount ?? 0));
    setReceivedAttachments([]);
    setReceivedDialogOpen(true);
  };

  const confirmReceived = async () => {
    if (!receivedTarget) return;
    setIsSubmitting(true);
    try {
      const res = await updateOtherAsset({
        id: receivedTarget.id,
        status: "Received",
        note: receivedNote.trim(),
        amount: Number(receivedAmount) || 0,
        noteEmail: [],
        attachments: mapAttachmentsForApi(receivedAttachments),
      });
      if (res.success) {
        toast({
          title: res.message || "Asset marked as Received",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["otherAssets"] });
        queryClient.invalidateQueries({ queryKey: ["otherAssetNotes", receivedTarget.id] });
        setReceivedDialogOpen(false);
        setReceivedTarget(null);
        setReceivedNote("");
        setReceivedAmount("");
        setReceivedAttachments([]);
      } else {
        toast({
          title: res.message || "Failed to update status",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Error: Failed to update status",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmFollowUp = async () => {
    if (!followUpTarget) return;
    setIsSubmitting(true);
    try {
      const res = await updateOtherAsset({
        id: followUpTarget.id,
        status: followUpTarget.status,
        note: followUpNote.trim(),
        noteEmail: [],
        attachments: mapAttachmentsForApi(followUpAttachments),
      });
      if (res.success) {
        toast({
          title: res.message || "Note added successfully.",
          duration: 4000
        });
        queryClient.invalidateQueries({ queryKey: ["otherAssets"] });
        queryClient.invalidateQueries({ queryKey: ["otherAssetNotes", followUpTarget.id] });
        setFollowUpDialogOpen(false);
        setFollowUpTarget(null);
        setFollowUpNote("");
        setFollowUpAttachments([]);
      } else {
        toast({
          title: res.message || "Failed to add note",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (error) {
      toast({
        title: "Failed to add note",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      await exportOtherAssets();
      toast({
        title: "The other assets list has been exported.",
        duration: 4000
      });
    } catch (error) {
      console.error("Error exporting other assets", error);
      toast({
        title: "Failed to export other assets",
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
          Other Assets
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Filter By Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => {
                    setStatusFilter(v);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button size="sm" className="bg-[#405189] text-white" data-testid="button-export-all" onClick={handleExportAll} disabled={isExporting}>
              <Download className="h-4 w-4 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-pending-grants">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="name" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="whitespace-nowrap">
                      Name <br /> Email
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Asset Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Original amount
                      <br />
                      Amount after fees
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Contact Method
                      <br />
                      Contact Value
                    </th>
                    <SortHeader field="status" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="whitespace-nowrap">
                      Status
                    </SortHeader>
                    <SortHeader field="createdAt" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="whitespace-nowrap">
                      Date Created
                    </SortHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap" style={{ width: "1%" }}>
                      Action
                    </th>
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
                    data.map((grant) => (
                      <Fragment key={grant.id}>
                        <tr className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-grant-${grant.id}`}>
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium" data-testid={`text-grant-name-${grant.id}`}>
                                {grant.name}
                              </span>
                              <span className="text-xs text-muted-foreground break-all" data-testid={`text-grant-email-${grant.id}`}>
                                {grant.email}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm" data-testid={`text-grant-investment-${grant.id}`}>
                              {grant.investmentName ?? "-"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm" data-testid={`text-grant-asset-${grant.id}`}>
                              {grant.assetType}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div data-testid={`text-grant-amount-${grant.id}`}>
                              <span className="text-sm font-medium">{currency_format(grant.approximateAmount ?? 0)}</span>
                              <br />
                              <span className="text-xs text-muted-foreground">{currency_format(grant.receivedAmount ?? 0)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1" data-testid={`text-grant-contact-${grant.id}`}>
                              <div className="flex items-center gap-1.5">
                                <ContactIcon method={grant.contactMethod} />
                                <span className="text-sm font-medium capitalize">{grant.contactMethod}</span>
                              </div>
                              <span className="text-xs text-muted-foreground break-all">{grant.contactValue}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusClasses(grant.status)}`} data-testid={`text-grant-status-${grant.id}`}>
                              {grant.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="text-sm" data-testid={`text-grant-date-${grant.id}`}>
                              {formatDate(grant.createdAt)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-start gap-1.5">
                              {grant.status !== "Rejected" && grant.status !== "Received" && (
                                <Button
                                  size="sm"
                                  className="bg-[#82b64b] hover:bg-[#72a341] text-white text-[11px] h-7 px-3 uppercase font-semibold"
                                  onClick={() => openRejectDialog(grant)}
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
                                  onClick={() => openTransitDialog(grant)}
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
                                  onClick={() => openReceivedDialog(grant)}
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
                                  setFollowUpNote("");
                                  setFollowUpAttachments([]);
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
                                    <TooltipContent>Delete other asset</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedRow === grant.id && (
                          <tr className="border-b" data-testid={`row-notes-${grant.id}`}>
                            <td colSpan={8} className="p-0">
                              <OtherAssetNotes assetId={grant.id} />
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
              dataTestId="pagination-other-assets"
            />
          </CardContent>
        </Card>
      </div>

      {/* Reject Dialog */}
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
        title="Do you want to set this asset request to rejected?"
        noteLabel="Please include the reason for the rejection"
        noteValue={rejectNote}
        onNoteChange={setRejectNote}
        onConfirm={confirmReject}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#82b64b] text-white"
        dataTestId="dialog-reject"
        contentClassName="sm:max-w-[640px] sm:w-[640px]"
      >
        <AttachmentsPicker
          attachments={rejectAttachments}
          onChange={setRejectAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-reject-attachments"
        />
      </ConfirmationDialog>

      {/* In Transit Dialog */}
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
        title="Did you receive the asset for this request?"
        noteLabel="Add a note"
        noteValue={transitNote}
        onNoteChange={setTransitNote}
        onConfirm={confirmTransit}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#2185d0] text-white"
        dataTestId="dialog-transit"
        contentClassName="sm:max-w-[640px] sm:w-[640px]"
      >
        <AttachmentsPicker
          attachments={transitAttachments}
          onChange={setTransitAttachments}
          disabled={isSubmitting}
          dataTestId="dialog-transit-attachments"
        />
      </ConfirmationDialog>

      {/* Received Dialog */}
      <ConfirmationDialog
        open={receivedDialogOpen}
        onOpenChange={(open) => {
          setReceivedDialogOpen(open);
          if (!open) {
            setReceivedNote("");
            setReceivedAttachments([]);
            setReceivedTarget(null);
            setReceivedAmount("");
          }
        }}
        title="Was the asset confirmation for this request received?"
        noteLabel="Add a note"
        noteValue={receivedNote}
        onNoteChange={setReceivedNote}
        onConfirm={confirmReceived}
        isSubmitting={isSubmitting}
        confirmButtonClass="bg-[#1b4370] text-white"
        dataTestId="dialog-received"
        contentClassName="sm:max-w-[640px] sm:w-[640px]"
      >
        <div className="space-y-1.5 pt-2">
          <p className="text-sm text-muted-foreground">Final amount after fees deduction (editable)</p>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <Input type="number" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} className="pl-7" data-testid="input-received-amount" />
          </div>
        </div>
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
        title="Add Note to this asset request"
        noteLabel="Add a note"
        noteValue={followUpNote}
        onNoteChange={setFollowUpNote}
        onConfirm={confirmFollowUp}
        isSubmitting={isSubmitting}
        confirmLabel="SAVE"
        confirmButtonClass="bg-[#299cdb] text-white"
        dataTestId="dialog-follow-up"
        contentClassName="sm:max-w-[640px] sm:w-[640px]"
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
        title="Delete Other Asset"
        description="Are you sure you want to delete this other asset? This action cannot be undone."
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
