CREATE TABLE "v29_benchmark_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"reasoning_coherence" real,
	"hallucination_rate" real,
	"instruction_discipline" real,
	"confidence_calibration" real,
	"reasoning_depth" real,
	"source_diversity" real,
	"strategy_consistency" real,
	"adaptability" real,
	"risk_awareness" real,
	"outcome_accuracy" real,
	"execution_quality" real,
	"cross_round_learning" real,
	"trade_accountability" real,
	"reasoning_quality_index" real,
	"market_regime_awareness" real,
	"edge_consistency" real,
	"composite_score" real,
	"tier" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v29_leaderboard" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"total_rounds" integer,
	"avg_composite" real,
	"best_composite" real,
	"avg_coherence" real,
	"avg_depth" real,
	"avg_calibration" real,
	"tier" text,
	"rank" integer,
	"total_trade_grades" integer,
	"grade_distribution" jsonb,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "v29_research_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"format" text NOT NULL,
	"record_count" integer,
	"exported_at" timestamp DEFAULT now(),
	"checksum" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "v29_trade_grades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trade_id" integer,
	"round_id" text,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"coherence_score" real,
	"hallucination_severity" real,
	"discipline_passed" text,
	"reasoning_depth" real,
	"source_diversity" real,
	"risk_awareness" real,
	"overall_grade" text,
	"letter_score" real,
	"flags" jsonb,
	"reasoning" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "v29_benchmark_scores" ADD CONSTRAINT "v29_benchmark_scores_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v29_leaderboard" ADD CONSTRAINT "v29_leaderboard_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v29_trade_grades" ADD CONSTRAINT "v29_trade_grades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "v29_trade_grades" ADD CONSTRAINT "v29_trade_grades_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;