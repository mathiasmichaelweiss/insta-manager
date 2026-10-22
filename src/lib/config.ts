import path from "node:path";

/** Which of Meta's two Instagram integrations a token belongs to. */
export type AuthMode = "instagram" | "facebook";

export type ApiHost = "graph.instagram.com" | "graph.facebook.com";

export const HOST_FOR: Record<AuthMode, ApiHost> = {
  instagram: "graph.instagram.com",
  facebook: "graph.facebook.com",
};

/**
 * Getters, not plain fields: Next can inline `process.env.X` at build time, and
 * we want `npm run build` once + edit `.env.local` + `npm start` to keep working.
 */
export const config = {
  get graphVersion() {
    return process.env.GRAPH_API_VERSION || "v23.0";
  },
  /** Instagram API with Instagram login — "ID приложения Instagram" in the dashboard. */
  get igAppId() {
    return process.env.IG_APP_ID || "";
  },
  get igAppSecret() {
    return process.env.IG_APP_SECRET || "";
  },
  /** Instagram API with Facebook login. */
  get fbAppId() {
    return process.env.FB_APP_ID || "";
  },
  get fbAppSecret() {
    return process.env.FB_APP_SECRET || "";
  },
  get baseUrl() {
    return (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get envToken() {
    return process.env.IG_ACCESS_TOKEN || "";
  },
  get envIgUserId() {
    return process.env.IG_USER_ID || "";
  },
  get openaiKey() {
    return process.env.OPENAI_API_KEY || "";
  },
  get transcribeModel() {
    return process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  },
  get dataDir() {
    const dir = process.env.DATA_DIR;
    return dir ? path.resolve(dir) : path.join(process.cwd(), "data");
  },
};

/**
 * Instagram login scopes. `instagram_business_manage_insights` is a separate
 * permission — without it the app reads posts and comments but no statistics.
 */
export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_comments",
  "instagram_business_manage_insights",
];

/** Facebook login scopes, for accounts linked to a Facebook Page. */
export const FB_SCOPES = [
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
];

export const apiUrl = (host: ApiHost, endpoint: string) =>
  `https://${host}/${config.graphVersion}/${endpoint.replace(/^\//, "")}`;
