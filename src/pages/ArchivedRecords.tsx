import { useState, useEffect, useRef } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import {
  Archive,
  History,
  Briefcase,
  UsersRound,
  CheckSquare,
  ArrowLeftRight,
  Mail,
  CalendarCheck,
  HelpCircle,
  ClipboardList,
  Newspaper,
  Clock,
  ThumbsUp,
  MessageSquareQuote,
  Users,
  RotateCcw
} from "lucide-react";
import { fetchArchivedRecordsSummary, ArchivedRecordsSummary } from "../api/archived-records/archivedRecordsApi";
import { useLocation } from "wouter";

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

export default function ArchivedRecords() {
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<ArchivedRecordsSummary | null>(null);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchArchivedRecordsSummary();
        setSummary(data);
      } catch (error) {
        console.error("Error fetching archived records summary:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const statConfigs = [
    { title: "Total Archived", key: "totalDeleted", icon: Archive, color: "#f06548", bg: "bg-[#f06548]/10" },
    { title: "Account Balance Logs", key: "accountBalanceLogs", icon: History, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Campaigns", key: "campaigns", icon: Briefcase, color: "#299cdb", bg: "bg-[#299cdb]/10" },
    { title: "Groups", key: "groups", icon: UsersRound, color: "#299cdb", bg: "bg-[#299cdb]/10" },
    { title: "Completed Investments", key: "completedInvestments", icon: CheckSquare, color: "#0ab39c", bg: "bg-[#0ab39c]/10" },
    { title: "Disbursal Requests", key: "disbursals", icon: ArrowLeftRight, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Email Templates", key: "emailTemplates", icon: Mail, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "FAQs", key: "faqs", icon: HelpCircle, color: "#f7b84b", bg: "bg-[#f7b84b]/10" },
    { title: "News Articles", key: "news", icon: Newspaper, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Pending Grants", key: "pendingGrants", icon: Clock, color: "#f7b84b", bg: "bg-[#f7b84b]/10" },
    { title: "Recommendations", key: "recommendations", icon: ThumbsUp, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Return Details", key: "returnDetails", icon: RotateCcw, color: "#f06548", bg: "bg-[#f06548]/10" },
    { title: "Users", key: "users", icon: Users, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Testimonials", key: "testimonials", icon: MessageSquareQuote, color: "#405189", bg: "bg-[#405189]/10" },
    { title: "Events", key: "events", icon: CalendarCheck, color: "#f7b84b", bg: "bg-[#f7b84b]/10" },
    { title: "Form Submissions", key: "formSubmissions", icon: ClipboardList, color: "#299cdb", bg: "bg-[#299cdb]/10" },
  ];

  return (
    <AdminLayout title="Archived Records">
      <div className="space-y-6">
        <div>
          <h4 className="text-base font-semibold">Archived Records</h4>
          <p className="text-sm text-muted-foreground">
            Summary of archived items across the platform
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground animate-pulse">Loading archived records summary...</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Hero Summary Card */}
            {statConfigs.length > 0 && (
              <Card className="overflow-hidden border-none shadow-lg bg-gradient-to-br from-[#405189] to-[#2b3a67] text-white">
                <CardContent className="p-0">
                  <div className="relative p-4 sm:p-5">
                    <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 text-white/90 text-[10px] font-bold uppercase tracking-wider">
                          System Overview
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                          <AnimatedCounter end={summary?.totalDeleted || 0} />
                        </h2>
                        <p className="text-base font-medium text-white/80">Total Archived Records</p>
                        <p className="text-xs text-white/60 max-w-md italic">
                          Comprehensive count of all records currently held in the system archive across all modules.
                        </p>
                      </div>
                      <div className="hidden md:flex h-14 w-14 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 shadow-inner">
                        <Archive className="h-7 w-7 text-white" />
                      </div>
                    </div>
                    {/* Abstract shapes for premium feel */}
                    <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Individual Module Grid */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <div className="w-1.5 h-6 bg-[#405189] rounded-full" />
                  Archived by Category
                </h3>
              </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {statConfigs.slice(1).map((config) => {
                const value = summary ? (summary as any)[config.key] : 0;
                
                return (
                  <Card key={config.title} className="transition-transform duration-200 bg-card hover:shadow-md">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">
                            {config.title}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-3 mt-3">
                        <div>
                          <h4 className="text-[22px] font-semibold leading-none mb-3">
                            <AnimatedCounter end={value} />
                          </h4>
                          {value > 0 ? (
                            <a
                              href="#"
                              className="text-xs text-muted-foreground underline decoration-dashed underline-offset-2 hover:text-foreground transition-colors"
                              onClick={(e) => {
                                e.preventDefault();
                                setLocation(`/archived-records/${config.key}`);
                              }}
                            >
                              View details
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground/40 italic">
                              No items found
                            </span>
                          )}
                        </div>
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${config.bg}`}>
                          <config.icon className="h-5 w-5" style={{ color: config.color }} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
