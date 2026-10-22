import { hostFor } from "./account";
import { describeMessage } from "./format";
import { GraphError, graphGet, graphGetAll, graphPost } from "./graph";
import { listIds, paths, readJson, writeJson } from "./store";
import type {
  Account,
  ConversationFile,
  ConversationSummary,
  DmMessage,
  DmParticipant,
} from "./types";

const MESSAGE_FIELDS = "id,created_time,from,to,message,is_unsupported,attachments";
/**
 * Page sizes, both found by experiment rather than from the docs.
 *
 * Fetching threads one at a time costs one call each, and 300+ of those exhaust
 * Instagram's hourly app budget in under a minute — the first attempt failed
 * 315 of 319 threads that way. Nesting messages into the conversation list
 * fixes that, but the API then refuses anything bigger than roughly 25×10 with
 * "Please reduce the amount of data you're asking for".
 *
 * So the sync is shallow by design: it brings back every thread with its last
 * few messages in ~13 calls. Full history is fetched per thread on demand, or
 * by the deep pass, which is resumable because the budget will run out.
 */
const NESTED_MESSAGE_LIMIT = 10;
const CONVERSATION_PAGE = 20;
/** Never go below this — a page this small still makes progress. */
const MIN_CONVERSATION_PAGE = 3;
const CONVERSATION_FIELDS =
  `id,updated_time,participants,messages.limit(${NESTED_MESSAGE_LIMIT}){${MESSAGE_FIELDS}}`;

/** Meta only allows replying within 24 hours of the other side's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RawConversation {
  id: string;
  updated_time: string;
  participants?: { data?: DmParticipant[] };
  messages?: { data?: DmMessage[] };
}

/** Meta's complaint when a page is too heavy — the wording is the only signal. */
const isTooMuchData = (err: unknown) =>
  err instanceof GraphError && /reduce the amount of data/i.test(err.message);

/**
 * Every Direct thread, newest activity first, with recent messages inline.
 *
 * Pages are walked by cursor rather than by following `paging.next`, because the
 * page size has to be adjustable. Instagram rejects a page when its payload is
 * too big, and the threshold moves with the content: 25 threads succeeds on one
 * page and fails on the next depending on how long the messages happen to be.
 * So on rejection the page is halved and retried instead of failing the sync.
 */
export async function fetchConversations(account: Account): Promise<RawConversation[]> {
  const out: RawConversation[] = [];
  let limit = CONVERSATION_PAGE;
  let after: string | undefined;

  for (;;) {
    let page: { data?: RawConversation[]; paging?: { cursors?: { after?: string } } };
    try {
      page = await graphGet(
        `${account.igUserId}/conversations`,
        { fields: CONVERSATION_FIELDS, limit, after },
        account.accessToken,
        hostFor(account),
      );
    } catch (err) {
      if (isTooMuchData(err) && limit > MIN_CONVERSATION_PAGE) {
        limit = Math.max(MIN_CONVERSATION_PAGE, Math.floor(limit / 2));
        continue;
      }
      throw err;
    }

    const batch = page.data ?? [];
    out.push(...batch);

    after = page.paging?.cursors?.after;
    if (!after || batch.length === 0) return out;
  }
}

export async function fetchMessages(account: Account, conversationId: string): Promise<DmMessage[]> {
  return graphGetAll<DmMessage>(
    `${conversationId}/messages`,
    { fields: MESSAGE_FIELDS, limit: 100 },
    account.accessToken,
    hostFor(account),
  );
}

export function counterpartOf(
  participants: DmParticipant[],
  igUserId: string,
): DmParticipant | undefined {
  return participants.find((p) => p.id !== igUserId);
}

/**
 * Pulls one thread in full and stores it.
 *
 * Threads are only refetched when Instagram's `updated_time` moved. A full pass
 * over 300+ conversations costs hundreds of calls against a small hourly budget,
 * so re-reading unchanged threads is the difference between a sync that can run
 * daily and one that cannot.
 */
