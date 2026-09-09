"""Deterministic medical-billing BPO demo schema + seed data.

Used by:
- scripts/init_demo_database.py (developer CLI)
- SqlMcpEngine._ensure_demo_sqlite (auto-create when DB is missing)
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  account_number VARCHAR(30) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  billing_address VARCHAR(500),
  created_at TIMESTAMP NOT NULL
);

CREATE TABLE billing_accounts (
  billing_account_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL,
  account_status VARCHAR(30) NOT NULL,
  insurance_provider VARCHAR(150),
  insurance_member_id VARCHAR(100),
  outstanding_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  last_statement_date DATE,
  next_due_date DATE,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE claims (
  claim_id INTEGER PRIMARY KEY,
  billing_account_id INTEGER NOT NULL,
  claim_number VARCHAR(50) UNIQUE NOT NULL,
  service_date DATE NOT NULL,
  provider_name VARCHAR(200) NOT NULL,
  procedure_code VARCHAR(30) NOT NULL,
  billed_amount DECIMAL(12,2) NOT NULL,
  allowed_amount DECIMAL(12,2),
  insurance_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  patient_responsibility DECIMAL(12,2) NOT NULL DEFAULT 0,
  claim_status VARCHAR(40) NOT NULL,
  denial_reason VARCHAR(500),
  submitted_at TIMESTAMP,
  processed_at TIMESTAMP,
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(billing_account_id)
);

CREATE TABLE invoices (
  invoice_id INTEGER PRIMARY KEY,
  billing_account_id INTEGER NOT NULL,
  invoice_number VARCHAR(50) UNIQUE NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_due DECIMAL(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL,
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(billing_account_id)
);

CREATE TABLE payments (
  payment_id INTEGER PRIMARY KEY,
  billing_account_id INTEGER NOT NULL,
  invoice_id INTEGER,
  payment_reference VARCHAR(100) UNIQUE NOT NULL,
  payment_date DATE,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(50),
  status VARCHAR(30) NOT NULL,
  FOREIGN KEY (billing_account_id) REFERENCES billing_accounts(billing_account_id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(invoice_id)
);

CREATE TABLE claim_adjustments (
  adjustment_id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL,
  adjustment_code VARCHAR(50) NOT NULL,
  adjustment_reason VARCHAR(500) NOT NULL,
  adjustment_amount DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE TABLE tickets (
  ticket_id INTEGER PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL,
  category VARCHAR(50) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  priority VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL,
  assigned_team VARCHAR(100),
  assigned_agent VARCHAR(100),
  resolution TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE ticket_comments (
  comment_id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  author_type VARCHAR(30) NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id)
);
"""

REQUIRED_TABLES = (
    "customers",
    "billing_accounts",
    "claims",
    "invoices",
    "payments",
    "claim_adjustments",
    "tickets",
    "ticket_comments",
)


