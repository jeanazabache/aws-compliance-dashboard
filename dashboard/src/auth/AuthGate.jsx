import { useState, useEffect, useCallback } from "react";
import { getCurrentSession, isAuthConfigured } from "./cognito.js";
import LoginScreen from "./LoginScreen.jsx";

/**
 * Compuerta de autenticación. Decide qué renderizar:
 *  - Mientras valida la sesión guardada: un loader.
 *  - Sin sesión válida: la pantalla de login.
 *  - Con sesión válida: el dashboard (children).
 *
 * Si el build no trae configuración de Cognito (isAuthConfigured = false),
 * deja pasar directo al dashboard para no romper entornos locales/dev.
 */
export default function AuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const check = useCallback(async () => {
    if (!isAuthConfigured) {
      setAuthenticated(true);
      setChecking(false);
      return;
    }
    const current = await getCurrentSession();
    setAuthenticated(Boolean(current));
    setChecking(false);
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  if (checking) {
    return (
      <div className="login-shell">
        <div className="login-card" style={{ textAlign: "center" }}>
          <div className="skeleton" style={{ height: 48, width: "60%", margin: "0 auto 16px" }} />
          <div className="skeleton" style={{ height: 16, width: "80%", margin: "0 auto" }} />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />;
  }

  return children;
}
