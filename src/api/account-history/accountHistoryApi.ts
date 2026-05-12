import axiosInstance from "../axios";

export interface AccountHistoryParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: string;
  investmentId?: number;
  filterByGroup?: boolean;
  stages?: string;
  isDeleted?: boolean;
}

export interface AccountHistoryEntry {
  id: number;
  userName: string | null;
  changeDate: string | null;
  investmentName: string | null;
  paymentType: string | null;
  oldValue: number;
  newValue: number;
  comment?: string;
  grossAmount: number | null;
  fees: number | null;
  netAmount: number | null;
}

export interface PaginatedAccountHistoryResponse {
  items: AccountHistoryEntry[];
  totalCount: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
}

export async function fetchAllAccountBalanceHistories(
  params?: AccountHistoryParams
): Promise<PaginatedAccountHistoryResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue !== undefined && params.searchValue !== null) queryParams.SearchValue = params.searchValue;
    if (params.status) queryParams.Status = params.status;
    if (params.investmentId !== undefined) queryParams.InvestmentId = params.investmentId.toString();
    if (params.filterByGroup !== undefined) queryParams.FilterByGroup = params.filterByGroup.toString();
    if (params.stages) queryParams.Stages = params.stages;
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
  }

  const response = await axiosInstance.get<PaginatedAccountHistoryResponse>(
    "/api/admin/transaction-history",
    { params: queryParams }
  );

  return response.data;
}

export async function exportAccountBalanceHistoryData(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/transaction-history/export", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const fileName = `AccountBalanceHistories_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.xlsx`;
  link.setAttribute("download", fileName);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function deleteAccountHistory(id: number): Promise<any> {
  const response = await axiosInstance.delete(`/api/admin/transaction-history/${id}`);
  return response.data;
}
