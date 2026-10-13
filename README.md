<<<<<<< HEAD
# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Real-time updates

The local backend starts an authenticated Socket.IO endpoint on port `5000`; the frontend connects automatically during development. For production, set the frontend build variable `VITE_REALTIME_URL` to the origin of a persistent Node.js backend running `backend/server.js` (for example, `https://realtime-api.example.com`). Keep `VITE_API_BASE_URL` configured separately for normal HTTP requests.

Vercel serverless functions do not keep a Socket.IO server alive between requests. If the HTTP API remains on Vercel, host the same backend as a persistent Node service for real-time delivery and point `VITE_REALTIME_URL` to that service. When no socket URL is configured or the socket disconnects, active pages reconcile through the authorized APIs every 10 seconds and when the page regains focus.
=======
# Acgc-projects
>>>>>>> ae078127d196c26e1bf437fba173d916aa9076fd
