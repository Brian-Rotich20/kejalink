import type { PropertyStatus, PropertyType, UserRole } from "../../db/schema/enums";

/** Who is looking. `null` = anonymous (or a suspended user browsing publicly). */
export type Viewer = { id: string; role: UserRole } | null;

export type PropertyListItem = {
  id: string;
  tenantId: string;
  title: string;
  propertyType: PropertyType;
  priceAmount: number;
  priceCurrency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  county: string;
  area: string;
  isAvailable: boolean;
  primaryImageUrl: string | null;
  createdAt: Date;
};

export type OwnerPropertyListItem = PropertyListItem & {
  status: PropertyStatus;
  rejectionReason: string | null;
  updatedAt: Date;
};

export type PropertyImage = {
  id: string;
  url: string;
  isPrimary: boolean;
  displayOrder: number;
  createdAt: Date;
};

export type PropertyDetail = {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  propertyType: PropertyType;
  priceAmount: number;
  priceCurrency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  county: string;
  area: string;
  addressText: string | null;
  amenities: string[];
  status: PropertyStatus;
  isAvailable: boolean;
  /** Owner and admin only. */
  rejectionReason?: string | null;
  /** Admin only. */
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenant: { id: string; name: string; image: string | null };
  uploads: PropertyImage[];
};

export type PropertySort = "newest" | "price_asc" | "price_desc";

export type PropertyFilters = {
  page: number;
  limit: number;
  q?: string | undefined;
  county?: string | undefined;
  area?: string | undefined;
  propertyType?: PropertyType | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  bedrooms?: number | undefined;
  available?: boolean | undefined;
  sort: PropertySort;
};

export type CreatePropertyInput = {
  title: string;
  description: string;
  propertyType: PropertyType;
  priceAmount: number;
  bedrooms?: number | undefined;
  bathrooms?: number | undefined;
  county: string;
  area: string;
  addressText?: string | undefined;
  amenities?: string[] | undefined;
};

export type UpdatePropertyInput = {
  title?: string | undefined;
  description?: string | undefined;
  propertyType?: PropertyType | undefined;
  priceAmount?: number | undefined;
  bedrooms?: number | null | undefined;
  bathrooms?: number | null | undefined;
  county?: string | undefined;
  area?: string | undefined;
  addressText?: string | null | undefined;
  amenities?: string[] | undefined;
  isAvailable?: boolean | undefined;
};
