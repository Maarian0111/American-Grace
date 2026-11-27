import { useState } from 'react';
import { api } from '../lib/api.js';

export default function LoginGate({ userRequired, softLock, setupRequired, onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (setupRequired) return;
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

  if (setupRequired) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="login-brand">American Grace</p>
          <h1>Falta configurar el acceso</h1>
          <p className="muted">
            En Render no hay <strong>APP_PASSWORD</strong>. Sin esa variable el inicio de sesión no
            puede abrirse de forma segura.
          </p>
          <ol className="setup-steps">
            <li>Abre el servicio en el dashboard de Render.</li>
            <li>
              <strong>Environment</strong> → <strong>Add Environment Variable</strong>.
            </li>
            <li>
              Name: <code>APP_PASSWORD</code> · Value: una clave fuerte (no la compartas en chat).
            </li>
            <li>
              Opcional: <code>APP_USER</code> y <code>SESSION_SECRET</code>.
            </li>
            <li>
              <strong>Save</strong> y espera el redeploy (o Manual Deploy).
            </li>
            <li>Vuelve a esta página e inicia sesión con esa clave.</li>
          </ol>
          {error ? <p className="login-error">{error}</p> : null}
        </div>
      </div>
    );
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
