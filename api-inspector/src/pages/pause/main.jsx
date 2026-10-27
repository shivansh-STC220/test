// Small window that opens when a call is paused and DevTools is not open.
import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, EmptyState, queryParam } from '../../ui/components.jsx';
import { Logo } from '../../ui/icons.jsx';
import { usePanelData } from '../panel/usePanelData.js';
import PausedList from '../panel/PausedList.jsx';

function PauseWindow({ tabId }) {
  const { paused } = usePanelData(tabId);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2">
        <Logo size={18} />
        <span className="font-semibold">Paused calls</span>
        <span className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">{paused.length}</span>
      </div>
      {paused.length ? <PausedList paused={paused} tabId={tabId} /> : <EmptyState icon="check" title="No paused calls">You can close this window.</EmptyState>}
    </div>
  );
}

applyTheme();
createRoot(document.getElementById('root')).render(<PauseWindow tabId={Number(queryParam('tabId'))} />);
