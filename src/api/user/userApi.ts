import axiosInstance from "../axios";

export interface UserDropdownItem {
  id: string;
  email: string;
  fullName: string;
}

export interface AdminUserItem {
  id: string;
  email: string;
  fullName: string;
  alternateEmail?: string;
}

export interface UpdateUserProfileParams {
  token: string;
  email: string;
  firstName: string;
  lastName: string;
  userName: string;
}

export interface SaveAdminUserParams {
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
  userName: string;
  password?: string;
  isActive: boolean;
  twoFactorEnabled?: boolean;
  roleId: string;
}

export async function fetchUsersDropdown(): Promise<UserDropdownItem[]> {
  const response = await axiosInstance.get<UserDropdownItem[]>("/api/admin/user/dropdown");
  return response.data;
}
export interface UserParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: string;
  investmentId?: number;
  filterByGroup?: boolean;
  stages?: string;
  investmentStatus?: boolean;
  isDeleted?: boolean;
}

export interface UserGroup {
  name: string;
  balance: number;
}

export interface UserEntry {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  userName: string;
  accountBalance: number;
  email: string;
  isActive: boolean;
  dateCreated: string;
  isGroupAdmin: boolean;
  isExcludeUserBalance: boolean;
  recommendationsCount: number;
  totalInvested: number;
  groupNames: string;
  groupBalances: string;
}

export interface AdminUserEntry {
  id: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  userName?: string;
  email?: string;
  alternateEmail?: string | null;
  isActive?: boolean;
  twoFactorEnabled?: boolean;
  dateCreated?: string | null;
  roleId?: string;
  roleName?: string;
}

export interface PaginatedAdminUserResponse {
  items: AdminUserEntry[];
  totalCount: number;
}

export interface PaginatedUserResponse {
  items: UserEntry[];
  totalCount: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
}

export async function fetchUsers(
  params?: UserParams
): Promise<PaginatedUserResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue) queryParams.SearchValue = params.searchValue;
    if (params.status) queryParams.Status = params.status;
    if (params.investmentId !== undefined) queryParams.InvestmentId = params.investmentId.toString();
    if (params.filterByGroup !== undefined) queryParams.FilterByGroup = params.filterByGroup.toString();
    if (params.stages) queryParams.Stages = params.stages;
    if (params.investmentStatus !== undefined) queryParams.InvestmentStatus = params.investmentStatus.toString();
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
  }

  const response = await axiosInstance.get<PaginatedUserResponse>(
    "/api/admin/user",
    { params: queryParams }
  );

  return response.data;
}

export async function fetchAdminUsers(
  params?: UserParams
): Promise<PaginatedAdminUserResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue) queryParams.SearchValue = params.searchValue;
    if (params.status) queryParams.Status = params.status;
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
  }

  const response = await axiosInstance.get<PaginatedAdminUserResponse>(
    "/api/admin/user/admin-users",
    { params: queryParams }
  );

  return response.data;
}


export async function exportUsers(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/user/export", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.setAttribute("download", `Users_${dateStr}.xlsx`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function updateAccountBalance(params: {
  email: string;
  accountBalance: number;
  comment: string;
}): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.put<{ success: boolean; message: string }>("/api/admin/user/account-balance", null, {
    params: {
      email: params.email,
      accountBalance: params.accountBalance,
      comment: params.comment,
    },
  });
  return response.data;
}

export async function updateUserSettings(
  id: string,
  params: { isActive?: boolean; isExcludeUserBalance?: boolean; twoFactorEnabled?: boolean }
): Promise<void> {
  await axiosInstance.patch(`/api/admin/user/${id}/settings`, null, {
    params,
  });
}

export async function assignGroupAdmin(
  userId: string
): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.put<{ success: boolean; message: string }>(
    "/api/userauthentication/assign-group-admin",
    null,
    {
      params: { userId },
    }
  );
  return response.data;
}

function getCurrentToken(): string {
  try {
    const raw = localStorage.getItem("persist:root");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    if (parsed.token) {
      try {
        const tokenData = JSON.parse(parsed.token);
        if (tokenData.token) return tokenData.token;
      } catch {
        if (typeof parsed.token === "string") return parsed.token;
      }
    }
  } catch { }
  return "";
}

export async function loginAsUser(email: string): Promise<{ token: string }> {
  const userToken = getCurrentToken();
  const response = await axiosInstance.post<{ token: string }>(
    "/api/userauthentication/loginAdminToUser",
    { userToken, email }
  );
  return response.data;
}

export async function fetchAllAdminUsers(): Promise<AdminUserItem[]> {
  const response = await axiosInstance.get<AdminUserItem[]>("/api/Users/get-all-admin-users");
  return response.data;
}

export async function assignRole(userId: string, roleId: string): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.post<{ success: boolean; message: string }>(
    "/api/userauthentication/assign-role",
    { userId, roleId }
  );
  return response.data;
}

export async function updateUserProfile(params: UpdateUserProfileParams): Promise<any> {
  const response = await axiosInstance.put("/api/admin/user", params);
  return response.data;
}

export async function updateTwoFactorEnabled(
  twoFactorEnabled: boolean
): Promise<{ success: boolean; message: string; twoFactorEnabled: boolean }> {
  const response = await axiosInstance.patch<{
    success: boolean;
    message: string;
    twoFactorEnabled: boolean;
  }>("/api/admin/user/two-factor", { twoFactorEnabled });
  return response.data;
}

export async function saveAdminUser(params: SaveAdminUserParams): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.post<{ success: boolean; message: string }>(
    "/api/admin/user/admin-users",
    params
  );
  return response.data;
}

export async function deleteUser(id: string): Promise<any> {
  const response = await axiosInstance.delete(`/api/admin/user/${id}`);
  return response.data;
}
