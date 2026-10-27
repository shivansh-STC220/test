import { createRoot } from 'react-dom/client';
import '../../ui/styles.css';
import { applyTheme, queryParam } from '../../ui/components.jsx';
import Panel from './Panel.jsx';

applyTheme();
// Inside DevTools we know the tab. Opened as a normal tab, it comes from ?tabId=.
const tabId = chrome.devtools?.inspectedWindow ? chrome.devtools.inspectedWindow.tabId : Number(queryParam('tabId'));
createRoot(document.getElementById('root')).render(<Panel tabId={tabId} />);
