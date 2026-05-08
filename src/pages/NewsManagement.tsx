import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchNews,
  createOrUpdateNews,
  deleteNews,
  fetchNewsDropdownOptions,
  type NewsApiItem,
  type DropdownOption,
} from "../api/news/newsApi";
import { fetchAllInvestmentNameList, type InvestmentNameListItem } from "../api/investment/investmentApi";
import { fetchCustomPages } from "../api/event/customPagesApi";
import { MultiSelectPopover, type MultiSelectOption } from "@/components/MultiSelectPopover";
import { getUrlBlobContainerImage } from "@/lib/image-utils";
import catacapLogo from "@assets/CataCap-Logo.png";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Search,
  Plus,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Pencil,
  Trash2,
  ExternalLink,
  Calendar,
  Eye,
  Upload,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import dayjs from "dayjs";
import { formatLongDate } from "@/helpers/format";
import { useAuth } from "../contexts/AuthContext";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Loader2 } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "../hooks/useDebounce";

interface NewsArticle {
  id: number;
  title: string;
  description: string;
  image: string;
  imageFileName: string;
  medium: string;
  typeId: number | null;
  audience: string;
  audienceId: number | null;
  theme: string;
  themeId: number | null;
  date: string;
  link: string;
  status: "Published" | "Draft";
  linkedInvestmentIds: number[];
  linkedCustomPageSlugs: string[];
}

function mapApiItemToArticle(item: NewsApiItem): NewsArticle {
  return {
    id: item.id,
    title: item.title ?? "",
    description: item.description ?? "",
    image: getUrlBlobContainerImage(item.imageFileName),
    imageFileName: item.imageFileName ?? "",
    medium: item.type ?? "",
    typeId: item.typeId ?? null,
    audience: item.audience ?? "",
    audienceId: item.audienceId ?? null,
    theme: item.theme ?? "",
    themeId: item.themeId ?? null,
    date: formatLongDate(item.newsDate, ""),
    link: item.link ?? "",
    status: item.status === true ? "Published" : "Draft",
    linkedInvestmentIds: Array.isArray(item.linkedInvestmentIds) ? item.linkedInvestmentIds : [],
    linkedCustomPageSlugs: Array.isArray(item.linkedCustomPageSlugs) ? item.linkedCustomPageSlugs : [],
  };
}

type SortField = "title" | "medium" | "date" | "status";
type SortDir = "asc" | "desc";

const emptyForm: Omit<NewsArticle, "id"> = {
  title: "",
  description: "",
  image: "",
  imageFileName: "",
  medium: "",
  typeId: null,
  audience: "",
  audienceId: null,
  theme: "",
  themeId: null,
  date: "",
  link: "",
  status: "Draft",
  linkedInvestmentIds: [],
  linkedCustomPageSlugs: [],
};

function getDropdownValue(opts: DropdownOption[], currentId: number | null, currentName: string): string {
  if (currentId != null) {
    const match = opts.find(o => o.id === currentId);
    if (match) return match.id ? String(match.id) : match.name;
  }
  if (currentName) {
    const match = opts.find(o => o.name === currentName);
    if (match) return match.id ? String(match.id) : match.name;
  }
  return "";
}

