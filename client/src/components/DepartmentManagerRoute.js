import React, { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { message, Spin } from 'antd';
import { useAuth } from '../context/AuthContext'; // Import useAuth

/**
 * 部门经理路由组件
 * 只允许部门经理访问
 */
const DepartmentManagerRoute = ({ children }) => {
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

  if (user?.role !== '部门经理') {
    console.log(`DepartmentManagerRoute - 权限不足 (用户角色: ${user?.role})，重定向到首页`);
    message.error('需要部门经理权限才能访问此页面。');
    return <Navigate to="/" replace />;
  }

  console.log('DepartmentManagerRoute - 部门经理权限验证通过');
  return children;
};

export default DepartmentManagerRoute; 