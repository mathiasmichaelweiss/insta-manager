import type { AuthMode } from "./config";

export type { AuthMode };

export type MediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
export type MediaProductType = "AD" | "FEED" | "STORY" | "REELS";

export interface MediaChild {
  id: string;
  media_type: MediaType;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
}

/** A post as returned by GET /{ig-user-id}/media. */
export interface Media {
  id: string;
  caption?: string;
  media_type: MediaType;
  media_product_type?: MediaProductType;
  media_url?: string;
  thumbnail_url?: string;
  permalink: string;
  timestamp: string;
  username?: string;
  like_count?: number;
  comments_count?: number;
  is_comment_enabled?: boolean;
  is_shared_to_feed?: boolean;
  shortcode?: string;
  children?: { data: MediaChild[] };
}

export interface MediaIndex {
  igUserId: string;
  username?: string;
  fetchedAt: string;
  count: number;
  media: Media[];
}

export interface Comment {
  id: string;
  text: string;
  username?: string;
  timestamp: string;
  like_count?: number;
  hidden?: boolean;
  /** Populated for replies: the id of the comment being replied to. */
  parent_id?: string;
  replies?: Comment[];
}

export interface CommentsFile {
  mediaId: string;
  permalink?: string;
  fetchedAt: string;
  /** Top-level comments only. */
  count: number;
  /** Top-level comments + every reply. */
  totalWithReplies: number;
  /** `comments_count` on the post when we fetched — what we expected to get. */
  expected?: number;
  /** Set when Instagram returned far fewer comments than it says exist. */
  warning?: string;
  comments: Comment[];
}

export interface MetricValue {
  value: number;
  title?: string;
  description?: string;
}