export default function NewsManagementPage() {
  const { hasActionPermission } = useAuth();
  const { toast } = useToast();
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";

  const [filterMedium, setFilterMedium] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>(null, null);

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);

  const [dialogOpen, setDialogOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [editingArticle, setEditingArticle] = useState<NewsArticle | null>(null);
  const [formData, setFormData] = useState<Omit<NewsArticle, "id">>(emptyForm);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [imageError, setImageError] = useState(false);

  const [dropdownOptions, setDropdownOptions] = useState<{
    types: DropdownOption[];
    audiences: DropdownOption[];
    themes: DropdownOption[];
  }>({ types: [], audiences: [], themes: [] });

  const [errors, setErrors] = useState<Partial<Record<keyof Omit<NewsArticle, "id">, string>>>({});

  useEffect(() => {
    fetchNewsDropdownOptions().then((opts) => {
      setDropdownOptions({
        types: opts.types,
        audiences: opts.audiences,
        themes: opts.themes,
      });
    }).catch((err) => {
      console.error("Failed to fetch dropdown options:", err);
      setDropdownOptions({ types: [], audiences: [], themes: [] });
    });
  }, []);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NewsArticle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewArticle, setPreviewArticle] = useState<NewsArticle | null>(null);

  const investmentsListQuery = useQuery({
    queryKey: ["news-link-investments"],
    queryFn: () => fetchAllInvestmentNameList(0, 0),
    staleTime: 5 * 60 * 1000,
  });
  const customPagesListQuery = useQuery({
    queryKey: ["news-link-custom-pages"],
    queryFn: () => fetchCustomPages(),
    staleTime: 5 * 60 * 1000,
  });

  const investmentOptions: MultiSelectOption<number>[] = useMemo(() => {
    const list: InvestmentNameListItem[] = Array.isArray(investmentsListQuery.data) ? investmentsListQuery.data : [];
    return list
      .map((it) => {
        const rawId = (it.id ?? (it as Record<string, unknown>).Id ?? (it as Record<string, unknown>).investmentId ?? (it as Record<string, unknown>).InvestmentId) as unknown;
        const rawName = (it.name ?? (it as Record<string, unknown>).Name ?? (it as Record<string, unknown>).title ?? (it as Record<string, unknown>).Title ?? "") as unknown;
        return { id: Number(rawId ?? 0), name: String(rawName ?? "") };
      })
      .filter((o) => Number.isInteger(o.id) && o.id > 0 && o.name.length > 0);
  }, [investmentsListQuery.data]);

  const customPageOptions: MultiSelectOption<string>[] = useMemo(() => {
    const list = Array.isArray(customPagesListQuery.data) ? customPagesListQuery.data : [];
    const HIDDEN_SLUGS = new Set(["communities", "companies"]);
    const filtered = list
      .filter((p) => p.slug && !HIDDEN_SLUGS.has(p.slug.toLowerCase()))
      .map((p) => ({ id: p.slug, name: p.title || p.slug }));
    const hasHome = filtered.some((o) => o.id.toLowerCase() === "home");
    return hasHome ? filtered : [{ id: "home", name: "Home" }, ...filtered];
  }, [customPagesListQuery.data]);

  const isLoadingInvestmentOptions = investmentsListQuery.isLoading;
  const isLoadingCustomPageOptions = customPagesListQuery.isLoading;

  function parseDate(dateStr: string): Date {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }

  const loadNews = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetchNews({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField === "medium" ? "type" : sortField || undefined,
        sortDirection: sortDir || undefined,
        searchValue: effectiveSearch.trim() || undefined,
      });
      // The API returns paginated items; map them to the local shape
      const mapped = (res.items ?? []).map(mapApiItemToArticle);
      setNews(mapped);
      setTotalCount(res.totalCount ?? mapped.length);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load news";
      setFetchError(message);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, rowsPerPage, sortField, sortDir, effectiveSearch]);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  // Client-side medium and status filter (server does not fully support these filters in this endpoint)
  const filtered = useMemo(() => {
    let result = news;
    if (filterMedium !== "all") {
      result = result.filter((a) => a.medium === filterMedium);
    }
    if (filterStatus !== "all") {
      result = result.filter((a) => a.status === filterStatus);
    }
    return result;
  }, [news, filterMedium, filterStatus]);

  // Pagination is server-driven; totalPages derived from server totalCount
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);
  const paginated = filtered; // server already returns the correct page

  function openAdd() {
    setEditingArticle(null);
    setFormData(emptyForm);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(article: NewsArticle) {
    setEditingArticle(article);
    setErrors({});
    setImageError(false);
    setFormData({
      title: article.title,
      description: article.description,
      image: article.image,
      imageFileName: article.imageFileName,
      medium: article.medium,
      typeId: article.typeId,
      audience: article.audience,
      audienceId: article.audienceId,
      theme: article.theme,
      themeId: article.themeId,
      date: article.date,
      link: article.link,
      status: article.status,
      linkedInvestmentIds: Array.isArray(article.linkedInvestmentIds) ? article.linkedInvestmentIds : [],
      linkedCustomPageSlugs: Array.isArray(article.linkedCustomPageSlugs) ? article.linkedCustomPageSlugs : [],
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingArticle(null);
    setFormData(emptyForm);
    setErrors({});
    setImageError(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function handleSave() {
    const newErrors: Partial<Record<keyof Omit<NewsArticle, "id">, string>> = {};
    if (!formData.title.trim()) newErrors.title = "Title is required";
    if (!formData.description.trim()) newErrors.description = "Description is required";
    if (!formData.medium.trim() && !formData.typeId) newErrors.medium = "Type / Medium is required";
    if (!formData.audience.trim() && !formData.audienceId) newErrors.audience = "Audience is required";
    if (!formData.theme.trim() && !formData.themeId) newErrors.theme = "Theme is required";
    if (!formData.date) newErrors.date = "Date is required";
    if (!formData.image) newErrors.image = "Image is required";

    if (formData.link.trim() && !/^https?:\/\//i.test(formData.link.trim())) {
      newErrors.link = "Please enter a valid URL";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsSaving(true);
    try {
      const parsedDate = dayjs(formData.date);
      const newsDate = parsedDate.isValid()
        ? parsedDate.format("YYYY-MM-DD[T]00:00:00.000[Z]")
        : dayjs().toISOString();

      const resolvedTypeId = formData.typeId ?? dropdownOptions.types.find(o => o.name === formData.medium)?.id ?? null;
      const resolvedAudienceId = formData.audienceId ?? dropdownOptions.audiences.find(o => o.name === formData.audience)?.id ?? null;
      const resolvedThemeId = formData.themeId ?? dropdownOptions.themes.find(o => o.name === formData.theme)?.id ?? null;

      await createOrUpdateNews({
        ...(editingArticle ? { id: editingArticle.id } : {}),
        title: formData.title.trim(),
        description: formData.description.trim(),
        newsTypeId: resolvedTypeId,
        audienceId: resolvedAudienceId,
        themeId: resolvedThemeId,
        image: formData.image,
        imageFileName: formData.imageFileName,
        newsLink: formData.link.trim(),
        status: formData.status === "Published",
        newsDate,
        linkedInvestmentIds: formData.linkedInvestmentIds,
        linkedCustomPageSlugs: formData.linkedCustomPageSlugs,
      });
      if (!editingArticle) {
        setCurrentPage(1);
      }
      await loadNews();
      closeDialog();
      toast({ title: editingArticle ? "Article updated successfully" : "Article added successfully" });
    } catch (err) {
      console.error("Failed to save news:", err);
      toast({ title: "Failed to save news", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDelete(article: NewsArticle) {
    setDeleteTarget(article);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteNews(deleteTarget.id);
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
      // Refresh list from server
      loadNews();
    } finally {
      setIsDeleting(false);
    }
  }

  function openPreview(article: NewsArticle) {
    setPreviewArticle(article);
    setPreviewOpen(true);
  }

  const mediumBadgeColor = (medium: string) => {
    switch (medium.toLowerCase()) {
      case "news article": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
      case "press release": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
      case "youtube": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
      case "linkedin live": return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300";
      case "video": return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
      case "podcast": return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
      case "case study": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
      default: return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300";
    }
  };

  const statusBadge = (status: string) => {
    if (status === "Published") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-0";
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-0";
  };

  const uniqueMediums = Array.from(new Set(news.map((a) => a.medium))).filter(Boolean);

  return (
    <AdminLayout title="News Management">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold" data-testid="text-page-title">News Management</h1>
            <p className="text-sm text-muted-foreground">Manage news articles, press releases, and media content</p>
          </div>
          <Button onClick={openAdd} className="bg-[#405189] text-white" data-testid="button-add-news">
            <Plus className="h-4 w-4 mr-1.5" />
            Add News
          </Button>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search articles..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="pl-9"
                  data-testid="input-search-news"
                />
              </div>
              <Select value={filterMedium} onValueChange={(v) => { setFilterMedium(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-44" data-testid="select-filter-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {uniqueMediums.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setCurrentPage(1); }}>
                <SelectTrigger className="w-36" data-testid="select-filter-status">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Published">Published</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-news">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">#</th>
                    <SortHeader field="title" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Title
                    </SortHeader>
                    <SortHeader field="medium" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Type
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Audience</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Theme</th>
                    <SortHeader field="date" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Date
                    </SortHeader>
                    <SortHeader field="status" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      Status
                    </SortHeader>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground" data-testid="text-loading-news">
                        Loading news…
                      </td>
                    </tr>
                  ) : fetchError ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-destructive" data-testid="text-error-news">
                        {fetchError}
                      </td>
                    </tr>
                  ) : paginated.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-muted-foreground">
                        No articles found
                      </td>
                    </tr>
                  ) : (
                    paginated.map((article, idx) => (
                      <tr
                        key={article.id}
                        className="border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                        data-testid={`row-news-${article.id}`}
                      >
                        <td className="px-4 py-3 text-muted-foreground">
                          {startIdx + idx}
                        </td>
                        <td className="px-4 py-3 max-w-[300px]">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-14 flex items-center justify-center shrink-0" data-testid={`img-news-thumb-${article.id}`}>
                              <img
                                src={article.image || catacapLogo}
                                alt={article.title}
                                className="max-h-10 max-w-14 object-contain rounded"
                                onError={(e) => { (e.target as HTMLImageElement).src = catacapLogo; }}
                              />
                            </div>
                            <span className="font-medium line-clamp-2" data-testid={`text-news-title-${article.id}`}>
                              {article.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-xs border-0 ${mediumBadgeColor(article.medium)}`}>
                            {article.medium}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs max-w-[120px] truncate">
                          {article.audience}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {article.theme}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                          {article.date}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-xs border-0 ${statusBadge(article.status)}`}>
                            {article.status}
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
                                    onClick={() => openPreview(article)}
                                    data-testid={`button-preview-${article.id}`}
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Preview Article</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5",
                                      (article.link || hasActionPermission("content management", "delete")) ? "rounded-none border-r-0" : "rounded-l-none"
                                    )}
                                    onClick={() => openEdit(article)}
                                    data-testid={`button-edit-${article.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit Article</TooltipContent>
                              </Tooltip>

                              {article.link && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className={cn(
                                        "h-8 w-8 text-[#3b82f6] hover:text-[#3b82f6] hover:bg-[#3b82f6]/5",
                                        hasActionPermission("content management", "delete") ? "rounded-none border-r-0" : "rounded-l-none"
                                      )}
                                      onClick={() => window.open(article.link, "_blank")}
                                      data-testid={`button-open-link-${article.id}`}
                                    >
                                      <ExternalLink className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Open External Link</TooltipContent>
                                </Tooltip>
                              )}

                              {hasActionPermission("content management", "delete") && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                      onClick={() => confirmDelete(article)}
                                      data-testid={`button-delete-${article.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete Article</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </td>
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

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto" data-testid="dialog-news-form">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingArticle ? "Edit Article" : "Add Article"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title <span className="text-destructive">*</span></Label>
              <Input
                value={formData.title}
                onChange={(e) => {
                  setFormData((f) => ({ ...f, title: e.target.value }));
                  if (errors.title) setErrors(prev => ({ ...prev, title: undefined }));
                }}
                placeholder="Article title"
                data-testid="input-news-title"
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && <p className="text-xs text-destructive mt-1">{errors.title}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Description <span className="text-destructive">*</span></Label>
              <Textarea
                value={formData.description}
                onChange={(e) => {
                  setFormData((f) => ({ ...f, description: e.target.value }));
                  if (errors.description) setErrors(prev => ({ ...prev, description: undefined }));
                }}
                placeholder="Brief description of the article"
                rows={3}
                data-testid="input-news-description"
                className={errors.description ? "border-destructive" : ""}
              />
              {errors.description && <p className="text-xs text-destructive mt-1">{errors.description}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Type / Medium <span className="text-destructive">*</span></Label>
                <Select
                  value={getDropdownValue(dropdownOptions.types, formData.typeId, formData.medium)}
                  onValueChange={(v) => {
                    const opt = dropdownOptions.types.find((o) => (o.id ? String(o.id) : o.name) === v);
                    setFormData((f) => ({ ...f, medium: opt?.name ?? v, typeId: opt?.id ?? null }));
                    if (errors.medium) setErrors(prev => ({ ...prev, medium: undefined }));
                  }}
                >
                  <SelectTrigger data-testid="select-news-medium" className={errors.medium ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select type">
                      {formData.medium || "Select type"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownOptions.types.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No types found.
                      </div>
                    ) : (
                      dropdownOptions.types.map((opt) => {
                        const optVal = opt.id ? String(opt.id) : opt.name;
                        return (
                          <SelectItem key={optVal} value={optVal}>
                            {opt.name}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
                {errors.medium && <p className="text-xs text-destructive mt-1">{errors.medium}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Audience <span className="text-destructive">*</span></Label>
                <Select
                  value={getDropdownValue(dropdownOptions.audiences, formData.audienceId, formData.audience)}
                  onValueChange={(v) => {
                    const opt = dropdownOptions.audiences.find((o) => (o.id ? String(o.id) : o.name) === v);
                    setFormData((f) => ({ ...f, audience: opt?.name ?? v, audienceId: opt?.id ?? null }));
                    if (errors.audience) setErrors(prev => ({ ...prev, audience: undefined }));
                  }}
                >
                  <SelectTrigger data-testid="select-news-audience" className={errors.audience ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select audience">
                      {formData.audience || "Select audience"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownOptions.audiences.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No audiences found.
                      </div>
                    ) : (
                      dropdownOptions.audiences.map((opt) => {
                        const optVal = opt.id ? String(opt.id) : opt.name;
                        return (
                          <SelectItem key={optVal} value={optVal}>
                            {opt.name}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
                {errors.audience && <p className="text-xs text-destructive mt-1">{errors.audience}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Theme <span className="text-destructive">*</span></Label>
                <Select
                  value={getDropdownValue(dropdownOptions.themes, formData.themeId, formData.theme)}
                  onValueChange={(v) => {
                    const opt = dropdownOptions.themes.find((o) => (o.id ? String(o.id) : o.name) === v);
                    setFormData((f) => ({ ...f, theme: opt?.name ?? v, themeId: opt?.id ?? null }));
                    if (errors.theme) setErrors(prev => ({ ...prev, theme: undefined }));
                  }}
                >
                  <SelectTrigger data-testid="select-news-theme" className={errors.theme ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select theme">
                      {formData.theme || "Select theme"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {dropdownOptions.themes.length === 0 ? (
                      <div className="py-6 text-center text-sm text-muted-foreground">
                        No themes found.
                      </div>
                    ) : (
                      dropdownOptions.themes.map((opt) => {
                        const optVal = opt.id ? String(opt.id) : opt.name;
                        return (
                          <SelectItem key={optVal} value={optVal}>
                            {opt.name}
                          </SelectItem>
                        );
                      })
                    )}
                  </SelectContent>
                </Select>
                {errors.theme && <p className="text-xs text-destructive mt-1">{errors.theme}</p>}
              </div>

              <div className="space-y-1.5">
                <Label>Date <span className="text-destructive">*</span></Label>
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={`w-full justify-start text-left font-normal ${errors.date ? "border-destructive" : ""}`}
                      data-testid="button-news-date"
                    >
                      <Calendar className="h-4 w-4 mr-2" />
                      {formData.date || "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={formData.date ? parseDate(formData.date) : undefined}
                      onSelect={(d) => {
                        if (d) {
                          setFormData((f) => ({ ...f, date: formatLongDate(d, "") }));
                          if (errors.date) setErrors(prev => ({ ...prev, date: undefined }));
                        }
                        setDatePickerOpen(false);
                      }}
                      data-testid="calendar-news-date"
                    />
                  </PopoverContent>
                </Popover>
                {errors.date && <p className="text-xs text-destructive mt-1">{errors.date}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Image <span className="text-destructive">*</span></Label>
              <input
                type="file"
                accept="image/*"
                ref={imageInputRef}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const base64 = ev.target?.result as string;
                      setFormData((f) => ({ ...f, image: base64, imageFileName: "" }));
                      setImageError(false);
                      if (errors.image) setErrors(prev => ({ ...prev, image: undefined }));
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                data-testid="input-news-image"
              />
              {formData.image && !imageError ? (
                <div className="flex items-center gap-3 mt-1.5">
                  <img
                    src={formData.image}
                    alt="Preview"
                    className="h-16 w-16 rounded object-cover"
                    onError={() => setImageError(true)}
                    data-testid="img-news-preview"
                  />
                  <span className="text-sm text-muted-foreground truncate flex-1">Image selected</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => {
                      setFormData((f) => ({ ...f, image: "" }));
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    }}
                    data-testid="button-remove-image"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className={`w-full mt-1.5 ${errors.image ? "border-destructive text-destructive" : ""}`}
                  onClick={() => imageInputRef.current?.click()}
                  data-testid="button-upload-image"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Image
                </Button>
              )}
              {errors.image && <p className="text-xs text-destructive mt-1">{errors.image}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Source Link</Label>
              <Input
                value={formData.link}
                onChange={(e) => {
                  setFormData((f) => ({ ...f, link: e.target.value }));
                  if (errors.link) setErrors(prev => ({ ...prev, link: undefined }));
                }}
                placeholder="https://example.com/article"
                data-testid="input-news-link"
                className={errors.link ? "border-destructive" : ""}
              />
              {errors.link && <p className="text-xs text-destructive mt-1">{errors.link}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Link to Investments</Label>
              <p className="text-xs text-muted-foreground">
                Show this article on the selected investment pages. Multi-select supported.
              </p>
              <MultiSelectPopover<number>
                options={investmentOptions}
                selected={formData.linkedInvestmentIds}
                onToggle={(id) =>
                  setFormData((f) => ({
                    ...f,
                    linkedInvestmentIds: f.linkedInvestmentIds.includes(id)
                      ? f.linkedInvestmentIds.filter((x) => x !== id)
                      : [...f.linkedInvestmentIds, id],
                  }))
                }
                placeholder={isLoadingInvestmentOptions ? "Loading..." : "Select Investments"}
                searchPlaceholder="Search investments…"
                emptyMessage={isLoadingInvestmentOptions ? "Loading…" : "No results"}
                showChips
                disabled={isLoadingInvestmentOptions}
                triggerClassName="h-10 px-3"
                testId="multiselect-news-linked-investments"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Link to Custom Pages</Label>
              <p className="text-xs text-muted-foreground">
                Show this article on the selected custom pages (the home page is included in this list). Multi-select supported.
              </p>
              <MultiSelectPopover<string>
                options={customPageOptions}
                selected={formData.linkedCustomPageSlugs}
                onToggle={(slug) =>
                  setFormData((f) => ({
                    ...f,
                    linkedCustomPageSlugs: f.linkedCustomPageSlugs.includes(slug)
                      ? f.linkedCustomPageSlugs.filter((x) => x !== slug)
                      : [...f.linkedCustomPageSlugs, slug],
                  }))
                }
                placeholder={isLoadingCustomPageOptions ? "Loading..." : "Select Custom Pages"}
                searchPlaceholder="Search custom pages…"
                emptyMessage={isLoadingCustomPageOptions ? "Loading…" : "No results"}
                showChips
                disabled={isLoadingCustomPageOptions}
                triggerClassName="h-10 px-3"
                testId="multiselect-news-linked-custom-pages"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={formData.status}
                onValueChange={(v) => setFormData((f) => ({ ...f, status: v as "Published" | "Draft" }))}
              >
                <SelectTrigger data-testid="select-news-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Draft">Draft</SelectItem>
                  <SelectItem value="Published">Published</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={isSaving} data-testid="button-cancel-news">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-[#405189] hover:bg-[#405189]/90 text-white min-w-[120px]"
              data-testid="button-save-news"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingArticle ? "Update Article" : "Add Article"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteTarget(null);
        }}
        title="Delete News Article"
        description={
          <span>
            Are you sure you want to delete{" "}
            <strong className="text-foreground">{deleteTarget?.title}</strong>?
            This action cannot be undone.
          </span>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
        dataTestId="dialog-delete-news"
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto" data-testid="dialog-preview-news">
          <DialogHeader>
            <DialogTitle data-testid="text-preview-title">Article Preview</DialogTitle>
          </DialogHeader>
          {previewArticle && (
            <div className="space-y-4 py-2">
              {previewArticle.image && (
                <img
                  src={previewArticle.image}
                  alt={previewArticle.title}
                  className="w-full h-48 object-contain rounded-md bg-muted"
                  onError={(e) => { (e.target as HTMLImageElement).src = catacapLogo; }}
                  data-testid="img-preview-image"
                />
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-xs border-0 ${mediumBadgeColor(previewArticle.medium)}`}>
                  {previewArticle.medium}
                </Badge>
                <Badge variant="secondary" className={`no-default-hover-elevate no-default-active-elevate text-xs border-0 ${statusBadge(previewArticle.status)}`}>
                  {previewArticle.status}
                </Badge>
                <span className="text-xs text-muted-foreground">{previewArticle.date}</span>
              </div>
              <h3 className="text-lg font-semibold" data-testid="text-preview-article-title">{previewArticle.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{previewArticle.description}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Audience: {previewArticle.audience}</span>
                <span>Theme: {previewArticle.theme}</span>
              </div>
              {previewArticle.link && (
                <a
                  href={previewArticle.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  data-testid="link-preview-article"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Read Full Article
                </a>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
