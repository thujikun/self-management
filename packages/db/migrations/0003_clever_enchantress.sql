ALTER TABLE "comments" ADD COLUMN "source" text DEFAULT 'native' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "source_comment_id" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_profile_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_source_id_uq" ON "comments" USING btree ("source","source_comment_id");