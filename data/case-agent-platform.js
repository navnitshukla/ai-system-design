/* Case study #2 — Multi-tenant agent platform on a shared AI gateway.
 * Generalised from a validated reference design. Fictional ISV "CaseFlow"; tenants Acme Law and Globex Legal.
 * Component field `until` (optional): the component is shown only for stages < until (replaced later).
 */
window.CASE_STUDIES.push({
  id: "agent-platform",
  title: "CaseFlow: a multi-tenant agent platform on one shared AI gateway",
  subtitle: "One gateway, one tool server and one set of tables for every customer firm — with isolation that holds even if the app or the LLM misbehaves.",
  story: "CaseFlow is a fictional SaaS vendor (ISV) selling an AI legal assistant to law firms. Each firm (tenant) has many attorneys, and firms buy different models and connectors. CaseFlow wants one shared platform — not thousands of per-tenant deployments — while guaranteeing that Acme Law never sees Globex Legal’s data, models or tools. The guiding rule: anything that must hold even if the app has a bug lives on the enforcement side of the trust boundary.",
  cast: [["Alice Chen", "Attorney at Acme Law (tenant ACME)"], ["Maria Lopez", "Attorney at Globex Legal (tenant GLOBEX)"], ["CaseFlow platform team", "Runs the trusted tier"]],

  lanes: [
    { id: "users", name: "Users" },
    { id: "trusted", name: "ISV trusted tier" },
    { id: "enforce", name: "Enforcement · data platform" },
    { id: "third", name: "Third party" }
  ],

  components: [
    { id: "user",      lane: "users",   col: 1, stage: 0,  k: "user",   t: "Firm users",          s: "attorneys · many tenants",     sf: "Firm users",                sfs: "sign in to the ISV only", ext: true },
    { id: "app",       lane: "users",   col: 2, stage: 0,  k: "model",  t: "ISV app + agents",    s: "chat UI · orchestrator · sub-agents", sf: "ISV app + agents",   sfs: "LangGraph / any framework", ext: true },

    { id: "idp",       lane: "trusted", col: 1, stage: 4,  k: "guard",  t: "ISV IdP",             s: "SSO · OIDC",                   sf: "ISV IdP",                   sfs: "platform-audience token", ext: true },
    { id: "directory", lane: "trusted", col: 2, stage: 1,  k: "store",  t: "Tenant directory",    s: "tenants · users · entitlements", sf: "Tenant directory",        sfs: "synced to roles + grants", ext: true },
    { id: "svcacct",   lane: "trusted", col: 3, stage: 0, until: 5, k: "guard", t: "Shared service account", s: "tenant passed in prompt ✗", sf: "One service user",      sfs: "anti-pattern", ext: true },
    { id: "broker",    lane: "trusted", col: 3, stage: 5,  k: "guard",  t: "Credential broker",   s: "token exchange · cache · audit", sf: "Auth adapter",            sfs: "only holder of user tokens", ext: true },
    { id: "delegate",  lane: "trusted", col: 4, stage: 7,  k: "guard",  t: "Delegation broker",   s: "parent → child · depth",       sf: "/delegate endpoint",        sfs: "mint from user credential", ext: true },
    { id: "toolproxy", lane: "trusted", col: 5, stage: 8,  k: "guard",  t: "Tool proxy + vault",  s: "tenant · agent · tool allow-lists", sf: "Tool proxy",           sfs: "user tool tokens in vault", ext: true },
    { id: "ratelimit", lane: "trusted", col: 6, stage: 10, k: "guard",  t: "Rate limits + HA",    s: "per tenant · 2+ instances",     sf: "Broker HA",                 sfs: "shared encrypted store", ext: true },
    { id: "provision", lane: "trusted", col: 7, stage: 11, k: "proc",   t: "Provisioner",         s: "onboard · offboard · SCIM",     sf: "ONBOARD_TENANT()",          sfs: "dedicated provisioning role" },

    { id: "trust",     lane: "enforce", col: 1, stage: 4,  k: "guard",  t: "IdP trust",           s: "allowed roles only",           sf: "External OAuth",            sfs: "CF_IDP_OAUTH" },
    { id: "roles",     lane: "enforce", col: 2, stage: 2,  k: "guard",  t: "Tenant principals",   s: "tenant = role",                sf: "CF_TENANT_* roles",         sfs: "one per tenant" },
    { id: "ent",       lane: "enforce", col: 3, stage: 3,  k: "guard",  t: "Entitlements",        s: "models · tools per tenant",    sf: "Model RBAC + USAGE grants", sfs: "on the tenant role" },
    { id: "gateway",   lane: "enforce", col: 4, stage: 0,  k: "model",  t: "Shared AI gateway",   s: "model inference",              sf: "AI gateway",                sfs: "inference as the caller" },
    { id: "toolsrv",   lane: "enforce", col: 4, stage: 0,  k: "proc",   t: "Shared tool server",  s: "read-only SQL tool",           sf: "Managed tool server",       sfs: "runs as the caller" },
    { id: "rap",       lane: "enforce", col: 5, stage: 2,  k: "guard",  t: "Row access by role",  s: "role → tenant map",            sf: "TENANT_ROW_POLICY",         sfs: "CURRENT_ROLE()" },
    { id: "mask",      lane: "enforce", col: 5, stage: 6,  k: "guard",  t: "Agent-aware masking", s: "agents see less",              sf: "AGENT_MASK_* policies",     sfs: "if agent session" },
    { id: "tables",    lane: "enforce", col: 6, stage: 0,  k: "store",  t: "Shared tables",       s: "all tenants",                  sf: "CF.CORE.*",                 sfs: "TENANT_ID column" },
    { id: "obs",       lane: "enforce", col: 7, stage: 9,  k: "out",    t: "Traces · usage · access", s: "per tenant · user · agent", sf: "Trace + usage views",       sfs: "QUERY / ACCESS_HISTORY" },

    { id: "thirdtool", lane: "third",   col: 1, stage: 8,  k: "user",   t: "Enterprise search",   s: "third-party connector",        sf: "Third-party MCP",           sfs: "user’s own permissions", ext: true }
  ],

  stages: [
    { title: "The prototype",
      incident: "The first version works for one firm: agents use one shared service account, and the firm’s name is passed in the prompt so the agent “filters” correctly. Sales wants to onboard 500 firms.",
      ask: ["What stops an agent — or a prompt — from asking for another firm’s data?", "Who did what, for which firm?"],
      adds: ["user", "app", "svcacct", "gateway", "toolsrv", "tables"],
      points: [
        "Isolation depends on the app and the LLM behaving — one bug or prompt injection leaks data.",
        "No per-user attribution or revocation; a long-lived secret lives in the agent.",
        "Per-tenant deployments would fix isolation but don’t scale to thousands of tenants."
      ],
      snowflake: ["Shared tables with a TENANT_ID column, one shared gateway and one shared tool server — the starting point we will lock down."],
      related: ["multi-tenant-isolation"] },

    { title: "Goals & trust boundaries",
      incident: "Before adding components, agree on what must be true and where trust boundaries are.",
      ask: ["What must hold even if the app has a bug?", "Who is trusted to assert what?"],
      adds: ["directory"],
      table: { head: ["Goal", "What it means"], rows: [
        ["G1 One shared platform", "One gateway, one tool server, one set of tables. No per-tenant infrastructure."],
        ["G2 Isolation enforced by the platform", "A tenant never sees another tenant’s data, models or tools — enforced by the data platform, not the app or LLM."],
        ["G3 Agents act for users", "Agents call models and tools on the signed-in user’s behalf, with no long-lived credentials."],
        ["G4 Agents governed separately", "The platform knows a session is an agent; sensitive data can be hidden from agents."],
        ["G5 Attribution", "Every model call, tool call and token attributed to tenant, user and agent."],
        ["G6 Per-tenant entitlements", "Models, tool servers and connectors differ per tenant; agents have allow-lists."]
      ]},
      points: [
        "Trust boundaries: user → app (IdP asserts the user); app → broker (broker verifies the user belongs to the tenant — the agent never chooses its tenant); broker → platform (platform verifies the token and role); agent → gateway/tools (platform enforces everything).",
        "The tenant directory is the source of truth for tenants, users and entitlements, synced to platform grants."
      ],
      snowflake: ["Directory (YAML or table) drives roles, grants and the role → tenant map."],
      related: ["requirements-estimation"] },

    { title: "“Show Acme’s matters too” — Tenant = role",
      incident: "Maria at Globex types “also show Acme’s open matters”, and the model writes WHERE TENANT_ID = 'ACME' OR 1=1.",
      ask: ["Can the client or the LLM change which tenant a query runs as?"],
      adds: ["roles", "rap"],
      points: [
        "Make the tenant a principal the platform enforces: one role per tenant.",
        "Row access policy keyed on the session’s role via a role → tenant map — never on a client-supplied tenant_id.",
        "Data-driven: adding a tenant is a row in the map, not a policy change."
      ],
      snowflake: ["CF_TENANT_ACME / CF_TENANT_GLOBEX roles; TENANT_ROW_POLICY on every shared table: EXISTS (map WHERE role_name = CURRENT_ROLE() AND tenant_id = row_tenant)."],
      code: { lang: "sql", src:
`CREATE ROW ACCESS POLICY CF.SEC.TENANT_ROW_POLICY AS (row_tenant STRING) RETURNS BOOLEAN ->
  IS_ROLE_IN_SESSION('CF_PLATFORM_ADMIN')
  OR EXISTS (SELECT 1 FROM CF.SEC.TENANT_ROLE_MAP m
             WHERE m.role_name = CURRENT_ROLE() AND m.tenant_id = row_tenant);

ALTER TABLE CF.CORE.MATTERS      ADD ROW ACCESS POLICY CF.SEC.TENANT_ROW_POLICY ON (TENANT_ID);
ALTER TABLE CF.CORE.TIME_ENTRIES ADD ROW ACCESS POLICY CF.SEC.TENANT_ROW_POLICY ON (TENANT_ID);` },
      related: ["multi-tenant-isolation"] },

    { title: "Different firms, different models — Entitlements",
      incident: "Acme bought the premium models and the research connector; Globex is on the basic plan with one smaller model.",
      ask: ["Where are entitlements enforced — the app, or the platform?"],
      adds: ["ent"],
      points: [
        "Entitlements are grants on the tenant role: gateway access, per-model access, tool-server access, data SELECT.",
        "A non-entitled model or tool fails at the platform even if the app asks for it.",
        "The app reads entitlements from the broker so it never offers what the tenant didn’t buy."
      ],
      snowflake: ["Model RBAC grants per tenant role; USAGE on the shared tool server; SELECT on shared tables."],
      code: { lang: "sql", src:
`GRANT APPLICATION ROLE SNOWFLAKE."CORTEX-MODEL-ROLE-<PREMIUM-MODEL>" TO ROLE CF_TENANT_ACME;
GRANT APPLICATION ROLE SNOWFLAKE."CORTEX-MODEL-ROLE-<SMALL-MODEL>"   TO ROLE CF_TENANT_GLOBEX;

GRANT USAGE ON DATABASE CF TO ROLE CF_TENANT_ACME;
GRANT USAGE ON SCHEMA CF.CORE TO ROLE CF_TENANT_ACME;
GRANT SELECT ON ALL TABLES IN SCHEMA CF.CORE TO ROLE CF_TENANT_ACME;
-- plus: USAGE on the shared AI gateway and tool server (object types per your platform)` },
      related: ["llm-gateway", "smaller-models"] },

    { title: "No platform logins — Trust the ISV’s IdP",
      incident: "Attorneys sign in to CaseFlow, not to the data platform. Provisioning and rotating per-user secrets for thousands of users is not an option.",
      ask: ["How does the platform know who the user is without its own login?"],
      adds: ["idp", "trust"],
      points: [
        "The platform trusts the ISV IdP (External OAuth); the IdP issues a platform-audience access token for the user.",
        "Only tenant roles may be asserted; users have no password or personal token.",
        "Disabling the user cuts access; no secrets to rotate per user."
      ],
      snowflake: ["External OAuth security integration with ALLOWED_ROLES_LIST = tenant roles, ANY_ROLE_MODE disabled, sub → LOGIN_NAME; users TYPE = PERSON without passwords."],
      related: ["agent-delegated-identity"] },

    { title: "Agents act for users — Credential broker",
      incident: "Agents must call models and tools as Alice, in Acme’s role — but agents are the component most exposed to prompt injection.",
      ask: ["Which component may hold credentials?", "How short-lived should agent tokens be?"],
      adds: ["broker"],
      points: [
        "Replace the shared service account with a credential broker in the trusted tier.",
        "Broker verifies the app session and the user’s tenant, then performs OAuth token exchange: subject = user token, scope = tenant role (no switching), actor = agent name.",
        "Agents get a 1-hour delegated token; the broker caches per (user, agent) and refreshes before expiry."
      ],
      snowflake: ["Token exchange at the platform’s OAuth endpoint produces a role-locked, agent-marked, short-lived token; every call is enforced as the user in the tenant role."],
      related: ["agent-delegated-identity"] },

    { title: "The agent sees client emails — Agent-aware masking",
      incident: "Alice may see client emails and settlement demands. Her agent sends them to an LLM and into traces.",
      ask: ["Should an agent see everything its user can see?"],
      adds: ["mask"],
      points: [
        "Govern agents separately: sessions from delegated agent tokens are marked as agent sessions.",
        "Masking policies hide sensitive columns in agent sessions even when the role could see them.",
        "No duplicate ‘agent roles’ needed."
      ],
      snowflake: ["Masking policies on CLIENT_EMAIL and SETTLEMENT_DEMAND_USD that check an agent-session indicator."],
      related: ["agent-aware-masking"] },

    { title: "Orchestrator and sub-agents — Delegation broker",
      incident: "An orchestrator answers “brief me on open matters and October’s top biller” by delegating to a matters agent and a billing agent.",
      ask: ["Which agent may delegate to which?", "How do we audit the chain?"],
      adds: ["delegate"],
      points: [
        "Agents never pass tokens to each other; the orchestrator asks the broker.",
        "Broker checks issued-by-me, parent → child policy, depth ≤ 2, same tenant — then mints a new token from the user’s credential with actor = orchestrator>child.",
        "Orchestrator has no data tools; worker agents can’t delegate."
      ],
      snowflake: ["The chain in the actor claim shows up in audit records next to the user and tenant role."],
      related: ["agent-delegation-chains"] },

    { title: "A third-party connector — Tool proxy + vault",
      incident: "Acme bought an enterprise-search connector. Only the research agent may use it, and only read-only tools. The connector token is powerful.",
      ask: ["Who holds the tool token?", "How are per-agent and per-tool rules enforced?"],
      adds: ["toolproxy", "thirdtool"],
      points: [
        "Agents call a tool proxy with their delegated token; the proxy checks tenant, agent and tool allow-lists, then forwards with the user’s tool token from a vault.",
        "tools/list is filtered; denials are audited.",
        "Platform-side tool entitlement on the tenant role is the backstop."
      ],
      snowflake: ["Tenant role holds the connector entitlement; the proxy is the only path agents can use."],
      related: ["agent-third-party-tools"] },

    { title: "Which firm spent this? — Attribution",
      incident: "Finance needs chargeback per firm; SRE needs to follow one slow turn across broker, model and tool calls.",
      ask: ["What are the correlation keys?", "Which attributes are verified vs self-reported?"],
      adds: ["obs"],
      points: [
        "One traceparent per turn on every call; conversation id convention caseflow-<tenant>-<user>-<agent>-<id>.",
        "Join usage to spans by request id for billed cost.",
        "Tenant from the platform-verified user first; client span attributes are self-reported.",
        "Operators read through an observer role with no data access and no inference."
      ],
      snowflake: ["Gateway traces and usage views, plus QUERY_HISTORY and ACCESS_HISTORY for agent data access."],
      related: ["agent-attribution-chargeback", "llm-observability"] },

    { title: "Noisy tenant and a single point of failure",
      incident: "One firm’s batch job floods token exchanges; the broker runs as a single process.",
      ask: ["How is one tenant prevented from degrading others?", "What if the broker goes down?"],
      adds: ["ratelimit"],
      points: [
        "Per-tenant rate limits in the broker (e.g. exchanges per tenant per minute) plus platform-level quotas.",
        "2+ broker instances with a shared encrypted token store and secrets manager.",
        "Token cache keeps exchange off the hot path."
      ],
      snowflake: ["Per-tenant compute and spend controls (warehouses, resource monitors, budgets) complement broker limits."],
      related: ["rate-limits-token-budgets", "scale-inference-100x"] },

    { title: "Onboard, offboard, contain",
      incident: "A new firm signs every week, attorneys leave, and security asks how fast a compromised agent can be cut off.",
      ask: ["Is onboarding a script?", "What revokes access immediately?"],
      adds: ["provision"],
      points: [
        "Onboard: role, grants, map row, allow the role in the IdP trust — one procedure, driven by the directory.",
        "Users via SCIM; offboard by disabling the user and deleting their tool tokens.",
        "Compromised agent: purge its cached tokens and block it in broker policy."
      ],
      snowflake: ["ONBOARD_TENANT() procedure owned by a dedicated provisioning role; ALTER USER … SET DISABLED = TRUE for offboarding."],
      related: ["tenant-lifecycle-revocation"] },

    { title: "Worked example — Alice asks a question",
      incident: "Alice (Acme Law) asks: “List our open matters with lead attorney, client email and settlement demand, plus billed hours and fees.” The shared table holds 4 ACME and 3 GLOBEX matters.",
      ask: ["Follow one turn end to end — where is each decision made?"],
      adds: [],
      walkthrough: [
        { actor: "User", t: "Alice signs in once with SSO", d: "The app gets an app session token. The IdP also issues Alice’s platform-audience token, which only the broker receives." },
        { actor: "App", t: "A turn starts", d: "The app creates one traceparent and the conversation id caseflow-acme-alice-matters-agent-3f9c1a2b." },
        { actor: "Broker", t: "Agent asks for a token", d: "Broker verifies the session, confirms alice ∈ ACME, checks ACME’s rate limit, finds no cached token." },
        { actor: "Platform", t: "Token exchange", d: "Platform verifies the IdP token and that CF_TENANT_ACME is allowed and granted. Returns a 1-hour token: user CF_ACME_ALICE, role CF_TENANT_ACME (locked), agent session = true." },
        { actor: "Gateway", t: "First model call", d: "Gateway checks ACME’s role is entitled to the model. The model decides to call the SQL tool:", code: "SELECT m.MATTER_ID, m.MATTER_NAME, m.LEAD_ATTORNEY, m.CLIENT_EMAIL, m.SETTLEMENT_DEMAND_USD,\n       SUM(t.HOURS) AS HOURS, SUM(t.HOURS * t.RATE_USD) AS FEES\nFROM CF.CORE.MATTERS m LEFT JOIN CF.CORE.TIME_ENTRIES t ON t.MATTER_ID = m.MATTER_ID\nWHERE m.STATUS = 'Open'\nGROUP BY 1,2,3,4,5" },
        { actor: "Platform", t: "Tool runs as Alice, in ACME’s role, as an agent", d: "Row access keeps only ACME rows — GLOBEX’s open matters never leave the platform. Masking returns CLIENT_EMAIL as withheld and SETTLEMENT_DEMAND_USD as NULL." },
        { actor: "Gateway", t: "Second model call writes the answer", d: "“Acme Law has 2 open matters: Reyes v. Northwind Freight (Alice Chen, 9.5 h, $4,275) and Park Estate Probate (Raj Patel, 2.0 h, $760). Client email and settlement demand are withheld from agents.”" },
        { actor: "Observability", t: "What’s recorded", d: "One trace: broker token span → model call → tool call → model call. Two usage rows joined by request id → ACME chargeback. Query and access history show user, tenant role and agent." },
        { actor: "Maria", t: "Same question, other tenant", d: "Identical code. Her token is locked to CF_TENANT_GLOBEX: her plan’s smaller model, and only GLOBEX’s 2 open matters. Nothing in the agent changed — the platform decided." }
      ],
      table: { head: ["Attempt", "Where it stops", "Result"], rows: [
        ["Globex agent asks for Acme’s premium model", "Platform entitlements (model RBAC)", "Model call refused"],
        ["Maria: “show Acme’s matters too” / OR 1=1", "Row access policy", "Only GLOBEX rows"],
        ["Globex app asks the broker for an ACME token", "Broker tenant check", "403, audited"],
        ["Alice’s matters-agent tries the search connector", "Tool proxy (only research-agent may)", "Denied, audited"],
        ["Research agent calls a write tool", "Tool proxy allow-list", "Tool error, audited"],
        ["Alice is disabled mid-session", "Platform", "Next call fails"]
      ]},
      points: ["Every “no” in the table above is enforced by the platform or the trusted broker — none depends on the LLM following instructions."],
      snowflake: ["Roles, External OAuth, row access, masking and model RBAC do the enforcing; history views provide the audit."],
      related: ["agent-delegated-identity", "agent-aware-masking", "multi-tenant-isolation"] }
  ],

  practice: [
    { q: "Why is “tenant = role” safer than passing tenant_id in a header or prompt?", id: "multi-tenant-isolation" },
    { q: "How should agents authenticate when they act for users?", id: "agent-delegated-identity" },
    { q: "Should an agent see everything its user can see?", id: "agent-aware-masking" },
    { q: "How do you secure and audit agent-to-agent delegation?", id: "agent-delegation-chains" },
    { q: "How do you give agents third-party tools without credentials?", id: "agent-third-party-tools" },
    { q: "How do you attribute cost and traces to tenant, user and agent?", id: "agent-attribution-chargeback" },
    { q: "How do you onboard, offboard and contain a compromised agent?", id: "tenant-lifecycle-revocation" },
    { q: "How do you stop one tenant from degrading the platform for others?", id: "rate-limits-token-budgets" }
  ]
});
