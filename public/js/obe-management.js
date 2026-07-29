protectPage();
superAdminOnlyPage();

let outcomes = [];
let studentOutcomes = [];
let studentOutcomePage = 1;
const studentOutcomesPerPage = 15;

async function loadOutcomes() {
  try {
    const [courseData, studentData] = await Promise.all([
      apiRequest("/obe/course-outcomes"),
      apiRequest("/obe/student-outcomes"),
    ]);

    outcomes = courseData.outcomes || [];
    studentOutcomes = studentData.studentOutcomes || [];
    renderStudentOutcomes();
    renderOutcomes();
    renderOutcomeOptions();
  } catch (error) {
    alert(error.message);
  }
}

function renderOutcomeOptions() {
  const departments = [
    ...new Set(
      [
        ...studentOutcomes.map((outcome) => outcome.department),
        ...outcomes.map((outcome) => outcome.department),
      ].filter(Boolean),
    ),
  ].sort();

  document.getElementById("departmentOptions").innerHTML = departments
    .map((department) => `<option value="${escapeHTML(department)}"></option>`)
    .join("");
  document.getElementById("studentOutcomeOptions").innerHTML = studentOutcomes
    .map(
      (outcome) =>
        `<option value="${escapeHTML(outcome.code)}">${escapeHTML(outcome.department)} - ${escapeHTML(outcome.description)}</option>`,
    )
    .join("");
}

function renderStudentOutcomes() {
  const filter = String(
    document.getElementById("studentOutcomeFilter").value || "",
  )
    .toLowerCase()
    .trim();
  const visible = studentOutcomes.filter((outcome) =>
    [
      outcome.department,
      outcome.code,
      outcome.description,
      outcome.graduateAttributes,
      outcome.peoLinks,
    ]
      .join(" ")
      .toLowerCase()
      .includes(filter),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(visible.length / studentOutcomesPerPage),
  );

  studentOutcomePage = Math.min(
    totalPages,
    Math.max(1, Number(studentOutcomePage) || 1),
  );

  const startIndex = (studentOutcomePage - 1) * studentOutcomesPerPage;
  const pageRows = visible.slice(
    startIndex,
    startIndex + studentOutcomesPerPage,
  );

  document.getElementById("studentOutcomeBody").innerHTML = pageRows.length
    ? pageRows
        .map(
          (outcome) => `
            <tr>
              <td>${escapeHTML(outcome.department)}</td>
              <td><strong>${escapeHTML(outcome.code)}</strong></td>
              <td>${escapeHTML(outcome.description)}</td>
              <td>${escapeHTML(outcome.graduateAttributes || "")}</td>
              <td>${escapeHTML(formatPeoLinks(outcome.peoLinks))}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteStudentOutcome('${outcome._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6" class="empty-table-cell">No Student Outcomes saved yet.</td></tr>`;
  renderStudentOutcomePagination(visible.length, totalPages);
}

function renderStudentOutcomePagination(totalItems, totalPages) {
  const pagination = document.getElementById("studentOutcomePagination");

  if (!pagination) return;

  const firstItem = totalItems
    ? (studentOutcomePage - 1) * studentOutcomesPerPage + 1
    : 0;
  const lastItem = Math.min(
    totalItems,
    studentOutcomePage * studentOutcomesPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${totalItems} student outcomes
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToStudentOutcomePage(${studentOutcomePage - 1})" ${studentOutcomePage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${studentOutcomePage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToStudentOutcomePage(${studentOutcomePage + 1})" ${studentOutcomePage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToStudentOutcomePage(page) {
  studentOutcomePage = page;
  renderStudentOutcomes();
}

function renderOutcomes() {
  const filter = String(document.getElementById("outcomeFilter").value || "")
    .toLowerCase()
    .trim();
  const visible = outcomes.filter((outcome) =>
    [
      outcome.subject,
      outcome.department,
      outcome.code,
      outcome.description,
      outcome.programOutcome,
      outcome.bloomLevel,
      outcome.keywords,
    ]
      .join(" ")
      .toLowerCase()
      .includes(filter),
  );

  document.getElementById("outcomeBody").innerHTML = visible.length
    ? visible
        .map(
          (outcome) => `
            <tr>
              <td>${escapeHTML(outcome.subject)}</td>
              <td>${escapeHTML(outcome.department || "Not set")}</td>
              <td><strong>${escapeHTML(outcome.code)}</strong></td>
              <td>${escapeHTML(outcome.description)}</td>
              <td>${escapeHTML(formatStudentOutcomeLink(outcome.programOutcome) || "Not mapped")}</td>
              <td>${escapeHTML(outcome.bloomLevel || "Not set")}</td>
              <td>${escapeHTML(outcome.keywords || "")}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteOutcome('${outcome._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="8" class="empty-table-cell">No CO/CLO rows saved yet.</td></tr>`;
}

document
  .getElementById("studentOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("soDepartment").value.trim(),
      code: document.getElementById("soCode").value.trim(),
      description: document.getElementById("soDescription").value.trim(),
      graduateAttributes: getCheckedValues("soGraduateAttributes").join(", "),
      peoLinks: getCheckedValues("soPeoLinks").join(", "),
    };

    try {
      const data = await apiRequest("/obe/student-outcomes", "POST", body);
      setMessage("studentOutcomeMessage", data.message, false);
      document.getElementById("studentOutcomeForm").reset();
      clearCheckedValues("soGraduateAttributes");
      clearCheckedValues("soPeoLinks");
      await loadOutcomes();
    } catch (error) {
      setMessage(
        "studentOutcomeMessage",
        getObeRouteErrorMessage(error),
      );
    }
  });

function getCheckedValues(groupId) {
  return Array.from(
    document.querySelectorAll(`#${groupId} input[type="checkbox"]:checked`),
  ).map((input) => input.value);
}

function formatPeoLinks(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.replace(/^PEO/i, "").trim())
    .filter(Boolean)
    .join(", ");
}

function formatStudentOutcomeLink(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) =>
      item
        .replace(/^SO[-\s]*/i, "")
        .replace(/^PLO[-\s]*/i, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .join(", ");
}

function clearCheckedValues(groupId) {
  document
    .querySelectorAll(`#${groupId} input[type="checkbox"]`)
    .forEach((input) => {
      input.checked = false;
    });
}

document
  .getElementById("bulkStudentOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("bulkSoDepartment").value.trim(),
      bulkText: document.getElementById("bulkSoText").value,
    };

    try {
      const data = await apiRequest(
        "/obe/student-outcomes/import",
        "POST",
        body,
      );
      setMessage("bulkStudentOutcomeMessage", data.message, false);
      document.getElementById("bulkStudentOutcomeForm").reset();
      await loadOutcomes();
    } catch (error) {
      setMessage(
        "bulkStudentOutcomeMessage",
        getObeRouteErrorMessage(error),
      );
    }
  });

