import { useState, useEffect, useCallback, useRef } from "react";
import { formatDateTimeInZone } from "@/helpers/format";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Play, Save, ChevronDown, ChevronUp, Loader2, Clock, AlertCircle, CheckCircle2, Download, Activity } from "lucide-react";
import {
  fetchSchedulerConfigs,
  updateSchedulerConfig,
  triggerSchedulerJob,
  toggleSchedulerJob,
  fetchSchedulerLogs,
  fetchSentReminderEmails,
  fetchSentWelcomeEmails,
  fetchBackupDownloadUrl,
  fetchSchedulerStatuses,
  SchedulerConfig,
  SchedulerLog,
  SchedulerJobStatus,
  SentEmailEntry,
  SentWelcomeEmailEntry,
} from "@/api/scheduler/schedulerApi";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Eye } from "lucide-react";

const JOB_DISPLAY_NAMES: Record<string, string> = {
  SendReminderEmail: "Send Reminder Email",
  DeleteArchivedUsers: "Delete Archived Users",
  DeleteTestUsers: "Delete Test Users",
  WelcomeSeries: "Welcome Series",
  BackupDatabase: "Backup Database",
};

const JOB_DESCRIPTIONS: Record<string, string> = {
  DeleteTestUsers: "Soft-deletes test user accounts and all associated data (restorable from Archived Records)",
  WelcomeSeries: "Sends Day 1, Day 6, and Day 10 welcome emails to people who submitted the Learn More form",
  BackupDatabase: "Takes a full Postgres database dump (gzipped) and uploads it to a private Supabase Storage bucket under database-backups/<date>/. Backups older than 7 days are auto-deleted.",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "UTC",
];

interface EditState {
  hour: number;
  minuteDisplay: string;
  timezone: string;
}

