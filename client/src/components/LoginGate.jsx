import { useState } from 'react';
import { api } from '../lib/api.js';

export default function LoginGate({ userRequired, softLock, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api.login({
        username: userRequired ? username : undefined,
        password,
      });
      onSuccess?.(data);
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <p className="login-brand">American Grace</p>
        <h1>Acceso recepción</h1>
        <p className="muted">
          {softLock
            ? 'Modo local sin APP_PASSWORD: usa la clave de desarrollo documentada en README.'
            : 'Ingresa la clave del servidor para registrar cambios.'}
        </p>
        {userRequired ? (
          <div className="field">
            <label htmlFor="ag-user">Usuario</label>
            <input
              id="ag-user"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="ag-pass">Contraseña</label>
          <input
            id="ag-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error ? <p className="login-error">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
