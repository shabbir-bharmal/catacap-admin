import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import dayjs from "dayjs";
import { cn } from "@/lib/utils";
import { Link, useRoute } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Plus, Upload, X } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    fetchDisbursalRequestDetails,
    fetchDisbursalRequestNotes,
    addDisbursalRequestNote,
    downloadInvestmentDocument,
    DisbursalRequestStatus,
    NoteEntry,
} from "../api/disbursal-request/disbursalRequestApi";

function formatDate(dateStr: string): string {
    if (!dateStr) return "—";
    const d = dayjs(dateStr);
    if (!d.isValid()) return dateStr;
    return d.format("MM/DD/YYYY");
}

export default function DisbursalRequestDetail() {
    const queryClient = useQueryClient();
    const [, params] = useRoute("/disbursal-request-detail/:id");
    const id = parseInt(params?.id || "0", 10);

    const { toast } = useToast();

    const handleDocumentDownload = (pdfFileName: string, originalPdfFileName: string) => {
        downloadInvestmentDocument("download", pdfFileName, originalPdfFileName);
    };

    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [noteText, setNoteText] = useState("");
    const [expandedNoteId, setExpandedNoteId] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const { data: detail, isLoading, error } = useQuery({
        queryKey: ["disbursalRequestDetail", id],
        queryFn: () => fetchDisbursalRequestDetails(id),
        enabled: !!id,
        staleTime: 0,
        gcTime: 0,
    });

    const { data: notes = [], isLoading: isNotesLoading } = useQuery({
        queryKey: ["disbursalRequestNotes", id],
        queryFn: async (): Promise<NoteEntry[]> => {
            const result = await fetchDisbursalRequestNotes(id);
            if (Array.isArray(result)) return result as NoteEntry[];
            if (result && Array.isArray((result as any).items)) return (result as any).items as NoteEntry[];
            if (result && Array.isArray((result as any).data)) return (result as any).data as NoteEntry[];
            return [];
        },
        enabled: !!id,
        staleTime: 0,
        gcTime: 0,
    });

    const addNoteMutation = useMutation({
        mutationFn: (note: string) => addDisbursalRequestNote(id, { note }),
        onSuccess: (response) => {
            if (response.success) {
                // Refresh both detail and notes list
                queryClient.invalidateQueries({ queryKey: ["disbursalRequestDetail", id] });
                queryClient.invalidateQueries({ queryKey: ["disbursalRequestNotes", id] });
                toast({
                    title: response.message || "Note added successfully",
                    duration: 4000,
                });
                setNoteText("");
                setAddNoteOpen(false);
            } else {
                toast({
                    title: response.message || "Failed to add note",
                    variant: "destructive",
                    duration: 4000,
                });
            }
        },
        onError: (err: any) => {
            toast({
                title: err.message || "An error occurred while adding the note",
                variant: "destructive",
                duration: 4000,
            });
        },
    });

    const handleSaveNote = () => {
        if (!noteText.trim()) return;
        addNoteMutation.mutate(noteText.trim());
    };

    if (isLoading) {
        return (
            <AdminLayout>
                <div className="flex items-center justify-center min-h-[400px]">
                    <p className="text-muted-foreground">Loading disbursal request details...</p>
                </div>
            </AdminLayout>
        );
    }

    if (error || !detail) {
        return (
            <AdminLayout>
                <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
                    <p className="text-red-500 font-medium">Error loading disbursal request details.</p>
                    <Link href="/disbursal-request">
                        <Button variant="outline">Back to List</Button>
                    </Link>
                </div>
            </AdminLayout>
        );
    }

    return (
        <AdminLayout>
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <Button variant="outline" size="sm" className="mb-3 text-[#405189] border-[#405189]" data-testid="button-back" onClick={() => window.history.back()}>
                            <ArrowLeft className="h-4 w-4 mr-1" />
                            BACK
                        </Button>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
                                Disbursal Request Details
                            </h1>
                            <span
                                className={cn(
                                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
                                    detail.status === DisbursalRequestStatus.Pending
                                        ? "bg-[#f7b84b]/10 text-[#f7b84b] border border-[#f7b84b]/20"
                                        : detail.status === DisbursalRequestStatus.Cancelled
                                            ? "bg-[#f06548]/10 text-[#f06548] border border-[#f06548]/20"
                                            : "bg-[#0ab39c]/10 text-[#0ab39c] border border-[#0ab39c]/20"
                                )}
                                data-testid="text-detail-status"
                            >
                                {detail.status === DisbursalRequestStatus.Completed
                                    ? "Completed"
                                    : detail.status === DisbursalRequestStatus.Cancelled
                                        ? "Cancelled"
                                        : "Pending"}
                            </span>
                        </div>
                    </div>
                    <Button
                        className="bg-[#405189] text-white"
                        onClick={() => setAddNoteOpen(true)}
                        data-testid="button-add-note"
                    >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Note
                    </Button>
                </div>

                <div className="bg-white dark:bg-slate-800 border rounded-lg p-6 space-y-8">
                    <section>
                        <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-contact-info">
                            Contact Information
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1 block">First Name</label>
                                <Input value={detail.firstName || ""} readOnly className="bg-muted/30" data-testid="input-first-name" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1 block">Last Name</label>
                                <Input value={detail.lastName || ""} readOnly className="bg-muted/30" data-testid="input-last-name" />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="text-sm font-medium text-foreground mb-1 block">Email</label>
                            <Input value={detail.email || ""} readOnly className="bg-muted/30" data-testid="input-email" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1 block">Role</label>
                                <Input value={detail.role || ""} readOnly className="bg-muted/30" data-testid="input-role" />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-foreground mb-1 block">Mobile</label>
                                <Input value={detail.mobile || ""} readOnly className="bg-muted/30" data-testid="input-mobile" />
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-investment-details">
                            Investment Details
                        </h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">Investment Name</label>
                                    <Input value={detail.name || ""} readOnly className="bg-muted/30" data-testid="input-investment-name" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">Distributed Amount</label>
                                    <Input value={detail.distributedAmount?.toString() || "0"} readOnly className="bg-muted/30" data-testid="input-distributed-amount" />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">URL</label>
                                    <Input value={detail.property || ""} readOnly className="bg-muted/30" data-testid="input-url" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">Investment Instruments</label>
                                    <Input value={detail.investmentTypeNames || ""} readOnly className="bg-muted/30" data-testid="input-investment-type" />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-submission-details">
                            Submission Details
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-foreground mb-2 block">Remain open on CataCap?</label>
                                <div className="space-y-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="radio"
                                            name="remainOpen"
                                            checked={detail.investmentRemainOpen === "yes_public"}
                                            readOnly
                                            className="accent-[#405189]"
                                        />
                                        Yes, public
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="radio"
                                            name="remainOpen"
                                            checked={detail.investmentRemainOpen === "yes_private"}
                                            readOnly
                                            className="accent-[#405189]"
                                        />
                                        Yes, private
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input
                                            type="radio"
                                            name="remainOpen"
                                            checked={detail.investmentRemainOpen === "no"}
                                            readOnly
                                            className="accent-[#405189]"
                                        />
                                        No
                                    </label>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">Preferred Receive Date</label>
                                    <Input value={formatDate(detail.receiveDate || "")} readOnly className="bg-muted/30" data-testid="input-preferred-date" />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-1 block">Funding from Impact Assets before?</label>
                                    <Input value={detail.impactAssetsFundingPreviously || ""} readOnly className="bg-muted/30" data-testid="input-funding-impact-assets" />
                                </div>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-success-stories">
                            Testimonials
                        </h2>
                        <Textarea
                            value={detail.quote || ""}
                            readOnly
                            className="bg-muted/30 min-h-[100px] resize-none"
                            data-testid="textarea-success-stories"
                        />
                    </section>

                    {detail.metricsPairs && detail.metricsPairs.length > 0 && (
                        <section>
                            <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-impact-metrics">
                                Impact Metrics
                            </h2>
                            <div className="space-y-4" data-testid="list-metrics-pairs">
                                {detail.metricsPairs.map((pair, idx) => (
                                    <div
                                        key={idx}
                                        className="grid grid-cols-1 md:grid-cols-2 gap-4"
                                        data-testid={`item-metrics-pair-${idx}`}
                                    >
                                        <div>
                                            <label className="text-sm font-medium text-foreground mb-1 block">
                                                Key
                                            </label>
                                            <Input
                                                value={pair.key || ""}
                                                readOnly
                                                className="bg-muted/30"
                                                data-testid={`input-metrics-pair-key-${idx}`}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-foreground mb-1 block">
                                                Value
                                            </label>
                                            <Input
                                                value={pair.value || ""}
                                                readOnly
                                                className="bg-muted/30"
                                                data-testid={`input-metrics-pair-value-${idx}`}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <section>
                        <h2 className="text-base font-bold text-foreground mb-4" data-testid="heading-documents">
                            Documents
                        </h2>
                        <div className={cn("grid grid-cols-1 gap-4", detail.metricsReport && detail.metricsReportName ? "md:grid-cols-3" : "md:grid-cols-2")}>
                            <div>
                                <label className="text-sm font-medium text-foreground mb-2 block">Most recent pitch deck</label>
                                <div className="border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg p-6 flex flex-col items-center justify-center text-center bg-muted/10">
                                    <Upload className="h-8 w-8 text-[#405189] mb-2" />
                                    <span className="text-sm text-muted-foreground mb-2" data-testid="text-pitch-deck-file">{detail.pitchDeckName || "No file uploaded"}</span>
                                    {detail.pitchDeck && detail.pitchDeckName && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-[#405189] border-[#405189] h-8"
                                            onClick={() => handleDocumentDownload(detail.pitchDeck as string, detail.pitchDeckName as string)}
                                        >
                                            Download
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-foreground mb-2 block">Most recent investment documents</label>
                                <div className="border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg p-6 flex flex-col items-center justify-center text-center bg-muted/10">
                                    <Upload className="h-8 w-8 text-[#405189] mb-2" />
                                    <span className="text-sm text-muted-foreground mb-2" data-testid="text-investment-docs-file">{detail.investmentDocumentName || "No file uploaded"}</span>
                                    {detail.investmentDocument && detail.investmentDocumentName && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-[#405189] border-[#405189] h-8"
                                            onClick={() => handleDocumentDownload(detail.investmentDocument as string, detail.investmentDocumentName as string)}
                                        >
                                            Download
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {detail.metricsReport && detail.metricsReportName && (
                                <div>
                                    <label className="text-sm font-medium text-foreground mb-2 block">Most recent impact metrics</label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg p-6 flex flex-col items-center justify-center text-center bg-muted/10">
                                        <Upload className="h-8 w-8 text-[#405189] mb-2" />
                                        <span className="text-sm text-muted-foreground mb-2" data-testid="text-impact-metrics-file">{detail.metricsReportName}</span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="text-[#405189] border-[#405189] h-8"
                                            data-testid="button-download-impact-metrics"
                                            onClick={() => handleDocumentDownload(detail.metricsReport as string, detail.metricsReportName as string)}
                                        >
                                            Download
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <div>
                    <h2 className="text-xl font-semibold text-[#405189] mb-4" data-testid="heading-notes">
                        Notes
                    </h2>
                    <div className="overflow-x-auto border rounded-lg">
                        <table className="w-full" data-testid="table-notes">
                            <thead>
                                <tr className="bg-muted/30 border-b">
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Date</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Username</th>
                                    <th className="px-4 py-3 text-left text-sm font-semibold text-foreground">Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {isNotesLoading ? (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                            Loading notes...
                                        </td>
                                    </tr>
                                ) : notes.length === 0 ? (
                                    <tr>
                                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-muted-foreground">
                                            No notes yet.
                                        </td>
                                    </tr>
                                ) : (
                                    notes.map((note) => (
                                        <tr key={note.id} className="border-b last:border-b-0" data-testid={`row-note-${note.id}`}>
                                            <td className="px-4 py-3 text-sm" data-testid={`text-note-date-${note.id}`}>{formatDate(note.createdAt)}</td>
                                            <td className="px-4 py-3 text-sm" data-testid={`text-note-username-${note.id}`}>{note.userName}</td>
                                            <td className="px-4 py-3 text-sm" data-testid={`text-note-text-${note.id}`}>{note.note}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <Dialog open={addNoteOpen} onOpenChange={setAddNoteOpen}>
                    <DialogContent className="sm:max-w-md" data-testid="dialog-add-note">
                        <DialogHeader>
                            <DialogTitle>Add Note</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="relative">
                                <Textarea
                                    placeholder="Note"
                                    value={noteText}
                                    onChange={(e) => {
                                        if (e.target.value.length <= 1000) setNoteText(e.target.value);
                                    }}
                                    className="min-h-[120px] resize-none"
                                    data-testid="textarea-note"
                                />
                                <span className="absolute bottom-2 right-3 text-xs text-muted-foreground" data-testid="text-char-count">
                                    {noteText.length}/1000
                                </span>
                            </div>
                            <div className="flex justify-end gap-3">
                                <Button
                                    variant="ghost"
                                    onClick={() => { setNoteText(""); setAddNoteOpen(false); }}
                                    data-testid="button-cancel-note"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSaveNote}
                                    disabled={!noteText.trim() || addNoteMutation.isPending}
                                    className="bg-[#405189] text-white"
                                    data-testid="button-save-note"
                                >
                                    {addNoteMutation.isPending ? "Saving..." : "Save"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </AdminLayout>
    );
}
