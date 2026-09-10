#!/usr/bin/env python3
"""Build an alternate medical-billing SQLite DB for UI connector testing.

Same schema as demo_database.db, different people / IDs / amounts so you can
prove the app switched connections.

Usage:
  python scripts/init_test_connector_database.py
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "sql-mcp"))

from sql_mcp.demo_billing import SCHEMA_SQL  # noqa: E402

DB_PATH = ROOT / "test_connector_database.db"


def seed(conn: sqlite3.Connection) -> None:
    customers = [
        (1, "BA20001", "Ava", "Nguyen", "ava.nguyen@example.com", "555-2001",
         "12 Harbor Street, San Diego, CA 92101", "2025-03-01 09:00:00"),
        (2, "BA20002", "Noah", "Patel", "noah.patel@example.com", "555-2002",
         "88 Canyon Road, Albuquerque, NM 87102", "2025-03-03 10:00:00"),
        (3, "BA20003", "Mia", "Brooks", "mia.brooks@example.com", "555-2003",
         "401 Market Street, Philadelphia, PA 19106", "2025-03-05 11:00:00"),
        (4, "BA20004", "Liam", "Garcia", "liam.garcia@example.com", "555-2004",
         "77 Pearl Avenue, Buffalo, NY 14202", "2025-03-07 12:00:00"),
        (5, "BA20005", "Zoe", "Kim", "zoe.kim@example.com", "555-2005",
         "900 Pacific Crest, Honolulu, HI 96813", "2025-03-09 13:00:00"),
        (6, "BA20006", "Ethan", "Murphy", "ethan.murphy@example.com", "555-2006",
         "15 Liberty Lane, Charleston, SC 29401", "2025-03-11 14:00:00"),
        (7, "BA20007", "Chloe", "Singh", "chloe.singh@example.com", "555-2007",
         "620 Riverwalk, Boise, ID 83702", "2025-03-13 15:00:00"),
        (8, "BA20008", "Owen", "Foster", "owen.foster@example.com", "555-2008",
         "3 Glacier Way, Anchorage, AK 99501", "2025-03-15 16:00:00"),
    ]
    conn.executemany(
        """INSERT INTO customers (
            customer_id, account_number, first_name, last_name, email, phone,
            billing_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        customers,
    )

    billing_accounts = [
        (1, 1, "payment_due", "Pacific Crest Insurance", "MEM-20001", 312.50,
         "2026-07-01", "2026-07-15", "2025-03-01 09:05:00"),
        (2, 2, "under_review", "Desert Bloom Health", "MEM-20002", 890.00,
         "2026-07-01", "2026-07-20", "2025-03-03 10:05:00"),
        (3, 3, "active", "Keystone Care Plan", "MEM-20003", 0.00,
         "2026-06-01", "2026-08-01", "2025-03-05 11:05:00"),
        (4, 4, "collections_hold", "Niagara Mutual", "MEM-20004", 1450.75,
         "2026-05-01", "2026-06-01", "2025-03-07 12:05:00"),
        (5, 5, "active", "Island Shield", "MEM-20005", 95.00,
         "2026-07-01", "2026-07-30", "2025-03-09 13:05:00"),
        (6, 6, "payment_due", "Lowcountry Benefits", "MEM-20006", 540.00,
         "2026-07-01", "2026-07-18", "2025-03-11 14:05:00"),
        (7, 7, "closed", "Treasure Valley Mutual", "MEM-20007", 0.00,
         "2026-01-01", "2026-01-15", "2025-03-13 15:05:00"),
        (8, 8, "active", "Aurora Frontier Plan", "MEM-20008", 210.00,
         "2026-07-01", "2026-08-05", "2025-03-15 16:05:00"),
    ]
    conn.executemany(
        """INSERT INTO billing_accounts (
            billing_account_id, customer_id, account_status, insurance_provider,
            insurance_member_id, outstanding_balance, last_statement_date,
            next_due_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        billing_accounts,
    )

    claims = [
        # Distinct denial case for connector testing
        (1, 1, "CLM20001", "2026-06-12", "Harborview Specialty Clinic", "99214",
         380.00, 260.00, 0.00, 380.00, "denied",
         "Service not covered under plan at out-of-network specialty clinic.",
         "2026-06-13 09:00:00", "2026-06-18 14:00:00"),
        # Approved
        (2, 2, "CLM20002", "2026-05-20", "Desert Bloom Imaging", "70450",
         890.00, 650.00, 520.00, 130.00, "approved", None,
         "2026-05-21 10:00:00", "2026-05-28 11:00:00"),
        # Partially paid
        (3, 3, "CLM20003", "2026-04-08", "Keystone Orthopedics", "73721",
         1200.00, 900.00, 600.00, 300.00, "partially_paid", None,
         "2026-04-09 08:30:00", "2026-04-15 16:00:00"),
        # Appealed
        (4, 4, "CLM20004", "2026-03-22", "Niagara Surgical Center", "45378",
         2100.00, 1500.00, 0.00, 2100.00, "appealed",
         "Initial denial for medical necessity; appeal packet filed with clinical notes.",
         "2026-03-23 09:00:00", "2026-04-02 12:00:00"),
        # Processing
        (5, 5, "CLM20005", "2026-07-01", "Pacific Crest Lab", "80053",
         210.00, None, 0.00, 0.00, "processing", None,
         "2026-07-02 09:00:00", None),
        # Submitted
        (6, 6, "CLM20006", "2026-07-05", "Lowcountry Family Practice", "99213",
         175.00, None, 0.00, 0.00, "submitted", None,
         "2026-07-06 10:00:00", None),
        # Closed
        (7, 7, "CLM20007", "2026-01-10", "Boise Wellness Center", "90834",
         320.00, 250.00, 200.00, 50.00, "closed", None,
         "2026-01-11 09:00:00", "2026-01-20 15:00:00"),
        # Second claim on Ava for multi-claim lookup
        (8, 1, "CLM20008", "2026-07-08", "Harborview Primary Care", "36415",
         95.00, 70.00, 56.00, 14.00, "approved", None,
         "2026-07-08 11:00:00", "2026-07-10 09:00:00"),
    ]
    conn.executemany(
        """INSERT INTO claims (
            claim_id, billing_account_id, claim_number, service_date, provider_name,
            procedure_code, billed_amount, allowed_amount, insurance_paid,
            patient_responsibility, claim_status, denial_reason, submitted_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        claims,
    )

    invoices = [
        (1, 1, "INV20001", "2026-06-20", "2026-07-05", 380.00, 0.00, 380.00, "overdue"),
        (2, 2, "INV20002", "2026-05-30", "2026-06-15", 130.00, 130.00, 0.00, "paid"),
        (3, 3, "INV20003", "2026-04-16", "2026-05-01", 300.00, 100.00, 200.00, "partially_paid"),
        (4, 4, "INV20004", "2026-04-05", "2026-04-20", 1450.75, 0.00, 1450.75, "overdue"),
        (5, 5, "INV20005", "2026-07-03", "2026-07-17", 95.00, 0.00, 95.00, "open"),
        (6, 6, "INV20006", "2026-07-07", "2026-07-21", 540.00, 0.00, 540.00, "open"),
        (7, 8, "INV20007", "2026-07-01", "2026-07-15", 210.00, 50.00, 160.00, "partially_paid"),
        (8, 7, "INV20008", "2026-01-21", "2026-02-05", 50.00, 50.00, 0.00, "paid"),
    ]
    conn.executemany(
        """INSERT INTO invoices (
            invoice_id, billing_account_id, invoice_number, issue_date, due_date,
            total_amount, amount_paid, amount_due, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        invoices,
    )

    payments = [
        (1, 2, 2, "PAY20001", "2026-06-10", 130.00, "credit_card", "completed"),
        (2, 3, 3, "PAY20002", "2026-04-25", 100.00, "online_portal", "completed"),
        (3, 1, 1, "PAY20003", "2026-07-06", 380.00, "bank_transfer", "failed"),
        (4, 4, None, "PAY20004", None, 500.00, "check", "pending"),
        (5, 8, 7, "PAY20005", "2026-07-08", 50.00, "debit_card", "completed"),
        (6, 6, 6, "PAY20006", "2026-07-09", 540.00, "credit_card", "reversed"),
        (7, 5, 5, "PAY20007", None, 95.00, "online_portal", "pending"),
        (8, 7, 8, "PAY20008", "2026-01-25", 50.00, "bank_transfer", "completed"),
    ]
    conn.executemany(
        """INSERT INTO payments (
            payment_id, billing_account_id, invoice_id, payment_reference,
            payment_date, amount, payment_method, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        payments,
    )

    adjustments = [
        (1, 1, "CO-45", "Contractual write-off after out-of-network denial", 120.00,
         "2026-06-18 14:05:00"),
        (2, 2, "PR-1", "Member deductible applied to CT scan claim", 130.00,
         "2026-05-28 11:05:00"),
        (3, 3, "CO-97", "Concurrent care reduction on orthopedic imaging", 300.00,
         "2026-04-15 16:05:00"),
        (4, 4, "OA-18", "Appeal reprocessing note for colonoscopy claim", 0.00,
         "2026-04-02 12:05:00"),
        (5, 8, "CO-16", "Lab fee schedule adjustment", 25.00,
         "2026-07-10 09:05:00"),
        (6, 7, "PR-2", "Coinsuranceshare after therapy visit closeout", 50.00,
         "2026-01-20 15:05:00"),
    ]
    conn.executemany(
        """INSERT INTO claim_adjustments (
            adjustment_id, claim_id, adjustment_code, adjustment_reason,
            adjustment_amount, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)""",
        adjustments,
    )

    tickets = [
        (1, "TKT20001", 1, "claim_denial",
         "Out-of-network denial on specialty visit",
         "Ava disputes denial on CLM20001 and says Harborview should be treated as in-network exception.",
         "high", "in_progress", "Claims Review", "Serena Park", None,
         "2026-06-19 09:00:00", "2026-06-20 15:00:00", None),
        (2, "TKT20002", 2, "billing_inquiry",
         "Ask about patient responsibility after CT approval",
         "Noah wants an itemized breakdown of the $130 patient share on CLM20002.",
         "medium", "waiting_on_customer", "Billing Support", "Hector Ruiz", None,
         "2026-05-29 10:00:00", "2026-06-01 11:00:00", None),
        (3, "TKT20003", 4, "claim_issue",
         "Urgent appeal status for colonoscopy claim",
         "Liam needs senior review of medical-necessity appeal for CLM20004.",
         "urgent", "escalated", "Senior Claims Escalations", "Nina Okonkwo", None,
         "2026-04-03 08:00:00", "2026-04-04 17:00:00", None),
        (4, "TKT20004", 3, "payment_issue",
         "Partial payment not reflected on orthopedic invoice",
         "Mia paid $100 toward INV20003 but portal still shows $300 due.",
         "medium", "resolved", "Payments Team", "Chris Delgado",
         "Portal lag corrected; remaining balance updated to $200.",
         "2026-04-26 09:00:00", "2026-04-28 16:00:00", "2026-04-28 16:00:00"),
        (5, "TKT20005", 6, "refund_request",
         "Request refund after reversed card payment",
         "Ethan asks for refund confirmation after PAY20006 was reversed on INV20006.",
         "high", "open", "Payments Team", "Aisha Rahman", None,
         "2026-07-10 09:30:00", "2026-07-10 09:30:00", None),
        (6, "TKT20006", 8, "invoice_question",
         "Clarify remaining balance on INV20007",
         "Owen wants confirmation of $160 still due after $50 debit payment.",
         "low", "closed", "Customer Care", "Blair Quinn",
         "Confirmed remaining amount due and closed with customer acknowledgment.",
         "2026-07-09 10:00:00", "2026-07-09 18:00:00", "2026-07-09 18:00:00"),
    ]
    conn.executemany(
        """INSERT INTO tickets (
            ticket_id, ticket_number, customer_id, category, subject, description,
            priority, status, assigned_team, assigned_agent, resolution,
            created_at, updated_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        tickets,
    )

    comments = [
        (1, 1, "customer", "Ava Nguyen",
         "Harborview told me this clinic is covered under an exception. Please re-check CLM20001.",
         "2026-06-19 09:10:00"),
        (2, 1, "agent", "Serena Park",
         "Opened denial review and requested network-exception letter from provider.",
         "2026-06-19 12:00:00"),
        (3, 1, "system", "System",
         "Priority set to high based on claim_denial category rules.",
         "2026-06-19 12:01:00"),
        (4, 2, "agent", "Hector Ruiz",
         "Emailed Noah the EOB summary for CLM20002 patient responsibility.",
         "2026-05-29 10:15:00"),
        (5, 2, "customer", "Noah Patel",
         "Thanks — can you also confirm whether deductible reset applies next month?",
         "2026-06-01 09:00:00"),
        (6, 3, "agent", "Nina Okonkwo",
         "Escalated CLM20004 appeal to Senior Claims Escalations.",
         "2026-04-03 08:20:00"),
        (7, 3, "system", "System",
         "Priority elevated to urgent per escalation policy.",
         "2026-04-03 08:21:00"),
        (8, 4, "customer", "Mia Brooks",
         "I paid $100 yesterday but INV20003 still shows full balance.",
         "2026-04-26 09:05:00"),
        (9, 4, "agent", "Chris Delgado",
         "Located portal payment PAY20002 and corrected remaining due to $200.",
         "2026-04-27 14:00:00"),
        (10, 5, "customer", "Ethan Murphy",
         "My card was charged then reversed. Need confirmation no balance remains.",
         "2026-07-10 09:35:00"),
        (11, 6, "agent", "Blair Quinn",
         "Confirmed INV20007 remaining due is $160 after PAY20005.",
         "2026-07-09 11:00:00"),
        (12, 6, "system", "System",
         "Ticket closed after customer acknowledgment.",
         "2026-07-09 18:00:00"),
    ]
    conn.executemany(
        """INSERT INTO ticket_comments (
            comment_id, ticket_id, author_type, author_name, comment, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)""",
        comments,
    )


def main() -> int:
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SCHEMA_SQL)
        seed(conn)
        conn.commit()

        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables = [r[0] for r in cur.fetchall()]
        print(f"Created {DB_PATH}")
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM {table}")
            print(f"  {table}: {cur.fetchone()[0]}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
