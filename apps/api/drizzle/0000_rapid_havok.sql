CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"notify_interval_s" integer DEFAULT 600 NOT NULL,
	"last_seen_at" timestamp with time zone
);
