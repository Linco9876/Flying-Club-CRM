import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    )
  ]);
};

const fetchUserWithRetry = async (userId: string, maxRetries = 3, delay = 500): Promise<any> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .maybeSingle(),
        5000
      );

      if (result.error) {
        console.error(`Error fetching user data (attempt ${i + 1}):`, result.error);
        if (i === maxRetries - 1) throw result.error;
      }

      if (result.data) {
        return result.data;
      }

      if (i < maxRetries - 1) {
        console.log(`User record not found, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let initTimeout: NodeJS.Timeout;

    const initAuth = async () => {
      try {
        const sessionResult = await withTimeout(
          supabase.auth.getSession(),
          10000
        );

        if (sessionResult.error) {
          console.error('Error getting session:', sessionResult.error);
          if (mounted) setIsLoading(false);
          return;
        }

        const session = sessionResult.data.session;

        if (session?.user && mounted) {
          try {
            const userData = await fetchUserWithRetry(session.user.id);

            if (userData && mounted) {
              setUser({
                id: userData.id,
                email: userData.email,
                name: userData.name,
                role: userData.role,
                phone: userData.phone,
                avatar: userData.avatar_url
              });
            } else {
              console.warn('User session exists but no user record found after retries');
              await supabase.auth.signOut();
            }
          } catch (error) {
            console.error('Error fetching user data:', error);
            await supabase.auth.signOut();
          }
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        await supabase.auth.signOut();
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initTimeout = setTimeout(() => {
      if (mounted) {
        console.error('Auth initialization timed out, clearing session');
        setIsLoading(false);
        setUser(null);
        supabase.auth.signOut();
      }
    }, 20000);

    initAuth().finally(() => {
      clearTimeout(initTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_IN' && session?.user) {
        setIsLoading(true);
        try {
          const userData = await fetchUserWithRetry(session.user.id);

          if (userData && mounted) {
            setUser({
              id: userData.id,
              email: userData.email,
              name: userData.name,
              role: userData.role,
              phone: userData.phone,
              avatar: userData.avatar_url
            });
          }
        } catch (error) {
          console.error('Error fetching user in auth change:', error);
        } finally {
          if (mounted) setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
      }
    });

    return () => {
      mounted = false;
      clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.error('Login error:', error.message);
        setIsLoading(false);
        return false;
      }

      if (data.user) {
        try {
          const userData = await fetchUserWithRetry(data.user.id);

          if (userData) {
            setUser({
              id: userData.id,
              email: userData.email,
              name: userData.name,
              role: userData.role,
              phone: userData.phone,
              avatar: userData.avatar_url
            });
            setIsLoading(false);
            return true;
          } else {
            console.error('User profile not found');
            await supabase.auth.signOut();
            setIsLoading(false);
            return false;
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          await supabase.auth.signOut();
          setIsLoading(false);
          return false;
        }
      }

      setIsLoading(false);
      return false;
    } catch (error) {
      console.error('Login error:', error);
      setIsLoading(false);
      return false;
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    window.history.replaceState(null, '', '/');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};