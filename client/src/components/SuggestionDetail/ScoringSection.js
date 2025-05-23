import React from 'react';
import { Card, Row, Col, Tag, Typography, Timeline, Avatar } from 'antd';
import { StarOutlined, UserOutlined, TeamOutlined, CalendarOutlined } from '@ant-design/icons';

const { Text } = Typography;

const ScoringSection = ({ scoring, isMobile }) => {
  if (!scoring || scoring.score === undefined) return null;
  
  const styles = {
    card: {
      borderRadius: '10px',
      marginBottom: '16px',
      borderLeft: '3px solid #faad14'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '16px'
    },
    icon: {
      fontSize: '18px',
      marginRight: '8px',
      color: '#faad14'
    },
    title: {
      margin: 0,
      fontWeight: 'bold'
    },
    scoreTag: {
      borderRadius: '12px',
      padding: '2px 10px',
      fontWeight: 'bold',
      fontSize: '14px',
      marginLeft: '8px'
    },
    infoItem: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '12px'
    },
    infoIcon: {
      marginRight: '8px',
      color: '#1890ff'
    },
    infoLabel: {
      fontWeight: 'bold',
      marginRight: '8px'
    },
    timelineItem: {
      padding: '8px 0'
    },
    historyScore: {
      fontWeight: 'bold',
      fontSize: '16px',
      color: '#faad14',
      marginLeft: '8px'
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '未知';
    return new Date(dateString).toLocaleString();
  };

  return (
    <Card
      type="inner"
      style={styles.card}
      bodyStyle={{ padding: isMobile ? '16px' : '20px' }}
    >
      <div style={styles.header}>
        <StarOutlined style={styles.icon} />
        <h3 style={styles.title}>建议评分</h3>
        <Tag 
          color="gold"
          style={styles.scoreTag}
        >
          {typeof scoring.score === 'number' ? scoring.score.toFixed(1) : '-'}
        </Tag>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12}>
          <div style={styles.infoItem}>
            <UserOutlined style={styles.infoIcon} />
            <span style={styles.infoLabel}>评分人:</span>
            <Avatar 
              size="small" 
              style={{ marginRight: '8px', backgroundColor: '#faad14' }}
            >
              {scoring.scorer?.name ? scoring.scorer.name.charAt(0) : '?'}
            </Avatar>
            <Text>{scoring.scorer?.name || '未知'}</Text>
          </div>
        </Col>
        
        <Col xs={24} sm={12}>
          <div style={styles.infoItem}>
            <TeamOutlined style={styles.infoIcon} />
            <span style={styles.infoLabel}>角色:</span>
            <Tag color="blue">
              {scoring.scorer?.role || scoring.scorerRole || '未知角色'}
            </Tag>
          </div>
        </Col>
        
        <Col xs={24}>
          <div style={styles.infoItem}>
            <CalendarOutlined style={styles.infoIcon} />
            <span style={styles.infoLabel}>评分时间:</span>
            <Text>{formatDate(scoring.scoredAt)}</Text>
          </div>
        </Col>
      </Row>
      
      {scoring.history && scoring.history.length > 0 && (
        <>
          <div style={{ marginTop: '16px', marginBottom: '8px', fontWeight: 'bold' }}>评分历史</div>
          <Timeline style={{ marginTop: 12 }}>
            {scoring.history.map((record, index) => (
              <Timeline.Item 
                key={index} 
                color="gold" 
                dot={<StarOutlined style={{ fontSize: '16px' }} />}
              >
                <div style={styles.timelineItem}>
                  <div>
                    <Avatar 
                      size="small" 
                      style={{ marginRight: '8px', backgroundColor: '#1890ff' }}
                    >
                      {record.scorer?.name ? record.scorer.name.charAt(0) : '?'}
                    </Avatar>
                    <Text strong>{record.scorer?.name || '未知用户'}</Text>
                    <Tag color="blue" style={{ margin: '0 8px' }}>
                      {record.scorer?.role || record.scorerRole || '未知角色'}
                    </Tag>
                  </div>
                  <div style={{ marginTop: '4px', marginLeft: '28px', color: '#888' }}>
                    {formatDate(record.scoredAt)} 
                    评分为 <span style={styles.historyScore}>
                      {typeof record.score === 'number' ? record.score.toFixed(1) : '?'}
                    </span>
                  </div>
                </div>
              </Timeline.Item>
            ))}
          </Timeline>
        </>
      )}
    </Card>
  );
};

export default ScoringSection; 