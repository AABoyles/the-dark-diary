// PWA glue: service worker registration, storage persistence and install prompt.
// Every step is best effort and fails silently.

let deferredPrompt = null;
let registration = null;

function announce(installable) {
  try {
    window.dispatchEvent(new CustomEvent('pwa-installable', { detail: { installable } }));
  } catch (err) {
    // Ignore: event dispatch is best effort.
  }
}

// Capture the install prompt as early as possible. This runs on module
// load so the event is not missed if registerPWA() is called later.
try {
  window.addEventListener('beforeinstallprompt', (event) => {
    try {
      event.preventDefault();
      deferredPrompt = event;
      announce(true);
    } catch (err) {
      // Ignore.
    }
  });
} catch (err) {
  // Ignore: no window (e.g. non-browser import).
}

export function canInstall() {
  return deferredPrompt !== null;
}

export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const prompt = deferredPrompt;
  deferredPrompt = null;
  announce(false);
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome ?? 'unknown';
  } catch (err) {
    return 'error';
  }
}

export async function registerPWA() {
  try {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;

    registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), {
      scope: new URL('../', import.meta.url).href,
    });
  } catch (err) {
    return null;
  }

  try {
    await navigator.storage?.persist?.();
  } catch (err) {
    // Best effort: the browser may refuse, which is fine.
  }

  return registration;
}
