import { useState, useMemo, useRef } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "../components/ui/pagination-controls";
import { cn } from "@/lib/utils";
import { Search, Plus, ChevronLeft, ChevronRight, ArrowUpDown, Pencil, Trash2, Eye, Upload, X, GripVertical, Linkedin, ExternalLink } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { type TeamMember, type TeamListResponse, fetchTeamMembers, createTeamMember, updateTeamMember, deleteTeamMember, reorderTeamMembers } from "@/api/team/teamApi";
import { getUrlBlobContainerImage as getContainerImage } from "@/lib/image-utils";

// TeamMember and TeamListResponse interfaces are imported from @/api/team/teamApi
// getTeamImageUrl is imported from @/api/team/teamApi (Azure Blob Storage URL builder)
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Loader2 } from "lucide-react";

const emptyForm = {
  firstName: "",
  lastName: "",
  designation: "",
  description: "",
  image: "",
  linkedInUrl: "",
  isManagement: false
};

type SortField = "displayOrder" | "firstName" | "designation" | "isManagement";

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

function SortableRow({
  member,
  idx,
  currentPage,
  pageSize,
  onPreview,
  onEdit,
  onDelete,
  hasDeletePermission,
  dragDisabled
}: {
  member: TeamMember;
  idx: number;
  currentPage: number;
  pageSize: number;
  onPreview: (m: TeamMember) => void;
  onEdit: (m: TeamMember) => void;
  onDelete: (m: TeamMember) => void;
  hasDeletePermission: boolean;
  dragDisabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: member.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined
  };

  return (
    <tr ref={setNodeRef} style={style} className="border-b last:border-b-0 bg-background hover:bg-muted/20 transition-colors" data-testid={`row-team-${member.id}`}>
      <td className="px-4 py-3 text-muted-foreground">{(currentPage - 1) * pageSize + idx + 1}</td>
      <td className="px-4 py-3">
        <div className={cn("flex items-center justify-center p-1", dragDisabled ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing")} {...attributes} {...listeners} data-testid={`drag-handle-${member.id}`}>
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Avatar className="h-9 w-9">
          <AvatarImage src={getContainerImage(member.imageFileName)} alt={member.firstName} />
          <AvatarFallback className="text-xs bg-[#405189]/10 text-[#405189]">{getInitials(member.firstName, member.lastName)}</AvatarFallback>
        </Avatar>
      </td>
      <td className="px-4 py-3">
        <div>
          <div className="font-medium" data-testid={`text-name-${member.id}`}>
            {member.firstName} {member.lastName}
          </div>
          <div className="text-xs text-muted-foreground">{member.designation}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="max-w-xs truncate text-sm text-muted-foreground" title={member.description}>
          {member.description ? member.description.substring(0, 80) + (member.description.length > 80 ? "..." : "") : "—"}
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge
          className={`no-default-hover-elevate no-default-active-elevate border-0 ${
            member.isManagement ? "bg-[#405189]/10 text-[#405189] dark:bg-[#405189]/20 dark:text-blue-300" : "bg-muted text-muted-foreground"
          }`}
          data-testid={`badge-management-${member.id}`}
        >
          {member.isManagement ? "Management" : "Team"}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {member.linkedInUrl ? (
          <a
            href={member.linkedInUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-[#0077b5] hover:underline text-xs gap-1"
            data-testid={`link-linkedin-${member.id}`}
          >
            <Linkedin className="h-3.5 w-3.5" />
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
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
                  onClick={() => onPreview(member)}
                  data-testid={`button-preview-${member.id}`}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview member</TooltipContent>
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
                  onClick={() => onEdit(member)}
                  data-testid={`button-edit-${member.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit member</TooltipContent>
            </Tooltip>

            {hasDeletePermission && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                    onClick={() => onDelete(member)}
                    data-testid={`button-delete-${member.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete member</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function TeamManagement() {
  const { hasActionPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const [filterManagement, setFilterManagement] = useState("all");
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>(null, null);
  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [imageFileName, setImageFileName] = useState<string>("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewMember, setPreviewMember] = useState<TeamMember | null>(null);

  const { data, isLoading } = useQuery<TeamListResponse>({
    queryKey: ["/api/admin/team", sortField, sortDir],
    queryFn: () => fetchTeamMembers({ SortField: sortField || undefined, SortDirection: sortDir || undefined }),
    staleTime: 0,
    gcTime: 0
  });

  const members: TeamMember[] = data?.items ?? [];

  const createMutation = useMutation({
    mutationFn: createTeamMember,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      toast({ title: res.message ?? "Team member created successfully." });
      setFormOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to create team member.", variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateTeamMember,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      toast({ title: res.message ?? "Team member updated successfully." });
      setFormOpen(false);
    },
    onError: () => {
      toast({ title: "Failed to update team member.", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTeamMember,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
      toast({ title: res.message ?? "Team member deleted successfully." });
      setDeleteOpen(false);
      setDeletingMember(null);
    },
    onError: () => {
      toast({ title: "Failed to delete team member.", variant: "destructive" });
    }
  });

  const reorderMutation = useMutation({
    mutationFn: reorderTeamMembers,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/team"] });
    },
    onError: () => {
      toast({ title: "Failed to reorder team members.", variant: "destructive" });
    }
  });

  const filtered = useMemo(() => {
    let list = [...members];
    if (effectiveSearch) {
      const s = effectiveSearch.toLowerCase();
      list = list.filter(
        (m) => m.firstName.toLowerCase().includes(s) || m.lastName.toLowerCase().includes(s) || (m.fullName ?? "").toLowerCase().includes(s) || m.designation.toLowerCase().includes(s)
      );
    }
    if (filterManagement === "management") list = list.filter((m) => m.isManagement);
    if (filterManagement === "team") list = list.filter((m) => !m.isManagement);

    return list;
  }, [members, effectiveSearch, filterManagement, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (sortField || effectiveSearch || filterManagement !== "all") return;
    const oldIndex = paginated.findIndex((m) => m.id === active.id);
    const newIndex = paginated.findIndex((m) => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(paginated, oldIndex, newIndex);
    const reorderPayload = reordered.map((m, i) => ({
      id: m.id,
      displayOrder: (currentPage - 1) * pageSize + i + 1
    }));

    const queryKey = ["/api/admin/team", sortField, sortDir];
    queryClient.cancelQueries({ queryKey: ["/api/admin/team"] });
    const previousData = queryClient.getQueryData<TeamListResponse>(queryKey);

    if (previousData) {
      const updatedItems = previousData.items.map(item => {
        const match = reorderPayload.find(r => String(r.id) === String(item.id));
        return match ? { ...item, displayOrder: match.displayOrder } : item;
      });
      updatedItems.sort((a, b) => a.displayOrder - b.displayOrder);
      queryClient.setQueryData<TeamListResponse>(queryKey, {
        ...previousData,
        items: updatedItems
      });
    }

    reorderMutation.mutate(reorderPayload);
  }

  function openAdd() {
    setEditingMember(null);
    setFormData({ ...emptyForm });
    setImagePreview("");
    setImageFileName("");
    setFormOpen(true);
  }

  function openEdit(member: TeamMember) {
    setEditingMember(member);
    setFormData({
      firstName: member.firstName,
      lastName: member.lastName,
      designation: member.designation,
      description: member.description,
      image: "",
      linkedInUrl: member.linkedInUrl ?? "",
      isManagement: member.isManagement
    });
    setImagePreview(getContainerImage(member.imageFileName));
    setImageFileName(member.imageFileName ?? "");
    setFormOpen(true);
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      setErrors((prev) => ({ ...prev, image: "Please upload a JPG, PNG, or WebP image" }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setImagePreview(base64);
      setFormData((prev) => ({ ...prev, image: base64 }));
      setImageFileName("");
      if (errors.image)
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors.image;
          return newErrors;
        });
    };
    reader.readAsDataURL(file);
  }

  function handleSave() {
    const newErrors: Record<string, string> = {};
    if (!formData.firstName.trim()) newErrors.firstName = "First name is required";
    if (!formData.lastName.trim()) newErrors.lastName = "Last name is required";
    if (!formData.designation.trim()) newErrors.designation = "Designation is required";
    if (!formData.description.trim()) newErrors.description = "Description is required";
    if (!formData.image && !imageFileName) {
      newErrors.image = "Photo is required";
    }

    if (formData.linkedInUrl.trim() && !formData.linkedInUrl.startsWith("http://") && !formData.linkedInUrl.startsWith("https://")) {
      newErrors.linkedInUrl = "LinkedIn URL must start with http:// or https://";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (editingMember) {
      updateMutation.mutate({
        id: editingMember.id,
        firstName: formData.firstName,
        lastName: formData.lastName,
        designation: formData.designation,
        description: formData.description,
        image: formData.image || undefined,
        imageFileName: imageFileName,
        linkedInUrl: formData.linkedInUrl,
        isManagement: formData.isManagement
      });
    } else {
      createMutation.mutate({
        firstName: formData.firstName,
        lastName: formData.lastName,
        designation: formData.designation,
        description: formData.description,
        image: formData.image,
        linkedInUrl: formData.linkedInUrl,
        isManagement: formData.isManagement
      });
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const managementCount = members.filter((m) => m.isManagement).length;
  const teamCount = members.filter((m) => !m.isManagement).length;

  return (
    <AdminLayout title="Team Management">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">
            Team Management
          </h1>
          <p className="text-sm text-muted-foreground">Manage team members and leadership</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Members</div>
              <div className="text-2xl font-bold" data-testid="text-total-count">
                {members.length}
              </div>
              <div className="text-xs text-muted-foreground">all team members</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Management</div>
              <div className="text-2xl font-bold" data-testid="text-management-count">
                {managementCount}
              </div>
              <div className="text-xs text-muted-foreground">management members</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Team Members</div>
              <div className="text-2xl font-bold" data-testid="text-team-count">
                {teamCount}
              </div>
              <div className="text-xs text-muted-foreground">non-management</div>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-2 flex-1">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search members..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-members"
                />
              </div>
              <Select
                value={filterManagement}
                onValueChange={(v) => {
                  setFilterManagement(v);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-44" data-testid="select-filter-type">
                  <SelectValue placeholder="All Members" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Members</SelectItem>
                  <SelectItem value="management">Management</SelectItem>
                  <SelectItem value="team">Team Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openAdd} className="bg-[#405189] text-white" data-testid="button-add-member">
              <Plus className="h-4 w-4 mr-2" />
              Add Member
            </Button>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={paginated.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                  <table className="w-full text-sm" data-testid="table-team">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <SortHeader
                          field="displayOrder"
                          sortField={sortField}
                          sortDir={sortDir}
                          handleSort={handleSort}
                          className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12 select-none"
                        >
                          #
                        </SortHeader>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-10"></th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12">Photo</th>
                        <SortHeader
                          field="firstName"
                          sortField={sortField}
                          sortDir={sortDir}
                          handleSort={handleSort}
                          className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none"
                        >
                          Name
                        </SortHeader>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</th>
                        <SortHeader
                          field="isManagement"
                          sortField={sortField}
                          sortDir={sortDir}
                          handleSort={handleSort}
                          className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none"
                        >
                          Type
                        </SortHeader>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">LinkedIn</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-muted-foreground">
                            Loading team members...
                          </td>
                        </tr>
                      ) : paginated.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-muted-foreground">
                            No team members found matching your filters.
                          </td>
                        </tr>
                      ) : (
                        paginated.map((member, idx) => (
                          <SortableRow
                            key={member.id}
                            member={member}
                            idx={idx}
                            currentPage={currentPage}
                            pageSize={pageSize}
                            onPreview={(m) => {
                              setPreviewMember(m);
                              setPreviewOpen(true);
                            }}
                            onEdit={openEdit}
                            onDelete={(m) => {
                              setDeletingMember(m);
                              setDeleteOpen(true);
                            }}
                            hasDeletePermission={hasActionPermission("team management", "delete")}
                            dragDisabled={!!sortField || !!effectiveSearch || filterManagement !== "all"}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </SortableContext>
              </DndContext>
            </div>

            <PaginationControls
              currentPage={currentPage}
              totalCount={filtered.length}
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
            setEditingMember(null);
            setFormData({ ...emptyForm });
            setImagePreview("");
            setImageFileName("");
            setErrors({});
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-team-form">
          <DialogHeader>
            <DialogTitle>{editingMember ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">
                  First Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => {
                    setFormData((p) => ({ ...p, firstName: e.target.value }));
                    if (errors.firstName)
                      setErrors((prev) => {
                        const n = { ...prev };
                        delete n.firstName;
                        return n;
                      });
                  }}
                  placeholder="First name"
                  className={errors.firstName ? "border-destructive focus-visible:ring-destructive" : ""}
                  data-testid="input-first-name"
                />
                {errors.firstName && <p className="text-xs text-destructive mt-1">{errors.firstName}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">
                  Last Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => {
                    setFormData((p) => ({ ...p, lastName: e.target.value }));
                    if (errors.lastName)
                      setErrors((prev) => {
                        const n = { ...prev };
                        delete n.lastName;
                        return n;
                      });
                  }}
                  placeholder="Last name"
                  className={errors.lastName ? "border-destructive focus-visible:ring-destructive" : ""}
                  data-testid="input-last-name"
                />
                {errors.lastName && <p className="text-xs text-destructive mt-1">{errors.lastName}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="designation">
                Designation <span className="text-destructive">*</span>
              </Label>
              <Input
                id="designation"
                value={formData.designation}
                onChange={(e) => {
                  setFormData((p) => ({ ...p, designation: e.target.value }));
                  if (errors.designation)
                    setErrors((prev) => {
                      const n = { ...prev };
                      delete n.designation;
                      return n;
                    });
                }}
                placeholder="e.g. Co-Founder & CEO"
                className={errors.designation ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-designation"
              />
              {errors.designation && <p className="text-xs text-destructive mt-1">{errors.designation}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => {
                  setFormData((p) => ({ ...p, description: e.target.value }));
                  if (errors.description)
                    setErrors((prev) => {
                      const n = { ...prev };
                      delete n.description;
                      return n;
                    });
                }}
                placeholder="Brief bio or description..."
                rows={4}
                className={errors.description ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-description"
              />
              {errors.description && <p className="text-xs text-destructive mt-1">{errors.description}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="linkedInUrl">LinkedIn URL</Label>
              <Input
                id="linkedInUrl"
                value={formData.linkedInUrl}
                onChange={(e) => {
                  setFormData((p) => ({ ...p, linkedInUrl: e.target.value }));
                  if (errors.linkedInUrl)
                    setErrors((prev) => {
                      const n = { ...prev };
                      delete n.linkedInUrl;
                      return n;
                    });
                }}
                placeholder="https://www.linkedin.com/in/..."
                className={errors.linkedInUrl ? "border-destructive focus-visible:ring-destructive" : ""}
                data-testid="input-linkedin-url"
              />
              {errors.linkedInUrl && <p className="text-xs text-destructive mt-1">{errors.linkedInUrl}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>
                Photo <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-3">
                {imagePreview ? (
                  <div className="relative">
                    <Avatar className={`h-16 w-16 ${errors.image ? "ring-2 ring-destructive ring-offset-2" : ""}`}>
                      <AvatarImage src={imagePreview} alt="Preview" />
                      <AvatarFallback className="text-xs">
                        {formData.firstName.charAt(0)}
                        {formData.lastName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                      onClick={() => {
                        setImagePreview("");
                        setFormData((p) => ({ ...p, image: "" }));
                        setImageFileName("");
                      }}
                      data-testid="button-remove-image"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    className={`h-16 w-16 rounded-full border-2 border-dashed flex items-center justify-center ${errors.image ? "border-destructive bg-destructive/5" : "border-muted-foreground/30"}`}
                  >
                    <Upload className={`h-5 w-5 ${errors.image ? "text-destructive" : "text-muted-foreground/50"}`} />
                  </div>
                )}
                <div className="flex-1">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => {
                      handleImageChange(e);
                      if (errors.image)
                        setErrors((prev) => {
                          const n = { ...prev };
                          delete n.image;
                          return n;
                        });
                    }}
                    data-testid="input-photo-file"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => photoInputRef.current?.click()}
                    className={errors.image ? "border-destructive text-destructive hover:bg-destructive/5" : ""}
                    data-testid="button-upload-photo"
                  >
                    <Upload className="h-3.5 w-3.5 mr-2" />
                    {imagePreview ? "Change Photo" : "Upload Photo"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP recommended</p>
                </div>
              </div>
              {errors.image && <p className="text-xs text-destructive mt-0.5">{errors.image}</p>}
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="isManagement" className="text-sm font-medium">
                  Management Team
                </Label>
                <p className="text-xs text-muted-foreground">Mark as part of the management/leadership team</p>
              </div>
              <Switch id="isManagement" checked={formData.isManagement} onCheckedChange={(v) => setFormData((p) => ({ ...p, isManagement: v }))} data-testid="switch-is-management" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} data-testid="button-cancel-form">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving} data-testid="button-save-member" className="bg-[#405189] text-white hover:bg-[#405189]/90 min-w-[120px]">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingMember ? "Update Member" : "Add Member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeletingMember(null);
        }}
        title="Delete Team Member"
        description={
          <span>
            Are you sure you want to delete{" "}
            <strong className="text-foreground break-words">
              {deletingMember?.firstName} {deletingMember?.lastName}
            </strong>
            ? This action cannot be undone.
          </span>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => deletingMember && deleteMutation.mutate(deletingMember.id)}
        isSubmitting={deleteMutation.isPending}
        confirmButtonClass="bg-destructive text-white hover:bg-destructive/90"
        dataTestId="dialog-delete-confirm"
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-preview">
          <DialogHeader>
            <DialogTitle>Team Member Preview</DialogTitle>
          </DialogHeader>
          {previewMember && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  <AvatarImage src={getContainerImage(previewMember.imageFileName)} alt={previewMember.firstName} />
                  <AvatarFallback className="text-lg bg-[#405189]/10 text-[#405189]">{getInitials(previewMember.firstName, previewMember.lastName)}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-lg" data-testid="preview-name">
                    {previewMember.firstName} {previewMember.lastName}
                  </div>
                  <div className="text-sm text-muted-foreground">{previewMember.designation}</div>
                  <Badge
                    className={`mt-1 no-default-hover-elevate no-default-active-elevate border-0 text-xs ${
                      previewMember.isManagement ? "bg-[#405189]/10 text-[#405189] dark:bg-[#405189]/20 dark:text-blue-300" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {previewMember.isManagement ? "Management" : "Team"}
                  </Badge>
                </div>
              </div>
              {previewMember.description && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bio</Label>
                  <p className="text-sm mt-1 leading-relaxed">{previewMember.description}</p>
                </div>
              )}
              {previewMember.linkedInUrl && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">LinkedIn</Label>
                  <a
                    href={previewMember.linkedInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 mt-1 text-sm text-[#0077b5] hover:underline"
                    data-testid="preview-linkedin"
                  >
                    <Linkedin className="h-4 w-4" />
                    {previewMember.linkedInUrl}
                  </a>
                </div>
              )}
              <div className="text-xs text-muted-foreground">Display Order: {previewMember.displayOrder}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)} data-testid="button-close-preview">
              Close
            </Button>
            {previewMember && (
              <Button
                onClick={() => {
                  setPreviewOpen(false);
                  openEdit(previewMember);
                }}
                data-testid="button-edit-from-preview"
              >
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
