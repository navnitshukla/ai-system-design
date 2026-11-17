/*
 * AI System Design — content model.
 * Load order: sections.js first, then one file per section (rag.js, agents.js, ...).
 * Question order on the site = load order of files + order inside each file.
 *
 * Question schema:
 *   id         unique slug used in the URL (#/q/<id>)
 *   section    one of the SECTIONS ids below
 *   title      the interview question (reworded, Snowflake-flavoured scenario)
 *   scenario   short business context that grounds the question in a Snowflake deployment
 *   tags, level ("Core" | "Advanced")
 *   tests      what the interviewer is really testing
 *   tldr       30-second answer
 *   answer     [{ h, items: [..] }]          vendor-neutral interview answer
 *   tradeoff, takeaway
 *   hld        { caption, lanes }             vendor-neutral high-level design
 *   lld        { caption, lanes,              Snowflake low-level design
 *                objects: [[object, type, purpose]],
 *                code:    [{ title, lang, src }],
 *                notes:   [design decision, ...] }
 *   build      { status: "planned" | "in-progress" | "done", steps: [..], repo }
 *   video      { youtubeId, notes }
 *
 * lanes: [{ name, cols: [[node, ...], ...] }]  — each col is a step; several nodes in a col = parallel/alternatives
 * node:  N(label, subLabel, kind)   kind: user | proc | store | model | guard | decide | out
 *
 * Conventions used in the Snowflake designs: database AISD, warehouse AISD_WH.
 * SQL is a reference design — validate against current Snowflake docs while building.
 */

function N(t, s, k) { return { t: t, s: s || "", k: k || "proc" }; }

window.SECTIONS = [
  { id: "rag", name: "RAG & Retrieval", blurb: "Document ingestion, hybrid search, reranking, scale, conflicting sources and retrieval security." },
  { id: "agents", name: "Agents & Memory", blurb: "Tool selection, failure recovery and memory architecture for data agents." },
  { id: "inference", name: "LLM Fundamentals & Inference", blurb: "Why generation is sequential, how to measure latency and how to scale serving." },
  { id: "platform", name: "Platform & Governance", blurb: "Governed LLM access, model cascades and multi-tenant isolation." },
  { id: "prod", name: "Production Readiness", blurb: "Taking an AI assistant from demo to production: requirements, abuse protection, guardrails, caching, freshness, escalation and observability." },
  { id: "eval", name: "Evaluation", blurb: "Why offline scores diverge from user reality and how to close the loop." }
];

window.QUESTIONS = [];
window.CASE_STUDIES = [];
