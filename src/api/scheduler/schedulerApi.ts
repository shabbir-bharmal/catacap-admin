import axiosInstance from "../axios";

export interface SchedulerConfig {
  id: number;
  jobName: string;
  description: string | null;
  hour: number;
  minute: number;
  timezone: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerLog {
  id: number;
  jobName: string;
  startTime: string;
  endTime: string | null;
  errorMessage: string | null;
  status: string | null;
  timezone: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SentWelcomeEmailEntry {
  id: number;
  formSubmissionId: number;
  dayOffset: number;
  success: boolean;
  errorMessage: string | null;
  sentDate: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export interface SentWelcomeEmailsResponse {
  emails: SentWelcomeEmailEntry[];
}

export async function fetchSentWelcomeEmails(
  startTime?: string,
  endTime?: string,
  schedulerLogId?: number
): Promise<SentWelcomeEmailsResponse> {
  const params: Record<string, string | number> = {};
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;
  if (schedulerLogId !== undefined && schedulerLogId !== null) {
    params.schedulerLogId = schedulerLogId;
  }
  const response = await axiosInstance.get<SentWelcomeEmailsResponse>(
    "/api/admin/scheduler/sent-welcome-emails",
    { params }
  );
  return response.data;
}

export interface SchedulerLogsResponse {
  logs: SchedulerLog[];
  total: number;
}

export interface SentEmailEntry {
  id: number;
  pendingGrantId: number | null;
  userId: string | null;
  reminderType: string;
  errorMessage: string | null;
  sentDate: string;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
  amount: string | number | null;
  dafProvider: string | null;
  campaignName: string | null;
}

export interface SentEmailsResponse {
  emails: SentEmailEntry[];
}

export async function fetchSentReminderEmails(
  startTime?: string,
  endTime?: string,
  schedulerLogId?: number
): Promise<SentEmailsResponse> {
  const params: Record<string, string | number> = {};
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;
  if (schedulerLogId !== undefined && schedulerLogId !== null) {
    params.schedulerLogId = schedulerLogId;
  }
  const response = await axiosInstance.get<SentEmailsResponse>(
    "/api/admin/scheduler/sent-emails",
    { params }
  );
  return response.data;
}

export interface TriggerResult {
  started: boolean;
  alreadyRunning: boolean;
  message: string;
  error?: string;
  startTime: string;
  runningLogId: number | null;
}

export interface SchedulerJobStatus {
  jobName: string;
  running: boolean;
  runningLogId: number | null;
  runningSince: string | null;
  lastRun: SchedulerLog | null;
}

export interface SchedulerStatusResponse {
  statuses: SchedulerJobStatus[];
}

export async function fetchSchedulerStatuses(): Promise<SchedulerJobStatus[]> {
  const response = await axiosInstance.get<SchedulerStatusResponse>(
    "/api/admin/scheduler/status",
  );
  return response.data.statuses || [];
}

export async function fetchSchedulerConfigs(): Promise<SchedulerConfig[]> {
  const response = await axiosInstance.get<SchedulerConfig[]>(
    "/api/admin/scheduler"
  );
  const data = response.data;
  if (!Array.isArray(data)) return [];
  return data;
}

export interface UpdateSchedulerResult {
  data: SchedulerConfig;
  warning?: string;
}

export async function updateSchedulerConfig(
  jobName: string,
  hour: number,
  minute: number,
  timezone: string
): Promise<UpdateSchedulerResult> {
  const response = await axiosInstance.put<{ success: boolean; data: SchedulerConfig; warning?: string }>(
    `/api/admin/scheduler/${jobName}`,
    { hour, minute, timezone }
  );
  return { data: response.data.data, warning: response.data.warning };
}

export async function triggerSchedulerJob(
  jobName: string
): Promise<TriggerResult> {
  const response = await axiosInstance.post<TriggerResult>(
    `/api/admin/scheduler/${jobName}/trigger`
  );
  return response.data;
}

export async function toggleSchedulerJob(
  jobName: string,
  isEnabled: boolean
): Promise<UpdateSchedulerResult> {
  const response = await axiosInstance.patch<{ success: boolean; data: SchedulerConfig; warning?: string }>(
    `/api/admin/scheduler/${jobName}/toggle`,
    { isEnabled }
  );
  return { data: response.data.data, warning: response.data.warning };
}

export async function fetchSchedulerLogs(
  jobName?: string,
  limit = 20,
  offset = 0
): Promise<SchedulerLogsResponse> {
  const params: Record<string, string | number> = { limit, offset };
  if (jobName) params.jobName = jobName;
  const response = await axiosInstance.get<SchedulerLogsResponse>(
    "/api/admin/scheduler/logs",
    { params }
  );
  return response.data;
}

export interface BackupDownloadResponse {
  url: string;
  storagePath: string;
  expiresInSeconds: number;
}

export async function fetchBackupDownloadUrl(
  artifactPath: string
): Promise<BackupDownloadResponse> {
  const response = await axiosInstance.post<BackupDownloadResponse>(
    "/api/admin/scheduler/BackupDatabase/download",
    { path: artifactPath }
  );
  return response.data;
}