def _customers() -> list[tuple]:
    # Exact required customers 1-10, then fictional 11-20.
    rows = [
        (1, "BA10001", "John", "Carter", "john.carter@example.com", "555-0101",
         "101 Maple Street, Springfield, IL 62701", "2024-01-10 09:00:00"),
        (2, "BA10002", "Emily", "Davis", "emily.davis@example.com", "555-0102",
         "22 Lakeshore Drive, Madison, WI 53703", "2024-01-12 10:15:00"),
        (3, "BA10003", "Michael", "Wilson", "michael.wilson@example.com", "555-0103",
         "450 Oak Avenue, Columbus, OH 43215", "2024-01-15 11:30:00"),
        (4, "BA10004", "Sarah", "Mitchell", "sarah.mitchell@example.com", "555-0104",
         "78 Pine Court, Austin, TX 78701", "2024-01-18 08:45:00"),
        (5, "BA10005", "David", "Anderson", "david.anderson@example.com", "555-0105",
         "912 River Road, Portland, OR 97201", "2024-01-20 14:00:00"),
        (6, "BA10006", "Jennifer", "Thompson", "jennifer.thompson@example.com", "555-0106",
         "33 Birch Lane, Denver, CO 80202", "2024-01-22 16:20:00"),
        (7, "BA10007", "Robert", "Martinez", "robert.martinez@example.com", "555-0107",
         "560 Cedar Blvd, Phoenix, AZ 85001", "2024-01-25 09:40:00"),
        (8, "BA10008", "Lisa", "Robinson", "lisa.robinson@example.com", "555-0108",
         "19 Willow Way, Seattle, WA 98101", "2024-01-28 13:10:00"),
        (9, "BA10009", "James", "Clark", "james.clark@example.com", "555-0109",
         "241 Elm Street, Atlanta, GA 30301", "2024-02-01 10:00:00"),
        (10, "BA10010", "Maria", "Lewis", "maria.lewis@example.com", "555-0110",
         "88 Magnolia Drive, Nashville, TN 37201", "2024-02-03 15:30:00"),
        (11, "BA10011", "Christopher", "Walker", "christopher.walker@example.com", "555-0111",
         "14 Harbor View, Boston, MA 02108", "2024-02-05 09:00:00"),
        (12, "BA10012", "Amanda", "Hall", "amanda.hall@example.com", "555-0112",
         "705 Summit Terrace, Salt Lake City, UT 84101", "2024-02-07 11:00:00"),
        (13, "BA10013", "Daniel", "Allen", "daniel.allen@example.com", "555-0113",
         "402 Prairie Road, Omaha, NE 68102", "2024-02-09 12:30:00"),
        (14, "BA10014", "Jessica", "Young", "jessica.young@example.com", "555-0114",
         "27 Crescent Circle, Raleigh, NC 27601", "2024-02-11 08:20:00"),
        (15, "BA10015", "Matthew", "King", "matthew.king@example.com", "555-0115",
         "1190 Valley Parkway, Sacramento, CA 95814", "2024-02-13 14:45:00"),
        (16, "BA10016", "Ashley", "Wright", "ashley.wright@example.com", "555-0116",
         "61 Beacon Hill, Richmond, VA 23219", "2024-02-15 10:10:00"),
        (17, "BA10017", "Andrew", "Scott", "andrew.scott@example.com", "555-0117",
         "830 Lakeside Place, Minneapolis, MN 55401", "2024-02-17 16:00:00"),
        (18, "BA10018", "Stephanie", "Green", "stephanie.green@example.com", "555-0118",
         "5 Orchard Lane, Indianapolis, IN 46204", "2024-02-19 09:50:00"),
        (19, "BA10019", "Joshua", "Baker", "joshua.baker@example.com", "555-0119",
         "344 Ridgecrest Ave, Kansas City, MO 64105", "2024-02-21 13:25:00"),
        (20, "BA10020", "Nicole", "Adams", "nicole.adams@example.com", "555-0120",
         "920 Fairview Blvd, Tampa, FL 33602", "2024-02-23 11:40:00"),
    ]
    return rows


def _billing_accounts() -> list[tuple]:
    # One account per customer. Statuses intentionally varied.
    statuses = [
        "active", "payment_due", "active", "under_review", "active",
        "payment_due", "active", "collections_hold", "active", "closed",
        "active", "payment_due", "active", "under_review", "active",
        "payment_due", "active", "active", "collections_hold", "active",
    ]
    providers = [
        "Horizon Health Plan", "Lakeside Mutual", "MetroCare Insurance",
        "Prairie Shield", "Riverbend Assurance", "Summit Benefits",
        "Pacific Choice", "Atlantic Coverage", "Central Health Network",
        "Frontier Mutual", "Horizon Health Plan", "Lakeside Mutual",
        "MetroCare Insurance", "Prairie Shield", "Riverbend Assurance",
        "Summit Benefits", "Pacific Choice", "Atlantic Coverage",
        "Central Health Network", "Frontier Mutual",
    ]
    balances = [
        150.00, 425.00, 0.00, 720.00, 0.00,
        210.50, 0.00, 980.00, 45.00, 0.00,
        125.00, 300.00, 0.00, 540.00, 75.00,
        190.00, 0.00, 60.00, 1100.00, 0.00,
    ]
    rows = []
    for i in range(1, 21):
        rows.append(
            (
                i,
                i,
                statuses[i - 1],
                providers[i - 1],
                f"MEM-{10000 + i}",
                balances[i - 1],
                f"2026-0{(i % 8) + 1:02d}-01" if i <= 20 else "2026-01-01",
                f"2026-0{((i + 1) % 8) + 1:02d}-15",
                f"2024-0{(i % 9) + 1:02d}-10 09:00:00",
            )
        )
    # Fix dates to be valid
    fixed = []
    for row in rows:
        ba_id, cust_id, status, provider, member, bal, last_stmt, next_due, created = row
        month_a = ((ba_id - 1) % 12) + 1
        month_b = (ba_id % 12) + 1
        fixed.append(
            (
                ba_id,
                cust_id,
                status,
                provider,
                member,
                bal,
                f"2026-{month_a:02d}-01",
                f"2026-{month_b:02d}-15",
                f"2024-{(month_a):02d}-10 09:00:00",
            )
        )
    return fixed


