import { getUrlBlobContainerImage } from "@/lib/image-utils";
import axiosInstance from "../axios";

// ─── Type constants ────────────────────────────────────────────────────────────
export type SiteConfigType =
    | "sourcedby"
    | "themes"
    | "special-filters"
    | "transaction-type"
    | "investment-type-category"
    | "investment-terms"
    | "news-type"
    | "news-audience"
    | "statistics"
    | "meta-information"
    | "contact-info"
    | "daf-providers"
    | "Configuration";

// ─── Raw API response shapes (match actual server JSON) ───────────────────────

interface RawValueItem {
    id: number;
    value: string;
}

interface RawThemeItem {
    id: number;
    value: string;
    imageFileName: string;
    description: string | null;
}

interface RawStaticValueItem {
    id: number;
    key: string;
    value: string;
}

// ─── UI-friendly normalised interfaces ────────────────────────────────────────

export interface SourcedByItem {
    id: number;
    name: string;
}

export interface ThemeItem {
    id: number;
    name: string;
    /** Full Azure Blob URL built from imageFileName */
    image?: string;
    imageFileName?: string;
    description?: string;
}

export interface SpecialFilterItem {
    id: number;
    tag: string;
}

export interface StaticValueItem {
    id: number;
    key: string;
    value: string;
}

export interface TransactionTypeItem {
    id: number;
    name: string;
}

export interface InvestmentTypeCategoryItem {
    id: number;
    name: string;
}

export interface NewsTypeItem {
    id: number;
    name: string;
}

export interface NewsAudienceItem {
    id: number;
    name: string;
}

export interface StatisticsItem {
    id: number;
    key: string;
    value: string;
    type?: string;
}

export interface MetaInformationItem {
    id: number;
    key: string;
    value: string;
    additionalDetails: string;
    image?: string;
    imageName?: string;
}

export interface ContactInfoItem {
    id: number;
    key: string;
    value: string;
    type: string;
    description?: string;
}

export interface DAFProviderItem {
    id: number;
    name: string;
    url: string;
    isActive: boolean;
}

interface RawDAFProviderItem {
    id: number;
    value: string;
    link: string;
    isActive: boolean;
}

// ─── Internal helper ───────────────────────────────────────────────────────────

async function fetchRaw<T>(type: SiteConfigType): Promise<T[]> {
    const response = await axiosInstance.get<T[]>(
        `/api/admin/site-configuration/${type}`,
        { headers: { Accept: "application/json" } }
    );
    const data = response.data;
    if (Array.isArray(data)) return data;
    const anyData = data as any;
    return anyData?.items ?? anyData?.data ?? [];
}

// ─── Per-type fetchers (normalise raw → UI shape) ─────────────────────────────

export async function fetchSourcedBy(): Promise<SourcedByItem[]> {
    const raw = await fetchRaw<RawValueItem>("sourcedby");
    return raw.map((item) => ({ id: item.id, name: item.value }));
}

export async function fetchThemes(): Promise<ThemeItem[]> {
    const raw = await fetchRaw<RawThemeItem>("themes");
    return raw.map((item) => ({
        id: item.id,
        name: item.value,
        imageFileName: item.imageFileName,
        image: item.imageFileName ? getUrlBlobContainerImage(item.imageFileName) : undefined,
        description: item.description ?? undefined,
    }));
}

export async function fetchSpecialFilters(): Promise<SpecialFilterItem[]> {
    const raw = await fetchRaw<RawValueItem>("special-filters");
    return raw.map((item) => ({ id: item.id, tag: item.value }));
}

export async function fetchTransactionTypes(): Promise<TransactionTypeItem[]> {
    const raw = await fetchRaw<RawValueItem>("transaction-type");
    return raw.map((item) => ({ id: item.id, name: item.value }));
}

export async function fetchInvestmentTypeCategories(): Promise<InvestmentTypeCategoryItem[]> {
    const raw = await fetchRaw<RawValueItem>("investment-type-category");
    return raw.map((item) => ({ id: item.id, name: item.value }));
}

/** Static key/value entries – accessed via the `investment-terms` endpoint */
export async function fetchStaticValues(): Promise<StaticValueItem[]> {
    return fetchRaw<RawStaticValueItem>("investment-terms");
}

