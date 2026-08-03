protectPage();

const uploadUser = getUser();
if (uploadUser && !canCreateContentRole(uploadUser)) {
  alert("Questionnaire upload is for Admins and Exam Creators only.");
  location.href = getDashboardUrl(uploadUser);
}

const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];

function canUseSubject(subject) {
  const user = getUser();

  if (isAdminRole(user)) return true;
  if (isCeeCacCoordinatorRole(user)) {
    return CEE_CAC_SUBJECTS.includes(subject);
  }

  return !CEE_CAC_SUBJECTS.includes(subject);
}

function renderSubjectControl(uploadId) {
  if (isCeeCacCoordinatorRole(getUser())) {
    return `
      <select id="subject_${uploadId}" required>
        <option value="">Select subject</option>
        ${CEE_CAC_SUBJECTS.map(
          (subject) => `<option value="${subject}">${subject}</option>`,
        ).join("")}
      </select>
    `;
  }

  return `<input id="subject_${uploadId}" placeholder="Subject e.g. Electronics Engineering">`;
}

document.getElementById("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = document.getElementById("questionnaire").files[0];

  if (!file) {
    document.getElementById("uploadMessage").textContent =
      "Please choose a file to upload.";
    return;
  }

  const form = new FormData();
  form.append("questionnaire", file);

  try {
    await apiRequest("/uploads/questionnaire", "POST", form, true);
    document.getElementById("uploadMessage").textContent =
      "File uploaded successfully.";
    document.getElementById("uploadForm").reset();
    loadUploads();
  } catch (error) {
    document.getElementById("uploadMessage").textContent = error.message;
  }
});

async function loadUploads() {
  try {
    const user = getUser();
    const isAdmin = isAdminRole(user);
    const data = await apiRequest("/uploads");

    document.getElementById("uploadsList").innerHTML = data.uploads
      .map(
        (file) => `
        <div class="card question-card">
          <h3>${escapeHTML(file.originalName)}</h3>
          <p>${escapeHTML(file.fileType)}</p>

 <a class="btn secondary" href="${escapeHTML(file.filePath)}" target="_blank">Open File</a>
${isAdmin ? `<button class="btn danger" onclick="deleteUpload('${file._id}')">Delete File</button>` : ""}
          <br><br>

          <select id="engineeringProgram_${file._id}" required>
            <option value="">Select engineering program</option>
            <option value="ECE">ECE</option>
            <option value="CE">CE</option>
            <option value="EE">EE</option>
            <option value="ME">ME</option>
            <option value="CpE">CpE</option>
            <option value="CHE">CHE</option>
          </select>
          ${renderSubjectControl(file._id)}
          <input id="topic_${file._id}" placeholder="Topic e.g. Circuits">

          <button class="btn" onclick="parseUpload('${file._id}')">
            Parse Questions
          </button>

          <p class="message" id="parseMsg_${file._id}"></p>
        </div>
      `,
      )
      .join("");
  } catch (error) {
    document.getElementById("uploadsList").textContent = error.message;
  }
}

async function parseUpload(uploadId) {
  const engineeringProgram = document.getElementById(
    `engineeringProgram_${uploadId}`,
  ).value;
  const subject = document.getElementById(`subject_${uploadId}`).value;
  const topic = document.getElementById(`topic_${uploadId}`).value;

  if (!engineeringProgram || !subject || !topic) {
    alert("Please select program, subject, and topic before parsing.");
    return;
  }

  if (!canUseSubject(subject)) {
    alert("Only CEE-CAC Coordinator can use CEE 601, CEE 602, CEE 603, and CEE 604.");
    return;
  }

  try {
    document.getElementById(`parseMsg_${uploadId}`).textContent =
      "Parsing questions. Image OCR can take a moment...";

    const data = await apiRequest("/parser/parse", "POST", {
      uploadId,
      engineeringProgram,
      subject,
      topic,
    });

    document.getElementById(`parseMsg_${uploadId}`).textContent = data.message;

    document.getElementById(`parseMsg_${uploadId}`).textContent =
      `${data.message} Opening parsed question review...`;

    setTimeout(() => {
      location.href = `/parsed-questions.html?uploadId=${encodeURIComponent(uploadId)}`;
    }, 1000);
  } catch (error) {
    document.getElementById(`parseMsg_${uploadId}`).textContent = error.message;
  }
}

loadUploads();

async function deleteUpload(uploadId) {
  if (!confirm("Are you sure you want to delete this uploaded file?")) {
    return;
  }

  try {
    await apiRequest(`/uploads/${uploadId}`, "DELETE");
    alert("Uploaded file deleted successfully.");
    loadUploads();
  } catch (error) {
    alert(error.message);
  }
}