def _claims() -> list[tuple]:
    """40 claims. First five encode required scenarios A-E."""
    claims = [
        # A — John Carter approved
        (1, 1, "CLM10001", "2026-01-15", "Northstar Medical Center", "99213",
         250.00, 180.00, 150.00, 30.00, "approved", None,
         "2026-01-16 10:00:00", "2026-01-20 14:00:00"),
        # B — Emily Davis denied
        (2, 2, "CLM10002", "2026-02-03", "Lakeside Family Clinic", "93000",
         425.00, 300.00, 0.00, 425.00, "denied",
         "Prior authorization was required but was not present at the time of claim processing.",
         "2026-02-04 09:30:00", "2026-02-10 16:00:00"),
        # C — Michael Wilson partially_paid
        (3, 3, "CLM10003", "2026-01-22", "Metro Health Specialists", "80053",
         600.00, 450.00, 300.00, 150.00, "partially_paid", None,
         "2026-01-23 11:00:00", "2026-01-28 12:00:00"),
        # D — Sarah Mitchell appealed
        (4, 4, "CLM10004", "2026-02-10", "Green Valley Medical Group", "71046",
         720.00, 500.00, 0.00, 720.00, "appealed",
         "Initial denial due to medical-necessity review. Appeal submitted for reconsideration.",
         "2026-02-11 08:00:00", "2026-02-18 15:30:00"),
        # E — David Anderson processing
        (5, 5, "CLM10005", "2026-03-01", "Riverbend Health Network", "36415",
         185.00, 140.00, 0.00, 0.00, "processing", None,
         "2026-03-02 09:00:00", None),
    ]

    providers = [
        "Summit Outpatient Center", "Prairie Urgent Care", "Atlantic Diagnostic Lab",
        "Coastal Orthopedics", "Valley Imaging Associates", "Highland Primary Care",
        "Bayfront Specialty Clinic", "Northwind Hospital", "Cedar Grove Practice",
        "Silverline Surgical Center",
    ]
    procedures = ["99214", "73721", "80061", "99203", "70450", "90834", "45378", "20610", "93015", "J1100"]
    statuses = ["submitted", "processing", "approved", "partially_paid", "denied", "appealed", "closed"]

    for i in range(6, 41):
        ba_id = ((i - 1) % 20) + 1
        status = statuses[(i - 6) % len(statuses)]
        billed = 100.00 + (i * 17.5)
        allowed = round(billed * 0.75, 2) if status != "submitted" else None
        if status == "approved":
            insurance = round((allowed or 0) * 0.8, 2)
            patient = round((allowed or 0) - insurance, 2)
            denial = None
        elif status == "partially_paid":
            insurance = round((allowed or 0) * 0.5, 2)
            patient = round(billed - insurance, 2)
            denial = None
        elif status == "denied":
            insurance = 0.00
            patient = billed
            denial = "Coding inconsistency identified during automated adjudication."
        elif status == "appealed":
            insurance = 0.00
            patient = billed
            denial = "Appeal pending after initial medical-necessity denial."
        elif status == "closed":
            insurance = round((allowed or billed) * 0.7, 2)
            patient = round(billed - insurance, 2)
            denial = None
        else:
            insurance = 0.00
            patient = 0.00 if status == "processing" else billed
            denial = None
        month = ((i - 1) % 12) + 1
        day = min(28, 1 + (i % 27))
        claims.append(
            (
                i,
                ba_id,
                f"CLM{10000 + i}",
                f"2026-{month:02d}-{day:02d}",
                providers[(i - 6) % len(providers)],
                procedures[(i - 6) % len(procedures)],
                round(billed, 2),
                allowed,
                insurance,
                patient,
                status,
                denial,
                f"2026-{month:02d}-{day:02d} 10:00:00",
                None if status in ("submitted", "processing") else f"2026-{month:02d}-{min(28, day + 5):02d} 15:00:00",
            )
        )
    return claims


