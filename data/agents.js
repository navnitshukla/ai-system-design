/* Agents & Memory */
window.QUESTIONS.push(

/* ------------------------------------------------------------------ Q9 */
{
  id: "agent-wrong-tool",
  section: "agents",
  title: "Your data agent keeps querying the semantic model when it should search documents (and vice versa). How do you fix tool selection?",
  scenario: "A Cortex Agent has a Cortex Analyst tool over sales data and a Cortex Search tool over contracts. “What’s the renewal clause for Acme?” goes to SQL; “Q3 revenue for Acme” goes to document search.",
  tags: ["agents", "tool design", "schemas", "few-shot", "guardrails", "cortex agents"],
  level: "Core",
  tests: "Whether you debug the full trajectory and fix tool design, rather than “just retrain the model”.",
  tldr: "Trace the trajectory (input → plan → tool → args → response → answer). The usual cause is poor tool design: vague descriptions, overlap, weak schemas, no examples. Make boundaries clear, strengthen schemas (required args, enums, validation), add few-shot examples, and guard high-risk tools.",
  answer: [
    { h: "Debug the trajectory", items: ["User input → planning step → selected tool → generated arguments → tool response → final answer."] },
    { h: "Common causes", items: ["Vague tool descriptions", "Overlapping responsibilities", "Weak parameter schemas", "Missing usage examples"] },
    { h: "Fixes, in order", items: [
      "One clear responsibility per tool.",
      "Strong schemas: required arguments, enums, validation before execution.",
      "Few-shot examples of correct tool selection.",
      "Confirmation / policy checks for high-risk tools."
    ]}
  ],
  tradeoff: "Stronger constraints improve reliability but add latency, tokens, cost and engineering complexity.",
  takeaway: "Wrong tool calls are usually a tool-design bug, not a model bug.",
  hld: {
    caption: "Trace each step; fix at the layer where it breaks.",
    lanes: [
      { name: "Trajectory", cols: [
        [N("User input", "", "user")],
        [N("Plan", "", "model")],
        [N("Tool selection", "descriptions · examples", "decide")],
        [N("Arguments", "schema · enums", "guard")],
        [N("Policy check", "", "guard")],
        [N("Tool response", "")],
        [N("Answer", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Inspect agent traces, rewrite tool descriptions and orchestration instructions, then measure tool-selection accuracy on a routing test set.",
    lanes: [
      { name: "Diagnose", cols: [
        [N("Agent traces", "AI Observability / monitoring", "store")],
        [N("Mis-routed questions", "", "guard")],
        [N("Root cause", "overlap · vague description", "decide")]
      ]},
      { name: "Fix", cols: [
        [N("Tool descriptions", "what · when · when NOT")],
        [N("Orchestration instructions", "routing rules + examples")],
        [N("Typed custom tools", "enums · required", "guard")]
      ]},
      { name: "Verify", cols: [
        [N("ROUTING_TESTS", "question → expected tool", "store")],
        [N("Run agent", "", "model")],
        [N("Tool accuracy %", "before vs after", "out")]
      ]}
    ],
    objects: [
      ["AISD.OPS.SALES_AGENT", "Cortex Agent", "Two tools: sales_analyst (Cortex Analyst) and contract_search (Cortex Search)"],
      ["AISD.EVAL.ROUTING_TESTS", "Table", "Question, expected_tool — regression set for routing"],
      ["Agent traces", "Observability", "Which tool was picked, with what arguments"]
    ],
    code: [
      { title: "Before → after: tool descriptions", lang: "yaml", src:
`# BEFORE (overlapping, vague)
- name: sales_analyst
  description: Answers questions about customers.
- name: contract_search
  description: Finds information about customers.

# AFTER (clear boundaries, explicit negatives)
- name: sales_analyst
  description: >
    Numeric / tabular questions over SALES data: revenue, bookings, pipeline,
    counts, trends, rankings by account, region or quarter.
    Do NOT use for contract wording, clauses or legal terms.
- name: contract_search
  description: >
    Text of signed contracts: clauses, renewal terms, SLAs, termination,
    pricing terms as written. Do NOT use for revenue or any aggregation.` },
      { title: "Orchestration instructions with examples", lang: "yaml", src:
`instructions:
  orchestration: >
    Route by the type of answer needed.
    Numbers, metrics, trends -> sales_analyst.
    Wording of agreements -> contract_search.
    If the question needs both, call sales_analyst first, then contract_search.
    Examples:
      "Q3 revenue for Acme"                 -> sales_analyst
      "Acme renewal notice period"          -> contract_search
      "Is Acme's spend above its commit?"   -> sales_analyst, then contract_search` },
      { title: "Routing regression set", lang: "sql", src:
`CREATE TABLE IF NOT EXISTS AISD.EVAL.ROUTING_TESTS (
  question STRING, expected_tool STRING, actual_tool STRING, run_id STRING);

SELECT run_id,
       AVG(IFF(actual_tool = expected_tool, 1, 0)) AS tool_accuracy
FROM AISD.EVAL.ROUTING_TESTS
GROUP BY run_id ORDER BY run_id;` }
    ],
    notes: [
      "Descriptions should say when NOT to use a tool — negatives fix most overlaps.",
      "Keep a routing regression set; every mis-route found in production becomes a test.",
      "For custom procedure tools, use enums and required parameters in input_schema so bad arguments fail fast."
    ]
  },
  build: { status: "planned", steps: [
    "Create the agent with deliberately vague tool descriptions.",
    "Measure routing accuracy on 30 questions.",
    "Rewrite descriptions + instructions; re-measure and show the trace difference."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q10 */
{
  id: "agent-failure-recovery",
  section: "agents",
  title: "A multi-step AI pipeline (extract → enrich → write back) fails halfway. How do you design it to recover?",
  scenario: "A nightly agentic workflow extracts fields from invoices with AI functions, enriches them via a vendor API, and writes results back. The vendor API times out at step 3 of 5 and the whole run restarts from scratch.",
  tags: ["reliability", "retries", "checkpoints", "fallbacks", "human handoff", "tasks"],
  level: "Advanced",
  tests: "Whether you design for recovery, not just the happy path.",
  tldr: "Classify the failure: transient → bounded retries with backoff; permanent → change path, don’t retry. Persist state and checkpoints so a failure at step 3 resumes from step 3. Build fallbacks: alternate tools, then human handoff.",
  answer: [
    { h: "Classify the failure", items: ["Transient (timeout): bounded retries with exponential backoff.", "Permanent (invalid input): don’t retry — route to another path."] },
    { h: "Resumability", items: ["Persist state + checkpoints; resume from the last successful step."] },
    { h: "Fallbacks", items: ["Alternate tool if one fails.", "Human handoff when automation can’t complete."] }
  ],
  tradeoff: "Better recovery improves reliability but requires state management, checkpoints and more workflow complexity.",
  takeaway: "Design for recovery, not just success.",
  hld: {
    caption: "Failure classification drives the recovery strategy.",
    lanes: [
      { name: "Recovery", cols: [
        [N("Step N fails", "", "user")],
        [N("Classify", "transient / permanent", "decide")],
        [N("Retry + backoff", "bounded"), N("Alternate path", "fallback")],
        [N("Checkpoint store", "", "store")],
        [N("Still failing?", "", "decide")],
        [N("Human handoff", "", "user"), N("Continue", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "A task graph with one task per step; each step is idempotent, records a checkpoint, and classifies its own failures.",
    lanes: [
      { name: "Task graph", cols: [
        [N("T_EXTRACT", "AI_EXTRACT", "model")],
        [N("T_ENRICH", "vendor API · retries", "proc")],
        [N("T_VALIDATE", "rules", "guard")],
        [N("T_WRITEBACK", "MERGE", "proc")],
        [N("T_FINALIZE", "notify", "out")]
      ]},
      { name: "State", cols: [
        [N("RUN_CHECKPOINTS", "run_id · step · status", "store")],
        [N("Skip completed steps", "on re-run", "decide")],
        [N("DEAD_LETTER", "permanent failures", "guard")],
        [N("Review app", "Streamlit", "user")]
      ]}
    ],
    objects: [
      ["AISD.WF.RUN_CHECKPOINTS", "Table", "One row per (run_id, step, item) with status and error class"],
      ["AISD.WF.DEAD_LETTER", "Table", "Items that failed permanently, for human review"],
      ["AISD.WF.T_EXTRACT … T_FINALIZE", "Task graph", "One task per step; root task retries on failure"],
      ["AISD.WF.ENRICH_ITEM", "Python procedure", "Calls vendor API with bounded backoff, classifies errors"]
    ],
    code: [
      { title: "Checkpoints + dead letter", lang: "sql", src:
`CREATE SCHEMA IF NOT EXISTS AISD.WF;

CREATE TABLE IF NOT EXISTS AISD.WF.RUN_CHECKPOINTS (
  run_id STRING, step STRING, item_id STRING,
  status STRING,              -- DONE | RETRYING | FAILED_PERMANENT
  error_class STRING, error_msg STRING, attempts INT,
  updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP());

CREATE TABLE IF NOT EXISTS AISD.WF.DEAD_LETTER LIKE AISD.WF.RUN_CHECKPOINTS;` },
      { title: "Task graph with retries", lang: "sql", src:
`CREATE OR REPLACE TASK AISD.WF.T_EXTRACT
  WAREHOUSE = AISD_WH SCHEDULE = 'USING CRON 0 2 * * * UTC'
  TASK_AUTO_RETRY_ATTEMPTS = 2
AS CALL AISD.WF.RUN_STEP('extract');

CREATE OR REPLACE TASK AISD.WF.T_ENRICH  WAREHOUSE = AISD_WH AFTER AISD.WF.T_EXTRACT
AS CALL AISD.WF.RUN_STEP('enrich');

CREATE OR REPLACE TASK AISD.WF.T_WRITEBACK WAREHOUSE = AISD_WH AFTER AISD.WF.T_ENRICH
AS CALL AISD.WF.RUN_STEP('writeback');
-- RUN_STEP processes only items with no DONE checkpoint for this step,
-- so a retried graph resumes instead of redoing work.` },
      { title: "Classify + bounded backoff (Python step)", lang: "python", src:
`import time, requests

TRANSIENT = (requests.Timeout, requests.ConnectionError)

def enrich(item, max_attempts=4):
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.get(VENDOR_URL, params={"id": item["vendor_id"]}, timeout=5)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.ConnectionError(f"retryable {r.status_code}")
            if r.status_code >= 400:
                return ("FAILED_PERMANENT", f"bad request {r.status_code}")   # don't retry
            return ("DONE", r.json())
        except TRANSIENT as e:
            if attempt == max_attempts:
                return ("FAILED_PERMANENT", f"exhausted retries: {e}")
            time.sleep(min(2 ** attempt, 30))                                  # exponential backoff` }
    ],
    notes: [
      "Idempotency is what makes resume safe: every step checks checkpoints and uses MERGE, never blind INSERT.",
      "TASK_AUTO_RETRY_ATTEMPTS retries the whole graph; checkpoints make that retry cheap.",
      "Permanent failures go to DEAD_LETTER and a review app, not into infinite retries.",
      "Fallback example: if the vendor API is down, enrich from a cached snapshot table and mark the record ‘stale’."
    ]
  },
  build: { status: "planned", steps: [
    "Build a 4-step graph over 1,000 sample invoices.",
    "Inject vendor timeouts and some invalid records.",
    "Show resume-from-checkpoint and the dead-letter review app."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q11 */
{
  id: "agent-memory-design",
  section: "agents",
  title: "Design memory for an account-research agent that sales teams use every day",
  scenario: "Account executives ask an agent to prepare briefs, track open questions and remember preferences (“always show ARR in EUR”). Multiple agents (researcher, writer, reviewer) collaborate on each brief.",
  tags: ["memory", "short-term", "long-term", "shared", "episodic"],
  level: "Advanced",
  tests: "Whether you treat memory as layered architecture rather than “just a vector DB”.",
  tldr: "Four layers: short-term (working context in the window), long-term (persistent preferences/facts retrieved when relevant), shared (coordination between agents), episodic (timestamped past executions to learn from). Different memory types solve different problems.",
  answer: [
    { h: "1. Short-term", items: ["Current objective, recent tool outputs, intermediate reasoning, pending steps.", "Lives in the context window."] },
    { h: "2. Long-term", items: ["Preferences, learned facts, history, past decisions.", "Stored externally, retrieved only when relevant."] },
    { h: "3. Shared", items: ["Coordination layer between agents: progress and intermediate outputs."] },
    { h: "4. Episodic", items: ["Timestamped records of past runs the system can learn from."] }
  ],
  tradeoff: "Better memory improves context quality but increases storage, retrieval complexity and consistency challenges.",
  takeaway: "Use different memory types for different problems.",
  hld: {
    caption: "The agent reads from and writes to four memory layers.",
    lanes: [
      { name: "Memory", cols: [
        [N("User / task", "", "user")],
        [N("Agent", "", "model")],
        [N("Short-term", "context", "store"), N("Long-term", "external", "store"), N("Shared", "blackboard", "store"), N("Episodic", "runs", "store")],
        [N("Context assembly", "")],
        [N("Response", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Threads hold short-term context; tables hold long-term, shared and episodic memory; Cortex Search retrieves relevant long-term memories.",
    lanes: [
      { name: "Stores", cols: [
        [N("Agent thread", "short-term · per conversation", "store")],
        [N("USER_MEMORY", "facts · prefs · confidence", "store")],
        [N("MEMORY_SEARCH", "Cortex Search on USER_MEMORY", "store")],
        [N("TASK_BOARD", "hybrid table · shared", "store")],
        [N("EPISODES", "run log · outcome", "store")]
      ]},
      { name: "Turn", cols: [
        [N("AE request", "", "user")],
        [N("Load prefs", "MEMORY_SEARCH · filter user", "guard")],
        [N("Researcher → Writer → Reviewer", "read/write TASK_BOARD", "model")],
        [N("Extract new memories", "AI_COMPLETE", "model")],
        [N("Log episode", "", "out")]
      ]}
    ],
    objects: [
      ["Cortex Agents threads", "Agents API", "Short-term conversation context"],
      ["AISD.MEM.USER_MEMORY", "Table", "user_name, memory_text, kind, source, confidence, updated_at, last_used_at"],
      ["AISD.MEM.MEMORY_SEARCH", "Cortex Search Service", "Relevance-based recall; filter by user_name"],
      ["AISD.MEM.TASK_BOARD", "Hybrid table", "Low-latency row updates for multi-agent coordination"],
      ["AISD.MEM.EPISODES", "Table", "Timestamped run history with outcome and feedback"]
    ],
    code: [
      { title: "Memory stores", lang: "sql", src:
`CREATE SCHEMA IF NOT EXISTS AISD.MEM;

CREATE TABLE IF NOT EXISTS AISD.MEM.USER_MEMORY (
  memory_id STRING DEFAULT UUID_STRING(), user_name STRING,
  kind STRING,                  -- preference | fact | decision
  memory_text STRING, source STRING, confidence FLOAT,
  updated_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(), last_used_at TIMESTAMP_LTZ);

CREATE OR REPLACE CORTEX SEARCH SERVICE AISD.MEM.MEMORY_SEARCH
  ON memory_text ATTRIBUTES user_name, kind
  WAREHOUSE = AISD_WH TARGET_LAG = '1 minute'
AS SELECT memory_id, memory_text, user_name, kind, confidence, updated_at
   FROM AISD.MEM.USER_MEMORY;

CREATE HYBRID TABLE IF NOT EXISTS AISD.MEM.TASK_BOARD (
  task_id STRING PRIMARY KEY, brief_id STRING, owner_agent STRING,
  status STRING, output VARIANT, updated_at TIMESTAMP_LTZ);

CREATE TABLE IF NOT EXISTS AISD.MEM.EPISODES (
  episode_id STRING, user_name STRING, goal STRING, steps VARIANT,
  outcome STRING, feedback STRING, ts TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP());` },
      { title: "Extract durable memories after a conversation", lang: "sql", src:
`INSERT INTO AISD.MEM.USER_MEMORY (user_name, kind, memory_text, source, confidence)
SELECT :user_name, m.value:kind::STRING, m.value:text::STRING, 'conversation', m.value:confidence::FLOAT
FROM TABLE(FLATTEN(PARSE_JSON(AI_COMPLETE('claude-sonnet-4-5',
  'Extract durable user preferences or facts from this conversation as JSON array ' ||
  '[{"kind":..., "text":..., "confidence":0-1}]. Return [] if none. Conversation: ' || :transcript)))) m;` }
    ],
    notes: [
      "Don’t put everything in one vector store: shared task state needs fast row updates (hybrid table), not similarity search.",
      "Always filter memory retrieval by user_name from the session — memory is per-user data.",
      "Episodes enable learning: e.g. retrieve past successful briefs for similar accounts as few-shot examples.",
      "Use AI_COMPLETE structured outputs (response_format) in production instead of free-form JSON parsing."
    ]
  },
  build: { status: "planned", steps: [
    "Create the four stores.",
    "Build a researcher → writer → reviewer flow sharing TASK_BOARD.",
    "Show a preference remembered across sessions."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q12 */
{
  id: "agent-memory-stale",
  section: "agents",
  title: "Your agent keeps using outdated facts about customers and users. How do you keep memory fresh and correct?",
  scenario: "The account-research agent “remembers” that Acme’s champion is Jane — but Jane left three months ago, and the CRM table already reflects it.",
  tags: ["memory", "freshness", "validation", "forgetting", "ttl"],
  level: "Advanced",
  tests: "Whether you treat memory as context to be validated, not as permanent truth.",
  tldr: "Memory is not truth. Attach metadata (last updated, source, confidence), validate important memories against the system of record before use, and forget deliberately — expire, archive or remove old, unused, low-confidence or contradictory entries.",
  answer: [
    { h: "Why memory goes stale", items: ["Preferences change, tasks become irrelevant, facts get outdated."] },
    { h: "1. Metadata", items: ["Last updated, source, confidence — to reason about freshness."] },
    { h: "2. Validate before use", items: ["Check important memories against the source of truth."] },
    { h: "3. Forgetting", items: ["Expire, archive or remove old, unused, low-confidence or contradictory memories."] }
  ],
  tradeoff: "Validation and forgetting add latency and maintenance jobs, but without them memory quality degrades over time.",
  takeaway: "Memory is a source of context, not a source of truth.",
  hld: {
    caption: "Memory lifecycle with freshness checks and forgetting.",
    lanes: [
      { name: "Lifecycle", cols: [
        [N("Write", "+ ts · source · confidence", "user")],
        [N("Store", "", "store")],
        [N("Retrieve", "")],
        [N("Validate", "fresh? consistent?", "decide")],
        [N("Use", "", "out"), N("Refresh / discard", "", "guard")]
      ]},
      { name: "Hygiene", cols: [[N("Scheduled sweep", "")], [N("Expire / archive", "", "guard")]] }
    ]
  },
  lld: {
    caption: "A view scores freshness; facts tied to a system of record are re-validated against it; a nightly task decays, archives and resolves contradictions.",
    lanes: [
      { name: "Read path", cols: [
        [N("MEMORY_SEARCH", "", "store")],
        [N("V_MEMORY_FRESHNESS", "age · confidence · decay", "decide")],
        [N("Validate vs CRM", "join system of record", "guard")],
        [N("Use", "", "out"), N("Mark stale", "", "guard")]
      ]},
      { name: "Nightly", cols: [
        [N("MEMORY_HYGIENE task", "", "proc")],
        [N("Decay confidence", "unused memories")],
        [N("Archive", "low confidence · TTL", "store")],
        [N("Contradictions", "AI_COMPLETE judge", "model")]
      ]}
    ],
    objects: [
      ["AISD.MEM.USER_MEMORY", "Table", "Adds source_table / source_key to link facts to the system of record"],
      ["AISD.MEM.V_MEMORY_FRESHNESS", "View", "Effective confidence after age-based decay"],
      ["AISD.MEM.MEMORY_ARCHIVE", "Table", "Forgotten memories retained for audit"],
      ["AISD.MEM.MEMORY_HYGIENE", "Task", "Nightly decay, TTL expiry, contradiction resolution"]
    ],
    code: [
      { title: "Freshness scoring", lang: "sql", src:
`CREATE OR REPLACE VIEW AISD.MEM.V_MEMORY_FRESHNESS AS
SELECT m.*,
       DATEDIFF('day', updated_at, CURRENT_TIMESTAMP())                       AS age_days,
       confidence * EXP(-DATEDIFF('day', updated_at, CURRENT_TIMESTAMP()) / 90) AS effective_conf
FROM AISD.MEM.USER_MEMORY m;` },
      { title: "Validate facts against the system of record", lang: "sql", src:
`-- memories that claim a champion contact, checked against CRM
SELECT m.memory_id, m.memory_text, c.contact_name, c.is_active
FROM AISD.MEM.USER_MEMORY m
JOIN CRM.PUBLIC.CONTACTS c ON c.contact_id = m.source_key
WHERE m.source_table = 'CRM.PUBLIC.CONTACTS'
  AND (c.is_active = FALSE OR c.updated_at > m.updated_at);   -- memory is stale` },
      { title: "Nightly forgetting", lang: "sql", src:
`CREATE OR REPLACE TASK AISD.MEM.MEMORY_HYGIENE
  WAREHOUSE = AISD_WH SCHEDULE = 'USING CRON 0 3 * * * UTC'
AS
BEGIN
  INSERT INTO AISD.MEM.MEMORY_ARCHIVE
    SELECT *, CURRENT_TIMESTAMP() FROM AISD.MEM.V_MEMORY_FRESHNESS
    WHERE effective_conf < 0.2
       OR COALESCE(last_used_at, updated_at) < DATEADD('day', -180, CURRENT_TIMESTAMP());

  DELETE FROM AISD.MEM.USER_MEMORY
    WHERE memory_id IN (SELECT memory_id FROM AISD.MEM.MEMORY_ARCHIVE);
END;` }
    ],
    notes: [
      "Facts with a system of record (CRM, HR) should be re-read from it, not trusted from memory — memory then just points to the record.",
      "Preferences have no system of record: rely on recency + confidence and ask the user when confidence is low.",
      "Archive rather than hard-delete for auditability; apply retention policy to the archive."
    ]
  },
  build: { status: "planned", steps: [
    "Seed memory with a fact that later changes in a CRM table.",
    "Show the stale answer, then the validated answer.",
    "Run the hygiene task and show archived memories."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
}

);
