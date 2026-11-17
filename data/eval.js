/* Evaluation */
window.QUESTIONS.push(

/* ------------------------------------------------------------------ Q19 */
{
  id: "eval-high-users-unhappy",
  section: "eval",
  title: "Your RAG app scores well on offline evals, but users in Snowflake Intelligence still complain. What’s wrong?",
  scenario: "The eval dashboard shows 92% answer correctness, yet thumbs-down feedback is rising and users keep rephrasing questions or abandoning chats.",
  tags: ["evals", "metric mismatch", "product metrics", "production feedback", "ai observability"],
  level: "Core",
  tests: "Whether you know a good model score does not equal a good system.",
  tldr: "Metric mismatch — the eval set doesn’t reflect production (clean vs messy questions; correctness vs speed, clarity, task success). Cluster real failed sessions, feed those patterns back into evals, and track product metrics: task completion, escalation, user correction and repeat-question rates.",
  answer: [
    { h: "Diagnosis: metric mismatch", items: [
      "Evals use clean questions; users ask vague, messy, ambiguous ones.",
      "Evals measure correctness; users care about speed, clarity and finishing the task."
    ]},
    { h: "What to do", items: [
      "Review failed production sessions and cluster complaints.",
      "Look for: slow responses, repeated misunderstandings, rephrasing, drop-offs.",
      "Promote these failure patterns into the eval set — offline evals evolve with production."
    ]},
    { h: "Track product metrics", items: ["Task completion rate", "Escalation rate", "User correction rate", "Repeat-question rate"] }
  ],
  tradeoff: "Production-driven evals need logging, labelling and privacy controls, but they’re the only way to measure what users actually experience.",
  takeaway: "The real question is whether users are succeeding.",
  hld: {
    caption: "Close the loop between production and offline evals.",
    lanes: [
      { name: "Loop", cols: [
        [N("Production sessions", "", "user")],
        [N("Failed sessions", "", "guard")],
        [N("Cluster patterns", "", "model")],
        [N("Eval set", "grows with reality", "store")],
        [N("Offline eval", "")],
        [N("Product metrics", "", "out")]
      ]}
    ]
  },
  lld: {
    caption: "Log sessions and feedback, derive product metrics in SQL, cluster failures with AI functions, and promote them into the AI Observability eval dataset.",
    lanes: [
      { name: "Signals", cols: [
        [N("App / Intelligence", "", "user")],
        [N("CHAT_SESSIONS · MESSAGES · FEEDBACK", "", "store")],
        [N("V_PRODUCT_METRICS", "completion · repeat · escalation", "proc")],
        [N("Streamlit KPI dashboard", "", "out")]
      ]},
      { name: "Improve", cols: [
        [N("Failed sessions", "thumbs-down · rephrase · abandon", "guard")],
        [N("AI_CLASSIFY", "failure type", "model")],
        [N("AI_AGG", "summarize per cluster", "model")],
        [N("EVAL_QUESTIONS", "+ real failures", "store")],
        [N("AI Observability run", "", "out")]
      ]}
    ],
    objects: [
      ["AISD.APP.CHAT_SESSIONS / CHAT_MESSAGES / FEEDBACK", "Tables", "Production conversation logs and thumbs up/down"],
      ["AISD.APP.V_PRODUCT_METRICS", "View", "Task completion, repeat-question, escalation, correction rates"],
      ["AISD.EVAL.FAILURE_CLUSTERS", "Table", "Failure type and summary per cluster"],
      ["AISD.EVAL.EVAL_QUESTIONS", "Table", "Eval set enriched with real failed questions"]
    ],
    code: [
      { title: "Product metrics from logs", lang: "sql", src:
`CREATE OR REPLACE VIEW AISD.APP.V_PRODUCT_METRICS AS
WITH s AS (
  SELECT session_id,
         MAX(IFF(event = 'task_completed', 1, 0))  AS completed,
         MAX(IFF(event = 'escalated', 1, 0))       AS escalated,
         MAX(IFF(rating = 'down', 1, 0))           AS thumbs_down,
         -- consecutive user messages that are near-duplicates = rephrasing
         MAX(IFF(user_turn_similarity > 0.85, 1, 0)) AS rephrased
  FROM AISD.APP.CHAT_EVENTS
  GROUP BY session_id
)
SELECT COUNT(*)            AS sessions,
       AVG(completed)      AS task_completion_rate,
       AVG(escalated)      AS escalation_rate,
       AVG(thumbs_down)    AS negative_feedback_rate,
       AVG(rephrased)      AS repeat_question_rate
FROM s;` },
      { title: "Cluster failures and promote to evals", lang: "sql", src:
`CREATE OR REPLACE TABLE AISD.EVAL.FAILURE_CLUSTERS AS
SELECT AI_CLASSIFY(first_question,
         ['ambiguous question', 'missing document', 'wrong answer',
          'too slow', 'unclear answer'] ):labels[0]::STRING  AS failure_type,
       COUNT(*)                                                 AS sessions,
       AI_AGG(first_question, 'Summarize the common user intents and what went wrong') AS summary
FROM AISD.APP.FAILED_SESSIONS
GROUP BY 1;

INSERT INTO AISD.EVAL.EVAL_QUESTIONS (question, category)
SELECT first_question, 'prod-failure'
FROM AISD.APP.FAILED_SESSIONS
SAMPLE (200 ROWS);` }
    ],
    notes: [
      "Expect the eval score to drop after adding real failures — that’s the point; it now measures reality.",
      "Compute user_turn_similarity with AI_EMBED + VECTOR_COSINE_SIMILARITY between consecutive user turns.",
      "Mask PII in logs (masking policies / AI_REDACT) before using them for evals."
    ]
  },
  build: { status: "planned", steps: [
    "Generate synthetic sessions with realistic failures.",
    "Build the product-metrics dashboard.",
    "Cluster failures, promote them into evals, show the score drop — then fix and recover."
  ], repo: "" },
  video: { youtubeId: "", notes: "" }
}

);
