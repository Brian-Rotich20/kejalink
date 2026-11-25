import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { user } from "../../db/schema";
import { userRoleSchema, userStatusSchema } from "../../db/schema/enums";
import { NotFoundError } from "../../lib/errors";
import type { UpdateUserProfileInput, UserProfile } from "./user.types";

/** Explicit columns: never return select * to clients. */
const profileColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image,
  role: user.role,
  status: user.status,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
};

type ProfileRow = Omit<UserProfile, "role" | "status"> & { role: string; status: string };

const toProfile = (row: ProfileRow): UserProfile => ({
  ...row,
  role: userRoleSchema.parse(row.role),
  status: userStatusSchema.parse(row.status),
});

export async function getUserProfile(id: string): Promise<UserProfile> {
  const [row] = await db.select(profileColumns).from(user).where(eq(user.id, id)).limit(1);
  if (!row) throw new NotFoundError("User not found", "USER_NOT_FOUND");
  return toProfile(row);
}

export async function updateUserProfile(
  id: string,
  input: UpdateUserProfileInput,
): Promise<UserProfile> {
  const changes: { name?: string; image?: string | null } = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.image !== undefined) changes.image = input.image;

  // Empty body is a no-op: return the current profile.
  if (Object.keys(changes).length === 0) return getUserProfile(id);

  const [row] = await db
    .update(user)
    .set(changes)
    .where(eq(user.id, id))
    .returning(profileColumns);
  if (!row) throw new NotFoundError("User not found", "USER_NOT_FOUND");
  return toProfile(row);
}
