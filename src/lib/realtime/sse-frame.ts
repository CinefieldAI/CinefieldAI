import "server-only";

/**
 * SSE wire framing (Phase 11-B).
 *
 * Pure string work, no I/O, so the format is testable without a socket. The
 * protocol is unforgiving in one specific way: a payload containing a newline
 * silently becomes two fields, and a browser then receives a truncated or
 * malformed event with no error anywhere. `JSON.stringify` escapes newlines,
 * which is why every data line here is JSON and never raw text.
 */

export interface SseFrameInput {
  /** SSE `event:` — the client's `addEventListener` name. */
  event: string;
  /** Serialized as JSON onto a single `data:` line. */
  data: unknown;
  /**
   * SSE `id:`. Set to the Redis stream id, which the browser echoes back as
   * `Last-Event-ID` on reconnect.
   *
   * 11-B does not READ that header — resume is 11-C's contract, and honouring
   * it halfway would be worse than not honouring it, because a client would
   * believe it had resumed. Emitting the id now costs nothing and means 11-C
   * inherits a stream whose cursor is already on the wire.
   */
  id?: string;
}

export function encodeSseFrame({ event, data, id }: SseFrameInput): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  // The blank line terminates the frame. Without it the browser buffers
  // forever waiting for one.
  return `${lines.join("\n")}\n\n`;
}

/**
 * A comment frame. Bytes on the wire that no `onmessage` handler ever sees.
 *
 * This is the standard heartbeat: proxies and CDNs count an idle connection
 * by traffic, not by protocol, so a colon-prefixed comment keeps the socket
 * alive without inventing an application event a client would have to learn
 * to ignore.
 */
export function encodeSseComment(text: string): string {
  return `: ${text}\n\n`;
}

/**
 * The headers, in one place so the route cannot get them subtly wrong.
 *
 * `private, no-cache, no-store` is the roadmap's shared-cache rule applied to
 * the most obvious violation of it: an authenticated per-user stream is the
 * last thing that should ever sit in a CDN. `X-Accel-Buffering: no` is not
 * decoration — a buffering reverse proxy will hold an SSE response until it
 * has "enough" bytes, which for a stream that emits one small frame a minute
 * means the browser sees nothing at all.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
