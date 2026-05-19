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
import { formatDate } from "../helpers/format";
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

function ReferrerEventsRow({ referrerId }: { referrerId: string }) {
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
  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <td colSpan={10} className="px-6 py-4 text-sm text-muted-foreground bg-muted/30">
        No referral events found.
      </td>
    );
  }
  return (
    <td colSpan={10} className="p-0 bg-muted/30">
      <div className="overflow-x-auto px-6 py-4">
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
      </div>
    </td>
  );
}

export default function ReferralsPage() {
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [searchInput, setSearchInput] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
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
                          <td className="px-4 py-3 text-sm" data-testid={`text-referrer-signups-${r.referrerId}`}>
                            {r.signups}
                          </td>
                          <td className="px-4 py-3 text-sm" data-testid={`text-referrer-groupjoins-${r.referrerId}`}>
                            {r.groupJoins}
                          </td>
                          <td className="px-4 py-3 text-sm" data-testid={`text-referrer-investments-${r.referrerId}`}>
                            {r.investments}
                          </td>
                          <td className="px-4 py-3 text-sm" data-testid={`text-referrer-raisemoney-${r.referrerId}`}>
                            {r.raiseMoneySignups}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap" data-testid={`text-referrer-last-${r.referrerId}`}>
                            {r.lastReferredAt ? formatDate(r.lastReferredAt) : "—"}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b last:border-b-0" data-testid={`row-referrer-expanded-${r.referrerId}`}>
                            <ReferrerEventsRow referrerId={r.referrerId} />
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
