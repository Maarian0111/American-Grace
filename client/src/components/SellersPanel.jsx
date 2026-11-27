import { useState } from 'react';
import { api } from '../lib/api.js';

export default function SellersPanel({ sellers, onChanged }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');

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

  function startEdit(seller) {
    setEditingId(seller.id);
    setEditName(seller.name);
    setMessage('');
  }

  async function saveEdit(seller) {
    const next = editName.trim();
    if (!next) {
      setMessage('El nombre no puede quedar vacío.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.updateSeller(seller.id, { name: next });
      setEditingId(null);
      setMessage('Vendedor actualizado.');
      await onChanged();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(seller) {
    setBusy(true);
    setMessage('');
    try {
      await api.updateSeller(seller.id, { active: seller.active === false });
      setMessage(
        seller.active === false
          ? `${seller.name} reactivado.`
          : `${seller.name} marcado inactivo.`
      );
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
      <p className="panel-sub">
        Alta, edición de nombre y activar / desactivar. Los inactivos no aparecen al registrar ventas.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
        {sellers.map((s) => (
          <li
            key={s.id}
            style={{
              padding: '0.65rem 0',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {editingId === s.id ? (
              <div className="toolbar" style={{ margin: 0, flex: '1 1 220px' }}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={`Editar nombre de ${s.name}`}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => saveEdit(s)}
                >
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setEditingId(null)}
                  disabled={busy}
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <span>
                {s.name}{' '}
                <span className={`badge ${s.active === false ? 'warn' : 'ok'}`}>
                  {s.active === false ? 'Inactivo' : 'Activo'}
                </span>
              </span>
            )}
            {editingId === s.id ? null : (
              <span style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => startEdit(s)}
                  disabled={busy}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => toggleActive(s)}
                  disabled={busy}
                >
                  {s.active === false ? 'Activar' : 'Desactivar'}
                </button>
              </span>
            )}
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
