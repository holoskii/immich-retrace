// Share a link from the phone: the system share sheet where there is one (Web Share API), else copy to the clipboard.
// Inside some in-app browsers neither works; the caller then shows the link to copy by hand.

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

type Nav = Partial<Pick<Navigator, 'share' | 'canShare'>> & {clipboard?: Pick<Clipboard, 'writeText'>};

export async function shareLink(url: string, title: string, nav: Nav = navigator): Promise<ShareResult> {
  const data = {title, url};
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      // The visitor closed the sheet: nothing more to do.
      if ((e as {name?: string})?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (no user activation left, a policy): fall back to the clipboard.
    }
  }
  try {
    if (!nav.clipboard?.writeText) return 'failed';
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
