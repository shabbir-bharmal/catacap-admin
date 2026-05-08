import axiosInstance from "../axios";

export interface TestimonialMetric {
    key: string;
    value: string;
}

export interface TestimonialResponse {
    id: number;
    displayOrder: number;
    perspectiveText: string;
    description: string;
    metrics: TestimonialMetric[];
    role: string;
    organizationName: string;
    userFullName: string;
    userId?: string | null;
    profilePicture: string;
    status: boolean;
    videoLink?: string | null;
    linkedInvestmentIds?: number[];
    linkedCustomPageSlugs?: string[];
}

export interface PaginatedTestimonialResponse {
    items: TestimonialResponse[];
    totalCount: number;
}

export async function fetchTestimonials(params?: {
    Search?: string;
    searchValue?: string;
    PerspectiveText?: string;
    Status?: string;
    SortField?: string;
    SortDirection?: string;
    CurrentPage?: number;
    currentPage?: number;
    PerPage?: number;
    perPage?: number;
    IsDeleted?: boolean;
    isDeleted?: boolean;
}): Promise<PaginatedTestimonialResponse> {
    const queryParams: Record<string, any> = {};
    if (params) {
        if (params.Search || params.searchValue) {
            queryParams.SearchValue = params.Search || params.searchValue;
            queryParams.Search = params.Search || params.searchValue;
        }
        if (params.PerspectiveText) queryParams.PerspectiveText = params.PerspectiveText;
        if (params.Status) queryParams.Status = params.Status;
        if (params.SortField) queryParams.SortField = params.SortField;
        if (params.SortDirection) queryParams.SortDirection = params.SortDirection;
        const cp = params.CurrentPage ?? params.currentPage;
        if (cp !== undefined) queryParams.CurrentPage = cp;
        const pp = params.PerPage ?? params.perPage;
        if (pp !== undefined) queryParams.PerPage = pp;
        const del = params.IsDeleted ?? params.isDeleted;
        if (del !== undefined) queryParams.IsDeleted = del;
    }

    const response = await axiosInstance.get<PaginatedTestimonialResponse>("/api/admin/testimonial", {
        params: queryParams,
        headers: { Accept: "application/json" },
    });

    return response.data;
}

export async function fetchTestimonialById(id: number): Promise<TestimonialResponse> {
    const response = await axiosInstance.get<TestimonialResponse>(`/api/admin/testimonial/${id}`);
    return response.data;
}

export async function deleteTestimonial(id: number): Promise<void> {
    await axiosInstance.delete(`/api/admin/testimonial/${id}`, {
        headers: { Accept: "application/octet-stream" },
    });
}

export interface TestimonialCreateUpdatePayload {
    id?: number | null;
    displayOrder: number;
    perspectiveText: string;
    description: string;
    metrics: TestimonialMetric[];
    role: string;
    organizationName: string;
    userId: string;
    status: boolean;
    videoLink?: string | null;
    linkedInvestmentIds?: number[];
    linkedCustomPageSlugs?: string[];
}

export async function createOrUpdateTestimonial(payload: TestimonialCreateUpdatePayload): Promise<TestimonialResponse> {
    const response = await axiosInstance.post<TestimonialResponse>("/api/admin/testimonial", payload, {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/octet-stream"
        },
    });
    return response.data;
}

