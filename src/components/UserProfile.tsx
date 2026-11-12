import React, { useState } from "react";
import { InventoryAuditEntry, Movement, Item, UserRole } from "../types";
import { RecoveryEmailDialog } from "./RecoveryEmailDialog";

interface UserProfileProps {
  user: string;
  role?: UserRole;
  movements: Movement[];
  inventory: Item[];
  inventoryAudit: InventoryAuditEntry[];
  onLogout: () => void;
  onGoToDashboard: () => void;
  onUndoMovement?: (id: string, qty: number) => void;
  onUndoInventoryAudit?: (id: string) => Promise<void>;
  onSwitchRole?: (role: UserRole, name: string) => void;
  onChangePassword?: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onChangeUsername?: (
    currentPassword: string,
    newUsername: string,
  ) => Promise<void>;
  onCreateUser?: (
    username: string,
    password: string,
    role: UserRole,
  ) => Promise<void>;
  onOpenRequests?: () => void;
}

interface ManagedUser {
  id: number;
  username: string;
  role: UserRole;
  email: string;
  emailVerified: boolean;
}

// One row in the profile action list: icon, label, and a short line explaining what it does.
const ProfileAction: React.FC<{
  icon: string;
  label: string;
  detail: string;
  onClick: () => void;
}> = ({ icon, label, detail, onClick }) => (
  <button type="button" className="profile-action" onClick={onClick}>
    <span className="profile-action-icon" aria-hidden="true">
      <i className={`bx ${icon}`}></i>
    </span>
    <span className="profile-action-text">
      <span className="profile-action-label">{label}</span>
      <span className="profile-action-detail">{detail}</span>
    </span>
    <i className="bx bx-chevron-right profile-action-chevron" aria-hidden="true"></i>
  </button>
);

async function requestUserApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "User account request failed.");
  }
  return response.json();
}

