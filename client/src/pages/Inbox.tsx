import { useCallback, useEffect, useRef, useState } from "react";
import ChatWindow, { playBeep } from "../components/ChatWindow";
import ConversationList from "../components/ConversationList";
import CustomerProfile from "../components/CustomerProfile";
import CustomerTimeline from "../components/CustomerTimeline";
import NotesPanel from "../components/NotesPanel";
import {
  useSocket,
  type ConversationUpdatedEvent,
  type NewMessageEvent,
} from "../hooks/useSocket";
import type { Conversation } from "../lib/api";
import { getStoredUser } from "../lib/auth";

type CenterTab = "conversation" | "timeline" | "crm";

export default function Inbox() {
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [centerTab, setCenterTab] = useState<CenterTab>("conversation");
  const selectedContactIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedContactIdRef.current = selected?.contactId ?? null;
  }, [selected]);

  useEffect(() => {
    // Reset to conversation when switching contacts
    setCenterTab("conversation");
  }, [selected?.id]);

  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
  }, []);

  const handleUpdated = useCallback((conversation: Conversation) => {
    setSelected((prev) =>
      prev && prev.id === conversation.id ? conversation : prev
    );
  }, []);

  const handleSocketUpdated = useCallback(
    (payload: ConversationUpdatedEvent) => {
      setSelected((prev) => {
        if (!prev || prev.id !== payload.id) return prev;
        const user = getStoredUser();
        if (
          user?.role === "agent" &&
          payload.assignedToId !== user.id
        ) {
          return null;
        }
        return payload;
      });
    },
    []
  );

  const onNewInbound = useCallback((payload: NewMessageEvent) => {
    if (payload.message.direction !== "inbound") return;
    if (payload.contact.id === selectedContactIdRef.current) return;

    playBeep();

    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      const title =
        payload.contact.name || payload.contact.phone || "رسالة جديدة";
      const body = payload.message.content?.slice(0, 120) || "رسالة واردة";
      try {
        new Notification(title, { body, silent: true });
      } catch {
        // ignore notification errors
      }
    }
  }, []);

  useSocket({
    onConversationUpdated: handleSocketUpdated,
    onNewMessage: onNewInbound,
  });

  const tabs: { id: CenterTab; label: string }[] = [
    { id: "conversation", label: "المحادثة" },
    { id: "timeline", label: "السجل الزمني" },
    { id: "crm", label: "ملف العميل" },
  ];

  return (
    <div
      className={`grid h-full min-h-0 overflow-hidden ${
        notesOpen
          ? "grid-cols-1 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)_minmax(220px,280px)]"
          : "grid-cols-1 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]"
      }`}
      dir="rtl"
    >
      <div className="min-h-0 min-w-0 overflow-hidden">
        <ConversationList
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-1 border-b border-inbox-border bg-inbox-panel px-3 py-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCenterTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                centerTab === t.id
                  ? "bg-inbox-accent text-white"
                  : "text-inbox-muted hover:bg-inbox-hover hover:text-inbox-text"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            className="mr-auto rounded-md px-2 py-1 text-[11px] text-inbox-muted hover:bg-inbox-hover"
          >
            {notesOpen ? "إخفاء الملاحظات" : "الملاحظات"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {centerTab === "conversation" && (
            <ChatWindow
              conversation={selected}
              onConversationUpdated={handleUpdated}
              notesOpen={notesOpen}
              onToggleNotes={() => setNotesOpen((v) => !v)}
            />
          )}
          {centerTab === "timeline" && (
            <CustomerTimeline contactId={selected?.contactId ?? null} />
          )}
          {centerTab === "crm" && (
            <CustomerProfile
              conversation={selected}
              onConversationUpdated={handleUpdated}
              onOpenConversation={() => setCenterTab("conversation")}
            />
          )}
        </div>
      </div>

      {notesOpen && (
        <div className="hidden min-h-0 min-w-0 overflow-hidden md:block">
          <NotesPanel
            conversation={selected}
            onConversationUpdated={handleUpdated}
            onClose={() => setNotesOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
