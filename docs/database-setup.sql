-- =====================================================
-- PULODOGATO INVESTMENTS - DATABASE SETUP SCRIPT
-- =====================================================
-- Version: 1.0
-- Date: 2025-09-23
-- Description: Complete database schema for investment tracking app
-- 
-- Instructions:
-- 1. Run this script in Supabase SQL Editor
-- 2. Execute sections in order
-- 3. Verify each section before proceeding
-- =====================================================

-- =====================================================
-- SECTION 1: ENABLE EXTENSIONS
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- SECTION 2: CUSTOM TYPES
-- =====================================================

-- Transaction types enum
CREATE TYPE transaction_type AS ENUM (
    'BUY',          -- Compra
    'SELL',         -- Venda  
    'DIVIDEND',     -- Dividendo
    'JCP',          -- Juros sobre Capital Próprio
    'BONUS',        -- Bonificação
    'SPLIT',        -- Desdobramento
    'GROUPING'      -- Agrupamento
);

-- Asset category types
CREATE TYPE asset_category_type AS ENUM (
    'STOCK',        -- Ações
    'FII',          -- Fundos Imobiliários
    'ETF',          -- Exchange Traded Funds
    'FIXED_INCOME', -- Renda Fixa
    'CRYPTO',       -- Criptomoedas
    'INTERNATIONAL' -- Internacional
);

-- Currency types
CREATE TYPE currency_type AS ENUM (
    'BRL',          -- Real Brasileiro
    'USD',          -- Dólar Americano
    'EUR'           -- Euro
);

-- Dividend status
CREATE TYPE dividend_status AS ENUM (
    'ANNOUNCED',    -- Anunciado
    'EX_DATE',      -- Ex-dividendo
    'PAID',         -- Pago
    'CANCELLED'     -- Cancelado
);

-- =====================================================
-- SECTION 3: USER PROFILES TABLE
-- =====================================================

-- User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT,
    avatar_url TEXT,
    birth_date DATE,
    tax_id TEXT, -- CPF/CNPJ (encrypted)
    preferences JSONB DEFAULT '{
        "currency": "BRL",
        "timezone": "America/Sao_Paulo",
        "language": "pt-BR",
        "notifications": {
            "dividends": true,
            "price_alerts": false,
            "portfolio_summary": true,
            "email_reports": false
        },
        "dashboard": {
            "default_period": "1Y",
            "show_percentage": true,
            "chart_type": "line",
            "theme": "light"
        },
        "privacy": {
            "public_profile": false,
            "share_portfolio": false
        }
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at 
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SECTION 4: ASSET CATEGORIES TABLE
-- =====================================================

CREATE TABLE asset_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name asset_category_type NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    color_hex TEXT NOT NULL DEFAULT '#3B82F6',
    icon_name TEXT DEFAULT 'TrendingUp',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default categories
INSERT INTO asset_categories (name, display_name, description, color_hex, icon_name, sort_order) VALUES
('STOCK', 'Ações', 'Ações de empresas listadas na bolsa', '#10B981', 'TrendingUp', 1),
('FII', 'Fundos Imobiliários', 'Fundos de Investimento Imobiliário', '#F59E0B', 'Building', 2),
('ETF', 'ETFs', 'Exchange Traded Funds', '#8B5CF6', 'BarChart3', 3),
('FIXED_INCOME', 'Renda Fixa', 'Títulos de renda fixa', '#06B6D4', 'Shield', 4),
('CRYPTO', 'Criptomoedas', 'Criptoativos e moedas digitais', '#F97316', 'Coins', 5),
('INTERNATIONAL', 'Internacional', 'Ativos internacionais', '#EF4444', 'Globe', 6);

CREATE TRIGGER asset_categories_updated_at 
    BEFORE UPDATE ON asset_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SECTION 5: ASSETS TABLE
-- =====================================================