export async function syncConversation(
  account: Account,
  conversation: RawConversation,
  force: boolean,
  deep = false,
): Promise<{ file: ConversationFile; skipped: boolean }> {
  const stored = await readJson<ConversationFile>(paths.conversation(conversation.id));
  const unchanged = stored && stored.updatedTime === conversation.updated_time;
  // A deep pass still has work to do on a thread whose history was never pulled.
  if (!force && unchanged && !(deep && stored.partial)) {
    return { file: stored, skipped: true };
  }

  // Messages arrive inline with the conversation list. A thread that filled the
  // nested page has more history behind it; `deep` decides whether to spend a
  // call fetching it now or leave the thread marked partial for later.
  const nested = conversation.messages?.data ?? [];
  const truncated = nested.length >= NESTED_MESSAGE_LIMIT;
  const messages = truncated && deep ? await fetchMessages(account, conversation.id) : nested;

  const participants = conversation.participants?.data ?? stored?.participants ?? [];

  const file: ConversationFile = {
    id: conversation.id,
    updatedTime: conversation.updated_time,
    fetchedAt: new Date().toISOString(),
    participants,
    counterpart: counterpartOf(participants, account.igUserId),
    messageCount: messages.length,
    partial: truncated && !deep,
    messages,
  };

  await writeJson(paths.conversation(conversation.id), file);
  return { file, skipped: false };
}

/** Pulls a thread's full history and replaces the shallow copy on disk. */
export async function deepenConversation(
  account: Account,
  file: ConversationFile,
): Promise<ConversationFile> {
  if (!file.partial) return file;
  const messages = await fetchMessages(account, file.id);
  const full: ConversationFile = {
    ...file,
    messages,
    messageCount: messages.length,
    partial: false,
    fetchedAt: new Date().toISOString(),
  };
  await writeJson(paths.conversation(file.id), full);
  return full;
}

export function summarise(file: ConversationFile, igUserId: string): ConversationSummary {
  // The API returns messages newest first.
  const last = file.messages[0];
  const theirsLast = file.messages.find((m) => m.from?.id && m.from.id !== igUserId);

  // A story reaction is technically the last message but asks nothing of you.
  // Counting those as "awaiting reply" inflated the queue to the point of being
  // useless, so only messages carrying something count.
  const lastKind = last ? describeMessage(last).kind : "reaction";
  const needsReply =
    Boolean(last?.from?.id && last.from.id !== igUserId) &&
    lastKind !== "reaction" &&
    lastKind !== "unsupported";

  const since = theirsLast ? Date.now() - new Date(theirsLast.created_time).getTime() : Infinity;

  return {
    id: file.id,
    updatedTime: file.updatedTime,
    counterpart: file.counterpart,
    messageCount: file.messageCount,
    lastMessageAt: last?.created_time,
    lastMessagePreview: last ? describeMessage(last).text.replace(/\s+/g, " ").slice(0, 160) : undefined,
    needsReply,
    replyWindowOpen: since < REPLY_WINDOW_MS,
  };
}

export async function loadConversations(igUserId: string): Promise<ConversationSummary[]> {
  const summaries: ConversationSummary[] = [];
  for (const id of await listIds("conversations")) {
    const file = await readJson<ConversationFile>(paths.conversation(id));
    if (file) summaries.push(summarise(file, igUserId));
  }
  return summaries.sort((a, b) => b.updatedTime.localeCompare(a.updatedTime));
}

/**
 * Sends a Direct message. The only write this app makes to the account besides
 * comment replies — callers must confirm with the user first.
 */
export async function sendMessage(
  account: Account,
  recipientId: string,
  text: string,
): Promise<{ message_id?: string }> {
  return graphPost<{ message_id?: string }>(
    `${account.igUserId}/messages`,
    { recipient: { id: recipientId }, message: { text } },
    account.accessToken,
    hostFor(account),
  );
}