export const UserProfile: React.FC<UserProfileProps> = ({
  user,
  role = "staff",
  movements,
  inventory,
  inventoryAudit,
  onLogout,
  onGoToDashboard,
  onUndoMovement,
  onUndoInventoryAudit,
  onSwitchRole,
  onChangePassword,
  onChangeUsername,
  onCreateUser,
  onOpenRequests,
}) => {
  const [filterType, setFilterType] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [undoQuantity, setUndoQuantity] = useState("");
  const [undoError, setUndoError] = useState<string | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [isManageUsersModalOpen, setIsManageUsersModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newUsername, setNewUsername] = useState(user);
  const [usernamePassword, setUsernamePassword] = useState("");
  const [createUserName, setCreateUserName] = useState("");
  const [createUserPassword, setCreateUserPassword] = useState("");
  const [createUserRole, setCreateUserRole] = useState<UserRole>("staff");
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [usernameFeedback, setUsernameFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [createUserFeedback, setCreateUserFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managedUsersFeedback, setManagedUsersFeedback] = useState<
    string | null
  >(null);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingUsername, setEditingUsername] = useState("");
  const [editingRole, setEditingRole] = useState<UserRole>("staff");
  const [editingPassword, setEditingPassword] = useState("");
  const [editingEmail, setEditingEmail] = useState("");

  const displayName =
    role === "staff" && user.toLowerCase().includes("admin")
      ? "Warehouse Staff"
      : user;
  const userRole =
    role === "admin" ||
    (role !== "staff" && user.toLowerCase().includes("admin"))
      ? "ADMIN"
      : "OPERATIONAL STAFF";

  const auditEntries = [
    ...movements.map((movement) => ({
      ...movement,
      auditType: movement.type as "IN" | "OUT",
    })),
    ...inventoryAudit.map((entry) => ({ ...entry, auditType: entry.action })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const totalActions = auditEntries.length;
  const inCount = movements.filter((m) => m.type === "IN").length;
  const outCount = movements.filter((m) => m.type === "OUT").length;
  const totalQtyMoved = movements.reduce((sum, m) => sum + m.qty, 0);

  const filteredMovements = auditEntries
    .filter((m) => {
      if (filterType !== "ALL" && m.auditType !== filterType) return false;
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase();
      const item = inventory.find((i) => i.id === m.itemId);
      const itemName = (
        "itemName" in m ? m.itemName : item?.name || ""
      ).toLowerCase();
      const itemId = m.itemId.toLowerCase();
      const movementId = m.id.toLowerCase();
      return (
        itemName.includes(query) ||
        itemId.includes(query) ||
        movementId.includes(query)
      );
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const handleUndo = (movement: Movement) => {
    const quantity = Number(undoQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > movement.qty)
      return;
    if (onUndoMovement) {
      onUndoMovement(movement.id, quantity);
      setConfirmUndoId(null);
      setUndoQuantity("");
    }
  };

  const handleAuditUndo = async (auditId: string) => {
    if (!onUndoInventoryAudit) return;
    setUndoError(null);
    try {
      await onUndoInventoryAudit(auditId);
      setConfirmUndoId(null);
    } catch (error) {
      setUndoError(
        error instanceof Error
          ? error.message
          : "Unable to undo this audit entry.",
      );
    }
  };

  const clearPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordFeedback(null);
  };

  const clearUsernameForm = () => {
    setNewUsername(user);
    setUsernamePassword("");
    setUsernameFeedback(null);
  };

  const clearCreateUserForm = () => {
    setCreateUserName("");
    setCreateUserPassword("");
    setCreateUserRole("staff");
    setCreateUserFeedback(null);
  };

  const loadManagedUsers = async () => {
    try {
      const users = await requestUserApi<ManagedUser[]>("/users");
      setManagedUsers(
        users.filter(
          (account) => account.username.toLowerCase() !== user.toLowerCase(),
        ),
      );
      setManagedUsersFeedback(null);
    } catch (error) {
      setManagedUsersFeedback(
        error instanceof Error
          ? error.message
          : "Unable to load user accounts.",
      );
    }
  };

  const saveManagedUser = async (account: ManagedUser) => {
    try {
      const result = await requestUserApi<{ emailChanged?: boolean; codeSent?: boolean }>(
        `/users/${account.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            username: editingUsername,
            role: editingRole,
            password: editingPassword,
            email: editingEmail,
          }),
        },
      );
      setEditingUserId(null);
      setEditingPassword("");
      setEditingEmail("");
      await loadManagedUsers();
      if (result.emailChanged && !result.codeSent) {
        setManagedUsersFeedback(
          "Saved, but the confirmation code could not be sent to the new address. Check the email settings on the server.",
        );
      }
    } catch (error) {
      setManagedUsersFeedback(
        error instanceof Error
          ? error.message
          : "Unable to update user account.",
      );
    }
  };

  const deleteManagedUser = async (account: ManagedUser) => {
    if (!window.confirm(`Delete ${account.username}?`)) return;
    try {
      await requestUserApi(`/users/${account.id}`, {
        method: "DELETE",
      });
      await loadManagedUsers();
    } catch (error) {
      setManagedUsersFeedback(
        error instanceof Error
          ? error.message
          : "Unable to delete user account.",
      );
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onChangePassword) {
      setPasswordFeedback({
        type: "error",
        message: "Password change is unavailable.",
      });
      return;
    }

    if (
      !currentPassword.trim() ||
      !newPassword.trim() ||
      !confirmPassword.trim()
    ) {
      setPasswordFeedback({
        type: "error",
        message: "Please fill in all password fields.",
      });
      return;
    }

    if (newPassword.length < 8) {
      setPasswordFeedback({
        type: "error",
        message: "New password must be at least 8 characters long.",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordFeedback({
        type: "error",
        message: "New passwords do not match.",
      });
      return;
    }

    try {
      await onChangePassword(currentPassword, newPassword);
      setPasswordFeedback({
        type: "success",
        message: "Password updated successfully.",
      });
      clearPasswordForm();
      setTimeout(() => setIsPasswordModalOpen(false), 500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update password.";
      setPasswordFeedback({ type: "error", message: message });
    }
  };

  const handleUsernameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onChangeUsername) {
      setUsernameFeedback({
        type: "error",
        message: "Username change is unavailable.",
      });
      return;
    }

    const normalizedUsername = newUsername.trim();
    if (!normalizedUsername) {
      setUsernameFeedback({
        type: "error",
        message: "Please enter a username.",
      });
      return;
    }

    if (normalizedUsername.length < 5) {
      setUsernameFeedback({
        type: "error",
        message: "Username must be at least 5 characters long.",
      });
      return;
    }

    if (!usernamePassword.trim()) {
      setUsernameFeedback({
        type: "error",
        message: "Please enter your current password.",
      });
      return;
    }

    try {
      await onChangeUsername(usernamePassword, normalizedUsername);
      setUsernameFeedback({
        type: "success",
        message: "Username updated successfully.",
      });
      clearUsernameForm();
      setTimeout(() => setIsUsernameModalOpen(false), 500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to update username.";
      setUsernameFeedback({ type: "error", message: message });
    }
  };

  const handleCreateUserSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!onCreateUser) {
      setCreateUserFeedback({
        type: "error",
        message: "User creation is unavailable.",
      });
      return;
    }

    const username = createUserName.trim();
    const password = createUserPassword.trim();

    if (!username || !password) {
      setCreateUserFeedback({
        type: "error",
        message: "Username and password are required.",
      });
      return;
    }

    if (username.length < 3) {
      setCreateUserFeedback({
        type: "error",
        message: "Username must be at least 3 characters long.",
      });
      return;
    }

    if (password.length < 8) {
      setCreateUserFeedback({
        type: "error",
        message: "Password must be at least 8 characters long.",
      });
      return;
    }

    try {
      await onCreateUser(username, password, createUserRole);
      setCreateUserFeedback({
        type: "success",
        message: "User created successfully.",
      });
      clearCreateUserForm();
      setTimeout(() => setIsCreateUserModalOpen(false), 500);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create user.";
      setCreateUserFeedback({ type: "error", message: message });
    }
  };

  return (
    <>
      <div className="content-section flex-col-gap">
        <div
          className="dashboard-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "var(--gap)",
            alignItems: "stretch",
          }}
        >
          <div className="flex-col-gap" style={{ height: "100%" }}>
            <div className="dash-card profile-card">
              <div className="profile-hero">
                <span className="profile-avatar" aria-hidden="true">
                  <i className="bx bx-user"></i>
                </span>
                <span className="profile-eyebrow">Signed in as</span>
                <h2 className="profile-name">{displayName}</h2>
                <span className={`profile-role ${role === "admin" ? "is-admin" : "is-staff"}`}>
                  {userRole}
                </span>
              </div>

              {role === "admin" && (
                <div className="profile-action-groups">
                  <div className="profile-action-group">
                    <span className="profile-group-label">Your account</span>
                    <ProfileAction
                      icon="bx-user-circle"
                      label="Change username"
                      detail="The name you sign in with"
                      onClick={() => {
                        clearUsernameForm();
                        setIsUsernameModalOpen(true);
                      }}
                    />
                    <ProfileAction
                      icon="bx-lock-alt"
                      label="Change password"
                      detail="Update your sign-in password"
                      onClick={() => {
                        clearPasswordForm();
                        setIsPasswordModalOpen(true);
                      }}
                    />
                    <ProfileAction
                      icon="bx-envelope"
                      label="Recovery email"
                      detail="Used for password reset codes"
                      onClick={() => setIsRecoveryModalOpen(true)}
                    />
                    <ProfileAction
                      icon="bx-git-compare"
                      label="Requests"
                      detail="Edit and delete approvals, with the audit trail"
                      onClick={() => onOpenRequests?.()}
                    />
                  </div>

                  <div className="profile-action-group">
                    <span className="profile-group-label">Administration</span>
                    <ProfileAction
                      icon="bx-user-plus"
                      label="Add new user"
                      detail="Create a staff or admin login"
                      onClick={() => {
                        clearCreateUserForm();
                        setIsCreateUserModalOpen(true);
                      }}
                    />
                    <ProfileAction
                      icon="bx-group"
                      label="Manage accounts"
                      detail="Edit or remove other accounts"
                      onClick={async () => {
                        await loadManagedUsers();
                        setIsManageUsersModalOpen(true);
                      }}
                    />
                  </div>
                </div>
              )}

              <button type="button" className="profile-logout" onClick={onLogout}>
                <i className="bx bx-log-out" aria-hidden="true"></i>
                Log out
              </button>
            </div>
          </div>


        </div>
      </div>

      <div className={`modal-overlay ${isUsernameModalOpen ? "active" : ""}`}>
        <div className="modal-content mini">
          <div className="modal-header">
            <span className="label-micro">Change Username</span>
            <button
              className="close-modal"
              onClick={() => {
                clearUsernameForm();
                setIsUsernameModalOpen(false);
              }}
            >
              <i className="bx bx-x"></i>
            </button>
          </div>
          <form
            onSubmit={handleUsernameSubmit}
            className="modal-body"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="newUsername">New Username</label>
              <input
                id="newUsername"
                className="form-input"
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Enter new username"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="usernameCurrentPassword">Current Password</label>
              <input
                id="usernameCurrentPassword"
                className="form-input"
                type="password"
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                placeholder="Enter current password"
              />
            </div>

            {usernameFeedback && (
              <p
                className={`label-micro ${usernameFeedback.type === "error" ? "text-accent" : "text-success"}`}
                style={{ margin: 0 }}
              >
                {usernameFeedback.message}
              </p>
            )}

            <div className="flex-row-gap" style={{ width: "100%" }}>
              <button
                type="button"
                className="olive-button btn-outline"
                style={{ flex: 1 }}
                onClick={() => {
                  clearUsernameForm();
                  setIsUsernameModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="olive-button"
                style={{ flex: 1 }}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className={`modal-overlay ${isCreateUserModalOpen ? "active" : ""}`}>
        <div className="modal-content mini">
          <div className="modal-header">
            <span className="label-micro">Add New User</span>
            <button
              className="close-modal"
              onClick={() => {
                clearCreateUserForm();
                setIsCreateUserModalOpen(false);
              }}
            >
              <i className="bx bx-x"></i>
            </button>
          </div>
          <form
            onSubmit={handleCreateUserSubmit}
            className="modal-body"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="createUserName">Username</label>
              <input
                id="createUserName"
                className="form-input"
                type="text"
                value={createUserName}
                onChange={(e) => setCreateUserName(e.target.value)}
                placeholder="Enter username"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="createUserPassword">Password</label>
              <input
                id="createUserPassword"
                className="form-input"
                type="password"
                value={createUserPassword}
                onChange={(e) => setCreateUserPassword(e.target.value)}
                placeholder="Create password"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="createUserRole">Role</label>
              <select
                id="createUserRole"
                className="form-input"
                value={createUserRole}
                onChange={(e) => setCreateUserRole(e.target.value as UserRole)}
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {createUserFeedback && (
              <p
                className={`label-micro ${createUserFeedback.type === "error" ? "text-accent" : "text-success"}`}
                style={{ margin: 0 }}
              >
                {createUserFeedback.message}
              </p>
            )}

            <div className="flex-row-gap" style={{ width: "100%" }}>
              <button
                type="button"
                className="olive-button btn-outline"
                style={{ flex: 1 }}
                onClick={() => {
                  clearCreateUserForm();
                  setIsCreateUserModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="olive-button"
                style={{ flex: 1 }}
              >
                Create
              </button>
            </div>
          </form>
        </div>
      </div>

      <div
        className={`modal-overlay ${isManageUsersModalOpen ? "active" : ""}`}
      >
        <div className="modal-content">
          <div className="modal-header">
            <span className="label-micro">Manage User Accounts</span>
            <button
              className="close-modal"
              onClick={() => {
                setIsManageUsersModalOpen(false);
                setEditingUserId(null);
              }}
            >
              <i className="bx bx-x"></i>
            </button>
          </div>
          <div className="modal-body account-management-list">
            <p className="account-management-intro">
              Update each account's username, role, or password.
            </p>
            {managedUsers.map((account) => {
              const isSelf = account.username.toLowerCase() === user.toLowerCase();
              const isEditing = editingUserId === account.id;
              return (
                <div key={account.id} className={`account-card ${isEditing ? "is-editing" : ""}`}>
                  <div className="account-card-main">
                    <span className="account-avatar" aria-hidden="true">
                      {account.username.charAt(0).toUpperCase()}
                    </span>
                    <div className="account-card-info">
                      <strong className="account-card-name">
                        {account.username}
                        {isSelf && <span className="account-you">You</span>}
                      </strong>
                      <span className={`account-role-pill is-${account.role}`}>
                        {account.role === "admin" ? "Admin" : "Staff"}
                      </span>
                      <span className="account-email">
                        {account.email ? (
                          <>
                            {account.email}
                            <span className={`account-email-status ${account.emailVerified ? "is-verified" : "is-pending"}`}>
                              {account.emailVerified ? "Verified" : "Not verified"}
                            </span>
                          </>
                        ) : (
                          "No recovery email"
                        )}
                      </span>
                    </div>
                    {!isEditing && (
                      <div className="account-card-actions">
                        <button
                          type="button"
                          className="account-icon-btn"
                          aria-label={`Edit ${account.username}`}
                          title="Edit account"
                          onClick={() => {
                            setEditingUserId(account.id);
                            setEditingUsername(account.username);
                            setEditingRole(account.role);
                            setEditingPassword("");
                            setEditingEmail(account.email);
                          }}
                        >
                          <i className="bx bx-edit-alt" aria-hidden="true"></i>
                        </button>
                        <button
                          type="button"
                          className="account-icon-btn is-danger"
                          aria-label={`Delete ${account.username}`}
                          title={isSelf ? "You can't delete your own account" : "Delete account"}
                          disabled={isSelf}
                          onClick={() => deleteManagedUser(account)}
                        >
                          <i className="bx bx-trash" aria-hidden="true"></i>
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditing && (
                    <div className="account-edit-form">
                      <div className="account-edit-grid">
                        <div className="form-group">
                          <label className="label-micro" htmlFor={`account-name-${account.id}`}>
                            Username
                          </label>
                          <input
                            id={`account-name-${account.id}`}
                            className="form-input"
                            value={editingUsername}
                            onChange={(event) => setEditingUsername(event.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="label-micro" htmlFor={`account-role-${account.id}`}>
                            Role
                          </label>
                          <select
                            id={`account-role-${account.id}`}
                            className="form-input"
                            value={editingRole}
                            onChange={(event) => setEditingRole(event.target.value as UserRole)}
                          >
                            <option value="staff">Staff</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="label-micro" htmlFor={`account-email-${account.id}`}>
                          Recovery email
                        </label>
                        <input
                          id={`account-email-${account.id}`}
                          className="form-input"
                          type="email"
                          value={editingEmail}
                          autoComplete="off"
                          placeholder="Leave blank to remove"
                          onChange={(event) => setEditingEmail(event.target.value)}
                        />
                        <span className="account-hint">
                          Changing this sends a confirmation code to the new address. The user enters it from their Recovery Email dialog.
                        </span>
                      </div>
                      <div className="form-group">
                        <label className="label-micro" htmlFor={`account-password-${account.id}`}>
                          New password
                        </label>
                        <input
                          id={`account-password-${account.id}`}
                          className="form-input"
                          type="password"
                          value={editingPassword}
                          autoComplete="new-password"
                          placeholder="Leave blank to keep the current password"
                          onChange={(event) => setEditingPassword(event.target.value)}
                        />
                      </div>
                      <div className="account-edit-actions">
                        <button
                          type="button"
                          className="olive-button btn-outline"
                          onClick={() => setEditingUserId(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="olive-button"
                          onClick={() => saveManagedUser(account)}
                        >
                          Save changes
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {managedUsersFeedback && (
              <p className="account-feedback" role="status">
                {managedUsersFeedback}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`modal-overlay ${isPasswordModalOpen ? "active" : ""}`}>
        <div className="modal-content mini">
          <div className="modal-header">
            <span className="label-micro">Change Password</span>
            <button
              className="close-modal"
              onClick={() => {
                clearPasswordForm();
                setIsPasswordModalOpen(false);
              }}
            >
              <i className="bx bx-x"></i>
            </button>
          </div>
          <form
            onSubmit={handlePasswordSubmit}
            className="modal-body"
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="currentPassword">Current Password</label>
              <input
                id="currentPassword"
                className="form-input"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="newPassword">New Password</label>
              <input
                id="newPassword"
                className="form-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                className="form-input"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>

            {passwordFeedback && (
              <p
                className={`label-micro ${passwordFeedback.type === "error" ? "text-accent" : "text-success"}`}
                style={{ margin: 0 }}
              >
                {passwordFeedback.message}
              </p>
            )}

            <div className="flex-row-gap" style={{ width: "100%" }}>
              <button
                type="button"
                className="olive-button btn-outline"
                style={{ flex: 1 }}
                onClick={() => {
                  clearPasswordForm();
                  setIsPasswordModalOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="olive-button"
                style={{ flex: 1 }}
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
      {isRecoveryModalOpen && <RecoveryEmailDialog onClose={() => setIsRecoveryModalOpen(false)} />}
    </>
  );
};
