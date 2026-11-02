import { createContext, useContext, type ReactNode } from 'react';

interface User {
  id: string;
  email: string;
}

interface AuthState {
  user: User;
}

const GUEST_USER: User = { id: 'guest', email: 'local' };

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={{ user: GUEST_USER }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
