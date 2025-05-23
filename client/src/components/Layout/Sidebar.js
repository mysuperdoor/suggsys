import React, { useState, useEffect } from 'react';
import { Menu, Avatar, Typography, Space, Divider } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import {
  HomeOutlined,
  FileTextOutlined,
  PlusOutlined,
  BarChartOutlined,
  TeamOutlined,
  LockOutlined,
  UserOutlined,
  LogoutOutlined,
  AuditOutlined,
  ToolOutlined,
  PieChartOutlined,
  LineChartOutlined
} from '@ant-design/icons';
// import { authService } from '../../services/authService'; // Will use useAuth
import { useAuth } from '../../context/AuthContext'; // Import useAuth

const { Text } = Typography;

// Removed propRole as role will come from context
const Sidebar = ({ collapsed }) => { 
  const { user, logout: contextLogout, isAuthenticated } = useAuth(); // Get user and logout from context
  const navigate = useNavigate();

  // Role and currentUser are now derived from the user object from context
  const role = user?.role;
  const currentUser = user; // The user object from context is the current user

  // 根据角色确定权限
  // These checks will now use `role` derived from `user` context
  const isAdmin = role === '部门经理' || role === '安全科管理人员' || role === '运行科管理人员';
  const isDepartmentManager = role === '部门经理';
  const isSupervisor = role === '值班主任';
  const isSafetyOrOperationAdmin = role === '安全科管理人员' || role === '运行科管理人员';
  
  // 确定是否显示审核菜单（值班主任、安全科管理人员、运行科管理人员、部门经理可见）
  const canReview = isSupervisor || isAdmin;
  
  // 确定是否显示实施跟踪菜单（安全科管理人员、运行科管理人员、部门经理可见）
  const canManageImplementation = isAdmin;
  
  // 确定是否可以提交建议（除了安全科管理人员和运行科管理人员外的所有人可见）
  const canSubmitSuggestion = !isSafetyOrOperationAdmin;

  // 确定是否可以查看班组内部报表（只有值班主任可见）
  const canViewTeamInternalReport = isSupervisor;

  // console.log('Sidebar - 用户角色 (Context):', role);
  // console.log('Sidebar - 是否认证 (Context):', isAuthenticated);


  const handleLogout = () => {
    contextLogout(); // Call logout from context
    navigate('/login'); // Navigation remains here
  };

  // If not authenticated or user data is not yet available, can optionally render nothing or a placeholder
  if (!isAuthenticated || !user) {
    // This might be too aggressive if sidebar is meant to show something for logged-out users
    // For this app, sidebar is likely only for authenticated users.
    // If isLoading state was in context, we could show a spinner here too.
    return null; 
  }

  return (
    <>
      {/* 用户信息区域 - 在折叠状态下简化显示 */}
      <div style={{ 
        padding: collapsed ? '16px 0' : '16px', 
        textAlign: 'center',
        overflow: 'hidden'
      }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <Avatar 
            size={collapsed ? 36 : 64} 
            icon={<UserOutlined />} 
            style={{ backgroundColor: '#1890ff' }} 
          />
          {!collapsed && (
            <>
              <Text strong style={{ fontSize: '16px' }}>
                {currentUser?.name || '加载中...'}
              </Text>
              <Text type="secondary">
                {role || '加载中...'}
              </Text>
              {currentUser?.team && (
                <Text type="secondary">
                  {currentUser.team}
                </Text>
              )}
            </>
          )}
        </Space>
      </div>
      {!collapsed && <Divider style={{ margin: '0 0 8px 0' }} />}
      
      <Menu
        mode="inline"
        defaultSelectedKeys={['1']}
        style={{ borderRight: 0 }}
        inlineCollapsed={collapsed}
      >
        <Menu.Item key="1" icon={<HomeOutlined />}>
          <Link to="/dashboard">首页</Link>
        </Menu.Item>
        
        <Menu.Item key="2" icon={<FileTextOutlined />}>
          <Link to="/suggestions/list">建议列表</Link>
        </Menu.Item>
        
        {canSubmitSuggestion && (
          <Menu.Item key="3" icon={<PlusOutlined />}>
            <Link to="/suggestions/new">提交新建议</Link>
          </Menu.Item>
        )}

        {canReview && (
          <Menu.Item key="4" icon={<AuditOutlined />}>
            <Link to="/suggestions/review">建议审核</Link>
          </Menu.Item>
        )}

        {canManageImplementation && (
          <Menu.Item key="5" icon={<ToolOutlined />}>
            <Link to="/suggestions/implementation">实施跟踪</Link>
          </Menu.Item>
        )}

        {isAdmin && (
          <Menu.Item key="6" icon={<BarChartOutlined />}>
            <Link to="/reports/department-performance">班组统计报表</Link>
          </Menu.Item>
        )}

        {canViewTeamInternalReport && (
          <Menu.Item key="7" icon={<LineChartOutlined />}>
            <Link to="/reports/team-internal-report">班组内部报表</Link>
          </Menu.Item>
        )}

        {isDepartmentManager && (
          <Menu.Item key="8" icon={<TeamOutlined />}>
            <Link to="/users">用户管理</Link>
          </Menu.Item>
        )}

        <Menu.Item key="9" icon={<LockOutlined />}>
          <Link to="/change-password">修改密码</Link>
        </Menu.Item>
        
        <Menu.Item key="10" icon={<LogoutOutlined />} onClick={handleLogout}>
          退出登录
        </Menu.Item>
      </Menu>
    </>
  );
};

export default Sidebar; 