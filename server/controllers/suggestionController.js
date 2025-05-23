const { Suggestion } = require('../models/Suggestion'); // Removed SUGGESTION_STATUS
const { User } = require('../models/User');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { validationResult } = require('express-validator');
const { validateSuggestion } = require('../utils/validation');
// const { Review, REVIEW_LEVELS, REVIEW_RESULTS } = require('../models/Review'); // DEPRECATED, model file is commented out
const { notifyReviewers } = require('../utils/notificationUtils');
// 导入前端定义的常量
const { REVIEW_STATUS, IMPLEMENTATION_STATUS, SUGGESTION_TYPES } = require('../../client/src/constants/suggestions'); // Added SUGGESTION_TYPES
const Logger = require('../utils/logger');

const logger = new Logger('SuggestionController');

// 审核状态常量 // Removed local REVIEW_STATUS

exports.getSuggestions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { 
      reviewStatus, 
      implementationStatus, 
      responsiblePersonId, 
      submitterId, 
      type, 
      team, 
      title,
      sortBy,
      sortOrder
    } = req.query;

    logger.debug('查询参数:', { page, limit, skip, reviewStatus, implementationStatus, responsiblePersonId, submitterId, type, team, title, sortBy, sortOrder });
    logger.debug('当前用户:', req.user);

    let query = {};
    
    if (title) {
      query.title = { $regex: title, $options: 'i' };
      logger.debug('应用 title 文本搜索 (regex):', query.title);
    }

    // -- 1. 应用前端传入的显式过滤条件 --
    if (reviewStatus) {
      // 支持单个状态或逗号分隔的多个状态
      const statuses = reviewStatus.split(',').map(s => s.trim());
      query.reviewStatus = { $in: statuses };
      logger.debug('应用 reviewStatus 过滤:', query.reviewStatus);
    }
    if (type) {
      const types = type.split(',').map(t => t.trim());
      query.type = { $in: types };
      logger.debug('应用 type 过滤:', query.type);
    }
    if (team) {
      const teams = team.split(',').map(t => t.trim());
      query.team = { $in: teams };
      logger.debug('应用 team 过滤:', query.team);
    }
    
    // -- 2. 应用基于用户角色的权限过滤 (如果前端没有指定更具体的 submitterId 或 responsiblePersonId) --
    // 注意：responsiblePersonId 的过滤需要在获取实施信息后进行，或使用聚合管道
    
    let filterByUserPermission = true; // 默认应用权限过滤
    let implementationQuery = {}; // 用于后续查询 Implementation
    
    if (responsiblePersonId && responsiblePersonId === req.user.id) {
        // 如果查询的是 "我负责的"，那么建议本身不需要加 submitter 限制
        // 但需要后续过滤实施信息
        implementationQuery.responsiblePerson = req.user.id; 
        filterByUserPermission = false; // 不再应用下面的通用角色过滤
        logger.debug('按 responsiblePersonId 过滤实施信息:', implementationQuery);
    } else if (submitterId && submitterId === req.user.id) {
        // 如果查询的是 "我提交的"，直接添加到主查询
        query.submitter = req.user.id;
        filterByUserPermission = false; // 不再应用下面的通用角色过滤
        logger.debug('按 submitterId 过滤:', query.submitter);
    }
    
    if (filterByUserPermission) {
        logger.debug('应用基于角色的权限过滤...');
        if (req.user.role === '班组人员') {
          // 班组成员默认只能看到自己的建议
          query.submitter = req.user.id;
        } else if (req.user.role === '值班主任') {
          // 值班主任默认可以看到自己班组的所有建议
          const { TEAMS } = require('../models/User');
          let teamValue = req.user.team;
          let teamKey = Object.keys(TEAMS).find(key => TEAMS[key] === req.user.team);
          if (teamKey) {
            query.$or = [ { team: teamValue }, { team: teamKey } ];
          } else {
            query.team = teamValue;
          }
        } else if (req.user.role === '安全科管理人员') {
          // 安全科管理人员只能看到安全类建议
          query.type = SUGGESTION_TYPES.SAFETY;
        } else if (req.user.role === '运行科管理人员') {
          // 运行科管理人员只能看到非安全类建议
          query.type = { $ne: SUGGESTION_TYPES.SAFETY };
        }
        // 部门经理默认看到所有建议 (无需修改)
    }

    logger.debug('最终主查询条件 (Suggestion):', query);
    // console.log('实施信息过滤条件 (Implementation):', implementationQuery); // 移除独立实施查询日志

    // 如果按 responsiblePerson 或 implementationStatus 过滤，需要调整主查询条件
    if (responsiblePersonId && responsiblePersonId === req.user.id) {
      // 直接在主查询中添加对嵌套字段的查询
      query['implementation.responsiblePerson'] = req.user.id;
      logger.debug('在主查询中添加 implementation.responsiblePerson 过滤');
    }
    if (implementationStatus) {
      const implStatuses = implementationStatus.split(',').map(s => s.trim());
      // 直接在主查询中添加对嵌套字段的查询
      query['implementation.status'] = { $in: implStatuses }; 
      logger.debug('在主查询中添加 implementation.status 过滤:', query['implementation.status']);
    }

    // 重新计算总数 (应用了所有过滤条件)
    const total = await Suggestion.countDocuments(query);
    logger.debug('总记录数 (应用所有过滤后):', total);

    // 构建排序选项
    let sortOptions = {};
    if (sortBy && sortOrder) {
      // 将 Ant Design 的 'ascend'/'descend' 转换为 mongoose 的 1/-1 或 'asc'/'desc'
      const order = (sortOrder === 'ascend' || sortOrder === 'asc') ? 1 : -1;
      // 特别处理嵌套字段
      if (sortBy === 'score') {
        sortOptions['scoring.score'] = order;
      } else {
        sortOptions[sortBy] = order;
      }
      logger.debug('应用排序:', sortOptions);
    } else {
      // 默认按创建时间降序排序
      sortOptions = { createdAt: -1 };
      logger.debug('应用默认排序:', sortOptions);
    }

    // 获取建议列表 (基于最终查询条件和排序)
    let suggestions = await Suggestion.find(query)
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview.reviewer', // 填充嵌套审核人
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'secondReview.reviewer', // 填充嵌套审核人
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'implementation.history.updatedBy', // 尝试填充实施历史更新人
        select: 'name', // Optimized selection
        model: 'User'
      })
      // 应用排序选项
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean(); // 使用lean()提高性能

    logger.debug(`找到 ${suggestions.length} 条建议`);

    // -- 4. 处理数据 (不再需要合并，确保嵌套数据完整) --
    let processedSuggestions = suggestions.map(suggestion => {
      // const implementation = implementationMap[suggestion._id.toString()]; // 移除合并
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : [],
        implementation: suggestion.implementation || null // 直接使用嵌套的实施信息
      };
    });
    // 移除 filter 逻辑，因为过滤已在主查询完成
    /*
    .filter(suggestion => {
        if (responsiblePersonId && responsiblePersonId === req.user.id) {
            return !!suggestion.implementation;
        }
        return true;
    });
    */

    logger.debug(`最终处理后 ${processedSuggestions.length} 条建议`);

    // 分页总数现在是准确的
    let finalTotal = total;
    /*
    if (responsiblePersonId && responsiblePersonId === req.user.id) { ... }
    if (implementationStatus) { ... }
    */

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        // total // 使用调整后的 total
        total: finalTotal 
      }
    });
  } catch (error) {
    logger.error('获取建议列表失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

exports.getSuggestionById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const suggestion = await Suggestion.findById(id)
      .populate('submitter', 'name username department team')
      .populate({
        path: 'firstReview',
        populate: {
          path: 'reviewer',
          select: 'name username role'
        }
      })
      .populate({
        path: 'secondReview',
        populate: {
          path: 'reviewer',
          select: 'name username role'
        }
      })
      .populate({
        path: 'comments.author',
        select: 'name username role'
      })
      .populate({
        path: 'scoring.scorer', // 添加对打分人的 populate
        select: 'name username role'
      })
      .populate({
        path: 'scoring.history.scorer', // 添加对评分历史记录中评分人的 populate
        select: 'name username role'
      })
      .populate({
        path: 'implementation.history.updatedBy', // 确保填充实施历史操作人
        select: 'name username role',
        model: 'User'
      });
    
    if (!suggestion) {
      return res.status(404).json({ message: '未找到建议' });
    }
    
    // 不再需要查询独立的 Implementation 模型
    /*
    const { Implementation } = require('../models/Implementation');
    const implementation = await Implementation.findOne({ suggestion: suggestion._id })
      .populate('implementer', 'name username department')
      .populate('statusHistory.updatedBy', 'name username role')
      .lean();
    */
    
    // 直接使用 suggestion 中的嵌套实施信息
    const suggestionWithImplementation = suggestion.toObject();
    // suggestion.implementation 应该已经包含在 suggestion 中
    // suggestionWithImplementation.implementation = implementation || null; 
    
    res.json(suggestionWithImplementation);
  } catch (error) {
    logger.error('获取建议详情失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

// TODO: Review for removal or refactoring to use reviewStatus/implementationStatus
// exports.updateSuggestionStatus = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({ errors: errors.array() });
//     }
// 
//     const { status, comment } = req.body;
//     const suggestion = await Suggestion.findById(req.params.id);
// 
//     if (!suggestion) {
//       return res.status(404).json({ message: '建议不存在' });
//     }
// 
//     // 检查权限
//     if (req.user.role !== '部门经理') {
//       return res.status(403).json({ message: '没有权限更新建议状态' });
//     }
// 
//     // 更新状态
//     suggestion.status = status;
//     
//     // 添加评论
//     if (comment) {
//       suggestion.comments.push({
//         author: req.user.id,
//         content: comment
//       });
//     }
// 
//     await suggestion.save();
// 
//     // 返回更新后的建议
//     const updatedSuggestion = await Suggestion.findById(req.params.id)
//       .populate('submitter', 'name team')
//       .populate({
//         path: 'comments.author',
//         select: 'name',
//         model: 'User'
//       })
//       .populate({
//         path: 'firstReview secondReview',
//         populate: {
//           path: 'reviewer',
//           select: 'name',
//           model: 'User'
//         }
//       })
//       .lean();
// 
//     // 处理null值
//     const processedSuggestion = {
//       ...updatedSuggestion,
//       submitter: updatedSuggestion.submitter || { name: '未知用户', _id: null },
//       comments: Array.isArray(updatedSuggestion.comments) ? updatedSuggestion.comments.map(comment => ({
//         ...comment,
//         author: comment.author || { name: '未知用户' }
//       })) : []
//     };
// 
//     res.json(processedSuggestion);
//   } catch (error) {
//     logger.error('更新建议状态失败:', error);
//     res.status(500).json({ message: '更新建议状态失败', error: error.message });
//   }
// };

exports.addComment = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const suggestion = await Suggestion.findById(req.params.id);

    if (!suggestion) {
      return res.status(404).json({ message: '建议不存在' });
    }

    // 添加评论
    suggestion.comments.push({
      author: req.user.id,
      content: req.body.content
    });

    await suggestion.save();

    // 返回更新后的建议
    const updatedSuggestion = await Suggestion.findById(req.params.id)
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .lean();

    // 处理null值
    const processedSuggestion = {
      ...updatedSuggestion,
      submitter: updatedSuggestion.submitter || { name: '未知用户', _id: null },
      comments: Array.isArray(updatedSuggestion.comments) ? updatedSuggestion.comments.map(comment => ({
        ...comment,
        author: comment.author || { name: '未知用户' }
      })) : []
    };

    res.json(processedSuggestion);
  } catch (error) {
    logger.error('添加评论失败:', error);
    res.status(500).json({ message: '添加评论失败', error: error.message });
  }
};

/**
 * 获取所有建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getAllSuggestions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 获取总数
    const total = await Suggestion.countDocuments();
    
    // 获取建议列表
    const suggestions = await Suggestion.find()
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 处理null的submitter字段
    const processedSuggestions = suggestions.map(suggestion => {
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : []
      };
    });

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        total
      }
    });
  } catch (error) {
    logger.error('获取所有建议失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

/**
 * 获取特定部门的建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getSuggestionsByDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 获取总数
    const total = await Suggestion.countDocuments({ department: departmentId });
    
    // 获取建议列表
    const suggestions = await Suggestion.find({ department: departmentId })
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 处理null的submitter字段
    const processedSuggestions = suggestions.map(suggestion => {
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : []
      };
    });

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        total
      }
    });
  } catch (error) {
    logger.error('获取部门建议失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

/**
 * 获取特定团队的建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getSuggestionsByTeam = async (req, res) => {
  try {
    const { teamId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 获取总数
    const total = await Suggestion.countDocuments({ team: teamId });
    
    // 获取建议列表
    const suggestions = await Suggestion.find({ team: teamId })
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 处理null的submitter字段
    const processedSuggestions = suggestions.map(suggestion => {
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : []
      };
    });

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        total
      }
    });
  } catch (error) {
    logger.error('获取团队建议失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

/**
 * 获取用户提交的建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getUserSuggestions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 获取总数
    const total = await Suggestion.countDocuments({ submitter: req.user.id });
    
    // 获取建议列表
    const suggestions = await Suggestion.find({ submitter: req.user.id })
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 处理null的submitter字段
    const processedSuggestions = suggestions.map(suggestion => {
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : []
      };
    });

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        total
      }
    });
  } catch (error) {
    logger.error('获取用户建议失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

/**
 * 获取待审核的建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getPendingReviewSuggestions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // 构建查询条件
    const query = {};
    const userRole = req.user.role;
    const userTeam = req.user.team;

    logger.debug('获取待审核建议 - 用户信息:', {
      userRole,
      userTeam
    });

    if (userRole === '值班主任') {
      // 值班主任可以看到所有待一级审核的建议
      query.reviewStatus = REVIEW_STATUS.PENDING_FIRST_REVIEW;
      logger.debug('值班主任查询条件:', query);
    } else if (userRole === '安全科管理人员') {
      // 安全科管理人员只能看到安全类的待二级审核的建议
      query.type = SUGGESTION_TYPES.SAFETY;
      query.reviewStatus = REVIEW_STATUS.PENDING_SECOND_REVIEW;
      logger.debug('安全科管理人员查询条件:', query);
    } else if (userRole === '运行科管理人员') {
      // 运行科管理人员只能看到非安全类的待二级审核的建议
      query.type = { $ne: SUGGESTION_TYPES.SAFETY };
      query.reviewStatus = REVIEW_STATUS.PENDING_SECOND_REVIEW;
      logger.debug('运行科管理人员查询条件:', query);
    } else if (userRole === '部门经理') {
      // 部门经理可以看到所有待审核的建议
      query.reviewStatus = { $in: [REVIEW_STATUS.PENDING_FIRST_REVIEW, REVIEW_STATUS.PENDING_SECOND_REVIEW] };
      logger.debug('部门经理查询条件:', query);
    }

    // 获取总数
    const total = await Suggestion.countDocuments(query);
    logger.debug(`找到 ${total} 条待审核建议`);
    
    // 获取建议列表
    const suggestions = await Suggestion.find(query)
      .populate('submitter', 'name team')
      .populate({
        path: 'comments.author',
        select: 'name',
        model: 'User'
      })
      .populate({
        path: 'firstReview secondReview',
        populate: {
          path: 'reviewer',
          select: 'name',
          model: 'User'
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // 处理null的submitter字段
    const processedSuggestions = suggestions.map(suggestion => {
      return {
        ...suggestion,
        submitter: suggestion.submitter || { name: '未知用户', _id: null },
        comments: Array.isArray(suggestion.comments) ? suggestion.comments.map(comment => ({
          ...comment,
          author: comment.author || { name: '未知用户' }
        })) : []
      };
    });

    res.json({
      suggestions: processedSuggestions,
      pagination: {
        current: page,
        pageSize: limit,
        total
      }
    });
  } catch (error) {
    logger.error('获取待审核建议失败:', error);
    res.status(500).json({ message: '获取建议列表失败', error: error.message });
  }
};

// 创建新建议
exports.createSuggestion = async (req, res) => {
  try {
    logger.debug('建议提交 - 请求体:', req.body);
    logger.debug('建议提交 - 上传文件:', req.files ? req.files.length : 0);

    // 检查用户权限 - 运行科和安全科管理人员不允许提交建议
    // This check was present in the old createSuggestion, but not in the route handler.
    // For equivalence with the *original route handler*, this specific check should be removed.
    // However, if this is a desired business rule, it should be consistently applied.
    // For this refactoring task, I will mirror the original route handler's logic.
    /*
    if (req.user && (req.user.role === '运行科管理人员' || req.user.role === '安全科管理人员')) {
      // If files were uploaded, they should be cleaned up
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlink(file.path, err => {
            if (err) logger.error('删除文件失败 (权限不足):', err);
          });
        });
      }
      return res.status(403).json({
        success: false, // Assuming a consistent error response structure
        message: '运行科和安全科管理人员暂时无法提交建议'
      });
    }
    */

    // 确保上传目录存在 (Multer usually handles this, but good for robustness)
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      logger.info('创建上传目录:', uploadDir);
    }

    // 手动验证请求数据 (mirroring the logic from the route)
    const errors = [];
    if (!req.body.title) {
      errors.push({ msg: '标题不能为空' });
    } else if (req.body.title.length > 100) {
      errors.push({ msg: '标题不能超过100个字符' });
    }
    if (!req.body.type) {
      errors.push({ msg: '请选择有效的建议类型' });
    } else if (!Object.keys(SUGGESTION_TYPES).includes(req.body.type)) {
      errors.push({ msg: '建议类型无效' });
    }
    if (!req.body.content) {
      errors.push({ msg: '内容不能为空' });
    } else if (req.body.content.length < 20) {
      errors.push({ msg: '内容不能少于20个字符' });
    }
    if (!req.body.expectedBenefit) {
      errors.push({ msg: '预期效果不能为空' }); // Original message was "预期效果不能为空"
    }

    if (errors.length > 0) {
      if (req.files && req.files.length > 0) {
        req.files.forEach(file => {
          fs.unlink(file.path, err => {
            if (err) logger.error('删除文件失败 (验证错误):', err);
          });
        });
      }
      // Original route returned: { message: errors[0].msg, errors: errors }
      // For consistency with other error responses, using 'message' for the primary error.
      return res.status(400).json({ message: errors[0].msg, errors: errors });
    }

    const { title, type, content, expectedBenefit } = req.body;

    // Files are in req.files, uploaded to temp directory.
    // Process file metadata first, but don't move them yet.
    let attachmentMetadata = [];
    if (req.files && req.files.length > 0) {
      attachmentMetadata = req.files.map(file => {
        const safeOriginalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        return {
          filename: file.filename, // This is the unique name given by Multer
          originalname: safeOriginalname,
          mimetype: file.mimetype,
          size: file.size,
          // Store temporary path for cleanup/move operations
          tempPath: file.path 
        };
      });
      logger.debug('Initial attachment metadata:', attachmentMetadata);
    }

    // If validation passed, now move files from temp to final directory
    const finalUploadDir = path.join(__dirname, '../uploads');
    const movedFiles = []; // To keep track of successfully moved files for potential rollback

    try {
      for (const fileMeta of attachmentMetadata) {
        const sourcePath = fileMeta.tempPath;
        const targetPath = path.join(finalUploadDir, fileMeta.filename);
        
        // Ensure final upload directory exists (it should from routes/suggestions.js, but good to double check)
        if (!fs.existsSync(finalUploadDir)) {
          fs.mkdirSync(finalUploadDir, { recursive: true });
        }

        await fs.promises.rename(sourcePath, targetPath);
        logger.debug(`Moved file from ${sourcePath} to ${targetPath}`);
        movedFiles.push(targetPath); // Add to moved files list
        // No need to update fileMeta.path as the schema doesn't store full path, only filename
      }
    } catch (moveError) {
      logger.error('Error moving files to final directory:', moveError);
      // Rollback: Delete already moved files
      for (const movedFilePath of movedFiles) {
        try {
          await fs.promises.unlink(movedFilePath);
          logger.debug(`Rolled back (deleted) moved file: ${movedFilePath}`);
        } catch (unlinkError) {
          logger.error(`Error rolling back (deleting) moved file ${movedFilePath}:`, unlinkError);
        }
      }
      // Delete remaining temp files for this request
      for (const fileMeta of attachmentMetadata) {
        if (fs.existsSync(fileMeta.tempPath)) { // Check if it wasn't moved and deleted
          try {
            await fs.promises.unlink(fileMeta.tempPath);
            logger.debug(`Cleaned up temp file after move error: ${fileMeta.tempPath}`);
          } catch (cleanupError) {
            logger.error(`Error cleaning up temp file ${fileMeta.tempPath} after move error:`, cleanupError);
          }
        }
      }
      return res.status(500).json({ message: 'Error processing attachments.', error: moveError.message });
    }

    // Prepare attachments for saving to DB (without tempPath)
    const attachmentsToSave = attachmentMetadata.map(meta => ({
      filename: meta.filename,
      originalname: meta.originalname,
      mimetype: meta.mimetype,
      size: meta.size
    }));

    const suggestion = new Suggestion({
      title,
      type,
      content,
      expectedBenefit,
      submitter: req.user.id, 
      team: req.user.team,   
      attachments: attachmentsToSave // Save metadata without tempPath
    });

    logger.debug('准备保存建议 (after file move):', JSON.stringify(suggestion, null, 2));
    await suggestion.save();
    logger.info('建议保存成功，ID:', suggestion._id);

    // Populate submitter info for the response
    await suggestion.populate('submitter', 'name team');
    
    logger.debug('返回建议数据:', JSON.stringify(suggestion, null, 2));
    // Original route returned: { message: '建议提交成功', suggestion }
    res.status(201).json({ 
      message: '建议提交成功', 
      suggestion 
    });

  } catch (error) {
    // If save to DB fails, we need to delete the files that were successfully moved to the final directory.
    // Temp files should have been cleaned up or moved already.
    if (req.files && req.files.length > 0) { // This check might be redundant if attachmentMetadata is used
      // Delete files from the *final* directory
      attachmentMetadata.forEach(fileMeta => {
        const finalPath = path.join(finalUploadDir, fileMeta.filename);
        if (fs.existsSync(finalPath)) { // Check if it was actually moved
          fs.unlink(finalPath, err => {
            if (err) logger.error(`删除最终文件失败 (DB保存错误) ${finalPath}:`, err);
            else logger.debug(`已删除最终文件 (DB保存错误) ${finalPath}`);
          });
        }
      });
    }
    logger.error('提交建议失败 (Controller - DB Save Error):', error);
    // Original route returned: { message: '提交建议失败', error: error.message }
    res.status(500).json({ 
      message: '提交建议失败', 
      error: error.message 
    });
  }
};


