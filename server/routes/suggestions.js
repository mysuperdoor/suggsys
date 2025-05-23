const express = require('express');
const router = express.Router();
const { check, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const { Suggestion, SUGGESTION_STATUS } = require('../models/Suggestion');
const { User, ROLES } = require('../models/User'); // ROLES is already imported
const { SUGGESTION_TYPES, IMPLEMENTATION_STATUS, SUGGESTION_STATUS: SUGGESTION_STATUS_FROM_CONST } = require('../../client/src/constants/suggestions');
const suggestionController = require('../controllers/suggestionController');
const reviewController = require('../controllers/reviewController');
const { checkRole } = require('../middleware/roleMiddleware'); // checkRole is imported
const { validateSuggestion } = require('../middleware/validationMiddleware');
const uploadMiddleware = require('../middleware/uploadMiddleware');
// Import specific role checkers from admin.js
const { 
  checkShiftSupervisorRole, 
  checkAnyAdminRole, 
  checkDepartmentManagerRole 
} = require('../middleware/admin');

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    // 确保上传目录存在
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // 保存原始文件名，不进行任何改变
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Custom role checkers (checkTeamMemberRole, checkSupervisorRole, checkAdminRole, checkManagerRole) will be removed from here.

// 检查评分权限中间件
// This middleware (checkScorePermission) is complex and context-specific, so it remains.
const checkScorePermission = async (req, res, next) => {
  try {
    // 部门经理有权限评分所有建议
    if (req.user.role === '部门经理') {
      return next();
    }

    // 获取建议信息
    const suggestion = await Suggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ msg: '建议不存在' });
    }

    // 判断建议类型
    const isSafetyType = suggestion.type === 'SAFETY' || suggestion.type === '安全管理';

    // 安全科管理人员只能评分安全类建议
    if (req.user.role === '安全科管理人员' && isSafetyType) {
      return next();
    }

    // 运行科管理人员只能评分非安全类建议
    if (req.user.role === '运行科管理人员' && !isSafetyType) {
      return next();
    }

    // 其他情况无权限
    return res.status(403).json({ msg: '没有评分权限', userMessage: '您只能评分您负责审核类型的建议' });
  } catch (error) {
    console.error('检查评分权限错误:', error);
    return res.status(500).json({ msg: '服务器错误' });
  }
};

