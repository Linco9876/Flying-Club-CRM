import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { User, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
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
      const [userResult, rolesResult] = await Promise.all([
        withTimeout(
          supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .maybeSingle(),
          5000
        ),
        withTimeout(
          supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', userId),
          5000
        )
      ]);

      if (userResult.error) {
        console.error(`Error fetching user data (attempt ${i + 1}):`, userResult.error);
        if (i === maxRetries - 1) throw userResult.error;
      }

      if (rolesResult.error) {
        console.error(`Error fetching user roles (attempt ${i + 1}):`, rolesResult.error);
      }

      if (userResult.data) {
        const roles = (rolesResult.data?.map(r => r.role as UserRole) || []).filter(Boolean);
        const resolvedRoles = roles.length > 0 ? roles : [userResult.data.role as UserRole];
        return {
          ...userResult.data,
          role: getPrimaryRoleFromRoles(resolvedRoles),
          roles: resolvedRoles
        };
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

const getPrimaryRoleFromRoles = (roles: UserRole[]): UserRole =>
  roles.includes('admin') ? 'admin'
    : roles.includes('senior_instructor') ? 'senior_instructor'
    : roles.includes('instructor') ? 'instructor'
    : roles.includes('pilot') ? 'pilot'
    : 'student';

const mapUserData = (userData: any): User => ({
  id: userData.id,
  email: userData.email,
  name: userData.name,
  role: getPrimaryRoleFromRoles(userData.roles && userData.roles.length > 0 ? userData.roles : [userData.role]),
  roles: userData.roles,
  phone: userData.phone,
  mobilePhone: userData.mobile_phone,
  homePhone: userData.home_phone,
  workPhone: userData.work_phone,
  address: userData.address,
  dateOfBirth: userData.date_of_birth ? new Date(userData.date_of_birth) : undefined,
  emergencyContact: userData.emergency_contact_name ? {
    name: userData.emergency_contact_name,
    phone: userData.emergency_contact_phone || '',
    relationship: userData.emergency_contact_relationship || ''
  } : undefined,
  preferredAircraftId: userData.preferred_aircraft_id,
  avatar: userData.avatar_url,
  coverPhoto: userData.cover_url,
  isActive: userData.is_active ?? true
});

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
              if (userData.is_active === false) {
                console.warn('Archived user session attempted to load:', session.user.id);
                await supabase.auth.signOut();
              } else {
                setUser(mapUserData(userData));
              }
            } else {
              console.warn('User session exists but no user record found after retries');
              await supabase.auth.signOut();
            }
          } catch (error) {
            console.error('Error fetching user data:', error);
          }
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initTimeout = setTimeout(() => {
      if (mounted) {
        console.error('Auth initialization timed out');
        setIsLoading(false);
      }
    }, 20000);

    initAuth().finally(() => {
      clearTimeout(initTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;

      // Token refresh and initial session restore — do nothing, initAuth handles startup
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
        return;
      }

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Only respond to a genuine new sign-in (e.g. from the login form)
      // If initAuth already set the user for this session, skip to avoid a double-load flash
      if (event === 'SIGNED_IN' && session?.user) {
        (async () => {
          // Use a ref-free check: if user state is null it means initAuth hasn't finished
          // or this is a fresh login. Either way, fetch without flashing isLoading.
          try {
            const userData = await fetchUserWithRetry(session.user.id);
            if (userData && mounted) {
              if (userData.is_active === false) {
                await supabase.auth.signOut();
                setUser(null);
                return;
              }
              setUser(prev => {
                // Only update if we don't have this user already
                if (prev?.id === userData.id) return prev;
                return mapUserData(userData);
              });
            }
          } catch (error) {
            console.error('Error fetching user in auth change:', error);
          }
        })();
      }
    });

    return () => {
      mounted = false;
      clearTimeout(initTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) {
        console.error('Login error:', error.message);
        setIsLoading(false);
        return { success: false, error: 'Invalid email or password. Please check your credentials and try again.' };
      }

      if (data.user) {
        try {
          const userData = await fetchUserWithRetry(data.user.id);

          if (userData) {
            if (userData.is_active === false) {
              await supabase.auth.signOut();
              setIsLoading(false);
              return {
                success: false,
                error: 'This account has been archived. Please contact the club if you need access restored.'
              };
            }
            setUser(mapUserData(userData));
            setIsLoading(false);
            return { success: true };
          } else {
            console.error('User profile not found for authenticated user:', data.user.id, data.user.email);
            await supabase.auth.signOut();
            setIsLoading(false);
            return {
              success: false,
              error: `Password accepted, but no CRM profile was found for ${data.user.email || email.trim()}. Ask an admin to check this user's profile/role record.`
            };
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
          await supabase.auth.signOut();
          setIsLoading(false);
          return {
            success: false,
            error: 'Password accepted, but the CRM profile could not be loaded. Please try again or ask an admin to check this user profile.'
          };
        }
      }

      setIsLoading(false);
      return { success: false, error: 'Login did not return a user session. Please try again.' };
    } catch (error) {
      console.error('Login error:', error);
      setIsLoading(false);
      return { success: false, error: 'An error occurred during login. Please try again.' };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    window.history.replaceState(null, '', '/');
  };

  const refreshUser = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const userData = await fetchUserWithRetry(data.user.id);
    if (userData) setUser(mapUserData(userData));
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