def _invoices() -> list[tuple]:
    invoices = [
        # F — John Carter partially_paid
        (1, 1, "INV10001", "2026-02-01", "2026-02-15", 450.00, 300.00, 150.00, "partially_paid"),
        # G — Emily Davis overdue
        (2, 2, "INV10002", "2026-01-20", "2026-02-05", 425.00, 0.00, 425.00, "overdue"),
        # H — Michael Wilson paid
        (3, 3, "INV10003", "2026-01-25", "2026-02-10", 600.00, 600.00, 0.00, "paid"),
    ]
    statuses = ["open", "partially_paid", "paid", "overdue", "void"]
    for i in range(4, 31):
        ba_id = ((i - 1) % 20) + 1
        status = statuses[(i - 4) % len(statuses)]
        total = round(80.00 + i * 22.25, 2)
        if status == "paid":
            paid, due = total, 0.00
        elif status == "partially_paid":
            paid = round(total * 0.4, 2)
            due = round(total - paid, 2)
        elif status == "void":
            paid, due = 0.00, 0.00
        elif status == "overdue":
            paid, due = 0.00, total
        else:
            paid, due = 0.00, total
        month = ((i - 1) % 12) + 1
        invoices.append(
            (
                i,
                ba_id,
                f"INV{10000 + i}",
                f"2026-{month:02d}-01",
                f"2026-{month:02d}-15",
                total,
                paid,
                due,
                status,
            )
        )
    return invoices


def _payments() -> list[tuple]:
    payments = [
        # I — Sarah Mitchell pending
        (1, 4, None, "PAY10001", None, 250.00, "bank_transfer", "pending"),
        # J — Emily Davis failed
        (2, 2, 2, "PAY10002", "2026-02-06", 425.00, "credit_card", "failed"),
        # Supporting payments for scenarios F/H
        (3, 1, 1, "PAY10003", "2026-02-05", 300.00, "online_portal", "completed"),
        (4, 3, 3, "PAY10004", "2026-02-08", 600.00, "debit_card", "completed"),
    ]
    methods = ["credit_card", "debit_card", "bank_transfer", "check", "online_portal"]
    statuses = ["pending", "completed", "failed", "reversed"]
    for i in range(5, 41):
        ba_id = ((i - 1) % 20) + 1
        inv_id = ((i - 1) % 30) + 1
        status = statuses[(i - 5) % len(statuses)]
        method = methods[(i - 5) % len(methods)]
        amount = round(50.00 + i * 12.75, 2)
        month = ((i - 1) % 12) + 1
        day = min(28, 2 + (i % 26))
        payments.append(
            (
                i,
                ba_id,
                inv_id if status != "pending" else None,
                f"PAY{10000 + i}",
                None if status == "pending" else f"2026-{month:02d}-{day:02d}",
                amount,
                method,
                status,
            )
        )
    return payments


def _claim_adjustments() -> list[tuple]:
    adjustments = [
        (1, 1, "CO-45", "Contractual obligation adjustment to allowed amount", 70.00, "2026-01-20 14:05:00"),
        (2, 2, "PR-1", "Deductible applied after denial of covered portion", 125.00, "2026-02-10 16:05:00"),
        (3, 3, "CO-97", "Payment adjusted for concurrent care reduction", 150.00, "2026-01-28 12:05:00"),
        (4, 4, "OA-18", "Exact duplicate claim / appeal reprocessing note", 0.00, "2026-02-18 15:35:00"),
    ]
    codes = ["CO-45", "PR-2", "CO-97", "OA-23", "PR-3", "CO-16", "OA-18"]
    reasons = [
        "Contractual write-off per payer fee schedule",
        "Coinsuranceshare applied to member responsibility",
        "Bundled service adjustment",
        "Timely filing exception review",
        "Coordination of benefits secondary payer offset",
        "Claim line rebundled during secondary review",
        "Administrative correction after appeal decision",
    ]
    for i in range(5, 26):
        claim_id = ((i - 1) % 40) + 1
        month = ((i - 1) % 12) + 1
        adjustments.append(
            (
                i,
                claim_id,
                codes[(i - 5) % len(codes)],
                reasons[(i - 5) % len(reasons)],
                round(15.00 + i * 8.5, 2),
                f"2026-{month:02d}-20 11:00:00",
            )
        )
    return adjustments


