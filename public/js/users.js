protectPage();
adminOnlyPage();

let users = [];
let assignableRoles = [];

document.getElementById("userSearch").addEventListener("input", renderUsers);
document
  .getElementById("createUserForm")
  .addEventListener("submit", createUser);

async function loadUsers() {
  try {
    const [usersData, rolesData] = await Promise.all([
      apiRequest("/users"),
      apiRequest("/users/roles/options"),
    ]);
    users = usersData.users || [];
    assignableRoles = rolesData.roles || [];
    renderRoleOptions();
    updateUserStats();
    renderUsers();
  } catch (error) {
    setMessage("usersMessage", error.message);
  }
}

function updateUserStats() {
  document.getElementById("totalUsers").textContent = users.length;
  document.getElementById("adminUsers").textContent = users.filter(
    (user) => hasAnyRole(user, ["admin", "super_admin"]),
  ).length;
  document.getElementById("regularUsers").textContent = users.filter(
    (user) => hasAnyRole(user, ["exam_creator"]),
  ).length;
  document.getElementById("verifiedUsers").textContent = users.filter(
    (user) => user.isEmailVerified !== false,
  ).length;
}

function renderRoleOptions() {
  const select = document.getElementById("createUserRole");

  select.innerHTML = assignableRoles
    .map(
      (role) =>
        `<option value="${escapeHTML(role.value)}">${escapeHTML(role.label)}</option>`,
    )
    .join("");
  select.disabled = assignableRoles.length === 0;
}

function renderUsers() {
  const search = document.getElementById("userSearch").value.toLowerCase();
  const filteredUsers = users.filter((user) =>
    `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(search),
  );

  document.getElementById("usersBody").innerHTML =
    filteredUsers.length > 0
      ? filteredUsers.map(renderUserRow).join("")
      : `
        <tr>
          <td colspan="6" class="empty-table-cell">No users found.</td>
        </tr>
      `;
}

function renderUserRow(user) {
  const currentUser = getUser();
  const isCurrentUser = currentUser && currentUser.id === user._id;
  const registeredDate = new Date(user.createdAt).toLocaleDateString();
  const currentRole = normalizeRole(user.role);
  const canChangeRole = assignableRoles.some((role) => role.value === currentRole);
  const roleOptions = (canChangeRole
    ? assignableRoles
    : [{ value: currentRole, label: getRoleLabel(user.role) }]
  )
    .map(
      (role) => `
          <option value="${escapeHTML(role.value)}" ${currentRole === role.value ? "selected" : ""}>
            ${escapeHTML(role.label)}
          </option>
        `,
    )
    .join("");

  return `
    <tr>
      <td><strong>${escapeHTML(user.name)}</strong></td>
      <td>${escapeHTML(user.email)}</td>
      <td>
        <select
          class="role-select"
          onchange="updateUserRole('${user._id}', this.value)"
          ${isCurrentUser || !canChangeRole ? "disabled" : ""}
        >
          ${roleOptions}
        </select>
      </td>
      <td>
        <span class="badge ${user.isEmailVerified === false ? "average" : "easy"}">
          ${user.isEmailVerified === false ? "Pending" : "Verified"}
        </span>
      </td>
      <td>${registeredDate}</td>
      <td>
        <button
          class="btn danger"
          type="button"
          onclick="deleteUser('${user._id}')"
          ${isCurrentUser ? "disabled" : ""}
        >
          Delete
        </button>
      </td>
    </tr>
  `;
}

async function createUser(event) {
  event.preventDefault();

  const body = {
    name: document.getElementById("createUserName").value,
    email: document.getElementById("createUserEmail").value,
    password: document.getElementById("createUserPassword").value,
    role: document.getElementById("createUserRole").value,
  };

  try {
    await apiRequest("/users", "POST", body);
    document.getElementById("createUserForm").reset();
    setMessage("usersMessage", "Account created successfully.", false);
    await loadUsers();
  } catch (error) {
    setMessage("usersMessage", error.message);
  }
}

async function updateUserRole(id, role) {
  try {
    await apiRequest(`/users/${id}/role`, "PATCH", { role });
    setMessage("usersMessage", "User role updated.", false);
    await loadUsers();
  } catch (error) {
    setMessage("usersMessage", error.message);
    await loadUsers();
  }
}

async function deleteUser(id) {
  if (!confirm("Delete this user and their generated exams?")) {
    return;
  }

  try {
    await apiRequest(`/users/${id}`, "DELETE");
    setMessage("usersMessage", "User deleted successfully.", false);
    await loadUsers();
  } catch (error) {
    setMessage("usersMessage", error.message);
  }
}

loadUsers();
