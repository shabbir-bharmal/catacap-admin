import { useState, useMemo, useEffect, useCallback } from "react";
import { fetchFaqs, fetchFaqSummary, createOrUpdateFaq, deleteFaq, reorderFaqs, type FaqItem as ApiFaqItem, type FaqCreateUpdatePayload } from "@/api/faq/faqApi";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "../components/RichTextEditor";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Search, Plus, MoreVertical, ChevronLeft, ChevronRight, ArrowUpDown, Pencil, Trash2, Eye, GripVertical, Loader2 } from "lucide-react";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSort } from "@/hooks/useSort";
import { useDebounce } from "@/hooks/useDebounce";
import { SortHeader } from "@/components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";

type Category = "donors" | "groups" | "investments";

interface FAQItem {
  id: number;
  question: string;
  answer: string;
  category: Category;
  order: number;
  status: "Active" | "Draft";
}

const CATEGORY_LABELS: Record<Category, string> = {
  donors: "Donors/Investors",
  groups: "Group Leaders",
  investments: "Investments"
};

const catToId: Record<string, number> = { donors: 1, groups: 2, investments: 3 };
const idToCat: Record<number, Category> = { 1: "donors", 2: "groups", 3: "investments" };

const emptyForm = {
  question: "",
  answer: "",
  category: "donors" as Category,
  status: "Active" as "Active" | "Draft"
};

