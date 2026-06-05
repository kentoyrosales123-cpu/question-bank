protectPage();

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
    const isAdmin = user && ["admin", "super_admin"].includes(user.role);
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

          <input id="subject_${file._id}" placeholder="Subject e.g. Electronics Engineering">
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
  const subject = document.getElementById(`subject_${uploadId}`).value;
  const topic = document.getElementById(`topic_${uploadId}`).value;

  if (!subject || !topic) {
    alert("Please enter subject and topic before parsing.");
    return;
  }

  try {
    document.getElementById(`parseMsg_${uploadId}`).textContent =
      "Parsing questions. Image OCR can take a moment...";

    const data = await apiRequest("/parser/parse", "POST", {
      uploadId,
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
