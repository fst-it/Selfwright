# Neo4j learning spike — graph vs pgvector for second-brain use (D17)

Decision D17 in the anchor: "Graph = Neo4j (deferred; learning; projection) — chosen over Apache AGE.
Industry standard worth learning; defer until relationship/second-brain use is real."
This document is the exploratory output that D17 called for. It is input to a future decision, not a
commitment. Success criterion: documented learning with a checkable verdict and concrete trigger
conditions.

Date: 2026-07-09. Phase 3 / T3.5.

---

## 1. What the current stack already answers

**Semantic retrieval (ADR 0009).** `sync-db` ETL embeds evidence entries and archetypes using
`nomic-embed-text` (768d, local via Ollama), upserts them into three Postgres tables
(`evidence`, `archetypes`, `cv_bullets`), and `searchByEmbedding` queries by cosine distance
(`<=>`). A JD passed through the same embedder can retrieve the five most semantically similar
evidence items without any keyword overlap. This is the core of tailoring.

**Concrete queries the current stack handles well today:**
- "Find the top-5 evidence entries most relevant to a given job description" (cosine search over `evidence`)
- "Find archetypes that best match this role's keywords" (cosine search over `archetypes`)
- "Find prior applications to roles similar to this one" — possible once `applications` rows in the
  projection get embeddings (the table exists; bullet-level embedding pipeline is deferred, ADR 0009)
- "What is my north-star interview-conversion rate by funnel stage?" (SQL over `applications`, ADR 0015)
- "Is fitness gate X passing or trending?" (SQL over `fitness_runs`, ADR 0015)
- "Which evidence items have I used across all applications?" — SQL join once a bridge table exists

**mem0 dynamic memory (ADR 0010).** The mem0 service runs against the same Postgres instance
(collection `mem0_memories`), storing session-learned facts as verbatim text, searchable by
vector similarity. Two MCP tools (`memory_add`, `memory_search`) expose this to any agent.

**What neither tool gives you:** any notion of a relationship as a first-class object you can
traverse. Cosine search finds semantically similar nodes; it cannot find a chain of nodes connected
by typed edges, e.g. "who introduced me to this company" or "what evidence items most support
this specific decision."

---

## 2. What a graph adds that pgvector cannot

A graph database stores typed, directed edges between named entities. This enables **multi-hop
traversal** — following chains of relationships across the graph — which is structurally impossible
in a vector store and painful in SQL without recursive CTEs.

Below are five concrete Selfwright queries, expressed in Cypher, that would be natural in a graph
but are expensive or impossible in the current Postgres schema. Each is followed by an honest
assessment of how hard the SQL workaround actually is.

---

**Q1. Referral chain — who can get me a warm intro at a target company?**

```cypher
MATCH (me:Person {id: 'me'})-[:KNOWS*1..2]->(contact:Person)-[:WORKS_AT]->(c:Company)
WHERE c.name IN ['Acme Corp', 'Globex']
RETURN contact.name, c.name, length(path) AS hops
ORDER BY hops
```

This is the single highest-value second-brain query for Selfwright — the anchor (§14) calls
out referrals as the binding constraint on a senior role. A 2-hop traversal surfaces contacts who
know contacts at target companies.

**SQL workaround:** a contacts table + a `knows` bridge table + a recursive CTE handles 1–2 hops
adequately. At 3+ hops or across hundreds of contacts, the CTE becomes slow and the query plan
opaque. For the current scale (a personal network of <500 people), a recursive CTE in Postgres
is *entirely sufficient*.

**Verdict on Q1:** graph is the elegant path; SQL is adequate at personal-network scale.

---

**Q2. Evidence provenance — what evidence supported which application decisions?**

```cypher
MATCH (ev:Evidence {id: 'EVD-042'})-[:USED_IN]->(app:Application)-[:FOR_COMPANY]->(c:Company)
RETURN app.role, c.name, app.status
```

Useful for answering "which evidence items are load-bearing across my pipeline" and "did the
applications where I used EVD-042 perform better than those that didn't?"

**SQL workaround:** an `application_evidence` bridge table (many-to-many) and a standard JOIN
gives the same result with no additional complexity. There is no multi-hop requirement here —
it is a two-table join. A graph adds no structural advantage.

**Verdict on Q2:** a bridge table in Postgres is the right tool. Graph adds nothing.

---

**Q3. Archetype path — what does the learning path from current skills to a target archetype look like?**

