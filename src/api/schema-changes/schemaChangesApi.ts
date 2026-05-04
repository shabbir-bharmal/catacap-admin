import axiosInstance from "../axios";

export type SchemaChangeStatus = "applied" | "rolled_back" | "failed";

export interface SchemaChangeLog {
  id: string;
  operationType: string;
  tableName: string;
  columnName: string | null;
  oldDefinition: unknown;
  newDefinition: unknown;
  executedSql: string;
  rollbackSql: string | null;
  triggeredBy: string;
  promptReference: string | null;
  status: SchemaChangeStatus;
  createdAt: string;
  rolledBackAt: string | null;
  rolledBackBy: string | null;
}

export interface SchemaChangeListParams {
  status?: SchemaChangeStatus;
  table?: string;
  operation?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface SchemaChangeListResponse {
  items: SchemaChangeLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface RollbackResponse {
  success: boolean;
  change_id?: string;
  status?: string;
  rolled_back_by?: string;
  error?: string;
  message?: string;
}

export async function fetchSchemaChanges(
  params: SchemaChangeListParams = {},
): Promise<SchemaChangeListResponse> {
  const cleaned: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") cleaned[k] = v as string | number;
  }
  const response = await axiosInstance.get<SchemaChangeListResponse>(
    "/api/admin/schema-changes",
    { params: cleaned },
  );
  return response.data;
}

export async function rollbackSchemaChange(id: string): Promise<RollbackResponse> {
  const response = await axiosInstance.post<RollbackResponse>(
    `/api/admin/schema-changes/rollback/${id}`,
    { confirm: true },
  );
  return response.data;
}
