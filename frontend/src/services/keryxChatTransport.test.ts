import { describe, it, expect, vi } from 'vitest'
import { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { KeryxChatTransport } from './keryxChatTransport'

// sseResponse builds a fetch Response whose body streams the given events as
// our backend's SSE frames.
function sseResponse(events: Record<string, unknown>[]): Response {
  const encoder = new TextEncoder()
  const stream = new NodeReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
  return new Response(stream as unknown as ReadableStream, { status: 200 })
}

async function collect(stream: ReadableStream<unknown>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out.push(value as Record<string, unknown>)
  }
  return out
}

function makeTransport(): KeryxChatTransport {
  return new KeryxChatTransport({ api: '/api/chats/1/stream', headers: async () => ({}) })
}

const sendOptions = {
  trigger: 'submit-message',
  chatId: '1',
  messageId: undefined,
  messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hola' }] }],
  abortSignal: undefined,
  body: { model: 'venice/x' },
} as Parameters<KeryxChatTransport['sendMessages']>[0]

describe('keryxChatTransport tool events', () => {
  it('maps tool_call/tool_result SSE events to tool chunks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      sseResponse([
        { type: 'start', userMessageId: 'u1', assistantMessageId: 'a1' },
        { type: 'tool_call', name: 'web_search', toolCallId: 'tc1', input: '{"query":"keryx"}' },
        { type: 'tool_result', name: 'web_search', toolCallId: 'tc1', output: 'results' },
        { type: 'text', text: 'answer' },
        { type: 'finish' },
      ])
    ) as unknown as typeof fetch

    const stream = await makeTransport().sendMessages(sendOptions)
    const chunks = await collect(stream as unknown as ReadableStream)
    const types = chunks.map(c => c.type)

    const input = chunks.find(c => c.type === 'tool-input-available')
    expect(input).toMatchObject({
      toolCallId: 'tc1',
      toolName: 'web_search',
      input: { query: 'keryx' },
    })
    const output = chunks.find(c => c.type === 'tool-output-available')
    expect(output).toMatchObject({ toolCallId: 'tc1', output: 'results' })
    expect(types).toContain('text-delta')
    expect(types[types.length - 1]).toBe('finish')
  })

  it('keeps invalid JSON tool inputs as raw strings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      sseResponse([
        { type: 'start', assistantMessageId: 'a1' },
        { type: 'tool_call', name: 'web_search', toolCallId: 'tc2', input: 'not-json' },
        { type: 'finish' },
      ])
    ) as unknown as typeof fetch

    const stream = await makeTransport().sendMessages(sendOptions)
    const chunks = await collect(stream as unknown as ReadableStream)
    const input = chunks.find(c => c.type === 'tool-input-available')
    expect(input).toMatchObject({ toolCallId: 'tc2', input: 'not-json' })
  })

  it('forwards the project selection in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: 'start', assistantMessageId: 'a1' },
        { type: 'finish' },
      ])
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await makeTransport().sendMessages({
      ...sendOptions,
      body: { model: 'venice/x', projectId: 'proj-123', agentId: 'ag-1' },
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    const payload = JSON.parse(String(requestInit.body)) as Record<string, unknown>
    expect(payload.projectId).toBe('proj-123')
    expect(payload.agentId).toBe('ag-1')
  })

  it('forwards live tool events on reconnect', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      sseResponse([
        { type: 'start', assistantMessageId: 'a1' },
        { type: 'tool_call', name: 'web_search', toolCallId: 'tc3', input: '{"query":"x"}' },
        { type: 'finish' },
      ])
    ) as unknown as typeof fetch

    const stream = await makeTransport().reconnectToStream({ chatId: '1' })
    expect(stream).not.toBeNull()
    const chunks = await collect(stream as unknown as ReadableStream)
    expect(chunks.map(c => c.type)).toContain('tool-input-available')
  })
})
