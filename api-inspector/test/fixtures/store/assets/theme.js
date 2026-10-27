// Dawn-like theme script.
(function () {
  function show(data) {
    document.getElementById('result').textContent = JSON.stringify(data);
  }

  document.getElementById('ajax-add').addEventListener('click', async function () {
    const res = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 40123, quantity: 1 }) });
    const data = await res.json();
    window.__lastAdd = data;
    show(data);
  });

  document.getElementById('cart-icon').addEventListener('click', function () {
    fetch('/cart.js').then(function (r) { return r.json(); }).then(function (d) { window.__cart = d; show(d); });
  });

  document.getElementById('xhr-cart').addEventListener('click', function () {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/cart.js?via=xhr');
    xhr.onload = function () { window.__xhrCart = { status: xhr.status, text: xhr.responseText }; };
    xhr.onerror = function () { window.__xhrCart = { error: true }; };
    xhr.send();
  });

  document.getElementById('beacon-btn').addEventListener('click', function () {
    window.__beacon = navigator.sendBeacon('/api/echo?beacon=1', JSON.stringify({ event: 'click' }));
  });

  document.getElementById('big-btn').addEventListener('click', function () {
    fetch('/api/big').then(function (r) { return r.text(); }).then(function (t) { window.__bigLength = t.length; });
  });

  document.getElementById('status-btn').addEventListener('click', function () {
    fetch('/api/status/500').then(function (r) { window.__status = r.status; });
  });

  document.getElementById('echo-btn').addEventListener('click', function () {
    fetch('/api/echo?a=1&b=2', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test': 'yes' }, body: JSON.stringify({ hello: 'world' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { window.__echo = d; show(d); });
  });

  ['7', '8'].forEach(function (id) {
    document.getElementById('product-btn-' + id).addEventListener('click', function () {
      fetch('/api/products/' + id).then(function (r) { return r.json(); });
    });
  });

  // Not called by any button. Only "Scan source" can find it.
  window.__unused = function () {
    return fetch('/api/never-called');
  };
})();