CREATE TABLE assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category_id UUID REFERENCES asset_categories(id) NOT NULL,
    currency currency_type NOT NULL DEFAULT 'BRL',
    
    -- Price information
    current_price DECIMAL(15,4),
    previous_close DECIMAL(15,4),
    price_change DECIMAL(15,4),
    price_change_percent DECIMAL(8,4),
    price_updated_at TIMESTAMP WITH TIME ZONE,
    
    -- Market data
    market_cap BIGINT,
    volume BIGINT,
    avg_volume BIGINT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_tradeable BOOLEAN DEFAULT true,
    
    -- Metadata
    sector TEXT,
    industry TEXT,
    description TEXT,
    logo_url TEXT,
    website TEXT,
    
    -- Additional data
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_price CHECK (current_price >= 0),
    CONSTRAINT valid_symbol_format CHECK (symbol ~ '^[A-Z0-9]{4,12}$')
);

-- Indexes for performance
CREATE INDEX idx_assets_symbol ON assets(symbol);
CREATE INDEX idx_assets_category ON assets(category_id);
CREATE INDEX idx_assets_active ON assets(is_active) WHERE is_active = true;
CREATE INDEX idx_assets_currency ON assets(currency);
CREATE INDEX idx_assets_sector ON assets(sector);

CREATE TRIGGER assets_updated_at 
    BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SECTION 6: PORTFOLIOS TABLE  
-- =====================================================

CREATE TABLE portfolios (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    
    -- Settings
    base_currency currency_type DEFAULT 'BRL',
    target_allocation JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT portfolios_name_not_empty CHECK (length(trim(name)) > 0)
);

-- Ensure only one default portfolio per user
CREATE UNIQUE INDEX idx_portfolios_user_default 
ON portfolios(user_id) 
WHERE is_default = true;

-- Index for user portfolios
CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);

CREATE TRIGGER portfolios_updated_at 
    BEFORE UPDATE ON portfolios
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure single default portfolio
CREATE OR REPLACE FUNCTION ensure_single_default_portfolio()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = true THEN
        UPDATE portfolios 
        SET is_default = false 
        WHERE user_id = NEW.user_id AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ensure_single_default_portfolio
    BEFORE INSERT OR UPDATE ON portfolios
    FOR EACH ROW EXECUTE FUNCTION ensure_single_default_portfolio();

-- =====================================================
-- SECTION 7: TRANSACTIONS TABLE
-- =====================================================

CREATE TABLE transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    portfolio_id UUID REFERENCES portfolios ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
    
    -- Transaction details
    type transaction_type NOT NULL,
    quantity DECIMAL(15,6) NOT NULL,
    price DECIMAL(15,4) NOT NULL,
    
    -- Costs
    brokerage_fee DECIMAL(15,2) DEFAULT 0,
    exchange_fee DECIMAL(15,2) DEFAULT 0,
    other_fees DECIMAL(15,2) DEFAULT 0,
    total_fees DECIMAL(15,2) GENERATED ALWAYS AS (
        COALESCE(brokerage_fee, 0) + COALESCE(exchange_fee, 0) + COALESCE(other_fees, 0)
    ) STORED,
    
    -- Calculated totals
    gross_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        quantity * price
    ) STORED,
    
    net_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        CASE 
            WHEN type IN ('BUY') THEN (quantity * price) + COALESCE(brokerage_fee, 0) + COALESCE(exchange_fee, 0) + COALESCE(other_fees, 0)
            WHEN type IN ('SELL') THEN (quantity * price) - COALESCE(brokerage_fee, 0) - COALESCE(exchange_fee, 0) - COALESCE(other_fees, 0)
            ELSE quantity * price
        END
    ) STORED,
    
    -- Dates and metadata
    transaction_date DATE NOT NULL,
    settlement_date DATE,
    notes TEXT,
    reference_id TEXT, -- External reference (brokerage order ID)
    
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_quantity CHECK (quantity > 0),
    CONSTRAINT valid_price CHECK (price >= 0),
    CONSTRAINT valid_fees CHECK (
        brokerage_fee >= 0 AND 
        exchange_fee >= 0 AND 
        other_fees >= 0
    ),
    CONSTRAINT valid_transaction_date CHECK (transaction_date <= CURRENT_DATE),
    CONSTRAINT valid_settlement_date CHECK (settlement_date IS NULL OR settlement_date >= transaction_date)
);

