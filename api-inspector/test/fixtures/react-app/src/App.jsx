import { useState } from 'react';

function SaveButton({ onSave }) {
  return (
    <button id="save-btn" onClick={onSave}>
      Save
    </button>
  );
}

function SettingsPage() {
  const [result, setResult] = useState('');
  const save = async () => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    setResult(JSON.stringify(await res.json()));
  };
  return (
    <section>
      <h2>Settings</h2>
      <SaveButton onSave={save} />
      <pre id="save-result">{result}</pre>
    </section>
  );
}

function CheckoutButton() {
  const [out, setOut] = useState('');
  const load = () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/cart-items?page=1');
    xhr.responseType = 'json';
    xhr.onload = () => setOut(`${xhr.status} ${JSON.stringify(xhr.response)}`);
    xhr.onerror = () => setOut('error');
    xhr.send();
  };
  return (
    <>
      <button id="checkout-btn" onClick={load}>
        Checkout
      </button>
      <pre id="checkout-result">{out}</pre>
    </>
  );
}

function CartDrawer() {
  return (
    <aside>
      <h2>Cart</h2>
      <CheckoutButton />
    </aside>
  );
}

export default function App() {
  return (
    <main>
      <SettingsPage />
      <CartDrawer />
    </main>
  );
}
