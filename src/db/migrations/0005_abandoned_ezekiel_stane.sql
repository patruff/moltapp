CREATE TABLE "benchmark_leaderboard_v25" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"composite_score" real,
	"pnl_percent" real,
	"avg_coherence" real,
	"hallucination_free_rate" real,
	"discipline_rate" real,
	"calibration_score" real,
	"prediction_accuracy" real,
	"avg_reasoning_depth" real,
	"avg_source_quality" real,
	"outcome_prediction_score" real,
	"consensus_intelligence_score" real,
	"sharpe_ratio" real,
	"trade_count" integer,
	"rank" integer,
	"grade" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_round_snapshots_v25" (
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
	"outcome_prediction_score" real,
	"consensus_score" real,
	"round_composite" real,
	"metrics" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "consensus_intelligence_v25" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_action" text NOT NULL,
	"agent_symbol" text NOT NULL,
	"majority_action" text NOT NULL,
	"agreed_with_majority" real NOT NULL,
	"confidence_delta" real,
	"was_contrarian" real NOT NULL,
	"contrarian_success" real,
	"reasoning_similarity" real NOT NULL,
	"independent_thinking_score" real NOT NULL,
	"agent_count_in_round" integer NOT NULL,
	"consensus_breakdown" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outcome_prediction_tracking_v25" (
	"id" text PRIMARY KEY NOT NULL,
	"justification_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"predicted_direction" text NOT NULL,
	"actual_direction" text,
	"predicted_magnitude" real,
	"actual_magnitude" real,
	"timeframe_specified" text,
	"directional_accuracy" real,
	"magnitude_accuracy" real,
	"prediction_quality" real,
	"price_at_prediction" real,
	"price_at_resolution" real,
	"symbol" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "benchmark_leaderboard_v26" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"coherence_score" real,
	"hallucination_rate" real,
	"discipline_rate" real,
	"calibration_score" real,
	"reasoning_depth_score" real,
	"source_quality_score" real,
	"outcome_prediction_score" real,
	"consensus_intelligence_score" real,
	"strategy_genome_score" real,
	"risk_reward_discipline_score" real,
	"composite_score" real,
	"trade_count" integer,
	"win_rate" real,
	"grade" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_round_snapshots_v26" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"scores" jsonb,
	"composite_score" real,
	"action" text,
	"symbol" text,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_reward_discipline" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"position_size_percent" real NOT NULL,
	"confidence" real NOT NULL,
	"sizing_discipline_score" real NOT NULL,
	"implied_risk_reward" real,
	"has_risk_boundary" integer NOT NULL,
	"has_profit_target" integer NOT NULL,
	"risk_awareness_score" real NOT NULL,
	"cash_buffer_maintained" integer NOT NULL,
	"portfolio_concentration" real,
	"discipline_score" real NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategy_genome_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"style_consistency_score" real NOT NULL,
	"strategy_drift" real NOT NULL,
	"detected_strategy" text NOT NULL,
	"declared_strategy" text NOT NULL,
	"strategy_dna" jsonb,
	"historical_avg_dna" jsonb,
	"trade_window_size" integer,
	"genome_score" real NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v25" ADD CONSTRAINT "benchmark_leaderboard_v25_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_round_snapshots_v25" ADD CONSTRAINT "benchmark_round_snapshots_v25_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_intelligence_v25" ADD CONSTRAINT "consensus_intelligence_v25_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_prediction_tracking_v25" ADD CONSTRAINT "outcome_prediction_tracking_v25_justification_id_trade_justifications_id_fk" FOREIGN KEY ("justification_id") REFERENCES "public"."trade_justifications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_prediction_tracking_v25" ADD CONSTRAINT "outcome_prediction_tracking_v25_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v26" ADD CONSTRAINT "benchmark_leaderboard_v26_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_round_snapshots_v26" ADD CONSTRAINT "benchmark_round_snapshots_v26_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reward_discipline" ADD CONSTRAINT "risk_reward_discipline_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_genome_analysis" ADD CONSTRAINT "strategy_genome_analysis_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;