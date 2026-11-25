import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { user } from "../../db/schema";
import { NotFoundError } from "../../lib/errors";
import type { UserProfile, UpdateUserProfileInput  } from "./user.types";

export async function getUserProfile(id: string) {
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);

  if (!row) {
    throw new NotFoundError("User not found");
  }

  return row;
}

export async function updateUserProfile(id: string, input: UpdateUserProfileInput) {
  const [row] = await db.update(user).set(input).where(eq(user.id, id)).returning();

  if (!row) {
    throw new NotFoundError("User not found");
  }

  return row;
}