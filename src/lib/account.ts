import { type AuthMode, HOST_FOR, config } from "./config";
import { GraphError, graphGet } from "./graph";
import { paths, readJson, removeJson, writeJson } from "./store";
import type { Account } from "./types";

interface IgAccountShape {
  id: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

interface PageShape {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: IgAccountShape;
}

const IG_FIELDS = "id,username,name,profile_picture_url";

export class NoAccountError extends Error {
  constructor() {
    super(
      "Аккаунт не подключён. Откройте /settings и вставьте маркер доступа Instagram " +
        "(или войдите через Facebook).",
    );
    this.name = "NoAccountError";
  }
}

/**
 * Instagram API with Instagram login: the token belongs to the Instagram user
 * directly, no Facebook Page involved. Everything goes through
 * graph.instagram.com.
 */
async function resolveInstagram(token: string, source: Account["tokenSource"]): Promise<Account> {
  const me = await graphGet<{
    id?: string;
    user_id?: string;
    username?: string;
    name?: string;
    account_type?: string;
    profile_picture_url?: string;
    followers_count?: number;
    media_count?: number;
  }>(
    "me",
    { fields: "user_id,username,name,account_type,profile_picture_url,followers_count,media_count" },
    token,
    "graph.instagram.com",
  );

  const igUserId = me.user_id || me.id;
  if (!igUserId) {
    throw new Error("Instagram не вернул идентификатор аккаунта для этого маркера доступа.");
  }

  return {
    mode: "instagram",
    igUserId,
    username: me.username,
    name: me.name,
    accountType: me.account_type,
    profilePictureUrl: me.profile_picture_url,
    followersCount: me.followers_count,
    mediaCount: me.media_count,
    accessToken: token,
    tokenSource: source,
    expiresAt: undefined,
    savedAt: new Date().toISOString(),
  };
}

/**
 * Instagram API with Facebook login: walk from the user or page token to the
 * linked Instagram Business account, preferring the Page token that Meta
 * expects for media/comments/insights.
 */
async function resolveFacebook(token: string, source: Account["tokenSource"]): Promise<Account> {
  const candidates: { page?: PageShape; ig: IgAccountShape; token: string }[] = [];

  // Path A: user token → list the pages this user administers.
  try {
    const res = await graphGet<{ data: PageShape[] }>(
      "me/accounts",
      { fields: `id,name,access_token,instagram_business_account{${IG_FIELDS}}` },
      token,
    );
    for (const page of res.data ?? []) {
      if (page.instagram_business_account) {
        candidates.push({
          page,
          ig: page.instagram_business_account,
          token: page.access_token || token,
        });
      }
    }
  } catch {
    // Page tokens can't call /me/accounts — fall through to path B.
  }

  // Path B: the token itself belongs to a page.
  if (candidates.length === 0) {
    const me = await graphGet<PageShape & IgAccountShape>(
      "me",
      { fields: `id,name,instagram_business_account{${IG_FIELDS}}` },
      token,
    );
    if (me.instagram_business_account) {
      candidates.push({ page: me, ig: me.instagram_business_account, token });
    }
  }

  // If IG_USER_ID is pinned, keep only that one (or verify it directly).
  let chosen = candidates[0];
  if (config.envIgUserId) {
    const pinned = candidates.find((c) => c.ig.id === config.envIgUserId);
    if (pinned) {
      chosen = pinned;
    } else {
      const ig = await graphGet<IgAccountShape>(config.envIgUserId, { fields: IG_FIELDS }, token);
      chosen = { ig, token };
    }
  }

  if (!chosen) {
    throw new Error(
      "К этому токену не привязан Instagram Business/Creator аккаунт. " +
        "Проверьте, что профиль переведён в Professional и связан с Facebook-страницей, " +
        "и что приложению выданы права instagram_basic, instagram_manage_comments, instagram_manage_insights.",
    );
  }

  return {
    mode: "facebook",
    igUserId: chosen.ig.id,
    username: chosen.ig.username,
    name: chosen.ig.name,
    profilePictureUrl: chosen.ig.profile_picture_url,
    pageId: chosen.page?.id,
    pageName: chosen.page?.name,
    accessToken: chosen.token,
    tokenSource: source,
    expiresAt: await facebookTokenExpiry(chosen.token),
    savedAt: new Date().toISOString(),
  };
}

/**
 * Turns a raw access token into a usable account.
 *
 * With no `mode` given, Instagram is tried first (that is what the dashboard's
 * "Сгенерируйте маркеры доступа" button hands out) and Facebook second, so a
 * pasted token works without the user having to know which kind it is.
 */
export async function resolveAccount(
  token: string,
  source: Account["tokenSource"],
  mode?: AuthMode,
): Promise<Account> {
  if (mode === "instagram") return resolveInstagram(token, source);
  if (mode === "facebook") return resolveFacebook(token, source);

  try {
    return await resolveInstagram(token, source);
  } catch (igError) {
    try {
      return await resolveFacebook(token, source);
    } catch (fbError) {
      // Report whichever error is more informative than "invalid token".
      const igMessage = igError instanceof Error ? igError.message : String(igError);
      const fbMessage = fbError instanceof Error ? fbError.message : String(fbError);
      if (igError instanceof GraphError && igError.code === 190) throw fbError;
      throw new Error(
        `Маркер не подошёл ни к Instagram API, ни к Facebook Graph API.\n` +
          `Instagram: ${igMessage}\nFacebook: ${fbMessage}`,
      );
    }
  }
}

/** Best-effort: only works when the Facebook app id/secret are configured. */
async function facebookTokenExpiry(token: string): Promise<number | undefined> {
  if (!config.fbAppId || !config.fbAppSecret) return undefined;
  try {
    const res = await graphGet<{ data?: { expires_at?: number } }>(
      "debug_token",
      { input_token: token },
      `${config.fbAppId}|${config.fbAppSecret}`,
    );
    const expires = res.data?.expires_at;
    return expires && expires > 0 ? expires : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Instagram long-lived tokens last 60 days and can be renewed any time after
 * they are 24 hours old, which resets the clock without re-authorising.
 */
export async function refreshInstagramToken(account: Account): Promise<Account> {
  if (account.mode !== "instagram") {
    throw new Error("Продление доступно только для маркера Instagram API.");
  }

  const res = await graphGet<{ access_token: string; expires_in?: number }>(
    "refresh_access_token",
    { grant_type: "ig_refresh_token" },
    account.accessToken,
    "graph.instagram.com",
  );

  const updated: Account = {
    ...account,
    accessToken: res.access_token,
    expiresAt: res.expires_in ? Math.floor(Date.now() / 1000) + res.expires_in : undefined,
    savedAt: new Date().toISOString(),
  };
  await saveAccount(updated);
  return updated;
}

export async function saveAccount(account: Account): Promise<void> {
  await writeJson(paths.account, account);
}

export async function clearAccount(): Promise<void> {
  await removeJson(paths.account);
}

/** Cached account if we have one; otherwise bootstrap from IG_ACCESS_TOKEN. */
export async function getAccount(): Promise<Account> {
  const saved = await readJson<Account>(paths.account);
  if (saved?.accessToken) return saved;

  if (config.envToken) {
    const account = await resolveAccount(config.envToken, "env");
    await saveAccount(account);
    return account;
  }

  throw new NoAccountError();
}

export async function peekAccount(): Promise<Account | null> {
  return readJson<Account>(paths.account);
}

/** The API host a given account's token must be sent to. */
export const hostFor = (account: Account) => HOST_FOR[account.mode];

/** Never let the access token itself reach the browser. */
export function publicAccount(account: Account | null): Omit<Account, "accessToken"> | null {
  if (!account) return null;
  const { accessToken: _token, ...safe } = account;
  return safe;
}

/** Maps any thrown error to an HTTP status + user-facing message. */
export function describeError(err: unknown): { status: number; message: string } {
  if (err instanceof NoAccountError) return { status: 401, message: err.message };
  if (err instanceof GraphError) {
    if (err.rateLimited) {
      return {
        status: 429,
        message: `Достигнут лимит запросов Instagram API: ${err.message}. Подождите час и повторите.`,
      };
    }
    // 190 = invalid/expired token.
    if (err.code === 190) {
      return { status: 401, message: `Маркер доступа недействителен или истёк: ${err.message}` };
    }
    // 10 / 200 = the app was never granted the permission this call needs.
    if (err.code === 10 || err.code === 200) {
      return {
        status: 403,
        message:
          `Не хватает разрешения: ${err.message}. ` +
          "Проверьте «Разрешения и функции» в приложении — для статистики нужен " +
          "instagram_business_manage_insights, для комментариев — instagram_business_manage_comments. " +
          "После добавления разрешения маркер доступа нужно сгенерировать заново.",
      };
    }
    return { status: err.status >= 400 ? err.status : 502, message: err.message };
  }
  return { status: 500, message: err instanceof Error ? err.message : String(err) };
}
