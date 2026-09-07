"""Run sql-mcp stdio server."""

from sql_mcp.server import main

if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