-- Indexes for performance
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_portfolio_id ON transactions(portfolio_id);
CREATE INDEX idx_transactions_asset_id ON transactions(asset_id);
CREATE INDEX idx_transactions_date ON transactions(transaction_date DESC);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- Compound indexes for common queries
CREATE INDEX idx_transactions_user_asset ON transactions(user_id, asset_id);
CREATE INDEX idx_transactions_portfolio_asset ON transactions(portfolio_id, asset_id);

CREATE TRIGGER transactions_updated_at 
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SECTION 8: DIVIDENDS TABLE
-- =====================================================

CREATE TABLE dividends (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
    
    -- Dividend details
    amount_per_share DECIMAL(15,4) NOT NULL,
    quantity_eligible DECIMAL(15,6) NOT NULL,
    total_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        amount_per_share * quantity_eligible
    ) STORED,
    
    -- Dates
    declaration_date DATE,
    ex_date DATE NOT NULL,
    record_date DATE,
    payment_date DATE,
    
    -- Type and status
    dividend_type TEXT DEFAULT 'DIVIDEND', -- DIVIDEND, JCP, BONUS, etc.
    status dividend_status DEFAULT 'ANNOUNCED',
    
    -- Tax information
    tax_rate DECIMAL(5,4) DEFAULT 0, -- Tax rate (0.15 = 15%)
    tax_amount DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        (amount_per_share * quantity_eligible) - COALESCE(tax_amount, 0)
    ) STORED,
    
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_amount_per_share CHECK (amount_per_share > 0),
    CONSTRAINT valid_quantity_eligible CHECK (quantity_eligible > 0),
    CONSTRAINT valid_tax_rate CHECK (tax_rate >= 0 AND tax_rate <= 1),
    CONSTRAINT valid_tax_amount CHECK (tax_amount >= 0),
    CONSTRAINT valid_dates CHECK (
        (record_date IS NULL OR record_date >= ex_date) AND
        (payment_date IS NULL OR payment_date >= ex_date)
    )
);

-- Indexes
CREATE INDEX idx_dividends_user_id ON dividends(user_id);
CREATE INDEX idx_dividends_asset_id ON dividends(asset_id);
CREATE INDEX idx_dividends_ex_date ON dividends(ex_date DESC);
CREATE INDEX idx_dividends_payment_date ON dividends(payment_date DESC) WHERE payment_date IS NOT NULL;
CREATE INDEX idx_dividends_status ON dividends(status);

CREATE TRIGGER dividends_updated_at 
    BEFORE UPDATE ON dividends
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- SECTION 9: PORTFOLIO POSITIONS TABLE (MATERIALIZED)
-- =====================================================

