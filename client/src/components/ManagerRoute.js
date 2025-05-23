import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import AuthContext from '../context/AuthContext'; // Import AuthContext
import { message, Spin } from 'antd';

/**
 * 管理人员路由组件
 * 允许部门经理、安全科管理人员、运行科管理人员和值班主任访问
 */
const ManagerRoute = ({ children }) => {
  const location = useLocation();
  const { user, isAuthenticated, isLoading } = useContext(AuthContext);

  console.log('ManagerRoute检查认证状态 (Context):', {
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
    message.warning('请先登录再访问此页面。');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check for allowed roles
  const allowedRoles = ['部门经理', '安全科管理人员', '运行科管理人员', '值班主任'];
  if (!user?.role || !allowedRoles.includes(user.role)) {
    console.log(`ManagerRoute - 权限不足 (用户角色: ${user?.role})，重定向到首页`);
    message.error('您没有权限访问此页面。');
    return <Navigate to="/" replace />;
  }

  console.log('ManagerRoute - 权限验证通过');
  return children;
};

export default ManagerRoute; 