# API Inspector (Chrome extension)

See which API each button calls, find where an API is used in the code, and change or fake requests (like Requestly).
It is for your own computer only. All data stays in your browser.

## Install

```bash
cd api-inspector
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `api-inspector/dist` folder.
3. One-time setup: on the API Inspector card, click **Details** and turn on **Allow User Scripts**.
   This is needed for Insert script, and for JS code in rules on pages with a strict CSP.

After a code change, run `npm run build` again and click the reload icon on the extension card.
`npm run watch` rebuilds by itself.

## Use it

- **DevTools → "API Inspector"** (it may be under the `»` menu). Four views:
  - **Calls**: every fetch / XHR / sendBeacon call. Click a row to see the details. The button you clicked gets an outline on the page.
    The **Initiator** tab shows the button, the React component chain, the Liquid section / app block, and the file and line.
    Buttons: **Preserve log**, **Clear**, **Export JSON**, **Debugger mode**.
  - **APIs**: how many APIs the site uses, grouped by endpoint (`/products/7` and `/products/8` are one API), with filters.
    Run **Scan source** to also count APIs that are in the code but were not called yet.
  - **Search**: type an endpoint to see every call to it. **Scan source** finds the text in the page's JS files, with file and line.
  - **API client**: send any request by hand, from the extension (no CORS limits) or from the page (uses its cookies).
- **Popup** (toolbar icon): turn all rules, groups or this site's rules on and off. The badge shows how many rule hits this tab had.
  "Open inspector in a tab" opens the same screen as DevTools, in a normal tab.
- **Rules page** (popup → Rules page): create, edit, group, import and export rules.

## What is in it

| ID | Feature | Where |
| --- | --- | --- |
| A1–A3 | Capture every call, all frames, button → API | Calls view |
| A4–A7 | React chain, Liquid section / block, file and line, button text and CSS path | Calls → Initiator |
| A8, A9 | Search by endpoint, scan source | Search view |
| A10 | Highlight the button | Click a row |
| new | Count the APIs a site uses, with filters | APIs view |
| B1–B7 | Redirect, replace, query params, headers, block, user agent, map remote | Chrome network rules |
| B8–B12 | Request body, response edit, response mock, delay, pause & edit | Page script (fetch / XHR) |
| B13 | Insert script / CSS | User scripts (falls back to a plain `<script>` / `insertCSS`) |
| B14 | Map local | Network rule (data: URL) for files, page script for fetch / XHR |
| O1–O6 | Matching, on/off, groups, per site, import/export, rule log | Rules page, Calls view |
| C1–C3 | Replay, API client, debugger mode | Calls detail, API client view, toolbar |
| D1–D3 | Popup, rules page, DevTools tab | |

## Limits

- On production builds, React component names are scrambled (like `t` or `Xe`). It works best on your dev build.
- Only calls made by the browser page show up. Server calls, webhooks, and calls from Web Workers do not.
- Live capture only sees what you trigger. Scan source fills part of that gap.
- On live stores, edited, replayed and API-client calls are **real**. They can change real carts or orders.
- Chrome may block or ask before a live site loads from `localhost` (Map remote). Test it early.
- Debugger mode shows Chrome's yellow "being debugged" bar, and it slows page loads a little.
- Without "Allow User Scripts", Insert script JS only runs on pages that allow inline scripts, and JS code in rules only runs on pages that allow `eval`.
- Request and response bodies are saved up to 1 MB each.
- A redirect rule whose new URL matches the same rule again would loop forever. The rules page refuses the clear cases,
  and if it still happens, the extension turns that rule off by itself and shows why.

## Tests

```bash
npm test             # unit + end-to-end (builds first)
npm run test:unit
npm run test:e2e
```

End-to-end tests start Chromium with the built extension (Playwright), and a fake test site:
a Dawn-like storefront (sections, app block, `/cart/add` form), an admin page with a React app in a
cross-site iframe (Vite dev server), and a "localhost" server for Map remote.
The first time, get the test browser with `npx playwright install chromium`.
The DevTools test needs a screen; on Linux without one, run `xvfb-run -a npm test`.

To try the test site by hand: `npm run test-site`, then open http://localhost:4100/ and http://localhost:4100/admin.

## Folders

```
src/inject      page script: wraps fetch / XHR / sendBeacon, clicks, React / Liquid info, page rules
src/content     bridge between the page script and the extension
src/background  call storage (IndexedDB), network rules, user scripts, debugger mode, scan, replay
src/pages       screens: panel (DevTools), popup, rules, pause window
src/shared      rule model, network rule conversion, filters, API grouping, source scan
test            unit tests, end-to-end tests, test site
```
