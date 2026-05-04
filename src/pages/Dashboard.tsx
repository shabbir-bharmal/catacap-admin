import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocation } from "wouter";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DollarSign, Users, UsersRound, TrendingUp, ArrowUpRight, ArrowDownRight, Clock, Briefcase, Search, Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fetchInvestmentChart,
  fetchSummary,
  fetchInvestmentByTheme,
  fetchRecentInvestments,
  fetchTopDonors,
  fetchTopGroups,
  type InvestmentChart,
  type SummaryData,
  type ThemeInvestment,
  type RecentInvestment,
  type TopDonor,
  type TopGroup
} from "../api/home/homeApi";
import { SortIcon } from "../components/ui/table-sort";
import { currency_format } from "@/helpers/format";

function getInitials(name: string) {
  if (!name) return "";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function buildThankYouMailto(item: { investor: string; firstName?: string; email?: string; investment: string }) {
  const firstName = (item.firstName || item.investor.split(" ")[0] || "there").trim();
  const subject = `Thank you for investing in ${item.investment} on CataCap`;
  const body =
    `Hi ${firstName},\n\n` +
    `I wanted to send you a quick personal note to say thank you for your investment in ${item.investment} on CataCap. It means a great deal that you've chosen to put your philanthropic capital behind this work, and on behalf of our whole team, we're truly grateful.\n\n` +
    `One of the things we care about most is hearing directly from our donor investors. I'd love to better understand what matters to you, so please feel free to hit reply and share:\n\n` +
    `  • What you like about CataCap, and how we can improve to better support you\n` +
    `  • The themes and causes you care about most\n` +
    `  • The kinds of investments you'd like to see featured on CataCap\n` +
    `  • Any friends or colleagues who might want to join you in investing in impact together using philanthropic capital\n\n` +
    `Your suggestions and feedback genuinely shape where we take this platform next. Thank you again for being part of CataCap.\n\n` +
    `With gratitude,\n\n` +
    `Ken Kurtzig\n` +
    `Co-Founder, CataCap`;
  const params = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${item.email || ""}?${params}`;
}

function AnimatedCounter({
  end,
  prefix = "",
  suffix = "",
  separator = ",",
  decimals = 0,
  duration = 2000
}: {
  end: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
  decimals?: number;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    const animate = (timestamp: number) => {
      if (!startTime.current) startTime.current = timestamp;
      const progress = Math.min((timestamp - startTime.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end * Math.pow(10, decimals)) / Math.pow(10, decimals));
      if (progress < 1) {
        rafId.current = requestAnimationFrame(animate);
      }
    };
    rafId.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId.current);
  }, [end, duration, decimals]);

  const formatted = count.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return (
    <span>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

export default function AdminDashboard() {
  const [, setLocation] = useLocation();
  const [chartPeriod, setChartPeriod] = useState<"all" | "6m" | "1m">("all");
  const [loading, setLoading] = useState(true);

  const [investmentChart, setInvestmentChart] = useState<InvestmentChart | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [themeInvestments, setThemeInvestments] = useState<ThemeInvestment[]>([]);
  const [recentInvests, setRecentInvests] = useState<{ totalCount: number; items: RecentInvestment[] }>({ totalCount: 0, items: [] });
  const [topDonorList, setTopDonorList] = useState<{ totalCount: number; items: TopDonor[] }>({ totalCount: 0, items: [] });
  const [topGroupList, setTopGroupList] = useState<{ totalCount: number; items: TopGroup[] }>({ totalCount: 0, items: [] });

  const [donorsPage, setDonorsPage] = useState(1);
  const [groupsPage, setGroupsPage] = useState(1);
  const [recentInvestsPage, setRecentInvestsPage] = useState(1);

  const [investsSearchValue, setInvestsSearchValue] = useState("");
  const [investsStatus, setInvestsStatus] = useState("all");
  const [investsSortField, setInvestsSortField] = useState<string | undefined>(undefined);
  const [investsSortDirection, setInvestsSortDirection] = useState<"asc" | "desc" | undefined>(undefined);

  const toggleSort = (field: string) => {
    if (investsSortField === field) {
      if (investsSortDirection === "asc") setInvestsSortDirection("desc");
      else if (investsSortDirection === "desc") {
        setInvestsSortField(undefined);
        setInvestsSortDirection(undefined);
      }
    } else {
      setInvestsSortField(field);
      setInvestsSortDirection("asc");
    }
  };

  const [donorsSortField, setDonorsSortField] = useState<string | undefined>(undefined);
  const [donorsSortDirection, setDonorsSortDirection] = useState<"asc" | "desc" | undefined>(undefined);

  const toggleDonorsSort = (field: string) => {
    if (donorsSortField === field) {
      if (donorsSortDirection === "asc") setDonorsSortDirection("desc");
      else if (donorsSortDirection === "desc") {
        setDonorsSortField(undefined);
        setDonorsSortDirection(undefined);
      }
    } else {
      setDonorsSortField(field);
      setDonorsSortDirection("asc");
    }
  };

  const [groupsSortField, setGroupsSortField] = useState<string | undefined>(undefined);
  const [groupsSortDirection, setGroupsSortDirection] = useState<"asc" | "desc" | undefined>(undefined);

  const toggleGroupsSort = (field: string) => {
    if (groupsSortField === field) {
      if (groupsSortDirection === "asc") setGroupsSortDirection("desc");
      else if (groupsSortDirection === "desc") {
        setGroupsSortField(undefined);
        setGroupsSortDirection(undefined);
      }
    } else {
      setGroupsSortField(field);
      setGroupsSortDirection("asc");
    }
  };

  const [themeError, setThemeError] = useState(false);

  useEffect(() => {
    const fetchMainData = async () => {
      setLoading(true);
      const [summaryResult, themeResult] = await Promise.allSettled([
        fetchSummary(),
        fetchInvestmentByTheme(),
      ]);

      if (summaryResult.status === "fulfilled") {
        setSummary(summaryResult.value);
      } else {
        console.error("Error fetching summary data:", summaryResult.reason);
      }

      if (themeResult.status === "fulfilled") {
        setThemeInvestments(themeResult.value);
        setThemeError(false);
      } else {
        console.error("Error fetching investment by theme:", themeResult.reason);
        setThemeError(true);
      }

      setLoading(false);
    };
    fetchMainData();
  }, []);

  useEffect(() => {
    fetchTopDonors({
      CurrentPage: donorsPage,
      PerPage: 10,
      SortField: donorsSortField,
      SortDirection: donorsSortDirection
    })
      .then(setTopDonorList)
      .catch(console.error);
  }, [donorsPage, donorsSortField, donorsSortDirection]);

  useEffect(() => {
    fetchTopGroups({
      CurrentPage: groupsPage,
      PerPage: 10,
      SortField: groupsSortField,
      SortDirection: groupsSortDirection
    })
      .then(setTopGroupList)
      .catch(console.error);
  }, [groupsPage, groupsSortField, groupsSortDirection]);

  useEffect(() => {
    fetchRecentInvestments({
      CurrentPage: recentInvestsPage,
      PerPage: 10,
      SearchValue: investsSearchValue || undefined,
      Status: investsStatus !== "all" ? investsStatus : undefined,
      SortField: investsSortField,
      SortDirection: investsSortDirection
    })
      .then(setRecentInvests)
      .catch(console.error);
  }, [recentInvestsPage, investsSearchValue, investsStatus, investsSortField, investsSortDirection]);

  useEffect(() => {
    const months = chartPeriod === "1m" ? 1 : chartPeriod === "6m" ? 6 : undefined;
    fetchInvestmentChart(months).then(setInvestmentChart).catch(console.error);
  }, [chartPeriod]);

  const renderPagination = (currentPage: number, totalCount: number, setPage: (p: number) => void) => {
    const totalPages = Math.ceil(totalCount / 10);
    if (totalPages <= 1) return null;

    const pages = [];
    for (let i = Math.max(1, currentPage - 1); i <= Math.min(totalPages, currentPage + 1); i++) {
      pages.push(i);
    }

    return (
      <div className="flex gap-1">
        <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
          &laquo;
        </Button>
        {pages.map((p) => (
          <Button key={p} variant={p === currentPage ? "default" : "outline"} size="sm" className="h-7 w-7 p-0 text-xs" onClick={() => setPage(p)}>
            {p}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
          &raquo;
        </Button>
      </div>
    );
  };

  const chartData = investmentChart?.chartData || [];

  const statCards = summary
    ? [
        {
          title: "Total Donations",
          value: summary.totalDonations,
          prefix: "$",
          suffix: "",
          decimals: 0,
          separator: ",",
          change: summary.donationGrowthPercentage,
          trend: summary.donationGrowthPercentage >= 0 ? ("up" as const) : ("down" as const),
          description: "vs. previous month",
          icon: DollarSign,
          iconBg: "bg-[#0ab39c]/10 dark:bg-[#0ab39c]/20",
          iconColor: "text-[#0ab39c]",
          link: "View all donations",
          url: "/account-history"
        },
        {
          title: "Total Groups",
          value: summary.totalGroups,
          prefix: "",
          suffix: "",
          decimals: 0,
          separator: ",",
          change: summary.groupGrowthPercentage,
          trend: summary.groupGrowthPercentage >= 0 ? ("up" as const) : ("down" as const),
          description: "vs. previous month",
          icon: UsersRound,
          iconBg: "bg-[#299cdb]/10 dark:bg-[#299cdb]/20",
          iconColor: "text-[#299cdb]",
          link: "View all groups",
          url: "/groups"
        },
        {
          title: "Total Users",
          value: summary.totalUsers,
          prefix: "",
          suffix: "",
          decimals: 0,
          separator: ",",
          change: summary.userGrowthPercentage,
          trend: summary.userGrowthPercentage >= 0 ? ("up" as const) : ("down" as const),
          description: "vs. previous month",
          icon: Users,
          iconBg: "bg-[#405189]/10 dark:bg-[#405189]/20",
          iconColor: "text-[#405189]",
          link: "View all users",
          url: "/users"
        },
        {
          title: "Avg. Donation",
          value: summary.averageDonation,
          prefix: "$",
          suffix: "",
          decimals: 0,
          separator: ",",
          change: summary.avgDonationGrowthPercentage,
          trend: summary.avgDonationGrowthPercentage >= 0 ? ("up" as const) : ("down" as const),
          description: "vs. previous month",
          icon: TrendingUp,
          iconBg: "bg-[#f7b84b]/10 dark:bg-[#f7b84b]/20",
          iconColor: "text-[#f7b84b]",
          link: "View details",
          url: "/account-history"
        }
      ]
    : [];

  return (
    <AdminLayout title="Dashboard">
      <div className="space-y-6">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between flex-wrap">
          <div>
            <h4 className="text-base font-semibold" data-testid="text-dashboard-heading">
              Dashboard
            </h4>
            <p className="text-sm text-muted-foreground" data-testid="text-dashboard-subtitle">
              Here's what's happening with Catacap Platform
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
              {statCards.map((stat) => {
                const key = stat.title.toLowerCase().replace(/[\s.]+/g, "-");
                return (
                  <Card key={stat.title} className="transition-transform duration-200 bg-card" data-testid={`card-stat-${key}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate" data-testid={`text-stat-label-${key}`}>
                            {stat.title}
                          </p>
                        </div>
                        <div>
                          <span className={`inline-flex items-center text-xs font-medium ${stat.trend === "up" ? "text-[#0ab39c]" : "text-[#f06548]"}`} data-testid={`text-stat-change-${key}`}>
                            {stat.trend === "up" ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
                            {Math.abs(stat.change)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-3 mt-3">
                        <div>
                          <h4 className="text-[22px] font-semibold leading-none mb-3" data-testid={`text-stat-value-${key}`}>
                            <AnimatedCounter end={stat.value} prefix={stat.prefix} suffix={stat.suffix} separator={stat.separator} decimals={stat.decimals} />
                          </h4>
                          <a
                            href="#"
                            className="text-xs text-muted-foreground underline decoration-dashed underline-offset-2 hover:text-foreground transition-colors"
                            onClick={(e) => {
                              e.preventDefault();
                              setLocation(stat.url);
                            }}
                          >
                            {stat.link}
                          </a>
                        </div>
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${stat.iconBg}`}>
                          <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="grid gap-4 grid-cols-1 xl:grid-cols-12">
              <Card className="xl:col-span-8" data-testid="card-donations-chart">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-md font-semibold" data-testid="text-chart-title">
                    Revenue
                  </CardTitle>
                  <div className="flex gap-1">
                    {(["all", "6m", "1m"] as const).map((period) => (
                      <Button
                        key={period}
                        size="sm"
                        variant={chartPeriod === period ? "default" : "secondary"}
                        className="h-6 text-xs px-3"
                        onClick={() => setChartPeriod(period)}
                        data-testid={`button-chart-${period}`}
                      >
                        {period === "all" ? "ALL" : period === "6m" ? "6M" : "1M"}
                      </Button>
                    ))}
                  </div>
                </CardHeader>
                <div className="grid grid-cols-2 sm:grid-cols-4 border-y bg-muted/30">
                  <div className="p-3 text-center border-r border-dashed">
                    <p className="text-sm font-semibold" data-testid="text-summary-donations">
                      {currency_format(investmentChart?.totalDonations || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Donations</p>
                  </div>
                  <div className="p-3 text-center border-r border-dashed">
                    <p className="text-sm font-semibold" data-testid="text-summary-investments">
                      {currency_format(investmentChart?.totalInvestments || 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Investments</p>
                  </div>
                  <div className="p-3 text-center border-r border-dashed">
                    <p className={`text-sm font-semibold ${(investmentChart?.growthRate || 0) >= 0 ? "text-[#0ab39c]" : "text-[#f06548]"}`}>
                      {(investmentChart?.growthRate || 0) >= 0 ? "+" : "-"}
                      {Math.abs(investmentChart?.growthRate || 0)}%
                    </p>
                    <p className="text-xs text-muted-foreground">Growth Rate</p>
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-sm font-semibold">{investmentChart?.investors || 0}</p>
                    <p className="text-xs text-muted-foreground">Investors</p>
                  </div>
                </div>
                <CardContent className="pt-4 pb-2">
                  <div className="h-[300px]" data-testid="chart-monthly-donations">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <defs>
                          <linearGradient id="investmentGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ab39c" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#0ab39c" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                        <XAxis dataKey="month" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis
                          className="text-xs"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "6px",
                            fontSize: "12px",
                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)"
                          }}
                          formatter={(value: number) => [currency_format(value), "Amount"]}
                        />
                        <Area type="monotone" dataKey="amount" stroke="#0ab39c" strokeWidth={2} fill="url(#investmentGradient)" name="Amount" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center gap-6 pt-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-[#0ab39c]" />
                      Amount
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="xl:col-span-4" data-testid="card-investment-breakdown">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold mb-4">Investment by Theme</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {themeError ? (
                    <p className="text-sm text-destructive">Failed to load theme data. Please try refreshing the page.</p>
                  ) : themeInvestments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No theme data available.</p>
                  ) : (
                    themeInvestments.map((cat, i) => {
                      const colors = ["bg-[#405189]", "bg-[#0ab39c]", "bg-[#299cdb]", "bg-[#f7b84b]", "bg-[#f06548]", "bg-[#405189]/70", "bg-muted-foreground", "bg-[#0ab39c]/70"];
                      const color = colors[i % colors.length];
                      return (
                        <div key={cat.name} className="pb-3">
                          <div className="flex items-center justify-between gap-2 my-1">
                            <span className="text-xs font-medium">
                              {cat.name} <span className="text-success-foreground">({cat.percentage}%)</span>
                            </span>
                            <span className="text-sm text-foreground">{currency_format(cat.totalAmount)}</span>
                          </div>
                          <div className="h-1.5 w-full bg-white border border-border rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${cat.percentage}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>
            </div>

            <Card data-testid="card-recent-investments">
              <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center justify-between w-full sm:w-auto">
                  <CardTitle className="text-sm font-semibold" data-testid="text-recent-investments-title">
                    Recent Investments
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      type="search"
                      placeholder="Search investments..."
                      className="h-8 w-[150px] sm:w-[200px] pl-8 text-xs"
                      value={investsSearchValue}
                      onChange={(e) => setInvestsSearchValue(e.target.value)}
                    />
                  </div>
                  <Select value={investsStatus} onValueChange={setInvestsStatus}>
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-8 bg-secondary text-white text-xs" data-testid="button-view-all-investments" onClick={() => setLocation("/investments")}>
                    View All
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="pl-5 text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleSort("investor")}>
                          <div className="flex items-center gap-1">
                            Investor <SortIcon field="investor" sortField={investsSortField || null} sortDir={investsSortDirection || null} />
                          </div>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleSort("investment")}>
                          <div className="flex items-center gap-1">
                            Investment <SortIcon field="investment" sortField={investsSortField || null} sortDir={investsSortDirection || null} />
                          </div>
                        </TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleSort("amount")}>
                          <div className="flex items-center justify-end gap-1">
                            Amount <SortIcon field="amount" sortField={investsSortField || null} sortDir={investsSortDirection || null} />
                          </div>
                        </TableHead>
                        <TableHead className="text-center text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleSort("status")}>
                          <div className="flex items-center justify-center gap-1">
                            Status <SortIcon field="status" sortField={investsSortField || null} sortDir={investsSortDirection || null} />
                          </div>
                        </TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleSort("date")}>
                          <div className="flex items-center justify-end gap-1">
                            Date <SortIcon field="date" sortField={investsSortField || null} sortDir={investsSortDirection || null} />
                          </div>
                        </TableHead>
                        <TableHead className="text-center pr-5 text-xs uppercase tracking-wider font-medium w-[60px]">
                          Thank
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentInvests.items.map((item, idx) => (
                        <TableRow key={idx} data-testid={`row-recent-investment-${idx}`} className="hover-elevate odd:bg-card even:bg-muted/30">
                          <TableCell className="pl-5">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-8 w-8">
                                <AvatarFallback className="text-[10px] bg-[#405189]/10 text-[#405189] dark:bg-[#405189]/20">{getInitials(item.investor)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium leading-tight" data-testid={`text-recent-investor-${idx}`}>
                                  {item.investor}
                                </p>
                                <p className="text-xs text-muted-foreground">{item.userName}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm" data-testid={`text-recent-investment-name-${idx}`}>
                                {item.investment}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm font-semibold text-[#0ab39c]" data-testid={`text-recent-investment-amount-${idx}`}>
                              {currency_format(item.amount)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              className={`text-[10px] no-default-hover-elevate no-default-active-elevate border-0 ${item.status === "approved" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : item.status === "rejected" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
                              data-testid={`badge-investment-status-${idx}`}
                            >
                              {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground" data-testid={`text-recent-investment-date-${idx}`}>
                              <Clock className="h-3 w-3" />
                              {item.date}
                            </div>
                          </TableCell>
                          <TableCell className="text-center pr-5">
                            {item.email ? (
                              <Button
                                asChild
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-[#405189] hover:bg-[#405189]/10"
                                data-testid={`button-thank-${idx}`}
                                title="Send thank-you email"
                              >
                                <a href={buildThankYouMailto(item)}>
                                  <Mail className="h-3.5 w-3.5" />
                                </a>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap px-5 py-3 border-t text-xs text-muted-foreground">
                  <span>
                    Showing <span className="font-medium text-foreground">{recentInvests.totalCount === 0 ? 0 : (recentInvestsPage - 1) * 10 + 1}</span> to{" "}
                    <span className="font-medium text-foreground">{Math.min(recentInvestsPage * 10, recentInvests.totalCount)}</span> of{" "}
                    <span className="font-medium text-foreground">{recentInvests.totalCount}</span> investments
                  </span>
                  {renderPagination(recentInvestsPage, recentInvests.totalCount, setRecentInvestsPage)}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
              <Card data-testid="card-top-donors">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-semibold" data-testid="text-top-donors-title">
                    Top Donors
                  </CardTitle>
                  <Badge variant="secondary" className="h-7" data-testid="badge-donors-period">
                    All Time
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleDonorsSort("donor")}>
                            <div className="flex items-center gap-1">
                              Donor <SortIcon field="donor" sortField={donorsSortField || null} sortDir={donorsSortDirection || null} />
                            </div>
                          </TableHead>
                          <TableHead className="text-right text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleDonorsSort("amount")}>
                            <div className="flex items-center justify-end gap-1">
                              Amount <SortIcon field="amount" sortField={donorsSortField || null} sortDir={donorsSortDirection || null} />
                            </div>
                          </TableHead>
                          <TableHead className="text-right pr-5 text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleDonorsSort("donations")}>
                            <div className="flex items-center justify-end gap-1">
                              Donations <SortIcon field="donations" sortField={donorsSortField || null} sortDir={donorsSortDirection || null} />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topDonorList.items.map((donor, idx) => (
                          <TableRow key={idx} data-testid={`row-donor-${idx}`} className={idx % 2 === 0 ? "bg-card" : "bg-muted/30"}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-[10px] bg-[#405189]/10 text-[#405189] dark:bg-[#405189]/20">{getInitials(donor.donor)}</AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-sm font-medium leading-tight" data-testid={`text-donor-name-${idx}`}>
                                    {donor.donor}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-semibold" data-testid={`text-donor-amount-${idx}`}>
                                {currency_format(donor.amount)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-5" data-testid={`text-donor-count-${idx}`}>
                              {donor.donations}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap px-5 py-3 border-t text-xs text-muted-foreground">
                    <span>
                      Showing <span className="font-medium text-foreground">{topDonorList.totalCount === 0 ? 0 : (donorsPage - 1) * 10 + 1}</span> to{" "}
                      <span className="font-medium text-foreground">{Math.min(donorsPage * 10, topDonorList.totalCount)}</span> of{" "}
                      <span className="font-medium text-foreground">{topDonorList.totalCount}</span> donors
                    </span>
                    {renderPagination(donorsPage, topDonorList.totalCount, setDonorsPage)}
                  </div>
                </CardContent>
              </Card>

              <Card data-testid="card-top-groups">
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-semibold" data-testid="text-top-groups-title">
                    Top Groups by Investment
                  </CardTitle>
                  <Badge variant="secondary" className="h-7" data-testid="badge-groups-period">
                    All Time
                  </Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleGroupsSort("group")}>
                            <div className="flex items-center gap-1">
                              Group <SortIcon field="group" sortField={groupsSortField || null} sortDir={groupsSortDirection || null} />
                            </div>
                          </TableHead>
                          <TableHead className="text-right text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleGroupsSort("investment")}>
                            <div className="flex items-center justify-end gap-1">
                              Investment <SortIcon field="investment" sortField={groupsSortField || null} sortDir={groupsSortDirection || null} />
                            </div>
                          </TableHead>
                          <TableHead className="text-right pr-5 text-xs uppercase tracking-wider font-medium cursor-pointer" onClick={() => toggleGroupsSort("members")}>
                            <div className="flex items-center justify-end gap-1">
                              Members <SortIcon field="members" sortField={groupsSortField || null} sortDir={groupsSortDirection || null} />
                            </div>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topGroupList.items.map((group, idx) => (
                          <TableRow key={idx} data-testid={`row-group-${idx}`} className={idx % 2 === 0 ? "bg-card" : "bg-muted/30"}>
                            <TableCell>
                              <div className="flex items-center gap-2.5">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-[10px] bg-[#405189]/10 text-[#405189] dark:bg-[#405189]/20">{getInitials(group.group)}</AvatarFallback>
                                </Avatar>
                                <p className="text-sm font-medium leading-tight" data-testid={`text-group-name-${idx}`}>
                                  {group.group}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm font-semibold" data-testid={`text-group-investment-${idx}`}>
                                {currency_format(group.investment)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right pr-5">
                              <span className="text-sm font-medium" data-testid={`text-group-members-count-${idx}`}>
                                {group.members}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap px-5 py-3 border-t text-xs text-muted-foreground">
                    <span>
                      Showing <span className="font-medium text-foreground">{topGroupList.totalCount === 0 ? 0 : (groupsPage - 1) * 10 + 1}</span> to{" "}
                      <span className="font-medium text-foreground">{Math.min(groupsPage * 10, topGroupList.totalCount)}</span> of{" "}
                      <span className="font-medium text-foreground">{topGroupList.totalCount}</span> groups
                    </span>
                    {renderPagination(groupsPage, topGroupList.totalCount, setGroupsPage)}
                  </div>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