def _tickets() -> list[tuple]:
    tickets = [
        # K
        (1, "TKT10001", 2, "claim_denial",
         "Denied claim requiring prior authorization review",
         "Caller disputes denial on CLM10002 and states prior authorization was obtained.",
         "high", "in_progress", "Claims Review", "Rachel Adams", None,
         "2026-02-11 09:00:00", "2026-02-12 14:30:00", None),
        # L
        (2, "TKT10002", 3, "billing_inquiry",
         "Clarification needed on partially paid claim",
         "Customer wants itemized explanation of patient responsibility on CLM10003.",
         "medium", "waiting_on_customer", "Billing Support", "Marcus Lee", None,
         "2026-02-01 10:00:00", "2026-02-05 11:00:00", None),
        # M
        (3, "TKT10003", 4, "claim_issue",
         "Urgent follow-up on appealed imaging claim",
         "Appeal for CLM10004 requires senior review of medical-necessity documentation.",
         "urgent", "escalated", "Senior Claims Escalations", "Daniel Brooks", None,
         "2026-02-19 08:30:00", "2026-02-20 16:00:00", None),
        # N
        (4, "TKT10004", 1, "payment_issue",
         "Missing payment application on outstanding invoice",
         "Customer reports payment was submitted but invoice INV10001 still shows balance.",
         "medium", "resolved", "Payments Team", "Olivia Chen",
         "Payment was located and applied to the outstanding invoice.",
         "2026-02-06 09:15:00", "2026-02-08 17:00:00", "2026-02-08 17:00:00"),
    ]

    categories = [
        "billing_inquiry", "claim_issue", "claim_denial", "payment_issue",
        "invoice_question", "insurance_issue", "refund_request", "general_support",
    ]
    priorities = ["low", "medium", "high", "urgent"]
    statuses = [
        "open", "in_progress", "waiting_on_customer", "waiting_on_insurer",
        "escalated", "resolved", "closed",
    ]
    teams = [
        "Billing Support", "Claims Review", "Payments Team",
        "Insurance Coordination", "Senior Claims Escalations", "Customer Care",
    ]
    agents = [
        "Rachel Adams", "Marcus Lee", "Daniel Brooks", "Olivia Chen",
        "Priya Nair", "Thomas Nguyen", "Elena Vasquez", "Jordan Blake",
    ]

    for i in range(5, 21):
        customer_id = ((i - 1) % 20) + 1
        category = categories[(i - 5) % len(categories)]
        priority = priorities[(i - 5) % len(priorities)]
        status = statuses[(i - 5) % len(statuses)]
        team = teams[(i - 5) % len(teams)]
        agent = agents[(i - 5) % len(agents)]
        month = ((i - 1) % 12) + 1
        day = min(28, 3 + (i % 25))
        created = f"2026-{month:02d}-{day:02d} 09:00:00"
        updated = f"2026-{month:02d}-{min(28, day + 2):02d} 15:00:00"
        closed = updated if status in ("resolved", "closed") else None
        resolution = (
            "Issue reviewed and closed with customer confirmation."
            if status in ("resolved", "closed")
            else None
        )
        tickets.append(
            (
                i,
                f"TKT{10000 + i}",
                customer_id,
                category,
                f"Support request regarding {category.replace('_', ' ')}",
                f"Deterministic demo ticket #{i} for {category} workflow coverage.",
                priority,
                status,
                team,
                agent,
                resolution,
                created,
                updated,
                closed,
            )
        )
    return tickets


