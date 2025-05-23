import React, { useState, useEffect } from 'react';
import {
  Form,
  Input,
  Select,
  Upload,
  Button,
  Card,
  message,
  Space,
  Alert
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { suggestionService } from '../../services/suggestionService';
import { authService } from '../../services/authService';

const { TextArea } = Input;
const { Option } = Select;

const NewSuggestion = () => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false); // Renamed from loading for clarity
  const [fileList, setFileList] = useState([]);
  const [suggestionTypes, setSuggestionTypes] = useState([]);
  const [initializing, setInitializing] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isRestrictedUser, setIsRestrictedUser] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const navigate = useNavigate();

  // 检测窗口大小变化
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // 检查用户权限
  useEffect(() => {
    const checkUserPermission = async () => {
      try {
        const user = await authService.getCurrentUser();
        setCurrentUser(user);
        
        // 检查是否是运行科或安全科管理人员
        if (user && (user.role === '运行科管理人员' || user.role === '安全科管理人员')) {
          console.log('当前用户没有提交建议权限:', user.role);
          setIsRestrictedUser(true);
          message.error('运行科和安全科管理人员暂时无法提交建议');
          
          // 延迟一秒后重定向，让用户有时间看到消息
          setTimeout(() => {
            navigate('/suggestions/list');
          }, 1500);
        }
      } catch (error) {
        console.error('检查用户权限失败:', error);
      }
    };
    
    checkUserPermission();
  }, [navigate]);

  // 获取初始数据
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        setInitializing(true);
        const response = await suggestionService.getCreateData();
        console.log('获取创建建议数据:', response);
        
        if (response && response.types) {
          setSuggestionTypes(response.types);
        } else {
          // 如果API还没准备好，使用默认数据
          setSuggestionTypes([
            { label: '安全管理', value: 'SAFETY' },
            { label: '生产优化', value: 'PRODUCTION' },
            { label: '智能化升级', value: 'AUTOMATION' },
            { label: '其它', value: 'OTHER' }
          ]);
        }
      } catch (error) {
        console.error('获取初始数据失败:', error);
        message.error('加载表单数据失败，使用默认配置');
        // 使用默认数据
        setSuggestionTypes([
          { label: '安全管理', value: 'SAFETY' },
          { label: '生产优化', value: 'PRODUCTION' },
          { label: '智能化升级', value: 'AUTOMATION' },
          { label: '其它', value: 'OTHER' }
        ]);
      } finally {
        setInitializing(false);
      }
    };

    fetchInitialData();
  }, []);

  // 处理文件上传
  // File handling similar to CreateSuggestion.js
  const uploadProps = {
    onRemove: (file) => {
      const index = fileList.indexOf(file);
      const newFileList = fileList.slice();
      newFileList.splice(index, 1);
      setFileList(newFileList);
    },
    beforeUpload: (file) => {
      // Limit file size (10MB)
      const isLt10M = file.size / 1024 / 1024 < 10;
      if (!isLt10M) {
        message.error('文件不能超过10MB!');
        return Upload.LIST_IGNORE; // Prevent adding to list
      }
      // Limit file count
      if (fileList.length >= 5) {
        message.error('最多只能上传5个文件');
        return Upload.LIST_IGNORE;
      }
      setFileList(prevList => [...prevList, file]);
      return false; // Prevent auto-upload, manage manually
    },
    fileList, // Controlled component
  };

  // 处理表单提交
  const handleSubmit = async (values) => {
    // 再次检查用户权限
    if (isRestrictedUser) {
      message.error('您没有提交建议的权限');
      return;
    }

    if (fileList.length > 5) {
      message.error('最多只能上传5个文件'); // Double check, though beforeUpload should prevent
      return;
    }
    
    try {
      setSubmitting(true);
      console.log('提交的表单值:', values);
      
      const formData = new FormData();
      
      // Add form fields - ensure all values are strings, similar to CreateSuggestion.js
      formData.append('title', String(values.title || ''));
      formData.append('type', String(values.type || ''));
      formData.append('content', String(values.content || ''));
      formData.append('expectedBenefit', String(values.expectedBenefit || ''));
      
      // Add files - New.js used originFileObj, CreateSuggestion.js used file directly.
      // Assuming files in fileList are actual File objects from AntD's Upload component after beforeUpload
      fileList.forEach((file, index) => {
        // Ant Design's Upload component adds the actual file to `originFileObj`
        // when `beforeUpload` returns false. If the file object itself is the File, use that.
        const fileToAdd = file.originFileObj || file;
        console.log(`添加文件 ${index}:`, fileToAdd.name);
        formData.append('files', fileToAdd);
      });

      // Debug FormData content
      // for (let pair of formData.entries()) {
      //   console.log(pair[0] + ': ' + (pair[1] instanceof File ? pair[1].name : pair[1]));
      // }

      const response = await suggestionService.submitSuggestion(formData);
      
      console.log('提交成功，响应:', response);
      message.success('建议提交成功！');
      form.resetFields(); // Reset form on success
      setFileList([]); // Clear file list on success
      navigate('/suggestions/list');
    } catch (error) {
      console.error('提交失败:', error);
      // Enhanced error reporting from CreateSuggestion.js
      if (error.response) {
        console.error('错误响应数据:', error.response.data);
        if (error.response.data.errors && Array.isArray(error.response.data.errors)) {
          const errorMessages = error.response.data.errors.map(err => err.msg).join(', ');
          message.error(`提交失败: ${errorMessages}`);
        } else if (error.response.data.message) {
          message.error(`提交失败: ${error.response.data.message}`);
        } else {
          message.error('提交失败，请检查表单数据是否符合要求');
        }
      } else if (error.request) {
        message.error('服务器无响应，请检查网络连接');
      } else {
        message.error(`请求错误: ${error.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="responsive-container">
      <Card 
        title="提交合理化建议" 
        loading={initializing}
        bodyStyle={{ padding: isMobile ? '12px' : '24px' }}
      >
        {isRestrictedUser && (
          <Alert
            message="权限受限"
            description="运行科和安全科管理人员暂时无法提交建议。"
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          disabled={initializing || isRestrictedUser}
          style={{ width: '100%' }}
          initialValues={{ type: 'SAFETY' }} // Added from CreateSuggestion.js
        >
          <Form.Item
            name="title"
            label="建议标题"
            rules={[
              { required: true, message: '请输入建议标题' },
              { max: 100, message: '标题不能超过100个字符' } // Added from CreateSuggestion.js
            ]}
          >
            <Input placeholder="请输入建议标题" maxLength={100} />
          </Form.Item>

          <Form.Item
            name="type"
            label="建议类型"
            rules={[{ required: true, message: '请选择建议类型' }]}
          >
            <Select placeholder="请选择建议类型">
              {suggestionTypes.map(type => (
                <Option key={type.value} value={type.value}>
                  {type.label}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="content"
            label="建议内容"
            rules={[
              { required: true, message: '请输入建议内容' },
              { min: 20, message: '内容不能少于20个字符' } // Added from CreateSuggestion.js
            ]}
          >
            <TextArea
              placeholder="请详细描述您的合理化建议（不少于20个字符）..." // Text from CreateSuggestion
              rows={isMobile ? 4 : 6} // Kept responsive rows from New.js
              maxLength={2000} // Kept from New.js (CreateSuggestion had no explicit maxLength for content)
              showCount
            />
          </Form.Item>

          <Form.Item
            name="expectedBenefit"
            label="预期效益"
            rules={[{ required: true, message: '请描述预期效益' }]} // Kept rule from New.js
          >
            <TextArea
              placeholder="请描述实施该建议后的预期效益..." // Text from CreateSuggestion
              rows={isMobile ? 3 : 4} // Kept responsive rows from New.js
              maxLength={1000} // Kept from New.js (CreateSuggestion had no explicit maxLength here)
              showCount
            />
          </Form.Item>

          <Form.Item
            label="附件上传" // Label from CreateSuggestion
            name="attachments" // Added name to Form.Item for consistency, though Upload is not directly a form input
            extra="支持JPG、PNG、PDF、DOCX等格式文件，单个文件不超过10MB，最多上传5个文件" // More detailed extra text from CreateSuggestion
          >
            <Upload {...uploadProps} > {/* Using merged uploadProps */}
              <Button icon={<UploadOutlined />} disabled={isRestrictedUser}>选择文件</Button>
            </Upload>
          </Form.Item>

          <Form.Item>
            <Space style={{ 
              display: isMobile ? 'flex' : 'inline-flex',
              flexDirection: isMobile ? 'column' : 'row',
              width: isMobile ? '100%' : 'auto'
            }}>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={submitting} // Changed from loading
                disabled={isRestrictedUser}
                style={{ width: isMobile ? '100%' : 'auto' }}
              >
                提交建议
              </Button>
              <Button 
                onClick={() => navigate('/suggestions/list')} // Kept navigation from New.js
                style={{ width: isMobile ? '100%' : 'auto' }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default NewSuggestion; 