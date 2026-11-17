/* Platform & Governance — agent identity on multi-tenant platforms (from the CaseFlow case study)
 * Fictional ISV "CaseFlow" (legal practice-management SaaS). Tenants: Acme Law (ACME), Globex Legal (GLOBEX).
 * Snowflake objects use the CF_ prefix. Gateway / agent-session specifics are kept generic on purpose.
 */
window.QUESTIONS.push(

/* ------------------------------------------------------------------ A1 */
{
  id: "agent-delegated-identity",
  section: "platform",
  title: "How should AI agents authenticate when they act on behalf of users in a multi-tenant SaaS?",
  scenario: "CaseFlow’s agents query firm data and call models for attorneys at many law firms. Today every agent uses one shared service account and is told the firm in the prompt.",
  tags: ["agent identity", "oauth", "token exchange", "on-behalf-of", "delegation", "credential broker"],
  level: "Advanced",
  caseStudy: { id: "agent-platform", stage: 5 },
  related: ["multi-tenant-isolation", "agent-aware-masking", "agent-delegation-chains", "tenant-lifecycle-revocation"],
  tests: "Whether you avoid shared service accounts and long-lived secrets, and give agents short-lived, user-scoped, attributable credentials.",
  tldr: "Users sign in to the ISV’s IdP, never to the data platform. A trusted credential broker exchanges the user’s IdP token (OAuth token exchange, on-behalf-of) for a short-lived token that is locked to the user’s tenant role and marked as acting for a named agent. Agents only ever hold that 1-hour token; the broker is the only component that sees user credentials. Every call is then enforced and attributed per user, tenant and agent.",
  answer: [
    { h: "Why not a shared service account", items: [
      "No per-user attribution or per-user revocation.",
      "Isolation depends on the app passing the right tenant — one bug or prompt injection leaks data.",
      "A long-lived secret sits in the most exposed component: the agent."
    ]},
    { h: "Delegated identity flow", items: [
      "User signs in to the ISV IdP; the platform trusts the IdP (External OAuth).",
      "Broker verifies the app session and that the user belongs to the tenant — the agent never picks its tenant.",
      "Broker performs token exchange: subject = user’s token, scope = tenant role (no role switching), actor = agent name.",
      "Agent receives a 1-hour token; broker caches it per (user, agent) and refreshes before expiry."
    ]},
    { h: "Properties you get", items: [
      "Least privilege: tenant role only, short lifetime, no refresh token in the agent.",
      "Attribution: user + agent on every call.",
      "Revocation: disabling the user cuts off their agents."
    ]}
  ],
  tradeoff: "A credential broker is a new critical component (must be highly available and secure), and token exchange adds latency — mitigated by caching tokens off the hot path.",
  takeaway: "Agents should borrow the user’s identity briefly, never own a secret.",
  hld: {
    caption: "Only the broker sees user credentials; agents get short-lived delegated tokens.",
    lanes: [
      { name: "Flow", cols: [
        [N("User", "SSO", "user")],
        [N("ISV IdP", "app session + platform token", "guard")],
        [N("Credential broker", "verify user ∈ tenant", "guard")],
        [N("Token exchange", "subject = user · actor = agent", "proc")],
        [N("Delegated token", "tenant role · 1 h", "store")],
        [N("Agent", "calls models + tools", "model")],
        [N("Platform enforces", "role · entitlements · data", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Snowflake trusts the ISV IdP via External OAuth; tenant roles are the only roles the IdP may assert; the broker exchanges and caches tokens.",
    lanes: [
      { name: "Setup", cols: [
        [N("CF_IDP_OAUTH", "External OAuth integration", "guard")],
        [N("Allowed roles", "CF_TENANT_* only", "guard")],
        [N("Users", "TYPE = PERSON · no password", "store")]
      ]},
      { name: "Runtime", cols: [
        [N("Broker", "verify id_token", "guard")],
        [N("Token exchange", "scope = session:role:CF_TENANT_ACME", "proc")],
        [N("Cache", "(user, agent) · refresh at −120 s", "decide")],
        [N("Agent → gateway / tools", "Bearer delegated token", "model")]
      ]}
    ],
    objects: [
      ["CF_IDP_OAUTH", "Security integration (External OAuth)", "Trusts the ISV IdP; maps sub → login name; restricts assertable roles"],
      ["CF_TENANT_<T>", "Roles", "One role per tenant; the only roles the IdP may assert"],
      ["CF_<T>_<USER>", "Users (TYPE = PERSON)", "No password and no PAT — reachable only with IdP tokens"],
      ["Credential broker", "ISV service", "Token exchange, cache, tenant check, audit; the only holder of user tokens"]
    ],
    code: [
      { title: "Trust the ISV IdP; allow only tenant roles", lang: "sql", src:
`CREATE SECURITY INTEGRATION CF_IDP_OAUTH
  TYPE = EXTERNAL_OAUTH
  ENABLED = TRUE
  EXTERNAL_OAUTH_TYPE = CUSTOM
  EXTERNAL_OAUTH_ISSUER = 'https://idp.caseflow.example/oauth2'
  EXTERNAL_OAUTH_JWS_KEYS_URL = 'https://idp.caseflow.example/.well-known/jwks.json'
  EXTERNAL_OAUTH_AUDIENCE_LIST = ('https://<account>.snowflakecomputing.com')
  EXTERNAL_OAUTH_TOKEN_USER_MAPPING_CLAIM = 'sub'
  EXTERNAL_OAUTH_SNOWFLAKE_USER_MAPPING_ATTRIBUTE = 'LOGIN_NAME'
  EXTERNAL_OAUTH_SCOPE_MAPPING_ATTRIBUTE = 'scp'
  EXTERNAL_OAUTH_ALLOWED_ROLES_LIST = ('CF_TENANT_ACME', 'CF_TENANT_GLOBEX')
  EXTERNAL_OAUTH_ANY_ROLE_MODE = 'DISABLE';

CREATE USER IF NOT EXISTS CF_ACME_ALICE TYPE = PERSON
  DEFAULT_ROLE = CF_TENANT_ACME DISPLAY_NAME = 'Alice Chen (Acme Law)';
GRANT ROLE CF_TENANT_ACME TO USER CF_ACME_ALICE;` },
      { title: "Token exchange (RFC 8693 shape)", lang: "text", src:
`POST /oauth/token
grant_type         = urn:ietf:params:oauth:grant-type:token-exchange
subject_token      = <user's IdP access token>
subject_token_type = urn:ietf:params:oauth:token-type:access_token
scope              = session:role:CF_TENANT_ACME        # tenant role, no switching
actor              = {"sub": "caseflow/acme/matters-agent", "type": "agent"}

-> short-lived delegated token (e.g. 1 h), role-locked, marked as acting for the agent
   (exact parameter names for role locking and actor claims: see your platform's docs)` },
      { title: "Broker: verify, cache, exchange", lang: "python", src:
`REFRESH_SKEW = 120  # seconds

def agent_token(id_token: str, agent: str, requested_tenant: str | None = None):
    claims = verify_app_token(id_token)                  # signature, issuer, audience, expiry
    user = directory.user(claims["sub"])                 # tenant comes from the directory
    if requested_tenant and requested_tenant != user.tenant:
        audit("tenant_mismatch", user=user, agent=agent)
        raise Forbidden()                                # the agent never chooses its tenant
    if agent not in directory.agents(user.tenant):
        raise Unprocessable("unknown agent")
    rate_limiter.check(user.tenant)

    key = (user.login, agent)
    cached = cache.get(key)
    if cached and cached.expires_at - now() > REFRESH_SKEW:
        return cached

    token = exchange(subject=vault.idp_token(user), role=user.tenant_role,
                     actor=f"caseflow/{user.tenant.lower()}/{agent}")
    registry.add(sha256(token.value), user=user, agent_chain=[agent])   # for delegation + tool proxy
    cache[key] = token
    audit("token_exchanged", user=user, agent=agent)
    return token` }
    ],
    notes: [
      "Map the IdP’s sub claim to LOGIN_NAME and allow only tenant roles — the IdP can’t mint an admin session.",
      "Users have no password or PAT, so nobody can sign in to the data platform directly as them.",
      "Use the IdP’s JWKS URL for key rotation and an on-behalf-of flow at the real IdP in production.",
      "Run 2+ broker instances with a shared, encrypted token store; it’s on every agent’s critical path."
    ]
  },
  build: { status: "planned", steps: [
    "Create a mock IdP that issues RS256 tokens and register it as External OAuth.",
    "Build the broker endpoint with tenant check, cache and audit.",
    "Show the same agent code running as Alice (ACME) and Maria (GLOBEX)."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ A2 */
{
  id: "agent-aware-masking",
  section: "platform",
  title: "An attorney can see client emails and settlement amounts. Should her AI agent see them too?",
  scenario: "CaseFlow’s matters agent answers questions for attorneys. The attorney’s role may read every column, but the firm doesn’t want sensitive fields sent to an LLM.",
  tags: ["masking", "agent governance", "least privilege", "pii", "data policy"],
  level: "Advanced",
  caseStudy: { id: "agent-platform", stage: 6 },
  related: ["agent-delegated-identity", "multi-tenant-isolation", "input-output-guardrails"],
  tests: "Whether you govern agents separately from the humans they act for, enforced in the data layer.",
  tldr: "Not necessarily. Agents should see less than the user: mark agent sessions as such, and attach masking policies that hide sensitive columns whenever the session is agent-driven — even if the user’s role could see them. Enforce it in the data platform so prompts and app bugs can’t bypass it, and avoid duplicating every role into an ‘agent’ variant.",
  answer: [
    { h: "Why agents get less", items: [
      "Data sent to a model can leak through outputs, logs and traces.",
      "Agents are exposed to prompt injection; humans are not in the same way.",
      "Many fields aren’t needed for the agent’s task."
    ]},
    { h: "How", items: [
      "Sessions created from delegated agent tokens carry an ‘agent session’ marker.",
      "Masking policies check the marker and return a masked value or NULL.",
      "Row access (tenant isolation) still applies on top."
    ]},
    { h: "Alternative considered", items: ["Separate agent roles per tenant — works, but doubles roles and grants to maintain."] }
  ],
  tradeoff: "Agents give less complete answers on masked fields; the UI must show the human the full data where appropriate and explain what was withheld.",
  takeaway: "The agent acts for the user, but doesn’t inherit everything the user can see.",
  hld: {
    caption: "Same user, same role — different column visibility for agent sessions.",
    lanes: [
      { name: "Human", cols: [[N("Alice in the app", "", "user")], [N("Table", "", "store")], [N("All columns", "", "out")]] },
      { name: "Agent", cols: [
        [N("Alice’s agent", "delegated token", "model")],
        [N("Agent-session marker", "", "decide")],
        [N("Masking policy", "", "guard")],
        [N("Masked sensitive columns", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Masking policies keyed on an agent-session indicator; tenant row access applied to the same tables.",
    lanes: [
      { name: "Policy", cols: [
        [N("CF_MATTERS", "shared table", "store")],
        [N("TENANT_ROW_POLICY", "rows of my tenant", "guard")],
        [N("AGENT_MASK_STRING / NUMBER", "if agent session", "guard")],
        [N("Agent result", "emails masked · demand NULL", "out")]
      ]}
    ],
    objects: [
      ["CF.CORE.MATTERS", "Shared table", "CLIENT_EMAIL and SETTLEMENT_DEMAND_USD are sensitive"],
      ["CF.SEC.IS_AGENT_SESSION()", "Helper (generic)", "Returns TRUE when the session was created for an agent — implement with your platform’s agent-session indicator"],
      ["CF.SEC.AGENT_MASK_STRING / _NUMBER", "Masking policies", "Hide values in agent sessions only"]
    ],
    code: [
      { title: "Agent-aware masking", lang: "sql", src:
`-- IS_AGENT_SESSION(): implement with your platform's agent-session indicator
-- (or, if none exists, a naming convention on agent roles)
CREATE MASKING POLICY CF.SEC.AGENT_MASK_STRING AS (val STRING) RETURNS STRING ->
  CASE WHEN CF.SEC.IS_AGENT_SESSION() THEN '***WITHHELD FROM AGENTS***' ELSE val END;

CREATE MASKING POLICY CF.SEC.AGENT_MASK_NUMBER AS (val NUMBER(12,2)) RETURNS NUMBER(12,2) ->
  CASE WHEN CF.SEC.IS_AGENT_SESSION() THEN NULL ELSE val END;

ALTER TABLE CF.CORE.MATTERS MODIFY COLUMN CLIENT_EMAIL
  SET MASKING POLICY CF.SEC.AGENT_MASK_STRING;
ALTER TABLE CF.CORE.MATTERS MODIFY COLUMN SETTLEMENT_DEMAND_USD
  SET MASKING POLICY CF.SEC.AGENT_MASK_NUMBER;` },
      { title: "What the agent gets back", lang: "text", src:
`MATTER_ID  MATTER_NAME                 LEAD_ATTORNEY  CLIENT_EMAIL                 SETTLEMENT_DEMAND_USD
ACME-1001  Reyes v. Northwind Freight  Alice Chen     ***WITHHELD FROM AGENTS***   NULL
ACME-1002  Park Estate Probate         Raj Patel      ***WITHHELD FROM AGENTS***   NULL` }
    ],
    notes: [
      "Tell the agent in its system prompt that some fields are withheld, so it says ‘withheld’ instead of guessing.",
      "Admin tools that run as agents will also see masked values — expected, and a good sign the policy is global.",
      "Combine with output guardrails: masking stops data reaching the model; guardrails stop leaks the model produces."
    ]
  },
  build: { status: "planned", steps: [
    "Query MATTERS as Alice directly and as Alice’s agent; compare columns.",
    "Show the policy holds even when the agent writes SELECT * or casts columns."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ A3 */
{
  id: "agent-delegation-chains",
  section: "platform",
  title: "An orchestrator agent hands work to sub-agents. How do you secure and audit agent-to-agent delegation?",
  scenario: "CaseFlow’s orchestrator answers “brief me on open matters and October’s top biller” by delegating to a matters agent and a billing agent.",
  tags: ["multi-agent", "delegation", "orchestrator", "audit", "least privilege"],
  level: "Advanced",
  caseStudy: { id: "agent-platform", stage: 7 },
  related: ["agent-delegated-identity", "agent-wrong-tool", "agent-attribution-chargeback"],
  tests: "Whether delegation is brokered and policy-checked, not agents passing their tokens to each other.",
  tldr: "Never let agents pass tokens around. The orchestrator asks the broker for a sub-agent token, presenting its own token. The broker checks it issued that token, that policy allows parent → child, depth limits and same tenant, then mints a fresh token from the user’s credential with the chain recorded (orchestrator>billing-agent). Each sub-agent runs with its own token and context; the whole turn shares one trace.",
  answer: [
    { h: "Broker checks", items: [
      "The presented parent token was issued by this broker.",
      "Policy allows parent → child (e.g. orchestrator → matters-agent, billing-agent).",
      "Depth ≤ max (e.g. 2) and no cycles.",
      "Same tenant as the user."
    ]},
    { h: "Mint, don’t forward", items: [
      "New token minted from the user’s credential, same tenant role.",
      "Actor = full chain (caseflow/acme/orchestrator>billing-agent).",
      "Parent token is never exchanged or shared."
    ]},
    { h: "Design", items: [
      "Orchestrator has no data tools — only delegate_to.",
      "Worker agents can’t delegate further.",
      "Rejections are audited."
    ]}
  ],
  tradeoff: "Brokered delegation adds a hop and policy to maintain; in return each sub-agent is attributable and limited, and a compromised orchestrator can’t reach tools directly.",
  takeaway: "Delegation is a policy decision made by the broker, not a token handed between agents.",
  hld: {
    caption: "Each hop is minted by the broker from the user’s credential.",
    lanes: [
      { name: "Delegation", cols: [
        [N("Orchestrator", "token: user + orchestrator", "model")],
        [N("Broker /delegate", "issued by me? allowed? depth? tenant?", "guard")],
        [N("Mint from user credential", "actor = orchestrator>child", "proc")],
        [N("Matters agent", "own token", "model"), N("Billing agent", "own token", "model")],
        [N("One trace per turn", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Delegation policy in the tenant directory; issued-token registry in the broker; chain visible in audit and query history.",
    lanes: [
      { name: "Broker", cols: [
        [N("Issued-token registry", "sha256 → user, chain", "store")],
        [N("Delegation policy", "allowed · max_depth", "guard")],
        [N("Token exchange", "same tenant role", "proc")]
      ]},
      { name: "Audit", cols: [
        [N("Broker spans", "token_delegated · delegation_rejected", "store")],
        [N("QUERY_HISTORY / ACCESS_HISTORY", "user · role · agent chain", "store")],
        [N("Per-turn trace", "", "out")]
      ]}
    ],
    objects: [
      ["Delegation policy", "Tenant directory (YAML/table)", "Which agent may delegate to which, max depth"],
      ["Issued-token registry", "Broker store", "Recognises tokens it minted (by hash) and their chain"],
      ["SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY / ACCESS_HISTORY", "Views", "Who ran what, under which role, on which objects"]
    ],
    code: [
      { title: "Delegation policy", lang: "yaml", src:
`delegation:
  max_depth: 2                      # user -> agent -> sub-agent
  allowed:
    orchestrator: [matters-agent, billing-agent]
  # worker agents are not listed, so they cannot delegate` },
      { title: "Broker: /delegate", lang: "python", src:
`def delegate(parent_token: str, child: str):
    parent = registry.get(sha256(parent_token))
    if parent is None:
        raise Unauthorized("token not issued by this broker")
    chain = parent.agent_chain + [child]
    if child not in policy.allowed.get(parent.agent_chain[-1], []):
        audit("delegation_rejected", parent=parent, child=child, reason="not allowed")
        raise Forbidden()
    if len(chain) > policy.max_depth or child in parent.agent_chain:
        raise Forbidden("depth or cycle")

    # mint from the USER's credential; never exchange the parent's token
    token = exchange(subject=vault.idp_token(parent.user), role=parent.user.tenant_role,
                     actor=f"caseflow/{parent.user.tenant.lower()}/" + ">".join(chain))
    registry.add(sha256(token.value), user=parent.user, agent_chain=chain)
    audit("token_delegated", user=parent.user, chain=chain)
    return token` }
    ],
    notes: [
      "The chain string is asserted by the broker — protect the broker accordingly.",
      "A sub-agent runs in the same tenant role as its parent; narrower scoping per sub-agent, if needed, comes from tool allow-lists and data policies.",
      "Propagate the same traceparent so orchestrator and sub-agent spans form one trace."
    ]
  },
  build: { status: "planned", steps: [
    "Build an orchestrator with only a delegate_to tool.",
    "Show an allowed and a rejected delegation, and a depth-limit rejection.",
    "Show the chain in audit records."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ A4 */
{
  id: "agent-third-party-tools",
  section: "platform",
  title: "Agents need a third-party tool (enterprise search) for some tenants. How do you grant it without giving agents credentials?",
  scenario: "Acme Law bought CaseFlow’s enterprise-search connector; Globex Legal didn’t. Only the research agent should use it, and only its read-only tools.",
  tags: ["tools", "mcp", "tool proxy", "vault", "allow-list", "entitlements"],
  level: "Advanced",
  caseStudy: { id: "agent-platform", stage: 8 },
  related: ["agent-delegated-identity", "agent-wrong-tool", "prompt-injection-retrieval"],
  tests: "Whether you keep tool credentials out of agents and enforce per-tenant, per-agent and per-tool entitlements.",
  tldr: "Put a tool proxy in the trusted tier. Agents call the proxy with their delegated token; the proxy checks the token is one it issued, the tenant has the connector, the agent is allowed, and the tool is on the allow-list — then forwards the call with the user’s tool token from a vault. tools/list is filtered to allowed tools. The platform adds a second check: the tenant role must hold the tool entitlement.",
  answer: [
    { h: "Checks in the proxy", items: [
      "Token issued by the broker.",
      "Tenant has the connector (connected_tools).",
      "Agent is allowed to use it.",
      "Tool name on the allow-list (read-only tools only)."
    ]},
    { h: "Credentials", items: [
      "The user’s tool token lives only in the vault; agents never see it.",
      "Proxy refreshes tokens; asks the user to reconnect when needed."
    ]},
    { h: "Defense in depth", items: [
      "Platform-side entitlement on the tenant role as a backstop.",
      "Audit every allowed and denied call."
    ]}
  ],
  tradeoff: "The proxy is another hop and component to run, but per-agent and per-tool allow-lists rarely exist natively, and tool tokens are often powerful.",
  takeaway: "Agents request tools; the trusted tier decides and holds the keys.",
  hld: {
    caption: "Two independent checks: the proxy (tenant, agent, tool) and the platform (role entitlement).",
    lanes: [
      { name: "Tool call", cols: [
        [N("Research agent", "delegated token", "model")],
        [N("Tool proxy", "issued? tenant? agent? tool?", "guard")],
        [N("Vault", "user’s tool token", "store")],
        [N("Tool gateway", "role entitled?", "guard")],
        [N("Enterprise search", "third party", "user")]
      ]}
    ]
  },
  lld: {
    caption: "Entitlements in the tenant directory; a secrets store for tool tokens; the proxy filters list and call requests.",
    lanes: [
      { name: "Proxy", cols: [
        [N("tools/list", "filter to allowed_tools", "guard")],
        [N("tools/call", "allow-list check", "guard")],
        [N("Vault lookup", "per user", "store")],
        [N("Forward", "user’s tool token", "proc")]
      ]},
      { name: "Audit", cols: [
        [N("tool_called · tool_access_denied", "spans", "store")]
      ]}
    ],
    objects: [
      ["connected_tools", "Tenant directory", "Which tenants bought which connector"],
      ["tools.<tool>.agents / allowed_tools", "Tenant directory", "Which agents may use it; which tool names are callable"],
      ["Token vault", "Secrets manager", "Per-user tool tokens, encrypted, refreshed by the proxy"]
    ],
    code: [
      { title: "Entitlements", lang: "yaml", src:
`tenants:
  ACME:   { connected_tools: [enterprise_search] }
  GLOBEX: { connected_tools: [] }

tools:
  enterprise_search:
    agents: [research-agent]
    allowed_tools: [search, people_search, read_document]   # read-only` },
      { title: "Proxy (MCP JSON-RPC)", lang: "python", src:
`def proxy(tool: str, agent_token: str, rpc: dict):
    t = registry.get(sha256(agent_token))
    if t is None:
        raise Unauthorized()
    cfg = tools[tool]
    if tool not in tenants[t.user.tenant].connected_tools or t.agent_chain[-1] not in cfg.agents:
        audit("tool_access_denied", token=t, tool=tool)
        raise Forbidden()
    if rpc["method"] == "tools/call" and rpc["params"]["name"] not in cfg.allowed_tools:
        audit("tool_access_denied", token=t, tool=rpc["params"]["name"])
        return jsonrpc_error(rpc, "tool not allowed")

    user_token = vault.tool_token(t.user, tool)          # never sent to the agent
    if user_token is None:
        raise Conflict("connect the tool first")
    resp = forward(cfg.url, rpc, bearer=user_token)
    if rpc["method"] == "tools/list":
        resp["result"]["tools"] = [x for x in resp["result"]["tools"] if x["name"] in cfg.allowed_tools]
    audit("tool_called", token=t, tool=tool)
    return resp` }
    ],
    notes: [
      "Filter tools/list as well as tools/call — agents shouldn’t even learn that write tools exist.",
      "Tool tokens should belong to the end user, so the third party enforces that user’s own permissions.",
      "Keep the platform-side entitlement too; the proxy is the first check, not the only one."
    ]
  },
  build: { status: "planned", steps: [
    "Mock a third-party MCP server with read and write tools.",
    "Show ACME research-agent allowed, ACME matters-agent denied, GLOBEX denied, write tool hidden."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ A5 */
{
  id: "agent-attribution-chargeback",
  section: "platform",
  title: "On a shared AI gateway, how do you attribute every model call, tool call and token to tenant, user and agent?",
  scenario: "Finance wants monthly chargeback per law firm; SRE wants to debug one attorney’s slow conversation across the broker, two model calls and a tool call.",
  tags: ["observability", "tracing", "opentelemetry", "chargeback", "attribution"],
  level: "Advanced",
  caseStudy: { id: "agent-platform", stage: 9 },
  related: ["llm-observability", "llm-gateway", "agent-delegation-chains"],
  tests: "Whether you design correlation keys up front and know which attributes are verified versus self-reported.",
  tldr: "Create one W3C traceparent per conversation turn and send it on every call (broker, gateway, tools). Add a conversation id with a convention such as caseflow-<tenant>-<user>-<agent>-<id>. Join gateway usage rows to spans by request id to get billed cost. Derive tenant from the platform-verified user first, and treat client-sent span attributes as self-reported.",
  answer: [
    { h: "Correlation keys", items: [
      "trace_id: one per turn, shared by broker, agent, model and tool spans.",
      "Conversation id convention: tenant, user, agent and a short id.",
      "Request id: joins model spans to billing rows."
    ]},
    { h: "Trust levels", items: [
      "Verified: the user recorded by the platform on its own spans.",
      "Self-reported: attributes in spans your components send.",
      "Resolve tenant from the verified user → tenant map first."
    ]},
    { h: "Privacy", items: ["Capture prompt/response content only where allowed; tool spans record sizes, not content; restrict trace access to an observer role."] }
  ],
  tradeoff: "Rich tracing helps debugging and chargeback but stores sensitive content and costs money — capture content selectively and govern access.",
  takeaway: "Decide your correlation keys before you ship, not after the first invoice.",
  hld: {
    caption: "One trace per turn; usage joined by request id.",
    lanes: [
      { name: "Turn", cols: [
        [N("App", "new traceparent + conversation id", "user")],
        [N("Broker span", "token issued", "proc")],
        [N("Model span", "user · model · tokens · request id", "model")],
        [N("Tool span", "tool · duration · size", "proc")],
        [N("Model span", "", "model")]
      ]},
      { name: "Analyze", cols: [
        [N("Trace store", "", "store")],
        [N("Usage / billing", "by request id", "store")],
        [N("Per tenant · user · agent", "cost · latency · errors", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Spans land in a trace table; usage rows carry the request id; a tenant map turns verified users into tenants. Table names are placeholders for your gateway’s trace and usage views.",
    lanes: [
      { name: "Join", cols: [
        [N("GATEWAY_TRACES", "spans (placeholder)", "store")],
        [N("GATEWAY_USAGE", "request_id · credits (placeholder)", "store")],
        [N("CF_USER_TENANT", "user → tenant", "store")],
        [N("V_CHARGEBACK", "", "proc")],
        [N("Monthly per tenant", "", "out")]
      ]}
    ],
    objects: [
      ["GATEWAY_TRACES", "Trace view (placeholder)", "Spans with trace_id, user, model, tokens, request_id, conversation_id"],
      ["GATEWAY_USAGE", "Usage view (placeholder)", "Billed usage per request_id"],
      ["CF.OBS.CF_USER_TENANT", "Table", "Platform user → tenant"],
      ["CF_OBSERVER", "Role", "Reads traces and usage; no data access, no inference"]
    ],
    code: [
      { title: "Conversation id convention", lang: "text", src:
`traceparent:      00-<trace_id>-<span_id>-01          # one per turn
conversation-id:  caseflow-acme-alice-matters-agent-3f9c1a2b` },
      { title: "Chargeback by tenant (placeholder view names)", lang: "sql", src:
`CREATE OR REPLACE VIEW CF.OBS.V_CHARGEBACK AS
SELECT DATE_TRUNC('month', t.start_time)                         AS month,
       COALESCE(m.tenant_id, SPLIT_PART(t.conversation_id, '-', 2)) AS tenant,   -- verified first
       t.user_name,
       SPLIT_PART(t.conversation_id, '-', 4)                     AS agent,
       COUNT(*)                                                  AS model_calls,
       SUM(t.input_tokens + t.output_tokens)                     AS tokens,
       SUM(u.credits)                                            AS credits
FROM GATEWAY_TRACES t
LEFT JOIN GATEWAY_USAGE u      ON u.request_id = t.request_id
LEFT JOIN CF.OBS.CF_USER_TENANT m ON m.user_name = t.user_name
GROUP BY 1, 2, 3, 4;` },
      { title: "Agent data access from query history", lang: "sql", src:
`SELECT user_name, role_name, COUNT(*) AS queries, SUM(total_elapsed_time) / 1000 AS seconds
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE role_name LIKE 'CF_TENANT_%'
  AND start_time > DATEADD('day', -30, CURRENT_TIMESTAMP())
GROUP BY 1, 2 ORDER BY queries DESC;` }
    ],
    notes: [
      "Agent names are parsed from the conversation id, so keep ids free of hyphens or use a different separator.",
      "Calls denied before inference may not produce a trace — log denials in the broker as well.",
      "Give operators an observer role (or tenant-scoped secure views) instead of admin access to traces."
    ]
  },
  build: { status: "planned", steps: [
    "Emit traceparent and conversation id from the app on every call.",
    "Build a per-turn timeline and a chargeback-by-tenant dashboard."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ A6 */
{
  id: "tenant-lifecycle-revocation",
  section: "platform",
  title: "How do you onboard a tenant, offboard a user and contain a compromised agent on a shared agent platform?",
  scenario: "CaseFlow signs a new firm every week, attorneys leave, and security asks: if one agent is compromised, how fast can we cut it off?",
  tags: ["provisioning", "offboarding", "revocation", "scim", "lifecycle"],
  level: "Core",
  caseStudy: { id: "agent-platform", stage: 11 },
  related: ["agent-delegated-identity", "multi-tenant-isolation", "agent-attribution-chargeback"],
  tests: "Whether isolation and entitlements are data-driven and automatable, and whether revocation is immediate.",
  tldr: "Keep a tenant directory as the source of truth and sync it to the platform: onboarding creates one tenant role, grants entitlements, adds a role → tenant map row and allows the role in the IdP trust. Users come via SCIM. Offboarding a user disables them, which cuts off their delegated tokens; clear their tool tokens. For a compromised agent, drop its cached tokens in the broker and block it in policy — and disable the user if needed.",
  answer: [
    { h: "Onboard a tenant", items: [
      "Add to the tenant directory.",
      "Create the tenant role; grant gateway, model, tool and data access.",
      "Insert (role, tenant_id) into the map used by row access.",
      "Allow the role in the IdP trust integration."
    ]},
    { h: "Users", items: ["Provision via SCIM; grant the tenant role.", "Offboard: disable the user → delegated tokens stop; delete their tool tokens."] },
    { h: "Incidents", items: [
      "Compromised agent: purge its cached tokens, block it in delegation/tool policy.",
      "Compromised user: disable the user.",
      "Review the audit trail by agent chain."
    ]}
  ],
  tradeoff: "One role per tenant scales operationally only with automation; manual grants drift. Data-driven policies (a map table) keep policy definitions unchanged as tenants grow.",
  takeaway: "If onboarding isn’t a script, isolation will eventually drift.",
  hld: {
    caption: "The tenant directory drives provisioning; revocation paths are explicit.",
    lanes: [
      { name: "Lifecycle", cols: [
        [N("Tenant directory", "source of truth", "store")],
        [N("Provisioner", "", "proc")],
        [N("Role + grants + map row", "", "guard")],
        [N("IdP trust: allowed roles", "", "guard")]
      ]},
      { name: "Revoke", cols: [
        [N("Disable user", "tokens stop", "guard"), N("Purge agent tokens", "broker", "guard")],
        [N("Audit review", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "A provisioning procedure owned by a dedicated provisioning role, never ACCOUNTADMIN at runtime.",
    lanes: [
      { name: "Onboard", cols: [
        [N("CF_PROVISIONER", "role", "guard")],
        [N("ONBOARD_TENANT()", "procedure", "proc")],
        [N("CF_TENANT_<T>", "", "store")],
        [N("TENANT_ROLE_MAP", "", "store")],
        [N("ALTER SECURITY INTEGRATION", "allowed roles", "guard")]
      ]}
    ],
    objects: [
      ["CF.SEC.TENANT_ROLE_MAP", "Table", "Role → tenant map read by the row access policy"],
      ["CF.SEC.ONBOARD_TENANT", "Procedure", "Creates role, grants, map row"],
      ["CF_PROVISIONER", "Role", "Dedicated provisioning role with only the needed privileges"]
    ],
    code: [
      { title: "Onboard a tenant", lang: "sql", src:
`CREATE OR REPLACE PROCEDURE CF.SEC.ONBOARD_TENANT(tenant_id STRING, model_role STRING)
  RETURNS STRING LANGUAGE SQL EXECUTE AS OWNER
AS
DECLARE
  r STRING DEFAULT 'CF_TENANT_' || UPPER(:tenant_id);
BEGIN
  -- inputs are concatenated into DDL: allow only safe identifier characters
  IF (NOT REGEXP_LIKE(:tenant_id, '^[A-Za-z0-9_]{1,30}$')
      OR NOT REGEXP_LIKE(:model_role, '^CORTEX-MODEL-ROLE-[A-Z0-9.\\-]{1,60}$')) THEN
    RETURN 'rejected: invalid tenant_id or model_role';
  END IF;
  EXECUTE IMMEDIATE 'CREATE ROLE IF NOT EXISTS ' || r;
  EXECUTE IMMEDIATE 'GRANT USAGE ON DATABASE CF TO ROLE ' || r;
  EXECUTE IMMEDIATE 'GRANT USAGE ON SCHEMA CF.CORE TO ROLE ' || r;
  EXECUTE IMMEDIATE 'GRANT SELECT ON ALL TABLES IN SCHEMA CF.CORE TO ROLE ' || r;
  EXECUTE IMMEDIATE 'GRANT USAGE ON WAREHOUSE CF_WH TO ROLE ' || r;
  EXECUTE IMMEDIATE 'GRANT APPLICATION ROLE SNOWFLAKE."' || :model_role || '" TO ROLE ' || r;
  INSERT INTO CF.SEC.TENANT_ROLE_MAP (role_name, tenant_id) SELECT :r, UPPER(:tenant_id);
  RETURN 'onboarded ' || r || ' (also: gateway/tool grants, add role to the IdP allowed-roles list)';
END;

CALL CF.SEC.ONBOARD_TENANT('INITECH', 'CORTEX-MODEL-ROLE-LLAMA3.1-70B');` },
      { title: "Allow the new role in the IdP trust", lang: "sql", src:
`ALTER SECURITY INTEGRATION CF_IDP_OAUTH SET
  EXTERNAL_OAUTH_ALLOWED_ROLES_LIST = ('CF_TENANT_ACME', 'CF_TENANT_GLOBEX', 'CF_TENANT_INITECH');` },
      { title: "Offboard a user / tenant", lang: "sql", src:
`-- user leaves: their delegated tokens stop working on the next call
ALTER USER CF_ACME_RAJ SET DISABLED = TRUE;

-- tenant leaves
REVOKE ROLE CF_TENANT_GLOBEX FROM USER CF_GLOBEX_MARIA;
DELETE FROM CF.SEC.TENANT_ROLE_MAP WHERE role_name = 'CF_TENANT_GLOBEX';
DROP ROLE CF_TENANT_GLOBEX;   -- then remove it from the IdP allowed-roles list` }
    ],
    notes: [
      "tenant_id and model_role are validated against an identifier pattern because they’re concatenated into DDL — never pass raw user input.",
      "Verify in your environment how quickly disabling a user invalidates already-issued delegated tokens, and test it in CI.",
      "Agent-level containment lives in the broker (cache purge, policy block); the platform-level control is the user."
    ]
  },
  build: { status: "planned", steps: [
    "Onboard a third tenant with one CALL.",
    "Disable a user mid-session and show the next agent call fail.",
    "Purge one agent’s tokens in the broker."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
}

);
