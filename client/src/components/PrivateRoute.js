import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from '../context/AuthContext'; // Import AuthContext
import { Spin } from 'antd'; // For loading indicator

const PrivateRoute = ({ children }) => {
  const location = useLocation();
  const { isAuthenticated, isLoading } = useContext(AuthContext);

  console.log('PrivateRoute检查认证状态 (Context):', {
    isAuthenticated,
    isLoading,
    currentPath: location.pathname,
  });

  if (isLoading) {
    // Show a loading spinner or some placeholder while auth state is being determined
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载认证信息..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, saving the current path
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

export default PrivateRoute; 