export async function fetchConfigurations(): Promise<StaticValueItem[]> {
    return fetchRaw<RawStaticValueItem>("Configuration");
}

export async function fetchNewsTypes(): Promise<NewsTypeItem[]> {
    const raw = await fetchRaw<RawValueItem>("news-type");
    return raw.map((item) => ({ id: item.id, name: item.value }));
}

export async function fetchNewsAudiences(): Promise<NewsAudienceItem[]> {
    const raw = await fetchRaw<RawValueItem>("news-audience");
    return raw.map((item) => ({ id: item.id, name: item.value }));
}

export async function fetchStatistics(): Promise<StatisticsItem[]> {
    // statistics returns { id, key, value } — same shape as investment-terms
    return fetchRaw<StatisticsItem>("statistics");
}

export async function fetchMetaInformation(): Promise<MetaInformationItem[]> {
    const raw = await fetchRaw<RawMetaInformationItem>("meta-information");
    return raw.map((item) => ({
        ...item,
        image: item.imageName ? getUrlBlobContainerImage(item.imageName) : undefined,
    }));
}

interface RawMetaInformationItem {
    id: number;
    key: string;
    value: string;
    additionalDetails: string;
    imageName?: string;
}

export async function fetchContactInfo(): Promise<ContactInfoItem[]> {
    return fetchRaw<ContactInfoItem>("contact-info");
}

export async function fetchDAFProviders(): Promise<DAFProviderItem[]> {
    const raw = await fetchRaw<RawDAFProviderItem>("daf-providers");
    return raw.map((item) => ({
        id: item.id,
        name: item.value ?? "",
        url: item.link ?? "",
        isActive: item.isActive,
    }));
}

export async function toggleDAFProviderActive(id: number | string): Promise<void> {
    const response = await axiosInstance.post<{ success: boolean; message?: string }>(
        `/api/admin/site-configuration/daf-providers/${id}/toggle-active`
    );
    if (response.data && response.data.success === false) {
        throw new Error(response.data.message ?? "Failed to update DAF provider status.");
    }
}

// ─── Combined fetch ────────────────────────────────────────────────────────────

export interface AllSiteConfigurations {
    sourcedBy: SourcedByItem[];
    themes: ThemeItem[];
    specialFilters: SpecialFilterItem[];
    transactionTypes: TransactionTypeItem[];
    investmentTypeCategories: InvestmentTypeCategoryItem[];
    staticValues: StaticValueItem[];
    configurations: StaticValueItem[];
    newsTypes: NewsTypeItem[];
    newsAudiences: NewsAudienceItem[];
    statistics: StatisticsItem[];
    metaInformation: MetaInformationItem[];
    contactInfo: ContactInfoItem[];
    dafProviders: DAFProviderItem[];
}

/**
 * Fetches all site-configuration sections in parallel.
 * Individual failures are swallowed – the section returns an empty array.
 */
export async function fetchAllSiteConfigurations(): Promise<AllSiteConfigurations> {
    const [
        sourcedByRes,
        themesRes,
        specialFiltersRes,
        transactionTypesRes,
        investmentTypeCategoriesRes,
        staticValuesRes,
        configurationsRes,
        newsTypesRes,
        newsAudiencesRes,
        statisticsRes,
        metaInformationRes,
        contactInfoRes,
        dafProvidersRes,
    ] =
        await Promise.allSettled([
            fetchSourcedBy(),
            fetchThemes(),
            fetchSpecialFilters(),
            fetchTransactionTypes(),
            fetchInvestmentTypeCategories(),
            fetchStaticValues(),
            fetchConfigurations(),
            fetchNewsTypes(),
            fetchNewsAudiences(),
            fetchStatistics(),
            fetchMetaInformation(),
            fetchContactInfo(),
            fetchDAFProviders(),
        ]);

    return {
        sourcedBy: sourcedByRes.status === "fulfilled" ? sourcedByRes.value : [],
        themes: themesRes.status === "fulfilled" ? themesRes.value : [],
        specialFilters: specialFiltersRes.status === "fulfilled" ? specialFiltersRes.value : [],
        transactionTypes: transactionTypesRes.status === "fulfilled" ? transactionTypesRes.value : [],
        investmentTypeCategories: investmentTypeCategoriesRes.status === "fulfilled" ? investmentTypeCategoriesRes.value : [],
        staticValues: staticValuesRes.status === "fulfilled" ? staticValuesRes.value : [],
        configurations: configurationsRes.status === "fulfilled" ? configurationsRes.value : [],
        newsTypes: newsTypesRes.status === "fulfilled" ? newsTypesRes.value : [],
        newsAudiences: newsAudiencesRes.status === "fulfilled" ? newsAudiencesRes.value : [],
        statistics: statisticsRes.status === "fulfilled" ? statisticsRes.value : [],
        metaInformation: metaInformationRes.status === "fulfilled" ? metaInformationRes.value : [],
        contactInfo: contactInfoRes.status === "fulfilled" ? contactInfoRes.value : [],
        dafProviders: dafProvidersRes.status === "fulfilled" ? dafProvidersRes.value : [],
    };
}

