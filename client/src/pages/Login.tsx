import { useState, type FormEvent } from "react";
import { login } from "../lib/api";
import { setSession } from "../lib/auth";

type Props = {
  onSuccess: () => void;
};

export default function Login({ onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    try {
      const result = await login(email.trim(), password);
      setSession(result.token, result.user);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex h-full items-center justify-center bg-inbox-bg px-4"
      dir="rtl"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-md space-y-4 rounded-xl border border-inbox-border bg-inbox-panel p-6 shadow-lg"
      >
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-inbox-accent">كادينا</h1>
          <p className="mt-1 text-sm text-inbox-muted">
            تسجيل الدخول إلى لوحة العيادة
          </p>
        </div>

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        )}

        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">البريد الإلكتروني</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2.5 text-inbox-text outline-none ring-inbox-accent focus:ring-1"
            dir="ltr"
          />
        </label>

        <label className="block space-y-1.5 text-sm">
          <span className="text-inbox-muted">كلمة المرور</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-inbox-hover px-3 py-2.5 text-inbox-text outline-none ring-inbox-accent focus:ring-1"
            dir="ltr"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !email.trim() || !password}
          className="w-full rounded-lg bg-inbox-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-[#029a78] disabled:opacity-50"
        >
          {busy ? "جاري الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}
