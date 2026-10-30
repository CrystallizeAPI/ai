# `lib/crystallize-payments.ts`

The provider references import these helpers, and [SKILL.md](../SKILL.md) explains why they are shaped this way.
Everything goes through `@crystallize/js-api-client` (7.5 or later): `createCartManager` for the Shop API `/cart`,
`createShopOrderManager` for `/order` (`createFromCart`, `addPayments`, `setPayments`) and
`createShopCustomerManager` for `/customer`. The client fetches one Shop API token for all of them.

```ts
// lib/crystallize-payments.ts
import {
    createCartManager,
    createClient,
    createShopCustomerManager,
    createShopOrderManager,
} from "@crystallize/js-api-client";

export const api = createClient(
    {
        tenantIdentifier: process.env.CRYSTALLIZE_TENANT_IDENTIFIER!,
        accessTokenId: process.env.CRYSTALLIZE_ACCESS_TOKEN_ID!,
        accessTokenSecret: process.env.CRYSTALLIZE_ACCESS_TOKEN_SECRET!,
    },
    { shopApiToken: { scopes: ["cart", "order", "customer"] } }, // one token for every endpoint used here
);
export const carts = createCartManager(api);
export const orders = createShopOrderManager(api);
const customers = createShopCustomerManager(api);

// What a provider session needs from the placed cart. `price` is the line total, `variant.price` the unit.
// `type` tells product lines from external ones (`shipping`, `fee`, `promotion`, …).
const ADDRESS = {
    type: true,
    firstName: true,
    lastName: true,
    street: true,
    street2: true,
    streetNumber: true,
    postalCode: true,
    city: true,
    state: true,
    country: true,
    phone: true,
    email: true,
};
const CUSTOMER = {
    identifier: true,
    isGuest: true,
    type: true,
    email: true,
    firstName: true,
    lastName: true,
    phone: true,
    companyName: true,
    taxNumber: true,
    addresses: ADDRESS,
};
export const PLACED_CART = {
    total: { gross: true, net: true, taxAmount: true, currency: true },
    items: {
        lineId: true,
        type: true,
        name: true,
        quantity: true,
        variant: { sku: true, price: { gross: true, net: true, taxPercent: true } },
        price: { gross: true, net: true, taxAmount: true, taxPercent: true },
    },
    customer: CUSTOMER,
    meta: true,
};
type Address = { type: "delivery" | "billing" | "other" } & Partial<
    Record<Exclude<keyof typeof ADDRESS, "type">, string | null>
>;
type CartCustomer = {
    identifier?: string | null;
    isGuest?: boolean;
    type?: "individual" | "organization" | null;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    companyName?: string | null;
    taxNumber?: string | null;
    addresses?: Address[] | null;
};
export type PlacedCart = {
    id: string;
    total: { gross: number; net: number; taxAmount: number; currency: string };
    items: {
        lineId: string | null;
        type: "standard" | "shipping" | "fee" | "promotion" | "service" | "digital" | string | null;
        name: string;
        quantity: number;
        variant: { sku: string | null; price: { gross: number; net: number; taxPercent: number } } | null;
        price: { gross: number; net: number; taxAmount: number; taxPercent: number };
    }[];
    customer: {
        identifier?: string;
        type?: "individual" | "organization";
        email?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        companyName?: string;
        taxNumber?: string;
        addresses?: Address[];
    } | null;
    meta: Record<string, string> | null;
};

export type PaymentStatus = "paid" | "partiallyPaid" | "partiallyRefunded" | "refunded" | "unpaid";
export type Payment = {
    provider: string; // lower-case provider name: "stripe", "klarna", "two", …
    method?: string; // what the shopper used: card, vipps, invoice, bank, …
    transactionId: string; // the provider's id for this payment or refund
    amount: number; // MAJOR units, like the cart total
    createdAt?: string;
    meta?: { key: string; value: string }[];
};

/** Thrown when the provider should retry: answer 5xx. */
export class RetryLater extends Error {}

type CartState = { id: string; state: "cart" | "placed" | "ordered" | "abandoned"; customer: CartCustomer | null };
export const readCart = async (id: string) =>
    (await carts.fetch(id, { state: true, customer: CUSTOMER })) as unknown as CartState | null;

type OrderRead = {
    id: string;
    coreId: string | null;
    pipelines: { identifier: string | null; stage: string | null }[] | null;
    payments:
        | {
              provider: string;
              method: string | null;
              transactionId: string | null;
              amount: number | null;
              createdAt: string | null;
              meta: Record<string, string> | null; // written as [{ key, value }], read back as an object
          }[]
        | null;
};
const ORDER = {
    coreId: true,
    pipelines: { identifier: true, stage: true },
    payments: { provider: true, method: true, transactionId: true, amount: true, createdAt: true, meta: true },
};
/** null while the order is not readable yet: createFromCart and payment writes persist just after answering. */
export const readOrder = (id: string) => orders.fetch<OrderRead>(id, ORDER).catch(() => null);

/**
 * Every Shop write sends the order's `pipelines` to Core, and Core moves the order to match. Stage moves made in the
 * App or the Core API do not reach that list, so a payment write would undo them: copy Core's stages over first.
 */
export async function syncStages(order: OrderRead) {
    if (!order.coreId) return; // Core has not answered yet: nothing can have moved
    const { order: core } = await api.nextPimApi<{
        order: { pipelines?: { pipelineId: string; stageId: string }[] | null } | null;
    }>(`query($id: ID!) { order(id: $id) { ... on Order { pipelines { pipelineId stageId } } } }`, {
        id: order.coreId,
    });
    for (const { pipelineId, stageId } of core?.pipelines ?? []) {
        const known = (o: OrderRead | null) =>
            o?.pipelines?.some((p) => p.identifier === pipelineId && p.stage === stageId);
        if (known(order)) continue;
        await orders.addToStage(order.id, pipelineId, stageId);
        for (let i = 0; !known(await readOrder(order.id)); i++) {
            if (i === 9) throw new RetryLater(`order ${order.id} does not show stage ${stageId} yet`);
            await new Promise((r) => setTimeout(r, 300)); // addToStage persists just after answering
        }
    }
}

/** The order id is the cart id. Creates it once; a later, different payment is recorded and flagged. */
export async function createOrderOnce(
    cartId: string,
    paymentStatus: PaymentStatus,
    payment: Payment,
    pipelines?: { identifier: string; stage: string }[], // the pipeline id and the stage id, not their names
) {
    const cart = await readCart(cartId);
    if (cart?.state === "ordered") return addRecord(cartId, payment, true);
    if (cart?.state !== "placed") throw new Error(`cart ${cartId} is ${cart?.state ?? "missing"}`); // alert a human
    await ensureCustomer(cart.customer);
    const payments = [toRecord(payment)];
    await orders.createFromCart(cartId, { type: "standard", paymentStatus, payments, ...(pipelines && { pipelines }) });
}

/** What the mutations take. `gateway` keeps the name: a Core-side edit brings `provider` back as "custom". */
const toRecord = (p: Payment) => defined(withMeta(p, { gateway: p.provider }));

// `createdAt` is written as a date but read back as epoch milliseconds in a string, which the mutations refuse.
const toDate = (s: string) => new Date(/^\d+$/.test(s) ? Number(s) : s).toISOString();

const toInput = (p: NonNullable<OrderRead["payments"]>[number]): Payment => ({
    provider: p.meta?.gateway ?? p.provider,
    method: p.method ?? undefined,
    transactionId: p.transactionId ?? "",
    amount: p.amount ?? 0,
    createdAt: p.createdAt ? toDate(p.createdAt) : undefined,
    meta: Object.entries(p.meta ?? {}).map(([key, value]) => ({ key, value: String(value) })),
});

/** Refunds: append a record unless this transactionId is already on the order. */
export const recordPayment = (orderId: string, payment: Payment) => addRecord(orderId, payment, false);

async function addRecord(orderId: string, payment: Payment, isAnotherCharge: boolean) {
    const order = await readOrder(orderId);
    if (!order) throw new RetryLater(`order ${orderId} not readable yet`);
    if (order.payments?.some((p) => p.transactionId === payment.transactionId)) return; // a redelivery
    const flagged = isAnotherCharge && payment.meta?.find((m) => m.key === "type")?.value !== "refund";
    if (flagged) console.error(`[payments] second payment ${payment.transactionId} for order ${orderId}: refund it`);
    const record = flagged
        ? { ...payment, meta: [...(payment.meta ?? []), { key: "attention", value: "duplicate-payment" }] }
        : payment;
    await syncStages(order);
    await orders.addPayments(orderId, [toRecord(record)]);
}

/** Capture, cancel: change one record and write the whole list back (setPayments replaces all). */
export async function updatePayment(orderId: string, transactionId: string, change: (p: Payment) => Payment) {
    const order = await readOrder(orderId);
    if (!order?.payments) throw new RetryLater(`order ${orderId} not readable yet`);
    await syncStages(order);
    const payments = order.payments.map(toInput).map((p) => (p.transactionId === transactionId ? change(p) : p));
    await orders.setPayments(orderId, payments.map(toRecord));
}

export const withMeta = (p: Payment, values: Record<string, string>, amount = p.amount): Payment => ({
    ...p,
    amount,
    meta: [
        ...(p.meta ?? []).filter((m) => !(m.key in values)),
        ...Object.entries(values).map(([key, value]) => ({ key, value })),
    ],
});

/**
 * The Shop API rejects null where a field is optional, and the client prints `undefined` into the query, which fails
 * the whole mutation: send only what you have.
 */
export const defined = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined)) as {
        [K in keyof T]?: NonNullable<T[K]>;
    };

/** The docs' "create the customer in Crystallize if it does not exist yet". Guests are skipped. */
async function ensureCustomer(customer: CartCustomer | null) {
    if (!customer?.identifier || customer.isGuest) return;
    const exists = await customers.fetch(customer.identifier).then(
        () => true,
        () => false, // fetch rejects when the customer does not exist
    );
    if (exists) return; // never overwrite a known customer with checkout data
    const { isGuest, addresses, ...fields } = customer;
    await customers.upsert({
        ...defined(fields),
        identifier: customer.identifier,
        type: customer.type ?? (customer.companyName ? "organization" : "individual"),
        ...(addresses && { addresses: addresses.map((address) => ({ ...defined(address), type: address.type })) }),
    });
}
```
