import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Plus, Search } from "lucide-react";
import { AddReferralDialog } from "@/components/AddReferralDialog";
import { SortHeader } from "@/components/ui/table-sort";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useSort } from "../hooks/useSort";
import { currency_format, formatDate } from "../helpers/format";
import {
  fetchReferrers,
  fetchReferralsByReferrer,
  ReferrerEntry,
} from "../api/referral/referralApi";

type SortField =
  | "fullname"
  | "email"
  | "refcode"
  | "totalreferred"
  | "signups"
  | "groupjoins"
  | "investments"
  | "raisemoneysignups"
  | "lastreferredat";

type ViewMode = "events" | "signups" | "groups" | "investments" | "raisemoney";

const ACTION_LABELS: Record<string, string> = {
  signup: "Signup",
  group_join: "Group Join",
  investment: "Investment",
  raise_money_signup: "Raise Money Signup",
};

function actionBadgeClass(action: string): string {
  switch (action) {
    case "signup":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "group_join":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "investment":
      return "bg-green-100 text-green-700 border-green-200";
    case "raise_money_signup":
      return "bg-amber-100 text-amber-700 border-amber-200";
    default:
      return "bg-muted text-foreground";
  }
}

const VIEW_LABEL: Record<ViewMode, string> = {
  events: "All events",
  signups: "Signups",
  groups: "Group joins",
  investments: "Investments",
  raisemoney: "Raise money",
};