CREATE TABLE portfolio_positions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    portfolio_id UUID REFERENCES portfolios ON DELETE CASCADE NOT NULL,
    asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
    
    -- Position data
    quantity DECIMAL(15,6) NOT NULL DEFAULT 0,
    average_price DECIMAL(15,4) NOT NULL DEFAULT 0,
    
    -- Investment totals
    total_invested DECIMAL(15,2) NOT NULL DEFAULT 0, -- Total amount invested (including fees)
    total_fees DECIMAL(15,2) NOT NULL DEFAULT 0,     -- Total fees paid
    
    -- Current values (updated by triggers/jobs)
    current_price DECIMAL(15,4),
    current_value DECIMAL(15,2) GENERATED ALWAYS AS (
        quantity * COALESCE(current_price, 0)
    ) STORED,
    
    -- P&L calculations
    unrealized_pnl DECIMAL(15,2) GENERATED ALWAYS AS (
        (quantity * COALESCE(current_price, 0)) - total_invested
    ) STORED,
    
    unrealized_pnl_percent DECIMAL(8,4) GENERATED ALWAYS AS (
        CASE 
            WHEN total_invested > 0 THEN 
                (((quantity * COALESCE(current_price, 0)) - total_invested) / total_invested) * 100
            ELSE 0
        END
    ) STORED,
    
    realized_pnl DECIMAL(15,2) DEFAULT 0,            -- From sales
    total_dividends DECIMAL(15,2) DEFAULT 0,         -- Total dividends received
    
    -- Metadata
    first_purchase_date DATE,
    last_transaction_date DATE,
    
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_portfolio_asset UNIQUE(portfolio_id, asset_id),
    CONSTRAINT valid_position_quantity CHECK (quantity >= 0),
    CONSTRAINT valid_average_price CHECK (average_price >= 0),
    CONSTRAINT valid_total_invested CHECK (total_invested >= 0)
);

-- Indexes
CREATE INDEX idx_positions_user_id ON portfolio_positions(user_id);
CREATE INDEX idx_positions_portfolio_id ON portfolio_positions(portfolio_id);
CREATE INDEX idx_positions_asset_id ON portfolio_positions(asset_id);
CREATE INDEX idx_positions_quantity ON portfolio_positions(quantity) WHERE quantity > 0;

-- =====================================================
-- SECTION 10: PRICE HISTORY TABLE
-- =====================================================

CREATE TABLE price_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id UUID REFERENCES assets ON DELETE CASCADE NOT NULL,
    
    -- OHLCV data
    open_price DECIMAL(15,4) NOT NULL,
    high_price DECIMAL(15,4) NOT NULL,
    low_price DECIMAL(15,4) NOT NULL,
    close_price DECIMAL(15,4) NOT NULL,
    volume BIGINT DEFAULT 0,
    
    -- Date
    price_date DATE NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT unique_asset_date UNIQUE(asset_id, price_date),
    CONSTRAINT valid_ohlc CHECK (
        open_price >= 0 AND high_price >= 0 AND 
        low_price >= 0 AND close_price >= 0 AND
        high_price >= low_price AND
        high_price >= open_price AND high_price >= close_price AND
        low_price <= open_price AND low_price <= close_price
    ),
    CONSTRAINT valid_volume CHECK (volume >= 0)
);

-- Indexes
CREATE INDEX idx_price_history_asset_date ON price_history(asset_id, price_date DESC);
CREATE INDEX idx_price_history_date ON price_history(price_date DESC);

-- =====================================================
-- SECTION 11: BUSINESS LOGIC FUNCTIONS
-- =====================================================

-- Function to recalculate portfolio positions
CREATE OR REPLACE FUNCTION recalculate_position(p_portfolio_id UUID, p_asset_id UUID)
RETURNS void AS $$
DECLARE
    v_quantity DECIMAL(15,6) := 0;
    v_total_invested DECIMAL(15,2) := 0;
    v_total_fees DECIMAL(15,2) := 0;
    v_realized_pnl DECIMAL(15,2) := 0;
    v_average_price DECIMAL(15,4) := 0;
    v_current_price DECIMAL(15,4);
    v_user_id UUID;
    v_first_purchase_date DATE;
    v_last_transaction_date DATE;
    v_total_dividends DECIMAL(15,2) := 0;
