import axiosInstance from "../axios";

export interface GroupParams {
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
    activeFilter?: string;
}

// Raw shape returned by the API
export interface GroupApiItem {
    id: number;
    name: string;
    identifier: string;
    isDeactivated: boolean;
    isCorporateGroup: boolean;
    isPrivateGroup: boolean;
    featuredGroup: boolean;
    leader: string;
    groupOwner: string;
    groupOwnerId: string | null;
    member: number;
    memberInvestedTotal?: number;
    investment: number;
    groupThemes?: string;
}

export interface PaginatedGroupResponse {
    items: GroupApiItem[];
    totalCount: number;
}

export interface GroupLeadersResponse {
    leaders: {
        userId: string;
        roleAndTitle: string;
        description: string;
        fullName: string;
        pictureFileName: string | null;
        linkedInUrl: string;
        isOwner: boolean;
    }[];
}

export interface GroupChampionsResponse {
    champions: {
        userId: string;
        roleAndTitle: string;
        description: string;
        fullName: string;
        pictureFileName: string | null;
        memberSince: string | null;
    }[];
}

export interface GroupReportsResponse {
    cumulativeMembership: { month: string; newGroups: number; cumulativeGroups: number }[];
    fundingBuckets: { threshold: number; groupCount: number }[];
    totals: { groupsWithTwoOrMore: number; groupsWithAnyInvestment: number };
}

export async function fetchGroupReports(): Promise<GroupReportsResponse> {
    const response = await axiosInstance.get<GroupReportsResponse>("/api/admin/group/reports");
    return response.data;
}

export interface GroupReportingItem {
    id: number;
    name: string;
    identifier: string;
    memberCount: number;
    throughCutoff: number;
    throughToday: number;
    increase: number;
    pctIncrease: number;
}

export interface GroupReportingResponse {
    items: GroupReportingItem[];
    cutoffLabel: string;
}

export async function fetchGroupReporting(): Promise<GroupReportingResponse> {
    const response = await axiosInstance.get<GroupReportingResponse>("/api/admin/group/group-reporting");
    return response.data;
}

export async function fetchAllGroups(): Promise<GroupUpdatePayload[]> {
    const response = await axiosInstance.get<GroupUpdatePayload[]>("/api/Group");
    return response.data;
}

export interface GroupIdName {
    id: number;
    name: string;
}

export async function fetchAllGroupsIdName(): Promise<GroupIdName[]> {
    const response = await axiosInstance.get<GroupIdName[]>("/api/Group/id-name");
    return response.data;
}

export async function fetchGroups(
    params?: GroupParams
): Promise<PaginatedGroupResponse> {
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
        if (params.activeFilter) queryParams.ActiveFilter = params.activeFilter;
    }

    const response = await axiosInstance.get<PaginatedGroupResponse>(
        "/api/admin/group",
        { params: queryParams }
    );

    return response.data;
}

export async function exportGroupsData(): Promise<void> {
    const response = await axiosInstance.get("/api/admin/group/export", {
        responseType: "blob",
    });

    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;

    const now = new Date();
    const fileName = `Groups_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.xlsx`;
    link.setAttribute("download", fileName);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
}

export interface GroupDetail {
    group: {
        id: number;
        name: string;
        identifier: string;
        description?: string;
        website?: string;
        groupWebsite?: string;
        didYouKnow?: string;
        videoLink?: string;
        mediaLink?: string;
        ourWhyDescription?: string;
        mediaDescription?: string;
        isApprouveRequired?: boolean;
        requireApproval?: boolean;
        isPrivateGroup?: boolean;
        makePrivate?: boolean;
        isDeactivated?: boolean;
        deactivateGroup?: boolean;
        pictureFileName?: string;
        backgroundPictureFileName?: string;
        originalBalance?: number;
        currentBalance?: number;
        isOwner?: boolean;
        isFollowing?: boolean;
        isFollowPending?: boolean;
        isLeader?: boolean;
        isCorporateGroup?: boolean;
        groupThemes?: string;
        metaTitle?: string;
        metaDescription?: string;
        [key: string]: any;
    };
    leaders: any[];
    champions: any[];
}

export interface GroupUpdatePayload {
    id: number;
    token?: string;
    name?: string;
    pictureFileName?: string;
    backgroundPictureFileName?: string;
    website?: string;
    description?: string;
    identifier?: string;
    videoLink?: string | null;
    ourWhyDescription?: string | null;
    didYouKnow?: string;
    originalBalance?: number;
    currentBalance?: number;
    isApprouveRequired?: boolean;
    isDeactivated?: boolean;
    isOwner?: boolean;
    isFollowing?: boolean;
    isFollowPending?: boolean;
    isLeader?: boolean;
    isCorporateGroup?: boolean;
    isPrivateGroup?: boolean;
    featuredGroup?: boolean;
    leaders?: string | null;
    championsAndCatalysts?: string | null;
    themes?: string;
    sdGs?: string;
    groupThemes?: string;
    groupAccountBalance?: {
        userId: string;
        groupId: number;
        groupName: string;
        balance: number;
    };
    metaTitle?: string;
    metaDescription?: string;
}

