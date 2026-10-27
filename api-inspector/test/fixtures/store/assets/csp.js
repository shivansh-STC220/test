document.getElementById('csp-btn').addEventListener('click', function () {
  fetch('/api/echo?csp=1', { method: 'POST', body: 'original' })
    .then(function (r) { return r.json(); })
    .then(function (d) { window.__cspEcho = d; document.getElementById('csp-out').textContent = JSON.stringify(d); });
});
