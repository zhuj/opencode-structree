#!/usr/bin/env python3
"""Exercise the shipped CLI with real OS pipes; Python 3 is only a test dependency."""

import json
import os
from pathlib import Path
import select
import subprocess
import tempfile

PROJECT = Path(__file__).resolve().parent.parent
BUN = os.environ.get("BUN_BIN", "bun")


def resolve_cli() -> str:
    """Resolve the CLI entry point against PROJECT because the subprocess runs in a temporary directory."""
    candidate = Path(os.environ.get("OBJECT_MCP_CLI", "src/cli.ts"))
    return str(candidate if candidate.is_absolute() else PROJECT / candidate)


CLI = resolve_cli()


def read_message(process, timeout=10):
    ready, _, _ = select.select([process.stdout], [], [], timeout)
    if not ready:
        raise AssertionError("Timed out waiting for MCP stdout")
    line = process.stdout.readline()
    if not line:
        raise AssertionError(
            "MCP stdout ended unexpectedly: " + process.stderr.read().decode()
        )
    return json.loads(line)


def send(process, message):
    process.stdin.write(json.dumps(message).encode() + b"\n")
    process.stdin.flush()


def call(process, request_id, method, params):
    send(
        process,
        {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
    )
    while True:
        response = read_message(process)
        if response.get("id") == request_id:
            assert "error" not in response, response
            return response["result"]


def run():
    with tempfile.TemporaryDirectory(prefix="object-mcp-stdio-") as directory:
        (Path(directory) / "objects").mkdir()
        config = Path(directory) / "config.json"
        config.write_text(
            json.dumps(
                {
                    "root": "objects",
                    "sqlite": {"path": "cache.sqlite"},
                    "embeddings": {"provider": "disabled"},
                    "sync": {"watch": True, "rescanIntervalMs": 0},
                }
            )
        )
        command = [BUN, CLI, "serve", "--config", str(config)]
        process = subprocess.Popen(
            command,
            cwd=directory,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            opened = call(
                process,
                1,
                "initialize",
                {
                    "protocolVersion": "2025-11-25",
                    "clientInfo": {"name": "stdio-smoke", "version": "1.0.0"},
                    "capabilities": {},
                },
            )
            assert opened["protocolVersion"] == "2025-11-25", opened
            send(process, {"jsonrpc": "2.0", "method": "notifications/initialized"})
            tools = call(process, 2, "tools/list", {})["tools"]
            assert len(tools) == 71
            assert {"objects_validate", "objects_materialize"} <= {
                tool["name"] for tool in tools
            }
            assert "objects_doctor" in {tool["name"] for tool in tools}
            assert {
                "objects_repair_plan",
                "objects_repair_apply",
                "objects_repair_rollback",
            } <= {tool["name"] for tool in tools}
            value = {
                "id": "stdio-test",
                "name": "stdio-test",
                "title": "CLI verification",
                "description": "Real stdio tool round trip",
                "createdAt": "2026-10-15T12:00:00.000Z",
                "updatedAt": "2026-10-15T12:00:00.000Z",
                "retiredAt": None,
                "tags": {},
                "metadata": {},
                "relations": {"partOf": None},
            }
            created = call(
                process,
                3,
                "tools/call",
                {
                    "name": "project_create",
                    "arguments": {
                        "object": value,
                        "body": "stdio verification content",
                    },
                },
            )
            assert not created.get("isError"), created
            stored = created["structuredContent"]
            assert (Path(directory) / "objects" / stored["path"]).is_file()
            resynced = call(
                process,
                30,
                "tools/call",
                {"name": "objects_resync", "arguments": {}},
            )
            assert not resynced.get("isError"), resynced
            searched = call(
                process,
                4,
                "tools/call",
                {
                    "name": "objects_search",
                    "arguments": {
                        "query": "verification",
                        "mode": "FULLTEXT",
                        "top_n": "1",
                    },
                },
            )
            assert searched["structuredContent"]["mode"] == "fulltext", searched
            assert isinstance(
                searched["structuredContent"]["indexGeneration"], (int, float)
            ), searched
            assert searched["structuredContent"]["hits"][0]["id"] == "stdio-test", (
                searched
            )
            assert searched["_meta"]["object-mcp/input-repair"]["repairs"], searched
            hit = searched["structuredContent"]["hits"][0]
            assert isinstance(hit["fulltextExcerpt"], str), searched
            assert "verification" in hit["fulltextExcerpt"], searched
            assert len(hit["fulltextExcerpt"]) <= 1200, searched
            assert "body" not in hit and hit["matchedChunk"] is None, searched
            validated = call(
                process, 6, "tools/call", {"name": "objects_validate", "arguments": {}}
            )
            assert not validated.get("isError"), validated
            assert validated["structuredContent"]["counts"]["complete"] == 1
            materialized = call(
                process,
                7,
                "tools/call",
                {"name": "objects_materialize", "arguments": {}},
            )
            assert not materialized.get("isError"), materialized
            assert materialized["structuredContent"]["published"] is True
            checked = call(
                process,
                8,
                "tools/call",
                {"name": "objects_materialize", "arguments": {"check": True}},
            )
            assert not checked.get("isError"), checked
            assert checked["structuredContent"]["clean"] is True
            assert checked["structuredContent"]["published"] is False
            deleted = call(
                process,
                5,
                "tools/call",
                {
                    "name": "project_delete",
                    "arguments": {
                        "id": "stdio-test",
                        "expected_checksum": stored["checksum"],
                    },
                },
            )
            assert deleted["structuredContent"]["deleted"] is True
            assert deleted["_meta"]["object-mcp/input-repair"]["repairs"], deleted
            process.stdin.close()
            assert process.wait(timeout=10) == 0, process.stderr.read().decode()
            for line in process.stdout:
                json.loads(line)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        # EOF must release the watcher even when no MCP server instance was negotiated.
        empty = subprocess.run(
            command, cwd=directory, input=b"", capture_output=True, timeout=10
        )
        assert empty.returncode == 0, empty.stderr.decode()
        assert not empty.stdout, empty.stdout.decode()

        # Crash a lock holder. A fresh CLI must reacquire the OS-backed lock without deleting any file.
        lock_path = Path(directory) / "objects" / ".object-mcp-lock.sqlite"
        source = "import Database from 'better-sqlite3'; const db = new Database(process.argv[1]); db.exec('BEGIN IMMEDIATE'); console.log('locked'); setInterval(() => {}, 1000);"
        holder = subprocess.Popen(
            [BUN, "-e", source, str(lock_path)],
            cwd=PROJECT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,
        )
        try:
            ready, _, _ = select.select([holder.stdout], [], [], 10)
            assert ready and holder.stdout.readline().strip() == b"locked", (
                "Lock holder did not start"
            )
            holder.kill()
            holder.wait(timeout=10)
            recovered = subprocess.run(
                [BUN, CLI, "sync", "--config", str(config)],
                cwd=directory,
                capture_output=True,
                timeout=10,
            )
            assert recovered.returncode == 0, recovered.stderr.decode()
            assert json.loads(recovered.stdout)["issues"] == []
        finally:
            if holder.poll() is None:
                holder.kill()
                holder.wait()
        print(
            json.dumps(
                {
                    "stdio": "passed",
                    "tools": len(tools),
                    "materialization": "passed",
                    "crud_and_search": "passed",
                    "lexical_excerpt": "passed",
                    "relaxed_arguments": "passed",
                    "eof_shutdown": "passed",
                    "crashed_lock_recovery": "passed",
                }
            )
        )


if __name__ == "__main__":
    run()
