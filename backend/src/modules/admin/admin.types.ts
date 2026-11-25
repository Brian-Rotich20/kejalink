import type { PropertyStatus, UserRole, UserStatus } from "../../db/schema/enums";
import type { PropertyListItem } from "../properties/property.types";

export type AdminUserView = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminUserFilters = {
  page: number;
  limit: number;
  role?: UserRole | undefined;
  status?: UserStatus | undefined;
  q?: string | undefined;
};

export type AdminPropertyView = PropertyListItem & {
  status: PropertyStatus;
  rejectionReason: string | null;
  deletedAt: Date | null;
  updatedAt: Date;
  tenant: { id: string; name: string; email: string; status: UserStatus };
};

export type AdminPropertyFilters = {
  page: number;
  limit: number;
  status?: PropertyStatus | undefined;
  tenantId?: string | undefined;
  includeDeleted: boolean;
};

/** Structured audit record written for every admin mutation. */
export type AdminAuditEntry = {
  adminId: string;
  action: string;
  targetId: string;
  reason?: string | null | undefined;
  details?: Record<string, unknown>;
};
