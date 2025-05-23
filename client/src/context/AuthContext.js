import React, { createContext, useState, useEffect, useContext } from 'react';
import { authService } from '../services/authService';
import { useNavigate } from 'react-router-dom'; // Import for potential programmatic navigation

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true);
  // const navigate = useNavigate(); // Not typically used directly in context provider for redirects

  useEffect(() => {
    const loadUserFromStorage = async () => {
      setIsLoading(true);
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        setToken(storedToken); // Ensure token is set in context state
        try {
          // authService.getCurrentUser already checks localStorage first, then API
          const currentUser = await authService.getCurrentUser(); 
          if (currentUser) {
            setUser(currentUser);
            setIsAuthenticated(true);
          } else {
            // Token might be invalid or user data fetch failed
            localStorage.removeItem('token');
            localStorage.removeItem('currentUser');
            localStorage.removeItem('userRole');
            localStorage.removeItem('userId');
            setUser(null);
            setToken(null);
            setIsAuthenticated(false);
          }
        } catch (error) {
          console.error("Error loading user from storage:", error);
          localStorage.removeItem('token');
          localStorage.removeItem('currentUser');
          localStorage.removeItem('userRole');
          localStorage.removeItem('userId');
          setUser(null);
          setToken(null);
          setIsAuthenticated(false);
        }
      }
      setIsLoading(false);
    };

    loadUserFromStorage();
  }, []);

  const login = async (username, password) => {
    try {
      const { token: apiToken, user: apiUser } = await authService.login(username, password);
      setUser(apiUser);
      setToken(apiToken);
      setIsAuthenticated(true);
      // authService.login already handles localStorage
      return apiUser; // Return user data for potential use in component
    } catch (error) {
      // Clear any potentially inconsistent state on login failure
      setUser(null);
      setToken(null);
      setIsAuthenticated(false);
      throw error; // Re-throw error to be caught by login component
    }
  };

  const logout = () => {
    authService.logout(); // Clears localStorage
    setUser(null);
    setToken(null);
    setIsAuthenticated(false);
    // Navigation after logout is typically handled by the component calling logout
  };

  const value = {
    user,
    token,
    isAuthenticated,
    isLoading,
    login,
    logout,
    // Could also add specific role check functions here if preferred over checking user.role directly
    // e.g., isDepartmentManager: () => user?.role === '部门经理',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined && process.env.NODE_ENV !== 'test') { // Allow undefined in tests
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext; // Can still export AuthContext for class components or specific use cases