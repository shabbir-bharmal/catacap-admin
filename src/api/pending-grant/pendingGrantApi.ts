import axiosInstance from "../axios";

export interface PendingGrantParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
  status?: string;
  isDeleted?: boolean;
  dafProvider?: string;
  foundationGrantsOnly?: boolean;
}

export interface NoteAttachmentEntry {
  id: number;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  url: string | null;
}

export interface NoteEntry {
  id: number;
  oldStatus: string;
  newStatus: string;
  note: string;
  userName: string;
  createdAt: string;
  attachments?: NoteAttachmentEntry[];
}

export interface AttachmentUploadInput {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface PendingGrantEntry {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  amount: string;
  amountAfterFees: number;
  dafName: string | null;
  dafProvider: string;
  investmentName: string | null;
  reference: string | null;
  status: string;
  hasNotes: boolean;
  daysCount: string;
  createdDate: string;
  noteEntries?: NoteEntry[];
}

export interface PaginatedPendingGrantResponse {
  items: PendingGrantEntry[];
  totalCount: number;
  currentPage: number;
  perPage: number;
  totalPages: number;
}

export async function fetchPendingGrants(
  params?: PendingGrantParams
): Promise<PaginatedPendingGrantResponse> {
  const queryParams: Record<string, string> = {};

  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
    if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue !== undefined && params.searchValue !== null && params.searchValue !== "") queryParams.SearchValue = params.searchValue;
    if (params.status && params.status !== "All") queryParams.Status = params.status;
    if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
    if (params.dafProvider && params.dafProvider !== "All") queryParams.DafProvider = params.dafProvider;
    if (params.foundationGrantsOnly) queryParams.foundationGrantsOnly = "true";
  }

  const response = await axiosInstance.get<PaginatedPendingGrantResponse>(
    "/api/admin/pending-grant",
    { params: queryParams }
  );

  return response.data;
}

export interface UpdatePendingGrantPayload {
  id: number;
  status: string;
  amount?: number;
  note?: string;
  noteEmail?: string[];
  attachments?: AttachmentUploadInput[];
}

export interface UpdatePendingGrantResponse {
  success: boolean;
  message: string;
}

export async function updatePendingGrant(
  payload: UpdatePendingGrantPayload
): Promise<UpdatePendingGrantResponse> {
  const response = await axiosInstance.put<UpdatePendingGrantResponse>(
    `/api/admin/pending-grant/${payload.id}`,
    payload
  );
  return response.data;
}

export async function fetchPendingGrantNotes(
  id: number
): Promise<NoteEntry[]> {
  const response = await axiosInstance.get<NoteEntry[]>(
    `/api/admin/pending-grant/${id}/notes`
  );
  return response.data;
}

export async function exportPendingGrants(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/pending-grant/export", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.setAttribute("download", `PendingGrants_${dateStr}.xlsx`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function exportPendingGrantsByDaf(): Promise<void> {
  const response = await axiosInstance.get("/api/admin/pending-grant/export-by-daf", {
    responseType: "blob",
  });

  const blob = new Blob([response.data]);
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;

  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  link.setAttribute("download", `DAF_Providers_Summary_${dateStr}.xlsx`);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export async function deletePendingGrant(id: number): Promise<any> {
  const response = await axiosInstance.delete(`/api/admin/pending-grant/${id}`);
  return response.data;
}

export interface DafProviderEntry {
  id: number;
  value: string;
  link: string;
  isActive?: boolean;
}

export async function fetchDafProviders(): Promise<DafProviderEntry[]> {
  const response = await axiosInstance.get<DafProviderEntry[] | { items?: DafProviderEntry[]; data?: DafProviderEntry[] }>(
    "/api/admin/site-configuration/daf-providers"
  );
  const data = response.data;
  if (Array.isArray(data)) return data;
  const anyData = data as { items?: DafProviderEntry[]; data?: DafProviderEntry[] } | null | undefined;
  return anyData?.items ?? anyData?.data ?? [];
}