function ReferrerEventsRow({
  referrerId,
  viewMode,
  setViewMode,
}: {
  referrerId: string;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["referrals", "by-referrer", referrerId],
    queryFn: () => fetchReferralsByReferrer(referrerId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <td colSpan={10} className="px-6 py-4 text-sm text-muted-foreground bg-muted/30">
        Loading referrals...
      </td>
    );
  }
  if (error) {
    return (
      <td colSpan={10} className="px-6 py-4 text-sm text-destructive bg-muted/30">
        Failed to load referrals.
      </td>
    );
  }
  const events = data?.items ?? [];
  const signups = data?.signupSummaries ?? [];
  const groups = data?.groupSummaries ?? [];
  const investments = data?.investmentSummaries ?? [];
  const raiseMoney = data?.raiseMoneySummaries ?? [];

  const tabs: { key: ViewMode; label: string; count: number }[] = [
    { key: "events", label: "All events", count: events.length },
    { key: "signups", label: "Signups", count: signups.length },
    { key: "groups", label: "Group joins", count: groups.length },
    { key: "investments", label: "Investments", count: investments.length },
    { key: "raisemoney", label: "Raise money", count: raiseMoney.length },
  ];

  return (
    <td colSpan={10} className="p-0 bg-muted/30">
      <div className="px-6 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2" data-testid={`tabs-referral-view-${referrerId}`}>
          <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">View:</span>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setViewMode(t.key)}
              className={
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition-colors " +
                (viewMode === t.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground hover:bg-muted")
              }
              data-testid={`tab-view-${t.key}-${referrerId}`}
            >
              {t.label}
              <span className="opacity-70">({t.count})</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {viewMode === "events" && <EventsTable items={events} referrerId={referrerId} />}
          {viewMode === "signups" && <SignupsTable items={signups} referrerId={referrerId} />}
          {viewMode === "groups" && <GroupsTable items={groups} referrerId={referrerId} />}
          {viewMode === "investments" && <InvestmentsTable items={investments} referrerId={referrerId} />}
          {viewMode === "raisemoney" && <RaiseMoneyTable items={raiseMoney} referrerId={referrerId} />}
        </div>
      </div>
    </td>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{message}</div>;
}

function EventsTable({ items, referrerId }: { items: any[]; referrerId: string }) {
  if (items.length === 0) return <EmptyState message="No referral events found." />;
  return (
    <table className="w-full text-sm" data-testid={`table-referral-events-${referrerId}`}>
      <thead>
        <tr className="border-b">
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referred User</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source Path</th>
        </tr>
      </thead>
      <tbody>
        {items.map((ev) => (
          <tr key={ev.id} className="border-b last:border-b-0" data-testid={`row-referral-event-${ev.id}`}>
            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap" data-testid={`text-event-date-${ev.id}`}>
              {ev.createdAt ? formatDate(ev.createdAt) : "—"}
            </td>
            <td className="px-3 py-2">
              <Badge variant="outline" className={actionBadgeClass(ev.actionType)} data-testid={`badge-event-action-${ev.id}`}>
                {ACTION_LABELS[ev.actionType] || ev.actionType}
              </Badge>
            </td>
            <td className="px-3 py-2" data-testid={`text-event-referred-${ev.id}`}>
              {ev.referredUserId ? (
                <Link
                  href={`/users?search=${encodeURIComponent(ev.referredEmail || ev.referredUserId)}`}
                  className="text-primary hover:underline"
                >
                  {ev.referredFullName || "—"}
                </Link>
              ) : (
                ev.referredFullName || "—"
              )}
            </td>
            <td className="px-3 py-2 text-muted-foreground" data-testid={`text-event-referred-email-${ev.id}`}>
              {ev.referredEmail || "—"}
            </td>
            <td className="px-3 py-2" data-testid={`text-event-target-${ev.id}`}>
              {ev.targetName ? (
                ev.actionType === "investment" && ev.targetSlug ? (
                  <Link href={`/raisemoney/edit/${ev.targetSlug}`} className="text-primary hover:underline">
                    {ev.targetName}
                  </Link>
                ) : ev.actionType === "group_join" && ev.targetId ? (
                  <Link href={`/groups/${ev.targetId}/edit`} className="text-primary hover:underline">
                    {ev.targetName}
                  </Link>
                ) : (
                  ev.targetName
                )
              ) : ev.targetId ? (
                <span className="text-muted-foreground">#{ev.targetId}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-3 py-2 text-muted-foreground max-w-[320px] truncate" title={ev.sourcePath || ""} data-testid={`text-event-source-${ev.id}`}>
              {ev.sourcePath || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignupsTable({ items, referrerId }: { items: any[]; referrerId: string }) {
  if (items.length === 0) return <EmptyState message="No signups attributed to this referrer." />;
  return (
    <table className="w-full text-sm" data-testid={`table-referral-signups-${referrerId}`}>
      <thead>
        <tr className="border-b">
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
        </tr>
      </thead>
      <tbody>
        {items.map((s) => (
          <tr key={s.referredUserId} className="border-b last:border-b-0" data-testid={`row-signup-${s.referredUserId}`}>
            <td className="px-3 py-2" data-testid={`text-signup-name-${s.referredUserId}`}>
              <Link
                href={`/users?search=${encodeURIComponent(s.email || s.referredUserId)}`}
                className="text-primary hover:underline"
              >
                {s.fullName || "—"}
              </Link>
            </td>
            <td className="px-3 py-2 text-muted-foreground" data-testid={`text-signup-email-${s.referredUserId}`}>
              {s.email || "—"}
            </td>
            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap" data-testid={`text-signup-date-${s.referredUserId}`}>
              {s.signupAt ? formatDate(s.signupAt) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GroupsTable({ items, referrerId }: { items: any[]; referrerId: string }) {
  if (items.length === 0) return <EmptyState message="No group joins attributed to this referrer." />;
  const total = items.reduce((s, g) => s + (g.referralCount || 0), 0);
  return (
    <table className="w-full text-sm" data-testid={`table-referral-groups-${referrerId}`}>
      <thead>
        <tr className="border-b">
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referrals in Group</th>
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Most Recent Join</th>
        </tr>
      </thead>
      <tbody>
        {items.map((g) => (
          <tr key={String(g.groupId)} className="border-b last:border-b-0" data-testid={`row-group-${g.groupId}`}>
            <td className="px-3 py-2" data-testid={`text-group-name-${g.groupId}`}>
              {g.groupName ? (
                <Link href={`/groups/${g.groupId}/edit`} className="text-primary hover:underline">
                  {g.groupName}
                </Link>
              ) : (
                <span className="text-muted-foreground">#{g.groupId || "—"}</span>
              )}
            </td>
            <td className="px-3 py-2 text-right font-medium tabular-nums" data-testid={`text-group-count-${g.groupId}`}>
              {g.referralCount}
            </td>
            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap" data-testid={`text-group-date-${g.groupId}`}>
              {g.lastJoinedAt ? formatDate(g.lastJoinedAt) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t bg-muted/40 font-semibold">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-group-total-${referrerId}`}>{total}</td>
          <td className="px-3 py-2"></td>
        </tr>
      </tfoot>
    </table>
  );
}

function InvestmentsTable({ items, referrerId }: { items: any[]; referrerId: string }) {
  if (items.length === 0) return <EmptyState message="No investments attributed to this referrer." />;
  const totalCount = items.reduce((s, i) => s + (i.recommendationCount || 0), 0);
  const totalAmount = items.reduce((s, i) => s + (i.totalAmount || 0), 0);
  return (
    <table className="w-full text-sm" data-testid={`table-referral-investments-${referrerId}`}>
      <thead>
        <tr className="border-b">
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Referred Investors</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider"># of Investments</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Invested</th>
        </tr>
      </thead>
      <tbody>
        {items.map((inv) => (
          <tr key={inv.campaignId} className="border-b last:border-b-0" data-testid={`row-investment-${inv.campaignId}`}>
            <td className="px-3 py-2" data-testid={`text-investment-name-${inv.campaignId}`}>
              {inv.campaignName ? (
                inv.campaignSlug ? (
                  <Link href={`/investments/${inv.campaignId}/investors`} className="text-primary hover:underline">
                    {inv.campaignName}
                  </Link>
                ) : (
                  inv.campaignName
                )
              ) : (
                <span className="text-muted-foreground">#{inv.campaignId}</span>
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investment-investors-${inv.campaignId}`}>
              {inv.investorCount}
            </td>
            <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investment-count-${inv.campaignId}`}>
              {inv.recommendationCount}
            </td>
            <td className="px-3 py-2 text-right font-medium tabular-nums" data-testid={`text-investment-amount-${inv.campaignId}`}>
              {currency_format(inv.totalAmount)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t bg-muted/40 font-semibold">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2"></td>
          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investment-total-count-${referrerId}`}>{totalCount}</td>
          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investment-total-amount-${referrerId}`}>
            {currency_format(totalAmount)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function RaiseMoneyTable({ items, referrerId }: { items: any[]; referrerId: string }) {
  if (items.length === 0) return <EmptyState message="No raise-money signups attributed to this referrer." />;
  const totalRaised = items.reduce((s, c) => s + (c.totalRaised || 0), 0);
  return (
    <table className="w-full text-sm" data-testid={`table-referral-raisemoney-${referrerId}`}>
      <thead>
        <tr className="border-b">
          <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Company / Campaign</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contributions</th>
          <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Raised on CataCap</th>
        </tr>
      </thead>
      <tbody>
        {items.map((c) => (
          <tr key={c.campaignId} className="border-b last:border-b-0" data-testid={`row-raisemoney-${c.campaignId}`}>
            <td className="px-3 py-2" data-testid={`text-raisemoney-name-${c.campaignId}`}>
              {c.campaignName ? (
                c.campaignSlug ? (
                  <Link href={`/raisemoney/edit/${c.campaignSlug}`} className="text-primary hover:underline">
                    {c.campaignName}
                  </Link>
                ) : (
                  c.campaignName
                )
              ) : (
                <span className="text-muted-foreground">#{c.campaignId}</span>
              )}
            </td>
            <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-raisemoney-count-${c.campaignId}`}>
              {c.contributionCount}
            </td>
            <td className="px-3 py-2 text-right font-medium tabular-nums" data-testid={`text-raisemoney-amount-${c.campaignId}`}>
              {currency_format(c.totalRaised)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t bg-muted/40 font-semibold">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2"></td>
          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-raisemoney-total-${referrerId}`}>
            {currency_format(totalRaised)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

export default function ReferralsPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewModes, setViewModes] = useState<Record<string, ViewMode>>({});
  const [addReferralOpen, setAddReferralOpen] = useState(false);

  const { sortField, sortDir, handleSort: originalHandleSort } = useSort<SortField>("lastreferredat", "desc");
  const handleSort = (field: SortField) => {
    originalHandleSort(field);
    setCurrentPage(1);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      setSearchValue(searchInput.trim());
      setCurrentPage(1);
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["referrers", currentPage, rowsPerPage, sortField, sortDir, searchValue],
    queryFn: () =>
      fetchReferrers({
        currentPage,
        perPage: rowsPerPage,
        sortField: sortField ?? undefined,
        sortDirection: sortDir ?? undefined,
        searchValue: searchValue || undefined,
      }),
    staleTime: 0,
  });

  const items: ReferrerEntry[] = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;

  const openWithView = (id: string, view: ViewMode) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setViewModes((prev) => ({ ...prev, [id]: view }));
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const setViewMode = (id: string, view: ViewMode) =>
    setViewModes((prev) => ({ ...prev, [id]: view }));

  const countCellClass = (count: number) =>
    count > 0
      ? "text-primary hover:underline cursor-pointer font-medium"
      : "text-muted-foreground cursor-default";

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold" data-testid="text-page-heading">
            Referrals
          </h1>
          <Button
            type="button"
            onClick={() => setAddReferralOpen(true)}
            data-testid="button-add-referral"
          >
            <Plus className="mr-2 h-4 w-4" /> Add Referral
          </Button>
        </div>
        <AddReferralDialog
          open={addReferralOpen}
          onOpenChange={setAddReferralOpen}
        />

        <Card>
          <CardHeader className="flex flex-row items-end justify-between gap-4 flex-wrap border-b px-6 py-4">
            <div className="flex items-end gap-3 flex-wrap flex-1">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider">Search Referrer</Label>
                <div className="relative w-[300px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    onBlur={() => {
                      if (searchInput.trim() !== searchValue) {
                        setSearchValue(searchInput.trim());
                        setCurrentPage(1);
                      }
                    }}
                    placeholder="Name, email, or referral code"
                    className="pl-8 h-9"
                    data-testid="input-search-referrer"
                  />
                </div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground" data-testid="text-total-referrers">
              {totalCount} {totalCount === 1 ? "referrer" : "referrers"}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="table-referrers">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="w-8 px-2 py-3"></th>
                    <SortHeader field="fullname" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Referrer
                    </SortHeader>
                    <SortHeader field="email" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Email
                    </SortHeader>
                    <SortHeader field="refcode" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Ref Code
                    </SortHeader>
                    <SortHeader field="totalreferred" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Total Referred
                    </SortHeader>
                    <SortHeader field="signups" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Signups
                    </SortHeader>
                    <SortHeader field="groupjoins" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Group Joins
                    </SortHeader>
                    <SortHeader field="investments" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Investments
                    </SortHeader>
                    <SortHeader field="raisemoneysignups" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Raise Money
                    </SortHeader>
                    <SortHeader field="lastreferredat" sortField={sortField} sortDir={sortDir} handleSort={handleSort}>
                      Most Recent
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading && error && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-destructive">
                        {(error as Error)?.message || "Failed to load referrals"}
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && items.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground" data-testid="text-empty-state">
                        No referrals yet.
                      </td>
                    </tr>
                  )}
                  {!isLoading && !error && items.map((r) => {
                    const isExpanded = expandedIds.has(r.referrerId);
                    const view = viewModes[r.referrerId] || "events";
                    const onCountClick = (e: React.MouseEvent, v: ViewMode, count: number) => {
                      e.stopPropagation();
                      if (count <= 0) return;
                      openWithView(r.referrerId, v);
                    };
                    return (
                      <Fragment key={r.referrerId}>
                        <tr
                          className="border-b last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
                          onClick={() => toggleExpanded(r.referrerId)}
                          data-testid={`row-referrer-${r.referrerId}`}
                        >
                          <td className="w-8 px-2 py-3 text-muted-foreground">
                            <button
                              type="button"
                              aria-label={isExpanded ? "Collapse" : "Expand"}
                              className="flex items-center justify-center w-6 h-6 rounded hover:bg-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(r.referrerId);
                              }}
                              data-testid={`button-expand-${r.referrerId}`}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/users?search=${encodeURIComponent(r.email || r.refCode || r.referrerId)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm text-primary hover:underline"
                              data-testid={`link-referrer-${r.referrerId}`}
                            >
                              {r.fullName || "—"}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground" data-testid={`text-referrer-email-${r.referrerId}`}>
                            {r.email || "—"}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono" data-testid={`text-referrer-refcode-${r.referrerId}`}>
                            {r.refCode || "—"}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold" data-testid={`text-referrer-total-${r.referrerId}`}>
                            {r.totalReferred}
                          </td>
                          <td
                            className={"px-4 py-3 text-sm " + countCellClass(r.signups)}
                            onClick={(e) => onCountClick(e, "signups", r.signups)}
                            data-testid={`text-referrer-signups-${r.referrerId}`}
                            title={r.signups > 0 ? "Show signups" : undefined}
                          >
                            {r.signups}
                          </td>
                          <td
                            className={"px-4 py-3 text-sm " + countCellClass(r.groupJoins)}
                            onClick={(e) => onCountClick(e, "groups", r.groupJoins)}
                            data-testid={`text-referrer-groupjoins-${r.referrerId}`}
                            title={r.groupJoins > 0 ? "Show groups joined" : undefined}
                          >
                            {r.groupJoins}
                          </td>
                          <td
                            className={"px-4 py-3 text-sm " + countCellClass(r.investments)}
                            onClick={(e) => onCountClick(e, "investments", r.investments)}
                            data-testid={`text-referrer-investments-${r.referrerId}`}
                            title={r.investments > 0 ? "Show investments" : undefined}
                          >
                            {r.investments}
                          </td>
                          <td
                            className={"px-4 py-3 text-sm " + countCellClass(r.raiseMoneySignups)}
                            onClick={(e) => onCountClick(e, "raisemoney", r.raiseMoneySignups)}
                            data-testid={`text-referrer-raisemoney-${r.referrerId}`}
                            title={r.raiseMoneySignups > 0 ? "Show raise-money signups" : undefined}
                          >
                            {r.raiseMoneySignups}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap" data-testid={`text-referrer-last-${r.referrerId}`}>
                            {r.lastReferredAt ? formatDate(r.lastReferredAt) : "—"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b last:border-b-0" data-testid={`row-referrer-expanded-${r.referrerId}`}>
                            <ReferrerEventsRow
                              referrerId={r.referrerId}
                              viewMode={view}
                              setViewMode={(v) => setViewMode(r.referrerId, v)}
                            />
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalCount > 0 && (
              <PaginationControls
                currentPage={currentPage}
                totalCount={totalCount}
                rowsPerPage={rowsPerPage}
                onPageChange={setCurrentPage}
                onRowsPerPageChange={(n) => {
                  setRowsPerPage(n);
                  setCurrentPage(1);
                }}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
