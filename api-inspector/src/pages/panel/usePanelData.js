// Live list of calls for one tab, from the background (with reconnect).
import { useEffect, useRef, useState } from 'react';

export function usePanelData(tabId) {
  const [calls, setCalls] = useState(() => new Map());
  const [paused, setPaused] = useState([]);
  const [tabState, setTabState] = useState({ preserve: false, debugger: false, hits: 0 });
  const [connected, setConnected] = useState(false);
  const [pageUrl, setPageUrl] = useState('');
  const pending = useRef([]);
  const frame = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(tabId)) return undefined;
    let port = null;
    let closed = false;
    let timer = null;

    // Many updates come in at once; apply them in small batches.
    // (setTimeout, not requestAnimationFrame: rAF stops when the panel is hidden.)
    const flush = () => {
      frame.current = 0;
      const list = pending.current;
      pending.current = [];
      setCalls((prev) => {
        const next = new Map(prev);
        for (const c of list) next.set(c.id, c);
        return next;
      });
    };

    const onMsg = (m) => {
      switch (m.type) {
        case 'init':
          pending.current = [];
          setCalls(new Map(m.calls.map((c) => [c.id, c])));
          setPaused(m.paused || []);
          setTabState({ preserve: m.preserve, debugger: m.debugger, hits: m.hits });
          if (m.url) setPageUrl(m.url);
          setConnected(true);
          break;
        case 'call':
          pending.current.push(m.call);
          if (!frame.current) frame.current = setTimeout(flush, 30);
          break;
        case 'cleared':
          pending.current = m.before == null ? [] : pending.current.filter((c) => (c.start ?? 0) >= m.before);
          setCalls((prev) => (m.before == null ? new Map() : new Map([...prev].filter(([, c]) => (c.start ?? 0) >= m.before))));
          break;
        case 'nav':
          setPageUrl(m.url || '');
          break;
        case 'paused':
          setPaused(m.list || []);
          break;
        case 'state':
          setTabState({ preserve: m.preserve, debugger: m.debugger, hits: m.hits });
          break;
      }
    };

    const connect = () => {
      port = chrome.runtime.connect({ name: 'panel' });
      port.onMessage.addListener(onMsg);
      port.onDisconnect.addListener(() => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 300);
      });
      port.postMessage({ type: 'subscribe', tabId });
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      if (frame.current) clearTimeout(frame.current);
      try { port?.disconnect(); } catch {}
    };
  }, [tabId]);

  return { calls, paused, tabState, setTabState, connected, pageUrl };
}
