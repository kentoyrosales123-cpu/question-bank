protectPage();
adminOnlyPage();

let users = [];

document.getElementById("userSearch").addEventListener("input", renderUsers);

async function loadUsers() {
  try {
    const data = await apiRequest("/users");
    users = data.users || [];
    updateUserStats();
    renderUsers();
  } catch (error) {
    setMessage("usersMessage", error.message);
  }
}

function updateUserStats() {
  document.getElementById("totalUsers").textContent = users.length;
  document.getElementById("adminUsers").textContent = users.filter(
    (user) => user.role === "admin",
  ).length;
  document.getElementById("regularUsers").textContent = users.filter(
    (user) => user.role !== "admin",
  ).length;
  document.getElementById("verifiedUsers").textContent = users.filter(
    (user) => user.isEmailVerified !== false,
  ).length;
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

  return `
    <tr>
      <td><strong>${escapeHTML(user.name)}</strong></td>
      <td>${escapeHTML(user.email)}</td>
      <td>
        <select
          class="role-select"
          onchange="updateUserRole('${user._id}', this.value)"
          ${isCurrentUser ? "disabled" : ""}
        >
          <option value="user" ${user.role === "user" ? "selected" : ""}>Professor</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
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
