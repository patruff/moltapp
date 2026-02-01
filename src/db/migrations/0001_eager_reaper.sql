CREATE TABLE "positions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "positions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"mint_address" text NOT NULL,
	"symbol" text NOT NULL,
	"quantity" numeric(20, 9) NOT NULL,
	"average_cost_basis" numeric(20, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "positions_agent_mint_unique" UNIQUE("agent_id","mint_address")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trades_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"side" text NOT NULL,
	"stock_mint_address" text NOT NULL,
	"stock_symbol" text NOT NULL,
	"stock_quantity" numeric(20, 9) NOT NULL,
	"usdc_amount" numeric(20, 6) NOT NULL,
	"price_per_token" numeric(20, 6) NOT NULL,
	"tx_signature" text NOT NULL,
	"jupiter_route_info" jsonb,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trades_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;