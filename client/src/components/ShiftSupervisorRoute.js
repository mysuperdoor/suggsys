import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { message, Spin } from 'antd';
import { useAuth } from '../context/AuthContext'; // Import useAuth

/**
 * 值班主任路由组件
 * 仅允许值班主任访问 (Note: Original logic was only Shift Supervisor, not higher roles)
 * If higher roles should also access, the condition `user?.role === '值班主任'` needs adjustment.
 * For now, sticking to the original "仅允许值班主任访问".
 */
const ShiftSupervisorRoute = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

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

  // Original logic was only for '值班主任'.
  // If routes protected by this should also be accessible by managers/admins,
  // this condition needs to include them, e.g. const allowedRoles = ['值班主任', '部门经理', ...];
  if (user?.role !== '值班主任') { 
    console.log(`ShiftSupervisorRoute - 权限不足 (用户角色: ${user?.role})，重定向到首页`);
    message.error('此页面仅限值班主任访问。');
    return <Navigate to="/" replace />;
  }

  console.log('ShiftSupervisorRoute - 值班主任权限验证通过');
  return children;
};

export default ShiftSupervisorRoute; 