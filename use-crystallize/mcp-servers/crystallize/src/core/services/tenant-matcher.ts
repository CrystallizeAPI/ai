import { AuthContext } from "../../contracts/app-context";
import { TenantMatcher } from "../../contracts/tenant-matcher";

type Args = {
    id?: string;
    identifier?: string;
};
export const createTenantMatcher =
    (): TenantMatcher =>
    (tenants: AuthContext["tenants"], { id, identifier }: Args) => {
        if (!id && !identifier) {
            throw new Error("Either id or identifier must be provided");
        }
        const found = tenants.find((tenant) => {
            if (id) {
                return tenant.id === id;
            }
            if (identifier) {
                return tenant.identifier === identifier;
            }
            return null;
        });
        if (!found) {
            throw new Error("Tenant not found");
        }
        return found;
    };
