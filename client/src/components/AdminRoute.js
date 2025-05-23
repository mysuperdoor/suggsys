import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from '../context/AuthContext'; // Import AuthContext
import { message, Spin } from 'antd';

const AdminRoute = ({ children }) => {
  const location = useLocation();
  const { user, isAuthenticated, isLoading } = useContext(AuthContext);

  console.log('AdminRoute检查认证状态 (Context):', {
    userRole: user?.role,
    isAuthenticated,
    isLoading,
    currentPath: location.pathname,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="验证权限中..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Not authenticated, redirect to login
    message.warning('请先登录再访问此页面。');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check for '部门经理' role
  if (user?.role !== '部门经理') {
    console.log('AdminRoute - 权限不足 (非部门经理)，重定向到首页');
    message.error('需要部门经理权限才能访问此页面。');
    return <Navigate to="/" replace />;
  }

  console.log('AdminRoute - 部门经理权限验证通过');
  return children;
};

export default AdminRoute; 