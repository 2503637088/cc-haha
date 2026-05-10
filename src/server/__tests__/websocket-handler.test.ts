import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerWebSocket } from 'bun'
import {
  __resetWebSocketHandlerStateForTests,
  closeSessionConnection,
  getActiveSessionIds,
  handleWebSocket,
  type WebSocketData,
} from '../ws/handler.js'
import { conversationService } from '../services/conversationService.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { goalService } from '../services/goalService.js'

function makeClientSocket(sessionId: string) {
  const sent: string[] = []
  return {
    data: {
      sessionId,
      connectedAt: Date.now(),
      channel: 'client',
      sdkToken: null,
      serverPort: 0,
      serverHost: '127.0.0.1',
    },
    send: mock((payload: string) => {
      sent.push(payload)
    }),
    close: mock(() => {}),
    sent,
  } as unknown as ServerWebSocket<WebSocketData> & { sent: string[] }
}

describe('WebSocket handler session isolation', () => {
  let tmpDir: string | null = null
  let originalConfigDir: string | undefined

  afterEach(async () => {
    __resetWebSocketHandlerStateForTests()
    mock.restore()
    if (tmpDir) {
      if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
    tmpDir = null
  })

  async function useTempConfigDir() {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-ws-goals-'))
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tmpDir
  }

  it('ignores stale disconnects from an older socket for the same session', () => {
    const sessionId = `duplicate-${crypto.randomUUID()}`
    const first = makeClientSocket(sessionId)
    const second = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession')

    handleWebSocket.open(first)
    handleWebSocket.open(second)
    clearCallbacks.mockClear()
    cancelComputerUse.mockClear()

    handleWebSocket.close(first, 1000, 'stale tab closed')

    expect(getActiveSessionIds()).toContain(sessionId)
    expect(clearCallbacks).not.toHaveBeenCalled()
    expect(cancelComputerUse).not.toHaveBeenCalled()
  })

  it('closes and removes an active client socket when a session is deleted', () => {
    const sessionId = `delete-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const clearCallbacks = spyOn(conversationService, 'clearOutputCallbacks')
    const cancelComputerUse = spyOn(computerUseApprovalService, 'cancelSession')

    handleWebSocket.open(ws)

    expect(closeSessionConnection(sessionId, 'session deleted')).toBe(true)

    expect(getActiveSessionIds()).not.toContain(sessionId)
    expect(ws.close).toHaveBeenCalledWith(1000, 'session deleted')
    expect(clearCallbacks).toHaveBeenCalledWith(sessionId)
    expect(cancelComputerUse).toHaveBeenCalledWith(sessionId)
  })

  it('handles /goal status locally without forwarding it to the CLI', async () => {
    await useTempConfigDir()
    const sessionId = `goal-status-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const sendToCli = spyOn(conversationService, 'sendMessage')

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '/goal',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    const messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'goal_status',
      message: 'No active session goal is set.',
    }))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'message_complete',
    }))
    expect(sendToCli).not.toHaveBeenCalled()
  })

  it('handles /retry status locally without forwarding it to the CLI', async () => {
    const sessionId = `retry-status-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    const sendToCli = spyOn(conversationService, 'sendMessage')

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '/retry',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    const messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'retry_status',
      message: 'No automatic retry is pending.',
    }))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'message_complete',
    }))
    expect(sendToCli).not.toHaveBeenCalled()
  })

  it('schedules automatic retry after a failed model result and exposes the error', async () => {
    const sessionId = `retry-failed-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    let outputCallback: ((msg: any) => void) | null = null
    spyOn(conversationService, 'hasSession').mockImplementation(() => true)
    spyOn(conversationService, 'clearOutputCallbacks').mockImplementation(() => {})
    spyOn(conversationService, 'onOutput').mockImplementation((_sessionId, callback) => {
      outputCallback = callback
    })
    const sendToCli = spyOn(conversationService, 'sendMessage').mockImplementation(() => true)

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: 'search the web',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(sendToCli).toHaveBeenCalledWith(sessionId, 'search the web', undefined)
    expect(outputCallback).toBeTruthy()
    outputCallback?.({
      type: 'result',
      is_error: true,
      result: 'API Error: overloaded',
      usage: { input_tokens: 1, output_tokens: 0 },
    })

    let messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'error',
      message: 'API Error: overloaded',
      code: 'CLI_ERROR',
    }))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'retry_scheduled',
      data: expect.objectContaining({
        failureCount: 1,
        nextAttempt: 1,
        intervalMs: 120_000,
        errorMessage: 'API Error: overloaded',
        errorCode: 'CLI_ERROR',
      }),
    }))

    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '/retry',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'retry_status',
      message: expect.stringContaining('API Error: overloaded'),
    }))
  })

  it('pauses a scheduled automatic retry when generation is stopped', async () => {
    const sessionId = `retry-stop-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    let outputCallback: ((msg: any) => void) | null = null
    spyOn(conversationService, 'hasSession').mockImplementation(() => true)
    spyOn(conversationService, 'clearOutputCallbacks').mockImplementation(() => {})
    spyOn(conversationService, 'onOutput').mockImplementation((_sessionId, callback) => {
      outputCallback = callback
    })
    spyOn(conversationService, 'sendMessage').mockImplementation(() => true)
    const interrupt = spyOn(conversationService, 'sendInterrupt').mockImplementation(() => true)

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: 'retry me',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))
    outputCallback?.({
      type: 'result',
      is_error: true,
      result: 'API Error: timeout',
      usage: { input_tokens: 1, output_tokens: 0 },
    })

    handleWebSocket.message(ws, JSON.stringify({ type: 'stop_generation' }))

    const messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(interrupt).toHaveBeenCalledWith(sessionId)
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'retry_paused',
      data: expect.objectContaining({
        paused: true,
        nextRetryAt: null,
        errorMessage: 'API Error: timeout',
      }),
    }))
  })

  it('handles /goal pause locally and persists the paused goal', async () => {
    await useTempConfigDir()
    const sessionId = `goal-pause-${crypto.randomUUID()}`
    const ws = makeClientSocket(sessionId)
    await goalService.setGoalObjective(sessionId, 'finish local tests')

    handleWebSocket.open(ws)
    handleWebSocket.message(ws, JSON.stringify({
      type: 'user_message',
      content: '/goal pause',
    }))
    await new Promise(resolve => setTimeout(resolve, 10))

    await expect(goalService.getGoal(sessionId)).resolves.toMatchObject({
      objective: 'finish local tests',
      status: 'paused',
    })
    const messages = ws.sent.map((payload) => JSON.parse(payload))
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'system_notification',
      subtype: 'goal_updated',
      message: 'Session goal paused: finish local tests',
    }))
  })
})