```cypher
MATCH p = shortestPath(
  (skill:Skill {id: 'ts-advanced'})-[:LEADS_TO*]->(arch:Archetype {id: 'ARCH-staff-eng'})
)
RETURN [n in nodes(p) | n.label] AS path
```

Useful once a skill dependency graph is modeled — "what skills do I need to close before I'm
credible for the Staff Engineer archetype?"

**SQL workaround:** with a `skill_prerequisites` adjacency table, a recursive CTE computes
shortest paths in Postgres. This is well within SQL's capabilities for acyclic skill graphs of
reasonable depth (<10 levels).

**Verdict on Q3:** SQL is sufficient for the likely depth. Graph becomes more ergonomic if the
skill graph is large and cycles are possible (PostgreSQL's recursive CTEs require a cycle guard).

---

**Q4. Coaching lineage — which gaps are still open after all drills this month?**

```cypher
MATCH (gap:Gap)-[:ADDRESSED_BY]->(drill:Drill)
WHERE drill.completed_at > date() - duration('P30D')
  AND NOT (gap)-[:RESOLVED]->()
RETURN gap.label, count(drill) AS attempts
```

Answers "what am I drilling but not closing?" — the residual gap query the coaching engine would
surface automatically.

**SQL workaround:** a `gaps` table, a `drills` table, a `gap_drill` bridge table, and a standard
GROUP BY + NOT EXISTS query. This is routine SQL; no recursive traversal. A graph adds nothing
except that the same query reads more cleanly in Cypher.

**Verdict on Q4:** SQL is the right tool. Graph adds ergonomic readability only.

---

**Q5. Contact relationship graph — who introduced whom in my network?**

```cypher
MATCH (a:Person)-[r:INTRODUCED]->(b:Person)-[:REFERRED]->(app:Application)
RETURN a.name AS introducer, b.name AS referrer, app.company AS company, r.context
```

Builds a provenance graph of intros — useful for understanding channel effectiveness and for
expressing genuine gratitude.

**SQL workaround:** a self-referential `contacts` table with an `introduced_by` FK plus an
`applications.referred_by` column handles the first hop. A recursive CTE handles multi-hop intro
chains. Adequate at personal-network scale.

**Verdict on Q5:** SQL is adequate for personal-network scale; graph becomes meaningfully better
once the contact graph grows to hundreds of nodes with many intro chains.

---

**Summary of the five queries.** Only Q1 and Q5 represent cases where a graph database offers
a structural advantage over Postgres. In both, the advantage materialises at scale (many contacts,
many companies, multi-hop traversal). At Selfwright's current and near-term scale — one user,
<500 contacts, <50 target companies — a recursive CTE in Postgres is adequate for every query
above. The case for Neo4j depends on two Phase-4 preconditions: (a) a contacts/CRM module
actually exists, and (b) the network is large enough that recursive CTEs become slow or
error-prone.

---

## 3. mem0's graph-memory option

This section is the most important factual finding in the spike. The answer changed between the
time D17 was written (anchor, 2026-06-26) and today (2026-07-09).

**What existed in mem0 v2.** Earlier releases of the `mem0ai` Python library exposed a
`graph_store` configuration key accepting an external Neo4j or Memgraph backend. Enabling this
caused mem0 to extract entities from memories and write nodes/edges to Neo4j alongside the
vector store, enabling relationship-aware retrieval.

**What mem0 v3 changed.** The current release — mem0ai 2.0.11 (released 2026-07-01,
[PyPI](https://pypi.org/project/mem0ai/)) — completely removed external graph store support.
The migration guide states: "External graph store support has been removed from the open-source
SDK and replaced by built-in graph memory." The `enable_graph` and `graph_store` config keys
no longer exist. Approximately 4,000 lines of Neo4j/Memgraph integration code are gone.
([Migration guide](https://docs.mem0.ai/migration/oss-v2-to-v3))

**What "graph memory" means in v3.** The library now performs entity extraction internally and
stores entities in a parallel vector collection (`{collection_name}_entities`) in the same
pgvector store. Entity connections are applied through retrieval ranking adjustments, not as a
traversable graph structure. The `relations` field on search results no longer exists.

**What this means for Selfwright.** The `infra/mem0-service/main.py` pins `mem0ai>=0.1.0` in
`requirements.txt`. When the Docker image is built, pip will resolve this to v2.0.11 (the
latest satisfying `>=0.1.0`). The current deployment is therefore a v3-era mem0 instance with
no external graph backend available — even if we wanted to add one, the configuration key no
longer exists in the library we already depend on.

**Architectural fork assessment.** The "mem0-graph via Neo4j" path D17 implicitly assumed no
longer exists as a first-class library option. The two paths are now:

| Path | What it means today |
|---|---|
| "mem0-graph" | Built-in entity linking in pgvector (already present in v3, no extra service) |
| "raw Neo4j alongside" | A separate Neo4j Docker service, no mem0 integration, custom TS adapter in `packages/adapters/storage-neo4j/` |

There is no hybrid path where mem0 writes to Neo4j transparently. The graph-via-mem0 architectural
shortcut is closed.

---

## 4. License and ops reality check

### Neo4j Community Edition license

Neo4j Community Edition is licensed under **GPLv3** (GNU General Public License v3).
([GitHub — neo4j/neo4j](https://github.com/neo4j/neo4j))

GPLv3 is a copyleft license. The obligation it imposes is: if you *distribute* a binary that
incorporates or links GPLv3 code, your entire derivative work must also be released under GPLv3.
For Selfwright's situation this matters in two ways:

- **Running Neo4j as a Docker service (today):** the server license does not infect client code.
  Connecting to Neo4j over the Bolt protocol from a TypeScript adapter does not make that adapter
  a derivative of the GPLv3 server. The Neo4j Bolt driver for JavaScript/TypeScript is licensed
  under **Apache 2.0** ([neo4j/neo4j-javascript-driver](https://github.com/neo4j/neo4j-javascript-driver)),
  so importing it into `packages/adapters/storage-neo4j/` imposes no copyleft restriction.
  Running the server for personal use has no distribution requirement. Posture: same as Metabase's
  AGPL at arm's length — keep it as a separate Docker service, never import the server binary.

- **At Phase 4 open-source release:** confirm that the adapter only imports the Apache-2.0 driver,
  not any GPLv3 server library. As long as the driver is the only Neo4j dependency in `packages/`,
  open-sourcing the framework is clean.

The anchor (§8) says "flag AGPL dependencies and keep them at arm's length." GPLv3 is less
restrictive than AGPL for networked services (AGPL closes the "service loophole" that GPLv3 has).
The arm's-length rule applies: run Neo4j as a separate Docker service, never call any GPLv3
library directly from `packages/` or `apps/`.

There is an ongoing legal dispute about neo4j's rights to add Commons Clause restrictions on top
of AGPL for Enterprise Edition. That dispute does not affect Community Edition's GPLv3 license.
([The Register, 2025-02-27](https://www.theregister.com/software/2025/02/27/adverse-appeals-court-ruling-could-kill-gpl-software-license/430527))

### Memory footprint

Neo4j Community Edition's Docker defaults are: `NEO4J_server_memory_heap_max__size=512M` and
`NEO4J_server_memory_pagecache_size=512M`. For 16 GB of system RAM, Neo4j's own `memrec` tool
recommends: heap 5G + pagecache 7G = 12 GB allocated to Neo4j alone.
([Neo4j Operations Manual — memory recommendations](https://neo4j.com/docs/operations-manual/current/tools/neo4j-admin/neo4j-admin-memrec/))

The current Selfwright Docker Compose stack, on the 16 GB / 6-core reference baseline (D29), already runs:
Postgres (pgvector projection + mem0 memories), Ollama (llama3.2:3b + nomic-embed-text), mem0
FastAPI service, Metabase (JVM, ~512 MB–1 GB), and optionally LiteLLM. The machine has known
RAM pressure when multiple services are active (noted in session memory). Adding Neo4j at even
its development minimum (1.5 GB heap + pagecache) would stress this machine. At the recommended
settings it would not fit.

A practical development configuration (`heap=1g`, `pagecache=512m`) is feasible but means Neo4j
runs in degraded mode — fine for learning, not representative of real workloads.

### Apache AGE — has anything changed since D17?

D17 rejected Apache AGE in favour of Neo4j with the rationale "industry standard worth learning;
defer until relationship/second-brain use is real."

Since the anchor was written (2026-06-26), AGE has gained Azure Database for PostgreSQL support
([Microsoft Learn](https://learn.microsoft.com/en-us/azure/postgresql/azure-ai/generative-ai-age-overview))
and Snowflake published a deep-dive on using it in production (May 2026). It now supports
PostgreSQL 11 through 18. Its license is Apache 2.0 — more permissive than Neo4j's GPLv3 —
and it requires no new Docker service (a Postgres extension install).

The D17 rationale still holds, but one thing deserves an honest acknowledgment: for the actual
queries Selfwright needs (§2 above), Apache AGE would eliminate the "new Docker service" ops
cost entirely, since Postgres already runs. If the goal were purely to add graph queries to the
projection at minimum cost, AGE would be the simpler path. D17 explicitly chose Neo4j over AGE
for its learning value as an industry-standard graph database. That is a valid goal, but it is a
*learning* goal, not a capability goal — and that distinction matters when deciding when to reopen.

---

## 5. Verdict and trigger conditions

**Verdict: stay deferred.**

The concrete case for Neo4j today does not exist:

1. No contacts/CRM data is modeled. The only queries that benefit structurally from a graph
   (Q1, Q5 — multi-hop contact/referral traversal) require a contact relationship model that
   Phase 4 has not built yet.
2. mem0 v3 removed Neo4j integration. The "graph via mem0" shortcut is gone.
3. The current Postgres + pgvector stack handles all actual Phase 3 retrieval needs (coaching
   context, gap/drill lookups, archetype matching).
4. Adding a Neo4j container on this 16 GB machine adds 1.5–2 GB of JVM RAM for no active use case.

**Recommendation if graph queries become desirable before Phase 4:** consider Apache AGE as a
Postgres extension first. It adds openCypher queries over the existing Postgres projection with
no new service, Apache 2.0 license, and adequate performance for bounded traversals (<10 hops,
<500 contacts). The D17 "learn Neo4j" goal is legitimate but orthogonal to shipping — it can
be pursued in isolation on the dev machine, not as a required infra dependency.

**Trigger conditions to reopen D17 (all three must be true):**

1. **A Phase-4 contacts/CRM module ships.** People, introductions, and referral chains are
   modeled as first-class data objects (not just free-text notes). Without this data, there are
   no graph edges to traverse.

2. **The contact graph reaches meaningful scale or depth.** Specifically: >200 tracked contacts,
   OR multi-hop referral queries (3+ hops) are needed, OR recursive CTEs on the `contacts` table
   produce query plans that take >500ms on real data. Below these thresholds, recursive SQL is
   adequate and the operational overhead of Neo4j is not justified.

3. **The RAM constraint is resolved.** Either the machine has been upgraded (from 16 GB to 32 GB+),
   or selective service management (start Neo4j only when needed) is acceptable to the owner.
   Running Neo4j alongside Ollama + Postgres + Metabase on 16 GB requires careful heap capping
   that degrades graph performance and impedes learning.

When all three conditions are met, revisit this spike. At that point the decision between raw Neo4j
(D17's choice, learning value, native graph) and Apache AGE (simpler ops, permissive license,
sufficient for bounded traversal) deserves a fresh comparison given the actual query patterns in
the contact graph.

---

## Sources

- Neo4j Community Edition license (GPLv3): [GitHub — neo4j/neo4j](https://github.com/neo4j/neo4j)
- Neo4j memory recommendations for Docker: [Neo4j Operations Manual — memory](https://neo4j.com/docs/operations-manual/current/tools/neo4j-admin/neo4j-admin-memrec/)
- Neo4j JavaScript driver (Apache 2.0): [npm — neo4j-driver](https://www.npmjs.com/package/neo4j-driver)
- mem0 v3 migration guide (external graph store removed): [docs.mem0.ai — migration/oss-v2-to-v3](https://docs.mem0.ai/migration/oss-v2-to-v3)
- mem0ai current version (2.0.11, 2026-07-01): [PyPI — mem0ai](https://pypi.org/project/mem0ai/)
- mem0 Neo4j backend bug (open issue, March 2026): [GitHub — mem0ai/mem0 #4232](https://github.com/mem0ai/mem0/issues/4232)
- mem0 graph store configuration removed from OSS: [GitHub — mem0ai/mem0 #4070](https://github.com/mem0ai/mem0/issues/4070)
- Apache AGE license (Apache 2.0) and PostgreSQL support: [age.apache.org](https://age.apache.org/overview/)
- Apache AGE on Azure Database for PostgreSQL: [Microsoft Learn](https://learn.microsoft.com/en-us/azure/postgresql/azure-ai/generative-ai-age-overview)
- Neo4j Enterprise Edition licensing dispute (GPLv3/AGPL/Commons Clause): [The Register, 2025-02-27](https://www.theregister.com/software/2025/02/27/adverse-appeals-court-ruling-could-kill-gpl-software-license/430527)
- FalkorDB as mem0 graph alternative: [falkordb.com](https://www.falkordb.com/blog/graph-memory-llm-agents-mem0-falkordb/)
