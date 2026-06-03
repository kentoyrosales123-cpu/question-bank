protectPage();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/omr-sw.js")
    .then((registration) => registration.update())
    .catch(() => {});
}

const scannerUser = getUser();

if (scannerUser && scannerUser.role === "student") {
  alert("OMR scanning is for professors and admins only.");
  location.href = getDashboardUrl(scannerUser);
}

let scannerExams = [];
let currentImage = null;
let detectedAnswers = [];
let liveStream = null;
let liveScanTimer = null;
let lastLiveSignature = "";
let stableLiveFrames = 0;
let liveSaveInProgress = false;

const examSelect = document.getElementById("scannerExamSelect");
const canvas = document.getElementById("omrCanvas");
const ctx = canvas.getContext("2d");
const video = document.getElementById("omrVideo");

function getSelectedExam() {
  return scannerExams.find((exam) => exam._id === examSelect.value);
}

function setScannerMessage(message, isError = true) {
  setMessage("scannerMessage", message, isError);
}

function formatScannerDate(value) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function renderScannerExamMeta() {
  const exam = getSelectedExam();
  const meta = document.getElementById("scannerExamMeta");

  if (!exam) {
    meta.textContent = "";
    return;
  }

  document.getElementById("scannerSection").value = exam.section || "";
  meta.innerHTML = `
    <span>${escapeHTML(exam.subject)}</span>
    <span>${escapeHTML(exam.section)}</span>
    <span>${escapeHTML(exam.numberOfItems)} items</span>
    <span>${formatScannerDate(exam.createdAt || exam.uploadedAt)}</span>
  `;
  detectedAnswers = Array.from({ length: exam.numberOfItems }, () => "");
  renderAnswerReview();
  updateLiveScore();
}

function renderScannerExamOptions() {
  if (scannerExams.length === 0) {
    examSelect.innerHTML = `<option value="">No item analysis exams found</option>`;
    examSelect.disabled = true;
    return;
  }

  examSelect.disabled = false;
  examSelect.innerHTML = scannerExams
    .map(
      (exam) => `
        <option value="${escapeHTML(exam._id)}">
          ${escapeHTML(exam.title)} - ${escapeHTML(exam.numberOfItems)} items
        </option>
      `,
    )
    .join("");
  renderScannerExamMeta();
}

async function loadScannerExams() {
  try {
    const data = await apiRequest("/item-analysis/exams");
    scannerExams = (data.exams || []).filter(
      (exam) => Array.isArray(exam.answerKey) && exam.answerKey.length > 0,
    );
    renderScannerExamOptions();

    if (scannerExams.length === 0) {
      setScannerMessage(
        "Create or upload an item analysis exam with an answer key before scanning.",
      );
    }
  } catch (error) {
    examSelect.innerHTML = `<option value="">Unable to load exams</option>`;
    setScannerMessage(error.message);
  }
}

async function createScannerExam(event) {
  event.preventDefault();

  const body = {
    title: document.getElementById("scannerExamTitle").value.trim(),
    subject: document.getElementById("scannerExamSubject").value.trim(),
    section: document.getElementById("scannerExamSection").value.trim(),
    semester: document.getElementById("scannerExamSemester").value.trim(),
    schoolYear: document.getElementById("scannerExamSchoolYear").value.trim(),
    numberOfItems: document.getElementById("scannerExamItems").value,
    answerKey: document.getElementById("scannerExamAnswerKey").value.trim(),
  };

  try {
    const data = await apiRequest("/item-analysis/exams", "POST", body);
    event.target.reset();
    document.querySelector(".scanner-create-exam").open = false;
    await loadScannerExams();
    examSelect.value = data.exam._id;
    renderScannerExamMeta();
    setScannerMessage("Scanning exam created. You can scan student sheets now.", false);
  } catch (error) {
    setScannerMessage(error.message);
  }
}

