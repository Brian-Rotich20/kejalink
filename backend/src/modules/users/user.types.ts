import type { UserRole, UserStatus } from "../../db/schema/enums";

export type UserProfile = {
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

export type UpdateUserProfileInput = {
  name?: string | undefined;
  image?: string | null | undefined;
};
