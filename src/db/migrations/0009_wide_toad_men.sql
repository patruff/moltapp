CREATE TABLE "v32_benchmark_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"max_drawdown" real,
	"coherence" real,
	"reasoning_depth" real,
	"source_quality" real,
	"logical_consistency" real,
	"reasoning_integrity" real,
	"reasoning_transparency" real,
	"reasoning_grounding" real,
	"hallucination_rate" real,
	"instruction_discipline" real,
	"risk_awareness" real,
	"strategy_consistency" real,
	"adaptability" real,
	"confidence_calibration" real,
	"cross_round_learning" real,
	"outcome_accuracy" real,
	"market_regime_awareness" real,
	"edge_consistency" real,
	"trade_accountability" real,
	"reasoning_quality_index" real,
	"decision_accountability" real,
	"consensus_quality" real,
	"composite_score" real,
	"tier" text,
	"trade_count" integer,
	"scored_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v32_leaderboard" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"composite_score" real NOT NULL,
	"tier" text NOT NULL,
	"trade_count" integer DEFAULT 0,
	"rounds_played" integer DEFAULT 0,
	"dimension_scores" jsonb,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v32_research_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"export_type" text NOT NULL,
	"agent_id" text,
	"round_id" text,
	"data" jsonb,
	"dimension_count" integer DEFAULT 24,
	"version" text DEFAULT '32.0',
	"exported_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v32_trade_grades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"reasoning" text NOT NULL,
	"confidence" real NOT NULL,
	"coherence_score" real,
	"hallucination_flags" jsonb,
	"discipline_passed" text DEFAULT 'true',
	"reasoning_depth_score" real,
	"source_quality_score" real,
	"logical_consistency_score" real,
	"integrity_hash" text,
	"transparency_score" real,
	"accountability_score" real,
	"grounding_score" real,
	"consensus_quality_score" real,
	"predicted_outcome" text,
	"actual_outcome" text,
	"outcome_resolved" text DEFAULT 'pending',
	"overall_grade" text NOT NULL,
	"graded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "v32_benchmark_scores" ADD CONSTRAINT "v32_benchmark_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v32_leaderboard" ADD CONSTRAINT "v32_leaderboard_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v32_trade_grades" ADD CONSTRAINT "v32_trade_grades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;