// 更新建议
exports.updateSuggestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, implementationSuggestion, expectedBenefits } = req.body;
    const userId = req.user.id;
    
    // 查找待更新的建议
    const suggestion = await Suggestion.findById(id);
    
    if (!suggestion) {
      return res.status(404).json({ message: '未找到建议' });
    }
    
    // 验证用户是否是提交者
    console.log('用户ID:', userId);
    console.log('提交者ID:', suggestion.submitter);
    
    // 确保正确比较MongoDB ObjectId
    const submitterId = typeof suggestion.submitter === 'object' ? 
                        suggestion.submitter.toString() : 
                        suggestion.submitter;
    
    // 确保用户ID也是字符串格式
    const userIdStr = typeof userId === 'object' ? userId.toString() : userId;
    
    console.log('控制器 - 转换后的submitterId:', submitterId);
    console.log('控制器 - 转换后的userIdStr:', userIdStr);
    
    if (!submitterId || submitterId !== userIdStr) {
      return res.status(403).json({ 
        message: '只有建议的提交者才能更新建议',
        userMessage: '没有修改权限'
      });
    }
    
    // 验证建议是否可以更新（只有在等待一级审核状态下才能更新）
    // console.log('控制器层 - 建议状态:', suggestion.status); // Removed
    console.log('控制器层 - 建议reviewStatus:', suggestion.reviewStatus);
    
    // 直接使用字符串比较，检查reviewStatus字段
    if (suggestion.reviewStatus !== REVIEW_STATUS.PENDING_FIRST_REVIEW) {
      return res.status(400).json({ 
        message: '只有等待一级审核的建议才能更新',
        userMessage: '建议已进入审核流程，无法修改'
      });
    }
    
    // 处理新上传的附件
    const newAttachments = req.files ? req.files.map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      path: file.path,
      mimetype: file.mimetype,
      size: file.size
    })) : [];
    
    // 更新建议
    suggestion.title = title;
    suggestion.description = description;
    suggestion.category = category;
    suggestion.implementationSuggestion = implementationSuggestion;
    suggestion.expectedBenefits = expectedBenefits;
    
    // 如果有新附件，添加到现有附件列表
    if (newAttachments.length > 0) {
      suggestion.attachments = [...suggestion.attachments, ...newAttachments];
    }
    
    // 添加更新记录到实施记录中
    suggestion.implementationRecords.push({
      status: REVIEW_STATUS.PENDING_FIRST_REVIEW,
      comments: '建议已更新',
      updatedBy: userId
    });
    
    await suggestion.save();
    
    // 返回更新后的建议
    const updatedSuggestion = await Suggestion.findById(id)
      .populate('submitter', 'name team'); // Corrected path and optimized selection
    
    res.json(updatedSuggestion);
  } catch (error) {
    logger.error('更新建议失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

// 删除建议
exports.deleteSuggestion = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // 查找待删除的建议
    const suggestion = await Suggestion.findById(id);
    logger.debug('获取建议信息', { suggestionId: id });

    if (!suggestion) {
      return res.status(404).json({ success: false, message: '未找到建议' });
    }
    
    // 权限验证：允许部门经理或未通过二级审核的建议提交者删除
    const user = await User.findById(userId);
    if (!user) {
      return res.status(403).json({ success: false, message: '用户不存在' });
    }

    // 检查删除权限
    const submitterId = suggestion.submitter.toString();
    const currentUserId = userId.toString();
    const isSubmitter = submitterId === currentUserId;
    const isManager = user.role === '部门经理';
    const hasSecondReviewApproval = suggestion.secondReview && suggestion.secondReview.result === 'APPROVED';
    
    // 允许删除的条件：1. 是部门经理 2. 是提交者且建议未通过二级审核
    const canDelete = isManager || (isSubmitter && !hasSecondReviewApproval);

    if (!canDelete) {
      logger.warn('删除建议权限不足', {
        userId,
        userRole: user.role,
        isSubmitter,
        isManager,
        hasSecondReviewApproval
      });

      let message = '权限不足';
      let details = [];
      
      if (!isSubmitter && !isManager) {
        details.push('只有建议提交者或部门经理可以删除建议');
      } else if (isSubmitter && hasSecondReviewApproval) {
        details.push('建议已通过二级审核，无法删除');
      }

      return res.status(403).json({ 
        success: false, 
        message: message,
        details: details,
        required: ['部门经理', '建议提交者（仅限二级审核通过前）'],
        current: user.role
      });
    }
        
    // 删除关联的附件
    if (suggestion.attachments && suggestion.attachments.length > 0) {
      logger.debug('开始删除附件', { 
        suggestionId: id, 
        attachmentCount: suggestion.attachments.length 
      });

      const unlinkPromises = suggestion.attachments.map(attachment => {
        return new Promise((resolve, reject) => {
          if (attachment.filename) {
            const uploadsDir = path.join(__dirname, '../uploads');
            const filePath = path.join(uploadsDir, attachment.filename);
            fs.unlink(filePath, (err) => {
              if (err && err.code === 'ENOENT') {
                logger.warn('附件文件不存在', { filePath });
                resolve();
              } else if (err) {
                logger.error('删除附件失败', { filePath, error: err });
                reject(err);
              } else {
                logger.debug('附件删除成功', { filePath });
                resolve();
              }
            });
          } else {
            resolve();
          }
        });
      });

      try {
        await Promise.all(unlinkPromises);
        logger.info('所有附件删除完成', { suggestionId: id });
      } catch (unlinkError) {
        logger.error('删除附件时出错', { 
          suggestionId: id, 
          error: unlinkError 
        });
        return res.status(500).json({ 
          success: false, 
          message: '删除建议的附件时出错', 
          error: unlinkError.message 
        });
      }
    }
    
    // 删除建议文档
    await Suggestion.findByIdAndDelete(id);
    logger.info('建议删除成功', { 
      suggestionId: id, 
      userId, 
      userRole: user.role 
    });
    
    res.json({ success: true, message: '建议及关联数据已成功删除' });
  } catch (error) {
    logger.error('删除建议失败', { 
      suggestionId: req.params.id, 
      error 
    });
    res.status(500).json({ 
      success: false, 
      message: '服务器错误，删除建议失败', 
      error: error.message 
    });
  }
};



