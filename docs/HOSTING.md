# Putting SafeHer online (so phones can install it and use it offline)

Double-clicking `index.html` is fine for testing. Phones only offer "Install app" and offline mode when the app is served over https.

The production deployment is hosted on Vercel:

<https://safeher-five.vercel.app>

The Vercel project is connected to the `main` branch of the GitHub repository, so
new pushes are deployed automatically. Open the link on a phone and use the
browser menu > "Install app" (or "Add to Home screen").

After you change any file, rename `V` in `sw.js` (for example `safeher-v3`) so phones pick up the update.

## Offline translation

In the app's **Translate > Offline** panel, choose a source and target language
and select **Download translation model** while online. Chrome downloads and
stores the supported language pair on the device; subsequent translations use
the on-device model without sending text over the network. This uses Chrome's
built-in Translator API and requires a recent Chrome release that supports the
selected language pair. The emergency phrasebook remains available in browsers
without this API.