document.getElementById("outcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    department: document.getElementById("department").value.trim(),
    subject: document.getElementById("subject").value.trim(),
    code: document.getElementById("code").value.trim(),
    description: document.getElementById("description").value.trim(),
    programOutcome: formatStudentOutcomeLink(
      document.getElementById("programOutcome").value,
    ),
    bloomLevel: document.getElementById("bloomLevel").value,
    keywords: document.getElementById("keywords").value.trim(),
  };

  try {
    const data = await apiRequest("/obe/course-outcomes", "POST", body);
    setMessage("outcomeMessage", data.message, false);
    document.getElementById("outcomeForm").reset();
    await loadOutcomes();
  } catch (error) {
    setMessage("outcomeMessage", error.message);
  }
});

document
  .getElementById("bulkOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      subject: document.getElementById("bulkSubject").value.trim(),
      department: document.getElementById("bulkDepartment").value.trim(),
      bulkText: document.getElementById("bulkText").value,
    };

    try {
      const data = await apiRequest("/obe/course-outcomes/import", "POST", body);
      setMessage("bulkOutcomeMessage", data.message, false);
      document.getElementById("bulkOutcomeForm").reset();
      await loadOutcomes();
    } catch (error) {
      setMessage("bulkOutcomeMessage", error.message);
    }
  });

document.getElementById("outcomeFilter").addEventListener("input", renderOutcomes);
document
  .getElementById("studentOutcomeFilter")
  .addEventListener("input", () => {
    studentOutcomePage = 1;
    renderStudentOutcomes();
  });

async function deleteOutcome(id) {
  if (!confirm("Delete this CO/CLO row?")) return;

  try {
    const data = await apiRequest(`/obe/course-outcomes/${id}`, "DELETE");
    setMessage("outcomeMessage", data.message, false);
    await loadOutcomes();
  } catch (error) {
    setMessage("outcomeMessage", error.message);
  }
}

async function deleteStudentOutcome(id) {
  if (!confirm("Delete this Student Outcome row?")) return;

  try {
    const data = await apiRequest(`/obe/student-outcomes/${id}`, "DELETE");
    setMessage("studentOutcomeMessage", data.message, false);
    await loadOutcomes();
  } catch (error) {
    setMessage("studentOutcomeMessage", error.message);
  }
}

function getObeRouteErrorMessage(error) {
  return error.message === "Route not found"
    ? "OBE route not loaded yet. Restart the Node server, then reload this page."
    : error.message;
}

loadOutcomes();
