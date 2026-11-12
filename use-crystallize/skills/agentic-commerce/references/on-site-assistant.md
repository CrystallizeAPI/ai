# An on-site shopping assistant

A chat drawer in the store, answered by a streaming model loop over the store's own tools: Discovery for the
catalogue and ranking, the Shop API for the basket and order history. Results render as the store's own product
cards, ranked by the shopper's taste. Code is trimmed from a working store (`app/api/assistant/route.ts`,
`lib/assistant/*`), on the Anthropic TypeScript SDK.

## The route

`POST /api/assistant` takes the page's language and the conversation as plain text, and answers NDJSON: text
deltas, tool status, product rails and basket updates, then `done`.

```ts
export const maxDuration = 60;

// A small, fast model by default; override with an environment variable to trade speed for depth.
const MODEL = process.env.ASSISTANT_MODEL || "claude-haiku-5-5";
/** Tool rounds per reply; the last one runs without tools so the model always closes with words. */
const MAX_ITERATIONS = 5;

const Body = z.object({
    lang: z.enum(LANGS),
    messages: z
        .array(
            z.object({
                role: z.enum(["user", "assistant"]),
                content: z.string().max(4000),
                shown: z
                    .array(z.object({ sku: z.string(), name: z.string() }))
                    .max(60)
                    .optional(),
            }),
        )
        .min(1)
        .max(60),
});

export type AssistantEvent =
    | { type: "text"; delta: string }
    | { type: "tool"; name: string; status: "start" | "done" | "error" }
    | ProductsEvent // a rail of cards
    | CartEvent // the basket changed
    | { type: "error"; code: "config" | "busy" | "network" | "api" | "internal" | "long" }
    | { type: "done" };

export async function POST(req: Request) {
    const body = Body.parse(await req.json());
    const ctx = await assistantContext(body.lang); // session, taste, VAT mode, basket, orders, from cookies
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const emit = (e: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
            try {
                await converse(ctx, toMessageParams(body.messages), emit, req.signal);
            } catch (error) {
                emit({ type: "error", code: errorCode(error) });
            } finally {
                emit({ type: "done" });
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    });
}
```

