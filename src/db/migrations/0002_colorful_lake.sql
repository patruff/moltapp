CREATE TABLE "agent_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"symbol" text NOT NULL,
	"action" text NOT NULL,
	"quantity" numeric(20, 9) NOT NULL,
	"reasoning" text NOT NULL,
	"confidence" integer NOT NULL,
	"model_used" text NOT NULL,
	"market_snapshot" jsonb,
	"executed" text DEFAULT 'pending',
	"tx_signature" text,
	"execution_error" text,
	"round_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "copy_followers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "copy_followers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"follower_id" text NOT NULL,
	"follower_name" text NOT NULL,
	"target_agent_id" text NOT NULL,
	"initial_capital" numeric(20, 6) DEFAULT '10000' NOT NULL,
	"current_cash" numeric(20, 6) DEFAULT '10000' NOT NULL,
	"portfolio_value" numeric(20, 6) DEFAULT '10000' NOT NULL,
	"total_pnl" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_pnl_percent" numeric(10, 4) DEFAULT '0' NOT NULL,
	"trades_copied" integer DEFAULT 0 NOT NULL,
	"positions" jsonb DEFAULT '[]',
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "copy_follower_agent_unique" UNIQUE("follower_id","target_agent_id")
);
--> statement-breakpoint
CREATE TABLE "copy_trades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "copy_trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"follower_id" text NOT NULL,
	"source_agent_id" text NOT NULL,
	"source_decision_id" integer NOT NULL,
	"action" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" numeric(20, 9) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"trade_pnl" numeric(20, 6) DEFAULT '0',
	"confidence" integer NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_earnings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_earnings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"total_earnings" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tip_count" integer DEFAULT 0 NOT NULL,
	"unique_tippers" integer DEFAULT 0 NOT NULL,
	"avg_tip_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"largest_tip" numeric(20, 6) DEFAULT '0' NOT NULL,
	"last_tip_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_earnings_agent_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "agent_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"from_id" text NOT NULL,
	"from_name" text NOT NULL,
	"to_agent_id" text NOT NULL,
	"decision_id" integer,
	"amount" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"message" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"tx_signature" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_reasoning_health" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"window_size" integer DEFAULT 50,
	"avg_coherence" real,
	"avg_depth" real,
	"avg_originality" real,
	"avg_clarity" real,
	"composite_health" real,
	"integrity_score" real,
	"total_violations" integer DEFAULT 0,
	"trend" text,
	"trend_delta" real,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "benchmark_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"period" text NOT NULL,
	"pnl_percent" real,
	"sharpe_ratio" real,
	"avg_coherence" real,
	"hallucination_rate" real,
	"discipline_rate" real,
	"trade_count" integer,
	"win_rate" real,
	"confidence_calibration" real,
	"full_metrics" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "competition_scores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "competition_scores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"round_score" numeric(10, 4) NOT NULL,
	"cumulative_score" numeric(12, 4) NOT NULL,
	"rank" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "portfolio_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"round_id" text,
	"trigger" text DEFAULT 'round_end' NOT NULL,
	"cash_balance" numeric(20, 6) NOT NULL,
	"positions_value" numeric(20, 6) NOT NULL,
	"total_value" numeric(20, 6) NOT NULL,
	"total_pnl" numeric(20, 6) NOT NULL,
	"total_pnl_percent" numeric(10, 4) NOT NULL,
	"position_count" integer NOT NULL,
	"positions" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_bets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" text NOT NULL,
	"bettor_id" text NOT NULL,
	"bettor_type" text NOT NULL,
	"position" text NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"odds" numeric(10, 4) NOT NULL,
	"payout" numeric(20, 6),
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_markets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prediction_id" text NOT NULL,
	"total_pool" numeric(20, 6) DEFAULT '0' NOT NULL,
	"for_pool" numeric(20, 6) DEFAULT '0' NOT NULL,
	"against_pool" numeric(20, 6) DEFAULT '0' NOT NULL,
	"current_odds_for" numeric(10, 4) DEFAULT '1.0' NOT NULL,
	"current_odds_against" numeric(10, 4) DEFAULT '1.0' NOT NULL,
	"total_bets" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"symbol" text NOT NULL,
	"prediction_type" text NOT NULL,
	"direction" text NOT NULL,
	"target_price" numeric(20, 6),
	"current_price_at_creation" numeric(20, 6) NOT NULL,
	"time_horizon" text NOT NULL,
	"confidence" integer NOT NULL,
	"reasoning" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"resolved_at" timestamp,
	"resolution_price" numeric(20, 6),
	"resolution_details" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reasoning_forensic_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"round_id" text NOT NULL,
	"trade_action" text NOT NULL,
	"symbol" text NOT NULL,
	"sentence_count" integer,
	"avg_sentence_length" real,
	"quantitative_claim_count" integer,
	"hedge_word_count" integer,
	"causal_connector_count" integer,
	"valuation_mentioned" boolean DEFAULT false,
	"technical_mentioned" boolean DEFAULT false,
	"fundamental_mentioned" boolean DEFAULT false,
	"macro_mentioned" boolean DEFAULT false,
	"sentiment_mentioned" boolean DEFAULT false,
	"risk_mentioned" boolean DEFAULT false,
	"catalyst_mentioned" boolean DEFAULT false,
	"portfolio_context_mentioned" boolean DEFAULT false,
	"coherence_score" real,
	"depth_score" real,
	"originality_score" real,
	"clarity_score" real,
	"composite_forensic_score" real,
	"similar_to_previous" boolean DEFAULT false,
	"contradicts_previous" boolean DEFAULT false,
	"previous_trade_id" text,
	"full_analysis" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reasoning_integrity_violations" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"violation_type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"evidence" jsonb,
	"round_id" text,
	"related_trade_ids" jsonb,
	"penalty_applied" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_agent_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"backtest_results" jsonb,
	"risk_level" text NOT NULL,
	"timeframe" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_strategy_id" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"total_adopters" integer DEFAULT 0 NOT NULL,
	"avg_rating" numeric DEFAULT '0' NOT NULL,
	"total_ratings" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategy_adoptions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"adopted_at" timestamp DEFAULT now(),
	"performance_since_adoption" numeric DEFAULT '0',
	"trades_executed" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "strategy_ratings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" text NOT NULL,
	"rater_id" text NOT NULL,
	"rating" integer NOT NULL,
	"review" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "strategy_signals" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" text NOT NULL,
	"symbol" text NOT NULL,
	"signal_type" text NOT NULL,
	"direction" text NOT NULL,
	"strength" integer NOT NULL,
	"price" numeric NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trade_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"decision_id" integer NOT NULL,
	"author_id" text NOT NULL,
	"author_name" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_justifications" (
	"id" text PRIMARY KEY NOT NULL,
	"trade_id" integer,
	"agent_id" text NOT NULL,
	"reasoning" text NOT NULL,
	"confidence" real NOT NULL,
	"sources" jsonb,
	"intent" text NOT NULL,
	"predicted_outcome" text,
	"actual_outcome" text,
	"coherence_score" real,
	"hallucination_flags" jsonb,
	"action" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" real,
	"round_id" text,
	"discipline_pass" text DEFAULT 'pending',
	"timestamp" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trade_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"decision_id" integer NOT NULL,
	"reactor_id" text NOT NULL,
	"reaction" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trade_reactions_decision_reactor_unique" UNIQUE("decision_id","reactor_id")
);
--> statement-breakpoint
ALTER TABLE "agent_reasoning_health" ADD CONSTRAINT "agent_reasoning_health_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_snapshots" ADD CONSTRAINT "benchmark_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_forensic_reports" ADD CONSTRAINT "reasoning_forensic_reports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reasoning_integrity_violations" ADD CONSTRAINT "reasoning_integrity_violations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_justifications" ADD CONSTRAINT "trade_justifications_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_justifications" ADD CONSTRAINT "trade_justifications_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;