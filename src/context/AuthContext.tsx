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

const fetchUserWithRetry = async (userId: string, maxRetries = 3, delay = 1000): Promise<any> => {
  for (let i = 0; i < maxRetries; i++) {
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error(`Error fetching user data (attempt ${i + 1}):`, error);
      if (i === maxRetries - 1) throw error;
    }

    if (userData) {
      return userData;
    }

    if (i < maxRetries - 1) {
      console.log(`User record not found, retrying in ${delay}ms...`);
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

    const initAuth = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
          console.error('Error getting session:', sessionError);
          if (mounted) setIsLoading(false);
          return;
        }

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
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initAuth();

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
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};