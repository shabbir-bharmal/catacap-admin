import axiosInstance from "../axios";

export interface ReferrerListParams {
  currentPage?: number;
  perPage?: number;
  sortField?: string;
  sortDirection?: string;
  searchValue?: string;
}

export interface ReferrerEntry {
  referrerId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  refCode: string;
  totalReferred: number;
  totalEvents: number;
  signups: number;
  groupJoins: number;
  investments: number;
  investmentsTotal: number;
  raiseMoneySignups: number;
  lastReferredAt: string | null;
}

export interface PaginatedReferrerResponse {
  items: ReferrerEntry[];
  totalCount: number;
  currentPage: number;
  perPage: number;
}

export async function fetchReferrers(params?: ReferrerListParams): Promise<PaginatedReferrerResponse> {
  const queryParams: Record<string, string> = {};
  if (params) {
    if (params.currentPage !== undefined) queryParams.CurrentPage = String(params.currentPage);
    if (params.perPage !== undefined) queryParams.PerPage = String(params.perPage);
    if (params.sortField) queryParams.SortField = params.sortField;
    if (params.sortDirection) queryParams.SortDirection = params.sortDirection;
    if (params.searchValue) queryParams.SearchValue = params.searchValue;
  }
  const response = await axiosInstance.get<PaginatedReferrerResponse>("/api/admin/referrals", {
    params: queryParams,
  });
  return response.data;
}

export interface ReferralEvent {
  id: number;
  actionType: string;
  targetId: string | null;
  targetName: string | null;
  targetSlug: string | null;
  sourcePath: string | null;
  createdAt: string;
  amount: number | null;
  referredUserId: string | null;
  referredFirstName: string;
  referredLastName: string;
  referredFullName: string;
  referredEmail: string;
}

export interface SignupSummary {
  referredUserId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  signupAt: string | null;
}

export interface GroupSummary {
  groupId: string | null;
  groupName: string | null;
  referralCount: number;
  lastJoinedAt: string | null;
}

export interface InvestmentSummary {
  campaignId: number;
  campaignName: string | null;
  campaignSlug: string | null;
  investorCount: number;
  recommendationCount: number;
  totalAmount: number;
}

export interface RaiseMoneySummary {
  campaignId: number;
  campaignName: string | null;
  campaignSlug: string | null;
  totalRaised: number;
  contributionCount: number;
}

export interface ReferralsByReferrerResponse {
  success: boolean;
  referrer: {
    id: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    refCode: string;
  } | null;
  items: ReferralEvent[];
  signupSummaries: SignupSummary[];
  groupSummaries: GroupSummary[];
  investmentSummaries: InvestmentSummary[];
  raiseMoneySummaries: RaiseMoneySummary[];
}

export async function fetchReferralsByReferrer(referrerId: string): Promise<ReferralsByReferrerResponse> {
  const response = await axiosInstance.get<ReferralsByReferrerResponse>(
    `/api/admin/referrals/by-referrer/${encodeURIComponent(referrerId)}`
  );
  return response.data;
}

export interface LinkReferralResponse {
  success: boolean;
  alreadyLinked: boolean;
  inserted: {
    signup: number;
    group_join: number;
    investment: number;
    raise_money_signup: number;
  };
  totalNew: number;
  message?: string;
}

export async function linkReferral(params: {
  referrerUserId: string;
  referredUserId: string;
}): Promise<LinkReferralResponse> {
  const response = await axiosInstance.post<LinkReferralResponse>(
    "/api/admin/referrals/link",
    params
  );
  return response.data;
}
