import type { Conversation } from "../lib/api";
import CustomerProfile from "./CustomerProfile";

type Props = {
  conversation: Conversation | null;
  onConversationUpdated?: (conversation: Conversation) => void;
  onOpenConversation?: () => void;
};

/** @deprecated Prefer CustomerProfile — kept as thin wrapper for Inbox. */
export default function CrmPanel(props: Props) {
  return <CustomerProfile {...props} />;
}
