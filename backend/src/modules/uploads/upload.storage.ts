import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "../../config/env";

export type StoredImage = { publicId: string; url: string };

/** The only seam between the app and the image host. Tests inject a fake. */
export interface ImageStorage {
  upload(buffer: Buffer, options: { folder: string }): Promise<StoredImage>;
  delete(publicId: string): Promise<void>;
}

export const propertyImageFolder = (propertyId: string) => `kejalink/properties/${propertyId}`;

class CloudinaryImageStorage implements ImageStorage {
  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  upload(buffer: Buffer, { folder }: { folder: string }): Promise<StoredImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          // Cloudinary picks a random public_id; never derive it from the client's filename.
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        },
        (error, result?: UploadApiResponse) => {
          if (error || !result) return reject(error ?? new Error("Cloudinary returned no result"));
          resolve({ publicId: result.public_id, url: result.secure_url });
        },
      );
      stream.end(buffer);
    });
  }

  async delete(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
  }
}

let storage: ImageStorage | null = null;

export const getImageStorage = (): ImageStorage => (storage ??= new CloudinaryImageStorage());

/** Test hook: replace the image host. */
export const setImageStorage = (next: ImageStorage | null): void => {
  storage = next;
};
