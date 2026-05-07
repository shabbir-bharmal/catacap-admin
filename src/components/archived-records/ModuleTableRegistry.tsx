import React, { Fragment } from "react";
import { formatDate, formatLongDate, formatDateTime, formatTime12h as formatTime12hShared } from "@/helpers/format";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RotateCcw, Check, X, FileText, Download, GripVertical, ExternalLink } from "lucide-react";
import { currency_format } from "@/helpers/format";
import { getUrlBlobContainerImage } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
import catacapLogo from "@assets/CataCap-Logo.png";

const formatTime12h = formatTime12hShared;

const FORM_TYPE_LABELS: Record<string, string> = {
  "1": "Companies",
  "2": "Home",
  "3": "Champion Deal",
  "4": "About",
  "5": "Group"
};

const FORM_TYPE_COLORS: Record<string, string> = {
  "1": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "2": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "3": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  "4": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "5": "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300"
};

const STATUS_LABELS: Record<string, string> = {
  "1": "New",
  "2": "Contacted",
  "3": "In Progress",
  "4": "Completed",
  "5": "Archived"
};

interface ModuleTableConfig {
  headers: React.ReactNode;
  renderRow: (item: any, onRestore: (id: number) => void, restoringId: number | null, index?: number) => React.ReactNode;
  colSpan: number;
}

const RestoreButton = ({ id, onRestore, restoring }: { id: number; onRestore: (id: number) => void; restoring: boolean }) => (
  <Button
    variant="ghost"
    size="sm"
    className="text-[#0ab39c] hover:text-[#0ab39c] hover:bg-[#0ab39c]/10 h-8 font-medium transition-all"
    onClick={() => onRestore(id)}
    disabled={restoring}
  >
    <RotateCcw className={cn("h-3.5 w-3.5 mr-1.5", restoring ? "animate-spin" : "")} />
    Restore
  </Button>
);

const STAGE_ID_TO_NAME: Record<number, string> = {
  1: "Private",
  2: "Public",
  3: "Closed - Invested",
  4: "Closed - Not Invested",
  5: "New",
  6: "Compliance Review",
  7: "Completed - Ongoing",
  8: "Vetting",
  9: "Completed - Ongoing/Private",
  10: "CataCap Portfolio"
};

function getStageName(val: any) {
  if (typeof val === "number" && STAGE_ID_TO_NAME[val]) return STAGE_ID_TO_NAME[val];
  return "-";
}

