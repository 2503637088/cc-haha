/**
 * Diagnostics REST API
 *
 * GET    /api/diagnostics/status       — log directory, retention and counters
 * GET    /api/diagnostics/events       — recent sanitized diagnostic events
 * POST   /api/diagnostics/export       — write a sanitized tar.gz bundle
 * POST   /api/diagnostics/open-log-dir — open the diagnostics directory
 * DELETE /api/diagnostics              — clear diagnostics files
 */

import { diagnosticsService } from '../services/diagnosticsService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

export async function handleDiagnosticsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const action = segments[2]

    if (!action && req.method === 'DELETE') {
      await diagnosticsService.clear()
      return Response.json({ ok: true })
    }

    if (action === 'status' && req.method === 'GET') {
      return Response.json(await diagnosticsService.getStatus())
    }

    if (action === 'events' && req.method === 'GET') {
      const limit = Number.parseInt(url.searchParams.get('limit') || '100', 10)
      const events = await diagnosticsService.readRecentEvents(Number.isFinite(limit) ? limit : 100)
      return Response.json({ events })
    }

    if (action === 'export' && req.method === 'POST') {
      return Response.json({ bundle: await diagnosticsService.exportBundle() })
    }

    if (action === 'open-log-dir' && req.method === 'POST') {
      await diagnosticsService.openLogDir()
      return Response.json({ ok: true })
    }

    throw new ApiError(404, `Unknown diagnostics endpoint: ${action ?? '(root)'}`, 'NOT_FOUND')
  } catch (error) {
    return errorResponse(error)
  }
}
