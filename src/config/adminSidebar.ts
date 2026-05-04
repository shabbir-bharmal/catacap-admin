import {
  LayoutDashboard,
  Briefcase,
  FilePlus,
  List,
  ThumbsUp,
  Wallet,
  Clock,
  RotateCcw,
  UsersRound,
  DollarSign,
  CheckSquare,
  ArrowLeftRight,
  Users,
  History,
  Newspaper,
  HelpCircle,
  Mail,
  Award,
  UserCog,
  TrendingUp,
  CalendarCheck,
  Settings,
  Shield,
  ClipboardList,
  FileText,
  Archive,
  BarChart3,
  GitMerge
} from "lucide-react";

export const sidebarConfig = [
  {
    heading: "CATACAP CORE",
    items: [
      {
        title: "Investments",
        icon: Briefcase,
        children: [
          {
            title: "All Investments",
            url: "/investments",
            icon: List,
            activeFor: ["/raisemoney/edit"],
            permission: { module: "all-investments", action: "view" }
          },
          {
            title: "Create New Investment",
            url: "/raisemoney",
            icon: FilePlus,
            permission: { module: "all-investments", action: "view" },
          },
          {
            title: "Returns",
            url: "/returns",
            icon: RotateCcw,
            permission: { module: "returns", action: "view" }
          },
          {
            title: "Completed Investments",
            url: "/completed-investments",
            icon: CheckSquare,
            permission: { module: "completed-investments", action: "view" }
          },
          {
            title: "Disbursal Requests",
            url: "/disbursal-request",
            icon: ArrowLeftRight,
            activeFor: ["/disbursal-request-detail"],
            permission: { module: "disbursal-request", action: "view" }
          }
        ]
      },

      {
        title: "Donations to Invest",
        icon: Wallet,
        children: [
          {
            title: "Users",
            url: "/users",
            icon: Users,
            permission: { module: "users", action: "view" }
          },
          {
            title: "Recommendations",
            url: "/recommendations",
            icon: ThumbsUp,
            permission: { module: "recommendations", action: "view" }
          },
          {
            title: "Pending Grants",
            url: "/pending-grants",
            icon: Clock,
            permission: { module: "pending-grants", action: "view" }
          },
          {
            title: "Other Assets",
            url: "/other-assets",
            icon: Wallet,
            permission: { module: "other-assets", action: "view" }
          },
          {
            title: "Matching",
            url: "/matching",
            icon: GitMerge,
            permission: { module: "recommendations", action: "view" }
          }
        ]
      },

      {
        title: "Groups",
        url: "/groups",
        icon: UsersRound,
        activeFor: ["/groups"],
        permission: { module: "groups", action: "view" }
      },

      {
        title: "Finance",
        icon: DollarSign,
        children: [
          {
            title: "Account History",
            url: "/account-history",
            icon: History,
            permission: { module: "account-history", action: "view" }
          },
          {
            title: "Consolidated Finances",
            url: "/consolidated-finances",
            icon: DollarSign,
            permission: { module: "consolidated-finances", action: "view" }
          },
          {
            title: "KPIs",
            url: "/kpis",
            icon: TrendingUp,
            permission: { module: "consolidated-finances", action: "view" }
          }
        ]
      },

      {
        title: "Site Config",
        icon: Settings,
        children: [
          {
            title: "Email Templates",
            url: "/email-templates",
            icon: Mail,
            permission: { module: "site-configuration", action: "view" }
          },
          {
            title: "Site Configuration",
            url: "/site-configuration",
            icon: Settings,
            permission: { module: "site-configuration", action: "view" }
          },
          {
            title: "Form Submissions",
            url: "/form-submissions",
            icon: ClipboardList,
            permission: { module: "form-submissions", action: "view" }
          },
          {
            title: "Admin Users",
            url: "/admin-users",
            icon: Users,
            superAdminOnly: true,
            permission: { module: "users", action: "manage" }
          },
          {
            title: "Roles & Permissions",
            url: "/roles",
            icon: Shield,
            permission: { module: "site-configuration", action: "manage" }
          },
          {
            title: "Schedulers",
            url: "/schedulers",
            icon: Clock,
            permission: { module: "site-configuration", action: "view" }
          },
          {
            title: "Archived Records",
            url: "/archived-records",
            icon: Archive,
            permission: { module: "site-configuration", action: "view" }
          },
          {
            title: "DB Schema Logs",
            url: "/db-schema-logs",
            icon: GitMerge,
            permission: { module: "db-schema-logs", action: "view" }
          }
          // {
          //   title: "Analytics",
          //   url: "/analytics",
          //   icon: BarChart3,
          //   permission: { module: "site-configuration", action: "view" }
          // }
        ]
      }
    ]
  },

  {
    heading: "CATACAP FRONT END",
    items: [
      {
        title: "Dashboard",
        url: "/dashboard",
        icon: LayoutDashboard,
        permission: { module: "dashboard", action: "view" }
      },

      {
        title: "Content Management",
        icon: Newspaper,
        children: [
          {
            title: "FAQs",
            url: "/faqs",
            icon: HelpCircle,
            permission: { module: "content-management", action: "view" }
          },
          {
            title: "News",
            url: "/news",
            icon: Newspaper,
            permission: { module: "content-management", action: "view" }
          },
          {
            title: "Success Stories",
            url: "/success-stories",
            icon: Award,
            permission: { module: "content-management", action: "view" }
          },
          {
            title: "Team",
            url: "/team",
            icon: UserCog,
            permission: { module: "team-management", action: "view" }
          }
        ]
      },

      {
        title: "Events",
        icon: CalendarCheck,
        children: [
          {
            title: "Event Management",
            url: "/event-management",
            icon: CalendarCheck,
            permission: { module: "event-registrations", action: "view" }
          },
          {
            title: "Event Registrations",
            url: "/event-registrations",
            icon: CalendarCheck,
            permission: { module: "event-registrations", action: "view" }
          }
        ]
      }
    ]
  }
];