// @route   GET api/suggestions/create
// @desc    获取创建建议所需的初始数据
// @access  Private
router.get('/create', auth, async (req, res) => {
  try {
    // 返回创建建议所需的枚举数据
    res.json({
      types: Object.entries(SUGGESTION_TYPES).map(([key, value]) => ({
        value: key,
        label: value
      })),
      currentUser: {
        id: req.user.id,
        name: req.user.name,
        team: req.user.team,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('获取创建建议数据失败:', error);
    res.status(500).json({ 
      message: '获取创建建议数据失败', 
      error: error.message 
    });
  }
});

// @route   POST api/suggestions
// @desc    创建新建议
// @access  Private
// The `validateSuggestion` middleware was a placeholder in the original route and is not used.
// The actual validation logic was manual and has been moved to the controller.
router.post('/', auth, upload.array('files', 5), suggestionController.createSuggestion);

// 添加健康检查和错误日志路由
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

router.get('/error-log', auth, checkDepartmentManagerRole, (req, res) => { // Replaced checkManagerRole
  try {
    const logPath = path.join(__dirname, '../logs/error.log');
    if (fs.existsSync(logPath)) {
      const log = fs.readFileSync(logPath, 'utf8');
      res.json({ log });
    } else {
      res.json({ log: '日志文件不存在' });
    }
  } catch (error) {
    res.status(500).json({ message: '获取错误日志失败', error: error.message });
  }
});

// @route   GET api/suggestions
// @desc    获取建议列表（根据用户角色和权限过滤）
// @access  Private
router.get('/', auth, suggestionController.getSuggestions);

// @route   GET api/suggestions/:id
// @desc    获取单个建议详情
// @access  Private
router.get('/:id', auth, suggestionController.getSuggestionById);

// @route   DELETE api/suggestions/:id
// @desc    删除建议 (部门经理或未通过二级审核的建议提交者)
// @access  Private
router.delete(
  '/:id',
  auth,
  suggestionController.deleteSuggestion
);

// @route   PUT api/suggestions/:id/first-review
// @desc    一级审核（值班主任）
// @access  Private (值班主任及以上)
router.put(
  '/:id/first-review',
  [
    auth, 
    checkShiftSupervisorRole, // Replaced checkSupervisorRole
    [
      check('approved', '必须指定是否批准').exists(),
      check('comments', '必须提供审核意见').not().isEmpty()
    ]
  ],
  suggestionController.firstReview
);

// @route   PUT api/suggestions/:id/second-review
// @desc    二级审核（安全科/运行科管理人员）
// @access  Private (管理人员及以上)
router.put(
  '/:id/second-review',
  [
    auth, 
    checkAnyAdminRole, // Replaced checkAdminRole
    [
      check('approved', '必须指定是否批准').exists(),
      check('comments', '必须提供审核意见').not().isEmpty()
    ]
  ],
  suggestionController.secondReview
);

// @route   PUT api/suggestions/:id/implementation
// @desc    更新建议实施状态
// @access  Private (管理人员及以上)
router.put(
  '/:id/implementation',
  [
    auth, 
    checkAnyAdminRole, // Replaced checkAdminRole
    // 修正验证规则
    [
      check('status', '必须提供有效的实施状态')
        .isIn(Object.keys(IMPLEMENTATION_STATUS)), // 使用导入的 IMPLEMENTATION_STATUS 的 key
      check('responsiblePerson', '必须指定责任人')
        .not().isEmpty()
        .isString(),
      check('notes', '必须提供状态更新说明') // 验证 notes 字段
        .not().isEmpty()
        .isString(),
      check('startDate', '开始日期格式无效')
        .optional({ checkFalsy: true }) // 允许空字符串或 null
        .isISO8601(),
      check('plannedCompletionDate', '计划完成日期格式无效') // 对应前端 plannedEndDate
        .optional({ checkFalsy: true })
        .isISO8601(),
      check('actualCompletionDate', '实际完成日期格式无效') // 对应前端 actualEndDate
        .optional({ checkFalsy: true })
        .isISO8601(),
      check('completionRate', '完成率必须是0-100的数字')
        .optional({ checkFalsy: true })
        .isInt({ min: 0, max: 100 })
    ]
  ],
  // 添加验证结果处理中间件
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('更新实施状态验证失败:', errors.array());
      // 返回第一个错误信息给前端
      return res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });
    }
    next(); // 验证通过，继续执行下一个处理器
  },
  // 指向正确的控制器函数
  suggestionController.updateImplementation 
  // 移除旧的内联处理器
  /* async (req, res) => { ... } */
);

