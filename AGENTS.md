# Project Instructions

This is a React/Vite controller app packaged for Android with Capacitor. Keep
the controller interface and local button configuration intact; do not add
account, backend, or network requirements.

## Key Files

- `src/`: React application and controller UI.
- `src/pages/Home.jsx`: main controller and local button storage.
- `vite.config.js`: Vite and React setup.
- `capacitor.config.json`: Capacitor app ID, name, and web asset directory.
- `android/`: generated native Android project.

## Working Notes

- Use `npm run dev` for web development.
- Run `npm run lint` and `npm run build` for relevant checks.
- After frontend changes, run `npm run build` and `npm run android:sync`.
- Keep local-only environment values out of source control.
