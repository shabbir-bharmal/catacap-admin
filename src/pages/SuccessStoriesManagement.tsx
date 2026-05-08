import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTestimonials,
  fetchTestimonialById,
  deleteTestimonial,
  createOrUpdateTestimonial,
  TestimonialCreateUpdatePayload,
} from "@/api/testimonial/testimonialApi";
import { fetchAllInvestmentNameList, type InvestmentNameListItem } from "../api/investment/investmentApi";
import { fetchCustomPages } from "../api/event/customPagesApi";
import { MultiSelectPopover, type MultiSelectOption } from "@/components/MultiSelectPopover";
import { getUrlBlobContainerImage as getContainerImage } from "@/lib/image-utils";
import { fetchUsersDropdown, UserDropdownItem } from "@/api/user/userApi";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Search, Plus, ChevronLeft, ChevronRight, ArrowUpDown, Pencil, Trash2, Eye, Minus, Check, ChevronsUpDown, ChevronDown, Loader2, Video, Link2 } from "lucide-react";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { useSort } from "@/hooks/useSort";
import { useDebounce } from "@/hooks/useDebounce";
import { SortHeader } from "@/components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";
import { cn } from "@/lib/utils";

type Perspective = "funder" | "investee";

interface Stat {
  value: string;
  label: string;
}

interface SuccessStory {
  id: number;
  perspective: Perspective;
  quote: string;
  stats: Stat[];
  personName: string;
  personTitle: string;
  personOrg: string;
  personImage: string;
  status: "Active" | "Draft";
  order: number;
  videoLink: string | null;
  linkedInvestmentIds: number[];
  linkedCustomPageSlugs: string[];
}

