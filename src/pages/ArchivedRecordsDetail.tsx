import { useState, useEffect } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocation, useParams } from "wouter";
import { Search, ChevronLeft, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PaginationControls } from "@/components/ui/pagination-controls";
import { useDebounce } from "../hooks/useDebounce";

// Import all necessary APIs
import { fetchFaqs } from "../api/faq/faqApi";
import { fetchInvestments, fetchInvestmentRequests } from "../api/investment/investmentApi";
import { fetchAllAccountBalanceHistories } from "../api/account-history/accountHistoryApi";
import { fetchUsers } from "../api/user/userApi";
import { fetchGroups } from "../api/group/groupApi";
import { fetchNews } from "../api/news/newsApi";
import { fetchEmailTemplates } from "../api/email-template/emailTemplateApi";
import { fetchAdminEvents } from "../api/event/eventApi";
import { fetchTestimonials } from "../api/testimonial/testimonialApi";
import { fetchFormSubmissions } from "../api/form-submission/formSubmissionApi";
import { fetchCompletedInvestments } from "../api/completed-investment/completedInvestmentApi";
import { fetchDisbursalRequests } from "../api/disbursal-request/disbursalRequestApi";
import { fetchPendingGrants } from "../api/pending-grant/pendingGrantApi";
import { fetchRecommendations } from "../api/recommendation/recommendationApi";
import { fetchInvestmentReturns } from "../api/investment-return/investmentReturnApi";
import { restoreArchivedItem } from "../api/archived-records/archivedRecordsApi";

// Import Table Registry
import { MODULE_TABLE_REGISTRY } from "../components/archived-records/ModuleTableRegistry";
import { ConfirmationDialog } from "../components/ConfirmationDialog";

interface ModuleConfig {
  fetchFn: (params: any) => Promise<any>;
}

const MODULE_MAP: Record<string, ModuleConfig> = {
  faqs: { fetchFn: fetchFaqs },
  campaigns: { fetchFn: fetchInvestments },
  accountBalanceLogs: { fetchFn: fetchAllAccountBalanceHistories },
  users: { fetchFn: fetchUsers },
  groups: { fetchFn: fetchGroups },
  news: { fetchFn: fetchNews },
  emailTemplates: { fetchFn: fetchEmailTemplates },
  events: { fetchFn: fetchAdminEvents },
  testimonials: { fetchFn: fetchTestimonials },
  formSubmissions: { fetchFn: fetchFormSubmissions },
  completedInvestments: { fetchFn: fetchCompletedInvestments },
  disbursals: { fetchFn: fetchDisbursalRequests },
  pendingGrants: { fetchFn: fetchPendingGrants },
  recommendations: { fetchFn: fetchRecommendations },
  returnDetails: { fetchFn: fetchInvestmentReturns },
  assetRequests: { fetchFn: fetchInvestmentRequests },
};

export default function ArchivedRecordsDetail() {
  const { type } = useParams<{ type: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [searchValue, setSearchValue] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [itemToRestore, setItemToRestore] = useState<any>(null);

  const debouncedSearch = useDebounce(searchValue, 500);
  const effectiveSearch = debouncedSearch.length >= 3 || debouncedSearch.length === 0 ? debouncedSearch : "";

  useEffect(() => {
    const config = MODULE_MAP[type || ""];
    if (!config) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const params: any = {
          currentPage,
          perPage: rowsPerPage,
          searchValue: effectiveSearch.trim() || undefined,
          isDeleted: true,
        };

        const data = await config.fetchFn(params);
        setItems(data.items || []);
        setTotalCount(data.totalCount ?? data.totalRecords ?? 0);
      } catch (error) {
        console.error("Error loading archived items:", error);
        setItems([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [type, currentPage, rowsPerPage, effectiveSearch, toast]);

  const handleRestore = async () => {
    if (!type || !itemToRestore) return;
    const id = itemToRestore.id;
    setRestoring(id);
    setIsConfirmOpen(false);
    try {
      const res = await restoreArchivedItem(type, id);
      if (res.success) {
        toast({ title: "Success", description: res.message || "Item restored successfully" });
        setItems((prev) => prev.filter((item) => item.id !== id));
        setTotalCount((prev) => prev - 1);
      } else {
        toast({ title: "Error", description: res.message || "Failed to restore item", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to restore item", variant: "destructive" });
    } finally {
      setRestoring(null);
      setItemToRestore(null);
    }
  };

  const handleRestoreClick = (item: any) => {
    setItemToRestore(item);
    setIsConfirmOpen(true);
  };

  const MODULE_TITLES: Record<string, string> = {
    faqs: "FAQs",
    campaigns: "Campaigns",
    accountBalanceLogs: "Account Balance Logs",
    users: "Users",
    groups: "Groups",
    news: "News Articles",
    emailTemplates: "Email Templates",
    events: "Events",
    testimonials: "Testimonials",
    formSubmissions: "Form Submissions",
    completedInvestments: "Completed Investments",
    disbursals: "Disbursal Requests",
    pendingGrants: "Pending Grants",
    recommendations: "Recommendations",
    returnDetails: "Return Details",
    assetRequests: "Asset Requests",
  };

  const getTitle = (t: string | undefined) => {
    if (!t) return "";
    return MODULE_TITLES[t] || t.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
  };

  const tableConfig = MODULE_TABLE_REGISTRY[type || ""] || MODULE_TABLE_REGISTRY.default;

  return (
    <AdminLayout title={`Archived Records - ${getTitle(type)}`}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => setLocation("/archived-records")}
            >
                <ChevronLeft className="h-4 w-4" />
            </Button>
            <div>
              <h4 className="text-base font-semibold">Archived {getTitle(type)}</h4>
              <p className="text-sm text-muted-foreground">Detailed list of records in the system</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 px-6 py-4 border-b">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Search archived ${getTitle(type).toLowerCase()}...`}
                value={searchValue}
                onChange={(e) => {
                   setSearchValue(e.target.value);
                   setCurrentPage(1);
                }}
                className="pl-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 border-b">
                    {tableConfig.headers}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={tableConfig.colSpan} className="h-48 text-center border-b-0">
                        <div className="flex flex-col items-center justify-center gap-2">
                           <Loader2 className="h-8 w-8 animate-spin text-[#405189]" />
                           <span className="text-sm text-muted-foreground">Fetching records...</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={tableConfig.colSpan} className="h-32 text-center text-muted-foreground border-b-0">
                        No archived {getTitle(type).toLowerCase()} found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, idx) => tableConfig.renderRow(item, () => handleRestoreClick(item), restoring, idx))
                  )}
                </TableBody>
              </Table>
            </div>
            
            {!loading && totalCount > 0 && (
              <PaginationControls
                currentPage={currentPage}
                totalCount={totalCount}
                rowsPerPage={rowsPerPage}
                onPageChange={setCurrentPage}
                onRowsPerPageChange={(v: number) => {
                  setRowsPerPage(v);
                  setCurrentPage(1);
                }}
              />
            )}
          </CardContent>
        </Card>

        <ConfirmationDialog
          open={isConfirmOpen}
          onOpenChange={setIsConfirmOpen}
          title={`Restore ${getTitle(type)}`}
          description={ 
            <span>
              Are you sure you want to restore this item? 
              It will be moved back to the active records list.
            </span>
          }
          confirmLabel="Restore"
          confirmButtonClass="bg-[#0ab39c] hover:bg-[#0ab39c]/90 text-white"
          onConfirm={handleRestore}
          isSubmitting={restoring !== null}
        />
      </div>
    </AdminLayout>
  );
}
