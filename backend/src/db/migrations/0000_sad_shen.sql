CREATE TYPE "public"."booking_status" AS ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('PUBLISHED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('HOUSE', 'APARTMENT', 'ROOM', 'BEDSITTER', 'STUDIO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('TENANT', 'SEEKER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'BANNED');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "user_role" DEFAULT 'SEEKER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text NOT NULL,
	"property_type" "property_type" NOT NULL,
	"price_amount" numeric(12, 2) NOT NULL,
	"price_currency" char(3) DEFAULT 'KES' NOT NULL,
	"bedrooms" smallint,
	"bathrooms" smallint,
	"county" varchar(100) NOT NULL,
	"area" varchar(150) NOT NULL,
	"address_text" varchar(255),
	"amenities" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "property_status" DEFAULT 'PUBLISHED' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"rejection_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_price_positive" CHECK ("properties"."price_amount" > 0),
	CONSTRAINT "properties_bedrooms_nonneg" CHECK ("properties"."bedrooms" IS NULL OR "properties"."bedrooms" >= 0),
	CONSTRAINT "properties_bathrooms_nonneg" CHECK ("properties"."bathrooms" IS NULL OR "properties"."bathrooms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"cloudinary_public_id" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_cloudinary_public_id_unique" UNIQUE("cloudinary_public_id")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"seeker_id" text NOT NULL,
	"status" "booking_status" DEFAULT 'PENDING' NOT NULL,
	"preferred_move_in_date" date,
	"message" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_seeker_id_user_id_fk" FOREIGN KEY ("seeker_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "properties_tenant_id_idx" ON "properties" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "properties_discovery_idx" ON "properties" USING btree ("county","property_type","price_amount") WHERE "properties"."status" = 'PUBLISHED' AND "properties"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "uploads_property_id_idx" ON "uploads" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_one_primary_per_property_idx" ON "uploads" USING btree ("property_id") WHERE "uploads"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "bookings_property_id_idx" ON "bookings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "bookings_seeker_id_idx" ON "bookings" USING btree ("seeker_id");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_pending_per_seeker_property_idx" ON "bookings" USING btree ("property_id","seeker_id") WHERE "bookings"."status" = 'PENDING';