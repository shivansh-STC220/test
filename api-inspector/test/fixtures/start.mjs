// Start the test site by hand: npm run test-site
import { APP, LOCAL, STORE, startServers } from './servers.mjs';

await startServers();
console.log(`Store (Dawn-like):  ${STORE}/`);
console.log(`Admin + React app:  ${STORE}/admin  (app: ${APP}/)`);
console.log(`Local server:       ${LOCAL}/`);
console.log('Press Ctrl+C to stop.');
