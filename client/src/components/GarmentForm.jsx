import { useEffect, useState } from 'react';
import { suggestPricesFromTienda } from '../lib/format.js';

const GENEROS = ['Niña', 'Niño/Unisex', 'Accesorios'];

const empty = () => ({
  referencia: '',
  referencia_ag: '',
  descripcion: '',
  tallas: '',
  genero: 'Niña',
  stock: 0,
  precio_tienda: '',
  precio_mayorista: '',
  precio_consignacion: '',
  autoMayorista: true,
  autoConsignacion: true,
});

export default function GarmentForm({ initial = null, onSubmit, onCancel, busy }) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          ...empty(),
          ...initial,
          precio_tienda: initial.precio_tienda ?? '',
          precio_mayorista: initial.precio_mayorista ?? '',
          precio_consignacion: initial.precio_consignacion ?? '',
          autoMayorista: false,
          autoConsignacion: false,
        }
      : empty()
  );

  useEffect(() => {
    if (!initial) return;
    setForm({
      ...empty(),
      ...initial,
      precio_tienda: initial.precio_tienda ?? '',
      precio_mayorista: initial.precio_mayorista ?? '',
      precio_consignacion: initial.precio_consignacion ?? '',
      autoMayorista: false,
      autoConsignacion: false,
    });
  }, [initial]);

  function setTienda(value) {
    setForm((f) => {
      const next = { ...f, precio_tienda: value };
      const suggested = suggestPricesFromTienda(value);
      if (f.autoMayorista) next.precio_mayorista = suggested.precio_mayorista;
      if (f.autoConsignacion) next.precio_consignacion = suggested.precio_consignacion;
      return next;
    });
  }

  function submit(e) {
    e.preventDefault();
    onSubmit?.({
      referencia: form.referencia.trim().toUpperCase(),
      referencia_ag: form.referencia_ag.trim(),
      descripcion: form.descripcion.trim(),
      tallas: form.tallas.trim(),
      genero: form.genero,
      stock: Number(form.stock || 0),
      precio_tienda: Number(form.precio_tienda || 0),
      precio_mayorista: Number(form.precio_mayorista || 0),
      precio_consignacion: Number(form.precio_consignacion || 0),
    });
  }

  const editing = Boolean(initial?.id);

  return (
    <form className="garment-form" onSubmit={submit}>
      <div className="garment-form-head">
        <h3>{editing ? 'Editar prenda' : 'Agregar prenda'}</h3>
        <p className="muted">
          Tres precios: Tienda (sugerido), Mayorista (30% off) y Consignación (15% off).
          Al cambiar Tienda se recalculan los otros; puedes sobrescribirlos.
        </p>
      </div>

      <div className="form-grid">
        <div className="field">
          <label>Referencia</label>
          <input
            value={form.referencia}
            onChange={(e) => setForm({ ...form, referencia: e.target.value })}
            placeholder="Ej. S17162"
            required
            disabled={editing}
          />
        </div>
        <div className="field">
          <label>Nombre AG</label>
          <input
            value={form.referencia_ag}
            onChange={(e) => setForm({ ...form, referencia_ag: e.target.value })}
            placeholder="Nombre American Grace"
            required
          />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Descripción</label>
          <textarea
            value={form.descripcion}
            onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
            placeholder="Detalle de la prenda"
          />
        </div>
        <div className="field">
          <label>Tallas</label>
          <input
            value={form.tallas}
            onChange={(e) => setForm({ ...form, tallas: e.target.value })}
            placeholder="2, 4, 6…"
          />
        </div>
        <div className="field">
          <label>Categoría / género</label>
          <select
            value={form.genero}
            onChange={(e) => setForm({ ...form, genero: e.target.value })}
          >
            {GENEROS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Stock</label>
          <input
            type="number"
            min="0"
            value={form.stock}
            onChange={(e) => setForm({ ...form, stock: e.target.value })}
          />
        </div>
      </div>

      <div className="price-explain">
        <div className="price-card">
          <label>Tienda</label>
          <p className="hint">Precio sugerido en tienda</p>
          <input
            type="number"
            min="0"
            step="1"
            value={form.precio_tienda}
            onChange={(e) => setTienda(e.target.value)}
            required
          />
        </div>
        <div className="price-card">
          <label>Mayorista</label>
          <p className="hint">30% off (compra al por mayor)</p>
          <input
            type="number"
            min="0"
            step="1"
            value={form.precio_mayorista}
            onChange={(e) =>
              setForm({
                ...form,
                precio_mayorista: e.target.value,
                autoMayorista: false,
              })
            }
          />
          {!form.autoMayorista ? (
            <button
              type="button"
              className="linkish"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  autoMayorista: true,
                  precio_mayorista: suggestPricesFromTienda(f.precio_tienda).precio_mayorista,
                }))
              }
            >
              Volver a auto (70%)
            </button>
          ) : (
            <span className="auto-tag">Auto desde tienda</span>
          )}
        </div>
        <div className="price-card">
          <label>Consignación</label>
          <p className="hint">15% off (exhibición en otra tienda)</p>
          <input
            type="number"
            min="0"
            step="1"
            value={form.precio_consignacion}
            onChange={(e) =>
              setForm({
                ...form,
                precio_consignacion: e.target.value,
                autoConsignacion: false,
              })
            }
          />
          {!form.autoConsignacion ? (
            <button
              type="button"
              className="linkish"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  autoConsignacion: true,
                  precio_consignacion: suggestPricesFromTienda(f.precio_tienda)
                    .precio_consignacion,
                }))
              }
            >
              Volver a auto (85%)
            </button>
          ) : (
            <span className="auto-tag">Auto desde tienda</span>
          )}
        </div>
      </div>

      <div className="toolbar">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear prenda'}
        </button>
        {onCancel ? (
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