export interface InsightsFile {
  mediaId: string;
  mediaType: MediaType;
  mediaProductType?: MediaProductType;
  permalink?: string;
  fetchedAt: string;
  /** Counters that come from the media object itself, not from /insights. */
  counts: {
    like_count?: number;
    comments_count?: number;
  };
  metrics: Record<string, MetricValue>;
  /** Metrics Meta refused for this media, with the reason it gave. */
  unavailable: { metric: string; error: string }[];
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

/** One recognised word with its position on the timeline, in seconds. */
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptFile {
  mediaId: string;
  permalink?: string;
  transcribedAt: string;
  model: string;
  language?: string;
  duration?: number;
  text: string;
  segments: TranscriptSegment[];
  words?: TranscriptWord[];
  source: {
    mediaUrl: string;
    bytes: number;
    /** Set when we had to re-encode to audio-only to fit OpenAI's 25 MB limit. */
    transcodedToAudio: boolean;
  };
}

/** Resolved credentials, persisted to data/account.json. */
export interface Account {
  /** "instagram" = graph.instagram.com, "facebook" = graph.facebook.com. */
  mode: AuthMode;
  igUserId: string;
  username?: string;
  name?: string;
  accountType?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
  /** Facebook mode only. */
  pageId?: string;
  pageName?: string;
  accessToken: string;
  tokenSource: "oauth" | "manual" | "env";
  /** Unix seconds; undefined for never-expiring page tokens. */
  expiresAt?: number;
  savedAt: string;
}

/**
 * One line of the NDJSON progress stream shared by every /api/sync/* route.
 *
 * `count` is whatever the job counts — comments fetched, metrics read, transcript
 * segments — so the same client code drives all three progress bars.
 */
export type SyncEvent =
  | { type: "start"; total: number }
  | {
      type: "progress";
      id: string;
      done: number;
      total: number;
      count: number;
      /** Finished, but the result needs the user's attention (e.g. withheld comments). */
      flagged?: boolean;
    }
  | { type: "skip"; id: string; done: number; total: number }
  | { type: "error"; id: string; done: number; total: number; message: string }
  | {
      type: "done";
      total: number;
      succeeded: number;
      skipped: number;
      failed: number;
      count: number;
      flagged: number;
      /** Attached once, explaining why results were flagged. */
      warning?: string;
    };

/** What a sync worker reports back for a single post. */
export interface SyncOutcome {
  /** Items handled — added to the running total shown in the UI. */
  count: number;
  /** Nothing to do for this post (already on disk, not a video, …). */
  skipped?: boolean;
  /** Needs attention; the first warning seen is surfaced in the summary. */
  warning?: string;
}

/**
 * One post's numbers, joined from insights + transcript and reduced to the
 * handful that actually inform decisions. Ratios are fractions (0.42 = 42 %).
 */
export interface PostMetrics {
  mediaId: string;
  reach?: number;
  views?: number;
  saved?: number;
  shares?: number;
  totalInteractions?: number;
  /** Percent, straight from Instagram. */
  skipRate?: number;
  avgWatchSeconds?: number;
  /** From the transcript — Instagram does not report clip length. */
  durationSeconds?: number;
  /** avgWatch / duration: how much of the clip an average viewer sees. */
  retention?: number;
  /** total_interactions / reach. */
  er?: number;
  savedPerReach?: number;
  sharesPerReach?: number;
  fetchedAt?: string;
}

export interface MetricsFile {
  count: number;
  withRetention: number;
  medianReach?: number;
  medianRetention?: number;
  rows: PostMetrics[];
}

/**
 * A video that has not been published yet: uploaded from disk, transcribed, and
 * kept alongside the archive so it can be compared with what already ran.
 * The video file itself is not stored — only its transcript.
 */
export interface Draft {
  id: string;
  title: string;
  fileName: string;
  bytes: number;
  createdAt: string;
  notes?: string;
  model: string;
  language?: string;
  duration?: number;
  /** How many requests the recording was split across. 1 = sent whole. */
  chunks?: number;
  text: string;
  segments: TranscriptSegment[];
  /** Per-word timestamps. Missing on drafts uploaded before they were recorded. */
  words?: TranscriptWord[];
}

/**
 * Everything an outside AI agent needs to judge a draft: how the published
 * archive performed, what it was about, what the audience keeps asking, and the
 * draft itself.
 */
export interface Brief {
  generatedAt: string;
  account: {
    username?: string;
    followers?: number;
    publishedPosts: number;
    /** Account-wide, because per-post `follows` does not exist for Reels. */
    newFollowers30d?: number;
    newFollowers7d?: number;
  };
  /** Caveats the agent must know before drawing conclusions from these numbers. */
  dataNotes: string[];
  benchmarks: {
    medianReach?: number;
    medianRetention?: number;
    medianEr?: number;
    medianSavedPerReach?: number;
  };
  posts: BriefPost[];
  commentTopics: {
    name: string;
    description: string;
    count: number;
    questionCount: number;
    postCount: number;
    examples: string[];
  }[];
  /**
   * Private correspondence. Present only when the brief is built with DMs
   * included — it carries real names and what people wrote you in confidence.
   */
  directMessages?: {
    conversations: number;
    messages: number;
    topics: {
      name: string;
      description: string;
      count: number;
      questionCount: number;
      conversationCount: number;
      examples: string[];
    }[];
    threads: {
      id: string;
      counterpart?: string;
      messages: { at: string; mine: boolean; text?: string }[];
    }[];
  };
  draft?: {
    title: string;
    duration?: number;
    hook: string;
    transcript: string;
  };
}

export interface BriefPost {
  id: string;
  permalink?: string;
  publishedAt: string;
  productType?: string;
  mediaType?: string;
  /** Slides in a carousel — absent for single-image posts and Reels. */
  slides?: number;
  caption?: string;
  reach?: number;
  views?: number;
  retention?: number;
  skipRate?: number;
  er?: number;
  savedPerReach?: number;
  sharesPerReach?: number;
  comments?: number;
  /** Opening seconds of speech — the part that decides whether anyone stays. */
  hook?: string;
  transcript?: string;
}

/**
 * Account-wide daily numbers. The honest answer to "how many followers did I
 * gain" — per-post `follows` does not exist for Reels, so for a Reels-heavy
 * account it can only ever describe a fraction of the picture.
 */
export interface AccountInsights {
  igUserId: string;
  fetchedAt: string;
  /** Merged history, one entry per day, oldest first. */
  followerCount: { date: string; value: number }[];
  reach: { date: string; value: number }[];
  /** Meta's own wording for what `follower_count` counts. */
  followerCountDescription?: string;
  notes: string[];
}

export interface DmParticipant {
  id: string;
  username?: string;
}

/**
 * What rides along with a message when it has no plain text.
 *
 * `generic_template` is not decoration: automation tools send their messages
 * this way, so the wording lives in `title` rather than in `message`.
 */
export interface DmAttachment {
  id?: string;
  image_data?: { url?: string; width?: number; height?: number };
  video_data?: { url?: string; width?: number; height?: number };
  generic_template?: {
    title?: string;
    subtitle?: string;
    cta?: { title?: string; url?: string }[];
  };
}

export interface DmMessage {
  id: string;
  created_time: string;
  from?: DmParticipant;
  to?: { data?: DmParticipant[] };
  message?: string;
  /** Instagram marks stickers, reels shares and the like as unsupported. */
  is_unsupported?: boolean;
  attachments?: { data?: DmAttachment[] };
}

/** One Direct thread with its full message history, newest first. */
export interface ConversationFile {
  id: string;
  updatedTime: string;
  fetchedAt: string;
  participants: DmParticipant[];
  /** The other side of the thread — absent for group or deleted accounts. */
  counterpart?: DmParticipant;
  messageCount: number;
  /** True when only the most recent messages were fetched, not the whole thread. */
  partial?: boolean;
  messages: DmMessage[];
}

/** Row in the conversation list, derived from the stored thread. */
export interface ConversationSummary {
  id: string;
  updatedTime: string;
  counterpart?: DmParticipant;
  messageCount: number;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  /** True when the counterpart spoke last — those are the ones awaiting you. */
  needsReply: boolean;
  /** Meta only allows a reply within 24h of their last message. */
  replyWindowOpen: boolean;
}

/** A comment pulled out of its file, with the post it belongs to. */
export interface FlatComment {
  commentId: string;
  mediaId: string;
  text: string;
  timestamp: string;
  likeCount?: number;
  isReply: boolean;
}

export interface Topic {
  id: string;
  name: string;
  description: string;
  count: number;
  /** How many of them are actually questions — those are content ideas. */
  questionCount: number;
  /** Distinct posts the topic showed up under. */
  postCount: number;
  examples: { text: string; mediaId: string; commentId: string }[];
}

export interface TopicsFile {
  createdAt: string;
  model: string;
  /** Every comment found on disk, replies included. */
  totalComments: number;
  /** Sent to the model — emoji-only reactions are counted but not sent. */
  analyzed: number;
  reactionsOnly: number;
  topics: Topic[];
}

/** Preflight for POST /api/analyze/topics. */
export interface TopicsPlan {
  totalComments: number;
  analyzable: number;
  reactionsOnly: number;
  batches: number;
  estimatedUsd: number;
  model: string;
  existing?: { createdAt: string; topics: number };
}

/** Preflight for POST /api/sync/transcripts — what a run would cost. */
export interface TranscribePlan {
  pending: number;
  alreadyDone: number;
  notVideo: number;
  /** Estimated from the average length of transcripts already on disk. */
  estimatedMinutes: number;
  estimatedUsd: number;
  basedOnSamples: number;
}