export interface GroupLeader {
    id: string;
    name: string;
    role: string;
    description: string;
    linkedinUrl: string;
    pictureFileName?: string | null;
    isOwner?: boolean;
    email?: string | null;
}

export interface GroupLeadersSectionProps {
    apiGroupId: number | null;
    leaders: GroupLeader[];
    setLeaders: (leaders: GroupLeader[]) => void;
    cardClassName?: string;
}

export interface Champion {
    id: string;
    name: string;
    role: string;
    description?: string;
    pictureFileName?: string | null;
}

export interface ChampionsCatalystsSectionProps {
    apiGroupId: number | null;
    champions: Champion[];
    setChampions: (champions: Champion[]) => void;
    cardClassName?: string;
}


export async function fetchGroupDetail(identifier: string): Promise<GroupDetail> {
    const response = await axiosInstance.get<GroupDetail>(`/api/admin/group/${identifier}`);
    return response.data;
}

export async function fetchGroupLeaders(groupId: number): Promise<GroupLeadersResponse> {
    const response = await axiosInstance.get<GroupLeadersResponse>(`/api/admin/group/${groupId}/leaders`);
    return response.data;
}

export interface GroupAllMember {
    id: string;
    fullName: string;
    email: string;
    role: "Owner" | "Leader" | "Member";
}

export interface GroupAllMembersResponse {
    groupId: number;
    groupName: string;
    members: GroupAllMember[];
}

export async function fetchGroupAllMembers(groupId: number): Promise<GroupAllMembersResponse> {
    const response = await axiosInstance.get<GroupAllMembersResponse>(
        `/api/admin/group/${groupId}/all-members`
    );
    return response.data;
}

export async function fetchGroupChampions(groupId: number): Promise<GroupChampionsResponse> {
    const response = await axiosInstance.get<GroupChampionsResponse>(`/api/admin/group/${groupId}/champions`);
    return response.data;
}

export async function updateGroup(id: number, payload: GroupUpdatePayload): Promise<any> {
    const response = await axiosInstance.put(`/api/admin/group/${id}`, payload, {
        headers: {
            "Accept": "application/octet-stream"
        },
        responseType: "blob"
    });
    return response.data;
}

export async function searchLeadersAndChampions(groupId: number, userName: string, type: "leaders" | "champions"): Promise<any[]> {
    const response = await axiosInstance.get("/api/admin/group/leaders-and-champions", {
        params: { groupId, userName, type }
    });
    return Array.isArray(response.data) ? response.data : [];
}

export async function saveLeaderOrChampion(groupId: number, type: "leaders" | "champions", data: {
    UserId: string;
    RoleAndTitle?: string | null;
    Description?: string | null;
    LinkedInUrl?: string | null;
}): Promise<void> {
    await axiosInstance.post("/api/admin/group/leaders-and-champions", data, {
        params: { groupId, type }
    });
}

export async function deleteLeaderOrChampion(groupId: number, userId: string, type: "leaders" | "champions"): Promise<void> {
    await axiosInstance.delete("/api/admin/group/leaders-and-champions", {
        params: { groupId, userId, type }
    });
}

export async function updateGroupSettings(id: number, settings: { featuredGroup?: boolean; isCorporateGroup?: boolean }): Promise<void> {
    await axiosInstance.patch("/api/admin/group/settings", null, {
        params: {
            id,
            featuredGroup: settings.featuredGroup,
            isCorporateGroup: settings.isCorporateGroup
        },
        headers: {
            "Accept": "application/octet-stream"
        }
    });
}

export async function deleteGroup(id: number): Promise<any> {
    const response = await axiosInstance.delete(`/api/admin/group/${id}`);
    return response.data;
}

export interface GroupInvestmentCampaign {
    id: number;
    name: string;
    stage: number;
    stageLabel: string;
    imageFileName: string | null;
    raised?: number;
    investorCount?: number;
    investorAvatars?: string[];
    isPrivateAccess?: boolean;
}

export interface GroupInvestmentsResponse {
    groupCampaigns: GroupInvestmentCampaign[];
    publicCampaigns: GroupInvestmentCampaign[];
    completedCampaigns: GroupInvestmentCampaign[];
}

export async function fetchGroupInvestments(groupId: number): Promise<GroupInvestmentsResponse> {
    const response = await axiosInstance.get<GroupInvestmentsResponse>("/api/admin/group/group-investments", {
        params: { groupId }
    });
    return response.data;
}

export async function updateGroupInvestments(groupId: number, campaignIds: number[]): Promise<any> {
    const response = await axiosInstance.put("/api/admin/group/update-group-investments", campaignIds, {
        params: { groupId }
    });
    return response.data;
}

export interface GroupCampaignInvestment {
    id: number;
    name: string;
    stage: number;
    stageLabel: string;
    isActive: boolean;
    isPrivateAccess: boolean;
    investorCount: number;
    totalInvested: number;
}

export interface GroupCampaignInvestmentsResponse {
    groupName: string;
    campaigns: GroupCampaignInvestment[];
}

export async function fetchGroupCampaignInvestments(groupId: number): Promise<GroupCampaignInvestmentsResponse> {
    const response = await axiosInstance.get<GroupCampaignInvestmentsResponse>(
        `/api/admin/group/${groupId}/campaign-investments`,
    );
    return response.data;
}
