// The sites whose posts Triplet can save. The server checks the same thing (link_parser.py);
// checking here too means a wrong link gets a clear message before anything is sent.
const VIDEO_SITES = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be'];

export const UNSUPPORTED_LINK = 'Only TikTok, Instagram and YouTube links can be saved.';

/**
 * Whether a link is a plain web link to a TikTok, Instagram or YouTube post. Look-alikes
 * ("tiktok.com.example.net"), a login in the link ("tiktok.com@example.net") and unusual ports
 * are refused, since they hide where the link really goes.
 */
export function isSupportedLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return VIDEO_SITES.some((site) => host === site || host.endsWith(`.${site}`));
}
