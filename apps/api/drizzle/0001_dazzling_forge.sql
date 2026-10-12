CREATE TYPE "public"."presence" AS ENUM('present', 'away', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."presence_cause" AS ENUM('signal', 'dropout', 'cold_start', 'bluetooth_off');--> statement-breakpoint
CREATE TABLE "presence_events" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "presence_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"presence" "presence" NOT NULL,
	"cause" "presence_cause" NOT NULL,
	"smoothed" double precision,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presence_events" ADD CONSTRAINT "presence_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presence_events_user_id_occurred_at_idx" ON "presence_events" USING btree ("user_id","occurred_at");