export const MODULE_TABLE_REGISTRY: Record<string, ModuleTableConfig> = {
  // --- INVESTMENTS (Campaigns) ---
  campaigns: {
    colSpan: 9,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Image</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          <div>Stage</div>
          <div>Funding Close</div>
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">CataCap Funding</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Total Investors</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Date Created</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Is Active</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Actions</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const fundDate = item.fundraisingCloseDate;
      const displayDate = fundDate && fundDate !== "0001-01-01T00:00:00" && fundDate !== "N/A"
        ? formatDate(fundDate)
        : "N/A";

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <div className="h-12 w-16 flex items-center justify-center border rounded bg-white overflow-hidden shadow-sm">
              <img src={getUrlBlobContainerImage(item.imageFileName)} alt={item.name} className="max-h-12 max-w-16 object-contain" />
            </div>
          </td>
          <td className="px-4 py-3 text-sm font-medium">{item.name || "N/A"}</td>
          <td className="px-4 py-3">
            <div className="text-sm">
              <div className="font-medium text-[#405189]">{getStageName(item.stage)}</div>
              <div className="text-[11px] text-muted-foreground">{displayDate}</div>
            </div>
          </td>
          <td className="px-4 py-3 text-sm font-semibold">{currency_format(item.currentBalance || 0)}</td>
          <td className="px-4 py-3 text-sm text-center">{item.numberOfInvestors || 0}</td>
          <td className="px-4 py-3 text-sm">{formatDate(item.createdDate)}</td>
          <td className="px-4 py-3 text-center">
            <div className="flex items-center justify-center">
              {item.isActive ? (
                <div className="h-4 w-4 rounded bg-[#405189] flex items-center justify-center border border-[#405189]">
                  <Check className="h-3 w-3 text-white stroke-[3px]" />
                </div>
              ) : (
                <div className="h-4 w-4 rounded bg-rose-50 border border-rose-200" />
              )}
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- ACCOUNT HISTORY ---
  accountBalanceLogs: {
    colSpan: 11,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Change Date</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Gross Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fees</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Net Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Old Value</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">New Value</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
        const lower = (item.paymentType || "").toLowerCase();
        let badgeClass = "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
        if (lower.includes("revert") || lower.includes("rollback")) {
            badgeClass = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
        } else if (lower.includes("return") || lower.includes("credit")) {
            badgeClass = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
        } else if (lower.includes("balance update")) {
            badgeClass = "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300";
        }

        return (
          <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
            <td className="px-4 py-3 text-sm font-medium">{item.userName}</td>
            <td className="px-4 py-3 text-sm">{formatDate(item.changeDate)}</td>
            <td className="px-4 py-3 text-sm">{item.investmentName || "-"}</td>
            <td className="px-4 py-3">
              {item.paymentType ? (
                <Badge className={cn("border-0 whitespace-nowrap", badgeClass)}>{item.paymentType}</Badge>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
            <td className="px-4 py-3 text-sm">{currency_format(item.grossAmount, false, 2, "-")}</td>
            <td className="px-4 py-3 text-sm">{currency_format(item.fees, false, 2, "-")}</td>
            <td className="px-4 py-3 text-sm">{currency_format(item.netAmount, false, 2, "-")}</td>
            <td className="px-4 py-3 text-sm">{currency_format(item.oldValue, false, 2)}</td>
            <td className="px-4 py-3 text-sm">{currency_format(item.newValue, false, 2)}</td>
            <td className="px-4 py-3">
              <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
              <div className="text-[11px] text-muted-foreground">
                {formatDate(item.deletedAt)}
              </div>
            </td>
            <td className="px-4 py-3 text-right">
              <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
            </td>
          </tr>
        );
    },
  },

  // --- USERS ---
  users: {
    colSpan: 7,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Full Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Username
          <br />
          Email
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recommendations</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account Balance</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Created</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 text-sm font-medium">{item.fullName}</td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.userName}</div>
          <div className="text-xs text-muted-foreground">{item.email}</div>
        </td>
        <td className="px-4 py-3 text-sm">{item.recommendationsCount ?? 0}</td>
        <td className="px-4 py-3 text-sm font-semibold">${(item.accountBalance || 0).toFixed(2)}</td>
        <td className="px-4 py-3 text-sm">{formatDate(item.dateCreated)}</td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },

  // --- GROUPS ---
  groups: {
    colSpan: 10,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Group Leader(s)</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Member Count</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment Count</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Active</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Corporate Group</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Featured Group</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 text-sm font-medium">{item.groupName || item.name || item.identifier}</td>
        <td className="px-4 py-3 text-sm">{item.leader || (item.groupLeaders?.length > 0 ? item.groupLeaders.join(", ") : "—")}</td>
        <td className="px-4 py-3 text-sm text-center">{item.memberCount ?? item.member ?? 0}</td>
        <td className="px-4 py-3 text-sm text-center">{item.investmentCount ?? item.investment ?? 0}</td>
        <td className="px-4 py-3 text-center">
          <Badge
            className={cn(
              "border-0 no-default-hover-elevate no-default-active-elevate",
              (item.status === "Private" || item.isPrivateGroup)
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            )}
          >
            {item.status || (item.isPrivateGroup ? "Private" : "Public")}
          </Badge>
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center">
            {(!item.isDeactivated || item.active) ? <Check className="h-4 w-4 text-emerald-600" /> : <X className="h-4 w-4 text-rose-600" />}
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center">
            <Checkbox
              checked={!!item.corporateGroup || !!item.isCorporateGroup}
              disabled
              className="data-[state=checked]:bg-[#405189] data-[state=checked]:border-[#405189]"
            />
          </div>
        </td>
        <td className="px-4 py-3 text-center">
          <div className="flex items-center justify-center">
            <Checkbox
              checked={!!item.featuredGroup}
              disabled
              className="data-[state=checked]:bg-[#405189] data-[state=checked]:border-[#405189]"
            />
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },

  // --- FAQS ---
  faqs: {
    colSpan: 6,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-12"></th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Question</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap w-[1%]">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const CATEGORY_LABELS: Record<string, string> = {
        donors: "Donors/Investors",
        groups: "Group Leaders",
        investments: "Investments",
        "1": "Donors/Investors",
        "2": "Group Leaders",
        "3": "Investments"
      };

      const status = item.status === "Active" || item.status === true ? "Active" : "Draft";
      const catKey = String(item.category || "").toLowerCase();
      const catLabel = CATEGORY_LABELS[catKey] || item.category || "—";

      return (
        <tr key={item.id} className="border-b last:border-b-0 bg-background hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
             <div className="flex items-center justify-center p-1 opacity-20">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
             </div>
          </td>
          <td className="px-4 py-3">
            <div className="max-w-md">
              <div className="font-medium text-sm truncate">{item.question}</div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {(item.answer || "").replace(/<[^>]*>/g, "").substring(0, 80)}...
              </div>
            </div>
          </td>
          <td className="px-4 py-3">
            <Badge variant="outline" className="border-0 bg-muted text-muted-foreground">
              {catLabel}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <Badge
              className={`border-0 ${status === "Active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
            >
              {status}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- NEWS ---
  news: {
    colSpan: 8,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Title</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Audience</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Theme</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Date</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap w-[1%]">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const mediumBadgeColor = (medium: string) => {
        switch ((medium || "").toLowerCase()) {
          case "news article": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
          case "press release": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
          case "youtube": return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
          case "linkedin live": return "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300";
          case "video": return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
          case "podcast": return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
          case "case study": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
          default: return "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300";
        }
      };

      const status = item.status === "Published" || item.status === true ? "Published" : "Draft";
      const statusClass = status === "Published" 
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";

      return (
        <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
               <div className="h-10 w-14 flex items-center justify-center shrink-0 border rounded overflow-hidden bg-white">
                  <img src={getUrlBlobContainerImage(item.imageFileName)} alt={item.title} className="max-h-10 max-w-14 object-contain" />
               </div>
               <span className="font-medium text-sm line-clamp-2 max-w-xs">{item.title}</span>
            </div>
          </td>
          <td className="px-4 py-3">
            <Badge className={cn("border-0", mediumBadgeColor(item.medium || item.type))}>
              {item.medium || item.type || "—"}
            </Badge>
          </td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.audience || "—"}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.theme || "—"}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
            {formatLongDate(item.newsDate)}
          </td>
          <td className="px-4 py-3">
            <Badge className={cn("border-0", statusClass)}>{status}</Badge>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- EMAIL TEMPLATES ---
  emailTemplates: {
    colSpan: 7,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Subject</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Receiver</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trigger</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap w-[1%]">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap w-[1%]">Actions</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const statusName = item.statusName || (item.status === 2 ? "Active" : item.status === 1 ? "Draft" : "Inactive");
      let badgeClass = "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"; // Default/Inactive
      if (statusName === "Active") badgeClass = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
      if (statusName === "Draft") badgeClass = "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";

      return (
        <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
          <td className="px-4 py-3 font-medium text-sm max-w-[160px] truncate">{item.name}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground break-words min-w-[200px] max-w-[260px]">{item.subject || "—"}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground max-w-[160px] truncate">{item.receiver || "—"}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground break-words max-w-[160px]">{item.triggerAction || item.trigger || "Manually"}</td>
          <td className="px-4 py-3 text-right whitespace-nowrap w-[1%]">
            <Badge className={cn("border-0", badgeClass)}>{statusName}</Badge>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right whitespace-nowrap w-[1%]">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- EVENTS ---
  events: {
    colSpan: 9,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Event Title</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Time</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Registration</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Duration</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 font-medium text-[#405189]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-14 flex items-center justify-center shrink-0 border rounded bg-white overflow-hidden shadow-sm">
              <img
                src={getUrlBlobContainerImage(item.image) || catacapLogo}
                alt={item.title}
                className="max-h-10 max-w-14 object-contain rounded"
                onError={(e) => { (e.target as HTMLImageElement).src = catacapLogo; }}
              />
            </div>
            <span className="font-medium text-sm line-clamp-1">{item.title}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {formatLongDate(item.eventDate)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {(() => {
            if (!item.eventTime) return "—";
            const parts = item.eventTime.split(" ");
            const time = formatTime12h(parts[0]);
            const tz = parts[1] || "";
            return `${time} ${tz}`.trim();
          })()}
        </td>
        <td className="px-4 py-3">
          {item.registrationLink ? (
            <a
              href={item.registrationLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#405189] hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Link
            </a>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] px-2 py-0 h-4 border-0",
              item.status ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            )}
          >
            {item.status ? "Active" : "Draft"}
          </Badge>
        </td>
        <td className="px-4 py-3 text-muted-foreground text-xs">{item.type || "—"}</td>
        <td className="px-4 py-3 text-muted-foreground text-xs">{item.duration || "—"}</td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },

  // --- SUCCESS STORIES ---
  testimonials: {
    colSpan: 9,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-16">Photo</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Person</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perspective</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quote</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stats</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const perspective = item.perspectiveText?.toUpperCase().includes("INVESTMENT") ? "Investment" : "Donor Investor";
      const stats = item.metrics || [];
      const personImage = getUrlBlobContainerImage(item.profilePicture || item.personImage);

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={personImage} alt={item.userFullName || item.personName} />
              <AvatarFallback>
                {(item.userFullName || item.personName || "?")[0]}
              </AvatarFallback>
            </Avatar>
          </td>
          <td className="px-4 py-3">
            <div className="font-medium">{item.userFullName || item.personName}</div>
            <div className="text-xs text-muted-foreground">{item.role || item.personTitle}</div>
            <div className="text-xs text-muted-foreground">{item.organizationName || item.personOrg}</div>
          </td>
          <td className="px-4 py-3">
            <Badge variant={item.perspectiveText?.toUpperCase().includes("INVESTMENT") ? "default" : "secondary"}>
              {perspective}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <div className="max-w-xs truncate text-muted-foreground" title={item.description || item.quote}>
              {item.description || item.quote}
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="flex gap-3">
              {stats.map((stat: any, idx: number) => (
                <div key={idx} className="text-center">
                  <div className="text-xs font-semibold">{stat.value || stat.Value}</div>
                  <div className="text-[10px] text-muted-foreground">{stat.key || stat.label || stat.Label}</div>
                </div>
              ))}
            </div>
          </td>
          <td className="px-4 py-3">
            <Badge
              className={`no-default-hover-elevate no-default-active-elevate border-0 ${item.status ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}
            >
              {item.status ? "Active" : "Draft"}
            </Badge>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- FORM SUBMISSIONS ---
  // --- FORM SUBMISSIONS ---
  formSubmissions: {
    colSpan: 7,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Form Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Submitted</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const typeLabel = FORM_TYPE_LABELS[String(item.formType)] ?? `Form ${item.formType}`;
      const typeColor = FORM_TYPE_COLORS[String(item.formType)] ?? "bg-muted text-muted-foreground";
      const statusLabel = STATUS_LABELS[String(item.status)] || (item.status ? "Processed" : "New");

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", typeColor)}>
              {typeLabel}
            </span>
          </td>
          <td className="px-4 py-3 font-medium text-foreground">
            {item.firstName || item.userName} {item.lastName || ""}
          </td>
          <td className="px-4 py-3 text-muted-foreground text-sm">{item.email}</td>
          <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
            {formatDateTime(item.createdAt || item.submissionDate)}
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 uppercase font-medium">
                {statusLabel}
              </Badge>
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- DISBURSALS (Disbursal Requests) ---
  disbursals: {
    colSpan: 10,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Email</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Disbursement Date</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment Instruments</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Pitch Deck</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Investment Terms</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap min-w-[200px]">Actions</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const isCompleted = item.status === 2 || item.status === "Completed";
      const statusLabel = isCompleted ? "Completed" : "Pending";
      const badgeClass = isCompleted ? "bg-[#0ab39c]/10 text-[#0ab39c]" : "bg-[#f7b84b]/10 text-[#f7b84b]";

      return (
        <tr key={item.id} className="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <span className="text-sm font-medium text-[#405189] underline">{item.name || item.investmentName}</span>
          </td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.email}</td>
          <td className="px-4 py-3 text-sm">{formatDate(item.receiveDate)}</td>
          <td className="px-4 py-3 text-sm">{currency_format(item.distributedAmount || item.requestAmount)}</td>
          <td className="px-4 py-3 text-sm">
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", badgeClass)}>
              {statusLabel}
            </span>
          </td>
          <td className="px-4 py-3 text-sm text-muted-foreground max-w-[300px] block truncate">{item.investmentType || "—"}</td>
          <td className="px-4 py-3 text-center">
            {item.pitchDeck && (
                <div className="flex justify-center text-[#0ab39c]">
                    <Download className="h-4 w-4" />
                </div>
            )}
          </td>
          <td className="px-4 py-3 text-center">
            {item.investmentDocument && (
                <div className="flex justify-center text-[#0ab39c]">
                    <Download className="h-4 w-4" />
                </div>
            )}
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- PENDING GRANTS ---
  pendingGrants: {
    colSpan: 10,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Full Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Email</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          Original amount
          <br />
          Amount after fees
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          DAF Provider
          <br />
          DAF Name
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
          Investment Name
          <br />
          Grant Source
        </th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Day Count</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Date Created</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const status = item.status || "Pending";
      let badgeClass = "bg-amber-100 text-amber-700";
      if (status === "Received") badgeClass = "bg-emerald-100 text-emerald-700";
      if (status === "In Transit") badgeClass = "bg-[#2185d0]/10 text-[#2185d0]";
      if (status === "Rejected") badgeClass = "bg-rose-100 text-rose-700";

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3 text-sm font-medium">{item.fullName}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.email}</td>
          <td className="px-4 py-3">
            <div>
              <div className="text-sm font-medium">{currency_format(Number(item.amount || 0))}</div>
              <div className="text-xs text-muted-foreground">{currency_format(item.amountAfterFees || 0)}</div>
            </div>
          </td>
          <td className="px-4 py-3">
            <div>
              <div className="text-sm">{item.dafProvider || "-"}</div>
              <div className="text-xs text-muted-foreground">{item.dafName || "-"}</div>
            </div>
          </td>
          <td className="px-4 py-3">
            <div>
              <div className="text-sm">{item.investmentName || "-"}</div>
              <div className="text-xs text-muted-foreground">{item.grantSource || item.reference || "-"}</div>
            </div>
          </td>
          <td className="px-4 py-3">
            <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", badgeClass)}>
              {status}
            </span>
          </td>
          <td className="px-4 py-3 text-sm">{item.daysCount}</td>
          <td className="px-4 py-3 text-sm">{formatDate(item.createdDate, "-")}</td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- ASSET REQUESTS (Other Assets) ---
  assetRequests: {
    colSpan: 9,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name / Email</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Asset Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Created</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const status = item.status || "Pending";
      let badgeClass = "bg-amber-100 text-amber-700";
      if (status === "Received") badgeClass = "bg-emerald-100 text-emerald-700";
      if (status === "In Transit") badgeClass = "bg-indigo-100 text-indigo-700";
      if (status === "Rejected") badgeClass = "bg-rose-100 text-rose-700";

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.name}</div>
            <div className="text-xs text-muted-foreground">{item.email}</div>
          </td>
          <td className="px-4 py-3 text-sm">{item.investmentName || "—"}</td>
          <td className="px-4 py-3 text-sm">{item.assetType}</td>
          <td className="px-4 py-3 text-sm">{currency_format(item.approximateAmount)}</td>
          <td className="px-4 py-3 text-sm capitalize">{item.contactMethod}</td>
          <td className="px-4 py-3 text-sm">
            <Badge className={cn("border-0", badgeClass)}>{status}</Badge>
          </td>
          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(item.createdAt)}</td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- COMPLETED INVESTMENTS ---
  completedInvestments: {
    colSpan: 12,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Invested</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">CataCap Investment</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stage</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">CataCap Fund</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment Detail</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vehicle</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Donors</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Themes</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 text-sm">
          {formatDate(item.dateOfLastInvestment)}
        </td>
        <td className="px-4 py-3 text-sm font-medium">{item.name || item.investmentName || item.investmentname}</td>
        <td className="px-4 py-3 text-sm">{item.stage || "—"}</td>
        <td className="px-4 py-3 text-sm">{item.cataCapFund || item.catacapFund || item.fund || "—"}</td>
        <td className="px-4 py-3 text-sm">
          <div className="max-w-[150px] truncate" title={item.investmentDetail}>{item.investmentDetail || "—"}</div>
        </td>
        <td className="px-4 py-3 text-sm text-right">
          {currency_format(item.totalInvestmentAmount)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          <div className="max-w-[120px] truncate" title={item.typeOfInvestment}>{item.typeOfInvestment || item.typeOfInvestmentName || item.type || "—"}</div>
        </td>
        <td className="px-4 py-3 text-sm">{item.balanceSheet || "—"}</td>
        <td className="px-4 py-3 text-sm">{item.donors || "—"}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          <div className="max-w-[120px] truncate" title={item.themes}>{item.themes || "—"}</div>
        </td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },

  // --- RECOMMENDATIONS ---
  recommendations: {
    colSpan: 9,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User Full Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User Email</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider text-right">Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Created</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => {
      const status = (item.status || "pending").toLowerCase();
      let badgeClass = "bg-amber-100 text-amber-700";
      if (status === "approved") badgeClass = "bg-emerald-100 text-emerald-700";
      if (status === "rejected") badgeClass = "bg-rose-100 text-rose-700";

      return (
        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.id}</td>
          <td className="px-4 py-3 text-sm font-medium">{item.userFullName}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{item.userEmail}</td>
          <td className="px-4 py-3 text-sm">{item.campaignName || item.investmentName}</td>
          <td className="px-4 py-3 text-sm text-right">{currency_format(item.amount)}</td>
          <td className="px-4 py-3 text-sm text-muted-foreground">{formatDate(item.dateCreated)}</td>
          <td className="px-4 py-3 text-sm">
            <Badge className={cn("border-0 capitalize", badgeClass)}>{status}</Badge>
          </td>
          <td className="px-4 py-3">
            <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatDate(item.deletedAt)}
            </div>
          </td>
          <td className="px-4 py-3 text-right">
            <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
          </td>
        </tr>
      );
    },
  },

  // --- RETURN DETAILS ---
  // --- RETURNS (Historical) ---
  returnDetails: {
    colSpan: 11,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Date Range</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Post Date</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">User Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Investment Amount</th>
        <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider">Percentage</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Returned Amount</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Memo / Status</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id || item.email} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 text-sm font-medium">{item.investmentName}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{item.privateDebtDates || item.dateRange || "—"}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{item.postDate || "—"}</td>
        <td className="px-4 py-3 text-sm">{item.userFullName || `${item.firstName} ${item.lastName}`}</td>
        <td className="px-4 py-3 text-sm text-muted-foreground">{item.email}</td>
        <td className="px-4 py-3 text-sm text-right">{currency_format(item.investmentAmount)}</td>
        <td className="px-4 py-3 text-sm text-center">{Number(item.percentage || 0).toFixed(2)}%</td>
        <td className="px-4 py-3 text-sm text-right">{currency_format(item.returnedAmount)}</td>
        <td className="px-4 py-3 text-sm">
          <div className="text-sm text-muted-foreground mb-1 line-clamp-1">{item.memo || "—"}</div>
          <Badge className="border-0 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
            {item.status || "Processed"}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },

  // DEFAULT / FALLBACK
  default: {
    colSpan: 5,
    headers: (
      <>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">ID</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Item Name</th>
        <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Deleted By / At</th>
        <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Action</th>
      </>
    ),
    renderRow: (item, onRestore, restoringId) => (
      <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
        <td className="px-4 py-3 text-sm font-medium">{item.id}</td>
        <td className="px-4 py-3 text-sm font-medium">{item.name || item.fullName || item.title || item.question || item.investmentName || "-"}</td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium">{item.deletedBy || "—"}</div>
          <div className="text-[11px] text-muted-foreground">
            {formatDate(item.deletedAt)}
          </div>
        </td>
        <td className="px-4 py-3 text-right">
          <RestoreButton id={item.id} onRestore={onRestore} restoring={restoringId === item.id} />
        </td>
      </tr>
    ),
  },
};
