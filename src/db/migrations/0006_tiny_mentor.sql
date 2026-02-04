CREATE TABLE "benchmark_leaderboard_v27" (
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
	"execution_quality_score" real,
	"cross_round_learning_score" real,
	"composite_score" real,
	"trade_count" integer,
	"win_rate" real,
	"grade" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_round_snapshots_v27" (
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
CREATE TABLE "cross_round_learning" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"referenced_past_trades" integer NOT NULL,
	"lesson_application" real NOT NULL,
	"mistake_repetition" real NOT NULL,
	"strategy_adaptation" real NOT NULL,
	"outcome_integration" real NOT NULL,
	"reasoning_evolution" real NOT NULL,
	"learning_score" real NOT NULL,
	"previous_round_ids" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "execution_quality_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"slippage_awareness" real NOT NULL,
	"price_realism" real NOT NULL,
	"timing_rationale" real NOT NULL,
	"execution_plan_quality" real NOT NULL,
	"actual_vs_expected_price" real,
	"market_impact_awareness" real NOT NULL,
	"execution_quality_score" real NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_leaderboard_v28" (
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
	"execution_quality_score" real,
	"cross_round_learning_score" real,
	"trade_accountability_score" real,
	"reasoning_quality_index_score" real,
	"composite_score" real,
	"trade_count" integer,
	"win_rate" real,
	"grade" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_round_snapshots_v28" (
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
CREATE TABLE "reasoning_quality_index" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"logical_chain_length" real NOT NULL,
	"evidence_density" real NOT NULL,
	"counter_argument_quality" real NOT NULL,
	"conclusion_clarity" real NOT NULL,
	"quantitative_rigor" real NOT NULL,
	"conditional_reasoning" real NOT NULL,
	"rqi_score" real NOT NULL,
	"structure_breakdown" jsonb,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_accountability_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"loss_acknowledgment" real NOT NULL,
	"blame_avoidance" real NOT NULL,
	"error_specificity" real NOT NULL,
	"corrective_action" real NOT NULL,
	"self_report_accuracy" real NOT NULL,
	"intellectual_humility" real NOT NULL,
	"accountability_score" real NOT NULL,
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v27" ADD CONSTRAINT "benchmark_leaderboard_v27_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_round_snapshots_v27" ADD CONSTRAINT "benchmark_round_snapshots_v27_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_round_learning" ADD CONSTRAINT "cross_round_learning_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_quality_analysis" ADD CONSTRAINT "execution_quality_analysis_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_leaderboard_v28" ADD CONSTRAINT "benchmark_leaderboard_v28_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_round_snapshots_v28" ADD CONSTRAINT "benchmark_round_snapshots_v28_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_quality_index" ADD CONSTRAINT "reasoning_quality_index_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_accountability_analysis" ADD CONSTRAINT "trade_accountability_analysis_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;