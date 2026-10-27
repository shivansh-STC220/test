// Small window that opens when a call is paused and DevTools is not open.
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, queryParam } from '../../ui/components.jsx';
import { usePanelData } from '../panel/usePanelData.js';
import PausedList from '../panel/PausedList.jsx';

function PauseWindow({ tabId }) {
  const { paused } = usePanelData(tabId);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 px-3 py-2 font-semibold dark:border-zinc-700">Paused calls ({paused.length})</div>
      {paused.length ? <PausedList paused={paused} tabId={tabId} /> : <div className="p-4 text-slate-400">No paused calls. You can close this window.</div>}
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<PauseWindow tabId={Number(queryParam('tabId'))} />);
