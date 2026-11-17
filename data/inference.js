/* LLM Fundamentals & Inference */
window.QUESTIONS.push(

/* ------------------------------------------------------------------ Q13 */
{
  id: "training-parallel-inference-sequential",
  section: "inference",
  title: "Why is LLM training parallel while generation streams one token at a time — and what does that mean for running AI SQL over millions of rows?",
  scenario: "A data team runs AI_COMPLETE over 5M support tickets and asks why one long answer is slow, yet the batch job over millions of rows still finishes in reasonable time.",
  tags: ["autoregressive", "training", "inference", "decoding", "batch inference"],
  level: "Core",
  tests: "Your understanding of autoregressive generation and where parallelism actually exists.",
  tldr: "LLMs are autoregressive: each token depends on all previous tokens, and future tokens don’t exist yet at inference — so generation is a loop. In training the full sequence is known, so all next-token predictions are computed in one parallel pass (causal masking). In batch AI SQL, parallelism comes from processing many rows at once, while each row’s output is still generated sequentially.",
  answer: [
    { h: "Inference is sequential", items: [
      "“The capital of India is” → New → “The capital of India is New” → Delhi.",
      "Token 20 can’t be known before token 1."
    ]},
    { h: "Training is parallel", items: [
      "The full sentence is known in advance.",
      "All positions’ next-token predictions are computed in parallel in one pass."
    ]},
    { h: "Practical implication", items: [
      "Even huge GPUs can’t parallelize a single generation loop.",
      "Throughput comes from parallelism across requests/rows (batching), not within one answer.",
      "Long outputs cost latency linearly — constrain output length when you can."
    ]}
  ],
  tradeoff: "Parallel training makes scale possible; sequential decoding is why inference optimizations (KV cache, batching, speculative decoding, shorter outputs) matter.",
  takeaway: "Future tokens don’t exist yet — generation is a loop; throughput comes from batching across requests.",
  hld: {
    caption: "Same model, different data availability.",
    lanes: [
      { name: "Training", cols: [
        [N("Full sequence known", "", "store")],
        [N("Pos 1 → 2", "", "model"), N("Pos 2 → 3", "", "model"), N("Pos N → N+1", "", "model")],
        [N("One parallel pass", "causal mask", "out")]
      ]},
      { name: "Inference", cols: [
        [N("Prompt", "", "user")],
        [N("Forward pass", "", "model")],
        [N("Token t", "", "out")],
        [N("Append + repeat", "until EOS", "decide")]
      ]}
    ]
  },
  lld: {
    caption: "Two Snowflake experiments: stream one answer token-by-token via the REST API, and compare output length vs runtime in batch AI SQL.",
    lanes: [
      { name: "Single answer", cols: [
        [N("Python client", "", "user")],
        [N("Cortex REST API", "stream = true", "model")],
        [N("SSE chunks", "token timestamps")],
        [N("TOKEN_TRACE", "", "store")]
      ]},
      { name: "Batch rows", cols: [
        [N("TICKETS", "5M rows", "store")],
        [N("AI_COMPLETE per row", "rows in parallel", "model")],
        [N("max_tokens 50 vs 500", "", "decide")],
        [N("Runtime + credits", "QUERY_HISTORY", "out")]
      ]}
    ],
    objects: [
      ["Cortex REST API", "/api/v2/cortex/inference:complete", "Streamed completions for token timing"],
      ["AISD.LAB.TOKEN_TRACE", "Table", "Per-token arrival time for one generation"],
      ["AISD.LAB.TICKETS", "Table", "Sample rows for batch inference"]
    ],
    code: [
      { title: "Batch: output length drives cost and time", lang: "sql", src:
`-- short output
SELECT AI_COMPLETE('llama3.1-8b',
         'Classify this ticket in 3 words: ' || body,
         {'max_tokens': 10})
FROM AISD.LAB.TICKETS SAMPLE (10000 ROWS);

-- long output on the same rows: compare elapsed time + credits in QUERY_HISTORY
SELECT AI_COMPLETE('llama3.1-8b',
         'Write a detailed reply to this ticket: ' || body,
         {'max_tokens': 500})
FROM AISD.LAB.TICKETS SAMPLE (10000 ROWS);` }
    ],
    notes: [
      "Rows are processed in parallel by the service, but each row’s answer is still a sequential decode loop.",
      "For classification/extraction, prefer AI_CLASSIFY / AI_EXTRACT or tight max_tokens — short outputs are much cheaper and faster.",
      "Check the exact AI_COMPLETE options syntax for your account version."
    ]
  },
  build: { status: "planned", steps: [
    "Stream one answer and plot token arrival times.",
    "Run the short vs long batch comparison and show runtime + credits."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q14 */
{
  id: "measure-llm-latency",
  section: "inference",
  title: "How would you measure and report latency for a chat app built on the Cortex REST API?",
  scenario: "Product says the assistant “feels slow”. You need numbers that point to the bottleneck — prompt size, model choice or load — and an SLO the team can track.",
  tags: ["latency", "ttft", "tps", "prefill", "decode", "streaming", "rest api"],
  level: "Core",
  tests: "Whether you know latency is not one number.",
  tldr: "Split it into TTFT (time to first token — prefill, grows with prompt size) and TPS (tokens/sec during decode — drops with larger models or load), plus end-to-end and retrieval time. For chat, TTFT drives perceived speed because streaming starts sooner. Report p50/p95 per model and prompt-size bucket.",
  answer: [
    { h: "TTFT — time to first token", items: ["How long before the user sees anything.", "Large prompts increase TTFT (prefill phase)."] },
    { h: "TPS — tokens per second", items: ["Streaming speed after the first token.", "Larger models / overloaded GPUs decode slower."] },
    { h: "Why it matters for chat", items: ["Fast-starting streams feel fast even if the full answer takes longer."] },
    { h: "Report", items: ["p50 / p95 TTFT, TPS and end-to-end, sliced by model and prompt size; add retrieval time for RAG."] }
  ],
  tradeoff: "TTFT (prompt size, caching) and TPS (model size, load) are tuned with different levers — one blended number hides which one to pull.",
  takeaway: "Wait before first token vs generation speed — measure both.",
  hld: {
    caption: "Timeline of one streamed request.",
    lanes: [
      { name: "Timeline", cols: [
        [N("Request", "t0", "user")],
        [N("Prefill", "", "model")],
        [N("First token", "TTFT = t1 − t0", "out")],
        [N("Decode loop", "TPS", "model")],
        [N("Last token", "E2E = t2 − t0", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Client-side timing of the SSE stream, logged to a table and visualised in Streamlit.",
    lanes: [
      { name: "Measure", cols: [
        [N("Benchmark client", "models × prompt sizes", "user")],
        [N("Cortex REST API", "SSE stream", "model")],
        [N("t0 · t1 · t2 · tokens", "")],
        [N("LATENCY_RUNS", "", "store")],
        [N("Streamlit SLO view", "p50 / p95", "out")]
      ]}
    ],
    objects: [
      ["Cortex REST API", "inference:complete (stream)", "Model calls with PAT / key-pair auth"],
      ["AISD.OBS.LATENCY_RUNS", "Table", "model, prompt_tokens, ttft_ms, tps, e2e_ms, retrieval_ms, ts"],
      ["Streamlit in Snowflake", "App", "Percentiles by model and prompt-size bucket"]
    ],
    code: [
      { title: "Measure TTFT and TPS from the stream (Python)", lang: "python", src:
`import time, json, requests

URL = f"https://{ACCOUNT}.snowflakecomputing.com/api/v2/cortex/inference:complete"
HEADERS = {"Authorization": f"Bearer {PAT}", "Content-Type": "application/json",
           "Accept": "text/event-stream"}

def measure(model, prompt):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True}
    t0 = time.perf_counter(); t1 = None; chunks = 0
    with requests.post(URL, headers=HEADERS, json=body, stream=True, timeout=120) as r:
        for line in r.iter_lines():
            if not line.startswith(b"data:"):
                continue
            if t1 is None:
                t1 = time.perf_counter()          # first token arrived
            chunks += 1                            # approx tokens; use usage field if present
    t2 = time.perf_counter()
    return {"ttft_ms": (t1 - t0) * 1000,
            "tps": chunks / max(t2 - t1, 1e-6),
            "e2e_ms": (t2 - t0) * 1000}` },
      { title: "SLO report", lang: "sql", src:
`SELECT model,
       WIDTH_BUCKET(prompt_tokens, 0, 8000, 4)                    AS prompt_bucket,
       APPROX_PERCENTILE(ttft_ms, 0.5)  AS ttft_p50,
       APPROX_PERCENTILE(ttft_ms, 0.95) AS ttft_p95,
       APPROX_PERCENTILE(tps, 0.5)      AS tps_p50,
       APPROX_PERCENTILE(e2e_ms, 0.95)  AS e2e_p95
FROM AISD.OBS.LATENCY_RUNS
GROUP BY 1, 2 ORDER BY 1, 2;` }
    ],
    notes: [
      "Measure from the client — that’s what the user experiences, including network.",
      "For RAG, log retrieval_ms separately: Cortex Search time often matters as much as TTFT.",
      "Count tokens from the response usage field when available; SSE chunk count is only an approximation."
    ]
  },
  build: { status: "planned", steps: [
    "Benchmark 3 models × 3 prompt sizes × 20 runs.",
    "Plot TTFT vs prompt size and TPS vs model.",
    "Define an SLO (e.g. TTFT p95 < 1.5s) and show which configs meet it."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
},

/* ------------------------------------------------------------------ Q15 */
{
  id: "scale-inference-100x",
  section: "inference",
  title: "Traffic to your AI features grows 100x after launch. How do you scale inference?",
  scenario: "An AI summarization feature is launched to all customers. Requests jump from 1K to 100K per hour, with spikes at the start of the business day.",
  tags: ["scaling", "caching", "batching", "replicas", "queuing", "spcs"],
  level: "Advanced",
  tests: "Whether you find the bottleneck first and understand that scaling levers interact.",
  tldr: "Find the bottleneck (model, GPUs, request rate, latency SLO). Then: cache (repeated queries, retrieval results, prompt prefixes), batch (group concurrent requests per pass), replicate behind a load balancer, and queue spikes instead of dropping them. Move non-interactive work to batch.",
  answer: [
    { h: "First: where is the bottleneck?", items: ["Model, GPUs, request rate or latency requirements."] },
    { h: "Levers", items: [
      "Caching: repeated queries, retrieval results, prompt prefixes.",
      "Batching: group requests into one inference pass for GPU utilization.",
      "Replicas: multiple model instances behind a load balancer.",
      "Queuing: buffer spikes instead of dropping requests."
    ]},
    { h: "They interact", items: ["Bigger batches → throughput ↑, latency ↑.", "More replicas → capacity ↑, cost ↑.", "Queues → protection ↑, wait time ↑."] },
    { h: "Provider limits at peak", items: [
      "A sale-day spike can hit the provider’s rate limits even if your backend scales.",
      "Agree provisioned capacity with the provider from your peak estimates; spill over to a fallback model.",
      "Throttle and queue deferrable work instead of failing it."
    ]}
  ],
  caseStudy: { id: "shopnest", stage: 10 },
  related: ["requirements-estimation", "llm-gateway", "semantic-cache"],
  tradeoff: "Throughput, latency and cost are coupled — every lever moves at least two of them.",
  takeaway: "Caching + batching + replicas + queuing — not just more GPUs.",
  hld: {
    caption: "Request path for high-volume inference.",
    lanes: [
      { name: "Serving", cols: [
        [N("Clients", "100×", "user")],
        [N("Cache", "", "decide")],
        [N("Queue", "", "store")],
        [N("Load balancer", "")],
        [N("Batcher", "")],
        [N("Replica 1", "", "model"), N("Replica 2", "", "model"), N("Replica N", "", "model")],
        [N("Responses", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Serve interactive traffic through a cache in front of Cortex; move non-interactive work to batch SQL; self-hosted models scale on SPCS GPU pools.",
    lanes: [
      { name: "Interactive", cols: [
        [N("App", "", "user")],
        [N("RESPONSE_CACHE", "hash(model, prompt)", "decide")],
        [N("Cortex REST API", "managed models", "model"), N("SPCS service", "self-hosted · MIN/MAX instances", "model")],
        [N("Write-through cache", "", "store")],
        [N("Response", "", "out")]
      ]},
      { name: "Batch", cols: [
        [N("REQUEST_QUEUE", "non-urgent jobs", "store")],
        [N("Task every 5 min", "", "proc")],
        [N("AI_COMPLETE over rows", "set-based batch", "model")],
        [N("RESULTS", "", "out")]
      ]}
    ],
    objects: [
      ["AISD.INF.RESPONSE_CACHE", "Hybrid table", "Fast point lookups by prompt hash with TTL"],
      ["AISD.INF.REQUEST_QUEUE", "Table", "Deferred, non-interactive requests"],
      ["AISD.INF.BATCH_TASK", "Task", "Drains the queue with set-based AI SQL"],
      ["GPU_POOL + MODEL_SVC", "SPCS compute pool + service", "Self-hosted model replicas (MIN_INSTANCES / MAX_INSTANCES)"]
    ],
    code: [
      { title: "Response cache", lang: "sql", src:
`CREATE HYBRID TABLE IF NOT EXISTS AISD.INF.RESPONSE_CACHE (
  cache_key STRING PRIMARY KEY,   -- SHA2(model || normalized prompt || tenant)
  response  STRING,
  created_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP());

-- lookup
SELECT response FROM AISD.INF.RESPONSE_CACHE
WHERE cache_key = SHA2(:model || LOWER(TRIM(:prompt)) || :tenant)
  AND created_at > DATEADD('hour', -24, CURRENT_TIMESTAMP());` },
      { title: "Queue + batch drain", lang: "sql", src:
`CREATE OR REPLACE TASK AISD.INF.BATCH_TASK
  WAREHOUSE = AISD_WH SCHEDULE = '5 MINUTE'
AS
INSERT INTO AISD.INF.RESULTS (req_id, output)
SELECT req_id, AI_COMPLETE('llama3.1-70b', prompt)
FROM AISD.INF.REQUEST_QUEUE
WHERE status = 'QUEUED';` },
      { title: "Self-hosted replicas on SPCS", lang: "sql", src:
`CREATE COMPUTE POOL IF NOT EXISTS GPU_POOL
  MIN_NODES = 1 MAX_NODES = 4 INSTANCE_FAMILY = GPU_NV_S;

CREATE SERVICE IF NOT EXISTS AISD.INF.MODEL_SVC
  IN COMPUTE POOL GPU_POOL
  FROM @AISD.INF.SPECS SPECIFICATION_FILE = 'vllm.yaml'   -- vLLM does continuous batching
  MIN_INSTANCES = 1 MAX_INSTANCES = 4;` }
    ],
    notes: [
      "With Cortex-managed models, GPU capacity is Snowflake’s concern; your levers are caching, prompt size, model choice and moving work to batch.",
      "Include tenant in the cache key — never serve one tenant’s cached answer to another.",
      "Self-hosted on SPCS: a serving engine like vLLM provides continuous batching; scale replicas with MIN/MAX_INSTANCES.",
      "Queue anything that doesn’t need an immediate answer (nightly summaries, enrichment)."
    ]
  },
  build: { status: "planned", steps: [
    "Load-test the endpoint with and without the cache.",
    "Compare per-request API calls vs set-based batch for 10K rows.",
    "Optional: deploy a small open model on SPCS and scale instances."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
}

);
