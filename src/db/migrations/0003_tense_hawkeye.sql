CREATE TABLE "benchmark_leaderboard_v23" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"period" text NOT NULL,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"coherence_score" real,
	"hallucination_rate" real,
	"discipline_rate" real,
	"calibration_ece" real,
	"prediction_accuracy" real,
	"composite_score" real,
	"grade" text,
	"trade_count" integer,
	"rank" integer,
	"full_metrics" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "calibration_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"period" text NOT NULL,
	"confidence_bucket" text NOT NULL,
	"trade_count" integer NOT NULL,
	"win_rate" real,
	"avg_pnl" real,
	"ece" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outcome_resolutions" (
	"id" text PRIMARY KEY NOT NULL,
	"justification_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"entry_price" real,
	"exit_price" real,
	"horizon" text NOT NULL,
	"pnl_percent" real,
	"outcome" text NOT NULL,
	"direction_correct" boolean,
	"confidence_at_trade" real,
	"calibrated" boolean,
	"predicted_outcome" text,
	"actual_outcome_summary" text,
	"resolved_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v23" ADD CONSTRAINT "benchmark_leaderboard_v23_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_snapshots" ADD CONSTRAINT "calibration_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_resolutions" ADD CONSTRAINT "outcome_resolutions_justification_id_trade_justifications_id_fk" FOREIGN KEY ("justification_id") REFERENCES "public"."trade_justifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_resolutions" ADD CONSTRAINT "outcome_resolutions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;