import axiosInstance from "../axios";

export interface NewsParams {
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

// Raw shape returned by the API (matches actual server response)
export interface NewsApiItem {
    id: number;
    title: string;
    description: string;
    typeId: number | null;
    type: string;          // maps to "medium" in the UI
    audienceId: number | null;
    audience: string;
    themeId: number | null;
    theme: string;
    imageFileName: string; // just the filename; build full URL as needed
    link: string;
    status: boolean;       // true = Published, false = Draft
    newsDate: string;      // e.g. "24 Feb 2026"
    linkedInvestmentIds?: number[];
    linkedCustomPageSlugs?: string[];
}

export interface PaginatedNewsResponse {
    items: NewsApiItem[];
    totalCount: number;
    currentPage: number;
    perPage: number;
    totalPages: number;
}

export async function fetchNews(
    params?: NewsParams
): Promise<PaginatedNewsResponse> {
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
        if (params.investmentStatus !== undefined) queryParams.InvestmentStatus = params.investmentStatus.toString();
        if (params.isDeleted !== undefined) queryParams.IsDeleted = params.isDeleted.toString();
    }

    const response = await axiosInstance.get<any>(
        "/api/admin/news",
        {
            params: queryParams,
            headers: { Accept: "application/json" },
        }
    );

    const data = response.data;

    // Normalise: server may return { items, totalCount } OR a bare array
    if (Array.isArray(data)) {
        return { items: data, totalCount: data.length, currentPage: 1, perPage: data.length, totalPages: 1 };
    }

    return {
        items: data?.items ?? data?.data ?? [],
        totalCount: data?.totalCount ?? data?.total ?? 0,
        currentPage: data?.currentPage ?? 1,
        perPage: data?.perPage ?? 10,
        totalPages: data?.totalPages ?? 1,
    };
}


export interface NewsCreateUpdatePayload {
    /** Include id for update; omit (or pass null/undefined) for create */
    id?: number | null;
    title: string;
    description: string;
    newsTypeId: number | null;
    audienceId: number | null;
    themeId: number | null;
    /** Full blob URL or base64 string */
    image: string;
    /** Bare filename stored in Azure Blob Storage */
    imageFileName: string;
    newsLink: string;
    /** true = Published, false = Draft */
    status: boolean;
    /** ISO 8601 date-time string, e.g. "2026-02-25T00:00:00.000Z" */
    newsDate: string;
    /** Investment ids this article should be shown on (multi-select). */
    linkedInvestmentIds?: number[];
    /** Custom-page slugs this article should be shown on (multi-select).
     *  The "home" slug represents the home page. */
    linkedCustomPageSlugs?: string[];
}

/**
 * Create or update a news article.
 * POST /api/admin/news
 * – Sending `id` → backend treats as UPDATE
 * – Omitting `id` → backend treats as CREATE
 */
export async function createOrUpdateNews(payload: NewsCreateUpdatePayload): Promise<any> {
    const response = await axiosInstance.post("/api/admin/news", payload);
    return response.data;
}

/**
 * Delete a news article by id.
 * DELETE /api/admin/news/{id}
 */
export async function deleteNews(id: number): Promise<any> {
    const response = await axiosInstance.delete(`/api/admin/news/${id}`);
    return response.data;
}

/** A generic {id, name} pair returned by lookup/dropdown endpoints */
export interface DropdownOption {
    id: number;
    name: string;
}

export interface NewsDropdownOptions {
    types: DropdownOption[];
    audiences: DropdownOption[];
    themes: DropdownOption[];
}

/**
 * Fetch all dropdown options (types, audiences, themes) needed for the news form.
 * Endpoints are called in parallel.
 */
export async function fetchNewsDropdownOptions(): Promise<NewsDropdownOptions> {
    const toOptions = (data: any): DropdownOption[] => {
        let items = [];
        if (Array.isArray(data)) items = data;
        else if (data && Array.isArray(data.items)) items = data.items;
        else if (data && Array.isArray(data.data)) items = data.data;

        return items
            .filter((item: any) => item && (item.id !== undefined))
            .map((item: any) => ({
                id: item.id,
                name: item.name ?? item.value ?? item.title ?? String(item.id)
            }));
    };

    const [typesRes, audiencesRes, themesRes] = await Promise.allSettled([
        axiosInstance.get<any>("/api/admin/site-configuration/news-type"),
        axiosInstance.get<any>("/api/admin/site-configuration/news-audience"),
        axiosInstance.get<any>("/api/admin/site-configuration/themes"),
    ]);

    return {
        types: typesRes.status === "fulfilled" ? toOptions(typesRes.value.data) : [],
        audiences: audiencesRes.status === "fulfilled" ? toOptions(audiencesRes.value.data) : [],
        themes: themesRes.status === "fulfilled" ? toOptions(themesRes.value.data) : [],
    };
}
