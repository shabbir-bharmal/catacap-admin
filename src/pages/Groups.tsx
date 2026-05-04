import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Link } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Search, Download, Check, X, Pencil, Eye, History, Crown, Users as UsersIcon, Loader2, Trash2, BarChart3, TrendingUp } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { fetchGroups, exportGroupsData, updateGroupSettings, fetchGroupLeaders, fetchGroupChampions, deleteGroup, fetchGroupAllMembers, fetchGroupCampaignInvestments, type GroupApiItem, type GroupLeader, type Champion, type GroupAllMember, type GroupCampaignInvestment } from "../api/group/groupApi";
import { AuditLogModal } from "../components/AuditLogModal";
import { currency_format } from "@/helpers/format";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GroupLeadersSection } from "@/components/group/GroupLeadersSection";
import { ChampionsCatalystsSection } from "@/components/group/ChampionsCatalystsSection";

const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || "https://qa.catacap.org";

interface GroupData {
  id: number;
  groupName: string;
  identifier: string;
  groupLeaders: string[];
  groupOwner: string;
  memberCount: number;
  memberInvestedTotal: number;
  investmentCount: number;
  status: "Public" | "Private" | string;
  active: boolean;
  corporateGroup: boolean;
  featuredGroup: boolean;
}

type SortField = "groupName" | "memberCount" | "memberInvestedTotal" | "investmentCount" | "status" | "active";

