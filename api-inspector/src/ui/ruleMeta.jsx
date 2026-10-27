// Icon and color for each rule type, for the popup and the rules page.
import { RULE_TYPES } from '../shared/rules.js';
import { Icon } from './icons.jsx';

export const TYPE_ICONS = {
  redirect: 'redirect',
  replace: 'replace',
  query: 'sliders',
  headers: 'heading',
  block: 'ban',
  userAgent: 'phone',
  mapRemote: 'server',
  requestBody: 'filePen',
  responseEdit: 'wand',
  responseMock: 'flask',
  delay: 'clock',
  pause: 'pauseCircle',
  insertScript: 'code',
  mapLocal: 'folderDown',
};

// Network rules: indigo. Page rules: teal. Scripts and files: amber.
const TONES = {
  network: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300',
  page: 'bg-teal-500/12 text-teal-700 dark:text-teal-300',
  script: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  both: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
};

export const TYPE_GROUPS = [
  { id: 'network', title: 'Network rules', help: 'Chrome changes the request itself. Works for every kind of request.', types: ['redirect', 'replace', 'query', 'headers', 'block', 'userAgent', 'mapRemote'] },
  { id: 'page', title: 'Page rules', help: 'Work on fetch and XHR calls made by the page.', types: ['requestBody', 'responseEdit', 'responseMock', 'delay', 'pause'] },
  { id: 'script', title: 'Scripts and files', help: 'Add your code to a page, or serve a local file.', types: ['insertScript', 'mapLocal'] },
];

export function typeTone(type) {
  return TONES[RULE_TYPES[type]?.layer] || TONES.network;
}

export function TypeIcon({ type, size = 'md' }) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-md' : size === 'lg' ? 'h-9 w-9 rounded-lg' : 'h-8 w-8 rounded-lg';
  const icon = size === 'sm' ? 13 : size === 'lg' ? 18 : 16;
  return (
    <span className={`grid shrink-0 place-items-center ${box} ${typeTone(type)}`}>
      <Icon name={TYPE_ICONS[type]} size={icon} />
    </span>
  );
}