export default function SchedulersTab() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<SchedulerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [savingJobs, setSavingJobs] = useState<Record<string, boolean>>({});
  const [triggeringJobs, setTriggeringJobs] = useState<Record<string, boolean>>({});
  const [togglingJobs, setTogglingJobs] = useState<Record<string, boolean>>({});
  const [triggerResults, setTriggerResults] = useState<
    Record<string, { variant: "success" | "error" | "info"; message: string }>
  >({});
  const [jobStatuses, setJobStatuses] = useState<Record<string, SchedulerJobStatus>>({});
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const [jobLogs, setJobLogs] = useState<Record<string, SchedulerLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<Record<string, boolean>>({});
  const [downloadingLogs, setDownloadingLogs] = useState<Record<number, boolean>>({});
  const [sentEmailsOpen, setSentEmailsOpen] = useState(false);
  const [sentEmails, setSentEmails] = useState<SentEmailEntry[]>([]);
  const [sentWelcomeEmails, setSentWelcomeEmails] = useState<SentWelcomeEmailEntry[]>([]);
  const [sentEmailsLoading, setSentEmailsLoading] = useState(false);
  const [sentEmailsContext, setSentEmailsContext] = useState<{
    startTime: string;
    endTime: string | null;
    timezone: string;
    jobName: string;
  } | null>(null);

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSchedulerConfigs();
      setConfigs(data);
      const edits: Record<string, EditState> = {};
      for (const c of data) {
        edits[c.jobName] = { hour: c.hour, minuteDisplay: String(c.minute).padStart(2, "0"), timezone: c.timezone };
      }
      setEditStates(edits);
    } catch {
      toast({ title: "Error", description: "Failed to load scheduler configurations.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const loadLogsRef = useRef<(jobName: string) => void>();
  const expandedLogsRef = useRef(expandedLogs);
  expandedLogsRef.current = expandedLogs;
  const isInitialStatusFetch = useRef(true);

  const pollStatuses = useCallback(async () => {
    let statuses: SchedulerJobStatus[];
    try {
      statuses = await fetchSchedulerStatuses();
    } catch {
      return;
    }
    const finishedNotifications: Array<{ jobName: string; lastRun: SchedulerLog }> = [];
    setJobStatuses((prev) => {
      const next: Record<string, SchedulerJobStatus> = { ...prev };
      for (const status of statuses) {
        const previous = prev[status.jobName];
        next[status.jobName] = status;
        if (
          !isInitialStatusFetch.current &&
          previous?.running &&
          !status.running &&
          status.lastRun &&
          (!previous.lastRun || status.lastRun.id !== previous.lastRun.id)
        ) {
          finishedNotifications.push({
            jobName: status.jobName,
            lastRun: status.lastRun,
          });
        } else if (
          !isInitialStatusFetch.current &&
          !previous?.running &&
          status.running &&
          expandedLogsRef.current[status.jobName] &&
          loadLogsRef.current
        ) {
          loadLogsRef.current(status.jobName);
        }
      }
      return next;
    });
    if (finishedNotifications.length > 0) {
      for (const { jobName, lastRun } of finishedNotifications) {
        const failed =
          lastRun.status === "Failed" ||
          (!lastRun.status && !!lastRun.errorMessage);
        const display = JOB_DISPLAY_NAMES[jobName] || jobName;
        const message = failed
          ? `${display} failed: ${lastRun.errorMessage || "Unknown error."}`
          : `${display} completed successfully.`;
        setTriggerResults((prev) => ({
          ...prev,
          [jobName]: {
            variant: failed ? "error" : "success",
            message,
          },
        }));
        toast({
          title: failed ? "Job Failed" : "Success",
          description: message,
          variant: failed ? "destructive" : "default",
        });
        if (!expandedLogsRef.current[jobName]) {
          setExpandedLogs((prev) => ({ ...prev, [jobName]: true }));
        }
        if (loadLogsRef.current) {
          loadLogsRef.current(jobName);
        }
      }
    }
    isInitialStatusFetch.current = false;
  }, [toast]);

  useEffect(() => {
    if (configs.length === 0) return;
    pollStatuses();
    const interval = setInterval(() => {
      pollStatuses();
    }, 5000);
    return () => clearInterval(interval);
  }, [configs.length, pollStatuses]);

  const handleEditChange = (jobName: string, field: keyof EditState, value: string | number) => {
    setEditStates((prev) => ({
      ...prev,
      [jobName]: { ...prev[jobName], [field]: value },
    }));
  };

  const hasChanges = (config: SchedulerConfig): boolean => {
    const edit = editStates[config.jobName];
    if (!edit) return false;
    const editMinute = parseInt(edit.minuteDisplay, 10);
    return edit.hour !== config.hour || editMinute !== config.minute || edit.timezone !== config.timezone;
  };

  const handleMinuteBlur = (jobName: string) => {
    setEditStates((prev) => {
      const current = prev[jobName];
      if (!current) return prev;
      const raw = current.minuteDisplay.trim();
      if (raw === "") {
        const config = configs.find((c) => c.jobName === jobName);
        const fallback = config ? String(config.minute).padStart(2, "0") : "00";
        return { ...prev, [jobName]: { ...current, minuteDisplay: fallback } };
      }
      if (/^\d{1,2}$/.test(raw)) {
        const num = parseInt(raw, 10);
        if (num >= 0 && num <= 59) {
          return { ...prev, [jobName]: { ...current, minuteDisplay: String(num).padStart(2, "0") } };
        }
      }
      return prev;
    });
  };

  const normalizeMinute = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!/^\d{1,2}$/.test(trimmed)) return null;
    const num = parseInt(trimmed, 10);
    if (num < 0 || num > 59) return null;
    return String(num).padStart(2, "0");
  };

  const handleSave = async (jobName: string) => {
    const edit = editStates[jobName];
    if (!edit) return;

    const normalized = normalizeMinute(edit.minuteDisplay);
    if (normalized === null) {
      toast({ title: "Invalid Minute", description: "Minute must be a two-digit value between 00 and 59.", variant: "destructive" });
      return;
    }

    setEditStates((prev) => ({
      ...prev,
      [jobName]: { ...prev[jobName], minuteDisplay: normalized },
    }));

    const minuteVal = parseInt(normalized, 10);

    setSavingJobs((prev) => ({ ...prev, [jobName]: true }));
    try {
      const { data: updated, warning } = await updateSchedulerConfig(jobName, edit.hour, minuteVal, edit.timezone);
      setConfigs((prev) => prev.map((c) => (c.jobName === jobName ? updated : c)));
      setEditStates((prev) => ({
        ...prev,
        [jobName]: { hour: updated.hour, minuteDisplay: String(updated.minute).padStart(2, "0"), timezone: updated.timezone },
      }));
      if (warning) {
        toast({ title: "Saved with warning", description: warning, variant: "destructive" });
      } else {
        toast({ title: "Saved", description: `Schedule for ${JOB_DISPLAY_NAMES[jobName] || jobName} updated successfully.` });
      }
    } catch {
      toast({ title: "Error", description: `Failed to update schedule for ${JOB_DISPLAY_NAMES[jobName] || jobName}.`, variant: "destructive" });
    } finally {
      setSavingJobs((prev) => ({ ...prev, [jobName]: false }));
    }
  };

  const handleTrigger = async (jobName: string) => {
    setTriggeringJobs((prev) => ({ ...prev, [jobName]: true }));
    setTriggerResults((prev) => {
      const copy = { ...prev };
      delete copy[jobName];
      return copy;
    });

    try {
      const result = await triggerSchedulerJob(jobName);
      if (result.alreadyRunning) {
        setTriggerResults((prev) => ({
          ...prev,
          [jobName]: { variant: "error", message: result.message },
        }));
        toast({
          title: "Already Running",
          description: result.message,
          variant: "destructive",
        });
      } else if (result.started) {
        const startedAt = new Date(result.startTime);
        const startedLabel = startedAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        const message = `Started at ${startedLabel} — this may take a few minutes. You can leave this page; results will appear in Recent Logs.`;
        setTriggerResults((prev) => ({
          ...prev,
          [jobName]: { variant: "info", message },
        }));
        // Optimistically mark as running until the next poll confirms.
        setJobStatuses((prev) => ({
          ...prev,
          [jobName]: {
            jobName,
            running: true,
            runningLogId: result.runningLogId,
            runningSince: result.startTime,
            lastRun: prev[jobName]?.lastRun ?? null,
          },
        }));
        toast({ title: "Started", description: `${JOB_DISPLAY_NAMES[jobName] || jobName} is now running.` });
      }
      if (expandedLogs[jobName]) {
        loadLogs(jobName);
      }
    } catch {
      setTriggerResults((prev) => ({
        ...prev,
        [jobName]: { variant: "error", message: "Failed to trigger job." },
      }));
      toast({ title: "Error", description: `Failed to trigger ${JOB_DISPLAY_NAMES[jobName] || jobName}.`, variant: "destructive" });
    } finally {
      setTriggeringJobs((prev) => ({ ...prev, [jobName]: false }));
    }
  };

  const handleToggle = async (jobName: string, currentEnabled: boolean) => {
    setTogglingJobs((prev) => ({ ...prev, [jobName]: true }));
    try {
      const { data: updated, warning } = await toggleSchedulerJob(jobName, !currentEnabled);
      setConfigs((prev) => prev.map((c) => (c.jobName === jobName ? updated : c)));
      if (warning) {
        toast({ title: "Toggled with warning", description: warning, variant: "destructive" });
      } else {
        toast({ title: updated.isEnabled ? "Enabled" : "Disabled", description: `${JOB_DISPLAY_NAMES[jobName] || jobName} has been ${updated.isEnabled ? "enabled" : "disabled"}.` });
      }
    } catch {
      toast({ title: "Error", description: `Failed to toggle ${JOB_DISPLAY_NAMES[jobName] || jobName}.`, variant: "destructive" });
    } finally {
      setTogglingJobs((prev) => ({ ...prev, [jobName]: false }));
    }
  };

  const loadLogs = useCallback(
    async (jobName: string) => {
      setLogsLoading((prev) => ({ ...prev, [jobName]: true }));
      try {
        const data = await fetchSchedulerLogs(jobName, 10);
        setJobLogs((prev) => ({ ...prev, [jobName]: data.logs }));
      } catch {
        toast({
          title: "Error",
          description: `Failed to load logs for ${JOB_DISPLAY_NAMES[jobName] || jobName}.`,
          variant: "destructive",
        });
      } finally {
        setLogsLoading((prev) => ({ ...prev, [jobName]: false }));
      }
    },
    [toast],
  );

  useEffect(() => {
    loadLogsRef.current = loadLogs;
  }, [loadLogs]);

  const openSentEmails = async (log: SchedulerLog, jobTimezone: string, jobName: string) => {
    setSentEmailsContext({
      startTime: log.startTime,
      endTime: log.endTime,
      timezone: log.timezone || jobTimezone,
      jobName,
    });
    setSentEmailsOpen(true);
    setSentEmails([]);
    setSentWelcomeEmails([]);
    setSentEmailsLoading(true);
    try {
      if (jobName === "WelcomeSeries") {
        const data = await fetchSentWelcomeEmails(log.startTime, log.endTime ?? undefined, log.id);
        setSentWelcomeEmails(data.emails);
      } else {
        const data = await fetchSentReminderEmails(log.startTime, log.endTime ?? undefined, log.id);
        setSentEmails(data.emails);
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to load sent emails for this run.",
        variant: "destructive",
      });
    } finally {
      setSentEmailsLoading(false);
    }
  };

  const handleDownloadBackup = async (log: SchedulerLog) => {
    const md = (log.metadata as Record<string, unknown> | null) || {};
    const path =
      (typeof md.artifactPath === "string" && md.artifactPath) ||
      (typeof md.storagePath === "string" && md.storagePath) ||
      "";
    if (!path) {
      toast({
        title: "No backup file",
        description: "This run did not record an artifact path.",
        variant: "destructive",
      });
      return;
    }
    setDownloadingLogs((prev) => ({ ...prev, [log.id]: true }));
    try {
      const { url } = await fetchBackupDownloadUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ||
        (err instanceof Error ? err.message : "Failed to generate download link.");
      toast({
        title: "Download Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDownloadingLogs((prev) => ({ ...prev, [log.id]: false }));
    }
  };

  const toggleLogs = (jobName: string) => {
    const isOpen = expandedLogs[jobName];
    setExpandedLogs((prev) => ({ ...prev, [jobName]: !isOpen }));
    if (!isOpen) {
      loadLogs(jobName);
    }
  };

  const formatTime = (hour: number, minute: number): string => {
    const period = hour >= 12 ? "PM" : "AM";
    const h = hour % 12 || 12;
    return `${h}:${String(minute).padStart(2, "0")} ${period}`;
  };


  // Parse a server-provided timestamp string into millis-since-epoch.
  // Handles both correct TIMESTAMPTZ output (`...+00`, `...Z`) and legacy
  // TIMESTAMP-without-tz output (`YYYY-MM-DD HH:MM:SS[.ms]`) by treating
  // the latter as UTC, matching how `formatDateTimeInZone` displays it.
  const parseServerTime = (val: string): number => {
    if (!val) return NaN;
    const hasTz = /Z$|[+-]\d{2}:?\d{0,2}$/.test(val.trim());
    if (hasTz) return new Date(val).getTime();
    const isoLike = val.includes("T") ? val : val.replace(" ", "T");
    return new Date(`${isoLike}Z`).getTime();
  };

  const formatDuration = (start: string, end: string | null): string => {
    if (!end) return "—";
    const ms = parseServerTime(end) - parseServerTime(start);
    if (!Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSec = seconds % 60;
    return `${minutes}m ${remainingSec}s`;
  };

  const formatLiveDuration = (start: string, nowMs: number): string => {
    const startMs = parseServerTime(start);
    if (!Number.isFinite(startMs)) return "0s";
    const ms = nowMs - startMs;
    if (ms < 1000) return "0s";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSec = seconds % 60;
    return `${minutes}m ${remainingSec}s`;
  };

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const hasRunning = Object.values(jobStatuses).some((s) => s?.running);
    if (!hasRunning) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [jobStatuses]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading scheduler configurations...</span>
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No scheduler configurations found. The scheduler_configurations table may need to be initialized.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <TooltipProvider delayDuration={150}>
      {configs.map((config) => {
        const edit = editStates[config.jobName];
        const isSaving = savingJobs[config.jobName];
        const isTriggering = triggeringJobs[config.jobName];
        const isToggling = togglingJobs[config.jobName];
        const result = triggerResults[config.jobName];
        const isExpanded = expandedLogs[config.jobName];
        const logs = jobLogs[config.jobName] || [];
        const isLogsLoading = logsLoading[config.jobName];
        const changed = hasChanges(config);
        const status = jobStatuses[config.jobName];
        const isRunning = !!status?.running;
        const runningSinceLabel = status?.runningSince
          ? formatDateTimeInZone(status.runningSince, config.timezone)
          : null;
        const runDisabledReason = !config.isEnabled
          ? "This job is disabled."
          : isRunning
          ? "This job is already running."
          : null;

        return (
          <Card key={config.id}>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{JOB_DISPLAY_NAMES[config.jobName] || config.jobName}</h3>
                      {!config.isEnabled && (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      )}
                      {isRunning && (
                        <Badge
                          variant="secondary"
                          className="text-xs bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1"
                        >
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Running…
                        </Badge>
                      )}
                    </div>
                    {(JOB_DESCRIPTIONS[config.jobName] || config.description) && (
                      <p className="text-sm text-muted-foreground mt-1">{JOB_DESCRIPTIONS[config.jobName] || config.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Currently scheduled: {formatTime(config.hour, config.minute)} ({config.timezone})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        {config.isEnabled ? "Enabled" : "Disabled"}
                      </label>
                      <Switch
                        checked={config.isEnabled}
                        onCheckedChange={() => handleToggle(config.jobName, config.isEnabled)}
                        disabled={isToggling}
                      />
                    </div>
                    {(() => {
                      const runDisabled =
                        isTriggering || !config.isEnabled || isRunning;
                      const button = (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTrigger(config.jobName)}
                          disabled={runDisabled}
                        >
                          {isTriggering || isRunning ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <Play className="h-4 w-4 mr-2" />
                          )}
                          Run Now
                        </Button>
                      );
                      if (runDisabled && runDisabledReason) {
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span tabIndex={0}>{button}</span>
                            </TooltipTrigger>
                            <TooltipContent>{runDisabledReason}</TooltipContent>
                          </Tooltip>
                        );
                      }
                      return button;
                    })()}
                  </div>
                </div>

                {isRunning && (
                  <div className="flex items-start gap-2 p-3 rounded-md text-sm bg-blue-50 text-blue-800 border border-blue-200">
                    <Activity className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {runningSinceLabel
                        ? `Started at ${runningSinceLabel} — this may take a few minutes. You can leave this page; results will appear in Recent Logs.`
                        : `This job is currently running. Results will appear in Recent Logs when it finishes.`}
                    </span>
                  </div>
                )}

                {result && !isRunning && (
                  <div
                    className={`flex items-start gap-2 p-3 rounded-md text-sm ${
                      result.variant === "success"
                        ? "bg-green-50 text-green-800 border border-green-200"
                        : result.variant === "info"
                        ? "bg-blue-50 text-blue-800 border border-blue-200"
                        : "bg-red-50 text-red-800 border border-red-200"
                    }`}
                  >
                    {result.variant === "success" ? (
                      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : result.variant === "info" ? (
                      <Activity className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <span>{result.message}</span>
                  </div>
                )}

                {edit && (
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">Hour (0-23)</label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={edit.hour}
                        onChange={(e) => handleEditChange(config.jobName, "hour", parseInt(e.target.value, 10) || 0)}
                        className="w-20"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">Minute (00-59)</label>
                      <Input
                        type="text"
                        maxLength={2}
                        value={edit.minuteDisplay}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                          if (v.length === 2 && parseInt(v, 10) > 59) return;
                          handleEditChange(config.jobName, "minuteDisplay", v);
                        }}
                        onBlur={() => handleMinuteBlur(config.jobName)}
                        className="w-20"
                      />
                      {edit.minuteDisplay.trim() !== "" && normalizeMinute(edit.minuteDisplay) === null && (
                        <span className="text-xs text-red-500">Must be 00–59</span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-medium text-muted-foreground">Timezone</label>
                      <Select
                        value={edit.timezone}
                        onValueChange={(v) => handleEditChange(config.jobName, "timezone", v)}
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>
                              {tz}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleSave(config.jobName)}
                      disabled={isSaving || !changed}
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save
                    </Button>
                  </div>
                )}

                <Collapsible open={isExpanded} onOpenChange={() => toggleLogs(config.jobName)}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-fit">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 mr-2" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-2" />
                      )}
                      Recent Logs
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    {isLogsLoading ? (
                      <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading logs...
                      </div>
                    ) : logs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">No recent logs found.</p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Status</TableHead>
                              <TableHead>Start Time</TableHead>
                              <TableHead>Duration</TableHead>
                              <TableHead>Details</TableHead>
                              {(config.jobName === "SendReminderEmail" ||
                                config.jobName === "WelcomeSeries" ||
                                config.jobName === "BackupDatabase") && (
                                <TableHead>Action</TableHead>
                              )}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {logs.map((log) => {
                              const isRunningRow =
                                log.status === "Running" && !log.endTime;
                              return (
                              <TableRow key={log.id}>
                                <TableCell>
                                  {isRunningRow ? (
                                    <Badge
                                      variant="secondary"
                                      className="bg-blue-100 text-blue-800 border border-blue-200 flex items-center gap-1 w-fit"
                                    >
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Running
                                    </Badge>
                                  ) : (log.status === "Failed" || (!log.status && log.errorMessage)) ? (
                                    <Badge variant="destructive">Failed</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="bg-green-100 text-green-800">Success</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">{formatDateTimeInZone(log.startTime, log.timezone || config.timezone)}</TableCell>
                                <TableCell className="text-sm">
                                  {isRunningRow
                                    ? formatLiveDuration(log.startTime, nowTick)
                                    : formatDuration(log.startTime, log.endTime)}
                                </TableCell>
                                <TableCell className="text-sm max-w-md truncate">
                                  {isRunningRow ? (
                                    <span className="text-muted-foreground italic">In progress…</span>
                                  ) : log.errorMessage ? (
                                    <span className="text-red-600" title={log.errorMessage}>
                                      {log.errorMessage}
                                    </span>
                                  ) : config.jobName === "SendReminderEmail" ? (
                                    (() => {
                                      const md = (log.metadata as Record<string, unknown> | null) || {};
                                      const day3 = Number(md.day3 ?? 0);
                                      const week2 = Number(md.week2 ?? 0);
                                      return (
                                        <span>Day3: {day3}, Week2: {week2}</span>
                                      );
                                    })()
                                  ) : config.jobName === "WelcomeSeries" ? (
                                    (() => {
                                      const md = (log.metadata as Record<string, unknown> | null) || {};
                                      const day1 = Number(md.day1 ?? 0);
                                      const day6 = Number(md.day6 ?? 0);
                                      const day10 = Number(md.day10 ?? 0);
                                      return (
                                        <span>
                                          Day1: {day1}, Day6: {day6}, Day10: {day10}
                                        </span>
                                      );
                                    })()
                                  ) : config.jobName === "BackupDatabase" ? (
                                    (() => {
                                      const md = (log.metadata as Record<string, unknown> | null) || {};
                                      const action = typeof md.action === "string" ? md.action : null;
                                      if (action === "retention") {
                                        const summary = typeof md.summary === "string" ? md.summary : null;
                                        const prunedFiles = Number(md.prunedFiles ?? 0);
                                        const folders = Array.isArray(md.prunedFolders)
                                          ? (md.prunedFolders as unknown[]).filter(
                                              (f): f is string => typeof f === "string",
                                            )
                                          : [];
                                        const paths = Array.isArray(md.prunedPaths)
                                          ? (md.prunedPaths as unknown[]).filter(
                                              (p): p is string => typeof p === "string",
                                            )
                                          : [];
                                        const warnings = Array.isArray(md.warnings)
                                          ? (md.warnings as unknown[]).filter(
                                              (w): w is string => typeof w === "string",
                                            )
                                          : [];
                                        const text =
                                          summary ??
                                          (prunedFiles > 0
                                            ? `Retention: deleted ${prunedFiles} backup file(s)` +
                                              (folders.length > 0 ? ` from ${folders.join(", ")}` : "")
                                            : "Retention check");
                                        const tooltipParts: string[] = [];
                                        if (warnings.length > 0) tooltipParts.push(warnings.join("\n"));
                                        if (paths.length > 0) {
                                          tooltipParts.push(
                                            `Pruned files:\n${paths.join("\n")}`,
                                          );
                                        }
                                        const tooltip = tooltipParts.join("\n\n") || text;
                                        return (
                                          <span title={tooltip}>
                                            <span className="text-xs">🗑️ {text}</span>
                                            {warnings.length > 0 && (
                                              <span className="ml-2 text-xs text-amber-600">
                                                ({warnings.length} warning{warnings.length === 1 ? "" : "s"})
                                              </span>
                                            )}
                                          </span>
                                        );
                                      }
                                      const artifactPath = typeof md.artifactPath === "string" ? md.artifactPath : null;
                                      const sizeBytes = Number(md.sizeBytes ?? 0);
                                      if (!artifactPath) {
                                        return <span className="text-muted-foreground">Completed</span>;
                                      }
                                      return (
                                        <span title={artifactPath}>
                                          <span className="font-mono text-xs">{artifactPath}</span>
                                          {sizeBytes > 0 && (
                                            <span className="ml-2 text-muted-foreground">
                                              ({formatBytes(sizeBytes)})
                                            </span>
                                          )}
                                        </span>
                                      );
                                    })()
                                  ) : (
                                    <span className="text-muted-foreground">Completed</span>
                                  )}
                                </TableCell>
                                {(config.jobName === "SendReminderEmail" ||
                                  config.jobName === "WelcomeSeries") && (
                                  <TableCell>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openSentEmails(log, config.timezone, config.jobName)}
                                    >
                                      <Eye className="h-4 w-4 mr-1" />
                                      View
                                    </Button>
                                  </TableCell>
                                )}
                                {config.jobName === "BackupDatabase" && (
                                  <TableCell>
                                    {(() => {
                                      const md =
                                        (log.metadata as Record<string, unknown> | null) ||
                                        {};
                                      const hasArtifact =
                                        typeof md.artifactPath === "string" ||
                                        typeof md.storagePath === "string";
                                      const isFailed =
                                        log.status === "Failed" ||
                                        (!log.status && !!log.errorMessage);
                                      if (isFailed || !hasArtifact) {
                                        return (
                                          <span className="text-xs text-muted-foreground">
                                            —
                                          </span>
                                        );
                                      }
                                      const isDownloading = !!downloadingLogs[log.id];
                                      return (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => handleDownloadBackup(log)}
                                          disabled={isDownloading}
                                        >
                                          {isDownloading ? (
                                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                          ) : (
                                            <Download className="h-4 w-4 mr-1" />
                                          )}
                                          Download
                                        </Button>
                                      );
                                    })()}
                                  </TableCell>
                                )}
                              </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CardContent>
          </Card>
        );
      })}
      </TooltipProvider>

      <Dialog open={sentEmailsOpen} onOpenChange={setSentEmailsOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {sentEmailsContext?.jobName === "WelcomeSeries"
                ? "Welcome Series Emails Sent"
                : "Reminder Emails Sent"}
              {sentEmailsContext && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · Run started {formatDateTimeInZone(sentEmailsContext.startTime, sentEmailsContext.timezone)}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {sentEmailsLoading ? (
            <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sent emails...
            </div>
          ) : sentEmailsContext?.jobName === "WelcomeSeries" ? (
            <Tabs defaultValue="1" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="self-start">
                {([1, 6, 10] as const).map((dayOffset) => {
                  const count = sentWelcomeEmails.filter((e) => e.dayOffset === dayOffset).length;
                  return (
                    <TabsTrigger key={dayOffset} value={String(dayOffset)}>
                      Day {dayOffset} ({count})
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {([1, 6, 10] as const).map((dayOffset) => {
                const filtered = sentWelcomeEmails.filter((e) => e.dayOffset === dayOffset);
                return (
                  <TabsContent key={dayOffset} value={String(dayOffset)} className="flex-1 overflow-auto mt-4">
                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No Day {dayOffset} welcome emails were sent during this run.
                      </p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Status</TableHead>
                              <TableHead>Sent At</TableHead>
                              <TableHead>Recipient</TableHead>
                              <TableHead>Error</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered.map((email) => {
                              const fullName = [email.userFirstName, email.userLastName]
                                .filter(Boolean)
                                .join(" ");
                              const failed = !email.success || !!email.errorMessage;
                              return (
                                <TableRow key={email.id}>
                                  <TableCell>
                                    {failed ? (
                                      <Badge variant="destructive">Failed</Badge>
                                    ) : (
                                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                                        Sent
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm whitespace-nowrap">
                                    {formatDateTimeInZone(
                                      email.sentDate,
                                      sentEmailsContext?.timezone || "UTC"
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <div>{email.userEmail || "—"}</div>
                                    {fullName && (
                                      <div className="text-xs text-muted-foreground">{fullName}</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm max-w-xs truncate">
                                    {email.errorMessage ? (
                                      <span className="text-red-600" title={email.errorMessage}>
                                        {email.errorMessage}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          ) : (
            <Tabs defaultValue="Day3" className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="self-start">
                {(["Day3", "Week2"] as const).map((type) => {
                  const count = sentEmails.filter((e) => e.reminderType === type).length;
                  const label = type === "Day3" ? "Day 3" : "Day 14";
                  return (
                    <TabsTrigger key={type} value={type}>
                      {label} ({count})
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              {(["Day3", "Week2"] as const).map((type) => {
                const filtered = sentEmails.filter((e) => e.reminderType === type);
                const label = type === "Day3" ? "Day 3" : "Day 14";
                return (
                  <TabsContent key={type} value={type} className="flex-1 overflow-auto mt-4">
                    {filtered.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No {label} reminder emails were sent during this run.
                      </p>
                    ) : (
                      <div className="rounded-md border overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Status</TableHead>
                              <TableHead>Sent At</TableHead>
                              <TableHead>Recipient</TableHead>
                              <TableHead>Investment</TableHead>
                              <TableHead>DAF Provider</TableHead>
                              <TableHead>Error</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered.map((email) => {
                              const fullName = [email.userFirstName, email.userLastName]
                                .filter(Boolean)
                                .join(" ");
                              return (
                                <TableRow key={email.id}>
                                  <TableCell>
                                    {email.errorMessage ? (
                                      <Badge variant="destructive">Failed</Badge>
                                    ) : (
                                      <Badge variant="secondary" className="bg-green-100 text-green-800">
                                        Sent
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm whitespace-nowrap">
                                    {formatDateTimeInZone(
                                      email.sentDate,
                                      sentEmailsContext?.timezone || "UTC"
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm">
                                    <div>{email.userEmail || "—"}</div>
                                    {fullName && (
                                      <div className="text-xs text-muted-foreground">{fullName}</div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-sm">{email.campaignName || "—"}</TableCell>
                                  <TableCell className="text-sm">{email.dafProvider || "—"}</TableCell>
                                  <TableCell className="text-sm max-w-xs truncate">
                                    {email.errorMessage ? (
                                      <span className="text-red-600" title={email.errorMessage}>
                                        {email.errorMessage}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
