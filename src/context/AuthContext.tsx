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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    const initAuth = async () => {
      try {
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Auth initialization timeout')), 5000);
        });

        const authPromise = (async () => {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();

          if (sessionError) {
            console.error('Error getting session:', sessionError);
            return;
          }

          if (session?.user) {
            const { data: userData, error } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .maybeSingle();

            if (error) {
              console.error('Error fetching user data:', error);
              await supabase.auth.signOut();
              return;
            }

            if (userData && mounted) {
              setUser({
                id: userData.id,
                email: userData.email,
                name: userData.name,
                role: userData.role,
                phone: userData.phone,
                avatar: userData.avatar_url
              });
            } else if (!userData) {
              console.warn('User session exists but no user record found');
              await supabase.auth.signOut();
            }
          }
        })();

        await Promise.race([authPromise, timeoutPromise]);
        clearTimeout(timeoutId);
      } catch (error) {
        console.error('Error initializing auth:', error);
        clearTimeout(timeoutId);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('User data fetch timeout')), 3000)
          );

          const fetchPromise = supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          const { data: userData, error } = await Promise.race([
            fetchPromise,
            timeoutPromise
          ]) as any;

          if (error) {
            console.error('Error fetching user in auth change:', error);
            await supabase.auth.signOut();
            return;
          }

          if (userData && mounted) {
            setUser({
              id: userData.id,
              email: userData.email,
              name: userData.name,
              role: userData.role,
              phone: userData.phone,
              avatar: userData.avatar_url
            });
          } else if (!userData) {
            console.warn('No user data found, signing out');
            await supabase.auth.signOut();
          }
        } catch (error) {
          console.error('Timeout or error fetching user data:', error);
          await supabase.auth.signOut();
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      mounted = false;
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
        return false;
      }

      if (data.user) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('User data fetch timeout')), 5000)
          );

          const fetchPromise = supabase
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .maybeSingle();

          const result = await Promise.race([fetchPromise, timeoutPromise]) as any;
          const userData = result?.data;
          const userError = result?.error;

          if (userError) {
            console.error('Error fetching user profile:', userError);
            await supabase.auth.signOut();
            return false;
          }

          if (userData) {
            setUser({
              id: userData.id,
              email: userData.email,
              name: userData.name,
              role: userData.role,
              phone: userData.phone,
              avatar: userData.avatar_url
            });
            return true;
          } else {
            console.error('User profile not found');
            await supabase.auth.signOut();
            return false;
          }
        } catch (timeoutError) {
          console.error('Timeout fetching user profile:', timeoutError);
          await supabase.auth.signOut();
          return false;
        }
      }

      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};