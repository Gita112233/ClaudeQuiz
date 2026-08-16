/* =========================================================
   Quiz engine — Cell Structure & Cell Membrane
   Pure vanilla JS, no build step, no external deps.
   Data comes from data/questions.js -> window.QUIZ_DATA
   ========================================================= */

(function () {
  "use strict";

  const DATA = window.QUIZ_DATA || { mcq: [], matching: [] };

  // ---------- state ----------
  const state = {
    filters: { source: "all", type: "all", lang: "all", topic: "all", shuffle: true },
    queue: [],            // array of {kind:'mcq'|'matching', data}
    index: 0,
    results: [],          // fixed-length, one slot per queue item; null = not yet visited/answered
                           // mcq slot:      {kind:'mcq', selectedDisplayIdx(null if skipped), correctDisplayIdx, skipped, correct, topic, source}
                           // matching slot: {kind:'matching', completed, skipped, correctCount, pairsLength, topic, source}
    shuffleCache: {},     // index -> {displayOrder} for mcq, or {rightOrder} for matching (kept stable across revisits)
    wrongQueueSnapshot: [],
  };

  // ---------- helpers ----------
  function shuffleArr(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "class") node.className = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  const LETTERS = ["A", "B", "C", "D", "E"];

  // ---------- setup screen wiring ----------
  const screens = {
    setup: document.getElementById("screen-setup"),
    quiz: document.getElementById("screen-quiz"),
    result: document.getElementById("screen-result"),
  };

  function showScreen(name) {
    Object.keys(screens).forEach((k) => screens[k].classList.toggle("hidden", k !== name));
  }

  function wireChipRow(rowId, filterKey, onChange) {
    const row = document.getElementById(rowId);
    row.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      [...row.children].forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      state.filters[filterKey] = btn.dataset.value === "shuffle" ? true
        : btn.dataset.value === "order" ? false
        : btn.dataset.value;
      if (onChange) onChange();
    });
  }

  function matchesFilters(item, f) {
    const source = item.data.source;
    if (f.source !== "all" && source !== f.source) return false;
    if (f.type !== "all" && item.kind !== f.type) return false;
    if (item.kind === "mcq" && f.lang !== "all" && item.data.lang !== f.lang) return false;
    if (f.topic !== "all" && item.data.topic !== f.topic) return false;
    return true;
  }

  function allItems() {
    const mcqItems = DATA.mcq.map((d) => ({ kind: "mcq", data: d }));
    const matchItems = DATA.matching.map((d) => ({ kind: "matching", data: d }));
    return mcqItems.concat(matchItems);
  }

  function refreshTopicOptions() {
    const sel = document.getElementById("filter-topic");
    const f = state.filters;
    const pool = allItems().filter((item) => {
      const source = item.data.source;
      if (f.source !== "all" && source !== f.source) return false;
      if (f.type !== "all" && item.kind !== f.type) return false;
      if (item.kind === "mcq" && f.lang !== "all" && item.data.lang !== f.lang) return false;
      return true;
    });
    // Keep topics in slide order (order they first appear in the data), not alphabetical
    const topics = [...new Set(pool.map((i) => i.data.topic))];
    const current = sel.value;
    sel.innerHTML = "";
    sel.appendChild(el("option", { value: "all" }, ["ทุกหัวข้อ (" + pool.length + " ข้อ)"]));
    topics.forEach((t) => {
      const count = pool.filter((i) => i.data.topic === t).length;
      sel.appendChild(el("option", { value: t }, [t + " (" + count + ")"]));
    });
    if (topics.includes(current)) sel.value = current;
    else state.filters.topic = "all";
    updateStatsRow(pool.length);
  }

  function updateStatsRow(countOverride) {
    const f = state.filters;
    const pool = allItems().filter((item) => matchesFilters(item, f));
    const n = countOverride != null ? countOverride : pool.length;
    const mcqN = DATA.mcq.length;
    const matchN = DATA.matching.length;
    const matchPairs = DATA.matching.reduce((a, m) => a + m.pairs.length, 0);
    document.getElementById("setup-stats").innerHTML =
      `<span>คลังคำถามทั้งหมด: <b>${mcqN}</b> ข้อปรนัย + <b>${matchN}</b> ชุดจับคู่ (<b>${matchPairs}</b> คู่)</span>` +
      `<span>ตามตัวกรองปัจจุบัน: <b>${n}</b> ข้อ/ชุด</span>`;
  }

  wireChipRow("filter-source", "source", refreshTopicOptions);
  wireChipRow("filter-type", "type", refreshTopicOptions);
  wireChipRow("filter-lang", "lang", refreshTopicOptions);
  wireChipRow("filter-shuffle", "shuffle", null);
  document.getElementById("filter-topic").addEventListener("change", (e) => {
    state.filters.topic = e.target.value;
    updateStatsRow();
  });

  refreshTopicOptions();

  document.getElementById("btn-start").addEventListener("click", () => {
    const f = state.filters;
    let pool = allItems().filter((item) => matchesFilters(item, f));
    if (pool.length === 0) {
      alert("ไม่พบคำถามตามตัวกรองที่เลือก ลองปรับตัวกรองใหม่");
      return;
    }
    if (f.shuffle) pool = shuffleArr(pool);
    startQuiz(pool);
  });

  // ---------- quiz runner ----------
  function startQuiz(queue) {
    state.queue = queue;
    state.index = 0;
    state.results = new Array(queue.length).fill(null);
    state.shuffleCache = {};
    showScreen("quiz");
    renderCurrent();
  }

  document.getElementById("btn-quit").addEventListener("click", () => {
    const anyAnswered = state.results.some((r) => r);
    if (!anyAnswered) {
      showScreen("setup");
      return;
    }
    finishQuiz();
  });

  document.getElementById("btn-prev").addEventListener("click", () => {
    if (state.index > 0) {
      state.index -= 1;
      renderCurrent();
    }
  });

  document.getElementById("btn-restart").addEventListener("click", () => {
    showScreen("setup");
    refreshTopicOptions();
  });

  document.getElementById("btn-retry-wrong").addEventListener("click", () => {
    if (state.wrongQueueSnapshot.length === 0) {
      alert("ไม่มีข้อที่ตอบผิดหรือข้ามไว้ เก่งมาก!");
      return;
    }
    startQuiz(shuffleArr(state.wrongQueueSnapshot));
  });

  function computeScore() {
    let score = 0;
    let total = 0;
    state.results.forEach((r) => {
      if (!r || r.skipped) return;
      if (r.kind === "mcq") {
        total += 1;
        score += r.correct;
      } else {
        total += r.pairsLength;
        score += r.correctCount;
      }
    });
    return { score, total };
  }

  function updateTopbar() {
    const total = state.queue.length;
    const pos = Math.min(state.index + 1, total);
    document.getElementById("quiz-position").textContent = `ข้อ ${pos}/${total}`;
    document.getElementById("progress-fill").style.width = `${(state.index / total) * 100}%`;
    document.getElementById("btn-prev").disabled = state.index === 0;
    const { score, total: scoredTotal } = computeScore();
    document.getElementById("score-pill").textContent =
      `✔ ${score.toFixed(score % 1 ? 1 : 0)} / ${scoredTotal}`;
  }

  function renderCurrent() {
    updateTopbar();
    const card = document.getElementById("q-card");
    card.innerHTML = "";
    const item = state.queue[state.index];
    if (!item) { finishQuiz(); return; }
    const existing = state.results[state.index];
    if (item.kind === "mcq") renderMCQ(item, card, existing);
    else renderMatching(item, card, existing);
  }

  function isLastQuestion() {
    return state.index === state.queue.length - 1;
  }

  function commitAndAdvance(record) {
    state.results[state.index] = record;
    updateTopbar();
  }

  function goNext() {
    if (isLastQuestion()) finishQuiz();
    else {
      state.index += 1;
      renderCurrent();
    }
  }

  function nextButtonLabel() {
    return isLastQuestion() ? "ดูผลสรุป" : "ข้อถัดไป →";
  }

  // ---------- MCQ rendering ----------
  function renderMCQ(item, card, existing) {
    const q = item.data;
    const idx = state.index;

    // Reuse cached shuffle order across revisits so the layout doesn't jump around
    if (!state.shuffleCache[idx]) {
      const displayOrder = shuffleArr(q.choices.map((_, i) => i));
      state.shuffleCache[idx] = { displayOrder };
    }
    const displayOrder = state.shuffleCache[idx].displayOrder;
    const displayChoices = displayOrder.map((origIdx) => q.choices[origIdx]);
    const correctDisplayIdx = displayOrder.indexOf(q.answerIndex);

    const alreadyAnswered = existing && !existing.skipped;

    card.appendChild(
      el("div", { class: "q-meta" }, [
        el("div", { class: "q-meta-tags" }, [
          el("span", { class: "tag" }, [q.topic]),
          el("span", { class: "tag tag-lang" }, [q.lang === "th" ? "ภาษาไทย" : "English"]),
          el("span", { class: "tag tag-lang" }, [q.source]),
        ]),
      ])
    );
    card.appendChild(el("div", { class: "q-text" }, [q.question]));

    const list = el("div", { class: "choice-list" });
    card.appendChild(list);

    let hintBtn = null;
    let hintShown = false;
    if (!alreadyAnswered) {
      hintBtn = el("button", { class: "hint-toggle" }, ["💡 ดู Hint"]);
      hintBtn.addEventListener("click", () => {
        if (hintShown) return;
        hintShown = true;
        card.insertBefore(el("div", { class: "hint-box" }, ["💡 " + q.hint]), hintBtn);
        hintBtn.remove();
      });
      card.appendChild(hintBtn);
    }

    const btnRow = el("div", { class: "q-actions" });
    card.appendChild(btnRow);

    let answeredIdx = alreadyAnswered ? existing.selectedDisplayIdx : null;

    let skipBtn = null;
    if (!alreadyAnswered) {
      skipBtn = el(
        "button",
        { class: "btn btn-secondary btn-skip", onclick: () => skipQuestion() },
        ["ข้ามข้อนี้ ⏭"]
      );
      btnRow.appendChild(skipBtn);
    }

    displayChoices.forEach((choice, i) => {
      const btn = el(
        "button",
        {
          class: "choice-btn",
          onclick: () => selectChoice(i),
        },
        [el("span", { class: "choice-letter" }, [LETTERS[i]]), el("span", {}, [choice])]
      );
      list.appendChild(btn);
    });

    function paintResult(selIdx) {
      const correct = selIdx === correctDisplayIdx;
      [...list.children].forEach((btn, i) => {
        btn.disabled = true;
        if (i === correctDisplayIdx) btn.classList.add("correct");
        else if (i === selIdx) btn.classList.add("wrong");
      });
      const box = el("div", { class: "explain-box " + (correct ? "is-correct" : "is-wrong") }, [
        el("div", { class: "verdict" }, [correct ? "✔ ถูกต้อง!" : "✘ ยังไม่ถูก"]),
        el("div", {}, [q.explanation]),
      ]);
      card.insertBefore(box, btnRow);
      return correct;
    }

    function appendNavButtons() {
      const nextBtn = el(
        "button",
        { class: "btn btn-primary", onclick: () => goNext() },
        [nextButtonLabel()]
      );
      btnRow.appendChild(nextBtn);
    }

    function skipQuestion() {
      if (answeredIdx !== null) return;
      answeredIdx = -1;
      commitAndAdvance({
        kind: "mcq", selectedDisplayIdx: null, correctDisplayIdx,
        skipped: true, correct: 0, topic: q.topic, source: q.source,
      });
      goNext();
    }

    function selectChoice(i) {
      if (answeredIdx !== null) return;
      answeredIdx = i;
      if (skipBtn) skipBtn.remove();
      if (hintBtn && !hintShown) hintBtn.remove();
      const correct = paintResult(i);
      commitAndAdvance({
        kind: "mcq", selectedDisplayIdx: i, correctDisplayIdx,
        skipped: false, correct: correct ? 1 : 0, topic: q.topic, source: q.source,
      });
      appendNavButtons();
    }

    if (alreadyAnswered) {
      paintResult(existing.selectedDisplayIdx);
      appendNavButtons();
    }
  }

  // ---------- Matching rendering ----------
  function renderMatching(item, card, existing) {
    const q = item.data;
    const pairs = q.pairs;
    const idx = state.index;

    if (!state.shuffleCache[idx]) {
      const rightOrder = shuffleArr(pairs.map((_, i) => i));
      state.shuffleCache[idx] = { rightOrder };
    }
    const rightOrder = state.shuffleCache[idx].rightOrder;

    const alreadyCompleted = existing && existing.completed && !existing.skipped;

    card.appendChild(
      el("div", { class: "q-meta" }, [
        el("div", { class: "q-meta-tags" }, [
          el("span", { class: "tag" }, [q.topic]),
          el("span", { class: "tag tag-lang" }, ["Matching · " + q.source]),
        ]),
      ])
    );
    card.appendChild(el("div", { class: "q-text" }, [q.instructions]));

    const grid = el("div", { class: "match-grid" });
    const leftCol = el("div", { class: "match-col" }, [el("h4", {}, ["Column A"])]);
    const rightCol = el("div", { class: "match-col" }, [el("h4", {}, ["Column B"])]);
    grid.appendChild(leftCol);
    grid.appendChild(rightCol);
    card.appendChild(grid);

    const statusLine = el("div", { class: "hint-box hidden" }, []);
    card.appendChild(statusLine);

    const btnRow = el("div", { class: "q-actions" });
    card.appendChild(btnRow);

    const leftItems = pairs.map((p, i) => ({ text: p.left, pairIdx: i }));
    const rightItems = rightOrder.map((pairIdx) => ({ text: pairs[pairIdx].right, pairIdx }));

    if (alreadyCompleted) {
      leftItems.forEach((li) => {
        leftCol.appendChild(el("div", { class: "match-item correct paired" }, [li.text]));
      });
      rightItems.forEach((ri) => {
        rightCol.appendChild(el("div", { class: "match-item correct paired" }, [ri.text]));
      });
      flashStatusEl(statusLine, `🎉 คุณจับคู่ครบชุดนี้แล้ว (${pairs.length}/${pairs.length} คู่)`, true);
      btnRow.appendChild(
        el("button", { class: "btn btn-primary", onclick: () => goNext() }, [nextButtonLabel()])
      );
      return;
    }

    // interactive mode (fresh, or re-attempting a previously skipped set)
    let selectedLeft = null;
    let correctCount = 0;
    let attemptedCount = 0;
    const lockedPairs = new Set();

    const skipBtn = el(
      "button",
      { class: "btn btn-secondary btn-skip", onclick: () => skipMatching() },
      ["ข้ามข้อนี้ ⏭"]
    );
    btnRow.appendChild(skipBtn);

    const nextBtn = el(
      "button",
      { class: "btn btn-primary", disabled: "disabled" },
      [nextButtonLabel()]
    );
    nextBtn.disabled = true;
    btnRow.appendChild(nextBtn);

    function skipMatching() {
      commitAndAdvance({
        kind: "matching", completed: false, skipped: true,
        correctCount: 0, pairsLength: pairs.length, topic: q.topic, source: q.source,
      });
      goNext();
    }

    leftItems.forEach((li) => {
      const node = el("div", { class: "match-item", onclick: () => onLeftClick(li, node) }, [li.text]);
      leftCol.appendChild(node);
    });
    rightItems.forEach((ri) => {
      const node = el("div", { class: "match-item", onclick: () => onRightClick(ri, node) }, [ri.text]);
      rightCol.appendChild(node);
    });

    function onLeftClick(li, node) {
      if (lockedPairs.has(li.pairIdx)) return;
      if (selectedLeft && selectedLeft.node === node) {
        selectedLeft = null;
        node.classList.remove("selected");
        return;
      }
      [...leftCol.children].forEach((c) => c.classList.remove("selected"));
      node.classList.add("selected");
      selectedLeft = { pairIdx: li.pairIdx, node };
    }

    function onRightClick(ri, node) {
      if (lockedPairs.has(ri.pairIdx) && node.classList.contains("correct")) return;
      if (!selectedLeft) {
        flashStatusEl(statusLine, "เลือกข้อความฝั่ง Column A ก่อน แล้วค่อยเลือกคู่ที่ตรงกันฝั่ง Column B");
        return;
      }
      attemptedCount += 1;
      const isCorrect = selectedLeft.pairIdx === ri.pairIdx;
      if (isCorrect) {
        correctCount += 1;
        lockedPairs.add(ri.pairIdx);
        selectedLeft.node.classList.remove("selected");
        selectedLeft.node.classList.add("correct", "paired");
        node.classList.add("correct", "paired");
        flashStatusEl(statusLine, `✔ ถูกต้อง: "${pairs[ri.pairIdx].left}" = "${pairs[ri.pairIdx].right}"`, true);
      } else {
        selectedLeft.node.classList.add("wrong");
        node.classList.add("wrong");
        flashStatusEl(statusLine, "✘ ยังไม่ตรงกัน ลองใหม่อีกครั้ง", false);
        setTimeout(() => {
          selectedLeft.node.classList.remove("wrong");
          node.classList.remove("wrong");
        }, 650);
      }
      selectedLeft.node.classList.remove("selected");
      selectedLeft = null;

      if (lockedPairs.size === pairs.length) finishMatching();
    }

    function finishMatching() {
      flashStatusEl(statusLine, `🎉 จับคู่ครบแล้ว ${pairs.length}/${pairs.length} คู่ (ใช้ความพยายาม ${attemptedCount} ครั้ง)`, true);
      skipBtn.remove();
      nextBtn.disabled = false;
      commitAndAdvance({
        kind: "matching", completed: true, skipped: false,
        correctCount, pairsLength: pairs.length, topic: q.topic, source: q.source,
      });
    }
  }

  function flashStatusEl(statusLine, text, ok) {
    statusLine.classList.remove("hidden");
    statusLine.textContent = text;
    statusLine.style.borderColor = ok === undefined ? "" : ok ? "var(--correct)" : "var(--wrong)";
  }

  // ---------- results ----------
  function finishQuiz() {
    showScreen("result");
    const skippedCount = state.results.filter((r) => r && r.skipped).length;
    const { score, total } = computeScore();
    const pct = total ? Math.round((score / total) * 100) : 0;
    document.getElementById("result-score").textContent = pct + "%";
    document.getElementById("result-sub").textContent =
      `ตอบถูก ${score.toFixed(score % 1 ? 1 : 0)} จาก ${total} ข้อ/คู่ที่ตอบจริง` +
      (skippedCount ? ` · ข้ามไป ${skippedCount} ข้อ/ชุด` : "") +
      ` (จากทั้งหมด ${state.queue.length} ข้อ/ชุด)`;

    // topic breakdown — skipped/unvisited items are excluded since they weren't attempted
    const byTopic = {};
    state.results.forEach((r) => {
      if (!r || r.skipped) return;
      if (!byTopic[r.topic]) byTopic[r.topic] = { correct: 0, total: 0 };
      if (r.kind === "mcq") {
        byTopic[r.topic].correct += r.correct;
        byTopic[r.topic].total += 1;
      } else {
        byTopic[r.topic].correct += r.correctCount;
        byTopic[r.topic].total += r.pairsLength;
      }
    });
    const breakdown = document.getElementById("topic-breakdown");
    breakdown.innerHTML = "";
    Object.keys(byTopic).sort().forEach((t) => {
      const s = byTopic[t];
      const pctT = Math.round((s.correct / s.total) * 100);
      breakdown.appendChild(
        el("div", { class: "topic-row" }, [
          el("span", { class: "topic-name" }, [t]),
          el("span", {}, [`${pctT}%`]),
        ])
      );
    });

    // wrong/skipped queue snapshot for retry
    state.wrongQueueSnapshot = state.results
      .map((r, i) => (r ? { r, item: state.queue[i] } : null))
      .filter((x) => x && (x.r.skipped || (x.r.kind === "mcq" ? x.r.correct < 1 : x.r.correctCount < x.r.pairsLength)))
      .map((x) => x.item);
  }
})();
