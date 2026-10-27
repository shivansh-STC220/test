// Shared state of the page script, and the link to the content script.
import { TO_CS } from '../shared/bridge.js';

const _dispatch = EventTarget.prototype.dispatchEvent;
const _stringify = JSON.stringify;

export const state = {
  rules: [],
  ready: false,
  lastClick: null,
};

let resolveReady;
export const readyPromise = new Promise((r) => { resolveReady = r; });

export function setRules(rules) {
  state.rules = Array.isArray(rules) ? rules : [];
  if (!state.ready) {
    state.ready = true;
    resolveReady();
  }
}

// Never hold the page's calls for long if the content script does not answer.
setTimeout(() => setRules(state.rules), 1500);

export function post(msg) {
  try {
    _dispatch.call(window, new CustomEvent(TO_CS, { detail: _stringify(msg) }));
  } catch {}
}

// Calls made within this time after a click are linked to the click.
const LINK_MS = 1500;

export function currentClick() {
  const c = state.lastClick;
  return c && Date.now() - c.time <= LINK_MS ? c : null;
}
