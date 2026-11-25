import type { UserRole, UserStatus } from "../../db/schema/enums";

export type { UserRole, UserStatus };

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: UserRole;
  status: UserStatus;
};
