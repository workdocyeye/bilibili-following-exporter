# 快速安装指南

## 安装步骤

### 1. 准备图标文件（重要！）

插件需要图标文件才能正常工作。请按照以下步骤准备：

1. 打开 `icons/README.md` 查看详细说明
2. 使用在线工具生成16x16、48x48、128x128像素的PNG图标
3. 将图标文件保存到 `icons/` 文件夹中

**推荐图标生成工具**：
- https://www.favicon-generator.org/
- https://favicon.io/favicon-generator/

### 2. 安装Chrome插件

1. 打开Chrome浏览器
2. 在地址栏输入：`chrome://extensions/`
3. 开启右上角的"开发者模式"开关
4. 点击"加载已解压的扩展程序"按钮
5. 选择 `pullout_up` 文件夹
6. 插件安装完成！

### 3. 使用插件

1. 访问 https://www.bilibili.com 并登录账号
2. 点击浏览器工具栏中的插件图标
3. 点击"导出关注列表"按钮
4. 等待数据加载完成
5. HTML文件会自动下载

## 文件清单

确保以下文件都存在：

```
pullout_up/
├── manifest.json          ✅
├── popup.html             ✅
├── popup.js               ✅
├── styles.css             ✅
├── icons/
│   ├── icon16.png         ⚠️  需要您创建
│   ├── icon48.png         ⚠️  需要您创建
│   ├── icon128.png        ⚠️  需要您创建
│   └── README.md          ✅
├── README.md              ✅
└── INSTALL.md             ✅
```

## 常见问题

**Q: 插件图标显示为灰色？**
A: 请检查图标文件是否存在且格式正确。

**Q: 点击插件没有反应？**
A: 请确保已登录B站账号。

**Q: 导出失败？**
A: 请检查网络连接，或刷新B站页面重新登录。

## 技术支持

如遇问题，请查看 `README.md` 中的详细说明或提交Issue。
