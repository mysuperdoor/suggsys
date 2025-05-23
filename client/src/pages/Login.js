import React, { useState, useEffect, useContext } from 'react'; // Added useContext
import { Form, Input, Button, Card, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom'; // Added useLocation
// Removed direct axios import, will use authService via context
import AuthContext from '../../context/AuthContext'; // Import AuthContext

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation(); // For redirecting after login
  const [loading, setLoading] = useState(false);
  const { login: contextLogin } = useContext(AuthContext); // Get login from context
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // 监听窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const onFinish = async (values) => {
    try {
      setLoading(true);
      // Call the login function from AuthContext
      const loggedInUser = await contextLogin(values.username, values.password); 
      
      if (loggedInUser) {
        message.success('登录成功');
        // Redirect to the page the user was trying to access, or dashboard
        const from = location.state?.from?.pathname || '/dashboard';
        navigate(from, { replace: true });
      } else {
        // This case might not be reached if contextLogin throws an error handled below
        message.error('登录失败，请检查您的凭据');
      }
    } catch (error) {
      // Error object structure might vary depending on how authService and context re-throw it.
      // Assuming error.response.data.msg or error.message for now.
      message.error(error.response?.data?.message || error.response?.data?.msg || error.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        background: isMobile ? '#ffffff' : 'linear-gradient(to right, #f8f9fa 50%, #ffffff 50%)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        padding: isMobile ? '16px' : 0
      }}
    >
      <Card 
        style={{ 
          width: isMobile ? '100%' : 480,
          maxWidth: '100%',
          borderRadius: isMobile ? '8px' : '0',
          boxShadow: '0 12px 24px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          background: '#ffffff',
          border: 'none'
        }}
        bodyStyle={{ padding: '0' }}
        bordered={false}
      >
        {/* 企业标题栏 */}
        <div style={{ 
          padding: isMobile ? '16px 24px' : '22px 40px',
          borderBottom: '1px solid #e8e8e8',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ 
              fontSize: isMobile ? '18px' : '22px', 
              fontWeight: '600',
              color: '#0d1835',
              letterSpacing: '0.3px',
              display: 'flex',
              alignItems: 'center'
            }}>
              {/* 简化的企业logo图标 */}
              <div style={{
                width: isMobile ? '24px' : '28px',
                height: isMobile ? '24px' : '28px',
                borderRadius: '6px',
                background: '#0d1835',
                marginRight: '12px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                color: 'white',
                fontSize: isMobile ? '14px' : '16px',
                fontWeight: 'bold'
              }}>Y</div>
              生产调度部
            </div>
          </div>
          <div style={{
            fontSize: '14px',
            color: '#8592a6'
          }}>合理化建议平台</div>
        </div>
        
        {/* 登录区域 */}
        <div style={{ padding: isMobile ? '24px' : '40px' }}>
          <div style={{ marginBottom: isMobile ? '24px' : '30px' }}>
            <h2 style={{ 
              fontSize: isMobile ? '20px' : '24px', 
              color: '#0d1835', 
              margin: '0 0 8px 0',
              fontWeight: '600',
            }}>
              系统登录
            </h2>
            <div style={{
              fontSize: '14px',
              color: '#8592a6',
              lineHeight: '1.5'
            }}>
              创新思维，助力发展
            </div>
          </div>
          
          <Form
            name="login"
            onFinish={onFinish}
            autoComplete="off"
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              label={<span style={{ fontSize: '14px', color: '#0d1835', fontWeight: '500' }}>用户名</span>}
              name="username"
              rules={[{ required: true, message: '请输入企业用户名' }]}
            >
              <Input 
                size={isMobile ? "middle" : "large"}
                style={{ 
                  borderRadius: '4px', 
                  height: isMobile ? '40px' : '48px', 
                  fontSize: '14px',
                  border: '1px solid #d9e1ec',
                  boxShadow: 'none',
                  padding: '0 16px'
                }}
              />
            </Form.Item>

            <Form.Item
              label={<span style={{ fontSize: '14px', color: '#0d1835', fontWeight: '500' }}>密码</span>}
              name="password"
              rules={[{ required: true, message: '请输入登录密码' }]}
              style={{ marginBottom: isMobile ? '24px' : '28px' }}
            >
              <Input.Password
                size={isMobile ? "middle" : "large"}
                style={{ 
                  borderRadius: '4px', 
                  height: isMobile ? '40px' : '48px', 
                  fontSize: '14px',
                  border: '1px solid #d9e1ec',
                  boxShadow: 'none',
                  padding: '0 16px'
                }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: '16px' }}>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading} 
                block 
                size={isMobile ? "middle" : "large"}
                style={{ 
                  height: isMobile ? '40px' : '48px', 
                  borderRadius: '4px', 
                  background: '#0d1835',
                  border: 'none',
                  fontSize: isMobile ? '14px' : '15px',
                  fontWeight: '500',
                  boxShadow: '0 4px 12px rgba(13,24,53,0.2)',
                  letterSpacing: '1px'
                }}
              >
                登录
              </Button>
            </Form.Item>
            

          </Form>
        </div>
        
        {/* 页脚 */}
        <div style={{ 
          padding: isMobile ? '12px 24px' : '18px 40px',
          borderTop: '1px solid #e8e8e8',
          fontSize: '12px',
          color: '#8592a6',
          display: 'flex',
          justifyContent: 'space-between',
          flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? '4px' : 0
        }}>
          <div>© {new Date().getFullYear()} 内部系统 · 版本 1.0.0</div>
          <div>2#518</div>
        </div>
      </Card>
    </div>
  );
};

export default Login; 