BEGIN
    -- Get user_id from portfolio
    SELECT user_id INTO v_user_id 
    FROM portfolios 
    WHERE id = p_portfolio_id;
    
    -- Calculate position from transactions
    WITH transaction_summary AS (
        SELECT 
            SUM(CASE WHEN type = 'BUY' THEN quantity ELSE -quantity END) as net_quantity,
            SUM(CASE WHEN type = 'BUY' THEN net_amount ELSE 0 END) as total_cost,
            SUM(total_fees) as fees_paid,
            SUM(CASE WHEN type = 'SELL' THEN (price * quantity) - net_amount ELSE 0 END) as realized_gains,
            MIN(CASE WHEN type = 'BUY' THEN transaction_date END) as first_buy,
            MAX(transaction_date) as last_transaction
        FROM transactions 
        WHERE portfolio_id = p_portfolio_id 
        AND asset_id = p_asset_id
        AND type IN ('BUY', 'SELL')
    )
    SELECT 
        COALESCE(net_quantity, 0),
        COALESCE(total_cost, 0),
        COALESCE(fees_paid, 0),
        COALESCE(realized_gains, 0),
        first_buy,
        last_transaction
    INTO 
        v_quantity, 
        v_total_invested, 
        v_total_fees, 
        v_realized_pnl,
        v_first_purchase_date,
        v_last_transaction_date
    FROM transaction_summary;
    
    -- Calculate total dividends received
    SELECT COALESCE(SUM(net_amount), 0)
    INTO v_total_dividends
    FROM dividends 
    WHERE user_id = v_user_id 
    AND asset_id = p_asset_id
    AND status = 'PAID';
    
    -- If no position, delete record
    IF v_quantity <= 0 THEN
        DELETE FROM portfolio_positions 
        WHERE portfolio_id = p_portfolio_id AND asset_id = p_asset_id;
        RETURN;
    END IF;
    
    -- Calculate average price
    IF v_quantity > 0 AND v_total_invested > 0 THEN
        v_average_price := v_total_invested / v_quantity;
    END IF;
    
    -- Get current price
    SELECT current_price INTO v_current_price 
    FROM assets 
    WHERE id = p_asset_id;
    
    -- Insert or update position
    INSERT INTO portfolio_positions (
        user_id, 
        portfolio_id, 
        asset_id, 
        quantity, 
        average_price,
        total_invested, 
        total_fees,
        current_price,
        realized_pnl,
        total_dividends,
        first_purchase_date,
        last_transaction_date,
        last_updated
    ) VALUES (
        v_user_id, 
        p_portfolio_id, 
        p_asset_id, 
        v_quantity, 
        v_average_price,
        v_total_invested, 
        v_total_fees,
        v_current_price,
        v_realized_pnl,
        v_total_dividends,
        v_first_purchase_date,
        v_last_transaction_date,
        NOW()
    )
    ON CONFLICT (portfolio_id, asset_id) 
    DO UPDATE SET
        quantity = EXCLUDED.quantity,
        average_price = EXCLUDED.average_price,
        total_invested = EXCLUDED.total_invested,
        total_fees = EXCLUDED.total_fees,
        current_price = EXCLUDED.current_price,
        realized_pnl = EXCLUDED.realized_pnl,
        total_dividends = EXCLUDED.total_dividends,
        first_purchase_date = EXCLUDED.first_purchase_date,
        last_transaction_date = EXCLUDED.last_transaction_date,
        last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to recalculate positions after transaction changes
CREATE OR REPLACE FUNCTION trigger_recalculate_position()
RETURNS TRIGGER AS $$
BEGIN
    -- For INSERT and UPDATE
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM recalculate_position(NEW.portfolio_id, NEW.asset_id);
    END IF;
    
    -- For DELETE
    IF TG_OP = 'DELETE' THEN
        PERFORM recalculate_position(OLD.portfolio_id, OLD.asset_id);
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_transaction_position_update
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_position();

-- Function to update position current prices
CREATE OR REPLACE FUNCTION update_portfolio_current_prices()
RETURNS void AS $$
BEGIN
    UPDATE portfolio_positions pp
    SET 
        current_price = a.current_price,
        last_updated = NOW()
    FROM assets a
    WHERE pp.asset_id = a.id
    AND a.current_price IS NOT NULL
    AND (pp.current_price IS NULL OR pp.current_price != a.current_price);
END;
$$ LANGUAGE plpgsql;

