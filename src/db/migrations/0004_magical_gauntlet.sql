CREATE TABLE "benchmark_leaderboard_v24" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"composite_score" real,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"avg_coherence" real,
	"hallucination_free_rate" real,
	"discipline_rate" real,
	"calibration_score" real,
	"prediction_accuracy" real,
	"avg_reasoning_depth" real,
	"avg_source_quality" real,
	"trade_count" integer,
	"rank" integer,
	"grade" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_round_snapshots_v24" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"action" text NOT NULL,
	"symbol" text NOT NULL,
	"coherence_score" real,
	"depth_score" real,
	"source_quality_score" real,
	"hallucination_count" integer,
	"confidence" real,
	"round_composite" real,
	"metrics" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reasoning_depth_analysis_v24" (
	"id" text PRIMARY KEY NOT NULL,
	"justification_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"depth_score" real NOT NULL,
	"step_count" integer NOT NULL,
	"connective_density" real NOT NULL,
	"evidence_anchoring_score" real NOT NULL,
	"counter_argument_score" real NOT NULL,
	"conclusion_clarity" real NOT NULL,
	"word_count" integer NOT NULL,
	"vocabulary_richness" real NOT NULL,
	"reasoning_pattern" text NOT NULL,
	"analyzed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "source_quality_analysis_v24" (
	"id" text PRIMARY KEY NOT NULL,
	"justification_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"quality_score" real NOT NULL,
	"source_count" integer NOT NULL,
	"diversity_score" real NOT NULL,
	"specificity_score" real NOT NULL,
	"cross_reference_score" real NOT NULL,
	"integration_score" real NOT NULL,
	"source_categories" jsonb,
	"analyzed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v24" ADD CONSTRAINT "benchmark_leaderboard_v24_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_round_snapshots_v24" ADD CONSTRAINT "benchmark_round_snapshots_v24_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_depth_analysis_v24" ADD CONSTRAINT "reasoning_depth_analysis_v24_justification_id_trade_justifications_id_fk" FOREIGN KEY ("justification_id") REFERENCES "public"."trade_justifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_depth_analysis_v24" ADD CONSTRAINT "reasoning_depth_analysis_v24_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_quality_analysis_v24" ADD CONSTRAINT "source_quality_analysis_v24_justification_id_trade_justifications_id_fk" FOREIGN KEY ("justification_id") REFERENCES "public"."trade_justifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_quality_analysis_v24" ADD CONSTRAINT "source_quality_analysis_v24_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;