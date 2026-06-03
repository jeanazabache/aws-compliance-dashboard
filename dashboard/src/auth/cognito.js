// Configuración y helpers de Cognito para el login del dashboard.
//
// Los valores vienen de variables de entorno de Vite (prefijo VITE_) para no
// hardcodear los IDs del User Pool en el código fuente. Definirlos en un
// archivo .env (ver dashboard/.env.example) antes de `npm run build`.
//
// NOTA DE ALCANCE: este login solo protege la INTERFAZ del dashboard. Los
// archivos en reports/*.json siguen siendo accesibles por URL directa vía
// CloudFront. Es exactamente el comportamiento acordado: que la página no sea
// pública, sin proteger los JSON a nivel de red.

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID;
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;

// true cuando el bundle se construyó con los IDs necesarios.
export const isAuthConfigured = Boolean(USER_POOL_ID && CLIENT_ID);

const userPool = isAuthConfigured
  ? new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
  : null;

/**
 * Inicia sesión con usuario y contraseña contra el User Pool.
 * Resuelve con la sesión de Cognito o rechaza con un Error.
 *
 * Maneja el caso NEW_PASSWORD_REQUIRED (usuarios creados por el admin con
 * contraseña temporal): resuelve con { newPasswordRequired, cognitoUser }
 * para que la UI pida la contraseña definitiva.
 */
export function signIn(username, password) {
  return new Promise((resolve, reject) => {
    if (!userPool) {
      reject(new Error("Cognito no está configurado en este build."));
      return;
    }

    const cognitoUser = new CognitoUser({ Username: username, Pool: userPool });
    const authDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ session, cognitoUser }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        resolve({ newPasswordRequired: true, cognitoUser });
      },
    });
  });
}

/**
 * Completa el flujo NEW_PASSWORD_REQUIRED estableciendo la contraseña
 * definitiva para un usuario con contraseña temporal.
 */
export function completeNewPassword(cognitoUser, newPassword) {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(
      newPassword,
      {},
      {
        onSuccess: (session) => resolve(session),
        onFailure: (err) => reject(err),
      }
    );
  });
}

/**
 * Devuelve la sesión válida actual (si existe y no expiró), o null.
 * Cognito guarda los tokens en localStorage; aquí los validamos.
 */
export function getCurrentSession() {
  return new Promise((resolve) => {
    if (!userPool) {
      resolve(null);
      return;
    }
    const cognitoUser = userPool.getCurrentUser();
    if (!cognitoUser) {
      resolve(null);
      return;
    }
    cognitoUser.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve({ session, cognitoUser });
    });
  });
}

/** Cierra la sesión del usuario actual y limpia los tokens locales. */
export function signOut() {
  if (!userPool) return;
  const cognitoUser = userPool.getCurrentUser();
  if (cognitoUser) cognitoUser.signOut();
}

/** Email/username legible del usuario logueado, para mostrar en la topbar. */
export function getUsername() {
  if (!userPool) return null;
  const cognitoUser = userPool.getCurrentUser();
  return cognitoUser ? cognitoUser.getUsername() : null;
}
