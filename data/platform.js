/* Platform & Governance */
window.QUESTIONS.push(

/* ------------------------------------------------------------------ Q16 */
{
  id: "llm-gateway",
  section: "platform",
  title: "Ten teams want LLM access inside your Snowflake account. How do you standardize and govern it?",
  scenario: "Marketing, support, finance and engineering all want LLMs. Some are already calling external APIs with personal keys. Security wants control, finance wants cost by team, and teams want speed.",
  tags: ["gateway", "governance", "quotas", "routing", "cost attribution", "fallback", "model rbac"],
  level: "Core",
  tests: "Platform architecture thinking — one governed entry point instead of N direct integrations.",
  tldr: "Introduce a centralized LLM gateway: auth, per-team quotas, rate limiting, model routing, prompt templates, logging, cost attribution, retries, fallbacks and policy checks. Teams integrate once against a stable API; the platform team swaps providers and models behind it.",
  answer: [
    { h: "Gateway responsibilities", items: ["Authentication", "Per-team quotas & rate limits", "Model routing", "Prompt templates", "Logging & cost attribution", "Retries, fallbacks, policy checks"] },
    { h: "Examples", items: ["Provider down → fail over.", "Team over quota → throttle.", "Policy violation → block before the model."] },
    { h: "Biggest win: abstraction", items: ["Teams integrate once; providers, models and routing change behind a stable API."] },
    { h: "Monitor", items: ["Latency, error rate, cost by team, model usage, safety violations, fallback success rate."] },
    { h: "Provider outage & uptime", items: [
      "99.9% uptime still allows ~43 minutes of downtime a month — a single provider makes that hard to meet.",
      "Primary + fallback models behind the gateway; fail over on errors, timeouts or rate-limit responses.",
      "Teams get proxy credentials from the gateway, never the raw provider keys."
    ]}
  ],
  caseStudy: { id: "shopnest", stage: 9 },
  related: ["rate-limits-token-budgets", "scale-inference-100x", "smaller-models"],
  tradeoff: "Adds platform complexity, but gives central governance, cost control and much stronger operational leverage.",
  takeaway: "One gateway, one API, central governance.",
  hld: {
    caption: "All teams go through one governed entry point.",
    lanes: [
      { name: "Gateway", cols: [
        [N("Team A", "", "user"), N("Team B", "", "user"), N("Team C", "", "user")],
        [N("Auth", "", "guard")],
        [N("Quota / rate", "", "guard")],
        [N("Policy", "", "guard")],
        [N("Router", "templates · retry · fallback", "decide")],
        [N("Model A", "", "model"), N("Model B", "", "model"), N("Fallback", "", "model")]
      ]},
      { name: "Observe", cols: [[N("Logs", "", "store")], [N("Cost by team", "", "out"), N("Latency · errors", "", "out")]] }
    ]
  },
  lld: {
    caption: "Snowflake is the governance plane (roles, model RBAC, usage views, budgets); an optional thin gateway on SPCS adds templates, routing and fallback.",
    lanes: [
      { name: "Access", cols: [
        [N("Team apps", "SQL · REST", "user")],
        [N("Team role + PAT", "TEAM_MKT_AI …", "guard")],
        [N("Model RBAC", "CORTEX-MODEL-ROLE-*", "guard")],
        [N("Gateway (SPCS, optional)", "templates · routing · fallback", "decide")],
        [N("Cortex REST API / AI SQL", "", "model")]
      ]},
      { name: "Govern", cols: [
        [N("CORTEX_MODELS_ALLOWLIST", "account-level", "guard")],
        [N("ACCOUNT_USAGE Cortex views", "", "store")],
        [N("V_AI_COST_BY_TEAM", "", "proc")],
        [N("Budgets + alerts", "", "guard")],
        [N("Platform dashboard", "", "out")]
      ]}
    ],
    objects: [
      ["TEAM_<NAME>_AI roles", "Roles", "One per team; carries attribution and model grants"],
      ["CORTEX_MODELS_ALLOWLIST", "Account parameter", "Which models may be used at all"],
      ["SNOWFLAKE.\"CORTEX-MODEL-ROLE-…\"", "Application roles", "Per-model grants to team roles (model RBAC)"],
      ["Programmatic access tokens", "Auth", "Per-team service users for REST access"],
      ["AISD.PLAT.V_AI_COST_BY_TEAM", "View over ACCOUNT_USAGE", "Credits by role / model / day"],
      ["AI_GATEWAY", "SPCS service (optional)", "Prompt templates, routing, retries, fallback"]
    ],
    code: [
      { title: "Model governance", lang: "sql", src:
`USE ROLE ACCOUNTADMIN;

-- account-wide allowlist
ALTER ACCOUNT SET CORTEX_MODELS_ALLOWLIST = 'claude-sonnet-4-5,llama3.1-70b,llama3.1-8b';

-- per-model RBAC
CALL SNOWFLAKE.MODELS.CORTEX_BASE_MODELS_REFRESH();

CREATE ROLE IF NOT EXISTS TEAM_SUPPORT_AI;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE TEAM_SUPPORT_AI;
GRANT APPLICATION ROLE SNOWFLAKE."CORTEX-MODEL-ROLE-LLAMA3.1-8B" TO ROLE TEAM_SUPPORT_AI;

CREATE ROLE IF NOT EXISTS TEAM_ENG_AI;
GRANT DATABASE ROLE SNOWFLAKE.CORTEX_USER TO ROLE TEAM_ENG_AI;
GRANT APPLICATION ROLE SNOWFLAKE."CORTEX-MODEL-ROLE-CLAUDE-SONNET-4-5" TO ROLE TEAM_ENG_AI;` },
      { title: "Cost attribution by team", lang: "sql", src:
`-- column names per ACCOUNT_USAGE docs; verify for your account
CREATE OR REPLACE VIEW AISD.PLAT.V_AI_COST_BY_TEAM AS
SELECT DATE_TRUNC('day', q.start_time) AS day,
       q.role_name                     AS team_role,
       c.model_name,
       SUM(c.token_credits)            AS credits,
       SUM(c.tokens)                   AS tokens
FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_QUERY_USAGE_HISTORY c
JOIN SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY q ON q.query_id = c.query_id
WHERE q.role_name LIKE 'TEAM_%_AI'
GROUP BY 1, 2, 3;` },
      { title: "Gateway fallback (FastAPI on SPCS, sketch)", lang: "python", src:
`ROUTES = {"support": ["llama3.1-8b", "llama3.1-70b"],
          "eng":     ["claude-sonnet-4-5", "llama3.1-70b"]}

async def complete(team: str, template: str, vars: dict):
    if over_quota(team):
        raise HTTPException(429, "team quota exceeded")
    prompt = TEMPLATES[template].format(**vars)
    for model in ROUTES[team]:                  # primary, then fallback
        try:
            return await cortex_complete(model, prompt, token=TEAM_PATS[team])
        except (Timeout, ServerError):
            log_fallback(team, model)
    raise HTTPException(503, "all models unavailable")` }
    ],
    notes: [
      "Much of the gateway comes built in: auth (roles/PATs), model governance (allowlist + model RBAC) and metering (ACCOUNT_USAGE). Build a custom gateway only for templates, routing and fallback.",
      "Give each team a dedicated role so every call is attributable — shared roles destroy cost attribution.",
      "Use budgets / alerts for spend guardrails; quotas per team are enforced in the gateway.",
      "Check model names and ACCOUNT_USAGE view columns against current docs."
    ]
  },
  build: { status: "planned", steps: [
    "Create three team roles with different model grants.",
    "Show a blocked call for a non-granted model.",
    "Run sample workloads and build the cost-by-team dashboard.",
    "Optional: deploy the FastAPI gateway on SPCS with fallback."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q17 */
{
  id: "smaller-models",
  section: "platform",
  title: "Can routing to smaller models make your AI pipeline better — not just cheaper?",
  scenario: "A support pipeline sends every ticket to a frontier model: classify, extract fields, draft a reply. It’s slow and expensive, and 70% of tickets are simple.",
  tags: ["model routing", "cost", "latency", "cascades", "small models", "ai functions"],
  level: "Core",
  tests: "AI system architecture trade-offs, not model strength.",
  tldr: "Not every task needs expensive intelligence. Small models / task-specific functions handle intent, routing, classification, extraction, validation and simple drafts; large models handle complex reasoning, planning and final synthesis. Escalate only when complexity demands it.",
  answer: [
    { h: "Small models", items: ["Intent detection", "Routing", "Classification", "Extraction", "Validation & guardrails", "Simple drafts"] },
    { h: "Large models", items: ["Complex reasoning", "Multi-step planning", "Hard coding", "Final synthesis"] },
    { h: "Example", items: ["Simple FAQ → small model answers; escalate only if complex."] },
    { h: "Minimum sufficient intelligence", items: [
      "Climb the ladder only as needed: rules/heuristics → classical ML → deep learning → small LLM → large LLM → human.",
      "Each step up adds cost, latency, data hunger and autonomy — and reduces determinism and explainability.",
      "Greetings and thanks → rules. Ticket categorisation → classifier. Standard policy → RAG + small model. Complex split-shipment refund → large model. Disputes → human."
    ]}
  ],
  caseStudy: { id: "shopnest", stage: 8 },
  related: ["llm-gateway", "semantic-cache", "human-handoff"],
  tradeoff: "Multi-model orchestration adds routing complexity but significantly improves latency, cost efficiency and scalability.",
  takeaway: "Allocate intelligence intelligently.",
  hld: {
    caption: "A model cascade: cheap first, escalate on complexity.",
    lanes: [
      { name: "Cascade", cols: [
        [N("Request", "", "user")],
        [N("Small model", "intent · complexity", "model")],
        [N("Simple?", "", "decide")],
        [N("Small answers", "", "out"), N("Large model", "", "model")],
        [N("Validator", "", "guard")],
        [N("Response", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Task-specific AI functions for classification and extraction, a small model for simple replies, a frontier model only for complex tickets — all set-based SQL.",
    lanes: [
      { name: "Pipeline", cols: [
        [N("TICKETS", "", "store")],
        [N("AI_CLASSIFY", "simple / complex · topic", "model")],
        [N("AI_EXTRACT", "order_id · product", "model")],
        [N("simple → llama3.1-8b", "", "model"), N("complex → claude", "", "model")],
        [N("AI_FILTER check", "reply addresses ticket?", "guard")],
        [N("REPLIES", "", "out")]
      ]},
      { name: "Compare", cols: [
        [N("Always-large baseline", "", "proc")],
        [N("Cascade", "", "proc")],
        [N("Quality · latency · credits", "", "out")]
      ]}
    ],
    objects: [
      ["AI_CLASSIFY", "AI function", "Complexity and topic routing"],
      ["AI_EXTRACT", "AI function", "Structured fields without a general LLM prompt"],
      ["AI_COMPLETE (small / large)", "AI function", "Draft replies by tier"],
      ["AI_FILTER", "AI function", "Cheap validation of the draft"],
      ["AISD.PLAT.V_AI_COST_BY_TEAM", "View", "Credit comparison of the two pipelines"]
    ],
    code: [
      { title: "Cascade in one SQL statement", lang: "sql", src:
`WITH routed AS (
  SELECT t.ticket_id, t.body,
         AI_CLASSIFY(t.body, ['simple', 'complex']):labels[0]::STRING AS tier,
         AI_EXTRACT(text => t.body,
                    responseFormat => {'order_id': 'What is the order id?',
                                       'product':  'Which product is mentioned?'}) AS fields
  FROM AISD.SUP.TICKETS t
)
SELECT ticket_id, tier, fields,
       IFF(tier = 'simple',
           AI_COMPLETE('llama3.1-8b',       'Write a short helpful reply: ' || body),
           AI_COMPLETE('claude-sonnet-4-5', 'Write a careful, complete reply: ' || body)) AS reply
FROM routed;` }
    ],
    notes: [
      "AI_CLASSIFY / AI_EXTRACT are purpose-built and usually cheaper than prompting a frontier model for the same task.",
      "Evaluate quality per tier — the cascade is only better if simple-tier quality stays acceptable.",
      "Escalate on low confidence too, not just on the ‘complex’ label.",
      "Check AI_EXTRACT argument names in current docs."
    ]
  },
  build: { status: "planned", steps: [
    "Build a mixed ticket set (70% simple, 30% complex).",
    "Run always-large vs cascade.",
    "Compare quality (LLM judge), latency and credits."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q18 */
{
  id: "multi-tenant-isolation",
  section: "platform",
  title: "You’re building a multi-tenant AI SaaS on Snowflake. What does tenant isolation mean end to end?",
  scenario: "A SaaS vendor serves 200 customers from one Snowflake account: shared tables for documents and chat history, one RAG service, one agent. A single cross-tenant leak would be fatal.",
  tags: ["multi-tenant", "security", "isolation", "rbac", "row access policy", "quotas", "cache"],
  level: "Advanced",
  tests: "Security architecture: isolation must be enforced at every layer, server-side.",
  tldr: "Shared platform, but no tenant may see, influence or interfere with another. Enforce isolation at data (tenant-aware indexing and filtering), access (server-side identity, never from the prompt), compute (quotas, rate limits), cache (tenant in the key) and tools (scoped credentials).",
  answer: [
    { h: "1. Data", items: ["Documents, embeddings, history and memory never accessible cross-tenant.", "Tenant-aware indexing and retrieval filtering."] },
    { h: "2. Access", items: ["Tenant identity on every request; authorization server-side, never from the prompt."] },
    { h: "3. Compute", items: ["Quotas, rate limits, workload controls so a noisy tenant can’t degrade others."] },
    { h: "4. Cache", items: ["No cached responses or retrieved context across tenants."] },
    { h: "5. Tools", items: ["An agent for one tenant never reaches another tenant’s APIs, files or actions."] },
    { h: "Agent platforms: make the tenant a principal", items: [
      "Tenant = a role the platform enforces, not a tenant_id in a header or prompt.",
      "Row access keyed on the session role via a role → tenant map — the client and the LLM can’t spoof it.",
      "Agents run with short-lived delegated tokens locked to that role; entitlements (models, tools) are grants on the role."
    ]}
  ],
  caseStudy: { id: "agent-platform", stage: 2 },
  related: ["agent-delegated-identity", "agent-aware-masking", "tenant-lifecycle-revocation"],
  tradeoff: "Stronger isolation improves security and reliability but increases complexity, cost and operational overhead.",
  takeaway: "Shared infrastructure, enforced isolation at every boundary.",
  hld: {
    caption: "Tenant identity flows through every layer.",
    lanes: [
      { name: "Request", cols: [
        [N("Tenant A", "", "user"), N("Tenant B", "", "user")],
        [N("Auth", "identity", "guard")],
        [N("Quota", "compute", "guard")],
        [N("Scoped cache", "", "store")],
        [N("Retrieval filter", "", "guard")],
        [N("Scoped tools", "", "guard")],
        [N("LLM", "", "model")]
      ]}
    ]
  },
  lld: {
    caption: "Row access policies enforce data isolation in the engine; the app derives tenant from the authenticated session and passes it as a mandatory search filter; warehouses and resource monitors isolate compute.",
    lanes: [
      { name: "Data", cols: [
        [N("Shared tables", "tenant_id column", "store")],
        [N("TENANT_RAP", "row access policy", "guard")],
        [N("Secure views", "", "guard")],
        [N("DOC_SEARCH", "attribute: tenant_id", "store")]
      ]},
      { name: "Request", cols: [
        [N("SaaS app", "", "user")],
        [N("Session → tenant_id", "server-side mapping", "guard")],
        [N("search(filter tenant_id)", "mandatory", "guard")],
        [N("Cache key incl. tenant", "", "decide")],
        [N("AI_COMPLETE", "", "model")]
      ]},
      { name: "Compute", cols: [
        [N("Tier warehouses", "WH_TENANT_*", "proc")],
        [N("Resource monitors", "credit quotas", "guard")],
        [N("App rate limits", "per tenant", "guard")]
      ]}
    ],
    objects: [
      ["AISD.SEC.TENANT_MAP", "Table", "Maps app service user / role to tenant_id"],
      ["AISD.SEC.TENANT_RAP", "Row access policy", "Applied to DOC_CHUNKS, CHAT_HISTORY, USER_MEMORY"],
      ["AISD.RAG.DOC_SEARCH", "Cortex Search Service", "tenant_id attribute; app always filters"],
      ["DOC_SEARCH_<TENANT>", "Per-tenant services (high tier)", "Physical index isolation for regulated customers"],
      ["WH_TENANT_* + resource monitors", "Warehouses", "Compute isolation and quotas"]
    ],
    code: [
      { title: "Row access policy", lang: "sql", src:
`CREATE OR REPLACE ROW ACCESS POLICY AISD.SEC.TENANT_RAP
  AS (row_tenant STRING) RETURNS BOOLEAN ->
  IS_ROLE_IN_SESSION('PLATFORM_ADMIN')
  OR EXISTS (SELECT 1 FROM AISD.SEC.TENANT_MAP m
             WHERE m.role_name = CURRENT_ROLE()
               AND m.tenant_id = row_tenant);

ALTER TABLE AISD.RAG.DOC_CHUNKS  ADD ROW ACCESS POLICY AISD.SEC.TENANT_RAP ON (tenant_id);
ALTER TABLE AISD.APP.CHAT_HISTORY ADD ROW ACCESS POLICY AISD.SEC.TENANT_RAP ON (tenant_id);
ALTER TABLE AISD.MEM.USER_MEMORY  ADD ROW ACCESS POLICY AISD.SEC.TENANT_RAP ON (tenant_id);` },
      { title: "Mandatory tenant filter at retrieval (app server)", lang: "python", src:
`def retrieve(session_user, question):
    tenant_id = lookup_tenant(session_user)          # from auth, never from the prompt
    return svc.search(
        query=question,
        columns=["chunk_text", "doc_id", "chunk_id"],
        filter={"@eq": {"tenant_id": tenant_id}},    # always applied
        limit=8,
    ).results` },
      { title: "Compute isolation", lang: "sql", src:
`CREATE RESOURCE MONITOR RM_TENANT_GOLD WITH CREDIT_QUOTA = 500
  TRIGGERS ON 80 PERCENT DO NOTIFY ON 100 PERCENT DO SUSPEND;

CREATE WAREHOUSE IF NOT EXISTS WH_TENANT_GOLD
  WAREHOUSE_SIZE = 'SMALL' AUTO_SUSPEND = 60 RESOURCE_MONITOR = RM_TENANT_GOLD;` }
    ],
    notes: [
      "Verify whether row access policies on the source table are honoured by Cortex Search for your use case; if not, treat the app-side mandatory filter (or per-tenant services) as the enforcement point.",
      "Tiered isolation is common: shared service + filter for standard tenants, dedicated services/schemas for regulated tenants.",
      "Cache, memory and agent tools must all carry tenant_id — leaks usually happen in the layers people forget.",
      "Test it: run cross-tenant prompt attacks in CI and assert zero foreign rows."
    ]
  },
  build: { status: "planned", steps: [
    "Load documents for two tenants into shared tables.",
    "Apply the row access policy and the mandatory filter.",
    "Attempt prompt-based cross-tenant access and show it fail at the engine/app layer."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
}

);
