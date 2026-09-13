"""Semantic ticket workflow tools for the medical-billing BPO demo.

These are business-level operations (not arbitrary SQL). They reuse the same
confirmation philosophy as compiled write tools: mutations return
confirmation_required until confirmed=true.

Works against SQLite or PostgreSQL through SqlMcpEngine.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from .models import ConnectionConfig

VALID_CATEGORIES = {
    "billing_inquiry",
    "claim_issue",
    "claim_denial",
    "payment_issue",
    "invoice_question",
    "insurance_issue",
    "refund_request",
    "general_support",
}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}
VALID_STATUSES = {
    "open",
    "in_progress",
    "waiting_on_customer",
    "waiting_on_insurer",
    "escalated",
    "resolved",
    "closed",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _coerce_engine(target: Any):
    from .engine import SqlMcpEngine

    if isinstance(target, SqlMcpEngine):
        return target
    if isinstance(target, ConnectionConfig):
        return SqlMcpEngine(target)
    return SqlMcpEngine(
        ConnectionConfig(dialect="sqlite", database=str(target)),
    )


def _row(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    if isinstance(row, dict):
        return dict(row)
    try:
        return dict(row)
    except Exception:
        return None


def _next_ticket_number(engine, cur) -> str:
    ph = engine._placeholder()
    tickets = engine._ident("tickets")
    ticket_number = engine._ident("ticket_number")
    cur.execute(
        f"""
        SELECT {ticket_number} AS ticket_number FROM {tickets}
        WHERE {ticket_number} LIKE 'TKT%'
        ORDER BY length({ticket_number}::text) DESC, {ticket_number} DESC
        LIMIT 1
        """
        if engine.config.dialect == "postgres"
        else f"""
        SELECT ticket_number FROM tickets
        WHERE ticket_number LIKE 'TKT%'
        ORDER BY length(ticket_number) DESC, ticket_number DESC
        LIMIT 1
        """
    )
    row = _row(cur.fetchone())
    if row is None:
        return "TKT10001"
    match = re.search(r"(\d+)$", str(row["ticket_number"]))
    if not match:
        return "TKT10001"
    return f"TKT{int(match.group(1)) + 1}"


def check_ticket(
    target: Any,
    ticket_number: str,
    include_recent_comments: bool = False,
) -> dict[str, Any]:
    if not ticket_number:
        return {"status": "error", "error": "ticket_number is required."}

    engine = _coerce_engine(target)
    ph = engine._placeholder()
    conn = engine._get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT * FROM {engine._ident('tickets')} WHERE {engine._ident('ticket_number')} = {ph}",
            [ticket_number],
        )
        ticket = _row(cur.fetchone())
        if ticket is None:
            return {
                "status": "not_found",
                "error": f'No ticket found for ticket_number "{ticket_number}".',
            }

        result: dict[str, Any] = {
            "status": "ok",
            "tool_used": "check_ticket",
            "data": {
                "ticket_number": ticket["ticket_number"],
                "status": ticket["status"],
                "priority": ticket["priority"],
                "category": ticket["category"],
                "subject": ticket["subject"],
                "assigned_team": ticket["assigned_team"],
                "assigned_agent": ticket["assigned_agent"],
                "created_at": ticket["created_at"],
                "updated_at": ticket["updated_at"],
                "resolution": ticket["resolution"],
            },
        }

        if include_recent_comments:
            cur.execute(
                f"""
                SELECT author_type, author_name, {engine._ident('comment')} AS comment, created_at
                FROM {engine._ident('ticket_comments')}
                WHERE {engine._ident('ticket_id')} = {ph}
                ORDER BY {engine._ident('comment_id')} DESC
                LIMIT 3
                """,
                [ticket["ticket_id"]],
            )
            comments = [_row(r) for r in cur.fetchall()]
            result["data"]["recent_comments"] = comments
            result["data"]["latest_comment"] = comments[0] if comments else None

        return result
    except Exception as exc:
        if engine._is_fatal_connection_error(exc):
            engine._reset_connection()
        return {"status": "error", "error": str(exc), "tool_used": "check_ticket"}


def create_ticket(
    target: Any,
    customer_id: int,
    category: str,
    subject: str,
    description: str,
    priority: str,
    *,
    confirmed: bool = False,
    assigned_team: str | None = None,
    assigned_agent: str | None = None,
) -> dict[str, Any]:
    pending = {
        "customer_id": customer_id,
        "category": category,
        "subject": subject,
        "description": description,
        "priority": priority,
        "assigned_team": assigned_team,
        "assigned_agent": assigned_agent,
    }
    if not confirmed:
        return {
            "status": "confirmation_required",
            "tool_used": "create_ticket",
            "message": "This change requires explicit user confirmation before it runs.",
            "pending_change": f"create ticket with {pending}",
        }

    if category not in VALID_CATEGORIES:
        return {"status": "error", "error": f"Invalid category: {category}"}
    if priority not in VALID_PRIORITIES:
        return {"status": "error", "error": f"Invalid priority: {priority}"}
    if not subject or not description:
        return {"status": "error", "error": "subject and description are required."}

    engine = _coerce_engine(target)
    ph = engine._placeholder()
    conn = engine._get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT {engine._ident('customer_id')} FROM {engine._ident('customers')} "
            f"WHERE {engine._ident('customer_id')} = {ph}",
            [customer_id],
        )
        if cur.fetchone() is None:
            return {"status": "error", "error": f"Customer {customer_id} was not found."}

        ticket_number = _next_ticket_number(engine, cur)
        now = _now()
        insert_sql = f"""
            INSERT INTO {engine._ident('tickets')} (
                {engine._ident('ticket_number')}, {engine._ident('customer_id')},
                {engine._ident('category')}, {engine._ident('subject')},
                {engine._ident('description')}, {engine._ident('priority')},
                {engine._ident('status')}, {engine._ident('assigned_team')},
                {engine._ident('assigned_agent')}, {engine._ident('resolution')},
                {engine._ident('created_at')}, {engine._ident('updated_at')},
                {engine._ident('closed_at')}
            ) VALUES ({ph}, {ph}, {ph}, {ph}, {ph}, {ph}, 'open', {ph}, {ph}, NULL, {ph}, {ph}, NULL)
        """
        values = [
            ticket_number,
            customer_id,
            category,
            subject,
            description,
            priority,
            assigned_team,
            assigned_agent,
            now,
            now,
        ]
        if engine.config.dialect == "postgres":
            cur.execute(insert_sql + " RETURNING ticket_id", values)
            row = _row(cur.fetchone())
            ticket_id = row["ticket_id"] if row else None
        else:
            cur.execute(insert_sql, values)
            ticket_id = cur.lastrowid

        cur.execute(
            f"""
            INSERT INTO {engine._ident('ticket_comments')} (
                {engine._ident('ticket_id')}, {engine._ident('author_type')},
                {engine._ident('author_name')}, {engine._ident('comment')},
                {engine._ident('created_at')}
            ) VALUES ({ph}, 'system', 'System', {ph}, {ph})
            """,
            [ticket_id, f"Ticket {ticket_number} created.", now],
        )
        conn.commit()
        return {
            "status": "ok",
            "tool_used": "create_ticket",
            "data": {
                "ticket_id": ticket_id,
                "ticket_number": ticket_number,
                "customer_id": customer_id,
                "category": category,
                "subject": subject,
                "priority": priority,
                "status": "open",
                "assigned_team": assigned_team,
                "assigned_agent": assigned_agent,
                "created_at": now,
            },
        }
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        if engine._is_fatal_connection_error(exc):
            engine._reset_connection()
        return {"status": "error", "error": str(exc), "tool_used": "create_ticket"}


def update_ticket(
    target: Any,
    ticket_number: str,
    *,
    status: str | None = None,
    priority: str | None = None,
    assigned_team: str | None = None,
    assigned_agent: str | None = None,
    resolution: str | None = None,
    comment: str | None = None,
    confirmed: bool = False,
    comment_author_name: str = "Natasha",
) -> dict[str, Any]:
    updates = {
        k: v
        for k, v in {
            "status": status,
            "priority": priority,
            "assigned_team": assigned_team,
            "assigned_agent": assigned_agent,
            "resolution": resolution,
        }.items()
        if v is not None
    }
    if not updates and not comment:
        return {
            "status": "error",
            "error": "At least one mutable field or comment must be supplied.",
            "tool_used": "update_ticket",
        }

    pending = {"ticket_number": ticket_number, **updates}
    if comment:
        pending["comment"] = comment

    if not confirmed:
        return {
            "status": "confirmation_required",
            "tool_used": "update_ticket",
            "message": "This change requires explicit user confirmation before it runs.",
            "pending_change": f"update ticket with {pending}",
        }

    if status is not None and status not in VALID_STATUSES:
        return {"status": "error", "error": f"Invalid status: {status}"}
    if priority is not None and priority not in VALID_PRIORITIES:
        return {"status": "error", "error": f"Invalid priority: {priority}"}

    engine = _coerce_engine(target)
    ph = engine._placeholder()
    conn = engine._get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"SELECT * FROM {engine._ident('tickets')} WHERE {engine._ident('ticket_number')} = {ph}",
            [ticket_number],
        )
        ticket = _row(cur.fetchone())
        if ticket is None:
            return {
                "status": "not_found",
                "error": f'No ticket found for ticket_number "{ticket_number}".',
            }

        now = _now()
        set_parts = [f"{engine._ident('updated_at')} = {ph}"]
        values: list[Any] = [now]

        for field, value in updates.items():
            set_parts.append(f"{engine._ident(field)} = {ph}")
            values.append(value)

        if status in ("resolved", "closed"):
            set_parts.append(f"{engine._ident('closed_at')} = {ph}")
            values.append(now)
        elif status is not None:
            set_parts.append(f"{engine._ident('closed_at')} = NULL")

        values.append(ticket_number)
        cur.execute(
            f"UPDATE {engine._ident('tickets')} SET {', '.join(set_parts)} "
            f"WHERE {engine._ident('ticket_number')} = {ph}",
            values,
        )

        if comment:
            cur.execute(
                f"""
                INSERT INTO {engine._ident('ticket_comments')} (
                    {engine._ident('ticket_id')}, {engine._ident('author_type')},
                    {engine._ident('author_name')}, {engine._ident('comment')},
                    {engine._ident('created_at')}
                ) VALUES ({ph}, 'agent', {ph}, {ph}, {ph})
                """,
                [ticket["ticket_id"], comment_author_name, comment, now],
            )

        conn.commit()
        cur.execute(
            f"SELECT * FROM {engine._ident('tickets')} WHERE {engine._ident('ticket_number')} = {ph}",
            [ticket_number],
        )
        updated = _row(cur.fetchone())
        return {
            "status": "ok",
            "tool_used": "update_ticket",
            "data": updated,
            "comment_added": bool(comment),
        }
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        if engine._is_fatal_connection_error(exc):
            engine._reset_connection()
        return {"status": "error", "error": str(exc), "tool_used": "update_ticket"}


TICKET_TOOL_DEFINITIONS = [
    {
        "name": "check_ticket",
        "description": (
            "Retrieve status and key details for an existing support ticket by "
            "ticket_number (for example TKT10001). Optionally include recent comments."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "ticket_number": {
                    "type": "string",
                    "description": "Business ticket number such as TKT10001",
                },
                "include_recent_comments": {
                    "type": "boolean",
                    "description": "If true, include the latest comments on the ticket.",
                },
            },
            "required": ["ticket_number"],
        },
    },
    {
        "name": "create_ticket",
        "description": (
            "Create a customer support ticket. Collect details, summarize the planned "
            "ticket, ask for explicit spoken confirmation, then call again with "
            "confirmed=true. Returns the new ticket_number."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "number", "description": "Customer ID"},
                "category": {
                    "type": "string",
                    "description": (
                        "One of: billing_inquiry, claim_issue, claim_denial, "
                        "payment_issue, invoice_question, insurance_issue, "
                        "refund_request, general_support"
                    ),
                },
                "subject": {"type": "string"},
                "description": {"type": "string"},
                "priority": {
                    "type": "string",
                    "description": "One of: low, medium, high, urgent",
                },
                "assigned_team": {"type": "string"},
                "assigned_agent": {"type": "string"},
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "Set true only after the user explicitly confirms creation."
                    ),
                },
            },
            "required": ["customer_id", "category", "subject", "description", "priority"],
        },
    },
    {
        "name": "update_ticket",
        "description": (
            "Update an existing support ticket. Supply only fields that should change "
            "and/or a new comment. Summarize the change, ask for explicit confirmation, "
            "then call again with confirmed=true."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "ticket_number": {"type": "string"},
                "status": {"type": "string"},
                "priority": {"type": "string"},
                "assigned_team": {"type": "string"},
                "assigned_agent": {"type": "string"},
                "resolution": {"type": "string"},
                "comment": {
                    "type": "string",
                    "description": "Optional new comment to append (does not overwrite history).",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": (
                        "Set true only after the user explicitly confirms the update."
                    ),
                },
            },
            "required": ["ticket_number"],
        },
    },
]


def dispatch_ticket_tool(target: Any, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    args = dict(arguments or {})
    if name == "check_ticket":
        return check_ticket(
            target,
            ticket_number=str(args.get("ticket_number", "")),
            include_recent_comments=bool(args.get("include_recent_comments", False)),
        )
    if name == "create_ticket":
        return create_ticket(
            target,
            customer_id=int(args["customer_id"]),
            category=str(args.get("category", "")),
            subject=str(args.get("subject", "")),
            description=str(args.get("description", "")),
            priority=str(args.get("priority", "")),
            confirmed=bool(args.get("confirmed", False)),
            assigned_team=args.get("assigned_team"),
            assigned_agent=args.get("assigned_agent"),
        )
    if name == "update_ticket":
        return update_ticket(
            target,
            ticket_number=str(args.get("ticket_number", "")),
            status=args.get("status"),
            priority=args.get("priority"),
            assigned_team=args.get("assigned_team"),
            assigned_agent=args.get("assigned_agent"),
            resolution=args.get("resolution"),
            comment=args.get("comment"),
            confirmed=bool(args.get("confirmed", False)),
        )
    return {"status": "error", "error": f"Unknown ticket tool: {name}"}
