// App embed script, "local" build served from localhost (for Map remote).
window.__embedVersion = 'local';
fetch('/apps/stock/api/config').then(function (r) { return r.json(); }).then(function (c) { window.__stockConfig = c; });
