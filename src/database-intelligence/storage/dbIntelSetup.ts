import { pool } from '../../storage/dbSetup';

export async function setupDbIntelDatabase(): Promise<{ usePgVector: boolean }> {
  console.log('[DB Intel Setup] Initializing database intelligence tables...');
  
  // 1. Detect pgvector capability on our platform database
  let usePgVector = false;
  try {
    const vectorCheck = await pool.query("SELECT * FROM pg_extension WHERE extname = 'vector';");
    usePgVector = vectorCheck.rows.length > 0;
  } catch (err) {
    console.warn('[DB Intel Setup] Error checking for pgvector:', err);
  }

  const vectorType = usePgVector ? 'vector(3072)' : 'real[]';
  console.log(`[DB Intel Setup] pgvector status: ${usePgVector}. Embedding type: ${vectorType}`);

  // 2. Create connections table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_connections (
      id VARCHAR(255) PRIMARY KEY,
      workspace_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(50) NOT NULL, -- 'postgres' or 'mysql'
      connection_config TEXT NOT NULL, -- Encrypted host, port, user, db, password
      status VARCHAR(50) NOT NULL DEFAULT 'disconnected', -- 'disconnected', 'connected', 'analyzing', 'ready', 'failed'
      error TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_db_conn_workspace ON db_connections(workspace_id);
  `);

  // 3. Create tables metadata
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_tables (
      id VARCHAR(255) PRIMARY KEY,
      connection_id VARCHAR(255) REFERENCES db_connections(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      schema_name VARCHAR(255) NOT NULL,
      description TEXT,
      row_count INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(connection_id, name, schema_name)
    );
    CREATE INDEX IF NOT EXISTS idx_db_tables_conn ON db_tables(connection_id);
  `);

  // 4. Create columns metadata
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_columns (
      id VARCHAR(255) PRIMARY KEY,
      table_id VARCHAR(255) REFERENCES db_tables(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      data_type VARCHAR(255) NOT NULL,
      is_nullable BOOLEAN DEFAULT TRUE,
      is_primary_key BOOLEAN DEFAULT FALSE,
      is_foreign_key BOOLEAN DEFAULT FALSE,
      default_value VARCHAR(255),
      description TEXT,
      classification VARCHAR(50) DEFAULT 'normal', -- 'normal', 'sensitive', 'highly_sensitive'
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(table_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_db_columns_table ON db_columns(table_id);
  `);

  // 5. Create relationships metadata
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_relationships (
      id VARCHAR(255) PRIMARY KEY,
      connection_id VARCHAR(255) REFERENCES db_connections(id) ON DELETE CASCADE,
      source_table VARCHAR(255) NOT NULL,
      source_column VARCHAR(255) NOT NULL,
      target_table VARCHAR(255) NOT NULL,
      target_column VARCHAR(255) NOT NULL,
      relationship_type VARCHAR(50) NOT NULL DEFAULT 'many_to_one',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_db_rel_conn ON db_relationships(connection_id);
  `);

  // 6. Create semantic metadata table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_semantic_metadata (
      id VARCHAR(255) PRIMARY KEY,
      table_id VARCHAR(255) REFERENCES db_tables(id) ON DELETE CASCADE UNIQUE,
      semantic_description TEXT NOT NULL,
      business_concepts TEXT[] NOT NULL DEFAULT '{}',
      synonyms TEXT[] NOT NULL DEFAULT '{}',
      embedding ${vectorType},
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_db_sem_table ON db_semantic_metadata(table_id);
  `);

  // 7. Create capabilities metadata table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_capabilities (
      id VARCHAR(255) PRIMARY KEY,
      connection_id VARCHAR(255) REFERENCES db_connections(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(50) NOT NULL, -- 'READ' or 'WRITE'
      description TEXT NOT NULL,
      required_context TEXT[] NOT NULL DEFAULT '{}',
      relevant_tables TEXT[] NOT NULL DEFAULT '{}',
      permissions TEXT[] NOT NULL DEFAULT '{}',
      embedding ${vectorType},
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_db_cap_conn ON db_capabilities(connection_id);
  `);

  // 8. Add FTS indexing on semantic description and table metadata
  // We setup FTS GIN indexes on descriptions to make lexical search extremely fast
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_db_tables_desc_fts ON db_tables USING gin(to_tsvector('english', coalesce(description, '')));
    CREATE INDEX IF NOT EXISTS idx_db_sem_desc_fts ON db_semantic_metadata USING gin(to_tsvector('english', semantic_description));
    CREATE INDEX IF NOT EXISTS idx_db_cap_desc_fts ON db_capabilities USING gin(to_tsvector('english', description));
  `);

  // 9. Add HNSW indexing if pgvector is enabled, or fallback index
  if (usePgVector) {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_db_sem_embed_hnsw ON db_semantic_metadata USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_db_cap_embed_hnsw ON db_capabilities USING hnsw (embedding vector_cosine_ops);
    `);
  }

  // 10. Create and seed the Voice Agent E-commerce schema (for local development/demo)
  console.log('[DB Intel Setup] Setting up voice_agent_test_db e-commerce schema...');
  
  // Clean up old tables if they exist
  await pool.query(`
    DROP TABLE IF EXISTS customer_orders CASCADE;
    DROP TABLE IF EXISTS order_shipments CASCADE;
  `);

  // Create tables in order
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(30),
        address TEXT,
        city VARCHAR(100),
        country VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(30) DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        price DECIMAL(10, 2) NOT NULL,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        sku VARCHAR(100) UNIQUE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        total_amount DECIMAL(10, 2) NOT NULL,
        shipping_address TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_orders_customer
            FOREIGN KEY (customer_id)
            REFERENCES customers(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        CONSTRAINT fk_order_items_order
            FOREIGN KEY (order_id)
            REFERENCES orders(id)
            ON DELETE CASCADE,
        CONSTRAINT fk_order_items_product
            FOREIGN KEY (product_id)
            REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        carrier VARCHAR(100),
        tracking_number VARCHAR(100) UNIQUE,
        status VARCHAR(50) NOT NULL DEFAULT 'processing',
        estimated_delivery_date DATE,
        shipped_at TIMESTAMP,
        delivered_at TIMESTAMP,
        CONSTRAINT fk_shipments_order
            FOREIGN KEY (order_id)
            REFERENCES orders(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        shipment_id INTEGER NOT NULL,
        event_status VARCHAR(100) NOT NULL,
        location VARCHAR(255),
        description TEXT,
        event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_tracking_events_shipment
            FOREIGN KEY (shipment_id)
            REFERENCES shipments(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL,
        payment_method VARCHAR(50),
        transaction_reference VARCHAR(100) UNIQUE,
        amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        paid_at TIMESTAMP,
        CONSTRAINT fk_payments_order
            FOREIGN KEY (order_id)
            REFERENCES orders(id)
            ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INTEGER NOT NULL,
        order_id INTEGER,
        subject VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        priority VARCHAR(30) DEFAULT 'medium',
        status VARCHAR(50) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_ticket_customer
            FOREIGN KEY (customer_id)
            REFERENCES customers(id)
            ON DELETE CASCADE,
        CONSTRAINT fk_ticket_order
            FOREIGN KEY (order_id)
            REFERENCES orders(id)
            ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS ticket_messages (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL,
        sender_type VARCHAR(30) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_ticket_messages_ticket
            FOREIGN KEY (ticket_id)
            REFERENCES support_tickets(id)
            ON DELETE CASCADE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_id ON tracking_events(shipment_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_customer_id ON support_tickets(customer_id);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
  `);

  // Seed data if empty
  const customersCheck = await pool.query('SELECT COUNT(*) FROM customers;');
  if (parseInt(customersCheck.rows[0].count) === 0) {
    console.log('[DB Intel Setup] Seeding Voice Agent test data...');
    await pool.query(`
      INSERT INTO customers (full_name, email, phone, address, city, country, status) VALUES
      ('John Smith', 'john.smith@example.com', '+1-555-0101', '123 Main Street', 'New York', 'USA', 'active'),
      ('Sarah Johnson', 'sarah.johnson@example.com', '+1-555-0102', '456 Oak Avenue', 'Chicago', 'USA', 'active'),
      ('Michael Brown', 'michael.brown@example.com', '+1-555-0103', '789 Pine Road', 'Los Angeles', 'USA', 'active'),
      ('Emily Davis', 'emily.davis@example.com', '+1-555-0104', '321 Maple Drive', 'Seattle', 'USA', 'active');

      INSERT INTO products (name, description, category, price, stock_quantity, sku) VALUES
      ('Wireless Headphones', 'Bluetooth noise cancelling wireless headphones', 'Electronics', 99.99, 50, 'WH-1001'),
      ('Mechanical Keyboard', 'RGB mechanical keyboard with tactile switches', 'Electronics', 129.99, 25, 'MK-2001'),
      ('USB-C Charger', '65W fast charging USB-C adapter', 'Accessories', 39.99, 100, 'UC-3001'),
      ('Laptop Stand', 'Adjustable aluminum laptop stand', 'Accessories', 49.99, 40, 'LS-4001');

      INSERT INTO orders (order_number, customer_id, status, total_amount, shipping_address) VALUES
      ('ORD-10001', 1, 'shipped', 139.98, '123 Main Street, New York, USA'),
      ('ORD-10002', 1, 'processing', 99.99, '123 Main Street, New York, USA'),
      ('ORD-10003', 2, 'delivered', 129.99, '456 Oak Avenue, Chicago, USA'),
      ('ORD-10004', 3, 'cancelled', 39.99, '789 Pine Road, Los Angeles, USA'),
      ('ORD-10005', 4, 'pending', 49.99, '321 Maple Drive, Seattle, USA');

      INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
      (1, 1, 1, 99.99),
      (1, 3, 1, 39.99),
      (2, 1, 1, 99.99),
      (3, 2, 1, 129.99),
      (4, 3, 1, 39.99),
      (5, 4, 1, 49.99);

      INSERT INTO shipments (order_id, carrier, tracking_number, status, estimated_delivery_date, shipped_at) VALUES
      (1, 'FedEx', 'FDX-123456789', 'in_transit', CURRENT_DATE + INTERVAL '2 days', CURRENT_TIMESTAMP - INTERVAL '1 day'),
      (3, 'UPS', 'UPS-987654321', 'delivered', CURRENT_DATE - INTERVAL '3 days', CURRENT_TIMESTAMP - INTERVAL '5 days');

      INSERT INTO tracking_events (shipment_id, event_status, location, description, event_time) VALUES
      (1, 'Shipment picked up', 'New York Distribution Center', 'Package has been picked up by FedEx', CURRENT_TIMESTAMP - INTERVAL '1 day'),
      (1, 'In transit', 'Philadelphia Hub', 'Package is currently in transit', CURRENT_TIMESTAMP - INTERVAL '6 hours'),
      (2, 'Out for delivery', 'Chicago', 'Package is out for delivery', CURRENT_TIMESTAMP - INTERVAL '4 days'),
      (2, 'Delivered', 'Chicago', 'Package was delivered successfully', CURRENT_TIMESTAMP - INTERVAL '3 days');

      INSERT INTO payments (order_id, payment_method, transaction_reference, amount, status, paid_at) VALUES
      (1, 'credit_card', 'TXN-100001', 139.98, 'completed', CURRENT_TIMESTAMP - INTERVAL '2 days'),
      (2, 'paypal', 'TXN-100002', 99.99, 'completed', CURRENT_TIMESTAMP - INTERVAL '1 day'),
      (3, 'credit_card', 'TXN-100003', 129.99, 'completed', CURRENT_TIMESTAMP - INTERVAL '7 days'),
      (4, 'credit_card', 'TXN-100004', 39.99, 'refunded', CURRENT_TIMESTAMP - INTERVAL '3 days');

      INSERT INTO support_tickets (ticket_number, customer_id, order_id, subject, description, category, priority, status) VALUES
      ('TKT-10001', 1, 1, 'Where is my order?', 'Customer wants an update about shipment status.', 'shipping', 'medium', 'open'),
      ('TKT-10002', 2, 3, 'Product issue', 'Customer reported an issue with the mechanical keyboard.', 'product', 'high', 'open'),
      ('TKT-10003', 3, 4, 'Cancelled order refund', 'Customer wants information about their refund.', 'refund', 'medium', 'resolved');

      INSERT INTO ticket_messages (ticket_id, sender_type, message) VALUES
      (1, 'customer', 'I placed an order recently and would like to know where it is.'),
      (1, 'agent', 'Your order has been shipped and is currently in transit.'),
      (2, 'customer', 'My keyboard is not working correctly.'),
      (3, 'customer', 'When will I receive my refund?');
    `);
  }

  console.log('[DB Intel Setup] Database intelligence tables successfully initialized.');
  return { usePgVector };
}
