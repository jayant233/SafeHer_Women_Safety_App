# Putting SafeHer online (so phones can install it and use it offline)

Double-clicking `index.html` is fine for testing. Phones only offer "Install app" and offline mode when the app is served over https.

Easiest free way, GitHub Pages:
1. Upload all the project files to your GitHub repository.
2. Repository Settings > Pages > Deploy from a branch > `main` / root > Save.
3. Open the link GitHub gives you on your phone, then use the browser menu > "Install app" (or "Add to Home screen").

After you change any file, rename `V` in `sw.js` (for example `safeher-v3`) so phones pick up the update.
