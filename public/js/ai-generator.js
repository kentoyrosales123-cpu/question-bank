protectPage();
superAdminOnlyPage();

const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];

function canUseSubject(subject) {
  const user = getUser();

  if (isAdminRole(user)) return true;
  if (isCeeCacCoordinatorRole(user)) {
    return CEE_CAC_SUBJECTS.includes(subject);
  }

  return !CEE_CAC_SUBJECTS.includes(subject);
}

function restrictSubjectForCoordinator() {
  if (!isCeeCacCoordinatorRole(getUser())) return;

  const subjectInput = document.getElementById("subject");
  const select = document.createElement("select");
  select.id = "subject";
  select.required = true;
  select.innerHTML = `
    <option value="">Select subject</option>
    ${CEE_CAC_SUBJECTS.map(
      (subject) => `<option value="${subject}">${subject}</option>`,
    ).join("")}
  `;
  subjectInput.replaceWith(select);
}

function setAiMessage(text, isError = true) {
  const message = document.getElementById("aiQuestionMessage");

  message.textContent = text;
  message.classList.toggle("wrong", isError);
  message.classList.toggle("correct", !isError);
}

function setGenerateBusy(isBusy) {
  const button = document.getElementById("generateAiButton");

  button.disabled = isBusy;
  button.textContent = isBusy ? "Generating..." : "Generate Draft Questions";
}

function setAiQueueModalState(state, detail = "") {
  const modal = document.getElementById("aiQueueModal");
  const title = document.getElementById("aiQueueModalTitle");
  const subtitle = document.getElementById("aiQueueModalSubtitle");
  const detailText = document.getElementById("aiQueueModalDetail");
  const steps = {
    queued: document.getElementById("aiQueueStepQueued"),
    generating: document.getElementById("aiQueueStepGenerating"),
    saving: document.getElementById("aiQueueStepSaving"),
  };

  if (!modal || !title || !subtitle || !detailText) return;

  const copy = {
    queued: {
      title: "Queued",
      subtitle: "Your request is in the AI generation queue.",
      detail: "The system will send only 1-2 questions to Qwen at a time.",
    },
    generating: {
      title: "Generating",
      subtitle: "Qwen is creating your draft questions.",
      detail: "Large requests are split into smaller 1-2 item batches.",
    },
    saving: {
      title: "Saving",
      subtitle: "Generated drafts are being saved to the review queue.",
      detail: "The queue below will refresh when saving is complete.",
    },
    complete: {
      title: "Queued Successfully",
      subtitle: "Generated drafts were added to the review queue.",
      detail: "Refreshing the queue below.",
    },
    error: {
      title: "Generation Failed",
      subtitle: "The request finished, but no draft was saved.",
      detail: "Check the message below the form, then try a smaller item count.",
    },
  }[state];

  title.textContent = copy.title;
  subtitle.textContent = copy.subtitle;
  detailText.textContent = detail || copy.detail;

  Object.entries(steps).forEach(([step, element]) => {
    if (!element) return;
    const order = ["queued", "generating", "saving", "complete", "error"];
    const currentIndex = order.indexOf(state);
    const stepIndex = order.indexOf(step);

    element.classList.toggle("active", state !== "error" && stepIndex === currentIndex);
    element.classList.toggle(
      "done",
      state !== "error" && (state === "complete" || stepIndex < currentIndex),
    );
  });
}

function showAiQueueModal(state = "queued", detail = "") {
  document.getElementById("aiQueueModal")?.classList.remove("hidden");
  setAiQueueModalState(state, detail);
}