// @route   POST api/suggestions/upload
// @desc    上传文件
// @access  Private
router.post('/upload', auth, upload.single('file'), (req, res) => {
  try {
    res.json({
      fileUrl: `/uploads/${req.file.filename}`
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('文件上传失败');
  }
});

// @route   PUT api/suggestions/:id/status
// @desc    更新建议状态
// @access  Private (管理人员及以上)
router.put(
  '/:id/status',
  [
    auth,
    [
      check('status', '状态不能为空').not().isEmpty(),
      check('status', '无效的状态').isIn(['待审核', '已通过', '已拒绝', '处理中', '已完成']),
      check('comment', '审核意见不能为空').not().isEmpty()
    ]
  ],
  suggestionController.updateSuggestionStatus
);

// @route   POST api/suggestions/:id/comments
// @desc    添加评论
// @access  Private (管理人员及以上)
router.post(
  '/:id/comments',
  [
    auth,
    [
      check('content', '评论内容不能为空').not().isEmpty()
    ]
  ],
  suggestionController.addComment
);

// @route   POST api/suggestions/:id/score
// @desc    为建议打分
// @access  Private (Manager, Safety Admin for safety suggestions, Operations Admin for non-safety suggestions)
router.post('/:id/score', auth, checkScorePermission, suggestionController.scoreSuggestion);

// @route   PUT api/suggestions/:id
// @desc    修改建议
// @access  Private
router.put('/:id', [
  auth,
  [
    check('title', '标题不能为空').optional().not().isEmpty(),
    check('type', '建议类型不能为空').optional().not().isEmpty()
      .isIn(Object.keys(SUGGESTION_TYPES)).withMessage('无效的建议类型'),
    check('content', '内容不能为空').optional().not().isEmpty(),
    check('reason', '修改原因不能为空').optional()
  ]
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const suggestion = await Suggestion.findById(req.params.id);
    
    if (!suggestion) {
      return res.status(404).json({ msg: '建议不存在' });
    }

    // 检查权限：只有提交者本人可以修改，且仅限于未开始审核的建议
    console.log('routes层 - 当前用户ID:', req.user.id);
    console.log('routes层 - 建议的submitter:', suggestion.submitter);
    console.log('routes层 - suggestion对象:', JSON.stringify(suggestion, null, 2));
    
    // 确保正确比较MongoDB ObjectId
    const submitterId = typeof suggestion.submitter === 'object' ? 
                       suggestion.submitter.toString() : 
                       suggestion.submitter;
    
    // 确保用户ID也是字符串格式
    const userId = req.user.id.toString();
    
    console.log('routes层 - 转换后的submitterId:', submitterId);
    console.log('routes层 - 转换后的userId:', userId);
    
    if (!submitterId || submitterId !== userId) {
      return res.status(403).json({ 
        msg: '没有修改权限',
        userMessage: '没有修改权限',
        debug: {
          userId: req.user.id,
          submitterId: submitterId
        }
      });
    }

    // 允许在等待一级审核状态下修改
    console.log('routes层 - 建议状态:', suggestion.status);
    console.log('routes层 - 建议reviewStatus:', suggestion.reviewStatus);
    
    // 直接使用字符串比较，避免使用可能未定义的常量
    // 注意：数据库中存储的是reviewStatus字段
    if (suggestion.reviewStatus !== 'PENDING_FIRST_REVIEW') {
      return res.status(400).json({ msg: '建议已进入审核流程，无法修改' });
    }

    const { title, type, content, expectedBenefit, reason } = req.body;

    // 不使用不存在的revisionHistory字段
    // 直接更新建议内容
    if (title) suggestion.title = title;
    if (type) suggestion.type = type;
    if (content) suggestion.content = content;
    if (expectedBenefit) suggestion.expectedBenefit = expectedBenefit;
    
    // 在comments字段中只添加修改内容和日期
    if (reason) {
      suggestion.comments.push({
        content: `修改原因: ${reason}`,
        author: req.user.id,
        createdAt: new Date()
      });
    }

    await suggestion.save();
    res.json(suggestion);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('服务器错误');
  }
});



// @route   GET api/suggestions/all
// @desc    获取所有建议
// @access  Private
router.get('/all', auth, suggestionController.getAllSuggestions);

// @route   GET api/suggestions/department/:departmentId
// @desc    获取特定部门的建议
// @access  Private
router.get('/department/:departmentId', auth, suggestionController.getSuggestionsByDepartment);

// @route   GET api/suggestions/team/:teamId
// @desc    获取特定团队的建议
// @access  Private
router.get('/team/:teamId', auth, suggestionController.getSuggestionsByTeam);

// @route   GET api/suggestions/user
// @desc    获取用户提交的建议
// @access  Private
router.get('/user', auth, suggestionController.getUserSuggestions);

// @route   GET api/suggestions/pending-review
// @desc    获取待审核的建议
// @access  Private
router.get('/pending-review', auth, suggestionController.getPendingReviewSuggestions);

// @route   GET api/suggestions/:id/implementation-records
// @desc    获取实施记录
// @access  Private
router.get('/:id/implementation-records', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const suggestion = await Suggestion.findById(id);
    
    if (!suggestion) {
      return res.status(404).json({ message: '未找到建议' });
    }
    
    // 获取实施记录
 const implementation = await Implementation.findOne({ suggestion: suggestion._id })
      .populate('statusHistory.updatedBy', 'name username role')
      .lean();
    
    if (!implementation || !implementation.statusHistory) {
      return res.status(200).json([]);
    }
    
    // 转换状态为中文显示并按时间排序
    const records = implementation.statusHistory.map(record => ({
      id: record._id,
      status: record.status,
      comments: record.comments,
      updatedBy: record.updatedBy,
      updatedAt: record.timestamp
    })).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    res.status(200).json(records);
  } catch (error) {
    console.error('获取实施记录失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
});

// 提交审核
router.post('/review', auth, suggestionController.submitReview);

module.exports = router; 