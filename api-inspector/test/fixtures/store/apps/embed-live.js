// App embed script (theme app extension), "live" build.
window.__embedVersion = 'live';
fetch('/apps/stock/api/config').then(function (r) { return r.json(); }).then(function (c) { window.__stockConfig = c; });
document.getElementById('notify-btn').addEventListener('click', function () {
  fetch('/apps/stock/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c' }) })
    .then(function (r) { return r.json(); })
    .then(function (d) { window.__notify = d; });
});
