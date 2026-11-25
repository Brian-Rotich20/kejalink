import type { ImageType } from "../../lib/image";
import type { PropertyImage } from "../properties/property.types";

/** What clients see. cloudinary_public_id is never exposed. */
export type UploadView = PropertyImage;

export type CreateUploadInput = {
  propertyId: string;
  ownerId: string;
  buffer: Buffer;
  /** Mimetype declared by the client; must match the sniffed type. */
  declaredMimetype: string;
};

export type UpdateUploadInput = {
  isPrimary?: true | undefined;
  displayOrder?: number | undefined;
};

export type { ImageType };
