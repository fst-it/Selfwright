"""Thin FastAPI wrapper around the mem0ai library, configured fully local
(Ollama LLM + Ollama embedder + pgvector), per ADR 0010. This exists because
mem0's official self-hosted Docker image hard-requires OPENAI_API_KEY with no
local-model substitution path short of rebuilding the image from source.

Single-user system: every memory is scoped to one fixed user_id, since
Selfwright has no multi-tenant concept to map onto mem0's user_id/agent_id/
run_id filters.
"""

import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from mem0 import Memory
from pydantic import BaseModel

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434")
POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT = int(os.environ.get("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.environ.get("POSTGRES_DB", "selfwright")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "selfwright")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "selfwright")

MEM0_SERVICE_TOKEN = os.environ.get("MEM0_SERVICE_TOKEN")
# MEM0_ALLOW_NO_AUTH=1 must be set explicitly to run without a token.
# The service port is loopback-only per docker-compose.yml (127.0.0.1:8050:8050),
# so unauthenticated access is only possible from the same machine.
# Residual risk: if the Docker port is later forwarded externally (e.g. via -p 8050:8050
# overriding the loopback bind, or a reverse proxy), no-auth becomes a network exposure.
MEM0_ALLOW_NO_AUTH = os.environ.get("MEM0_ALLOW_NO_AUTH", "").strip() == "1"
if not MEM0_SERVICE_TOKEN:
    if not MEM0_ALLOW_NO_AUTH:
        print(
            "ERROR: MEM0_SERVICE_TOKEN is not set and MEM0_ALLOW_NO_AUTH is not 1. "
            "Set MEM0_SERVICE_TOKEN for token auth, or set MEM0_ALLOW_NO_AUTH=1 to "
            "explicitly allow unauthenticated access (safe only when the port is not "
            "forwarded externally beyond the loopback bind in docker-compose.yml).",
            file=sys.stderr,
        )
        sys.exit(1)
    print(
        "WARNING: MEM0_SERVICE_TOKEN is not set — mem0 service running without auth "
        "(MEM0_ALLOW_NO_AUTH=1; port is loopback-only per docker-compose.yml).",
        file=sys.stderr,
    )

USER_ID = "selfwright"

CONFIG = {
    "llm": {
        "provider": "ollama",
        "config": {
            "model": "llama3.2:3b",
            "ollama_base_url": OLLAMA_BASE_URL,
        },
    },
    "embedder": {
        "provider": "ollama",
        "config": {
            "model": "nomic-embed-text",
            "embedding_dims": 768,
            "ollama_base_url": OLLAMA_BASE_URL,
        },
    },
    "vector_store": {
        "provider": "pgvector",
        "config": {
            "dbname": POSTGRES_DB,
            "collection_name": "mem0_memories",
            "embedding_model_dims": 768,
            "user": POSTGRES_USER,
            "password": POSTGRES_PASSWORD,
            "host": POSTGRES_HOST,
            "port": POSTGRES_PORT,
        },
    },
}

memory = Memory.from_config(CONFIG)

app = FastAPI(title="Selfwright mem0 service")


def verify_token(authorization: Optional[str] = Header(default=None)) -> None:
    if not MEM0_SERVICE_TOKEN:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if authorization[len("Bearer "):] != MEM0_SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


class AddRequest(BaseModel):
    content: str
    metadata: Optional[dict[str, str]] = None


class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = 10


class ListRequest(BaseModel):
    filter: Optional[dict[str, str]] = None


def _entry_from_add(item: dict[str, Any], metadata: Optional[dict[str, str]]) -> dict[str, Any]:
    # add()'s ADD-event items carry neither created_at nor metadata (unlike search()/
    # get_all() results), so metadata comes from what the caller already sent.
    return {
        "id": item["id"],
        "content": item.get("memory", ""),
        "metadata": metadata,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }


def _entry_from_stored(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "content": item.get("memory", ""),
        "metadata": item.get("metadata"),
        "createdAt": item.get("created_at") or datetime.now(timezone.utc).isoformat(),
    }


def _matches_filter(item: dict[str, Any], filter_: Optional[dict[str, str]]) -> bool:
    if not filter_:
        return True
    metadata = item.get("metadata") or {}
    return all(metadata.get(key) == value for key, value in filter_.items())


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/memories", dependencies=[Depends(verify_token)])
def add_memory(req: AddRequest) -> dict[str, Any]:
    try:
        # infer=False stores the content verbatim as one memory, so add() always
        # returns exactly one result — matching MemoryPort's one-entry-per-add contract.
        result = memory.add(req.content, user_id=USER_ID, metadata=req.metadata, infer=False)
        created = result["results"][0]
        return _entry_from_add(created, req.metadata)
    except Exception as exc:
        print(f"ERROR: add_memory failed: {type(exc).__name__}", file=sys.stderr)
        raise


@app.post("/search", dependencies=[Depends(verify_token)])
def search_memory(req: SearchRequest) -> dict[str, Any]:
    try:
        # search() (unlike add()) rejects top-level entity kwargs — user_id must go in filters.
        result = memory.search(req.query, filters={"user_id": USER_ID}, top_k=req.top_k or 10)
        return {
            "results": [
                {"entry": _entry_from_stored(item), "score": item.get("score", 0.0)}
                for item in result["results"]
            ]
        }
    except Exception as exc:
        print(f"ERROR: search_memory failed: {type(exc).__name__}", file=sys.stderr)
        raise


@app.post("/memories/list", dependencies=[Depends(verify_token)])
def list_memories(req: ListRequest) -> dict[str, Any]:
    try:
        result = memory.get_all(filters={"user_id": USER_ID}, top_k=10000)
        if len(result["results"]) >= 10000:
            print("WARNING: memory list may be truncated — result count hit the 10000 cap", file=sys.stderr)
        items = [item for item in result["results"] if _matches_filter(item, req.filter)]
        return {"results": [_entry_from_stored(item) for item in items]}
    except Exception as exc:
        print(f"ERROR: list_memories failed: {type(exc).__name__}", file=sys.stderr)
        raise
