"""Deterministic, rule-based schema -> tool compiler.

This is a Python port of the TypeScript `db-agent` manifest compiler
(see db-agent/src/manifest/ManifestCompiler.ts, introduced in commit
55632b8). The whole point of this module is to remove the runtime
"discover the schema, then write SQL" round trip that a generic
list_tables/describe_table/execute_read tool loop forces an LLM to do
on every single turn.

Instead, the schema is introspected ONCE (cached by schema_hash) and
compiled into a small, fixed set of named tools per table:

    get_<table>_by_id, list_<table>, count_<table>,
    create_<table>, update_<table>_by_id, delete_<table>_by_id

Each tool has a fully-specified JSON schema derived directly from the
column types, so a voice/chat LLM can call the exact tool it needs in
a single function-call turn instead of a multi-step discovery dance.

This intentionally does NOT use an LLM to decide what tools exist —
the mapping from schema shape to tool shape is deterministic and
testable, which keeps the safety-critical bits (which column is the
primary key, which columns are writable) fully predictable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .models import ColumnMeta, SchemaSnapshot, TableMeta

ToolOperation = Literal[
    "get_by_id",
    "list",
    "count",
    "create",
    "update_by_id",
    "delete_by_id",
]


@dataclass
class ToolParamSpec:
    name: str
    column_type: str
    required: bool = False
    is_filter: bool = False


@dataclass
class ToolDefinition:
    name: str
    description: str
    operation: ToolOperation
    table: str
    is_write: bool
    params: list[ToolParamSpec] = field(default_factory=list)


@dataclass
class ToolManifest:
    tenant_id: str
    version: int
    schema_hash: str
    generated_at: str
    tools: list[ToolDefinition] = field(default_factory=list)

    def find(self, name: str) -> ToolDefinition | None:
        return next((t for t in self.tools if t.name == name), None)


_SIMPLE_FILTERABLE_MARKERS = (
    "int",
    "char",
    "text",
    "bool",
    "date",
    "time",
    "uuid",
    "numeric",
    "decimal",
)


def _is_simple_filterable_type(data_type: str) -> bool:
    t = data_type.lower()
    return any(marker in t for marker in _SIMPLE_FILTERABLE_MARKERS)


def _param_for(column: ColumnMeta, required: bool, is_filter: bool = False) -> ToolParamSpec:
    return ToolParamSpec(
        name=column.name,
        column_type=column.data_type,
        required=required,
        is_filter=is_filter,
    )


def _tools_for_table(table: TableMeta) -> list[ToolDefinition]:
    pk = next((c for c in table.columns if c.is_primary_key), None)
    writable_columns = [c for c in table.columns if not c.is_primary_key]
    filterable_columns = [c for c in table.columns if _is_simple_filterable_type(c.data_type)]

    tools: list[ToolDefinition] = []

    if pk:
        tools.append(
            ToolDefinition(
                name=f"get_{table.name}_by_id",
                description=f"Fetch a single row from {table.name} by its {pk.name}.",
                operation="get_by_id",
                table=table.name,
                is_write=False,
                params=[_param_for(pk, required=True, is_filter=True)],
            )
        )
        tools.append(
            ToolDefinition(
                name=f"update_{table.name}_by_id",
                description=f"Update one or more fields on a {table.name} row identified by {pk.name}.",
                operation="update_by_id",
                table=table.name,
                is_write=True,
                params=[_param_for(pk, required=True, is_filter=True)]
                + [_param_for(c, required=False) for c in writable_columns],
            )
        )
        tools.append(
            ToolDefinition(
                name=f"delete_{table.name}_by_id",
                description=f"Delete a single row from {table.name} identified by {pk.name}.",
                operation="delete_by_id",
                table=table.name,
                is_write=True,
                params=[_param_for(pk, required=True, is_filter=True)],
            )
        )

    filter_names = ", ".join(c.name for c in filterable_columns) or "no simple columns"
    tools.append(
        ToolDefinition(
            name=f"list_{table.name}",
            description=f"List rows from {table.name}, optionally filtered by {filter_names}.",
            operation="list",
            table=table.name,
            is_write=False,
            params=[_param_for(c, required=False, is_filter=True) for c in filterable_columns],
        )
    )
    tools.append(
        ToolDefinition(
            name=f"count_{table.name}",
            description=f"Count rows in {table.name}, optionally filtered.",
            operation="count",
            table=table.name,
            is_write=False,
            params=[_param_for(c, required=False, is_filter=True) for c in filterable_columns],
        )
    )

    required_create_columns = {c.name for c in writable_columns if not c.is_nullable}
    tools.append(
        ToolDefinition(
            name=f"create_{table.name}",
            description=f"Insert a new row into {table.name}.",
            operation="create",
            table=table.name,
            is_write=True,
            params=[
                _param_for(c, required=c.name in required_create_columns)
                for c in writable_columns
            ],
        )
    )

    return tools


def compile_manifest(snapshot: SchemaSnapshot, previous_version: int = 0) -> ToolManifest:
    """Compile a schema snapshot into a deterministic tool manifest."""
    tools: list[ToolDefinition] = []
    for table in snapshot.tables:
        tools.extend(_tools_for_table(table))

    return ToolManifest(
        tenant_id=snapshot.tenant_id,
        version=previous_version + 1,
        schema_hash=snapshot.schema_hash,
        generated_at=snapshot.fetched_at,
        tools=tools,
    )


def _json_schema_type(sql_type: str) -> str:
    t = sql_type.lower()
    if any(marker in t for marker in ("int", "numeric", "decimal", "float", "double", "real")):
        return "number"
    if "bool" in t:
        return "boolean"
    return "string"


def to_raw_schema(tool: ToolDefinition) -> dict[str, Any]:
    """Convert a ToolDefinition into an OpenAI/Anthropic-style function schema.

    This is what actually gets handed to the LLM's function-calling API —
    the model only ever sees this small, fixed shape, never the tenant's
    raw schema.
    """
    properties: dict[str, Any] = {}
    for p in tool.params:
        properties[p.name] = {
            "type": _json_schema_type(p.column_type),
            "description": "filter value" if p.is_filter else f"{p.name} value",
        }

    required = [p.name for p in tool.params if p.required]

    if tool.is_write:
        properties["confirmed"] = {
            "type": "boolean",
            "description": (
                "Set to true only after the user has explicitly confirmed this change "
                "out loud. Leave false/omitted to preview the change first."
            ),
        }

    return {
        "name": tool.name,
        "description": tool.description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
        },
    }


def describe_manifest_for_prompt(manifest: ToolManifest, snapshot: SchemaSnapshot) -> str:
    """A compact, human-readable schema summary for the system prompt.

    Embedding this up front means the agent never has to spend a turn
    "discovering" table/column names — it already knows them.
    """
    lines = []
    for table in snapshot.tables:
        cols = ", ".join(f"{c.name} ({c.data_type})" for c in table.columns)
        lines.append(f"- {table.name}: {cols}")
    return "\n".join(lines)