**The drawer keeps text only.** Products it showed ride along with each assistant turn as a note ("Shown to the
shopper as cards: Name [SKU]; …"), so "add the second one" still resolves without sending tool results back.
Merge two turns of the same role in a row (an answer that failed half-way), and drop leading assistant turns.

## The loop

```ts
async function converse(
    ctx: AssistantContext,
    messages: Anthropic.MessageParam[],
    emit: (e: AssistantEvent) => void,
    signal: AbortSignal,
) {
    const client = new Anthropic();
    const system = await systemPrompt(ctx);
    let retries = 0;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const finalRound = iteration === MAX_ITERATIONS - 1;
        const stream = client.messages.stream(
            {
                model: MODEL,
                max_tokens: 4000,
                system,
                tools: TOOLS,
                ...(finalRound ? { tool_choice: { type: "none" as const } } : {}), // end in words, not a rail
                messages,
                output_config: { effort: "low" }, // the tools do the thinking; keep the chat snappy
            },
            { signal },
        );
        stream.on("text", (delta) => emit({ type: "text", delta }));

        let message: Anthropic.Message;
        try {
            message = await stream.finalMessage();
            retries = 0;
        } catch (error) {
            // With eager input streaming, a tool input that can't be parsed rejects here: re-issue the turn.
            const unparseable = error instanceof SyntaxError || (error instanceof Error && /JSON/i.test(error.message));
            if (!unparseable || error instanceof Anthropic.APIError || signal.aborted || retries++ >= 2) throw error;
            continue;
        }

        if (message.stop_reason === "refusal") return;
        const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (!uses.length) return;
        messages.push({ role: "assistant", content: message.content });

        // Tools in one turn run together; writes (add to basket) run after the reads.
        const reads = uses.filter((u) => u.name !== "add_to_basket");
        const writes = uses.filter((u) => u.name === "add_to_basket");
        const outcomes = new Map(
            await Promise.all(reads.map(async (u) => [u.id, await runTool(ctx, u.name, u.input)] as const)),
        );
        for (const u of writes) outcomes.set(u.id, await runTool(ctx, u.name, u.input));

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of uses) {
            const outcome = outcomes.get(use.id)!;
            for (const r of outcome.rails ?? []) if (r.items.length) emit(r); // cards go to the UI, not the model
            if (outcome.cart) emit(outcome.cart);
            results.push({
                type: "tool_result",
                tool_use_id: use.id,
                content: outcome.text,
                ...(outcome.isError ? { is_error: true } : {}),
            });
        }
        messages.push({ role: "user", content: results });
    }
}
```

Map SDK errors to codes the drawer can explain: authentication → `config`, rate limit → `busy`, connection →
`network`, other API errors → `api`.

## The system prompt: three blocks

```ts
export async function systemPrompt(ctx: AssistantContext): Promise<Anthropic.TextBlockParam[]> {
    const tax = await taxonomy("en"); // keys are the same in every language: one cache entry
    return [
        { type: "text", text: RULES }, // never changes
        {
            type: "text",
            text: `Taxonomy (dimension: id (English label)).\n${taxonomyForPrompt(tax)}`,
            cache_control: { type: "ephemeral" },
        },
        { type: "text", text: shopperBlock(ctx) }, // who is asking, in which language, basket, taste: last
    ];
}
```

The rules and the taxonomy are cached (the breakpoint after the taxonomy); the shopper block changes per request
and goes last. Rules that worked:

- **Be terse.** At most one short sentence before a tool. After the cards, at most about 40 words: the pick and
  why, naming at most one product. The cards show name, price, specs and stock; never repeat them.
- **Show products with tools, never in prose.** One tool call usually answers; two or three rails at most. Run
  related searches in parallel.
- **Ask at most one clarifying question**, only when you can't sensibly search without it. Otherwise assume, say
  so in a clause, and search.
- **Prices, specs and SKUs only from tool results.** Never invent products or compatibility.
- **Add to the basket only when the shopper clearly asks**, in the variant they asked for.
- **On a tool error, don't retry in the same reply**; say so in one sentence.
- **Answer in the shopper's language**, with the trade's own terms.
- Plain sentences; no lists, headings, tables or links.

The shopper block: language, market, currency and VAT mode; the signed-in shopper, company and price lists; their
taste in words; recent orders; the basket. When the customer layer can't be read, say so and answer as for a
guest rather than failing the chat.

## The tools

The assistant's tools wrap the same functions as the MCP server and the server actions: `search_products`,
`similar_products`, `product_details`, `add_to_basket` (the cookie basket), plus taste tools a store can only offer
on-site: search with a composed taste vector ("shop as another trade"), "complete my kit" from what the shopper
owns, explain my profile. Results come back as text for the model and as rails of cards for the UI.

## Lessons from other builds

- **Small models show text written before a tool call** (a larger one hid it), and sometimes write the answer both
  before and after the tools: dedupe in the UI. Ordering "answer text, then a closing visual tool" saves a step.
- **Cache the whole conversation, not only the system prompt, on every step, and use low effort.** One build went
  from 13.6 s to about 9 s per answer, and first text from about 11 s to 4–6 s.
- **Grounding that is too strict makes the model refuse.** Forbid unsourced numbers and claims; allow it to
  explain documented principles.
- **SDK history traps.** With the AI SDK (v7), `agent.generate().response.messages` holds only the last step: use
  `result.responseMessages`, or earlier tool calls silently drop out of multi-turn history. With extended
  thinking, thinking blocks are bound to the conversation: don't trim history, keep it append-only.
- **Live regions**: the conversation is `role="log"`, but don't announce it token by token; debounce, and show
  "thinking" as `role="status"` text ([[storefront]] accessibility).
- **Render model output as elements**, never `innerHTML`. Keep conversations in `sessionStorage`.
