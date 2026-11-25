import type { BookingStatus, UserRole } from "../../db/schema/enums";

export type BookingViewer = { id: string; role: UserRole };

export type BookingView = {
  id: string;
  status: BookingStatus;
  /** YYYY-MM-DD (Kenyan calendar date), or null. */
  preferredMoveInDate: string | null;
  message: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  property: {
    id: string;
    title: string;
    county: string;
    area: string;
    priceAmount: number;
    priceCurrency: string;
    isAvailable: boolean;
    primaryImageUrl: string | null;
  };
  seeker: { id: string; name: string; email: string; image: string | null };
  /** The tenant's email is shown to the seeker only once the booking is CONFIRMED. */
  tenant: { id: string; name: string; image: string | null; email?: string };
};

export type CreateBookingInput = {
  propertyId: string;
  preferredMoveInDate?: string | undefined;
  message?: string | undefined;
};

export type BookingListFilters = {
  page: number;
  limit: number;
  status?: BookingStatus | undefined;
};

export type AdminBookingFilters = BookingListFilters & {
  propertyId?: string | undefined;
  seekerId?: string | undefined;
};
