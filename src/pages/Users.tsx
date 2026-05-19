import { useState, Fragment, useEffect } from "react";
import { useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/helpers/format";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Search, Download, Filter, Plus, Minus, MoreVertical, ChevronLeft, ChevronRight, LogIn, UserX, UserCheck, Ban, ShieldCheck, History, Trash2 } from "lucide-react";
import { useSort } from "../hooks/useSort";
import { useDebounce } from "../hooks/useDebounce";
import { SortHeader } from "../components/ui/table-sort";
import { exportUsers, fetchUsers, UserEntry, updateAccountBalance, updateUserSettings, assignGroupAdmin, loginAsUser, deleteUser } from "../api/user/userApi";
import { fetchUserRecommendations, UserRecommendationItem } from "../api/recommendation/recommendationApi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { AuditLogModal } from "../components/AuditLogModal";
import { PaginationControls } from "@/components/ui/pagination-controls";

type SortField = "fullName" | "username" | "recommendations" | "totalInvested" | "dateCreated" | "accountbalance";

export default function UsersPage() {
  const { user: authUser } = useAuth();
  const queryClient = useQueryClient();
  const searchString = useSearch();
  const initialSearch = (() => {
    try {
      return new URLSearchParams(searchString).get("search") || "";
    } catch {
      return "";
    }
  })();
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(searchString).get("search") || "";
      setSearchQuery((prev) => (prev === fromUrl ? prev : fromUrl));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchString]);
  const debouncedSearch = useDebounce(searchQuery, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";
  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>();

  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [filterByGroup, setFilterByGroup] = useState(false);
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [balanceDialogOpen, setBalanceDialogOpen] = useState(false);
  const [balanceDialogUser, setBalanceDialogUser] = useState<UserEntry | null>(null);
  const [balanceDialogMode, setBalanceDialogMode] = useState<"add" | "subtract">("add");
  const [balanceDialogAmount, setBalanceDialogAmount] = useState(0);
  const [balanceDialogComment, setBalanceDialogComment] = useState("");
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isUpdatingBalance, setIsUpdatingBalance] = useState(false);
  const [balanceInputErrors, setBalanceInputErrors] = useState<Record<string, boolean>>({});
  const [impersonatingUserId, setImpersonatingUserId] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<{ id: string; name: string } | null>(null);
  const [recsDialogOpen, setRecsDialogOpen] = useState(false);
  const [recsDialogUser, setRecsDialogUser] = useState<UserEntry | null>(null);
  const [recsDialogItems, setRecsDialogItems] = useState<UserRecommendationItem[]>([]);
  const [recsDialogLoading, setRecsDialogLoading] = useState(false);
  const [recsDialogError, setRecsDialogError] = useState<string | null>(null);

  const openRecsDialog = async (user: UserEntry) => {
    setRecsDialogUser(user);
    setRecsDialogOpen(true);
    setRecsDialogItems([]);
    setRecsDialogError(null);
    setRecsDialogLoading(true);
    try {
      const items = await fetchUserRecommendations(user.id);
      setRecsDialogItems(items);
    } catch (err) {
      console.error("Failed to load user recommendations", err);
      setRecsDialogError("Failed to load recommendations.");
    } finally {
      setRecsDialogLoading(false);
    }
  };

  // Delete state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const openDeleteDialog = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargetId) return;
    setIsDeleting(true);
    try {
      await deleteUser(deleteTargetId);
      setIsDeleteDialogOpen(false);
      setDeleteTargetId(null);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast({
        title: "User Deleted",
        description: "The user has been deleted successfully.",
        duration: 4000
      });
    } catch (error) {
      console.error("Failed to delete user", error);
      toast({
        title: "Delete Failed",
        description: "Failed to delete the user. Please try again.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      await exportUsers();
      toast({
        title: "Success",
        description: "The users list has been exported.",
        duration: 4000
      });
    } catch (error) {
      console.error("Error exporting users", error);
      toast({
        title: "Error",
        description: "Failed to export users.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsExporting(false);
    }
  };

  const openBalanceDialog = (user: UserEntry, mode: "add" | "subtract") => {
    const raw = balanceInputs[user.id] || "";
    const amount = parseFloat(raw);
    if (!raw || isNaN(amount) || amount <= 0) {
      setBalanceInputErrors((prev) => ({ ...prev, [user.id]: true }));
      return;
    }
    setBalanceInputErrors((prev) => ({ ...prev, [user.id]: false }));
    setBalanceDialogUser(user);
    setBalanceDialogMode(mode);
    setBalanceDialogAmount(amount);
    setBalanceDialogComment("");
    setBalanceDialogOpen(true);
  };

  const handleBalanceSave = async () => {
    if (!balanceDialogUser || !balanceDialogComment.trim()) return;
    setIsUpdatingBalance(true);
    try {
      const result = await updateAccountBalance({
        email: balanceDialogUser.email,
        accountBalance: balanceDialogMode === "subtract" ? -balanceDialogAmount : balanceDialogAmount,
        comment: balanceDialogComment.trim()
      });

      if (result.success) {
        toast({
          title: result.message || "Account balance updated successfully.",
          duration: 4000
        });
        setBalanceInputs((prev) => ({ ...prev, [balanceDialogUser.id]: "" }));
        queryClient.invalidateQueries({ queryKey: ["users"] });
      } else {
        toast({
          title: result.message || "Failed to update account balance.",
          variant: "destructive",
          duration: 4000
        });
      }
    } catch (err) {
      console.error("Error updating balance", err);
      toast({
        title: "Failed to update account balance.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setIsUpdatingBalance(false);
      setBalanceDialogOpen(false);
    }
  };

  const handleUserSettings = async (user: UserEntry, settings: { isActive?: boolean; isExcludeUserBalance?: boolean }) => {
    const isBalanceToggle = settings.isExcludeUserBalance !== undefined;
    const isActiveToggle = settings.isActive !== undefined;
    try {
      await updateUserSettings(user.id, settings);
      toast({
        title: isBalanceToggle
          ? (settings.isExcludeUserBalance ? "User balance excluded." : "User balance included.")
          : isActiveToggle
            ? (settings.isActive ? "User activated." : "User deactivated.")
            : "User settings updated successfully.",
        duration: 4000
      });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await queryClient.refetchQueries({ queryKey: ["users"] });
    } catch (err) {
      console.error("Error updating user settings", err);
      toast({
        title: isBalanceToggle
          ? (settings.isExcludeUserBalance ? "Failed to exclude user balance." : "Failed to include user balance.")
          : isActiveToggle
            ? (settings.isActive ? "Failed to activate user." : "Failed to deactivate user.")
            : "Failed to update user settings.",
        variant: "destructive",
        duration: 4000
      });
    }
  };

  const handleAssignGroupAdmin = async (user: UserEntry) => {
    const wasGroupAdmin = user.isGroupAdmin;
    try {
      const result = await assignGroupAdmin(user.id);
      const fallback = wasGroupAdmin
        ? "Group admin role removed successfully."
        : "Group admin role assigned successfully.";
      toast({
        title: result?.message || fallback,
        duration: 4000
      });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err) {
      console.error("Error assigning group admin", err);
      toast({
        title: wasGroupAdmin
          ? "Failed to remove group admin."
          : "Failed to assign group admin.",
        variant: "destructive",
        duration: 4000
      });
    }
  };

  const handleLoginAsUser = async (user: UserEntry) => {
    setImpersonatingUserId(user.id);
    try {
      const result = await loginAsUser(user.email);
      if (result.token) {
        window.open(
          import.meta.env.VITE_FRONTEND_URL + "/impersonate-login?token=" + String(result.token) + "&email=" + encodeURIComponent(user.email) + "&isLoginWithToken=true",
          "_blank",
          "noopener,noreferrer"
        );
      }
    } catch (err) {
      console.error("Error logging in as user", err);
      toast({
        title: "Failed to login as user.",
        variant: "destructive",
        duration: 4000
      });
    } finally {
      setImpersonatingUserId(null);
    }
  };

  const openAuditLog = (id: string, name: string) => {
    setAuditTarget({ id, name });
    setIsAuditModalOpen(true);
  };

  const {
    data: queryData,
    isLoading,
    error
  } = useQuery({
    queryKey: ["users", currentPage, rowsPerPage, sortField, sortDir, effectiveSearch, filterByGroup],
    queryFn: () =>
      fetchUsers({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        searchValue: effectiveSearch.trim() || undefined,
        filterByGroup: filterByGroup || undefined
      }),
    staleTime: 0,
    gcTime: 0
  });

  const paginatedUsers = queryData?.items ?? [];
  const totalCount = queryData?.totalCount ?? 0;
  const totalPages = Math.ceil(totalCount / rowsPerPage);
  const startIdx = totalCount > 0 ? (currentPage - 1) * rowsPerPage + 1 : 0;
  const endIdx = Math.min(currentPage * rowsPerPage, totalCount);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
          Users
        </h1>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Full Name, Email"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-9"
                data-testid="input-search-users"
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer text-sm" data-testid="button-filter-group">
                <span>Filter by Group</span>
                <input
                  type="checkbox"
                  checked={filterByGroup}
                  onChange={(e) => {
                    setFilterByGroup(e.target.checked);
                    setCurrentPage(1);
                  }}
                  className="h-4 w-4 rounded border-[#0ab39c] text-[#0ab39c] accent-[#0ab39c] cursor-pointer"
                  data-testid="checkbox-filter-group"
                />
              </label>
              <Button size="sm" className="bg-[#405189] hover:bg-[#405189]/90 text-white" data-testid="button-export-all" onClick={handleExportAll} disabled={isExporting}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {isExporting ? "Exporting..." : "Export All"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-users">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <SortHeader field="fullName" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Full Name
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Username
                      <br />
                      Email
                    </th>
                    <SortHeader field="totalInvested" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Total Invested
                    </SortHeader>
                    <SortHeader field="recommendations" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Recs
                    </SortHeader>
                    <SortHeader field="accountbalance" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Account Balance
                    </SortHeader>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Balance Actions</th>
                    <SortHeader field="dateCreated" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Date Created
                    </SortHeader>
                    {filterByGroup && <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group Name</th>}
                    {filterByGroup && <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group Account Balance</th>}
                    <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={filterByGroup ? 10 : 8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading && error && (
                    <tr>
                      <td colSpan={filterByGroup ? 10 : 8} className="px-4 py-8 text-center text-sm text-destructive">
                        {(error as Error)?.message || "Failed to load data"}
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && paginatedUsers.length === 0 && (
                    <tr>
                      <td colSpan={filterByGroup ? 10 : 8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No records found.
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    !error &&
                    paginatedUsers.map((user: UserEntry) => (
                      <tr key={user.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors" data-testid={`row-user-${user.id}`}>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium" data-testid={`text-fullname-${user.id}`}>
                            {user.fullName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium" data-testid={`text-username-${user.id}`}>
                            {user.userName}
                          </div>
                          <div className="text-xs text-muted-foreground" data-testid={`text-email-${user.id}`}>
                            {user.email}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-total-invested-${user.id}`}>
                            {`$${Math.round(user.totalInvested ?? 0).toLocaleString("en-US")}`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {user.recommendationsCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openRecsDialog(user)}
                              className="text-sm font-medium text-[#0ab39c] hover:underline focus:outline-none focus-visible:underline cursor-pointer"
                              data-testid={`button-recommendations-${user.id}`}
                            >
                              {user.recommendationsCount}
                            </button>
                          ) : (
                            <span className="text-sm" data-testid={`text-recommendations-${user.id}`}>
                              {user.recommendationsCount}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-balance-${user.id}`}>
                            ${(user.accountBalance ?? 0).toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <Input
                                type="text"
                                className={`h-8 w-28 text-sm${balanceInputErrors[user.id] ? " border-destructive focus-visible:ring-destructive" : ""}`}
                                value={balanceInputs[user.id] || ""}
                                onChange={(e) => {
                                  setBalanceInputs((prev) => ({ ...prev, [user.id]: e.target.value }));
                                  if (balanceInputErrors[user.id]) setBalanceInputErrors((prev) => ({ ...prev, [user.id]: false }));
                                }}
                                data-testid={`input-balance-${user.id}`}
                              />
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-[#0ab39c]" onClick={() => openBalanceDialog(user, "add")} data-testid={`button-add-balance-${user.id}`}>
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-muted-foreground"
                                onClick={() => openBalanceDialog(user, "subtract")}
                                disabled={user.accountBalance <= 0}
                                data-testid={`button-subtract-balance-${user.id}`}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {balanceInputErrors[user.id] && (
                              <p className="text-xs text-destructive mt-1" data-testid={`error-balance-${user.id}`}>
                                Please enter an amount for the user.
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm" data-testid={`text-date-${user.id}`}>
                            {formatDate(user.dateCreated)}
                          </span>
                        </td>
                        {filterByGroup && (
                          <td className="px-4 py-3">
                            <div className="text-sm" data-testid={`text-group-name-${user.id}`}>
                              {user.groupNames}
                            </div>
                          </td>
                        )}
                        {filterByGroup && (
                          <td className="px-4 py-3">
                            <div className="text-sm" data-testid={`text-group-balance-${user.id}`}>
                              {user.groupBalances}
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end">
                            <div className="inline-flex rounded-md shadow-sm">
                              {user.isActive && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-r-none border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5"
                                      onClick={() => handleLoginAsUser(user)}
                                      disabled={impersonatingUserId === user.id}
                                      data-testid={`action-login-${user.id}`}
                                    >
                                      <LogIn className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{impersonatingUserId === user.id ? "Logging in..." : "Login"}</TooltipContent>
                                </Tooltip>
                              )}

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8 border-r-0 text-[#405189] hover:text-[#405189] hover:bg-[#405189]/5",
                                      user.isActive ? "rounded-none" : "rounded-r-none"
                                    )}
                                    onClick={() => openAuditLog(user.id, user.fullName)}
                                    data-testid={`action-audit-${user.id}`}
                                  >
                                    <History className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>View audit logs</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8 rounded-none border-r-0",
                                      user.isActive
                                        ? "text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                        : "bg-[#45CB85] text-white hover:bg-[#45CB85]/90 hover:text-white border-[#45CB85]"
                                    )}
                                    onClick={() => handleUserSettings(user, { isActive: !user.isActive })}
                                    data-testid={`action-inactive-${user.id}`}
                                  >
                                    {user.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{user.isActive ? "Deactivate User" : "Activate User"}</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8",
                                      user.isExcludeUserBalance
                                        ? "bg-[#64748b] text-white hover:bg-[#64748b]/90 hover:text-white border-[#64748b]"
                                        : "text-[#64748b] hover:text-[#64748b] hover:bg-[#64748b]/5",
                                      authUser?.isSuperAdmin ? "rounded-none border-r-0" : "rounded-l-none"
                                    )}
                                    onClick={() => handleUserSettings(user, { isExcludeUserBalance: !user.isExcludeUserBalance })}
                                    data-testid={`action-exclude-balance-${user.id}`}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{user.isExcludeUserBalance ? "Include user balance" : "Exclude user balance"}</TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="outline"
                                    className={cn(
                                      "h-8 w-8",
                                      user.isGroupAdmin
                                        ? "bg-[#0ab39c] text-white hover:bg-[#0ab39c]/90 hover:text-white border-[#0ab39c]"
                                        : "text-[#0ab39c] hover:text-[#0ab39c] hover:bg-[#0ab39c]/5",
                                      authUser?.isSuperAdmin ? "rounded-none border-r-0" : "rounded-l-none"
                                    )}
                                    onClick={() => handleAssignGroupAdmin(user)}
                                    data-testid={`action-make-admin-${user.id}`}
                                  >
                                    <ShieldCheck className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {user.isGroupAdmin ? "Remove Group Admin" : "Make Group Admin"}
                                </TooltipContent>
                              </Tooltip>
                              {authUser?.isSuperAdmin && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="outline"
                                      className="h-8 w-8 rounded-l-none text-[#f06548] hover:text-[#f06548] hover:bg-[#f06548]/5"
                                      onClick={() => openDeleteDialog(user.id)}
                                      data-testid={`action-delete-${user.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete user</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
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
              dataTestId="pagination-users"
            />
          </CardContent>
        </Card>
      </div>
      <ConfirmationDialog
        open={balanceDialogOpen}
        onOpenChange={(open) => {
          if (!isUpdatingBalance) {
            setBalanceDialogOpen(open);
            if (!open) {
              setBalanceDialogComment("");
              setBalanceDialogUser(null);
            }
          }
        }}
        title="Confirm Balance Update"
        description={
          balanceDialogUser && (
            <p className="text-sm">
              You are about to <strong>{balanceDialogMode === "add" ? "add" : "subtract"}</strong>{" "}
              <strong>${balanceDialogAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> {balanceDialogMode === "add" ? "to" : "from"} the account of{" "}
              <strong>{balanceDialogUser.fullName}</strong>.
            </p>
          )
        }
        noteLabel={
          (
            <span>
              Comment <span className="text-destructive">*</span>
            </span>
          ) as any
        }
        noteValue={balanceDialogComment}
        onNoteChange={(val) => {
          if (val.length <= 1200) setBalanceDialogComment(val);
        }}
        maxNoteLength={1200}
        confirmLabel="SAVE"
        cancelLabel="CANCEL"
        onConfirm={handleBalanceSave}
        isSubmitting={isUpdatingBalance}
        dataTestId="dialog-balance-update"
      />

      <ConfirmationDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteTargetId(null);
        }}
        title="Delete User"
        description="Are you sure you want to delete this user? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteConfirm}
        isSubmitting={isDeleting}
        confirmButtonClass="bg-[#f06548] text-white hover:bg-[#d0543c]"
        dataTestId="dialog-delete-user"
      />

      <AuditLogModal
        isOpen={isAuditModalOpen}
        onOpenChange={setIsAuditModalOpen}
        entityId={auditTarget?.id || ""}
        entityType="users"
        title={`Audit Logs - ${auditTarget?.name}`}
      />

      <Dialog open={recsDialogOpen} onOpenChange={setRecsDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-user-recommendations">
          <DialogHeader className="min-w-0">
            <DialogTitle className="min-w-0 break-words">
              Recommendations{recsDialogUser ? ` - ${recsDialogUser.fullName}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            {recsDialogLoading && (
              <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
            )}
            {!recsDialogLoading && recsDialogError && (
              <div className="py-6 text-center text-sm text-destructive">{recsDialogError}</div>
            )}
            {!recsDialogLoading && !recsDialogError && recsDialogItems.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No recommendations found.
              </div>
            )}
            {!recsDialogLoading && !recsDialogError && recsDialogItems.length > 0 && (
              <table className="w-full text-sm" data-testid="table-user-recommendations">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold">Date</th>
                    <th className="px-3 py-2 text-left font-semibold">Investment</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...recsDialogItems]
                    .sort((a, b) => {
                      const ta = a.dateCreated ? new Date(a.dateCreated).getTime() : Number.POSITIVE_INFINITY;
                      const tb = b.dateCreated ? new Date(b.dateCreated).getTime() : Number.POSITIVE_INFINITY;
                      return ta - tb;
                    })
                    .map((rec) => (
                    <tr key={rec.id} className="border-b last:border-b-0" data-testid={`row-user-recommendation-${rec.id}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" data-testid={`text-rec-date-${rec.id}`}>
                        {rec.dateCreated ? formatDate(rec.dateCreated) : "-"}
                      </td>
                      <td className="px-3 py-2 break-words min-w-0" data-testid={`text-rec-campaign-${rec.id}`}>
                        {rec.campaignName || "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium" data-testid={`text-rec-amount-${rec.id}`}>
                        ${(rec.amount ?? 0).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 capitalize" data-testid={`text-rec-status-${rec.id}`}>
                        {rec.status || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30 font-semibold">
                    <td className="px-3 py-2 text-left" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right" data-testid="text-rec-total">
                      ${recsDialogItems.reduce((sum, r) => sum + (r.amount ?? 0), 0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2"></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecsDialogOpen(false)} data-testid="button-close-recommendations">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
