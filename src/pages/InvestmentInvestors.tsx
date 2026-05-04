import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { exportInvestmentInvestors, fetchInvestmentInvestors, type InvestmentContributionStatus, type InvestmentInvestor, type InvestmentInvestorsResponse, type InvestmentMatchInfo, type InvestmentPaymentMethod } from "../api/investment/investmentApi";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Download } from "lucide-react";
import { currency_format } from "@/helpers/format";
import { useToast } from "@/hooks/use-toast";

const STATUS_LABEL: Record<InvestmentContributionStatus, string> = {
  "pending": "Pending",
  "in transit": "In Transit",
  "received": "Received",
};

const STATUS_BADGE_CLASS: Record<InvestmentContributionStatus, string> = {
  "pending": "bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200",
  "in transit": "bg-blue-100 text-blue-800 hover:bg-blue-100 border-blue-200",
  "received": "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-emerald-200",
};

const METHOD_LABEL: Record<InvestmentPaymentMethod, string> = {
  "wallet": "Wallet",
  "daf": "DAF",
  "foundation": "Foundation",
  "match": "Match Grant",
};

const METHOD_BADGE_CLASS: Record<InvestmentPaymentMethod, string> = {
  // Slate for direct funding (cash, CC, ACH, account balance).
  "wallet":     "bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200",
  // Sky-blue for donor-advised funds — the primary thing we want to surface.
  "daf":        "bg-sky-100 text-sky-800 hover:bg-sky-100 border-sky-300",
  // Indigo for foundation grants (close cousin of DAF, distinct color).
  "foundation": "bg-indigo-100 text-indigo-800 hover:bg-indigo-100 border-indigo-300",
  // Violet for match grants (matches the existing match-annotation color).
  "match":      "bg-violet-100 text-violet-800 hover:bg-violet-100 border-violet-200",
};

