import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import ScrollToTop from "@/components/ScrollToTop";
import AdminDashboard from "@/pages/Dashboard";
import AdminRaiseMoney from "@/pages/RaiseMoney";
import AdminUsers from "@/pages/Users";
import AdminGroups from "@/pages/Groups";
import GroupReports from "@/pages/GroupReports";
import EventManagement from "@/pages/EventManagement";
import EventRegistrationsList from "@/pages/EventRegistrationsList";
import AdminInvestments from "@/pages/Investments";
import InvestmentInvestors from "@/pages/InvestmentInvestors";
import AdminRecommendations from "@/pages/Recommendations";
import AdminAccountHistory from "@/pages/AccountHistory";
import AdminOtherAssets from "./pages/OtherAssets";
import AdminPendingGrants from "./pages/PendingGrants";
import AdminDisbursalRequest from "./pages/DisbursalRequest";
import AdminDisbursalRequestDetail from "./pages/DisbursalRequestDetail";
import AdminConsolidatedFinances from "./pages/ConsolidatedFinances";
import FinanceKPIs from "./pages/FinanceKPIs";
import AdminCompletedInvestments from "./pages/CompletedInvestments";
import AdminReturns from "./pages/Returns";
import SiteConfiguration from "./pages/SiteConfiguration";
import AdminGroupEdit from "./pages/AdminGroupEdit";
import NewsManagementPage from "./pages/NewsManagement";
import FAQManagement from "./pages/FAQManagement";
import EmailTemplateManagement from "./pages/EmailTemplateManagement";
import SuccessStoriesManagement from "./pages/SuccessStoriesManagement";
import AdminNotFound from "./pages/AdminNotFound";
import AdminLogin from "./pages/AdminLogin";
import AdminUserProfile from "./pages/AdminUserProfile";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import TeamManagementPage from "./pages/TeamManagement";
import AdminInvestmentEdit from "./pages/AdminInvestmentEdit";
import Roles from "./pages/Roles";
import AdminAdminUsers from "./pages/AdminUsers";
import FormSubmissions from "./pages/FormSubmissions";
import ArchivedRecords from "./pages/ArchivedRecords";
import ArchivedRecordsDetail from "./pages/ArchivedRecordsDetail";
import Schedulers from "./pages/Schedulers";
import Analytics from "./pages/Analytics";
import AdminMatching from "./pages/AdminMatching";
import SchemaChangeLogs from "./pages/SchemaChangeLogs";


function Router() {
  return (
    <>
      <ScrollToTop />
      <Switch>
        <Route path="/" component={() => <Redirect to="/login" />} />
        <Route path="/admin" component={() => <Redirect to="/dashboard" />} />
        <Route path="/login" component={AdminLogin} />
        <ProtectedRoute path="/dashboard" component={AdminDashboard} />
        <ProtectedRoute path="/raisemoney" component={AdminRaiseMoney} moduleName="all-investments" />
        <ProtectedRoute path="/raisemoney/edit/:idOrSlug" component={AdminInvestmentEdit} moduleName="all-investments" />
        <ProtectedRoute path="/users" component={AdminUsers} moduleName="user" />
        <ProtectedRoute path="/admin-users" component={AdminAdminUsers} moduleName="user" requiresSuperAdmin={true} />
        <ProtectedRoute path="/form-submissions" component={FormSubmissions} moduleName="form-submissions" />
        {/* <ProtectedRoute path="/soft-circle-investments" component={SoftCircleInvestments} moduleName="soft-circle-investments" /> */}
        <ProtectedRoute path="/groups" component={AdminGroups} moduleName="group" />
        <ProtectedRoute path="/groups/reports" component={GroupReports} moduleName="group" />
        <ProtectedRoute path="/groups/:identifier/edit" component={AdminGroupEdit} moduleName="group" />
        <ProtectedRoute path="/event-management" component={EventManagement} moduleName="event registrations" />
        <ProtectedRoute path="/event-registrations" component={EventRegistrationsList} moduleName="event registrations" />
        <Route path="/event-registrations-list" component={() => <Redirect to="/event-registrations" />} />
        <ProtectedRoute path="/investments" component={AdminInvestments} moduleName="all-investments" />
        <ProtectedRoute path="/investments/:id/investors" component={InvestmentInvestors} moduleName="all-investments" />
        <ProtectedRoute path="/recommendations" component={AdminRecommendations} moduleName="recommendation" />
        <ProtectedRoute path="/account-history" component={AdminAccountHistory} moduleName="account history" />
        <ProtectedRoute path="/other-assets" component={AdminOtherAssets} moduleName="other assets" />
        <ProtectedRoute path="/pending-grants" component={AdminPendingGrants} moduleName="pending grants" />
        <ProtectedRoute path="/disbursal-request" component={AdminDisbursalRequest} moduleName="disbursal request" />
        <ProtectedRoute path="/disbursal-request-detail/:id" component={AdminDisbursalRequestDetail} moduleName="disbursal request" />
        <ProtectedRoute path="/consolidated-finances" component={AdminConsolidatedFinances} moduleName="consolidated finances" />
        <ProtectedRoute path="/kpis" component={FinanceKPIs} moduleName="consolidated finances" />
        <ProtectedRoute path="/completed-investments" component={AdminCompletedInvestments} moduleName="completed investments" />
        <ProtectedRoute path="/returns" component={AdminReturns} moduleName="return" />
        <ProtectedRoute path="/site-configuration" component={SiteConfiguration} moduleName="site configuration" />
        <ProtectedRoute path="/team" component={TeamManagementPage} moduleName="team management" />
        <ProtectedRoute path="/roles" component={Roles} moduleName="roles and permissions" />
        <ProtectedRoute path="/news" component={NewsManagementPage} moduleName="content management" />
        <ProtectedRoute path="/faqs" component={FAQManagement} moduleName="content management" />
        <ProtectedRoute path="/email-templates" component={EmailTemplateManagement} moduleName="content management" />
        <ProtectedRoute path="/success-stories" component={SuccessStoriesManagement} moduleName="content management" />
        <ProtectedRoute path="/schedulers" component={Schedulers} moduleName="site configuration" />
        <ProtectedRoute path="/analytics" component={Analytics} moduleName="site configuration" />
        <ProtectedRoute path="/archived-records" component={ArchivedRecords} moduleName="site configuration" />
        <ProtectedRoute path="/archived-records/:type" component={ArchivedRecordsDetail} moduleName="site configuration" />
        <ProtectedRoute path="/db-schema-logs" component={SchemaChangeLogs} moduleName="db schema logs" />
        <ProtectedRoute path="/matching" component={AdminMatching} moduleName="recommendation" />

        <ProtectedRoute path="/profile" component={AdminUserProfile} />
        <ProtectedRoute component={AdminNotFound} />
      </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
