import { and, asc, count, eq, max } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/client";
import { uploads } from "../../db/schema";
import {
  BadGatewayError,
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
} from "../../lib/errors";
import { sniffImageType } from "../../lib/image";
import { logger } from "../../lib/logger";
import { assertOwnsLiveProperty, lockOwnedProperty } from "../properties/property.service";
import { MAX_DISPLAY_ORDER, MAX_IMAGE_BYTES, MAX_UPLOADS_PER_PROPERTY } from "./upload.schema";
import { getImageStorage, propertyImageFolder } from "./upload.storage";
import type { CreateUploadInput, UpdateUploadInput, UploadView } from "./upload.types";

const log = logger.child({ module: "uploads" });

const viewColumns = {
  id: uploads.id,
  url: uploads.url,
  isPrimary: uploads.isPrimary,
  displayOrder: uploads.displayOrder,
  createdAt: uploads.createdAt,
};

const uploadNotFound = () => new NotFoundError("Image not found", "UPLOAD_NOT_FOUND");
const uploadLimitReached = () =>
  new ConflictError(`A property can have at most ${MAX_UPLOADS_PER_PROPERTY} images`, "UPLOAD_LIMIT_REACHED");

async function countUploads(conn: DbOrTx, propertyId: string) {
  const [row] = await conn
    .select({ total: count(), maxOrder: max(uploads.displayOrder) })
    .from(uploads)
    .where(eq(uploads.propertyId, propertyId));
  return { total: row?.total ?? 0, maxOrder: row?.maxOrder ?? 0 };
}

/** Best effort: a failed remote delete leaves an orphan in Cloudinary, which is logged. */
async function deleteRemoteImage(publicId: string): Promise<void> {
  try {
    await getImageStorage().delete(publicId);
  } catch (err) {
    log.warn({ err, publicId }, "Failed to delete image from storage; orphaned asset");
  }
}

/**
 * Cheap checks before the request body is read: the property is live and owned
 * by the caller, and it is not already at the image limit.
 */
export async function assertCanUpload(propertyId: string, ownerId: string): Promise<void> {
  await assertOwnsLiveProperty(propertyId, ownerId);
  const { total } = await countUploads(db, propertyId);
  if (total >= MAX_UPLOADS_PER_PROPERTY) throw uploadLimitReached();
}

export async function createUpload(input: CreateUploadInput): Promise<UploadView> {
  if (input.buffer.length > MAX_IMAGE_BYTES) throw new PayloadTooLargeError("Image must be 5 MB or smaller");

  const detected = sniffImageType(input.buffer);
  if (!detected || detected !== input.declaredMimetype) {
    throw new UnsupportedMediaTypeError(
      "Only JPEG, PNG and WebP images are accepted, and the declared type must match the file",
    );
  }

  let stored;
  try {
    stored = await getImageStorage().upload(input.buffer, { folder: propertyImageFolder(input.propertyId) });
  } catch (err) {
    throw new BadGatewayError("Image upload failed, please try again", "UPLOAD_FAILED", err);
  }

  try {
    return await db.transaction(async (tx) => {
      // Serialises concurrent uploads for the same property.
      await lockOwnedProperty(tx, input.propertyId, input.ownerId);
      const { total, maxOrder } = await countUploads(tx, input.propertyId);
      if (total >= MAX_UPLOADS_PER_PROPERTY) throw uploadLimitReached();

      const [row] = await tx
        .insert(uploads)
        .values({
          propertyId: input.propertyId,
          cloudinaryPublicId: stored.publicId,
          url: stored.url,
          isPrimary: total === 0,
          displayOrder: Math.min(maxOrder + 1, MAX_DISPLAY_ORDER),
        })
        .returning(viewColumns);
      return row!;
    });
  } catch (err) {
    await deleteRemoteImage(stored.publicId);
    throw err;
  }
}

export async function updateUpload(
  propertyId: string,
  uploadId: string,
  ownerId: string,
  input: UpdateUploadInput,
): Promise<UploadView> {
  return db.transaction(async (tx) => {
    await lockOwnedProperty(tx, propertyId, ownerId);
    const [current] = await tx
      .select(viewColumns)
      .from(uploads)
      .where(and(eq(uploads.id, uploadId), eq(uploads.propertyId, propertyId)));
    if (!current) throw uploadNotFound();

    const changes: { isPrimary?: boolean; displayOrder?: number } = {};
    if (input.isPrimary && !current.isPrimary) {
      // Clear the old primary first: the partial unique index allows only one.
      await tx
        .update(uploads)
        .set({ isPrimary: false })
        .where(and(eq(uploads.propertyId, propertyId), eq(uploads.isPrimary, true)));
      changes.isPrimary = true;
    }
    if (input.displayOrder !== undefined) changes.displayOrder = input.displayOrder;
    if (Object.keys(changes).length === 0) return current;

    const [row] = await tx.update(uploads).set(changes).where(eq(uploads.id, uploadId)).returning(viewColumns);
    return row!;
  });
}

export async function deleteUpload(propertyId: string, uploadId: string, ownerId: string): Promise<{ id: string }> {
  const publicId = await db.transaction(async (tx) => {
    await lockOwnedProperty(tx, propertyId, ownerId);
    const [current] = await tx
      .select({ isPrimary: uploads.isPrimary, publicId: uploads.cloudinaryPublicId })
      .from(uploads)
      .where(and(eq(uploads.id, uploadId), eq(uploads.propertyId, propertyId)));
    if (!current) throw uploadNotFound();

    await tx.delete(uploads).where(eq(uploads.id, uploadId));

    if (current.isPrimary) {
      const [next] = await tx
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.propertyId, propertyId))
        .orderBy(asc(uploads.displayOrder), asc(uploads.createdAt), asc(uploads.id))
        .limit(1);
      if (next) await tx.update(uploads).set({ isPrimary: true }).where(eq(uploads.id, next.id));
    }
    return current.publicId;
  });

  // After commit: a storage failure must not resurrect the row.
  await deleteRemoteImage(publicId);
  return { id: uploadId };
}
