import { chromium, webkit } from 'playwright';

export function launch(flags, launchOptions) {
  if (flags.ws) return chromium.connect(flags.ws);
  const options = { handleSIGINT: false, handleSIGTERM: false };
  return flags.browser === 'webkit' ? webkit.launch({ headless: flags.headed !== 'true', ...options })
    : chromium.launch({ ...launchOptions(flags), ...options });
}
