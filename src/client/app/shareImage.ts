import { copyText } from './copyText';

export interface NativeImageShareData {
  title: string;
  files: File[];
}

export interface ImageClipboard {
  write?: (items: ClipboardItem[]) => Promise<void>;
}

export interface NativeShareNavigator {
  share?: (data: NativeImageShareData) => Promise<void>;
  canShare?: (data: { files: File[] }) => boolean;
  clipboard?: ImageClipboard;
}

export interface ShareImageEnvironment {
  navigator?: NativeShareNavigator;
  ClipboardItem?: ClipboardItemConstructor;
}

type ClipboardItemConstructor = new (items: Record<string, Blob | PromiseLike<Blob>>) => ClipboardItem;

export type ShareImageResult =
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'image-copied' }
  | { status: 'text-copied' }
  | { status: 'unavailable' };

/**
 * Share a pre-rendered image without putting a capability URL in native share
 * data. Every unsupported path resolves to a user-visible fallback outcome.
 */
export async function shareImageFile(
  file: File,
  shareText: string,
  environment: ShareImageEnvironment = getBrowserEnvironment(),
): Promise<ShareImageResult> {
  const shareNavigator = environment.navigator;
  const files = [file];

  if (typeof shareNavigator?.share !== 'function') {
    return fallback(file, shareText, environment);
  }

  if (typeof shareNavigator.canShare === 'function') {
    try {
      if (!shareNavigator.canShare({ files })) return fallback(file, shareText, environment);
    } catch {
      return fallback(file, shareText, environment);
    }
  }

  try {
    await shareNavigator.share({ title: '绷绷炸弹', files });
    return { status: 'shared' };
  } catch (reason) {
    if (isAbortError(reason)) return { status: 'cancelled' };
    return fallback(file, shareText, environment);
  }
}

async function fallback(file: File, shareText: string, environment: ShareImageEnvironment): Promise<ShareImageResult> {
  if (await tryCopyImage(file, environment)) return { status: 'image-copied' };
  try {
    await copyText(shareText);
    return { status: 'text-copied' };
  } catch {
    return { status: 'unavailable' };
  }
}

async function tryCopyImage(file: File, environment: ShareImageEnvironment): Promise<boolean> {
  const clipboard = environment.navigator?.clipboard;
  const ClipboardItemCtor = environment.ClipboardItem ?? getClipboardItemConstructor();
  if (typeof clipboard?.write !== 'function' || !ClipboardItemCtor) return false;

  try {
    const mimeType = file.type || 'image/png';
    const item = new ClipboardItemCtor({ [mimeType]: file });
    await clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}

function getBrowserEnvironment(): ShareImageEnvironment {
  return {
    navigator: typeof navigator === 'undefined' ? undefined : navigator as unknown as NativeShareNavigator,
    ClipboardItem: typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
  };
}

function getClipboardItemConstructor(): ClipboardItemConstructor | undefined {
  return typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem;
}

function isAbortError(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'AbortError';
}
