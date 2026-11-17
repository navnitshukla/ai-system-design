// Validates site content: run with `node tools/validate.js` from the repo root.
const vm = require("vm"), fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
global.window = {};
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const files = [...html.matchAll(/<script src="(data\/[^"]+)"/g)].map(m => m[1]);
files.forEach(f => vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f }));

const Q = window.QUESTIONS, S = window.SECTIONS, C = window.CASE_STUDIES || [];
const ids = new Set(Q.map(q => q.id));
const errors = [];
if (ids.size !== Q.length) errors.push("duplicate question ids");
Q.forEach(q => {
  ["title", "scenario", "tests", "tldr", "answer", "tradeoff", "takeaway", "hld", "lld", "build"].forEach(k => { if (!q[k]) errors.push(q.id + ": missing " + k); });
  if (!S.some(s => s.id === q.section)) errors.push(q.id + ": unknown section " + q.section);
  (q.related || []).forEach(r => { if (!ids.has(r)) errors.push(q.id + ": related id not found " + r); });
  if (q.caseStudy) {
    const cs = C.find(c => c.id === q.caseStudy.id);
    if (!cs || !cs.stages[q.caseStudy.stage]) errors.push(q.id + ": bad caseStudy link");
  }
});
C.forEach(cs => {
  const comp = new Set(cs.components.map(c => c.id));
  cs.components.forEach(c => { if (!cs.lanes.some(l => l.id === c.lane)) errors.push(cs.id + ": bad lane " + c.id); });
  cs.stages.forEach((st, n) => {
    (st.adds || []).forEach(a => {
      if (!comp.has(a)) errors.push(cs.id + " stage " + n + ": unknown component " + a);
      else if (cs.components.find(c => c.id === a).stage !== n) errors.push(cs.id + " stage " + n + ": component " + a + " has different stage");
    });
    (st.related || []).forEach(r => { if (!ids.has(r)) errors.push(cs.id + " stage " + n + ": related not found " + r); });
  });
  cs.components.forEach(c => { if (!cs.stages[c.stage].adds.includes(c.id)) errors.push(cs.id + ": component " + c.id + " not listed in stage " + c.stage + " adds"); });
  cs.practice.forEach(p => { if (!ids.has(p.id)) errors.push(cs.id + ": practice id not found " + p.id); });
});
console.log(JSON.stringify({ files, questions: Q.length, sections: S.length, caseStudies: C.length,
  stages: C.map(c => c.stages.length), errors }, null, 1));
