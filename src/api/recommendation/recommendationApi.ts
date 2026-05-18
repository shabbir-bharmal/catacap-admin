import axiosInstance from "../axios";

export interface RecommendationParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: string;
  investmentId?: string;
  filterByGroup?: boolean;
  stages?: string;
  investmentStatus?: boolean;
  isDeleted?: boolean;
}

export interface RecommendationEntry {
  id: number;
  userFullName: string;
  userEmail: string;
  campaignId: number;
  campaignName: string;
  amount: number;
  dateCreated: string;
  status: string;
  isActive: boolean;
  rejectedBy: string | null;
  rejectionMemo: string | null;
  isMatch?: boolean;
  matchDonorName?: string | null;
}

export interface PaginatedRecommendationResponse {
  items: RecommendationEntry[];
  totalCount: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
  approved: number;
  pending: number;
  total: number;
}

export async function fetchRecommendations(
  params?: RecommendationParams
): Promise<PaginatedRecommendationResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue !== undefined && params.searchValue !== null) queryParams.SearchValue = params.searchValue;
    if (params.status) queryParams.Status = params.status;
    if (params.investmentId) queryParams.InvestmentId = params.investmentId;
    if (params.filterByGroup !== undefined) queryParams.FilterByGroup = params.filterByGroup.toString();
    if (params.stages) queryParams.Stages = params.stages;
    if (params.investmentStatus !== undefined) queryParams.InvestmentStatus = params.investmentStatus.toString();
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
  }

  const response = await axiosInstance.get<PaginatedRecommendationResponse>(
    "/api/admin/recommendation",
    { params: queryParams }
  );

  return response.data;
}

export interface UpdateRecommendationPayload {
  id: number;
  userEmail: string;
  userFullName: string;
  campaignId: number;
  campaignName: string;
  status: string;
  amount: number;
  dateCreated: string;
  rejectionMemo: string;
}

export interface UpdateRecommendationResponse {
  success: boolean;
  message: string;
  data: {
    status: string;
    rejectedBy: string;
    rejectionMemo: string | null;
  };
}

export async function updateRecommendation(
  payload: UpdateRecommendationPayload
): Promise<UpdateRecommendationResponse> {
  const response = await axiosInstance.put<UpdateRecommendationResponse>(
    `/api/admin/recommendation/${payload.id}`,
    payload
  );
  return response.data;
}

export interface InvestmentOption {
  id: number;
  name: string;
}

export async function fetchInvestmentNames(): Promise<InvestmentOption[]> {
  const response = await axiosInstance.get<InvestmentOption[]>(
    "/api/Campaign/get-all-investment-name-list",
    { params: { investmentStage: "0" } }
  );
  return response.data;
}

export async function exportRecommendations(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/recommendation/export", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.setAttribute("download", `Recommendations_${dateStr}.xlsx`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export interface UserRecommendationItem {
  id: number;
  amount: number;
  status: string;
  dateCreated: string;
  campaignId: number | null;
  campaignName: string | null;
}

export async function fetchUserRecommendations(userId: string): Promise<UserRecommendationItem[]> {
  const response = await axiosInstance.get<{ success: boolean; items: UserRecommendationItem[] }>(
    `/api/admin/recommendation/by-user/${userId}`
  );
  return response.data?.items || [];
}

export async function deleteRecommendation(id: number): Promise<any> {
  const response = await axiosInstance.delete(`/api/admin/recommendation/${id}`);
  return response.data;
}