async function downloadOmrTemplate() {
  const exam = getSelectedExam();
  const itemCount = exam
    ? exam.numberOfItems
    : Number(document.getElementById("scannerExamItems").value || 50);
  const params = new URLSearchParams({
    items: String(itemCount || 50),
    examId: exam?._id || "",
    title: exam?.title || document.getElementById("scannerExamTitle").value || "OMR Answer Sheet",
    subject: exam?.subject || document.getElementById("scannerExamSubject").value || "",
    section: exam?.section || document.getElementById("scannerExamSection").value || "",
  });

  try {
    const res = await fetch(`/api/item-analysis/omr-template?${params}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "OMR template download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "omr-answer-sheet.docx";

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setScannerMessage("OMR sheet template downloaded.", false);
  } catch (error) {
    setScannerMessage(error.message);
  }
}

function getAnswerKeyMap() {
  const exam = getSelectedExam();

  return new Map(
    (exam?.answerKey || []).map((item) => [
      Number(item.itemNo),
      String(item.answer || "").trim().toUpperCase(),
    ]),
  );
}

function computeScore(answers = detectedAnswers) {
  const exam = getSelectedExam();
  const answerKey = getAnswerKeyMap();

  if (!exam || answerKey.size === 0) {
    return { score: 0, total: exam?.numberOfItems || 0, detected: 0 };
  }

  const score = answers.filter(
    (answer, index) => answer && answer === answerKey.get(index + 1),
  ).length;
  const detected = answers.filter(Boolean).length;

  return {
    score,
    total: exam.numberOfItems,
    detected,
  };
}

function updateLiveScore(statusText = "") {
  const score = computeScore();

  document.getElementById("liveScoreText").textContent = score.total
    ? `${score.score}/${score.total}`
    : "-";
  document.getElementById("liveScanStatus").textContent =
    statusText ||
    (score.total
      ? `${score.detected} answer${score.detected === 1 ? "" : "s"} detected`
      : "Select an exam to score live");
}

function drawCurrentImage() {
  if (!currentImage) {
    return;
  }

  const maxWidth = Math.min(900, currentImage.naturalWidth);
  const scale = maxWidth / currentImage.naturalWidth;

  canvas.width = maxWidth;
  canvas.height = Math.round(currentImage.naturalHeight * scale);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
}

function drawVideoFrame() {
  if (!video.videoWidth || !video.videoHeight) {
    return false;
  }

  const maxWidth = Math.min(900, video.videoWidth);
  const scale = maxWidth / video.videoWidth;

  canvas.width = maxWidth;
  canvas.height = Math.round(video.videoHeight * scale);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return true;
}

function getScanBounds() {
  const top = Number(document.getElementById("scanTop").value) / 100;
  const bottom = Number(document.getElementById("scanBottom").value) / 100;
  const left = Number(document.getElementById("scanLeft").value) / 100;
  const right = Number(document.getElementById("scanRight").value) / 100;
  const numberColumn = Number(document.getElementById("scanNumberColumn").value) / 100;
  const headerRow = Number(document.getElementById("scanHeaderRow").value) / 100;

  return {
    x: canvas.width * left,
    y: canvas.height * top,
    width: canvas.width * (right - left),
    height: canvas.height * (bottom - top),
    numberColumn,
    headerRow,
  };
}

function sampleDarkness(x, y, radius) {
  const startX = Math.max(0, Math.round(x - radius));
  const startY = Math.max(0, Math.round(y - radius));
  const size = Math.max(2, Math.round(radius * 2));
  const imageData = ctx.getImageData(startX, startY, size, size).data;
  let total = 0;
  let count = 0;

  for (let index = 0; index < imageData.length; index += 4) {
    const red = imageData[index];
    const green = imageData[index + 1];
    const blue = imageData[index + 2];
    const brightness = (red + green + blue) / 3;
    total += 255 - brightness;
    count += 1;
  }

  return count ? total / count : 0;
}

function scanAnswersFromCanvas(options = {}) {
  const { redrawImage = true, requireImage = true } = options;
  const exam = getSelectedExam();

  if (!exam) {
    throw new Error("Choose an item analysis exam first.");
  }

  if (requireImage && !currentImage) {
    throw new Error("Capture or upload an OMR sheet image first.");
  }

  if (redrawImage) {
    drawCurrentImage();
  }

  const bounds = getScanBounds();
  const labels = ["A", "B", "C", "D"];
  const answerY = bounds.y + bounds.height * bounds.headerRow;
  const answerHeight = bounds.height * (1 - bounds.headerRow);
  const rowHeight = answerHeight / exam.numberOfItems;
  const answerX = bounds.x + bounds.width * bounds.numberColumn;
  const answerWidth = bounds.width * (1 - bounds.numberColumn);
  const columnWidth = answerWidth / labels.length;
  const sampleRadius = Math.max(4, Math.min(rowHeight, columnWidth) * 0.18);
  const answers = [];

  ctx.strokeStyle = "#f0b318";
  ctx.lineWidth = 2;
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  for (let itemIndex = 0; itemIndex < exam.numberOfItems; itemIndex += 1) {
    const y = answerY + rowHeight * (itemIndex + 0.5);
    const scores = labels.map((label, labelIndex) => {
      const x = answerX + columnWidth * (labelIndex + 0.5);
      const darkness = sampleDarkness(x, y, sampleRadius);

      ctx.beginPath();
      ctx.arc(x, y, sampleRadius, 0, Math.PI * 2);
      ctx.stroke();

      return { label, darkness, x, y };
    });
    const sorted = [...scores].sort((a, b) => b.darkness - a.darkness);
    const best = sorted[0];
    const secondBest = sorted[1];
    const confidence = best.darkness - secondBest.darkness;
    const answer = best.darkness > 18 && confidence > 3 ? best.label : "";

    if (answer) {
      ctx.fillStyle = "rgba(22, 128, 95, 0.22)";
      ctx.beginPath();
      ctx.arc(best.x, best.y, sampleRadius + 2, 0, Math.PI * 2);
      ctx.fill();
    }

    answers.push(answer);
  }

  return answers;
}

function renderAnswerReview() {
  const exam = getSelectedExam();
  const grid = document.getElementById("answerReviewGrid");

  if (!exam) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = Array.from({ length: exam.numberOfItems }, (_, index) => {
    const answer = detectedAnswers[index] || "";

    return `
      <label class="answer-review-item">
        <span>${index + 1}</span>
        <select data-answer-index="${index}">
          <option value="" ${answer === "" ? "selected" : ""}>-</option>
          <option value="A" ${answer === "A" ? "selected" : ""}>A</option>
          <option value="B" ${answer === "B" ? "selected" : ""}>B</option>
          <option value="C" ${answer === "C" ? "selected" : ""}>C</option>
          <option value="D" ${answer === "D" ? "selected" : ""}>D</option>
        </select>
      </label>
    `;
  }).join("");

  grid.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      detectedAnswers[Number(select.dataset.answerIndex)] = select.value;
      updateLiveScore();
    });
  });
  updateLiveScore();
}

function clearScan(showMessage = true) {
  stopLiveScan(false);
  currentImage = null;
  detectedAnswers = [];
  canvas.width = 0;
  canvas.height = 0;
  document.getElementById("omrImageInput").value = "";
  renderScannerExamMeta();
  if (showMessage) {
    setScannerMessage("Scanner cleared.", false);
  }
}

async function saveScannedResult(options = {}) {
  const { auto = false } = options;
  const exam = getSelectedExam();
  const body = {
    studentName: document.getElementById("scannerStudentName").value.trim(),
    studentId: document.getElementById("scannerStudentId").value.trim(),
    section: document.getElementById("scannerSection").value.trim(),
    answers: detectedAnswers,
  };

  if (!exam) {
    setScannerMessage("Choose an item analysis exam first.");
    return false;
  }

  if (!body.studentName || !body.studentId) {
    setScannerMessage("Student name and student ID are required before saving.");
    return false;
  }

  try {
    liveSaveInProgress = true;
    const data = await apiRequest(
      `/item-analysis/${exam._id}/scanned-result`,
      "POST",
      body,
    );
    const score = computeScore();

    if (auto) {
      stopLiveScan(false);
    }

    document.getElementById("scannerStudentName").value = "";
    document.getElementById("scannerStudentId").value = "";
    clearScan(false);
    setScannerMessage(
      `${data.message} Score: ${data.result.totalScore || score.score}/${score.total}`,
      false,
    );
    return true;
  } catch (error) {
    setScannerMessage(error.message);
    return false;
  } finally {
    liveSaveInProgress = false;
  }
}

function getLiveSignature() {
  return detectedAnswers.join("|");
}

function resetLiveStability() {
  lastLiveSignature = "";
  stableLiveFrames = 0;
}

async function handleStableAutoSave() {
  const autoSave = document.getElementById("autoSaveStableScan").checked;
  const signature = getLiveSignature();
  const score = computeScore();

  if (!signature || score.detected === 0) {
    resetLiveStability();
    return;
  }

  if (signature === lastLiveSignature) {
    stableLiveFrames += 1;
  } else {
    lastLiveSignature = signature;
    stableLiveFrames = 1;
  }

  if (!autoSave) {
    updateLiveScore(`Stable frames: ${stableLiveFrames}`);
    return;
  }

  if (score.detected < score.total) {
    updateLiveScore(`Auto-save waits for complete scan: ${score.detected}/${score.total}`);
    return;
  }

  if (stableLiveFrames >= 3 && !liveSaveInProgress) {
    updateLiveScore("Stable scan detected. Saving...");
    await saveScannedResult({ auto: true });
  } else {
    updateLiveScore(`Auto-save waits for stable scan: ${stableLiveFrames}/3`);
  }
}

async function runLiveScanFrame() {
  try {
    if (!drawVideoFrame()) {
      updateLiveScore("Waiting for camera frame...");
      return;
    }

    const nextAnswers = scanAnswersFromCanvas({
      redrawImage: false,
      requireImage: false,
    });
    const previousSignature = detectedAnswers.join("|");
    const nextSignature = nextAnswers.join("|");

    detectedAnswers = nextAnswers;
    if (nextSignature !== previousSignature) {
      renderAnswerReview();
    } else {
      updateLiveScore();
    }
    await handleStableAutoSave();
  } catch (error) {
    updateLiveScore(error.message);
  }
}

async function startLiveScan() {
  if (!window.isSecureContext && location.hostname !== "localhost") {
    setScannerMessage(
      "Live camera needs HTTPS on mobile browsers. Use photo capture here, or open the scanner through HTTPS.",
    );
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setScannerMessage(
      "Live camera scanning is not available in this browser. Use Capture OMR Sheet instead.",
    );
    return;
  }

  if (!getSelectedExam()) {
    setScannerMessage("Choose an item analysis exam first.");
    return;
  }

  try {
    stopLiveScan(false);
    liveStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });
    video.srcObject = liveStream;
    video.classList.add("active");
    resetLiveStability();
    updateLiveScore("Live camera started.");
    liveScanTimer = setInterval(runLiveScanFrame, 900);
    setScannerMessage("Live scan started. Keep the answer grid inside the scan area.", false);
  } catch (error) {
    setScannerMessage(error.message || "Unable to start camera.");
  }
}

function stopLiveScan(showMessage = true) {
  if (liveScanTimer) {
    clearInterval(liveScanTimer);
    liveScanTimer = null;
  }

  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }

  video.srcObject = null;
  video.classList.remove("active");
  resetLiveStability();

  if (showMessage) {
    updateLiveScore("Live camera stopped.");
    setScannerMessage("Live scan stopped.", false);
  }
}

document.getElementById("omrImageInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];

  if (!file) {
    return;
  }

  const image = new Image();
  image.onload = () => {
    currentImage = image;
    drawCurrentImage();
    setScannerMessage("Image loaded. Adjust scan area if needed, then scan.", false);
    URL.revokeObjectURL(image.src);
  };
  image.src = URL.createObjectURL(file);
});

document.getElementById("scanAnswersButton").addEventListener("click", () => {
  try {
    detectedAnswers = scanAnswersFromCanvas();
    renderAnswerReview();
    const score = computeScore();
    setScannerMessage(
      `Answers detected. Live score: ${score.score}/${score.total}. Review before saving.`,
      false,
    );
  } catch (error) {
    setScannerMessage(error.message);
  }
});

document.getElementById("clearScanButton").addEventListener("click", clearScan);
document.getElementById("startLiveScanButton").addEventListener("click", startLiveScan);
document.getElementById("stopLiveScanButton").addEventListener("click", stopLiveScan);
document
  .getElementById("scannerExamForm")
  .addEventListener("submit", createScannerExam);
document
  .getElementById("downloadOmrTemplateButton")
  .addEventListener("click", downloadOmrTemplate);

document
  .getElementById("saveScannedResultButton")
  .addEventListener("click", () => saveScannedResult());

examSelect.addEventListener("change", () => {
  stopLiveScan(false);
  renderScannerExamMeta();
});
loadScannerExams();
