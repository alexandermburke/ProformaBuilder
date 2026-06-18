// Per-browser preferences for the Daily Flash workflow. These are convenience
// settings (not server behavior), so they live in localStorage rather than the
// shared Firestore flashSettings doc.

export const AUTO_DOWNLOAD_PPTX_KEY = "flash.autoDownloadPptx";

// Default ON preserves the historical behavior: generating a manual flash also
// downloads the .pptx to the browser.
const DEFAULT_AUTO_DOWNLOAD = true;

export function getAutoDownloadPptx(): boolean {
  if (typeof window === "undefined") return DEFAULT_AUTO_DOWNLOAD;
  try {
    const value = window.localStorage.getItem(AUTO_DOWNLOAD_PPTX_KEY);
    if (value === null) return DEFAULT_AUTO_DOWNLOAD;
    return value === "true";
  } catch {
    return DEFAULT_AUTO_DOWNLOAD;
  }
}

export function setAutoDownloadPptx(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTO_DOWNLOAD_PPTX_KEY, value ? "true" : "false");
  } catch {
    // localStorage may be unavailable (private mode, etc.); ignore.
  }
}
