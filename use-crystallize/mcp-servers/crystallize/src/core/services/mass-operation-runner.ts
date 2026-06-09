import { Buffer } from "node:buffer";
import { createBinaryFileManager, type ClientInterface } from "@crystallize/js-api-client";
import { OperationsSchema } from "@crystallize/schema/mass-operation";
import type {
    MassOperationRunner,
    MassOperationTask,
    MassOperationTaskStatus,
} from "../../contracts/mass-operation-runner";

// nextPimApi mutations — mirrored from the Crystallize CLI's RunMassOperation
// handler. autoStart:false then an explicit start keeps the two upstream calls
// distinct, but the tool fires both in one shot (the MCP client's tool-approval
// is the gate between "validated" and "running against the tenant").
const createMassOperationBulkTask = `#graphql
    mutation REGISTER($key: String!) {
        createMassOperationBulkTask(input: { key: $key, autoStart: false }) {
            ... on BulkTaskMassOperation { id status }
            ... on BasicError { error: message }
        }
    }`;

const startMassOperationBulkTask = `#graphql
    mutation START($id: ID!) {
        startMassOperationBulkTask(id: $id) {
            ... on BulkTaskMassOperation { id status }
            ... on BasicError { error: message }
        }
    }`;

// Fields mirror the Crystallize CLI's getMassOperationBulkTask exactly —
// BulkTaskMassOperation has no `progress` field (querying it fails GraphQL
// validation), so we only read id/status/key here.
const bulkTaskStatus = `#graphql
    query STATUS($id: ID!) {
        bulkTask(id: $id) {
            ... on BulkTaskMassOperation { id type status key }
            ... on BasicError { error: message }
        }
    }`;

type TaskOrError = { id?: string; status?: string; error?: string };

export const createMassOperationRunner = (): MassOperationRunner => {
    const start = async (client: ClientInterface, operations: unknown): Promise<MassOperationTask> => {
        // The tool forwards { version, operations }, but accept a bare array too
        // so a caller that passes just the operations still validates. version
        // "1.0.0" mirrors the documented mass-operation file format.
        const file = Array.isArray(operations) ? { version: "1.0.0", operations } : operations;
        // Validate before we upload anything — same gate the CLI applies.
        const parsed = OperationsSchema.parse(file);

        const manager = createBinaryFileManager(client);
        const key = await manager.uploadToTenant({
            type: "MASS_OPERATIONS",
            filename: `mass-operation-${Date.now()}.json`,
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(parsed)),
        });

        const created = await client.nextPimApi<{ createMassOperationBulkTask: TaskOrError }>(
            createMassOperationBulkTask,
            { key },
        );
        if (created.createMassOperationBulkTask.error) {
            throw new Error(created.createMassOperationBulkTask.error);
        }
        const taskId = created.createMassOperationBulkTask.id;
        if (!taskId) {
            throw new Error("Mass operation task was created without an id.");
        }

        const started = await client.nextPimApi<{ startMassOperationBulkTask: TaskOrError }>(
            startMassOperationBulkTask,
            { id: taskId },
        );
        if (started.startMassOperationBulkTask.error) {
            throw new Error(started.startMassOperationBulkTask.error);
        }

        return {
            id: started.startMassOperationBulkTask.id ?? taskId,
            status: started.startMassOperationBulkTask.status ?? "unknown",
        };
    };

    const status = async (client: ClientInterface, taskId: string): Promise<MassOperationTaskStatus> => {
        const result = await client.nextPimApi<{ bulkTask: TaskOrError }>(bulkTaskStatus, { id: taskId });
        if (result.bulkTask.error) {
            throw new Error(result.bulkTask.error);
        }
        return {
            id: result.bulkTask.id ?? taskId,
            status: result.bulkTask.status ?? "unknown",
        };
    };

    return { start, status };
};
