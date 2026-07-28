/**
 * Custom chat transport for the Keryx SSE streaming format.
 *
 * Implements the AI SDK v6 ChatTransport interface.
 * Adapts our backend's custom SSE format (type: text / type: finish / type: error)
 * to UIMessageChunk objects consumed by the @ai-sdk/vue Chat class.
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

interface KeryxChatTransportOptions {
  api: string;
  headers?: () => Promise<Record<string, string>>;
}

export class KeryxChatTransport implements ChatTransport<UIMessage> {
  private api: string;
  private getHeaders: () => Promise<Record<string, string>>;

  constructor(options: KeryxChatTransportOptions) {
    this.api = options.api;
    this.getHeaders = options.headers ?? (async () => ({}));
  }

  async sendMessages(options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: any[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const additionalHeaders = await this.getHeaders();

    // Merge headers: options.headers takes precedence over additionalHeaders from the auth adapter
    const mergedHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...additionalHeaders,
    };

    if (options.headers) {
      if (options.headers instanceof Headers) {
        for (const [key, value] of options.headers.entries()) {
          mergedHeaders[key] = value;
        }
      } else {
        Object.assign(mergedHeaders, options.headers);
      }
    }

    const body = (options.body as Record<string, unknown>) ?? {};
    const model = body.model as string | undefined;
    if (!model) {
      throw new Error('No model selected');
    }

    // Convert UIMessage[] to backend ChatMessage[] (role + content).
    // Messages with empty text content are skipped: sending them makes
    // providers reject the whole request with 400.
    const messages = options.messages
      .map((msg: any) => {
        // Extract text content from parts or legacy content field
        let content = '';
        if (Array.isArray(msg.parts)) {
          content = msg.parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text ?? '')
            .join('');
        } else if (typeof msg.content === 'string') {
          content = msg.content;
        }
        const role = msg.role ?? 'user';
        if (role !== 'user' && role !== 'assistant') return null;
        if (!content.trim()) return null;
        return { role, content };
      })
      .filter((msg: unknown) => msg !== null);

    const response = await fetch(this.api, {
      method: 'POST',
      headers: mergedHeaders,
      body: JSON.stringify({
        model,
        messages,
        system: (body.system as string) ?? '',
        webSearch: Boolean(body.webSearch),
        language: body.language as string,
      }),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Stream request failed');
      throw new Error(text);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const messageId = crypto.randomUUID();

    return new ReadableStream({
      async start(controller) {
        let buffer = '';

        // Emit initial chunks: start-step, then text-start
        controller.enqueue({ type: 'start-step' } as UIMessageChunk);
        controller.enqueue({
          type: 'text-start',
          id: messageId,
        } as UIMessageChunk);

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;

              try {
                const data = JSON.parse(trimmed.slice(6));

                if (data.type === 'text' && data.text) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: messageId,
                    delta: data.text,
                  } as UIMessageChunk);
                } else if (data.type === 'finish') {
                  controller.enqueue({ type: 'text-end', id: messageId } as UIMessageChunk);
                  controller.enqueue({ type: 'finish-step' } as UIMessageChunk);
                  controller.enqueue({ type: 'finish', finishReason: 'stop' } as UIMessageChunk);
                  controller.close();
                  return;
                } else if (data.type === 'error') {
                  controller.enqueue({ type: 'text-end', id: messageId } as UIMessageChunk);
                  controller.enqueue({ type: 'error', errorText: data.error ?? 'Unknown error' } as UIMessageChunk);
                  controller.enqueue({ type: 'finish-step' } as UIMessageChunk);
                  controller.enqueue({ type: 'finish', finishReason: 'error' } as UIMessageChunk);
                  controller.close();
                  return;
                }
                // ignore 'start' type
              } catch {
                // skip malformed JSON lines
              }
            }
          }
        } catch (err) {
          controller.enqueue({ type: 'text-end', id: messageId } as UIMessageChunk);
          controller.enqueue({
            type: 'error',
            errorText: err instanceof Error ? err.message : 'Stream error',
          } as UIMessageChunk);
          controller.enqueue({ type: 'finish-step' } as UIMessageChunk);
          controller.enqueue({ type: 'finish', finishReason: 'error' } as UIMessageChunk);
        } finally {
          reader.releaseLock();
        }

        // If we got here without a finish/error event, close cleanly
        controller.enqueue({ type: 'text-end', id: messageId } as UIMessageChunk);
        controller.enqueue({ type: 'finish-step' } as UIMessageChunk);
        controller.enqueue({ type: 'finish', finishReason: 'stop' } as UIMessageChunk);
        controller.close();
      },
    });
  }

  async reconnectToStream(_options: {
    chatId: string;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk> | null> {
    // Keryx backend doesn't support reconnecting to active streams
    return null;
  }
}
