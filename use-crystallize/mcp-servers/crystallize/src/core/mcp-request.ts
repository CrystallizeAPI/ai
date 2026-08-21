/**
 * An `initialize` body is a few hundred bytes; a tool call carrying a GraphQL
 * query can be tens of kilobytes. Only peek at the small ones so the handshake
 * check never buffers a large payload just to discard it.
 */
const MAX_PEEKED_BODY_BYTES = 8_192;

/**
 * True when this request is the JSON-RPC `initialize` handshake.
 *
 * Read off a **clone**, so the original body still reaches the MCP handler
 * untouched — the caller passes `c.req.raw` onward afterwards.
 *
 * `notifications/initialized` would be the tidier hook and the SDK even exposes
 * an `oninitialized` callback for it, but it arrives as a separate request that
 * some clients never send. The handshake itself is the reliable signal.
 *
 * Every failure path returns `false`: a missed session event is a rounding error,
 * a broken MCP request is an outage.
 */
export const isInitializeRequest = async (request: Request): Promise<boolean> => {
    if (request.method !== "POST") {
        return false;
    }
    // Absent Content-Length (a streamed body) also lands here: without a declared
    // size there is no way to know it is safe to buffer, so skip it.
    const declaredLength = Number(request.headers.get("Content-Length") ?? NaN);
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_PEEKED_BODY_BYTES) {
        return false;
    }
    try {
        const body = (await request.clone().json()) as unknown;
        return typeof body === "object" && body !== null && (body as { method?: unknown }).method === "initialize";
    } catch {
        return false;
    }
};
