# Putting SafeHer online (so phones can install it and use it offline)

Double-clicking `index.html` is fine for testing. Phones only offer "Install app" and offline mode when the app is served over https.

The production deployment is hosted on Vercel:

<https://safeher-five.vercel.app>

The exact Vercel project is named `safeher`; Vercel assigns its public hostname
as `safeher-five`. A second deployment is also available at
<https://safeher-2602.vercel.app>. Both projects are connected to the `main`
branch of the GitHub repository, so new pushes are deployed automatically. Open the link on a phone and use the
browser menu > "Install app" (or "Add to Home screen").

After you change any file, rename `V` in `sw.js` (for example `safeher-v3`) so phones pick up the update.