function SortableRow({
  faq,
  idx,
  currentPage,
  pageSize,
  categoryLabels,
  onPreview,
  onEdit,
  onDelete,
  hasDeletePermission
}: {
  faq: FAQItem;
  idx: number;
  currentPage: number;
  pageSize: number;
  categoryLabels: Record<Category, string>;
  onPreview: (faq: FAQItem) => void;
  onEdit: (faq: FAQItem) => void;
  onDelete: (faq: FAQItem) => void;
  hasDeletePermission: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: faq.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b last:border-b-0 bg-background hover:bg-muted/20 transition-colors" data-testid={`row-faq-${faq.id}`}>
      <td className="px-4 py-3 text-muted-foreground">{(currentPage - 1) * pageSize + idx + 1}</td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-center cursor-grab active:cursor-grabbing p-1" {...attributes} {...listeners} data-testid={`drag-handle-${faq.id}`}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="max-w-md">
          <div className="font-medium truncate">{faq.question}</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">{faq.answer.replace(/<[^>]*>/g, "").substring(0, 80)}...</div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
          {categoryLabels[faq.category]}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <Badge
          className={`no-default-hover-elevate no-default-active-elevate border-0 ${faq.status === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
        >
          {faq.status}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end">
          <div className="inline-flex rounded-md shadow-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-r-none border-r-0 text-[#22c55e] hover:text-[#22c55e] hover:bg-[#22c55e]/5"
                  onClick={() => onPreview(faq)}
                  data-testid={`action-preview-${faq.id}`}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview FAQ</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="outline"
                  className={cn(
                    "h-8 w-8 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5",
                    hasDeletePermission ? "rounded-none border-r-0" : "rounded-l-none"
                  )}
                  onClick={() => onEdit(faq)}
                  data-testid={`action-edit-${faq.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit FAQ</TooltipContent>
            </Tooltip>

            {hasDeletePermission && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                    onClick={() => onDelete(faq)}
                    data-testid={`action-delete-${faq.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete FAQ</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
export default function FAQManagement() {
  const { toast } = useToast();
  const { hasActionPermission } = useAuth();
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<{ categoryName: string; activeCount: number; totalCount: number }[]>([]);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<"question" | "category" | "order" | "status">(null, null);

  const toggleSort = (field: "question" | "category" | "order" | "status") => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const [formOpen, setFormOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQItem | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingFaq, setDeletingFaq] = useState<FAQItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFaq, setPreviewFaq] = useState<FAQItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errors, setErrors] = useState<{ question?: string; answer?: string }>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [faqData, summaryData] = await Promise.all([
        fetchFaqs({
          currentPage,
          perPage: pageSize,
          searchValue: effectiveSearch.trim() || undefined,
          status: filterStatus !== "all" ? filterStatus === "Active" : undefined,
          category: filterCategory !== "all" ? catToId[filterCategory] : undefined,
          sortField: sortField || undefined,
          sortDirection: sortDir || undefined
        }),
        fetchFaqSummary()
      ]);

      const mappedFaqs: FAQItem[] = (faqData.items || []).map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        category: idToCat[item.category] || "donors",
        order: item.displayOrder,
        status: item.status ? "Active" : "Draft"
      }));

      setFaqs(mappedFaqs);
      setTotalCount(faqData.totalRecords || mappedFaqs.length);
      setSummaries(summaryData);
    } catch (error) {
      console.error("Failed to load FAQs:", error);
      toast({
        title: "Cannot Load",
        description: "Failed to load FAQs. Please try again.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, effectiveSearch, filterCategory, filterStatus, sortField, sortDir]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = faqs;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const paginated = faqs;

  function openAdd() {
    setEditingFaq(null);
    setFormData(emptyForm);
    setErrors({});
    setFormOpen(true);
  }

  function openEdit(faq: FAQItem) {
    setEditingFaq(faq);
    setFormData({
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      status: faq.status
    });
    setErrors({});
    setFormOpen(true);
  }

  async function handleSave() {
    const newErrors: { question?: string; answer?: string } = {};
    if (!formData.question.trim()) {
      newErrors.question = "Question is required";
    }
    const strippedAnswer = formData.answer.replace(/<[^>]*>/g, "").trim();
    if (!strippedAnswer) {
      newErrors.answer = "Answer is required";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSaving(true);

    try {
      const payload: FaqCreateUpdatePayload = {
        id: editingFaq ? editingFaq.id : undefined,
        category: catToId[formData.category],
        question: formData.question,
        answer: formData.answer,
        status: formData.status === "Active"
      };

      await createOrUpdateFaq(payload);
      toast({ title: editingFaq ? "FAQ updated successfully" : "FAQ created successfully" });
      setFormOpen(false);
      loadData();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingFaq) return;
    setIsDeleting(true);
    try {
      await deleteFaq(deletingFaq.id);
      toast({ title: "FAQ deleted successfully" });
      loadData();
      setDeleteOpen(false);
      setDeletingFaq(null);
    } catch (err) {
      console.error("Failed to delete FAQ:", err);
      const message = err instanceof Error ? err.message : "Failed to delete FAQ. Please try again.";
      toast({
        title: "Cannot Delete",
        description: message,
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = filtered.find((f) => f.id === active.id);
    const overItem = filtered.find((f) => f.id === over.id);
    if (!activeItem || !overItem) return;

    const oldIndex = faqs.findIndex((f) => f.id === active.id);
    const newIndex = faqs.findIndex((f) => f.id === over.id);
    const reorderedItems = arrayMove(faqs, oldIndex, newIndex);

    setFaqs(reorderedItems);

    try {
      const payload = reorderedItems
        .filter((f) => f.category === activeItem.category)
        .map((f, index) => ({
          id: f.id,
          displayOrder: index + 1
        }));

      await reorderFaqs(payload);
      toast({ title: "Order updated successfully" });
    } catch (err) {
      console.error("Failed to reorder FAQs:", err);
      const message = err instanceof Error ? err.message : "Failed to reorder FAQs. Please try again.";
      toast({
        title: "Cannot Update Order",
        description: message,
        variant: "destructive"
      });
      loadData(); // Revert on failure
    }
  }

  const categoryStats = useMemo(() => {
    const findSummary = (name: string) => summaries.find((s) => s.categoryName === name || s.categoryName.replace("/", "") === name.replace("/", ""));
    const donors = findSummary("Donors/Investors") || findSummary("DonorsInvestors");
    const groups = findSummary("Group Leaders") || findSummary("GroupLeaders");
    const investments = findSummary("Investments");

    return {
      donors: donors?.activeCount || 0,
      groups: groups?.activeCount || 0,
      investments: investments?.activeCount || 0
    };
  }, [summaries]);

  const sortableIds = paginated.map((f) => f.id);

  return (
    <AdminLayout title="FAQ Management">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">
            FAQ Management
          </h1>
          <p className="text-sm text-muted-foreground">Manage frequently asked questions across all categories</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Donors/Investors</div>
              <div className="text-2xl font-bold" data-testid="text-donors-count">
                {categoryStats.donors}
              </div>
              <div className="text-xs text-muted-foreground">active questions</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Group Leaders</div>
              <div className="text-2xl font-bold" data-testid="text-groups-count">
                {categoryStats.groups}
              </div>
              <div className="text-xs text-muted-foreground">active questions</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Investments</div>
              <div className="text-2xl font-bold" data-testid="text-investments-count">
                {categoryStats.investments}
              </div>
              <div className="text-xs text-muted-foreground">active questions</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search FAQs..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-faqs"
                />
              </div>
              <Select
                value={filterCategory}
                onValueChange={(v) => {
                  setFilterCategory(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-48" data-testid="select-filter-category">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="donors">Donors/Investors</SelectItem>
                  <SelectItem value="groups">Group Leaders</SelectItem>
                  <SelectItem value="investments">Investments</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filterStatus}
                onValueChange={(v) => {
                  setFilterStatus(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-36" data-testid="select-filter-status">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openAdd} className="bg-[#405189] text-white" data-testid="button-add-faq">
              <Plus className="h-4 w-4 mr-2" />
              Add FAQ
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <table className="w-full text-sm" data-testid="table-faqs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12"></th>
                      <SortHeader
                        field="question"
                        sortField={sortField}
                        sortDir={sortDir}
                        handleSort={toggleSort}
                        className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Question
                      </SortHeader>
                      <SortHeader
                        field="category"
                        sortField={sortField}
                        sortDir={sortDir}
                        handleSort={toggleSort}
                        className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Category
                      </SortHeader>
                      <SortHeader
                        field="status"
                        sortField={sortField}
                        sortDir={sortDir}
                        handleSort={toggleSort}
                        className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Status
                      </SortHeader>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {paginated.map((faq, idx) => (
                        <SortableRow
                          key={faq.id}
                          faq={faq}
                          idx={idx}
                          currentPage={currentPage}
                          pageSize={pageSize}
                          categoryLabels={CATEGORY_LABELS}
                          onPreview={(f) => {
                            setPreviewFaq(f);
                            setPreviewOpen(true);
                          }}
                          onEdit={openEdit}
                          onDelete={(f) => {
                            setDeletingFaq(f);
                            setDeleteOpen(true);
                          }}
                          hasDeletePermission={hasActionPermission("content management", "delete")}
                        />
                      ))}
                      {paginated.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-muted-foreground">
                            No FAQs found matching your filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </SortableContext>
                </table>
              </DndContext>
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalCount={totalCount}
              rowsPerPage={pageSize}
              onPageChange={setCurrentPage}
              onRowsPerPageChange={(v) => {
                setPageSize(v);
                setCurrentPage(1);
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) {
            setEditingFaq(null);
            setFormData(emptyForm);
            setErrors({});
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-faq-form">
          <DialogHeader>
            <DialogTitle>{editingFaq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v as Category })}>
                <SelectTrigger data-testid="input-faq-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="donors">Donors/Investors</SelectItem>
                  <SelectItem value="groups">Group Leaders</SelectItem>
                  <SelectItem value="investments">Investments</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>
                Question <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.question}
                onChange={(e) => {
                  setFormData({ ...formData, question: e.target.value });
                  if (errors.question) setErrors({ ...errors, question: undefined });
                }}
                placeholder="Enter the FAQ question..."
                className={errors.question ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-faq-question"
              />
              {errors.question && <p className="text-xs text-destructive mt-1">{errors.question}</p>}
            </div>
            <div>
              <Label>
                Answer <span className="text-destructive">*</span>
              </Label>
              <div className={errors.answer ? "rounded-md border border-destructive" : ""}>
                <RichTextEditor
                  value={formData.answer}
                  onChange={(v: string) => {
                    setFormData({ ...formData, answer: v });
                    if (errors.answer) setErrors({ ...errors, answer: undefined });
                  }}
                  placeholder="Enter the FAQ answer..."
                  data-testid="input-faq-answer"
                />
              </div>
              {errors.answer && <p className="text-xs text-destructive mt-1">{errors.answer}</p>}
            </div>
            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as "Active" | "Draft" })}>
                <SelectTrigger data-testid="input-faq-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={isSaving} data-testid="button-cancel-faq">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-[#405189] text-white hover:bg-[#405189]/90 min-w-[100px]" data-testid="button-save-faq">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingFaq ? "Save Changes" : "Add FAQ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeletingFaq(null);
        }}
        title="Delete FAQ"
        description={<span>Are you sure you want to delete this FAQ? This action cannot be undone.</span>}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-destructive text-white hover:bg-destructive/90"
        dataTestId="dialog-delete-faq"
      >
        {deletingFaq && (
          <div className="bg-muted/50 rounded-md p-3 text-sm mt-4 min-w-0">
            <div className="font-medium break-words">{deletingFaq.question}</div>
            <div className="text-xs text-muted-foreground mt-1 break-words">Category: {CATEGORY_LABELS[deletingFaq.category]}</div>
          </div>
        )}
      </ConfirmationDialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-preview-faq">
          <DialogHeader>
            <DialogTitle>Preview FAQ</DialogTitle>
          </DialogHeader>
          {previewFaq && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{CATEGORY_LABELS[previewFaq.category]}</Badge>
                <Badge
                  className={`no-default-hover-elevate no-default-active-elevate border-0 ${previewFaq.status === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
                >
                  {previewFaq.status}
                </Badge>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Question</div>
                <div className="font-semibold text-lg">{previewFaq.question}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Answer</div>
                <div className="text-sm leading-relaxed bg-muted/50 rounded-md p-4 prose dark:prose-invert max-w-none whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: previewFaq.answer }} />
              </div>
              <div className="text-xs text-muted-foreground">Display order: {previewFaq.order}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} data-testid="button-close-preview">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
