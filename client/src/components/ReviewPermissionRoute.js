import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { message, Spin } from 'antd';
import { useAuth } from '../context/AuthContext'; // Import useAuth

/**
 * 审核权限路由组件
 * 允许部门经理、安全科管理人员、运行科管理人员和值班主任访问
 */
const ReviewPermissionRoute = ({ children }) => {
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

  const allowedRoles = ['部门经理', '安全科管理人员', '运行科管理人员', '值班主任'];
  if (!user?.role || !allowedRoles.includes(user.role)) {
    console.log(`ReviewPermissionRoute - 权限不足 (用户角色: ${user?.role})，重定向到首页`);
    message.error('您没有审核权限访问此页面。');
    return <Navigate to="/" replace />;
  }

  console.log('ReviewPermissionRoute - 审核权限验证通过');
  return children;
};

export default ReviewPermissionRoute; 