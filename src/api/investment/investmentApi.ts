import axiosInstance, { getToken } from "../axios";

export interface InvestmentParams {
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

export interface PaginatedInvestmentResponse {
    items: any[]; // The UI will map this if needed, or we can use the exact type
    totalCount: number;
    currentPage: number;
    perPage: number;
    totalPages: number;
}

export async function fetchInvestments(
    params?: InvestmentParams
): Promise<PaginatedInvestmentResponse> {
    const queryParams: Record<string, string> = {};

    if (params) {
        if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
        if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
        if (params.sortField) queryParams.SortField = params.sortField;
        if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
        if (params.searchValue !== undefined && params.searchValue !== null && params.searchValue !== "") queryParams.SearchValue = params.searchValue;
        if (params.status) queryParams.Status = params.status;
        if (params.investmentId !== undefined) queryParams.InvestmentId = params.investmentId.toString();
        if (params.filterByGroup !== undefined) queryParams.FilterByGroup = params.filterByGroup.toString();
        if (params.stages) queryParams.Stages = params.stages;
        if (params.investmentStatus !== undefined) queryParams.InvestmentStatus = params.investmentStatus.toString();
        if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
    }

    const response = await axiosInstance.get<PaginatedInvestmentResponse>(
        "/api/admin/investment",
        { params: queryParams }
    );

    return response.data;
}

export async function createInvestment(data: any): Promise<any> {
    const response = await axiosInstance.post("/api/admin/investment", data, {
        headers: {
            "Content-Type": "application/json"
        }
    });
    return response.data;
}

export async function exportInvestmentsData(): Promise<void> {
    const response = await axiosInstance.get("/api/admin/investment/export", {
        responseType: "blob",
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;

    const now = new Date();
    const fileName = `Investments_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.xlsx`;
    link.setAttribute("download", fileName);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
}

export async function fetchInvestmentNotes(investmentId: number): Promise<any> {
    const response = await axiosInstance.get(`/api/admin/investment/${investmentId}/notes`);
    return response.data;
}

export async function cloneInvestment(investmentId: number, name: string): Promise<any> {
    const response = await axiosInstance.post(`/api/admin/investment/${investmentId}/clone`, null, {
        params: { name }
    });
    return response.data;
}

export async function updateInvestmentStatus(investmentId: number, status: boolean): Promise<any> {
    const response = await axiosInstance.put(`/api/admin/investment/${investmentId}/status`, null, {
        params: { status }
    });
    return response.data;
}

export async function fetchInvestmentById(idOrSlug: string | number): Promise<any> {
    const response = await axiosInstance.get(`/api/admin/investment/${idOrSlug}`);
    return response.data;
}

export async function updateInvestment(investmentId: number, data: any): Promise<any> {
    const response = await axiosInstance.put(`/api/admin/investment/${investmentId}`, data, {
        headers: {
            "Content-Type": "application/json"
        }
    });
    return response.data;
}

export async function deleteInvestment(investmentId: number): Promise<any> {
    const response = await axiosInstance.delete(`/api/admin/investment/${investmentId}`);
    return response.data;
}

export type InvestmentContributionStatus = "pending" | "in transit" | "received";

export interface InvestmentMatchAsDonor {
    grantName: string;
    triggeredRecId: number | null;
    triggeredName: string | null;
    triggeredAmount: number | null;
    matchAmount: number;
    pending?: boolean;
}

export interface InvestmentMatchTriggered {
    grantName: string;
    donorName: string | null;
    donorRecId: number | null;
    matchAmount: number;
    pending?: boolean;
}

export interface InvestmentMatchInfo {
    asMatch: InvestmentMatchAsDonor | null;
    triggeredMatches: InvestmentMatchTriggered[];
}

export type InvestmentPaymentMethod = "wallet" | "daf" | "foundation" | "match";

export interface InvestmentInvestor {
    sourceId: number;
    sourceType: "recommendation" | "pending_grant" | "projected_match";
    name: string;
    email: string | null;
    totalAmount: number;
    date: string | null;
    status: InvestmentContributionStatus;
    paymentMethod: InvestmentPaymentMethod;
    dafProvider: string | null;
    dafName: string | null;
    match: InvestmentMatchInfo | null;
}

export interface InvestmentInvestorsResponse {
    campaignId: number;
    campaignName: string;
    totalInvestors: number;
    totalContributions: number;
    totalAmount: number;
    pendingMatchAmount?: number;
    pendingMatchCount?: number;
    items: InvestmentInvestor[];
}

export async function fetchInvestmentInvestors(
    investmentId: number,
): Promise<InvestmentInvestorsResponse> {
    const response = await axiosInstance.get<InvestmentInvestorsResponse>(
        `/api/admin/investment/${investmentId}/investors`,
    );
    return response.data;
}

export async function exportInvestmentInvestors(investmentId: number, investmentName: string): Promise<void> {
    const response = await axiosInstance.get(`/api/admin/investment/${investmentId}/investors/export`, {
        responseType: "blob",
    });

    if (response.headers["content-type"]?.includes("application/json")) {
        const text = await (response.data as Blob).text();
        const json = JSON.parse(text);
        if (json.Success === false || json.success === false) {
            throw new Error(json.Message || json.message || "There are no investors to export.");
        }
    }

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;

    const now = new Date();
    const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const cleanName = (investmentName || `investment_${investmentId}`).replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const fileName = `Investors_${cleanName}_${formattedDate}.xlsx`;

    link.setAttribute("download", fileName);
    link.target = "_self";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
}

export async function exportInvestmentRecommendations(investmentId: number, investmentName: string): Promise<void> {
    const response = await axiosInstance.get(`/api/admin/investment/${investmentId}/recommendations/export`, {
        responseType: "blob",
    });

    if (response.headers["content-type"]?.includes("application/json")) {
        const text = await (response.data as Blob).text();
        const json = JSON.parse(text);
        if (json.Success === false || json.success === false) {
            throw new Error(json.Message || json.message || "There are no recommendations to export.");
        }
    }

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;

    const now = new Date();
    const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const cleanName = investmentName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `Recommendations_${cleanName}_${formattedDate}.xlsx`;
    
    link.setAttribute("download", fileName);
    link.target = "_self";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
}

export async function fetchInvestmentData(): Promise<any> {
    const response = await axiosInstance.get("/api/admin/investment/data");
    return response.data;
}

export async function fetchCountries(): Promise<any> {
    const response = await axiosInstance.get("/api/admin/investment/countries");
    return response.data;
}


export async function fetchAllInvestmentNameList(investmentStage: number = 0, investmentId: number): Promise<any[]> {
    const response = await axiosInstance.get("/api/Campaign/get-all-investment-name-list", {
        params: { investmentStage, investmentId }
    });
    return response.data;
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

export enum InvestmentRequestStatus {
    Draft = 0,
    Submitted = 1,
    UnderReview = 2,
    Approved = 3,
    Rejected = 4
}

export interface InvestmentRequestItem {
    id: number;
    organization: string;
    country: string;
    status: InvestmentRequestStatus;
    statusName: string;
    submitted: string;
    goal: number | null;
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
}

export interface PaginatedInvestmentRequestResponse {
    items: InvestmentRequestItem[];
    totalCount: number;
}

export async function fetchInvestmentRequests(
    params?: InvestmentParams
): Promise<PaginatedInvestmentRequestResponse> {
    const queryParams: Record<string, string> = {};

    if (params) {
        if (params.currentPage !== undefined) queryParams.CurrentPage = params.currentPage.toString();
        if (params.perPage !== undefined) queryParams.PerPage = params.perPage.toString();
        if (params.sortField) queryParams.SortField = params.sortField;
        if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
        if (params.searchValue !== undefined && params.searchValue !== null && params.searchValue !== "") queryParams.SearchValue = params.searchValue;
        if (params.status) queryParams.investmentRequestStatus = params.status;
        if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
    }

    const response = await axiosInstance.get<PaginatedInvestmentRequestResponse>(
        "/api/admin/investment/request",
        { params: queryParams }
    );

    return response.data;
}

export async function fetchInvestmentRequestById(id: number): Promise<{ item: any }> {
    const response = await axiosInstance.get<{ item: any }>(`/api/admin/investment/request/${id}`);
    return response.data;
}

export async function sendInvestmentQrCodeEmail(investmentId: number, investmentTag: string): Promise<{ success: boolean; message: string }> {
    const response = await axiosInstance.get<{ success: boolean; message: string }>(
        "/api/Campaign/send-investment-qr-code-email",
        { params: { id: investmentId, investmentTag } }
    );
    return response.data;
}

export interface CampaignUpdateAttachmentItem {
    id: number;
    filePath: string;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    sortOrder: number;
    fileUrl: string | null;
}

export interface CampaignUpdateImpactHighlight {
    label: string;
    value: string;
}

export interface CampaignUpdateItem {
    id: number;
    campaignId: number;
    subject: string;
    description: string | null;
    shortDescription: string | null;
    attachFile: string | null;
    attachFileName: string | null;
    attachFileUrl: string | null;
    attachments: CampaignUpdateAttachmentItem[];
    startDate: string | null;
    endDate: string | null;
    impactHighlights: CampaignUpdateImpactHighlight[] | null;
    createdAt: string;
    updatedAt: string;
}

export type CampaignUpdateAttachmentInput =
    | { id: number }
    | { data: string; name: string };

export interface CampaignUpdatePayload {
    subject: string;
    description?: string | null;
    shortDescription?: string | null;
    attachments?: CampaignUpdateAttachmentInput[];
    startDate?: string | null;
    endDate?: string | null;
    impactHighlights?: CampaignUpdateImpactHighlight[];
}

export interface CampaignUpdateEmailLogItem {
    id: number;
    sentAt: string;
    recipientCount: number;
    sentByUserId: string | null;
    sentByName: string | null;
}

export async function fetchCampaignUpdates(investmentId: number): Promise<CampaignUpdateItem[]> {
    const response = await axiosInstance.get<{ success: boolean; items: CampaignUpdateItem[] }>(
        `/api/admin/investment/${investmentId}/updates`
    );
    return response.data.items || [];
}

export async function createCampaignUpdate(
    investmentId: number,
    data: CampaignUpdatePayload
): Promise<{ success: boolean; message?: string; item?: CampaignUpdateItem }> {
    const response = await axiosInstance.post(
        `/api/admin/investment/${investmentId}/updates`,
        data
    );
    return response.data;
}

export async function updateCampaignUpdate(
    investmentId: number,
    updateId: number,
    data: CampaignUpdatePayload
): Promise<{ success: boolean; message?: string; item?: CampaignUpdateItem }> {
    const response = await axiosInstance.put(
        `/api/admin/investment/${investmentId}/updates/${updateId}`,
        data
    );
    return response.data;
}

export async function sendCampaignUpdateEmail(
    investmentId: number,
    updateId: number
): Promise<{ success: boolean; message?: string; sent?: number; failed?: number; recipientCount?: number; ccCount?: number }> {
    const response = await axiosInstance.post(
        `/api/admin/investment/${investmentId}/updates/${updateId}/send-email`
    );
    return response.data;
}

export async function fetchCampaignUpdateEmailLogs(
    investmentId: number,
    updateId: number
): Promise<CampaignUpdateEmailLogItem[]> {
    const response = await axiosInstance.get<{ success: boolean; items: CampaignUpdateEmailLogItem[] }>(
        `/api/admin/investment/${investmentId}/updates/${updateId}/email-logs`
    );
    return response.data.items || [];
}

export async function getCampaignUpdateEmailPreview(
    investmentId: number,
    updateId: number
): Promise<{ success: boolean; message?: string; subject?: string; bodyHtml?: string; from?: string; cc?: string[]; recipientCount?: number }> {
    const response = await axiosInstance.get(
        `/api/admin/investment/${investmentId}/updates/${updateId}/email-preview`
    );
    return response.data;
}

export async function deleteCampaignUpdate(
    investmentId: number,
    updateId: number
): Promise<{ success: boolean; message?: string }> {
    const response = await axiosInstance.delete(
        `/api/admin/investment/${investmentId}/updates/${updateId}`
    );
    return response.data;
}

export async function exportInvestmentNotesApi(campaignId: number, campaignName?: string): Promise<void> {
    const response = await axiosInstance.get("/api/Campaign/export-investment-notes", {
        params: { campaignId },
        responseType: "blob",
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;

    const now = new Date();
    const formattedDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const cleanName = campaignName ? campaignName : "investment";
    const fileName = `${cleanName}_Investment_Notes_${formattedDate}.xlsx`;

    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
}