// 获取建议统计数据
exports.getSuggestionStats = async (req, res) => {
  try {
    const totalCount = await Suggestion.countDocuments();
    
    // 按审核状态统计
    const reviewStatusCounts = await Suggestion.aggregate([
      { $group: { _id: '$reviewStatus', count: { $sum: 1 } } }
    ]);
    const formattedReviewStatusCounts = reviewStatusCounts.map(item => ({
      statusKey: item._id,
      statusName: REVIEW_STATUS[item._id] || item._id, // Use imported REVIEW_STATUS for name
      count: item.count
    }));

    // 按实施状态统计 (for approved suggestions)
    const implementationStatusCounts = await Suggestion.aggregate([
      { $match: { reviewStatus: REVIEW_STATUS.APPROVED } },
      { $group: { _id: '$implementationStatus', count: { $sum: 1 } } }
    ]);
    const formattedImplementationStatusCounts = implementationStatusCounts.map(item => ({
      statusKey: item._id,
      statusName: IMPLEMENTATION_STATUS[item._id] || item._id, // Use imported IMPLEMENTATION_STATUS
      count: item.count
    }));
    
    // 按类别统计
    const categoryCounts = await Suggestion.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // 按部门统计
    const departmentStats = await Suggestion.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'author',
          foreignField: '_id',
          as: 'authorInfo'
        }
      },
      {
        $unwind: '$authorInfo'
      },
      {
        $group: {
          _id: '$authorInfo.department',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // 格式化状态统计结果 // Removed old formattedStatusCounts
    
    res.json({
      totalCount,
      reviewStatusCounts: formattedReviewStatusCounts,
      implementationStatusCounts: formattedImplementationStatusCounts,
      categoryCounts,
      departmentStats
    });
  } catch (error) {
    logger.error('获取建议统计数据失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

// 获取实施完成率
exports.getImplementationRate = async (req, res) => {
  try {
    // 获取总审核通过的建议数
    const approvedTotal = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED
    });
    
    // 获取已完成实施的建议数
    const completedCount = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED, // Ensure it's an approved suggestion
      implementationStatus: IMPLEMENTATION_STATUS.COMPLETED
    });
    
    // 计算实施完成率
    const implementationRate = approvedTotal > 0 ? (completedCount / approvedTotal * 100).toFixed(2) : 0;
    
    // 获取实施时间统计
    const implementationTimes = await Suggestion.aggregate([
      {
        $match: {
          reviewStatus: REVIEW_STATUS.APPROVED,
          implementationStatus: IMPLEMENTATION_STATUS.COMPLETED,
          implementationDate: { $exists: true }
        }
      },
      {
        $project: {
          implementationDuration: {
            $divide: [
              { $subtract: ['$implementationDate', '$createdAt'] },
              1000 * 60 * 60 * 24 // 转换为天数
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          averageDuration: { $avg: '$implementationDuration' },
          minDuration: { $min: '$implementationDuration' },
          maxDuration: { $max: '$implementationDuration' }
        }
      }
    ]);
    
    // 按月统计实施完成情况
    const monthlyStats = await Suggestion.aggregate([
      {
        $match: {
          reviewStatus: REVIEW_STATUS.APPROVED,
          implementationStatus: IMPLEMENTATION_STATUS.COMPLETED,
          implementationDate: { $exists: true }
        }
      },
      {
        $project: {
          month: { $month: '$implementationDate' },
          year: { $year: '$implementationDate' }
        }
      },
      {
        $group: {
          _id: {
            year: '$year',
            month: '$month'
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: {
          '_id.year': 1,
          '_id.month': 1
        }
      }
    ]);
    
    res.json({
      approvedTotal,
      completedCount,
      implementationRate,
      averageImplementationTime: implementationTimes.length > 0 ? implementationTimes[0].averageDuration.toFixed(2) : 0,
      minImplementationTime: implementationTimes.length > 0 ? implementationTimes[0].minDuration.toFixed(2) : 0,
      maxImplementationTime: implementationTimes.length > 0 ? implementationTimes[0].maxDuration.toFixed(2) : 0,
      monthlyStats
    });
  } catch (error) {
    logger.error('获取实施完成率失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

/**
 * 提交审核
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.submitReview = async (req, res) => {
  try {
    const { suggestionId, reviewType, result, comments } = req.body; // Changed comment to comments
    
    logger.debug('接收到审核请求:', {
      suggestionId,
      reviewType,
      result,
      comments, // Changed comment to comments
      userId: req.user.id
    });
    
    if (!suggestionId || !reviewType || !result || !comments) { // Changed comment to comments
      return res.status(400).json({ message: '缺少必要参数' });
    }
    
    // 验证reviewType (first/second)
    if (reviewType !== 'first' && reviewType !== 'second') {
      return res.status(400).json({ message: '无效的审核类型' });
    }
    
    // 验证result (approve/reject)
    if (result !== 'approve' && result !== 'reject') {
      return res.status(400).json({ message: '无效的审核结果' });
    }
    
    // 获取建议
    const suggestion = await Suggestion.findById(suggestionId);
    if (!suggestion) {
      return res.status(404).json({ message: '建议不存在' });
    }
    
    // 添加更详细的建议信息日志
    logger.debug('建议详细信息:', {
      id: suggestion._id,
      title: suggestion.title,
      type: suggestion.type,
      team: suggestion.team,
      reviewStatus: suggestion.reviewStatus,
      implementationStatus: suggestion.implementationStatus,
      firstReview: suggestion.firstReview ? '已存在' : '不存在',
      secondReview: suggestion.secondReview ? '已存在' : '不存在'
    });

    const reviewer = await User.findById(req.user.id);
    if (!reviewer) {
      return res.status(404).json({ message: '审核人不存在' });
    }

    // 添加详细的审核人信息日志
    logger.debug('审核人详细信息:', {
      id: reviewer._id,
      name: reviewer.name,
      role: reviewer.role,
      team: reviewer.team
    });
    
    logger.debug('SubmitReview - Fetched Suggestion:', JSON.stringify(suggestion, null, 2));
    logger.debug('SubmitReview - Fetched Reviewer:', JSON.stringify(reviewer, null, 2));
    
    // 更灵活地验证建议状态
    const currentReviewStatus = suggestion.reviewStatus; // Prefer direct field for now
    const isPendingFirstReview = currentReviewStatus === REVIEW_STATUS.PENDING_FIRST_REVIEW;
    const isPendingSecondReview = currentReviewStatus === REVIEW_STATUS.PENDING_SECOND_REVIEW;
    
    logger.debug('状态验证结果:', {
      reviewStatusFromDb: suggestion.reviewStatus, 
      currentReviewStatus: currentReviewStatus,
      isPendingFirstReview,
      isPendingSecondReview,
      expectedFirstReviewStatus: REVIEW_STATUS.PENDING_FIRST_REVIEW,
      expectedSecondReviewStatus: REVIEW_STATUS.PENDING_SECOND_REVIEW,
      reviewType: reviewType,
      // 添加枚举值的比较
      statusComparison: {
        valueInDB: currentReviewStatus,
        expectedValueForFirstReview: REVIEW_STATUS.PENDING_FIRST_REVIEW,
        isEqual: currentReviewStatus === REVIEW_STATUS.PENDING_FIRST_REVIEW
      }
    });
    
    // 验证建议状态
    if (reviewType === 'first' && !isPendingFirstReview) {
      logger.debug('一级审核状态验证失败:', {
        currentStatus: currentReviewStatus,
        expectedStatus: REVIEW_STATUS.PENDING_FIRST_REVIEW,
        isEqual: currentReviewStatus === REVIEW_STATUS.PENDING_FIRST_REVIEW
      });
      
      return res.status(400).json({ 
        message: '建议不处于待一级审核状态',
        currentStatus: currentReviewStatus, // 使用合并后的状态
        expectedStatus: REVIEW_STATUS.PENDING_FIRST_REVIEW // Use imported enum key
      });
    }
    
    if (reviewType === 'second' && !isPendingSecondReview) {
      logger.debug('二级审核状态验证失败:', {
        currentStatus: currentReviewStatus,
        expectedStatus: REVIEW_STATUS.PENDING_SECOND_REVIEW,
        isEqual: currentReviewStatus === REVIEW_STATUS.PENDING_SECOND_REVIEW
      });
      
      return res.status(400).json({ 
        message: '建议不处于待二级审核状态',
        currentStatus: currentReviewStatus, // 使用合并后的状态
        expectedStatus: REVIEW_STATUS.PENDING_SECOND_REVIEW // Use imported enum key
      });
    }
    
    // 获取审核人 // Moved up
    // const reviewer = await User.findById(req.user.id);
    // if (!reviewer) {
    //   return res.status(404).json({ message: '审核人不存在' });
    // }
    
    // logger.debug('审核人信息:', { // Covered by new JSON.stringify log
    //   id: reviewer._id,
    //   role: reviewer.role,
    //   team: reviewer.team
    // });
    
    // 验证审核权限
    const canReview = await validateReviewPermission(reviewer, suggestion, reviewType);
    if (!canReview) {
      return res.status(403).json({ message: '无审核权限' });
    }
    
    // 创建审核记录
    const review = {
      reviewer: req.user.id,
      result: result === 'approve' ? 'APPROVED' : 'REJECTED',
      comments: comments, // Changed comment to comments
      reviewedAt: new Date()
    };
    
    // 更新建议
    if (reviewType === 'first') {
      suggestion.firstReview = review;
      if (result === 'approve') {
        suggestion.reviewStatus = REVIEW_STATUS.PENDING_SECOND_REVIEW;
        // suggestion.status = 'PENDING_SECOND_REVIEW'; // REMOVED old status field update
      } else {
        suggestion.reviewStatus = REVIEW_STATUS.REJECTED;
        // suggestion.status = 'REJECTED'; // REMOVED old status field update
      }
    } else if (reviewType === 'second') {
      suggestion.secondReview = review;
      if (result === 'approve') {
        suggestion.reviewStatus = REVIEW_STATUS.APPROVED;
        // suggestion.status = 'NOT_IMPLEMENTED'; // REMOVED old status field update
        // Initialize implementation status
        suggestion.implementationStatus = IMPLEMENTATION_STATUS.NOT_STARTED; // Using constant
        suggestion.implementation = {
          status: IMPLEMENTATION_STATUS.NOT_STARTED, // Using constant
          history: [{
            status: IMPLEMENTATION_STATUS.NOT_STARTED, // Using constant
            updatedBy: req.user.id,
            date: new Date(),
            notes: '建议已通过二级审核，等待实施'
          }]
        };
      } else {
        suggestion.reviewStatus = REVIEW_STATUS.REJECTED;
        // suggestion.status = 'REJECTED'; // REMOVED old status field update
      }
    }
    
    logger.debug('即将保存的建议:', {
      id: suggestion._id,
      // newStatus: suggestion.status, // REMOVED old status field from log
      newReviewStatus: suggestion.reviewStatus,
      newImplementationStatus: suggestion.implementationStatus
    });
    
    await suggestion.save();
    
    // 查询完整的建议信息
    const updatedSuggestion = await Suggestion.findById(suggestionId)
      .populate('submitter', 'name team')
      .populate({
        path: 'firstReview.reviewer',
        select: 'name role',
        model: 'User'
      })
      .populate({
        path: 'secondReview.reviewer',
        select: 'name role',
        model: 'User'
      });
    
    logger.debug('审核成功完成');
    
    res.json({
      message: '审核提交成功',
      suggestion: updatedSuggestion
    });
  } catch (error) {
    logger.error('提交审核失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

// 验证审核权限
const validateReviewPermission = async (reviewer, suggestion, reviewType) => {
  const role = reviewer.role;
  const team = reviewer.team;

  logger.debug('审核权限验证:', {
    reviewerRole: role,
    reviewerTeam: team,
    suggestionTeam: suggestion.team,
    reviewType: reviewType,
    suggestionType: suggestion.type
  });

  // 部门经理可以进行所有审核
  if (role === '部门经理') {
    logger.debug('部门经理有所有审核权限');
    return true;
  }

  // 一级审核权限验证
  if (reviewType === 'first') {
    // 允许当班值班主任审核所有班组建议
    if (role === '值班主任') {
      logger.debug('值班主任获得一级审核权限');
      return true;
    }
  }

  // 二级审核权限验证
  if (reviewType === 'second') {
    // 安全科管理人员只能审核安全类建议
    if (role === '安全科管理人员' && suggestion.type === 'SAFETY') {
      logger.debug('安全科管理人员获得安全类建议二级审核权限');
      return true;
    }
    // 运行科管理人员只能审核非安全类建议
    if (role === '运行科管理人员' && suggestion.type !== 'SAFETY') {
      logger.debug('运行科管理人员获得非安全类建议二级审核权限');
      return true;
    }
  }

  logger.debug('审核权限验证失败:', {
    reviewerRole: role,
    reviewerTeam: team,
    suggestionTeam: suggestion.team,
    reviewType: reviewType
  });
  return false;
};

/**
 * 更新建议实施状态
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.updateImplementation = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, responsiblePerson, startDate, plannedCompletionDate, actualCompletionDate, notes, attachments, completionRate } = req.body;
    const userId = req.user.id;

    // 查找建议
    const suggestion = await Suggestion.findById(id);
    if (!suggestion) {
      return res.status(404).json({ success: false, message: '未找到该建议' });
    }

    // 检查审核状态是否为 '已批准'
    if (suggestion.reviewStatus !== 'APPROVED') {
         return res.status(400).json({ success: false, message: '建议尚未通过审核，无法更新实施状态' });
    }

    // 直接验证传入的 status 是否是有效的英文代码
    const validStatusCodes = Object.keys(IMPLEMENTATION_STATUS); // 使用从常量文件导入的 IMPLEMENTATION_STATUS
    if (!status || !validStatusCodes.includes(status)) {
        // 如果 status 无效或未提供
        return res.status(400).json({
            success: false,
            message: `无效的实施状态代码: ${status}`
        });
    }
    
    // 查找或创建实施信息
    let implementation = suggestion.implementation;
    if (!implementation) {
      suggestion.implementation = {};
      implementation = suggestion.implementation;
      implementation.status = 'NOT_STARTED';
      implementation.history = [{
          status: 'NOT_STARTED',
          updatedBy: userId,
          date: new Date(),
          notes: '初始化实施记录'
      }];
    }
    if (!implementation.history) {
        implementation.history = [];
    }

    const oldStatus = implementation.status || 'NOT_STARTED';
    let statusChanged = false;

    // 更新实施信息 (直接使用验证后的 status)
    if (status !== oldStatus) {
      implementation.status = status;
      suggestion.implementationStatus = status; // 同步顶层状态
      statusChanged = true;
    }
    if (responsiblePerson) implementation.responsiblePerson = responsiblePerson;
    if (startDate) implementation.startDate = startDate;
    if (plannedCompletionDate) implementation.plannedEndDate = plannedCompletionDate; 
    if (actualCompletionDate) implementation.actualEndDate = actualCompletionDate;
    if (typeof completionRate === 'number') implementation.completionRate = completionRate;
    
    // 添加历史记录
    if (statusChanged || notes) {
        const historyEntry = {
            status: implementation.status,
            updatedBy: userId,
            date: new Date(),
            // 使用导入的 IMPLEMENTATION_STATUS 获取中文名
            notes: notes || (statusChanged ? `状态更新为: ${IMPLEMENTATION_STATUS[implementation.status] || implementation.status}` : '更新实施信息')
        };
        implementation.history.push(historyEntry);
    }
    
    await suggestion.save();

    res.json({
      success: true,
      message: '实施信息更新成功',
      suggestion: suggestion
    });

  } catch (error) {
    logger.error('更新实施状态失败:', error);
    res.status(500).json({
      success: false,
      message: '更新实施状态失败',
      error: error.message
    });
  }
};

/**
 * 获取建议实施统计数据
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.getImplementationStats = async (req, res) => {
  try {
    // 获取已批准建议总数
    const approvedCount = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED
    });
    
    // 获取各实施状态的数量
    const implementingCount = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED,
      implementationStatus: IMPLEMENTATION_STATUS.IN_PROGRESS
    });
    const completedCount = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED,
      implementationStatus: IMPLEMENTATION_STATUS.COMPLETED
    });
    const notImplementedCount = await Suggestion.countDocuments({
      reviewStatus: REVIEW_STATUS.APPROVED,
      implementationStatus: IMPLEMENTATION_STATUS.NOT_STARTED
    });
    
    // 计算实施率
    const implementationRate = approvedCount > 0 
      ? (completedCount / approvedCount * 100).toFixed(2)
      : 0;
    
    // 按月统计实施完成数量
    const monthlyStats = await Suggestion.aggregate([
      {
        $match: { 
          reviewStatus: REVIEW_STATUS.APPROVED,
          implementationStatus: IMPLEMENTATION_STATUS.COMPLETED, 
          implementationDate: { $exists: true } 
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$implementationDate' },
            month: { $month: '$implementationDate' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);
    
    // 按类型统计实施完成情况
    const typeStats = await Suggestion.aggregate([
      {
        $match: { 
          reviewStatus: REVIEW_STATUS.APPROVED,
          implementationStatus: IMPLEMENTATION_STATUS.COMPLETED 
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);
    
    // 按班组统计实施完成情况
    const teamStats = await Suggestion.aggregate([
      {
        $match: { 
          reviewStatus: REVIEW_STATUS.APPROVED,
          implementationStatus: IMPLEMENTATION_STATUS.COMPLETED 
        }
      },
      {
        $group: {
          _id: '$team',
          count: { $sum: 1 }
        }
      }
    ]);
    
    res.json({
      approvedCount,
      implementingCount,
      completedCount,
      notImplementedCount,
      implementationRate,
      monthlyStats,
      typeStats,
      teamStats
    });
  } catch (error) {
    logger.error('获取实施统计数据失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

/**
 * 一级审核（值班主任）
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.firstReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approved, comments } = req.body;
    const suggestion = await Suggestion.findById(req.params.id);

    if (!suggestion) {
      return res.status(404).json({ message: '建议不存在' });
    }

    // 检查建议是否处于待一级审核状态
    // Using reviewStatus for the check now
    // Ensure REVIEW_STATUS.PENDING_FIRST_REVIEW is the imported constant
    if (suggestion.reviewStatus !== REVIEW_STATUS.PENDING_FIRST_REVIEW) {
      return res.status(400).json({ message: '建议不处于待一级审核状态', currentStatus: suggestion.reviewStatus });
    }

    // 检查权限：允许部门经理 或 值班主任（自己班组的建议）
    const isDepartmentManager = req.user.role === '部门经理';
    const isShiftSupervisorForTeam = req.user.role === '值班主任' && req.user.team === suggestion.team;

    if (!(isDepartmentManager || isShiftSupervisorForTeam)) {
      return res.status(403).json({ message: '无一级审核权限' });
    }

    // 创建审核记录
    const review = {
      reviewer: req.user.id,
      result: approved === 'approve' ? 'APPROVED' : 'REJECTED',
      comments: comments,
      reviewedAt: new Date()
    };

    // 更新建议
    suggestion.firstReview = review;
    
    if (approved === 'approve') {
      // suggestion.status = 'PENDING_SECOND_REVIEW'; // REMOVED old status field update
      suggestion.reviewStatus = REVIEW_STATUS.PENDING_SECOND_REVIEW; // Using constant
    } else {
      // suggestion.status = 'REJECTED'; // REMOVED old status field update
      suggestion.reviewStatus = REVIEW_STATUS.REJECTED; // Using constant
    }

    await suggestion.save();

    // 获取更新后的建议（包含关联信息）
    const updatedSuggestion = await Suggestion.findById(req.params.id)
      .populate('submitter', 'name team')
      .populate({
        path: 'firstReview.reviewer',
        select: 'name role',
        model: 'User'
      });

    res.json({
      message: approved === 'approve' ? '建议已通过一级审核' : '建议已在一级审核中被拒绝',
      suggestion: updatedSuggestion
    });
  } catch (error) {
    logger.error('一级审核失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

/**
 * 二级审核（安全科/运行科管理人员）
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.secondReview = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approved, comments } = req.body;
    const suggestion = await Suggestion.findById(req.params.id);

    if (!suggestion) {
      return res.status(404).json({ message: '建议不存在' });
    }

    // 检查建议是否处于待二级审核状态
    // Using reviewStatus for the check now
    // Ensure REVIEW_STATUS.PENDING_SECOND_REVIEW is the imported constant
    if (suggestion.reviewStatus !== REVIEW_STATUS.PENDING_SECOND_REVIEW) {
      return res.status(400).json({ message: '建议不处于待二级审核状态', currentStatus: suggestion.reviewStatus });
    }

    // 检查权限
    const userRole = req.user.role;
    if (userRole === '安全科管理人员' && suggestion.type !== SUGGESTION_TYPES.SAFETY) {
      return res.status(403).json({ message: '安全科管理人员只能审核安全类建议' });
    }
    if (userRole === '运行科管理人员' && suggestion.type === SUGGESTION_TYPES.SAFETY) {
      return res.status(403).json({ message: '运行科管理人员不能审核安全类建议' });
    }

    // 创建审核记录
    const review = {
      reviewer: req.user.id,
      result: approved === 'approve' ? 'APPROVED' : 'REJECTED',
      comments: comments,
      reviewedAt: new Date()
    };

    // 更新建议
    suggestion.secondReview = review;
    
    if (approved === 'approve') {
      // suggestion.status = 'NOT_IMPLEMENTED'; // REMOVED old status field update
      suggestion.reviewStatus = REVIEW_STATUS.APPROVED; // Using constant
      
      // Initialize implementation status
      suggestion.implementationStatus = IMPLEMENTATION_STATUS.NOT_STARTED; // Using constant
      suggestion.implementation = {
        status: IMPLEMENTATION_STATUS.NOT_STARTED, // Using constant
        history: [{
          status: IMPLEMENTATION_STATUS.NOT_STARTED, // Using constant
          updatedBy: req.user.id,
          date: new Date(),
          notes: '建议已通过二级审核，等待实施'
        }]
      };
    } else {
      // suggestion.status = 'REJECTED'; // REMOVED old status field update
      suggestion.reviewStatus = REVIEW_STATUS.REJECTED; // Using constant
    }

    await suggestion.save();

    // 获取更新后的建议（包含关联信息）
    const updatedSuggestion = await Suggestion.findById(req.params.id)
      .populate('submitter', 'name team')
      .populate({
        path: 'firstReview.reviewer',
        select: 'name role',
        model: 'User'
      })
      .populate({
        path: 'secondReview.reviewer',
        select: 'name role',
        model: 'User'
      });

    res.json({
      message: approved === 'approve' ? '建议已通过二级审核' : '建议已在二级审核中被拒绝',
      suggestion: updatedSuggestion
    });
  } catch (error) {
    logger.error('二级审核失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

/**
 * 为建议打分
 * 部门经理可以评分所有建议
 * 安全科管理人员只能评分安全类建议
 * 运行科管理人员只能评分非安全类建议
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.scoreSuggestion = async (req, res) => {
  // Add log at the very beginning
  logger.debug(`[DEBUG] Entering scoreSuggestion for suggestion ID: ${req.params.id} by user ${req.user.id}`); 
  try {
    const { id } = req.params;
    const { score } = req.body;
    const scorerId = req.user.id; // 从 auth 中间件获取

    const suggestion = await Suggestion.findById(id);
    if (!suggestion) {
      return res.status(404).json({ success: false, message: '未找到建议' });
    }

    // 新增校验：确保建议状态是 APPROVED
    if (suggestion.reviewStatus !== REVIEW_STATUS.APPROVED) {
      return res.status(400).json({ success: false, message: '建议必须处于已批准状态才能评分' });
    }

    // 验证分数 (允许小数，范围 0-10)
    const scoreValue = parseFloat(req.body.score);
    if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 10) {
      return res.status(400).json({ success: false, message: '分数必须是 0 到 10 之间的有效数字' });
    }

    // 创建评分记录，使用验证和转换后的 scoreValue
    const scoringRecord = {
      score: scoreValue, 
      scorer: scorerId,
      scorerRole: req.user.role,
      scoredAt: new Date()
    };

    // 如果已有评分，将当前评分保存到历史记录
    if (suggestion.scoring && suggestion.scoring.score !== undefined) {
      // 初始化历史记录数组（如果不存在）
      if (!suggestion.scoring.history) {
        suggestion.scoring.history = [];
      }
      
      // 将当前评分信息（修改前的）添加到历史记录
      // Make sure to push the OLD data before overwriting
      const oldScoringData = {
        score: suggestion.scoring.score, // Push the existing numeric score
        scorer: suggestion.scoring.scorer,
        scorerRole: suggestion.scoring.scorerRole, // Use the role stored in the suggestion
        scoredAt: suggestion.scoring.scoredAt // Use the date stored in the suggestion
      };
      suggestion.scoring.history.push(oldScoringData);

      // 更新当前评分信息 (直接修改字段，而不是替换整个对象)
      suggestion.scoring.score = scoreValue; // Update with the validated numeric score
      suggestion.scoring.scorer = scoringRecord.scorer;
      suggestion.scoring.scorerRole = scoringRecord.scorerRole;
      suggestion.scoring.scoredAt = scoringRecord.scoredAt;
      // suggestion.scoring.history remains as it is (already updated)

    } else {
       // 如果是第一次评分，直接设置 scoring 对象
       suggestion.scoring = {
         score: scoreValue, // Use the validated numeric score
         scorer: scorerId,
         scorerRole: req.user.role,
         scoredAt: new Date(),
         history: [] // Initialize history
       };
       // Ensure history array is initialized for future updates, even if empty now
       // suggestion.scoring.history = []; // Already initialized above
    }

    // 在保存前打印日志，检查 scoring 对象和 history 数组
    logger.debug('[DEBUG] Saving suggestion scoring data:');
    logger.debug('[DEBUG] Current Score:', suggestion.scoring?.score);
    logger.debug('[DEBUG] Scorer:', suggestion.scoring?.scorer);
    logger.debug('[DEBUG] Scored At:', suggestion.scoring?.scoredAt);
    logger.debug('[DEBUG] Full Scoring Object:', JSON.stringify(suggestion.scoring, null, 2));
    logger.debug('[DEBUG] History Array Length:', suggestion.scoring?.history?.length);
    logger.debug('[DEBUG] History Array Content:', JSON.stringify(suggestion.scoring?.history, null, 2));

    await suggestion.save();

    // 返回更新后的建议，并填充打分人信息
    const updatedSuggestion = await Suggestion.findById(id)
      .populate('submitter', 'name team')
      .populate({
        path: 'firstReview.reviewer',
        select: 'name role',
        model: 'User'
      })
      .populate({
        path: 'secondReview.reviewer',
        select: 'name role',
        model: 'User'
      })
      .populate({
        path: 'scoring.scorer', // 填充打分人信息
        select: 'name role',
        model: 'User'
      });

    res.json({
      success: true,
      message: '建议打分成功',
      suggestion: updatedSuggestion
    });

  } catch (error) {
    logger.error('建议打分失败:', error);
    res.status(500).json({
      success: false,
      message: '服务器错误，打分失败',
      error: error.message
    });
  }
}; 

/**
 * 临时接口：检查并修复建议状态
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
exports.checkAndFixSuggestionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { fix } = req.query; // 是否修复状态
    
    // 获取建议信息
    const suggestion = await Suggestion.findById(id);
    if (!suggestion) {
      return res.status(404).json({ message: '建议不存在' });
    }
    
    // 记录当前状态
    const currentStatus = {
      id: suggestion._id,
      title: suggestion.title,
      type: suggestion.type,
      team: suggestion.team,
      reviewStatus: suggestion.reviewStatus,
      implementationStatus: suggestion.implementationStatus,
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
      firstReview: suggestion.firstReview,
      secondReview: suggestion.secondReview
    };
    
    logger.debug('建议当前状态:', currentStatus);
    
    // 如果请求包含fix=true，将尝试修复状态
    if (fix === 'true') {
      // 重置为待一级审核状态
      suggestion.reviewStatus = 'PENDING_FIRST_REVIEW';
      
      // 重置其他相关字段
      suggestion.firstReview = null;
      suggestion.secondReview = null;
      
      await suggestion.save();
      
      logger.debug('已修复建议状态为待一级审核');
      
      return res.json({
        message: '建议状态已修复为待一级审核',
        previousStatus: currentStatus,
        currentStatus: {
          id: suggestion._id,
          reviewStatus: suggestion.reviewStatus
        }
      });
    }
    
    // 不修复，仅返回当前状态
    return res.json({
      message: '建议当前状态',
      suggestion: currentStatus
    });
  } catch (error) {
    logger.error('检查/修复建议状态失败:', error);
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};