function hideAiQueueModal() {
  document.getElementById("aiQueueModal")?.classList.add("hidden");
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function updateAiQueueProgress(job = {}) {
  const total = Number(job.total || 0);
  const generated = Number(job.generated || 0);
  const remaining = Number(job.remaining ?? Math.max(0, total - generated));

  document.getElementById("aiQueueTotal").textContent = total;
  document.getElementById("aiQueueGenerated").textContent = generated;
  document.getElementById("aiQueueRemaining").textContent = remaining;

  if (job.status === "queued") {
    setAiQueueModalState(
      "queued",
      `${remaining} question${remaining === 1 ? "" : "s"} waiting to be sent to Qwen.`,
    );
  } else if (job.status === "generating") {
    setAiQueueModalState(
      "generating",
      `${remaining} question${remaining === 1 ? "" : "s"} remaining. Generated ${generated} of ${total}.`,
    );
  } else if (job.status === "saving") {
    setAiQueueModalState(
      "saving",
      `Generated ${generated} of ${total}. Saving drafts now.`,
    );
  } else if (job.status === "complete") {
    setAiQueueModalState("complete", job.message || "Generation complete.");
  } else if (job.status === "failed") {
    setAiQueueModalState("error", job.error || job.message || "Generation failed.");
  }
}

async function pollAiGenerationJob(jobId) {
  while (true) {
    const data = await apiRequest(`/ai/questions/jobs/${encodeURIComponent(jobId)}`);
    const job = data.job || {};

    updateAiQueueProgress(job);

    if (job.status === "complete") return job;
    if (job.status === "failed") {
      throw new Error(job.error || job.message || "AI generation failed.");
    }

    await wait(1200);
  }
}

function renderAiQueue(items = []) {
  const body = document.getElementById("aiQueueBody");

  if (!body) return;

  body.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <tr>
              <td>${new Date(item.createdAt).toLocaleString()}</td>
              <td>${escapeHTML(item.subject || "Not set")}</td>
              <td>${escapeHTML(item.topic || "Not set")}</td>
              <td>${escapeHTML(item.questionText || "Untitled question")}</td>
              <td>${escapeHTML(item.courseOutcome || "Not mapped")}</td>
              <td>${escapeHTML(item.programOutcome || "Not mapped")}</td>
              <td>${escapeHTML(item.studentLearningOutcome || "Not mapped")}</td>
              <td>${escapeHTML(item.bloomLevel || "Not mapped")}</td>
              <td><span class="badge average">${escapeHTML(item.status || "Pending")}</span></td>
              <td>
                <a class="btn secondary compact-btn" href="/parsed-questions.html">
                  Review
                </a>
              </td>
            </tr>
          `,
        )
        .join("")
    : `
      <tr>
        <td colspan="10" class="empty-table-cell">No pending AI-generated questions yet.</td>
      </tr>
    `;
}

function renderAiQueueLoading() {
  const body = document.getElementById("aiQueueBody");

  if (!body) return;

  body.innerHTML = `
    <tr>
      <td colspan="10" class="empty-table-cell">Generating draft questions...</td>
    </tr>
  `;
}

async function loadAiQueue() {
  try {
    const data = await apiRequest("/parser");
    const items = (data.parsedQuestions || [])
      .filter(
        (item) => item.source === "AI" && (item.status || "Pending") === "Pending",
      )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    renderAiQueue(items);
  } catch (error) {
    const body = document.getElementById("aiQueueBody");

    if (body) {
      body.innerHTML = `
        <tr>
          <td colspan="10" class="empty-table-cell">${escapeHTML(error.message)}</td>
        </tr>
      `;
    }
  }
}

restrictSubjectForCoordinator();
loadAiQueue();

document.getElementById("aiQuestionForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    engineeringProgram: document.getElementById("engineeringProgram").value,
    subject: document.getElementById("subject").value.trim(),
    topic: document.getElementById("topic").value.trim(),
    difficulty: document.getElementById("difficulty").value,
    bloomLevel: document.getElementById("bloomLevel").value,
    count: Number(document.getElementById("count").value || 1),
  };

  if (!body.engineeringProgram || !body.subject || !body.topic) {
    setAiMessage("Select program, subject, and topic before generating.");
    return;
  }

  if (!canUseSubject(body.subject)) {
    setAiMessage("Only CEE-CAC Coordinator can use CEE 601, CEE 602, CEE 603, and CEE 604.");
    return;
  }

  try {
    setGenerateBusy(true);
    renderAiQueueLoading();
    setAiMessage("", false);
    showAiQueueModal("queued");
    const data = await apiRequest("/ai/questions/generate", "POST", body);
    const job = data.job || {};

    if (!job.id) {
      throw new Error("AI generation job was not created.");
    }

    updateAiQueueProgress(job);
    const finishedJob = await pollAiGenerationJob(job.id);
    setAiMessage(`${finishedJob.message} Added to the AI queue below.`, false);
    await loadAiQueue();
    await wait(700);
  } catch (error) {
    setAiQueueModalState("error", error.message);
    setAiMessage(error.message);
    await loadAiQueue();
    await wait(1200);
  } finally {
    hideAiQueueModal();
    setGenerateBusy(false);
  }
});
