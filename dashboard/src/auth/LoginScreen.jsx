import { useState } from "react";
import { signIn, completeNewPassword } from "./cognito.js";

// Traduce los errores típicos de Cognito a mensajes en español.
function friendlyError(err) {
  const code = err?.code || err?.name || "";
  switch (code) {
    case "NotAuthorizedException":
      return "Usuario o contraseña incorrectos.";
    case "UserNotFoundException":
      return "El usuario no existe.";
    case "UserNotConfirmedException":
      return "La cuenta aún no está confirmada. Contacta al administrador.";
    case "PasswordResetRequiredException":
      return "Debes restablecer tu contraseña. Contacta al administrador.";
    case "InvalidPasswordException":
      return "La contraseña no cumple con la política de seguridad.";
    case "TooManyRequestsException":
    case "LimitExceededException":
      return "Demasiados intentos. Espera un momento e intenta de nuevo.";
    default:
      return err?.message || "No se pudo iniciar sesión. Intenta de nuevo.";
  }
}

export default function LoginScreen({ onAuthenticated }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stage, setStage] = useState("login"); // "login" | "newPassword"
  const [pendingUser, setPendingUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn(username.trim(), password);
      if (result.newPasswordRequired) {
        setPendingUser(result.cognitoUser);
        setStage("newPassword");
        setLoading(false);
        return;
      }
      onAuthenticated();
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function handleNewPassword(e) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await completeNewPassword(pendingUser, newPassword);
      onAuthenticated();
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card fade-in-up">
        <div className="login-card__head">
          <img src="./utp-logo.svg" alt="UTP" className="login-card__logo" />
          <div className="login-card__title">AWS Operaciones &amp; DevOps</div>
          <div className="login-card__subtitle">
            Acceso interno
          </div>
        </div>

        {stage === "login" ? (
          <form className="login-form" onSubmit={handleLogin}>
            <label className="login-field">
              <span className="login-field__label">Usuario o correo</span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="login-field__input"
                placeholder="usuario@utp.edu.pe"
              />
            </label>

            <label className="login-field">
              <span className="login-field__label">Contraseña</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="login-field__input"
                placeholder="••••••••"
              />
            </label>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Ingresando…" : "Iniciar sesión"}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleNewPassword}>
            <div className="login-hint">
              Es tu primer ingreso. Define una contraseña nueva para continuar.
            </div>

            <label className="login-field">
              <span className="login-field__label">Nueva contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                autoFocus
                className="login-field__input"
                placeholder="••••••••"
              />
            </label>

            <label className="login-field">
              <span className="login-field__label">Confirmar contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="login-field__input"
                placeholder="••••••••"
              />
            </label>

            {error && <div className="login-error">{error}</div>}

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Guardando…" : "Guardar y entrar"}
            </button>
          </form>
        )}

        <div className="login-footer"></div>
      </div>
    </div>
  );
}
