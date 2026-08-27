import { useCallback, useEffect, useState } from "react";
import AiSettingsPage from "./pages/AiSettings";
import Analytics from "./pages/Analytics";
import AuditCenter from "./pages/AuditCenter";
import CampaignBuilder from "./pages/CampaignBuilder";
import CampaignReport from "./pages/CampaignReport";
import Campaigns from "./pages/Campaigns";
import ContactLists from "./pages/ContactLists";
import FlowBuilder from "./pages/FlowBuilder";
import Flows from "./pages/Flows";
import Health from "./pages/Health";
import Inbox from "./pages/Inbox";
import Integrations from "./pages/Integrations";
import KnowledgeBase from "./pages/KnowledgeBase";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import Templates from "./pages/Templates";
import WhatsAppChannels from "./pages/WhatsAppChannels";
import { getMe, getToken, logoutApi, type User } from "./lib/api";
import { clearSession, getStoredUser } from "./lib/auth";

type Page =
  | "inbox"
  | "templates"
  | "campaigns"
  | "campaign-builder"
  | "campaign-report"
  | "lists"
  | "flows"
  | "flow-builder"
  | "knowledge"
  | "ai-settings"
  | "analytics"
  | "integrations"
  | "settings"
  | "whatsapp-channels"
  | "health"
  | "audit";

const AGENT_NAV: { id: Page; label: string }[] = [
  { id: "inbox", label: "صندوق الوارد" },
  { id: "templates", label: "القوالب" },
  { id: "lists", label: "القوائم" },
  { id: "flows", label: "الروبوت" },
  { id: "knowledge", label: "المعرفة" },
  { id: "ai-settings", label: "الذكاء" },
  { id: "integrations", label: "التكاملات" },
];

const ADMIN_NAV: { id: Page; label: string }[] = [
  { id: "inbox", label: "صندوق الوارد" },
  { id: "analytics", label: "التقارير" },
  { id: "templates", label: "القوالب" },
  { id: "lists", label: "القوائم" },
  { id: "campaigns", label: "الحملات" },
  { id: "flows", label: "الروبوت" },
  { id: "knowledge", label: "المعرفة" },
  { id: "ai-settings", label: "الذكاء" },
  { id: "settings", label: "الإعدادات" },
  { id: "integrations", label: "التكاملات" },
  { id: "whatsapp-channels", label: "أرقام واتساب" },
  { id: "audit", label: "التدقيق" },
  { id: "health", label: "حالة النظام" },
];

function buildNav(role?: string): { id: Page; label: string }[] {
  return role === "admin" ? ADMIN_NAV : AGENT_NAV;
}

const ADMIN_ONLY_PAGES = new Set<Page>([
  "analytics",
  "campaigns",
  "campaign-builder",
  "campaign-report",
  "settings",
  "whatsapp-channels",
  "audit",
  "health",
]);

export default function App() {
  const [token, setTokenState] = useState<string | null>(() => getToken());
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [authLoading, setAuthLoading] = useState(() => Boolean(getToken()));
  const [page, setPage] = useState<Page>("inbox");
  const [reportId, setReportId] = useState<string | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);

  const handleLogout = useCallback(() => {
    void logoutApi().catch(() => {
      // ignore network errors on logout audit
    });
    clearSession();
    setTokenState(null);
    setUser(null);
    setPage("inbox");
  }, []);

  const loadMe = useCallback(async () => {
    setAuthLoading(true);
    try {
      const me = await getMe();
      setUser(me);
      setTokenState(getToken());
    } catch {
      handleLogout();
    } finally {
      setAuthLoading(false);
    }
  }, [handleLogout]);

  useEffect(() => {
    if (!token) {
      setAuthLoading(false);
      return;
    }
    void loadMe();
  }, [token, loadMe]);

  useEffect(() => {
    function onLogout() {
      handleLogout();
    }
    window.addEventListener("kadina:logout", onLogout);
    return () => window.removeEventListener("kadina:logout", onLogout);
  }, [handleLogout]);

  useEffect(() => {
    if (user?.role === "admin") return;
    if (ADMIN_ONLY_PAGES.has(page)) {
      setPage("inbox");
    }
  }, [user?.role, page]);

  if (!token) {
    return (
      <Login
        onSuccess={() => {
          setTokenState(getToken());
          setUser(getStoredUser());
          void loadMe();
        }}
      />
    );
  }

  if (authLoading && !user) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-inbox-muted"
        dir="rtl"
      >
        جاري التحقق من الجلسة...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" dir="rtl">
      <nav className="flex shrink-0 flex-wrap items-center gap-2 border-b border-inbox-border bg-inbox-panel px-4 py-2">
        <span className="ml-auto text-sm font-semibold text-inbox-accent">
          كادينا
        </span>
        {buildNav(user?.role).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              page === item.id ||
              (item.id === "campaigns" &&
                (page === "campaign-builder" || page === "campaign-report")) ||
              (item.id === "flows" && page === "flow-builder")
                ? "bg-inbox-accent text-white"
                : "bg-inbox-hover text-inbox-muted hover:text-inbox-text"
            }`}
          >
            {item.label}
          </button>
        ))}
        <div className="mr-auto flex items-center gap-2">
          {user && (
            <span className="text-xs text-inbox-muted">{user.name}</span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-md bg-inbox-hover px-3 py-1.5 text-sm text-inbox-muted hover:text-inbox-text"
          >
            خروج
          </button>
        </div>
      </nav>
      <div className="min-h-0 flex-1 overflow-hidden">
        {page === "inbox" && <Inbox />}
        {page === "analytics" && user?.role === "admin" && <Analytics />}
        {page === "templates" && <Templates />}
        {page === "lists" && (
          <ContactLists
            onOpenBuilder={
              user?.role === "admin"
                ? () => setPage("campaign-builder")
                : undefined
            }
          />
        )}
        {page === "campaigns" && user?.role === "admin" && (
          <Campaigns
            onCreate={() => setPage("campaign-builder")}
            onOpenReport={(id) => {
              setReportId(id);
              setPage("campaign-report");
            }}
          />
        )}
        {page === "campaign-builder" && user?.role === "admin" && (
          <CampaignBuilder
            onCancel={() => setPage("campaigns")}
            onDone={(id) => {
              setReportId(id);
              setPage("campaign-report");
            }}
          />
        )}
        {page === "campaign-report" && reportId && user?.role === "admin" && (
          <CampaignReport
            campaignId={reportId}
            onBack={() => setPage("campaigns")}
          />
        )}
        {page === "flows" && (
          <Flows
            onCreate={() => {
              setFlowId(null);
              setPage("flow-builder");
            }}
            onEdit={(id) => {
              setFlowId(id);
              setPage("flow-builder");
            }}
          />
        )}
        {page === "flow-builder" && (
          <FlowBuilder
            flowId={flowId}
            onBack={() => setPage("flows")}
            onSaved={(id) => setFlowId(id)}
          />
        )}
        {page === "knowledge" && <KnowledgeBase />}
        {page === "ai-settings" && <AiSettingsPage />}
        {page === "settings" && user?.role === "admin" && (
          <Settings
            user={user}
            onNavigateToChannels={() => setPage("whatsapp-channels")}
          />
        )}
        {page === "whatsapp-channels" && user?.role === "admin" && (
          <WhatsAppChannels />
        )}
        {page === "integrations" && <Integrations />}
        {page === "audit" && user?.role === "admin" && <AuditCenter />}
        {page === "health" && user?.role === "admin" && <Health />}
      </div>
    </div>
  );
}
