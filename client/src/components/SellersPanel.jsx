import { useState } from 'react';
import { api } from '../lib/api.js';

export default function SellersPanel({ sellers, onChanged }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      await api.addSeller(name.trim());
      setName('');
      setMessage('Vendedor agregado.');
      await onChanged();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Vendedores</h2>
      <p className="panel-sub">Los vendedores nuevos quedan disponibles al registrar ventas.</p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {sellers.map((s) => (
          <li
            key={s.id}
            style={{
              padding: '0.65rem 0',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.5rem',
            }}
          >
            <span>{s.name}</span>
            <span className="badge">{s.active === false ? 'Inactivo' : 'Activo'}</span>
          </li>
        ))}
      </ul>

      <form className="toolbar" onSubmit={submit}>
        <input
          type="text"
          placeholder="Nombre del vendedor"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Guardando…' : 'Agregar'}
        </button>
      </form>
      {message ? <p className="muted">{message}</p> : null}
    </section>
  );
}