-- Function to create default portfolio for new user
CREATE OR REPLACE FUNCTION create_default_portfolio()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO portfolios (user_id, name, description, is_default)
    VALUES (
        NEW.id, 
        'Carteira Principal', 
        'Carteira padrão criada automaticamente',
        true
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION create_default_portfolio();

-- =====================================================
-- SECTION 12: ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dividends ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;

-- Assets and categories are public for reading
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles 
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles 
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles 
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Portfolios policies
CREATE POLICY "Users can view own portfolios" ON portfolios 
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own portfolios" ON portfolios 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own portfolios" ON portfolios 
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own portfolios" ON portfolios 
    FOR DELETE USING (auth.uid() = user_id AND is_default = false);

-- Transactions policies
CREATE POLICY "Users can view own transactions" ON transactions 
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON transactions 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions" ON transactions 
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions" ON transactions 
    FOR DELETE USING (auth.uid() = user_id);

-- Dividends policies  
CREATE POLICY "Users can view own dividends" ON dividends 
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dividends" ON dividends 
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dividends" ON dividends 
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own dividends" ON dividends 
    FOR DELETE USING (auth.uid() = user_id);

-- Portfolio positions policies
CREATE POLICY "Users can view own positions" ON portfolio_positions 
    FOR SELECT USING (auth.uid() = user_id);

-- Assets and related tables are public for reading
CREATE POLICY "Assets are viewable by everyone" ON assets 
    FOR SELECT USING (true);

CREATE POLICY "Asset categories are viewable by everyone" ON asset_categories 
    FOR SELECT USING (true);

CREATE POLICY "Price history is viewable by everyone" ON price_history 
    FOR SELECT USING (true);

-- =====================================================
-- SECTION 13: SAMPLE DATA
-- =====================================================

-- Insert sample Brazilian assets
INSERT INTO assets (symbol, name, category_id, currency, current_price, sector) 
SELECT 
    symbol, name, ac.id, 'BRL'::currency_type, current_price, sector
FROM (VALUES
    ('PETR4', 'Petróleo Brasileiro S.A. - Petrobras', 'STOCK', 32.45, 'Energy'),
    ('VALE3', 'Vale S.A.', 'STOCK', 68.90, 'Materials'),
    ('ITUB4', 'Itaú Unibanco Holding S.A.', 'STOCK', 25.67, 'Financials'),
    ('BBDC4', 'Banco Bradesco S.A.', 'STOCK', 13.89, 'Financials'),
    ('ABEV3', 'Ambev S.A.', 'STOCK', 11.24, 'Consumer Staples'),
    ('B3SA3', 'B3 S.A. - Brasil, Bolsa, Balcão', 'STOCK', 10.85, 'Financials'),
    ('HGLG11', 'CSHG Logística Fundo de Investimento Imobiliário', 'FII', 148.20, 'Real Estate'),
    ('KNRI11', 'Kinea Renda Imobiliária Fundo de Investimento Imobiliário', 'FII', 98.50, 'Real Estate'),
    ('XPML11', 'XP Malls Fundo de Investimento Imobiliário', 'FII', 89.75, 'Real Estate'),
    ('IVVB11', 'iShares Core S&P 500 ETF', 'ETF', 315.80, 'ETF'),
    ('BOVA11', 'iShares Ibovespa Fundo de Índice', 'ETF', 98.45, 'ETF')
) AS sample_assets(symbol, name, category, current_price, sector)
CROSS JOIN asset_categories ac
WHERE ac.name = sample_assets.category::asset_category_type;

-- =====================================================
-- SECTION 14: UTILITY VIEWS
-- =====================================================

-- View for portfolio summary
CREATE OR REPLACE VIEW portfolio_summary AS
SELECT 
    p.id as portfolio_id,
    p.user_id,
    p.name as portfolio_name,
    COUNT(pos.id) as total_assets,
    SUM(pos.current_value) as total_value,
    SUM(pos.total_invested) as total_invested,
    SUM(pos.unrealized_pnl) as total_unrealized_pnl,
    SUM(pos.realized_pnl) as total_realized_pnl,
    SUM(pos.total_dividends) as total_dividends,
    CASE 
        WHEN SUM(pos.total_invested) > 0 THEN 
            (SUM(pos.unrealized_pnl) / SUM(pos.total_invested)) * 100
        ELSE 0 
    END as unrealized_pnl_percent
FROM portfolios p
LEFT JOIN portfolio_positions pos ON pos.portfolio_id = p.id AND pos.quantity > 0
GROUP BY p.id, p.user_id, p.name;

-- View for asset allocation
CREATE OR REPLACE VIEW portfolio_allocation AS
SELECT 
    pos.portfolio_id,
    pos.user_id,
    cat.name as category,
    cat.display_name as category_name,
    cat.color_hex,
    COUNT(pos.asset_id) as asset_count,
    SUM(pos.current_value) as category_value,
    SUM(pos.total_invested) as category_invested,
    SUM(pos.unrealized_pnl) as category_pnl
FROM portfolio_positions pos
JOIN assets a ON a.id = pos.asset_id
JOIN asset_categories cat ON cat.id = a.category_id
WHERE pos.quantity > 0
GROUP BY pos.portfolio_id, pos.user_id, cat.id, cat.name, cat.display_name, cat.color_hex;

-- =====================================================
-- SECTION 15: INDEXES FOR PERFORMANCE
-- =====================================================

-- Additional composite indexes for common query patterns
CREATE INDEX idx_transactions_user_date_type ON transactions(user_id, transaction_date DESC, type);
CREATE INDEX idx_dividends_user_payment_date ON dividends(user_id, payment_date DESC) WHERE payment_date IS NOT NULL;
CREATE INDEX idx_positions_user_value ON portfolio_positions(user_id, current_value DESC) WHERE quantity > 0;

-- Partial indexes for active records
CREATE INDEX idx_assets_active_symbol ON assets(symbol) WHERE is_active = true;
CREATE INDEX idx_portfolios_user_active ON portfolios(user_id) WHERE is_default = true;

-- =====================================================
-- SETUP COMPLETE
-- =====================================================

-- Function to verify database setup
CREATE OR REPLACE FUNCTION verify_database_setup()
RETURNS TABLE(
    table_name TEXT,
    record_count BIGINT,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 'asset_categories'::text, COUNT(*)::bigint, 
           CASE WHEN COUNT(*) >= 6 THEN 'OK' ELSE 'MISSING DATA' END
    FROM asset_categories
    
    UNION ALL
    
    SELECT 'assets'::text, COUNT(*)::bigint,
           CASE WHEN COUNT(*) > 0 THEN 'OK' ELSE 'NO SAMPLE DATA' END  
    FROM assets
    
    UNION ALL
    
    SELECT 'RLS policies'::text, COUNT(*)::bigint, 'OK'
    FROM pg_policies 
    WHERE schemaname = 'public'
    
    UNION ALL
    
    SELECT 'Functions'::text, COUNT(*)::bigint, 'OK'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
    AND p.proname IN ('recalculate_position', 'update_portfolio_current_prices');
END;
$$ LANGUAGE plpgsql;

-- Run verification
SELECT * FROM verify_database_setup();

-- =====================================================
-- NOTES FOR NEXT STEPS
-- =====================================================

/*
TODO: After running this script:

1. Configure Supabase environment variables in .env.local:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY

2. Test the authentication flow:
   - Create a user account
   - Verify profile and default portfolio creation

3. Test transaction flow:
   - Add sample transactions
   - Verify position calculations

4. Set up price update job:
   - Schedule regular calls to update_portfolio_current_prices()
   - Implement external API integration for price feeds

5. Performance monitoring:
   - Monitor query performance
   - Add additional indexes if needed
   - Set up query optimization

6. Backup strategy:
   - Configure automated backups
   - Test restoration procedures
*/