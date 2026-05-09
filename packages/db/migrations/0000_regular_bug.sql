CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_slug" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_email" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "likes" (
	"post_slug" text NOT NULL,
	"identifier" text NOT NULL,
	"kind" text DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "likes_post_slug_identifier_kind_pk" PRIMARY KEY("post_slug","identifier","kind")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"slug" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_counts" (
	"post_slug" text PRIMARY KEY NOT NULL,
	"count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_slug_posts_slug_fk" FOREIGN KEY ("post_slug") REFERENCES "public"."posts"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "likes" ADD CONSTRAINT "likes_post_slug_posts_slug_fk" FOREIGN KEY ("post_slug") REFERENCES "public"."posts"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_counts" ADD CONSTRAINT "view_counts_post_slug_posts_slug_fk" FOREIGN KEY ("post_slug") REFERENCES "public"."posts"("slug") ON DELETE cascade ON UPDATE no action;