function PaymentMethodBadge({ investor, idx }: { investor: InvestmentInvestor; idx: number }) {
  const method = investor.paymentMethod || "wallet";
  const label = METHOD_LABEL[method] || "Wallet";
  const provider = (investor.dafProvider || "").trim();
  const name = (investor.dafName || "").trim();
  // Show provider inline for DAF/Foundation so admins can tell Fidelity from
  // Vanguard from a foundation grant at a glance. The fund name (often a
  // donor-specific identifier) goes in the tooltip to keep the row compact.
  const showProvider = method === "daf" || method === "foundation";
  const tooltip = showProvider
    ? [provider && `Provider: ${provider}`, name && `Fund: ${name}`].filter(Boolean).join(" · ") || undefined
    : method === "wallet"
      ? "Funded directly (cash, credit card, ACH, or account balance)"
      : method === "match"
        ? "Match-grant contribution"
        : undefined;
  return (
    <Badge
      variant="outline"
      className={METHOD_BADGE_CLASS[method] || METHOD_BADGE_CLASS.wallet}
      title={tooltip}
      data-testid={`badge-method-${idx}`}
    >
      <span className="font-medium">{label}</span>
      {showProvider && provider && (
        <span className="ml-1 font-normal opacity-80">· {provider}</span>
      )}
    </Badge>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function MatchAnnotation({ match, idx }: { match: InvestmentMatchInfo | null; idx: number }) {
  if (!match) return null;
  const badges: JSX.Element[] = [];

  if (match.asMatch) {
    const am = match.asMatch;
    const who = am.triggeredName || "another investor";
    const triggeredAmt = am.triggeredAmount;
    const isPending = am.pending === true;
    badges.push(
      <div
        key="as-donor"
        className={
          isPending
            ? "mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
            : "mt-1 inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-800"
        }
        data-testid={isPending ? `text-pending-match-as-donor-${idx}` : `text-match-as-donor-${idx}`}
        title={
          isPending
            ? `Projected match — will fire when ${who}'s pending investment lands. Funds remain in escrow until then.`
            : `This is a match contribution from "${am.grantName}"`
        }
      >
        <span className="font-medium">
          {isPending ? "⧗ Pending match for " : "↪ Match for "}
          {who}{triggeredAmt != null ? ` (${currency_format(triggeredAmt)})` : ""}
        </span>
        <span className={isPending ? "text-amber-700" : "text-violet-600"}>· {am.grantName}</span>
      </div>,
    );
  }

  if (match.triggeredMatches && match.triggeredMatches.length > 0) {
    const actual = match.triggeredMatches.filter(t => !t.pending);
    const pending = match.triggeredMatches.filter(t => t.pending);
    if (actual.length > 0) {
      const total = actual.reduce((s, t) => s + (t.matchAmount || 0), 0);
      const grantNames = Array.from(new Set(actual.map(t => t.grantName))).join(", ");
      badges.push(
        <div
          key="triggered"
          className="mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800"
          data-testid={`text-match-triggered-${idx}`}
          title={actual.map(t => `+${currency_format(t.matchAmount)} from "${t.grantName}"`).join("\n")}
        >
          <span className="font-medium">+ {currency_format(total)} matched</span>
          <span className="text-emerald-700">· {grantNames}</span>
        </div>,
      );
    }
    if (pending.length > 0) {
      const total = pending.reduce((s, t) => s + (t.matchAmount || 0), 0);
      const grantNames = Array.from(new Set(pending.map(t => t.grantName))).join(", ");
      badges.push(
        <div
          key="triggered-pending"
          className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
          data-testid={`text-match-triggered-pending-${idx}`}
          title={
            "Projected matches that will fire when this pending investment lands:\n" +
            pending.map(t => `+${currency_format(t.matchAmount)} from "${t.grantName}"`).join("\n")
          }
        >
          <span className="font-medium">⧗ + {currency_format(total)} pending match</span>
          <span className="text-amber-700">· {grantNames}</span>
        </div>,
      );
    }
  }

  if (badges.length === 0) return null;
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

export default function InvestmentInvestors() {
  const [, params] = useRoute("/investments/:id/investors");
  const [, setLocation] = useLocation();
  const investmentId = params ? parseInt(params.id, 10) : NaN;

  const [data, setData] = useState<InvestmentInvestorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const handleExport = async () => {
    if (!data || data.items.length === 0) return;
    setExporting(true);
    try {
      await exportInvestmentInvestors(investmentId, data.campaignName || `investment_${investmentId}`);
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err?.message || "Could not export investors.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (Number.isNaN(investmentId)) {
      setError("Invalid investment id");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchInvestmentInvestors(investmentId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err?.message || "Failed to load investors"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [investmentId]);

  const totalAmount = data?.totalAmount || 0;
  const items = data?.items || [];

  return (
    <AdminLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/investments")}
            data-testid="button-back-to-investments"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Investments
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-semibold" data-testid="text-investment-name">
                  {loading ? "Loading…" : data?.campaignName || `Investment #${investmentId}`}
                </h1>
                {data && (
                  <p className="text-sm text-muted-foreground" data-testid="text-investors-summary">
                    {data.totalInvestors.toLocaleString()} {data.totalInvestors === 1 ? "investor" : "investors"}
                    {" · "}
                    {data.totalContributions.toLocaleString()} {data.totalContributions === 1 ? "contribution" : "contributions"}
                    {" · "}
                    Total raised: <span className="font-medium">{currency_format(totalAmount)}</span>
                    {data.pendingMatchAmount != null && data.pendingMatchAmount > 0 && (
                      <>
                        {" · "}
                        <span className="text-amber-700 dark:text-amber-400" data-testid="text-pending-match-summary">
                          includes <span className="font-medium">{currency_format(data.pendingMatchAmount)}</span> pending matches
                        </span>
                      </>
                    )}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={loading || exporting || !data || data.items.length === 0}
                data-testid="button-export-investors"
              >
                <Download className="h-4 w-4 mr-1" />
                {exporting ? "Exporting…" : "Export"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="py-12 text-center text-sm text-muted-foreground">Loading investors…</div>
            ) : error ? (
              <div className="py-12 text-center text-sm text-destructive" data-testid="text-error">{error}</div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                No investors found for this investment.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-investors-detail">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-12">#</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Email</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Method</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount Invested</th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const pct = totalAmount > 0 ? (it.totalAmount / totalAmount) * 100 : 0;
                      const rowKey = `${it.sourceType}-${it.sourceId}`;
                      const isProjected = it.sourceType === "projected_match";
                      return (
                        <tr
                          key={rowKey}
                          className={
                            isProjected
                              ? "border-b last:border-b-0 bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-950/20"
                              : "border-b last:border-b-0 hover:bg-muted/20"
                          }
                          data-testid={`row-investor-${idx}`}
                        >
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium align-top" data-testid={`text-investor-name-${idx}`}>
                            <div>{it.name}</div>
                            <MatchAnnotation match={it.match} idx={idx} />
                          </td>
                          <td className="px-3 py-2 text-muted-foreground" data-testid={`text-investor-email-${idx}`}>
                            {it.email ? (
                              <a
                                href={`mailto:${it.email}`}
                                className="hover:underline text-[#405189]"
                              >
                                {it.email}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2" data-testid={`text-investor-method-${idx}`}>
                            <PaymentMethodBadge investor={it} idx={idx} />
                          </td>
                          <td className="px-3 py-2" data-testid={`text-investor-status-${idx}`}>
                            <Badge variant="outline" className={STATUS_BADGE_CLASS[it.status]}>
                              {STATUS_LABEL[it.status]}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground tabular-nums" data-testid={`text-investor-date-${idx}`}>
                            {formatDate(it.date)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investor-amount-${idx}`}>
                            {currency_format(it.totalAmount)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums" data-testid={`text-investor-pct-${idx}`}>
                            {pct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 font-medium bg-muted/30">
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2" colSpan={5}>Total</td>
                      <td className="px-3 py-2 text-right tabular-nums" data-testid="text-investors-total-amount">
                        {currency_format(totalAmount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">100.00%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
