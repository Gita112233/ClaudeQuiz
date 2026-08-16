#!/usr/bin/env node
/**
 * Build script: merges data/source/*.json (MCQ batches + matching.json)
 * into data/questions.js, which the quiz app loads via <script src>.
 *
 * Run this any time you add/edit a file in data/source/.
 *   node build.js
 *
 * See CLAUDE.md for the full authoring workflow.
 */
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "data", "source");
const OUT_FILE = path.join(__dirname, "data", "questions.js");

const MCQ_SCHEMA_KEYS = ["id", "topic", "lang", "question", "choices", "answerIndex", "hint", "explanation"];

function loadMcqFile(file) {
  const full = path.join(SRC_DIR, file);
  const arr = JSON.parse(fs.readFileSync(full, "utf8"));
  const source = file.startsWith("cm") ? "Cell Membrane" : "Cell Structure";
  arr.forEach((q, i) => {
    MCQ_SCHEMA_KEYS.forEach((k) => {
      if (!(k in q)) throw new Error(`${file}[${i}] (id=${q.id}) missing field "${k}"`);
    });
    if (!Array.isArray(q.choices) || q.choices.length !== 5) {
      throw new Error(`${file}[${i}] (id=${q.id}) must have exactly 5 choices`);
    }
    if (typeof q.answerIndex !== "number" || q.answerIndex < 0 || q.answerIndex > 4) {
      throw new Error(`${file}[${i}] (id=${q.id}) answerIndex must be 0-4`);
    }
    q.source = source;
  });
  return arr;
}

function loadMatching() {
  const full = path.join(SRC_DIR, "matching.json");
  const arr = JSON.parse(fs.readFileSync(full, "utf8"));
  arr.forEach((m, i) => {
    ["id", "type", "topic", "instructions", "pairs", "source"].forEach((k) => {
      if (!(k in m)) throw new Error(`matching.json[${i}] (id=${m.id}) missing field "${k}"`);
    });
    if (!Array.isArray(m.pairs) || m.pairs.length < 2) {
      throw new Error(`matching.json[${i}] (id=${m.id}) needs at least 2 pairs`);
    }
  });
  return arr;
}

function main() {
  const mcqFiles = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".json") && f !== "matching.json")
    // Sort by slide order: all "cs*" (Cell Structure, in file order) before "cm*"
    // (Cell Membrane) — plain alphabetical sort would wrongly put cm1 before cs1.
    .sort((a, b) => {
      const groupOf = (f) => (f.startsWith("cs") ? 0 : f.startsWith("cm") ? 1 : 2);
      const ga = groupOf(a), gb = groupOf(b);
      return ga !== gb ? ga - gb : a.localeCompare(b);
    });

  let mcq = [];
  for (const f of mcqFiles) {
    mcq = mcq.concat(loadMcqFile(f));
  }

  const matching = loadMatching();

  // duplicate id check across everything
  const seen = new Set();
  const dups = [];
  [...mcq, ...matching].forEach((q) => {
    if (seen.has(q.id)) dups.push(q.id);
    seen.add(q.id);
  });
  if (dups.length) {
    throw new Error("Duplicate ids found: " + dups.join(", "));
  }

  const data = { mcq, matching };
  const out = "window.QUIZ_DATA = " + JSON.stringify(data) + ";\n";
  fs.writeFileSync(OUT_FILE, out, "utf8");

  const thCount = mcq.filter((q) => q.lang === "th").length;
  const enCount = mcq.filter((q) => q.lang === "en").length;
  const pairCount = matching.reduce((a, m) => a + m.pairs.length, 0);

  console.log(`Built ${OUT_FILE}`);
  console.log(`  MCQ: ${mcq.length} (Thai: ${thCount}, English: ${enCount})`);
  console.log(`  Matching sets: ${matching.length} (${pairCount} pairs total)`);
}

main();