const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  funder: "Investment",
  investee: "Donor Investor"
};

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function getVideoEmbedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([^/?#]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
      return null;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
      return null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      if (/^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

const emptyForm = {
  perspective: "funder" as Perspective,
  quote: "",
  stats: [{ value: "", label: "" }] as Stat[],
  selectedUserId: "",
  personName: "",
  personTitle: "",
  personOrg: "",
  personImage: "",
  status: "Active" as "Active" | "Draft",
  videoLink: "",
  linkedInvestmentIds: [] as number[],
  linkedCustomPageSlugs: [] as string[],
};

type SortField = "person" | "perspective" | "displayorder" | "status";

export default function SuccessStoriesManagement() {
  const { toast } = useToast();
  const { hasActionPermission } = useAuth();
  const [stories, setStories] = useState<SuccessStory[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [usersDropdown, setUsersDropdown] = useState<UserDropdownItem[]>([]);

  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const [filterPerspective, setFilterPerspective] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>(null, null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStory, setEditingStory] = useState<SuccessStory | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingStory, setDeletingStory] = useState<SuccessStory | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStory, setPreviewStory] = useState<SuccessStory | null>(null);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const investmentsListQuery = useQuery({
    queryKey: ["testimonial-link-investments"],
    queryFn: () => fetchAllInvestmentNameList(0, 0),
    staleTime: 5 * 60 * 1000,
  });
  const customPagesListQuery = useQuery({
    queryKey: ["testimonial-link-custom-pages"],
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

  function toggleInvestmentLinkId(id: number) {
    setFormData((prev) => {
      const current = prev.linkedInvestmentIds;
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      return { ...prev, linkedInvestmentIds: next };
    });
  }

  function toggleCustomPageLinkId(slug: string) {
    setFormData((prev) => {
      const current = prev.linkedCustomPageSlugs;
      const next = current.includes(slug) ? current.filter((x) => x !== slug) : [...current, slug];
      return { ...prev, linkedCustomPageSlugs: next };
    });
  }

  const loadStories = async () => {
    try {
      const params = {
        Search: effectiveSearch || undefined,
        PerspectiveText: filterPerspective === "funder" ? "INVESTMENT" : filterPerspective === "investee" ? "DONOR INVESTOR" : undefined,
        Status: filterStatus === "all" ? undefined : filterStatus,
        SortField: sortField || undefined,
        SortDirection: sortDir || undefined,
        CurrentPage: currentPage,
        PerPage: rowsPerPage
      };
      const data = await fetchTestimonials(params);
      const mappedStories: SuccessStory[] = data.items.map((item) => ({
        id: item.id,
        perspective: item.perspectiveText?.toUpperCase().includes("INVESTMENT") ? "funder" : "investee",
        quote: item.description || "",
        stats: item.metrics ? item.metrics.map((m) => ({ value: m.value, label: m.key })) : [],
        personName: item.userFullName || "",
        personTitle: item.role || "",
        personOrg: item.organizationName || "",
        personImage: getContainerImage(item.profilePicture),
        status: item.status ? "Active" : "Draft",
        order: item.displayOrder ?? item.id,
        videoLink: item.videoLink ?? null,
        linkedInvestmentIds: Array.isArray(item.linkedInvestmentIds) ? item.linkedInvestmentIds : [],
        linkedCustomPageSlugs: Array.isArray(item.linkedCustomPageSlugs) ? item.linkedCustomPageSlugs : [],
      }));
      setStories(mappedStories);
      setTotalCount(data.totalCount);
    } catch (error) {
      console.error("Failed to fetch testimonials:", error);
      toast({ title: "Failed to load testimonials", variant: "destructive" });
    }
  };

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        const users = await fetchUsersDropdown();
        setUsersDropdown(users);
      } catch (error) {
        console.error("Failed to initialize data:", error);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  useEffect(() => {
    loadStories();
  }, [effectiveSearch, filterPerspective, filterStatus, sortField, sortDir, currentPage, rowsPerPage]);

  const toggleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);
  const paginated = stories;

  function openAdd() {
    setEditingStory(null);
    setFormData({ ...emptyForm, stats: [{ value: "", label: "" }], linkedInvestmentIds: [], linkedCustomPageSlugs: [] });
    setFormOpen(true);
  }

  function closeDialog() {
    setFormOpen(false);
    setEditingStory(null);
    setFormData({ ...emptyForm, stats: [{ value: "", label: "" }], linkedInvestmentIds: [], linkedCustomPageSlugs: [] });
    setErrors({});
  }

  async function openEdit(story: SuccessStory) {
    setEditingStory(story);
    const matchedUser = usersDropdown.find((u) => u.fullName === story.personName);
    setFormData({
      perspective: story.perspective,
      quote: story.quote,
      stats: story.stats.length > 0 ? story.stats.map((s) => ({ ...s })) : [{ value: "", label: "" }],
      selectedUserId: matchedUser?.id || "",
      personName: story.personName,
      personTitle: story.personTitle,
      personOrg: story.personOrg,
      personImage: story.personImage,
      status: story.status,
      videoLink: story.videoLink ?? "",
      linkedInvestmentIds: [...story.linkedInvestmentIds],
      linkedCustomPageSlugs: [...story.linkedCustomPageSlugs],
    });
    setErrors({});
    setFormOpen(true);

    try {
      const detail = await fetchTestimonialById(story.id);
      setFormData((prev) => ({
        ...prev,
        videoLink: detail.videoLink ?? "",
        linkedInvestmentIds: Array.isArray(detail.linkedInvestmentIds) ? [...detail.linkedInvestmentIds] : [],
        linkedCustomPageSlugs: Array.isArray(detail.linkedCustomPageSlugs) ? [...detail.linkedCustomPageSlugs] : [],
      }));
    } catch (err) {
      console.error("Failed to load testimonial detail:", err);
    }
  }

  async function handleSave() {
    const newErrors: Record<string, string> = {};
    if (!formData.quote.trim()) newErrors.quote = "Quote is required";
    if (!formData.selectedUserId) newErrors.person = "Person is required";
    if (!formData.personTitle.trim()) newErrors.personTitle = "Title / Role is required";
    const trimmedVideoLink = formData.videoLink.trim();
    if (trimmedVideoLink.length > 0 && !isValidUrl(trimmedVideoLink)) {
      newErrors.videoLink = "Enter a valid http(s) URL";
    }

    const stats: Stat[] = formData.stats.filter((s) => s.value.trim() || s.label.trim());
    if (stats.length === 0) {
      newErrors.stats = "At least one impact stat is required";
    } else {
      // Check if the filled stats are complete
      const incomplete = stats.some((s) => !s.value.trim() || !s.label.trim());
      if (incomplete) {
        newErrors.stats = "All filled stats must have both a value and a label";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast({ title: "Please fix validation errors", variant: "destructive" });
      return;
    }

    setIsSaving(true);
    try {
      const displayOrder = editingStory ? editingStory.order : stories.length > 0 ? Math.max(...stories.map((st) => st.order)) + 1 : 1;

      const payload: TestimonialCreateUpdatePayload = {
        id: editingStory ? editingStory.id : undefined,
        displayOrder,
        perspectiveText: formData.perspective === "funder" ? "INVESTMENT" : "DONOR INVESTOR",
        description: formData.quote.trim(),
        metrics: stats.map((s) => ({ key: s.label.trim(), value: s.value.trim() })),
        role: formData.personTitle.trim(),
        organizationName: formData.personOrg?.trim(),
        userId: formData.selectedUserId,
        status: formData.status === "Active",
        videoLink: trimmedVideoLink.length > 0 ? trimmedVideoLink : null,
        linkedInvestmentIds: [...formData.linkedInvestmentIds],
        linkedCustomPageSlugs: [...formData.linkedCustomPageSlugs],
      };

      await createOrUpdateTestimonial(payload);
      await loadStories();

      if (editingStory) {
        toast({ title: "Success story updated successfully" });
      } else {
        toast({ title: "Success story added successfully" });
      }
      setFormOpen(false);
    } catch (error) {
      console.error("Failed to save success story:", error);
      toast({ title: "Failed to save success story", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingStory) return;
    setIsDeleting(true);
    try {
      await deleteTestimonial(deletingStory.id);
      setStories((prev) => prev.filter((st) => st.id !== deletingStory.id));
      toast({ title: "Success story deleted successfully" });
    } catch (error) {
      console.error("Failed to delete success story:", error);
      toast({ title: "Failed to delete success story", variant: "destructive" });
    } finally {
      setDeleteOpen(false);
      setDeletingStory(null);
      setIsDeleting(false);
    }
  }

  const perspectiveStats = useMemo(() => {
    const stats = { funder: 0, investee: 0 };
    stories.forEach((st) => {
      if (st.status === "Active") stats[st.perspective]++;
    });
    return stats;
  }, [stories]);

  return (
    <AdminLayout title="Success Stories">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">
            Success Stories
          </h1>
          <p className="text-sm text-muted-foreground">Manage success stories from funders and investees</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Stories</div>
              <div className="text-2xl font-bold" data-testid="text-total-count">
                {stories.filter((s) => s.status === "Active").length}
              </div>
              <div className="text-xs text-muted-foreground">active stories</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Investment Stories</div>
              <div className="text-2xl font-bold" data-testid="text-funder-count">
                {perspectiveStats.funder}
              </div>
              <div className="text-xs text-muted-foreground">active stories</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Donor Investor Stories</div>
              <div className="text-2xl font-bold" data-testid="text-investee-count">
                {perspectiveStats.investee}
              </div>
              <div className="text-xs text-muted-foreground">active stories</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search Person..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-stories"
                />
              </div>
              <Select
                value={filterPerspective}
                onValueChange={(v) => {
                  setFilterPerspective(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-48" data-testid="select-filter-perspective">
                  <SelectValue placeholder="Perspective" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Perspectives</SelectItem>
                  <SelectItem value="funder">Investment</SelectItem>
                  <SelectItem value="investee">Donor Investor</SelectItem>
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
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openAdd} className="bg-[#405189] text-white" data-testid="button-add-story">
              <Plus className="h-4 w-4 mr-2" />
              Add Story
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-stories">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader
                      field="displayorder"
                      sortField={sortField}
                      sortDir={sortDir}
                      handleSort={toggleSort}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12 select-none"
                    >
                      #
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-16">Photo</th>
                    <SortHeader
                      field="person"
                      sortField={sortField}
                      sortDir={sortDir}
                      handleSort={toggleSort}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none"
                    >
                      Person
                    </SortHeader>
                    <SortHeader
                      field="perspective"
                      sortField={sortField}
                      sortDir={sortDir}
                      handleSort={toggleSort}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none"
                    >
                      Perspective
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quote</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stats</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Video</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Linked To</th>
                    <SortHeader
                      field="status"
                      sortField={sortField}
                      sortDir={sortDir}
                      handleSort={toggleSort}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none"
                    >
                      Status
                    </SortHeader>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((story) => (
                    <tr key={story.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-story-${story.id}`}>
                      <td className="px-4 py-3 text-muted-foreground">{story.order}</td>
                      <td className="px-4 py-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={story.personImage} alt={story.personName} />
                          <AvatarFallback>
                            {story.personName
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <div className="font-medium" data-testid={`text-name-${story.id}`}>
                            {story.personName}
                          </div>
                          <div className="text-xs text-muted-foreground">{story.personTitle}</div>
                          <div className="text-xs text-muted-foreground">{story.personOrg}</div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={story.perspective === "funder" ? "default" : "secondary"}>{PERSPECTIVE_LABELS[story.perspective]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-xs truncate text-muted-foreground" title={story.quote}>
                          {story.quote.substring(0, 80)}...
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          {story.stats.map((stat, i) => (
                            <div key={i} className="text-center">
                              <div className="text-xs font-semibold">{stat.value}</div>
                              <div className="text-[10px] text-muted-foreground">{stat.label}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3" data-testid={`cell-video-${story.id}`}>
                        {story.videoLink ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={story.videoLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-primary hover:underline"
                                data-testid={`link-video-${story.id}`}
                              >
                                <Video className="h-4 w-4" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent>Watch video</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" data-testid={`cell-link-summary-${story.id}`}>
                        {story.linkedInvestmentIds.length > 0 || story.linkedCustomPageSlugs.length > 0 ? (
                          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                            {story.linkedInvestmentIds.length > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Link2 className="h-3.5 w-3.5" />
                                {story.linkedInvestmentIds.length} investment
                                {story.linkedInvestmentIds.length === 1 ? "" : "s"}
                              </span>
                            )}
                            {story.linkedCustomPageSlugs.length > 0 && (
                              <span className="inline-flex items-center gap-1">
                                <Link2 className="h-3.5 w-3.5" />
                                {story.linkedCustomPageSlugs.length} custom page
                                {story.linkedCustomPageSlugs.length === 1 ? "" : "s"}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={`no-default-hover-elevate no-default-active-elevate border-0 ${story.status === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
                        >
                          {story.status}
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
                                  onClick={() => {
                                    setPreviewStory(story);
                                    setPreviewOpen(true);
                                  }}
                                  data-testid={`button-preview-${story.id}`}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Preview story</TooltipContent>
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className={cn(
                                    "h-8 w-8 text-[#f7b84b] hover:text-[#f7b84b] hover:bg-[#f7b84b]/5",
                                    hasActionPermission("content management", "delete") ? "rounded-none border-r-0" : "rounded-l-none"
                                  )}
                                  onClick={() => openEdit(story)}
                                  data-testid={`button-edit-${story.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit story</TooltipContent>
                            </Tooltip>

                            {hasActionPermission("content management", "delete") && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                    onClick={() => {
                                      setDeletingStory(story);
                                      setDeleteOpen(true);
                                    }}
                                    data-testid={`button-delete-${story.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Delete story</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginated.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-muted-foreground">
                        No success stories found matching your filters.
                      </td>
                    </tr>
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
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-story-form">
          <DialogHeader>
            <DialogTitle>{editingStory ? "Edit Success Story" : "Add Success Story"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>
                  Perspective <span className="text-destructive">*</span>
                </Label>
                <Select value={formData.perspective} onValueChange={(v) => setFormData({ ...formData, perspective: v as Perspective })}>
                  <SelectTrigger data-testid="input-story-perspective">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="funder">Investment</SelectItem>
                    <SelectItem value="investee">Donor Investor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v as "Active" | "Draft" })}>
                  <SelectTrigger data-testid="input-story-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>
                Quote <span className="text-destructive">*</span>
              </Label>
              <Textarea
                value={formData.quote}
                onChange={(e) => {
                  setFormData({ ...formData, quote: e.target.value });
                  if (errors.quote)
                    setErrors((prev) => {
                      const n = { ...prev };
                      delete n.quote;
                      return n;
                    });
                }}
                placeholder="Enter the testimonial quote..."
                rows={4}
                className={errors.quote ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-story-quote"
              />
              {errors.quote && <p className="text-xs text-destructive mt-1">{errors.quote}</p>}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">
                  Impact Stats <span className="text-destructive">*</span>
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="bg-[#405189] text-white"
                  onClick={() => setFormData({ ...formData, stats: [...formData.stats, { value: "", label: "" }] })}
                  data-testid="button-add-stat"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add stat
                </Button>
              </div>
              {errors.stats && <p className="text-xs text-destructive">{errors.stats}</p>}
              {formData.stats.map((stat, index) => (
                <div key={index} className="flex items-end gap-2" data-testid={`stat-row-${index}`}>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Value</Label>
                    <Input
                      value={stat.value}
                      onChange={(e) => {
                        const updated = [...formData.stats];
                        updated[index] = { ...updated[index], value: e.target.value };
                        setFormData({ ...formData, stats: updated });
                      }}
                      placeholder="e.g. $500K"
                      className={errors.stats && (!stat.value.trim() || !stat.label.trim()) ? "border-destructive focus-visible:ring-destructive" : ""}
                      data-testid={`input-stat-value-${index}`}
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Label</Label>
                    <Input
                      value={stat.label}
                      onChange={(e) => {
                        const updated = [...formData.stats];
                        updated[index] = { ...updated[index], label: e.target.value };
                        setFormData({ ...formData, stats: updated });
                      }}
                      placeholder="e.g. Invested"
                      className={errors.stats && (!stat.value.trim() || !stat.label.trim()) ? "border-destructive focus-visible:ring-destructive" : ""}
                      data-testid={`input-stat-label-${index}`}
                    />
                  </div>
                  {formData.stats.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive shrink-0 mb-0.5"
                      onClick={() => {
                        const updated = formData.stats.filter((_, i) => i !== index);
                        setFormData({ ...formData, stats: updated });
                        if (errors.stats)
                          setErrors((prev) => {
                            const n = { ...prev };
                            delete n.stats;
                            return n;
                          });
                      }}
                      data-testid={`button-remove-stat-${index}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div>
              <Label>
                Person <span className="text-destructive">*</span>
              </Label>
              <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={`w-full justify-between font-normal mt-0.5 ${errors.person ? "!border-destructive" : ""}`} data-testid="input-story-person-name">
                    <span className="truncate">{formData.selectedUserId ? usersDropdown.find((u) => u.id === formData.selectedUserId)?.fullName || "Select a user..." : "Select a user..."}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" style={{ minWidth: "var(--radix-popover-trigger-width)" }}>
                  <Command>
                    <CommandInput placeholder="Search user..." />
                    <CommandList className="max-h-[264px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
                      <CommandEmpty>No user found.</CommandEmpty>
                      <CommandGroup>
                        {usersDropdown.map((user) => (
                          <CommandItem
                            key={user.id}
                            value={`${user.fullName} ${user.email}`}
                            onSelect={() => {
                              setFormData({
                                ...formData,
                                selectedUserId: user.id,
                                personName: user.fullName
                              });
                              if (errors.person)
                                setErrors((prev) => {
                                  const n = { ...prev };
                                  delete n.person;
                                  return n;
                                });
                              setUserPopoverOpen(false);
                            }}
                          >
                            <Check className={`h-4 w-4 mr-2 shrink-0 ${formData.selectedUserId === user.id ? "opacity-100" : "opacity-0"}`} />
                            <div className="flex flex-col">
                              <span className="text-sm">{user.fullName}</span>
                              <span className="text-xs text-muted-foreground">{user.email}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {errors.person && <p className="text-xs text-destructive mt-1">{errors.person}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>
                  Title / Role <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={formData.personTitle}
                  onChange={(e) => {
                    setFormData({ ...formData, personTitle: e.target.value });
                    if (errors.personTitle)
                      setErrors((prev) => {
                        const n = { ...prev };
                        delete n.personTitle;
                        return n;
                      });
                  }}
                  placeholder="e.g. Founder & CEO"
                  className={errors.personTitle ? "border-destructive focus-visible:ring-destructive" : ""}
                  data-testid="input-story-person-title"
                />
                {errors.personTitle && <p className="text-xs text-destructive mt-1">{errors.personTitle}</p>}
              </div>
              <div>
                <Label>Organization</Label>
                <Input
                  value={formData.personOrg}
                  onChange={(e) => setFormData({ ...formData, personOrg: e.target.value })}
                  placeholder="Company or foundation name"
                  data-testid="input-story-person-org"
                />
              </div>
            </div>

            <div>
              <Label>Video Link</Label>
              <Input
                type="url"
                value={formData.videoLink}
                onChange={(e) => {
                  setFormData({ ...formData, videoLink: e.target.value });
                  if (errors.videoLink)
                    setErrors((prev) => {
                      const n = { ...prev };
                      delete n.videoLink;
                      return n;
                    });
                }}
                placeholder="https://www.youtube.com/watch?v=…"
                className={errors.videoLink ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-story-video-link"
              />
              {errors.videoLink && <p className="text-xs text-destructive mt-1">{errors.videoLink}</p>}
            </div>

            <div className="space-y-2">
              <Label>Link to Investments</Label>
              <p className="text-xs text-muted-foreground">
                Show this story on the selected investment pages. Multi-select supported.
              </p>
              <MultiSelectPopover<number>
                options={investmentOptions}
                selected={formData.linkedInvestmentIds}
                onToggle={toggleInvestmentLinkId}
                placeholder={isLoadingInvestmentOptions ? "Loading..." : "Select Investments"}
                searchPlaceholder="Search investments…"
                emptyMessage={isLoadingInvestmentOptions ? "Loading…" : "No results"}
                showChips
                disabled={isLoadingInvestmentOptions}
                triggerClassName="h-10 px-3"
                testId="multiselect-story-linked-investments"
              />
            </div>

            <div className="space-y-2">
              <Label>Link to Custom Pages</Label>
              <p className="text-xs text-muted-foreground">
                Show this story on the selected custom pages (the home page is included in this list). Multi-select supported.
              </p>
              <MultiSelectPopover<string>
                options={customPageOptions}
                selected={formData.linkedCustomPageSlugs}
                onToggle={toggleCustomPageLinkId}
                placeholder={isLoadingCustomPageOptions ? "Loading..." : "Select Custom Pages"}
                searchPlaceholder="Search custom pages…"
                emptyMessage={isLoadingCustomPageOptions ? "Loading…" : "No results"}
                showChips
                disabled={isLoadingCustomPageOptions}
                triggerClassName="h-10 px-3"
                testId="multiselect-story-linked-custom-pages"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={isSaving} data-testid="button-cancel-story">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} className="bg-[#405189] text-white hover:bg-[#405189]/90 min-w-[120px]" data-testid="button-save-story">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingStory ? "Save Changes" : "Add Story"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeletingStory(null);
        }}
        title="Delete Success Story"
        description={<span>Are you sure you want to delete this success story? This action cannot be undone.</span>}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDelete}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-destructive text-white hover:bg-destructive/90"
        dataTestId="dialog-delete-story"
      >
        {deletingStory && (
          <div className="bg-muted/50 rounded-md p-3 text-sm mt-4">
            <div className="font-medium">{deletingStory.personName}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {PERSPECTIVE_LABELS[deletingStory.perspective as Perspective]} - {deletingStory.personOrg}
            </div>
          </div>
        )}
      </ConfirmationDialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-preview-story">
          <DialogHeader>
            <DialogTitle>Preview Success Story</DialogTitle>
          </DialogHeader>
          {previewStory && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2">
                <Badge variant={previewStory.perspective === "funder" ? "default" : "secondary"}>{PERSPECTIVE_LABELS[previewStory.perspective as Perspective]}</Badge>
                <Badge
                  className={`no-default-hover-elevate no-default-active-elevate border-0 ${previewStory.status === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
                >
                  {previewStory.status}
                </Badge>
              </div>

              <div className="bg-muted/30 rounded-md p-4">
                <p className="text-sm leading-relaxed italic">"{previewStory.quote}"</p>
              </div>

              <div className="flex gap-6 justify-center py-2">
                {previewStory.stats.map((stat, i) => (
                  <div key={i} className="text-center">
                    <div className="text-lg font-bold">{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={previewStory.personImage} alt={previewStory.personName} />
                  <AvatarFallback>
                    {previewStory.personName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold">{previewStory.personName}</div>
                  <div className="text-sm text-muted-foreground">{previewStory.personTitle}</div>
                  <div className="text-sm text-muted-foreground">{previewStory.personOrg}</div>
                </div>
              </div>

              {previewStory.videoLink && (
                <div className="space-y-2 pt-2" data-testid="preview-video">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Video className="h-4 w-4" /> Video
                  </div>
                  {(() => {
                    const embed = getVideoEmbedUrl(previewStory.videoLink);
                    return embed ? (
                      <div className="aspect-video w-full overflow-hidden rounded-md bg-black">
                        <iframe
                          src={embed}
                          title="Success story video"
                          className="h-full w-full"
                          frameBorder={0}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      </div>
                    ) : null;
                  })()}
                  <a
                    href={previewStory.videoLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline break-all"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    {previewStory.videoLink}
                  </a>
                </div>
              )}

              {(previewStory.linkedInvestmentIds.length > 0 || previewStory.linkedCustomPageSlugs.length > 0) && (
                <div className="space-y-2 pt-2 border-t" data-testid="preview-links">
                  <div className="text-sm font-medium">Linked To</div>
                  {previewStory.linkedInvestmentIds.length > 0 && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Investments: </span>
                      {previewStory.linkedInvestmentIds
                        .map((id) => {
                          const opt = investmentOptions.find((o) => o.id === id);
                          return opt ? opt.name : `#${id}`;
                        })
                        .join(", ")}
                    </div>
                  )}
                  {previewStory.linkedCustomPageSlugs.length > 0 && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Custom Pages: </span>
                      {previewStory.linkedCustomPageSlugs
                        .map((slug) => {
                          const opt = customPageOptions.find((o) => o.id === slug);
                          return opt ? opt.name : slug;
                        })
                        .join(", ")}
                    </div>
                  )}
                </div>
              )}
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
