'use client';
import { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, onIdTokenChanged, getIdTokenResult, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'; // Importar setDoc y serverTimestamp
import { useRouter } from 'next/navigation';
import { isAccountExpired, parseExpirationMs } from '@/lib/accountExpiration';

const AuthContext = createContext();
const SYNCED_TOKEN_STORAGE_KEY = '__doctemia_synced_id_token';

function getStoredSyncedToken() {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(SYNCED_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredSyncedToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.sessionStorage.setItem(SYNCED_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SYNCED_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignorar errores de sessionStorage
  }
}

export function AuthProvider({ children }) {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [firebaseAuthUser, setFirebaseAuthUser] = useState(null);
  const isExpiringOutRef = useRef(false);
  const isSigningOutRef = useRef(false);
  const lastSyncedTokenRef = useRef(null);

  const forceServerLogout = useCallback(async (expired = false) => {
    if (isExpiringOutRef.current) return;
    isExpiringOutRef.current = true;
    try {
      await fetch('/api/check-expiration', { method: 'POST' }).catch(() => null);
      await fetch('/api/logout', { method: 'POST' }).catch(() => null);
      await fbSignOut(auth).catch(() => null);
    } finally {
      setUser(null);
      setRole(null);
      lastSyncedTokenRef.current = null;
      setStoredSyncedToken(null);
      setLoading(false);
      router.replace(expired ? '/login?expired=1' : '/login');
    }
  }, [router]);

  useEffect(() => {
    let isMounted = true;
    let authEventSeq = 0;
    setLoading(true);
    let unsubFirestore = null;
    let expirationTimer = null;

    const cleanupListeners = () => {
      if (unsubFirestore) {
        unsubFirestore();
        unsubFirestore = null;
      }
      if (expirationTimer) {
        clearTimeout(expirationTimer);
        expirationTimer = null;
      }
    };

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      const seq = ++authEventSeq;
      cleanupListeners();
      setFirebaseAuthUser(fbUser);

      if (fbUser) {
        setLoading(true);
        isExpiringOutRef.current = false;
        try {
          // Aprovecha caché válida del token para acelerar la carga inicial de sesión
          const tokenResult = await getIdTokenResult(fbUser, false);
          if (!isMounted || seq !== authEventSeq) return;
          const emailFallback = fbUser.email === (process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin@admin.com') ? 'admin' : 'user';
          const assignedRole = tokenResult.claims.role || emailFallback;
          setRole(assignedRole);

          const userDocRef = doc(db, 'users', fbUser.uid);
          unsubFirestore = onSnapshot(userDocRef, async (docSnap) => {
            if (!isMounted || seq !== authEventSeq) return;
            if (docSnap.exists()) {
              const docData = docSnap.data();

              // Control de vigencia / cuenta desactivada para estudiantes
              if (assignedRole !== 'admin') {
                const expired = isAccountExpired(docData);
                if (docData.active === false || expired) {
                  await forceServerLogout(expired || docData.deactivatedReason === 'expired');
                  return;
                }

                // Programar corte automático si la fecha de vencimiento cae dentro de las próximas 24 horas
                if (expirationTimer) {
                  clearTimeout(expirationTimer);
                  expirationTimer = null;
                }
                const expiresAtMs = parseExpirationMs(docData.activeUntil);
                if (expiresAtMs !== null) {
                  const msRemaining = expiresAtMs - Date.now();
                  if (msRemaining > 0 && msRemaining <= 86400000) {
                    expirationTimer = setTimeout(() => {
                      forceServerLogout(true);
                    }, msRemaining + 500);
                  }
                }
              }

              setUser({
                uid: fbUser.uid,
                email: fbUser.email,
                displayName: fbUser.displayName,
                ...docData
              });
              setLoading(false);
            } else {
              console.warn(`AuthContext: User document does not exist for uid: ${fbUser.uid}. Creating it now.`);
              
              const newUserProfile = {
                email: fbUser.email,
                name: fbUser.displayName || 'Nuevo Usuario',
                photoURL: fbUser.photoURL || '/images/galloclaro-avatar.webp',
                role: assignedRole,
                createdAt: serverTimestamp(),
                isActive: true,
                subscription: null,
                cursosPagados: [],
              };

              try {
                await setDoc(userDocRef, newUserProfile);
                if (!isMounted || seq !== authEventSeq) return;
                setUser({
                  uid: fbUser.uid,
                  ...newUserProfile
                });
              } catch (error) {
                console.error("AuthContext: FAILED to create user document:", error);
                await forceServerLogout(false);
              } finally {
                if (isMounted && seq === authEventSeq) {
                  setLoading(false);
                }
              }
            }
          }, (error) => {
            if (!isMounted || seq !== authEventSeq) return;
            console.error("AuthContext: Error listening to Firestore user document:", error);
            setUser({ uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName });
            setLoading(false);
          });

        } catch (error) {
          if (!isMounted || seq !== authEventSeq) return;
          console.error("AuthContext: Error getting token result or setting up Firestore listener:", error);
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      } else {
        setUser(null);
        setRole(null);
        setFirebaseAuthUser(null);
        lastSyncedTokenRef.current = null;
        setStoredSyncedToken(null);
        setLoading(false);
      }
    });

    // Sincronizar automáticamente la cookie __session solo cuando Firebase realmente rote el ID token (~1h)
    const unsubIdToken = onIdTokenChanged(auth, async (fbUser) => {
      if (!fbUser) {
        lastSyncedTokenRef.current = null;
        setStoredSyncedToken(null);
        return;
      }
      if (isSigningOutRef.current || isExpiringOutRef.current) {
        return;
      }
      try {
        const freshToken = await fbUser.getIdToken();
        const storedToken = getStoredSyncedToken() || lastSyncedTokenRef.current;
        if (freshToken && freshToken !== storedToken) {
          lastSyncedTokenRef.current = freshToken;
          setStoredSyncedToken(freshToken);
          await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: freshToken }),
          }).catch(() => null);
        }
      } catch {
        // Silencioso: si falla el refresco, el próximo intento o re-login lo resolverá
      }
    });

    return () => {
      isMounted = false;
      cleanupListeners();
      unsubAuth();
      unsubIdToken();
    };
  }, [forceServerLogout]);

  const signOut = async () => {
    isSigningOutRef.current = true;
    setLoading(true);
    console.log('AuthContext: Iniciando signOut...');
    try {
      const response = await fetch('/api/logout', { method: 'POST' });
      if (!response.ok) {
        console.error('AuthContext: Falló la llamada a /api/logout', await response.text());
      } else {
        console.log('AuthContext: Llamada a /api/logout exitosa.');
      }
      await fbSignOut(auth);
      lastSyncedTokenRef.current = null;
      setStoredSyncedToken(null);
      setUser(null);
      setRole(null);
      console.log('AuthContext: Firebase signOut completado.');
      router.replace('/login');
    } catch (error) {
      console.error('AuthContext: Error durante signOut:', error);
      router.replace('/login');
    } finally {
      isSigningOutRef.current = false;
      setLoading(false);
    }
  };

  const refreshUserData = useCallback(async () => {
    if (firebaseAuthUser?.uid) {
      console.log('AuthContext: Refreshing user data for', firebaseAuthUser.uid);
      setLoading(true);
      try {
        const userDocRef = doc(db, 'users', firebaseAuthUser.uid);
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
          setUser({
            uid: firebaseAuthUser.uid,
            email: firebaseAuthUser.email,
            displayName: firebaseAuthUser.displayName,
            ...docSnap.data()
          });
        } else {
          console.warn('AuthContext (refreshUserData): User document does not exist in Firestore.');
          setUser({ uid: firebaseAuthUser.uid, email: firebaseAuthUser.email, displayName: firebaseAuthUser.displayName });
        }
      } catch (error) {
        console.error('AuthContext: Error refreshing user data:', error);
      } finally {
        setLoading(false);
      }
    }
  }, [firebaseAuthUser]);

  return (
    <AuthContext.Provider value={{ user, role, loading, signOut, refreshUserData, firebaseAuthUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