/**
 * Delete a single site-configuration item.
 * DELETE /api/admin/site-configuration/:type/:id
 *
 * The API may return HTTP 200 with { success: false, message: "..." } on
 * business-logic failures (e.g. item in use). We throw the server message
 * so the caller can display it in a toast.
 */
export async function deleteSiteConfigItem(
    type: SiteConfigType,
    id: number | string
): Promise<void> {
    const response = await axiosInstance.delete<{ success: boolean; message?: string }>(
        `/api/admin/site-configuration/${type}/${id}`
    );
    if (response.data && response.data.success === false) {
        throw new Error(response.data.message ?? "Failed to delete item.");
    }
}

// ─── Save (Create / Update) ────────────────────────────────────────────────────

export interface SiteConfigSavePayload {
    /** Present for update; omit for create */
    id?: number | string | null;
    /** The config section this item belongs to */
    type: SiteConfigType;
    /** Display label – used by sourcedby / themes / special-filters / transaction-type */
    value: string;
    /** Only for investment-terms (Static Values) */
    key?: string;
    /** Base64 image string – only for themes (create only) */
    image?: string;
    /** Blob filename – only for themes */
    imageFileName?: string;
    /** Optional description – only for themes */
    description?: string;
    /** Optional type – only for statistics */
    itemType?: string;
    /** Meta Information fields */
    additionalDetails?: string;
    /** Optional URL – only for daf-providers */
    link?: string;
}

/**
 * Create or update a site-configuration item.
 * POST /api/admin/site-configuration
 * – Include `id` for update; omit for create.
 *
 * Returns { success: false, message } on business errors (HTTP 200).
 */
export async function saveSiteConfigItem(payload: SiteConfigSavePayload): Promise<void> {
    const response = await axiosInstance.post<{ success: boolean; message?: string }>(
        "/api/admin/site-configuration",
        payload
    );
    if (response.data && response.data.success === false) {
        throw new Error(response.data.message ?? "Failed to save item.");
    }
}

// ─── Investment assignments ────────────────────────────────────────────────────

export interface ConfigItemInvestment {
    id: number;
    name: string;
    /** true = currently assigned to this config item */
    isSelected: boolean;
}

/**
 * Fetch all investments with their current assignment state for a config item.
 * GET /api/admin/site-configuration/:type/:id/investments
 */
export async function fetchConfigItemInvestments(
    type: SiteConfigType,
    itemId: number
): Promise<ConfigItemInvestment[]> {
    const response = await axiosInstance.get<ConfigItemInvestment[]>(
        `/api/admin/site-configuration/${type}/${itemId}/investments`
    );
    const data = response.data;
    if (Array.isArray(data)) return data;
    const any = data as any;
    return any?.items ?? any?.data ?? [];
}

/**
 * Toggle the investment assignment for a config item.
 * POST /api/admin/site-configuration/:type/:itemId/investments/:investmentId
 * (Calling this endpoint toggles the `isSelected` state server-side.)
 */
export async function toggleConfigItemInvestment(
    type: SiteConfigType,
    itemId: number,
    investmentId: number
): Promise<void> {
    await axiosInstance.post(
        `/api/admin/site-configuration/${type}/${itemId}/investments/${investmentId}`
    );
}
