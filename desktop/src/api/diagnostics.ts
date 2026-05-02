import { api } from './client'

export type DiagnosticSeverity = 'debug' | 'info' | 'warn' | 'error'

export type DiagnosticEvent = {
  id: string
  timestamp: string
  type: string
  severity: DiagnosticSeverity
  summary: string
  sessionId?: string
  details?: unknown
}

export type DiagnosticsStatus = {
  logDir: string
  diagnosticsPath: string
  runtimeErrorsPath: string
  exportDir: string
  retentionDays: number
  maxBytes: number
  totalBytes: number
  eventCount: number
  recentErrorCount: number
  lastEventAt: string | null
}

export type DiagnosticsBundle = {
  path: string
  fileName: string
  bytes: number
}

export const diagnosticsApi = {
  getStatus: () => api.get<DiagnosticsStatus>('/api/diagnostics/status'),
  getEvents: (limit = 100) => api.get<{ events: DiagnosticEvent[] }>(`/api/diagnostics/events?limit=${limit}`),
  exportBundle: () => api.post<{ bundle: DiagnosticsBundle }>('/api/diagnostics/export', undefined, { timeout: 60_000 }),
  openLogDir: () => api.post<{ ok: true }>('/api/diagnostics/open-log-dir'),
  clear: () => api.delete<{ ok: true }>('/api/diagnostics'),
}