def _ticket_comments() -> list[tuple]:
    comments = [
        (1, 1, "customer", "Emily Davis",
         "I already obtained prior authorization before the procedure. Please re-review CLM10002.",
         "2026-02-11 09:05:00"),
        (2, 1, "agent", "Rachel Adams",
         "Opened claim denial review. Requesting authorization reference from the provider portal.",
         "2026-02-11 11:20:00"),
        (3, 1, "system", "System",
         "Ticket priority set to high based on denial category rules.",
         "2026-02-11 11:21:00"),
        (4, 1, "agent", "Rachel Adams",
         "Awaiting insurer response on authorization exception.",
         "2026-02-12 14:30:00"),
        (5, 2, "agent", "Marcus Lee",
         "Sent itemized explanation request to customer for CLM10003.",
         "2026-02-01 10:10:00"),
        (6, 2, "customer", "Michael Wilson",
         "Please explain why my responsibility is $150 after insurance paid $300.",
         "2026-02-02 09:00:00"),
        (7, 2, "agent", "Marcus Lee",
         "Waiting on customer to confirm whether they want a formal appeal packet.",
         "2026-02-05 11:00:00"),
        (8, 3, "agent", "Daniel Brooks",
         "Escalated to Senior Claims Escalations due to prolonged appeal timeline.",
         "2026-02-19 08:45:00"),
        (9, 3, "system", "System",
         "Priority elevated to urgent per escalation policy.",
         "2026-02-19 08:46:00"),
        (10, 3, "agent", "Daniel Brooks",
         "Medical-necessity packet submitted to insurer for reconsideration.",
         "2026-02-20 16:00:00"),
        (11, 4, "customer", "John Carter",
         "I submitted a payment but INV10001 still shows amount due.",
         "2026-02-06 09:20:00"),
        (12, 4, "agent", "Olivia Chen",
         "Located pending portal payment and applied it to INV10001.",
         "2026-02-07 13:00:00"),
        (13, 4, "system", "System",
         "Ticket marked resolved after payment application confirmation.",
         "2026-02-08 17:00:00"),
    ]

    authors = [
        ("customer", "Demo Caller"),
        ("agent", "Priya Nair"),
        ("agent", "Thomas Nguyen"),
        ("system", "System"),
        ("customer", "Account Holder"),
        ("agent", "Elena Vasquez"),
        ("agent", "Jordan Blake"),
    ]
    for i in range(14, 36):
        # Keep required scenario tickets 1-4 on their curated comment timelines.
        ticket_id = ((i - 14) % 16) + 5
        author_type, author_name = authors[(i - 14) % len(authors)]
        month = ((i - 1) % 6) + 1
        day = min(28, 4 + (i % 20))
        comments.append(
            (
                i,
                ticket_id,
                author_type,
                author_name,
                f"Follow-up note {i} documenting progress on ticket {ticket_id}.",
                f"2026-{month:02d}-{day:02d} 12:00:00",
            )
        )
    return comments


def initialize_demo_database(db_path: str | Path, *, overwrite: bool = True) -> Path:
    """Create a fresh deterministic medical-billing demo SQLite database."""
    path = Path(db_path)
    if path.exists() and overwrite:
        path.unlink()
    path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(path))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA_SQL)

        conn.executemany(
            """INSERT INTO customers (
                customer_id, account_number, first_name, last_name, email, phone,
                billing_address, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            _customers(),
        )
        conn.executemany(
            """INSERT INTO billing_accounts (
                billing_account_id, customer_id, account_status, insurance_provider,
                insurance_member_id, outstanding_balance, last_statement_date,
                next_due_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            _billing_accounts(),
        )
        conn.executemany(
            """INSERT INTO claims (
                claim_id, billing_account_id, claim_number, service_date, provider_name,
                procedure_code, billed_amount, allowed_amount, insurance_paid,
                patient_responsibility, claim_status, denial_reason, submitted_at, processed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            _claims(),
        )
        conn.executemany(
            """INSERT INTO invoices (
                invoice_id, billing_account_id, invoice_number, issue_date, due_date,
                total_amount, amount_paid, amount_due, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            _invoices(),
        )
        conn.executemany(
            """INSERT INTO payments (
                payment_id, billing_account_id, invoice_id, payment_reference,
                payment_date, amount, payment_method, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            _payments(),
        )
        conn.executemany(
            """INSERT INTO claim_adjustments (
                adjustment_id, claim_id, adjustment_code, adjustment_reason,
                adjustment_amount, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            _claim_adjustments(),
        )
        conn.executemany(
            """INSERT INTO tickets (
                ticket_id, ticket_number, customer_id, category, subject, description,
                priority, status, assigned_team, assigned_agent, resolution,
                created_at, updated_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            _tickets(),
        )
        conn.executemany(
            """INSERT INTO ticket_comments (
                comment_id, ticket_id, author_type, author_name, comment, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)""",
            _ticket_comments(),
        )
        conn.commit()
    finally:
        conn.close()
    return path


def ensure_demo_database(db_path: str | Path) -> Path:
    """Create the demo DB only if it does not already exist."""
    path = Path(db_path)
    if path.exists():
        return path
    return initialize_demo_database(path, overwrite=False)
