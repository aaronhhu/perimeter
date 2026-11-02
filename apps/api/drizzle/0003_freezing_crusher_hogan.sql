CREATE TYPE "public"."break_kind" AS ENUM('short', 'rest_of_day');--> statement-breakpoint
CREATE TABLE "breaks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "breaks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"kind" "break_kind" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "breaks_order_check" CHECK ("breaks"."ends_at" > "breaks"."started_at"),
	CONSTRAINT "breaks_ended_check" CHECK ("breaks"."ended_at" IS NULL OR "breaks"."ended_at" >= "breaks"."started_at")
);
--> statement-breakpoint
CREATE TABLE "manual_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manual_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "manual_sessions_order_check" CHECK ("manual_sessions"."ends_at" > "manual_sessions"."started_at"),
	CONSTRAINT "manual_sessions_ended_check" CHECK ("manual_sessions"."ended_at" IS NULL OR "manual_sessions"."ended_at" >= "manual_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "schedule_blocks_weekday_check" CHECK ("schedule_blocks"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_blocks_order_check" CHECK ("schedule_blocks"."end_time" > "schedule_blocks"."start_time")
);
--> statement-breakpoint
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_sessions" ADD CONSTRAINT "manual_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "breaks_user_id_started_at_idx" ON "breaks" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "manual_sessions_user_id_started_at_idx" ON "manual_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "schedule_blocks_user_id_weekday_idx" ON "schedule_blocks" USING btree ("user_id","weekday");