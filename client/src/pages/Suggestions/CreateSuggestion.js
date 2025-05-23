import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Select, Upload, message, Typography, Card, Space } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { suggestionService } from '../services/suggestionService';
import axios from 'axios';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const CreateSuggestion = () => {
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [typeOptions, setTypeOptions] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    // 获取建议类型数据
    const fetchCreateData = async () => {
      try {
        const data = await suggestionService.getCreateData();
        console.log('获取创建建议数据:', data);
        if (data && data.types) {
          setTypeOptions(data.types);
        }
      } catch (error) {
        console.error('获取初始数据失败:', error);
        message.error('获取数据失败，请刷新页面重试');
      }
    };

    fetchCreateData();
  }, []);

  const onFinish = async (values) => {
    if (fileList.length > 5) {
      message.error('最多只能上传5个文件');
      return;
    }

    try {
      setUploading(true);
      
      // 创建FormData对象，用于文件上传
      const formData = new FormData();
      
      // 添加表单字段 - 确保所有值都是字符串
      formData.append('title', String(values.title || ''));
      formData.append('type', String(values.type || ''));
      formData.append('content', String(values.content || ''));
      formData.append('expectedBenefit', String(values.expectedBenefit || ''));
      
      // 添加文件
      fileList.forEach(file => {
        formData.append('files', file);
      });
      
      // 调试输出
      console.log('提交的表单数据:');
      for (let [key, value] of formData.entries()) {
        console.log(`${key}: ${value instanceof File ? `文件(${value.name}, ${value.size}字节)` : value}`);
      }
      
      // 直接使用axios发送请求
      const token = localStorage.getItem('token');
      if (!token) {
        message.error('未登录或会话已过期，请重新登录');
        navigate('/login');
        return;
      }
      
      const response = await axios.post('http://localhost:5000/api/suggestions', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`
        }
      });
      
      console.log('提交成功，响应数据:', response.data);
      message.success('建议提交成功！');
      form.resetFields();
      setFileList([]);
      // 跳转到建议列表页
      navigate('/suggestions');
    } catch (error) {
      console.error('提交失败:', error);
      
      if (error.response) {
        console.error('错误响应数据:', error.response.data);
        
        if (error.response.data.errors) {
          const errorMessages = error.response.data.errors.map(err => err.msg).join(', ');
          message.error(`提交失败: ${errorMessages}`);
        } else if (error.response.data.message) {
          message.error(`提交失败: ${error.response.data.message}`);
        } else {
          message.error('提交失败，请检查表单数据是否符合要求');
        }
      } else if (error.request) {
        // 请求已发送但没有收到响应
        message.error('服务器无响应，请检查网络连接');
      } else {
        // 请求设置时出现错误
        message.error(`请求错误: ${error.message}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const props = {
    onRemove: (file) => {
      const index = fileList.indexOf(file);
      const newFileList = fileList.slice();
      newFileList.splice(index, 1);
      setFileList(newFileList);
    },
    beforeUpload: (file) => {
      // 限制文件大小 (10MB)
      const isLt10M = file.size / 1024 / 1024 < 10;
      if (!isLt10M) {
        message.error('文件不能超过10MB!');
        return false;
      }
      
      setFileList([...fileList, file]);
      return false;
    },
    fileList,
  };

  return (
    <div>
      <Title level={2}>提交合理化建议</Title>
      
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ type: 'SAFETY' }}
        >
          <Form.Item
            name="title"
            label="建议标题"
            rules={[
              { required: true, message: '请输入建议标题' },
              { max: 100, message: '标题不能超过100个字符' }
            ]}
          >
            <Input placeholder="请输入建议标题" maxLength={100} />
          </Form.Item>

          <Form.Item
            name="type"
            label="建议类型"
            rules={[{ required: true, message: '请选择建议类型' }]}
          >
            <Select>
              {typeOptions.length > 0 ? (
                typeOptions.map(option => (
                  <Option key={option.value} value={option.value}>
                    {option.label}
                  </Option>
                ))
              ) : (
                <>
                  <Option value="SAFETY">安全管理</Option>
                  <Option value="PRODUCTION">生产优化</Option>
                  <Option value="AUTOMATION">智能化升级</Option>
                  <Option value="OTHER">其它</Option>
                </>
              )}
            </Select>
          </Form.Item>

          <Form.Item
            name="content"
            label="建议内容"
            rules={[
              { required: true, message: '请输入建议内容' },
              { min: 20, message: '内容不能少于20个字符' }
            ]}
          >
            <TextArea rows={6} placeholder="请详细描述您的合理化建议（不少于20个字符）..." />
          </Form.Item>

          <Form.Item
            name="expectedBenefit"
            label="预期效益"
            rules={[{ required: true, message: '请描述预期效益' }]}
          >
            <TextArea rows={4} placeholder="请描述实施该建议后的预期效益..." />
          </Form.Item>

          <Form.Item
            name="attachments"
            label="附件上传"
            extra="支持JPG、PNG、PDF、DOCX等格式文件，单个文件不超过10MB，最多上传5个文件"
          >
            <Upload {...props}>
              <Button icon={<UploadOutlined />}>选择文件</Button>
            </Upload>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={uploading}>
                提交建议
              </Button>
              <Button onClick={() => navigate('/suggestions')}>
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default CreateSuggestion; 