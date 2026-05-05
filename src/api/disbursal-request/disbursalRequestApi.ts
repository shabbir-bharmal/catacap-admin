import axiosInstance, { getToken } from "../axios";

export enum DisbursalRequestStatus {
  Pending = 1,
  Completed = 2,
  Cancelled = 3,
}

export interface DisbursalRequestParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: DisbursalRequestStatus;
  isDeleted?: boolean;
}

export interface NoteEntry {
  id: number;
  note: string;
  userName: string;
  createdAt: string;
}

export interface MetricsPair {
  key: string;
  value: string;
}

export interface DisbursalRequestEntry {
  id: number;
  name: string;
  investmentId: number;
  property: string;
  email: string;
  mobile: string;
  receiveDate: string;
  distributedAmount: number;
  investmentType: string;
  pitchDeck: string | null;
  pitchDeckName: string | null;
  investmentDocument: string | null;
  investmentDocumentName: string | null;
  tracksMetrics?: boolean | null;
  metricsReport?: string | null;
  metricsReportName?: string | null;
  metricsPairs?: MetricsPair[] | null;
  hasNotes: boolean;
  noteEntries?: NoteEntry[];
  firstName?: string;
  lastName?: string;
  role?: string;
  url?: string;
  remainOpenOnCataCap?: "yes_public" | "yes_private" | "no";
  preferredReceiveDate?: string;
  fundingFromImpactAssets?: string;
  investmentTypeNames?: string;
  investmentRemainOpen?: "yes_public" | "yes_private" | "no";
  impactAssetsFundingPreviously?: string;
  status: DisbursalRequestStatus;
  quote?: string | null;
}

export interface PaginatedDisbursalRequestResponse {
  items: DisbursalRequestEntry[];
  totalCount: number;
}

export async function fetchDisbursalRequests(
  params?: DisbursalRequestParams
): Promise<PaginatedDisbursalRequestResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue) queryParams.SearchValue = params.searchValue;
    if (params.status !== undefined) queryParams.Status = params.status.toString();
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
  }

  const response = await axiosInstance.get<PaginatedDisbursalRequestResponse>(
    "/api/admin/disbursal-request",
    { params: queryParams }
  );

  return response.data;
}

export async function fetchDisbursalRequestDetails(id: number): Promise<DisbursalRequestEntry> {
  const response = await axiosInstance.get<DisbursalRequestEntry>(
    `/api/admin/disbursal-request/${id}`
  );
  return response.data;
}

export async function fetchDisbursalRequestNotes(id: number): Promise<NoteEntry[]> {
  const response = await axiosInstance.get<NoteEntry[]>(
    `/api/admin/disbursal-request/${id}/notes`
  );
  return response.data;
}

export async function addDisbursalRequestNote(
  id: number,
  payload: { note: string }
): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.post<{ success: boolean; message: string }>(
    `/api/admin/disbursal-request/${id}/notes`,
    JSON.stringify(payload.note),
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  return response.data;
}

export async function exportDisbursalRequests(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/disbursal-request/export", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.setAttribute("download", `DisbursalRequests_${dateStr}.xlsx`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export function downloadInvestmentDocument(
  action: string,
  pdfFileName: string,
  originalPdfFileName: string
): void {
  const token = getToken();
  const params = new URLSearchParams({
    action,
    pdfFileName,
    originalPdfFileName,
    stream: "true",
    _token: token,
  });
  window.location.href = `/api/admin/investment/document/?${params.toString()}`;
}

export async function updateDisbursalRequestStatus(
  id: number,
  status: DisbursalRequestStatus
): Promise<{ success: boolean; message: string }> {
  const response = await axiosInstance.put<{ success: boolean; message: string }>(
    `/api/admin/disbursal-request/${id}/status`,
    null,
    { params: { status } }
  );
  return response.data;
}

export async function deleteDisbursalRequest(id: number): Promise<any> {
  const response = await axiosInstance.delete(`/api/admin/disbursal-request/${id}`);
  return response.data;
}
