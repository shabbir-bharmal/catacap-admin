import axiosInstance from "../axios";

export interface ChartData {
    month: string;
    amount: number;
}

export interface InvestmentChart {
    totalDonations: number;
    totalInvestments: number;
    growthRate: number;
    investors: number;
    chartData: ChartData[];
}

export interface SummaryData {
    totalDonations: number;
    totalGroups: number;
    totalUsers: number;
    averageDonation: number;
    donationGrowthPercentage: number;
    groupGrowthPercentage: number;
    userGrowthPercentage: number;
    avgDonationGrowthPercentage: number;
}

export interface ThemeInvestment {
    name: string;
    totalAmount: number;
    percentage: number;
}

export interface RecentInvestment {
    investor: string;
    firstName?: string;
    email?: string;
    userName: string;
    investment: string;
    amount: number;
    status: string;
    date: string;
}

export interface TopDonor {
    donor: string;
    amount: number;
    donations: number;
}

export interface TopGroup {
    group: string;
    investment: number;
    members: number;
}

export interface PaginatedResponse<T> {
    totalCount: number;
    items: T[];
}

export async function fetchInvestmentChart(months?: number): Promise<InvestmentChart> {
    const response = await axiosInstance.get<InvestmentChart>("/api/admin/home/investment-chart", {
        params: months ? { months } : undefined
    });
    return response.data;
}

export async function fetchSummary(): Promise<SummaryData> {
    const response = await axiosInstance.get<SummaryData>("/api/admin/home/summary");
    return response.data;
}

export async function fetchInvestmentByTheme(): Promise<ThemeInvestment[]> {
    const response = await axiosInstance.get<ThemeInvestment[]>("/api/admin/home/investment-by-theme");
    return response.data;
}

export interface DashboardTableParams {
    CurrentPage?: number;
    PerPage?: number;
    SortField?: string;
    SortDirection?: string;
    SearchValue?: string;
    Status?: string;
    InvestmentId?: number;
    FilterByGroup?: boolean;
    Stages?: string;
    InvestmentStatus?: boolean;
    id?: string;
    type?: string;
}

export async function fetchRecentInvestments(params?: DashboardTableParams): Promise<PaginatedResponse<RecentInvestment>> {
    const response = await axiosInstance.get<PaginatedResponse<RecentInvestment>>("/api/admin/home/recent-investments", {
        params: {
            CurrentPage: 1,
            PerPage: 10,
            ...params
        }
    });
    return response.data;
}

export async function fetchTopDonors(params?: DashboardTableParams): Promise<PaginatedResponse<TopDonor>> {
    const response = await axiosInstance.get<PaginatedResponse<TopDonor>>("/api/admin/home/top-donors", {
        params: {
            CurrentPage: 1,
            PerPage: 10,
            ...params
        }
    });
    return response.data;
}

export async function fetchTopGroups(params?: DashboardTableParams): Promise<PaginatedResponse<TopGroup>> {
    const response = await axiosInstance.get<PaginatedResponse<TopGroup>>("/api/admin/home/top-groups", {
        params: {
            CurrentPage: 1,
            PerPage: 10,
            ...params
        }
    });
    return response.data;
}

export interface AuditLogEntry {
    tableName: string;
    identifier: string | null;
    actionType: string | null;
    oldValues: string | null;
    newValues: string | null;
    changedColumns: string | null;
    updatedBy: string | null;
    updatedAt: string;
}

export async function fetchAuditLogs(params?: DashboardTableParams): Promise<PaginatedResponse<AuditLogEntry>> {
    const response = await axiosInstance.get<PaginatedResponse<AuditLogEntry>>("/api/admin/home/audit-logs", {
        params: {
            CurrentPage: 1,
            PerPage: 10,
            ...params
        }
    });
    return response.data;
}
