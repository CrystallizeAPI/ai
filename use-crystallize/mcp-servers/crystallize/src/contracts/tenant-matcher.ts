import { AuthContext } from "./app-context";

export type TenantMatcher = (
    tenants: AuthContext["tenants"],
    args: { id?: string; identifier?: string },
) => AuthContext["tenants"][number];
