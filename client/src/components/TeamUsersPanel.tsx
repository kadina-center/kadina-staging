import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  changeUserPassword,
  createUser,
  deleteUser,
  getUsers,
  updateUser,
  type User,
} from "../lib/api";
import { ROLE_LABELS, labelOr } from "../lib/uiLabels";

type Props = {
  currentUser: User;
};

type EditState = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export default function TeamUsersPanel({ currentUser }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"agent" | "admin">("agent");

  const [edit, setEdit] = useState<EditState | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await getUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحميل الموظفين");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 6) {
      setError("الاسم والبريد وكلمة مرور (6 أحرف على الأقل) مطلوبة");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await createUser({
        name: newName.trim(),
        email: newEmail.trim(),
        password: newPassword,
        role: newRole,
      });
      setUsers((prev) => [...prev, user]);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("agent");
      setCreateOpen(false);
      showToast("تم إنشاء الموظف");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل إنشاء الموظف");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateUser(edit.id, {
        name: edit.name.trim(),
        email: edit.email.trim(),
        role: edit.role,
      });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setEdit(null);
      showToast("تم تحديث الموظف");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تحديث الموظف");
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!passwordUserId) return;
    if (passwordValue.length < 6) {
      setError("كلمة المرور يجب أن تكون 6 أحرف على الأقل");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeUserPassword(passwordUserId, passwordValue);
      setPasswordUserId(null);
      setPasswordValue("");
      showToast("تم تغيير كلمة المرور");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تغيير كلمة المرور");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(user: User) {
    if (user.id === currentUser.id) {
      setError("لا يمكن حذف حسابك الحالي");
      return;
    }
    if (
      !window.confirm(
        `حذف الموظف «${user.name}»؟\nسيتم إزالة تعيين محادثاته، وتُنقل ملاحظاته الداخلية إليك.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      if (edit?.id === user.id) setEdit(null);
      if (passwordUserId === user.id) setPasswordUserId(null);
      showToast("تم حذف الموظف");
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل حذف الموظف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-inbox-border bg-inbox-panel p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">الموظفون</h2>
          <p className="mt-1 text-xs text-inbox-muted">
            إنشاء وتعديل وحذف موظفي العيادة (Admin فقط)
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setCreateOpen((v) => !v);
            setError(null);
          }}
          className="rounded-lg bg-inbox-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {createOpen ? "إلغاء" : "+ موظف جديد"}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}
      {toast && (
        <p className="mb-3 text-xs text-emerald-400">{toast}</p>
      )}

      {createOpen && (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-4 space-y-2 rounded-lg border border-inbox-border bg-inbox-hover/40 p-3"
        >
          <p className="text-xs font-medium text-inbox-muted">موظف جديد</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="الاسم"
            className="w-full rounded-md bg-inbox-bg px-3 py-2 text-sm outline-none"
            required
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="البريد الإلكتروني"
            className="w-full rounded-md bg-inbox-bg px-3 py-2 text-sm outline-none"
            dir="ltr"
            required
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="كلمة المرور (6 أحرف على الأقل)"
            className="w-full rounded-md bg-inbox-bg px-3 py-2 text-sm outline-none"
            dir="ltr"
            required
            minLength={6}
          />
          <select
            value={newRole}
            onChange={(e) =>
              setNewRole(e.target.value === "admin" ? "admin" : "agent")
            }
            className="w-full rounded-md bg-inbox-bg px-3 py-2 text-sm outline-none"
          >
            <option value="agent">موظف (Agent)</option>
            <option value="admin">مدير (Admin)</option>
          </select>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-inbox-accent py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "جاري الإنشاء..." : "إنشاء الموظف"}
          </button>
        </form>
      )}

      {loading && (
        <p className="text-sm text-inbox-muted">جاري تحميل الموظفين...</p>
      )}

      {!loading && users.length === 0 && (
        <p className="text-sm text-inbox-muted">لا يوجد موظفون بعد</p>
      )}

      <ul className="space-y-2">
        {users.map((user) => {
          const isSelf = user.id === currentUser.id;
          const isEditing = edit?.id === user.id;
          const isPassword = passwordUserId === user.id;

          return (
            <li
              key={user.id}
              className="rounded-lg border border-inbox-border bg-inbox-bg/50 p-3"
            >
              {!isEditing ? (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-inbox-text">
                      {user.name}
                      {isSelf ? (
                        <span className="mr-2 text-[11px] text-inbox-muted">
                          (أنت)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-inbox-muted" dir="ltr">
                      {user.email}
                    </p>
                    <p className="mt-1 text-[11px] text-inbox-muted">
                      الدور: {labelOr(ROLE_LABELS, user.role)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEdit({
                          id: user.id,
                          name: user.name,
                          email: user.email,
                          role: user.role,
                        });
                        setPasswordUserId(null);
                        setError(null);
                      }}
                      className="rounded-md bg-inbox-hover px-2.5 py-1 text-[11px] text-inbox-text"
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPasswordUserId(user.id);
                        setPasswordValue("");
                        setEdit(null);
                        setError(null);
                      }}
                      className="rounded-md bg-inbox-hover px-2.5 py-1 text-[11px] text-inbox-text"
                    >
                      كلمة المرور
                    </button>
                    <button
                      type="button"
                      disabled={busy || isSelf}
                      onClick={() => void handleDelete(user)}
                      className="rounded-md bg-red-500/15 px-2.5 py-1 text-[11px] text-red-300 disabled:opacity-40"
                    >
                      حذف
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleSaveEdit(e)}
                  className="space-y-2"
                >
                  <input
                    value={edit.name}
                    onChange={(e) =>
                      setEdit({ ...edit, name: e.target.value })
                    }
                    className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
                    required
                  />
                  <input
                    type="email"
                    value={edit.email}
                    onChange={(e) =>
                      setEdit({ ...edit, email: e.target.value })
                    }
                    className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
                    dir="ltr"
                    required
                  />
                  <select
                    value={edit.role}
                    onChange={(e) =>
                      setEdit({ ...edit, role: e.target.value })
                    }
                    disabled={isSelf}
                    className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none disabled:opacity-60"
                  >
                    <option value="agent">موظف</option>
                    <option value="admin">مدير</option>
                  </select>
                  {isSelf && (
                    <p className="text-[11px] text-inbox-muted">
                      لا يمكن تغيير دور حسابك من هنا
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-md bg-inbox-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={() => setEdit(null)}
                      className="rounded-md border border-inbox-border px-3 py-1.5 text-xs text-inbox-muted"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              )}

              {isPassword && (
                <form
                  onSubmit={(e) => void handleChangePassword(e)}
                  className="mt-3 space-y-2 border-t border-inbox-border pt-3"
                >
                  <p className="text-xs text-inbox-muted">
                    كلمة مرور جديدة لـ {user.name}
                  </p>
                  <input
                    type="password"
                    value={passwordValue}
                    onChange={(e) => setPasswordValue(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    className="w-full rounded-md bg-inbox-hover px-3 py-2 text-sm outline-none"
                    dir="ltr"
                    minLength={6}
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-md bg-inbox-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
                    >
                      تحديث كلمة المرور
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordUserId(null);
                        setPasswordValue("");
                      }}
                      className="rounded-md border border-inbox-border px-3 py-1.5 text-xs text-inbox-muted"
                    >
                      إلغاء
                    </button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
