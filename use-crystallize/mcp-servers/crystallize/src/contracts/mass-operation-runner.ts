import type { ClientInterface } from "@crystallize/js-api-client";

export type MassOperationTask = {
    id: string;
    status: string;
};

// BulkTaskMassOperation exposes no progress metric — status is the only signal.
export type MassOperationTaskStatus = {
    id: string;
    status: string;
};

// The tool builds the per-tenant client (tenantMatcher + createClient + the
// resolved credentials) and passes it in, so the runner stays a pure DI
// singleton with no per-request state of its own.
export type MassOperationRunner = {
    start: (client: ClientInterface, operations: unknown) => Promise<MassOperationTask>;
    status: (client: ClientInterface, taskId: string) => Promise<MassOperationTaskStatus>;
};