export default function GroupsPage() {
  const { user: authUser } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>("memberInvestedTotal", "desc");
  const [activeFilter, setActiveFilter] = useState<"active" | "inactive" | "all">("active");

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);

  const [groups, setGroups] = useState<GroupData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<{ id: string; name: string } | null>(null);

  const [isManageLeadersOpen, setIsManageLeadersOpen] = useState(false);
  const [isManageChampionsOpen, setIsManageChampionsOpen] = useState(false);
  const [managedLeaders, setManagedLeaders] = useState<GroupLeader[]>([]);
  const [managedChampions, setManagedChampions] = useState<Champion[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [isManageLoading, setIsManageLoading] = useState(false);

  // Delete state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);
  const [membersDialogGroupName, setMembersDialogGroupName] = useState("");
  const [membersList, setMembersList] = useState<GroupAllMember[]>([]);
  const [isMembersLoading, setIsMembersLoading] = useState(false);

  // Campaign investments modal
  const [isInvestmentsDialogOpen, setIsInvestmentsDialogOpen] = useState(false);
  const [investmentsDialogGroupName, setInvestmentsDialogGroupName] = useState("");
  const [investmentsCampaigns, setInvestmentsCampaigns] = useState<GroupCampaignInvestment[]>([]);
  const [isInvestmentsLoading, setIsInvestmentsLoading] = useState(false);

  const openInvestmentsDialog = async (groupId: number, groupName: string) => {
    setInvestmentsDialogGroupName(groupName);
    setInvestmentsCampaigns([]);
    setIsInvestmentsDialogOpen(true);
    setIsInvestmentsLoading(true);
    try {
      const data = await fetchGroupCampaignInvestments(groupId);
      setInvestmentsCampaigns(data.campaigns || []);
      if (data.groupName) setInvestmentsDialogGroupName(data.groupName);
    } catch (err) {
      console.error("Failed to load group campaign investments", err);
      toast({ title: "Error", description: "Failed to load investments.", variant: "destructive" });
    } finally {
      setIsInvestmentsLoading(false);
    }
  };

  const openMembersDialog = async (groupId: number, groupName: string) => {
    setMembersDialogGroupName(groupName);
    setMembersList([]);
    setIsMembersDialogOpen(true);
    setIsMembersLoading(true);
    try {
      const data = await fetchGroupAllMembers(groupId);
      setMembersList(data.members || []);
    } catch (err) {
      console.error("Failed to load group members", err);
      toast({
        title: "Error",
        description: "Failed to load members.",
        variant: "destructive",
      });
    } finally {
      setIsMembersLoading(false);
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
      await deleteGroup(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      loadGroups();
      toast({
        title: "Group Deleted",
        description: "The group has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete group", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the group. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    loadGroups();
  }, [effectiveSearch, sortField, sortDir, currentPage, rowsPerPage, activeFilter]);

  const loadGroups = async (showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const response = await fetchGroups({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField || undefined,
        sortDirection: sortDir || undefined,
        searchValue: effectiveSearch || undefined,
        activeFilter: activeFilter === "all" ? undefined : activeFilter
      });

      if (response && response.items) {
        const mappedItems: GroupData[] = response.items.map((item: GroupApiItem) => ({
          id: item.id,
          // name can be empty string — fall back to identifier
          groupName: item.name?.trim() || item.identifier || "N/A",
          identifier: item.identifier || "",
          // leader is a comma-separated string e.g. "789Test User, 123 "
          groupLeaders: item.leader
            ? item.leader
              .split(",")
              .map((l) => l.trim())
              .filter(Boolean)
            : [],
          groupOwner: (item.groupOwner || "").trim(),
          memberCount: item.member ?? 0,
          memberInvestedTotal: item.memberInvestedTotal ?? 0,
          investmentCount: item.investment ?? 0,
          // isPrivateGroup=false → "Public", isPrivateGroup=true → "Private"
          status: item.isPrivateGroup ? "Private" : "Public",
          // isDeactivated=true means NOT active
          active: !item.isDeactivated,
          corporateGroup: item.isCorporateGroup ?? false,
          featuredGroup: item.featuredGroup ?? false
        }));
        setGroups(mappedItems);
        setTotalCount(response.totalCount ?? mappedItems.length);
      } else {
        setGroups([]);
        setTotalCount(0);
      }
    } catch (error) {
      console.error("Failed to fetch groups", error);
      setGroups([]);
      setTotalCount(0);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      await exportGroupsData();
    } catch (error) {
      console.error("Failed to export groups", error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleToggleStatus = async (id: number, field: "corporateGroup" | "featuredGroup", currentValue: boolean) => {
    const label = field === "corporateGroup" ? "Corporate Group" : "Featured Group";

    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: !currentValue } : g)));

    try {
      await updateGroupSettings(id, {
        isCorporateGroup: field === "corporateGroup" ? !currentValue : undefined,
        featuredGroup: field === "featuredGroup" ? !currentValue : undefined
      });

      toast({
        title: "Status Updated",
        description: `Group ${label} status has been updated.`
      });
    } catch (error) {
      console.error(`Failed to update ${field}`, error);
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: currentValue } : g)));
      toast({
        title: "Update Failed",
        description: `Failed to update ${label}. Please try again.`,
        variant: "destructive"
      });
    }
  };

  const openAuditLog = (id: number, name: string) => {
    setAuditTarget({ id: id.toString(), name });
    setIsAuditModalOpen(true);
  };

  const handleManage = async (group: GroupData, type: "leaders" | "champions") => {
    setIsManageLoading(true);
    setSelectedGroupId(group.id);
    setSelectedGroupName(group.groupName);

    // Open modal immediately so user sees it opening
    if (type === "leaders") {
      setManagedLeaders([]); // Clear old data
      setIsManageLeadersOpen(true);
    } else {
      setManagedChampions([]); // Clear old data
      setIsManageChampionsOpen(true);
    }

    try {
      if (type === "leaders") {
        const response = await fetchGroupLeaders(group.id);
        setManagedLeaders(
          (response.leaders || []).map((l: any) => ({
            id: l.userId || crypto.randomUUID(),
            name: l.fullName || "",
            role: l.roleAndTitle || "",
            description: l.description || "",
            linkedinUrl: l.linkedInUrl || "",
            pictureFileName: l.pictureFileName || null,
            isOwner: l.isOwner || false
          }))
        );
      } else {
        const response = await fetchGroupChampions(group.id);
        setManagedChampions(
          (response.champions || []).map((c: any) => ({
            id: c.userId || crypto.randomUUID(),
            name: c.fullName || "",
            role: c.roleAndTitle || "",
            description: c.description || "",
            pictureFileName: c.pictureFileName || null
          }))
        );
      }
    } catch (error) {
      console.error("Failed to fetch group details", error);
      toast({
        title: "Error",
        description: "Failed to fetch group details. Please try again.",
        variant: "destructive"
      });
      // Close modal on error if you prefer, or show error state inside
      setIsManageLeadersOpen(false);
      setIsManageChampionsOpen(false);
    } finally {
      setIsManageLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
            Groups
          </h1>
          <div className="flex items-center gap-2">
            <Link href="/groups/reports">
              <Button
                variant="outline"
                className="text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                data-testid="button-group-reports"
              >
                <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
                Group Reports
              </Button>
            </Link>
            <Button className="bg-[#405189] hover:bg-[#405189]/90 text-white" onClick={handleExport} disabled={isExporting} data-testid="button-export-all">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {isExporting ? "Exporting..." : "Export All"}
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader className="border-b px-6 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by Group Name"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-groups"
                />
              </div>
              <Select
                value={activeFilter}
                onValueChange={(val) => {
                  setActiveFilter(val as "active" | "inactive" | "all");
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]" data-testid="select-active-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active" data-testid="option-active">Active</SelectItem>
                  <SelectItem value="inactive" data-testid="option-inactive">Inactive</SelectItem>
                  <SelectItem value="all" data-testid="option-all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-groups">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="groupName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Group Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group Owner</th>
                    <SortHeader field="memberCount" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="text-center">
                      Member Count
                    </SortHeader>
                    <SortHeader field="memberInvestedTotal" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="text-right whitespace-nowrap">
                      <span className="leading-tight">Total Mem<br />Invested</span>
                    </SortHeader>
                    <SortHeader field="investmentCount" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="text-center">
                      Investment Count
                    </SortHeader>
                    <SortHeader field="status" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="text-center whitespace-nowrap">
                      Status
                    </SortHeader>
                    <SortHeader field="active" sortField={sortField} sortDir={sortDir} handleSort={handleSort} className="text-center whitespace-nowrap">
                      Active
                    </SortHeader>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Featured</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        Loading groups...
                      </td>
                    </tr>
                  ) : groups.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                        No groups found.
                      </td>
                    </tr>
                  ) : (
                    groups.map((group) => (
                      <tr key={group.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-group-${group.id}`}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium" data-testid={`text-groupname-${group.id}`}>
                            {group.groupName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-groupowner-${group.id}`}>
                            {group.groupOwner || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {group.memberCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openMembersDialog(group.id, group.groupName)}
                              className="text-sm font-medium text-[#405189] hover:underline focus:outline-none focus:underline"
                              data-testid={`button-membercount-${group.id}`}
                            >
                              {group.memberCount}
                            </button>
                          ) : (
                            <span className="text-sm text-muted-foreground" data-testid={`text-membercount-${group.id}`}>
                              {group.memberCount}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="text-sm font-medium" data-testid={`text-memberinvestedtotal-${group.id}`}>
                            {currency_format(group.memberInvestedTotal, true, 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {group.investmentCount > 0 ? (
                            <button
                              className="text-sm font-medium text-[#405189] hover:underline hover:text-[#405189]/80 transition-colors"
                              onClick={() => openInvestmentsDialog(group.id, group.groupName)}
                              data-testid={`button-investmentcount-${group.id}`}
                              title="View campaigns"
                            >
                              {group.investmentCount}
                            </button>
                          ) : (
                            <span className="text-sm text-muted-foreground" data-testid={`text-investmentcount-${group.id}`}>
                              0
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            className={`no-default-hover-elevate no-default-active-elevate border-0 ${group.status === "Public"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                              }`}
                            data-testid={`text-status-${group.id}`}
                          >
                            {group.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center" data-testid={`status-active-${group.id}`}>
                          <div className="flex items-center justify-center">{group.active ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-rose-600" />}</div>
                        </td>
                        <td className="px-4 py-3 text-center" data-testid={`checkbox-featured-${group.id}`}>
                          <div className="flex items-center justify-center">
                            <Checkbox
                              checked={group.featuredGroup}
                              onCheckedChange={() => handleToggleStatus(group.id, "featuredGroup", group.featuredGroup)}
                              className="data-[state=checked]:bg-[#405189] data-[state=checked]:border-[#405189]"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end">
                            <div className="inline-flex rounded-md shadow-sm">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Link href={`/groups/${group.identifier}/edit`}>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                      data-testid={`button-edit-${group.id}`}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  </Link>
                                </TooltipTrigger>
                                <TooltipContent>Edit group</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 rounded-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                    onClick={() => handleManage(group, "leaders")}
                                    data-testid={`button-manage-leaders-${group.id}`}
                                  >
                                    <Crown className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Manage Leaders</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className="h-8 w-8 rounded-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                    onClick={() => handleManage(group, "champions")}
                                    data-testid={`button-manage-champions-${group.id}`}
                                  >
                                    <UsersIcon className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Manage Champions</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                      group.active || authUser?.isSuperAdmin ? "rounded-none border-r-0" : "rounded-l-none"
                                    )}
                                    onClick={() => openAuditLog(group.id, group.groupName)}
                                    data-testid={`button-audit-${group.id}`}
                                  >
                                    <History className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>View audit logs</TooltipContent>
                              </Tooltip>

                              {group.active && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <a href={`${FRONTEND_URL}/group/${group.identifier}`} target="_blank" rel="noopener noreferrer">
                                      <Button
                                        size="icon"
                                        variant="outline"
                                        className={cn(
                                          "h-8 w-8 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                          authUser?.isSuperAdmin ? "rounded-none border-r-0" : "rounded-l-none"
                                        )}
                                        data-testid={`button-view-${group.id}`}
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </a>
                                  </TooltipTrigger>
                                  <TooltipContent>View group</TooltipContent>
                                </Tooltip>
                              )}
                              {authUser?.isSuperAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                      onClick={() => openDeleteDialog(group.id)}
                                      data-testid={`button-delete-${group.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete group</TooltipContent>
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
              onRowsPerPageChange={(rows) => {
                setRowsPerPage(rows);
                setCurrentPage(1);
              }}
              pageSizeOptions={[10, 25, 50, 100]}
            />
          </CardContent>
        </Card>
      </div>

      <AuditLogModal
        isOpen={isAuditModalOpen}
        onOpenChange={setIsAuditModalOpen}
        entityId={auditTarget?.id || ""}
        entityType="groups"
        title={`Audit Logs - ${auditTarget?.name}`}
      />

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete Group"
        description="Are you sure you want to delete this group? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
        dataTestId="dialog-delete"
      />

      {/* Manage Leaders Modal */}
      <Dialog open={isManageLeadersOpen} onOpenChange={(open) => {
        setIsManageLeadersOpen(open);
        if (!open) loadGroups(false);
      }}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-none shadow-2xl [&>button]:text-white">
          <DialogHeader className="p-6 bg-[#405189] text-white">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Crown className="h-5 w-5" />
              Manage Leaders - {selectedGroupName}
            </DialogTitle>
          </DialogHeader>
          <div className="p-1 min-h-[300px] flex flex-col">
            {isManageLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#405189]" />
                <p className="text-sm font-medium">Fetching leaders...</p>
              </div>
            ) : (
              <GroupLeadersSection
                apiGroupId={selectedGroupId}
                leaders={managedLeaders}
                setLeaders={setManagedLeaders}
                cardClassName="border-0 shadow-none"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Group Members Modal */}
      <Dialog open={isMembersDialogOpen} onOpenChange={setIsMembersDialogOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-none shadow-2xl [&>button]:text-white">
          <DialogHeader className="p-6 bg-[#405189] text-white">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <UsersIcon className="h-5 w-5" />
              Members - {membersDialogGroupName}
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 min-h-[300px] max-h-[70vh] flex flex-col">
            {isMembersLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#405189]" />
                <p className="text-sm font-medium">Loading members...</p>
              </div>
            ) : membersList.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <UsersIcon className="h-8 w-8" />
                <p className="text-sm">No members in this group.</p>
              </div>
            ) : (
              <div className="flex-1 overflow-auto">
                <div className="text-xs text-muted-foreground mb-2 px-1" data-testid="text-members-count">
                  {membersList.length} {membersList.length === 1 ? "member" : "members"}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Email</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {membersList.map((m) => (
                      <tr key={m.id} data-testid={`row-member-${m.id}`}>
                        <td className="px-3 py-2" data-testid={`text-member-name-${m.id}`}>{m.fullName || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground" data-testid={`text-member-email-${m.id}`}>{m.email || "—"}</td>
                        <td className="px-3 py-2" data-testid={`text-member-role-${m.id}`}>
                          <Badge
                            className={`no-default-hover-elevate no-default-active-elevate border-0 ${
                              m.role === "Owner"
                                ? "bg-[#405189]/15 text-[#405189]"
                                : m.role === "Leader"
                                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {m.role}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Campaign Investments Modal */}
      <Dialog open={isInvestmentsDialogOpen} onOpenChange={setIsInvestmentsDialogOpen}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-none shadow-2xl">
          <DialogHeader className="p-6 bg-[#405189] text-white">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Investments — {investmentsDialogGroupName}
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 min-h-[200px]">
            {isInvestmentsLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading campaigns…</span>
              </div>
            ) : investmentsCampaigns.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No linked campaigns found for this group.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Campaign</th>
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase text-xs tracking-wider">Stage</th>
                      <th className="px-3 py-2 text-center font-semibold text-muted-foreground uppercase text-xs tracking-wider">Access</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase text-xs tracking-wider">Group Investors</th>
                      <th className="px-3 py-2 text-right font-semibold text-muted-foreground uppercase text-xs tracking-wider">Group Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {investmentsCampaigns.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/30" data-testid={`row-campaign-investment-${c.id}`}>
                        <td className="px-3 py-2.5 font-medium" data-testid={`text-campaign-name-${c.id}`}>
                          {c.name}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            className={cn(
                              "no-default-hover-elevate no-default-active-elevate border-0 text-xs",
                              c.stage === 2 || c.stage === 7 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" :
                              c.stage === 3 ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                              c.stage === 1 || c.stage === 9 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" :
                              "bg-muted text-muted-foreground",
                            )}
                          >
                            {c.stageLabel}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {c.isPrivateAccess ? (
                            <Badge className="no-default-hover-elevate no-default-active-elevate border-0 bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 text-xs">
                              Private
                            </Badge>
                          ) : (
                            <Badge className="no-default-hover-elevate no-default-active-elevate border-0 bg-muted text-muted-foreground text-xs">
                              Linked
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-testid={`text-investor-count-${c.id}`}>
                          {c.investorCount}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums" data-testid={`text-total-invested-${c.id}`}>
                          {c.totalInvested > 0 ? currency_format(c.totalInvested) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {investmentsCampaigns.some((c) => c.totalInvested > 0) && (
                    <tfoot>
                      <tr className="border-t bg-muted/30 font-semibold">
                        <td className="px-3 py-2" colSpan={4}>Total</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {currency_format(investmentsCampaigns.reduce((s, c) => s + c.totalInvested, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Champions Modal */}
      <Dialog open={isManageChampionsOpen} onOpenChange={(open) => {
        setIsManageChampionsOpen(open);
      }}>
        <DialogContent className="sm:max-w-2xl p-0 overflow-hidden border-none shadow-2xl [&>button]:text-white">
          <DialogHeader className="p-6 bg-[#405189] text-white">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <UsersIcon className="h-5 w-5" />
              Manage Champions - {selectedGroupName}
            </DialogTitle>
          </DialogHeader>
          <div className="p-1 min-h-[300px] flex flex-col">
            {isManageLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-[#405189]" />
                <p className="text-sm font-medium">Fetching champions...</p>
              </div>
            ) : (
              <ChampionsCatalystsSection
                apiGroupId={selectedGroupId}
                champions={managedChampions}
                setChampions={setManagedChampions}
                cardClassName="border-0 shadow-none"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
