# 超星学习通一键评教

批量自动完成评教，一键给所有教师最好的评价并提交。

## 功能

- **批量处理** - 自动识别所有待评价教师，逐个完成评教
- **智能填答** - 自动识别单选、多选、文本等题型，选择最佳评价
- **实时进度** - 悬浮面板实时显示评教进度和统计
- **安全可靠** - 可随时停止，支持失败重试

## 快速开始

### 1. 安装 Tampermonkey

在 Chrome / Edge / Firefox 浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展。

### 2. 安装脚本

点击 [一键安装](https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/chaoxing-auto-eval.user.js) 按钮，确认安装。

### 3. 使用

1. 登录 [i.chaoxing.com](https://i.chaoxing.com)
2. 进入评教列表页面
3. 页面右下角会出现控制面板
4. 点击「开始批量评教」

## 工作原理

脚本运行在评教列表页面时：

1. 解析页面表格，找到所有"待评价"项
2. 逐个获取评教表单页面
3. 解析题目结构，选择最佳选项
4. 自动提交表单
5. 显示进度和结果

## 文件结构

```
├── index.html                    # GitHub Pages 着陆页
├── chaoxing-auto-eval.user.js    # 油猴脚本
├── .github/workflows/pages.yml   # GitHub Actions 部署
└── README.md
```

## 许可

MIT License

## 免责声明

本项目仅供学习交流使用，使用者需自行承担使用风险。
