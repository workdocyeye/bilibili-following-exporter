// B站关注列表导出器 - 主要逻辑
class BilibiliExporter {
    constructor() {
        this.apiBase = 'https://api.bilibili.com';
        this.followingApi = '/x/relation/followings';
        this.pageSize = 50; // 每页最大50个
        this.allFollowings = [];
        this.currentPage = 1;
        this.totalPages = 0;
        // 富集相关
        this.enableEnrich = false;
        this.enrichFields = {
            followers: true,
            likes: true,
            videos: false,
            level: false,
            official: false
        };
        this.enrichStats = { done: 0, total: 0, skipped: 0 };
        this.maxConcurrency = 6; // 可在UI中调整
        this.enableAdaptive = false; // 自适应降速
        
        this.init();
    }
    
    // 初始化
    init() {
        this.bindEvents();
        this.updateStatus('准备就绪');
    }
    
    // 绑定事件
    bindEvents() {
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.addEventListener('click', () => this.startExport());
        const enrichToggle = document.getElementById('enrichToggle');
        const enrichOptions = document.getElementById('enrichOptions');
        const enrichProgress = document.getElementById('enrichProgress');
        const sortRow = document.getElementById('sortRow');
        if (enrichToggle) {
            enrichToggle.addEventListener('change', (e) => {
                this.enableEnrich = e.target.checked;
                enrichOptions.style.display = this.enableEnrich ? 'block' : 'none';
                enrichProgress.style.display = this.enableEnrich ? 'block' : 'none';
                // 排序常显，不再隐藏
            });
        }
        const concurrencyInput = document.getElementById('concurrencyInput');
        const concurrencyInfo = document.getElementById('concurrencyInfo');
        if (concurrencyInput) {
            // 仅限制最小为1，不再设置上限，交由用户自行把控（建议≤20）
            const clamp = (v) => Math.max(1, Number(v) || 6);
            const update = () => {
                this.maxConcurrency = clamp(concurrencyInput.value);
                if (concurrencyInfo) concurrencyInfo.textContent = `（并发 ${this.maxConcurrency}）`;
            };
            concurrencyInput.addEventListener('input', update);
            update();
        }
        const adaptiveToggle = document.getElementById('adaptiveToggle');
        if (adaptiveToggle) {
            adaptiveToggle.addEventListener('change', (e) => {
                this.enableAdaptive = e.target.checked;
            });
        }
        // 读取字段复选框
        document.querySelectorAll('.enrich-field').forEach(cb => {
            cb.addEventListener('change', () => {
                this.enrichFields[cb.value] = cb.checked;
            });
        });
    }
    
    // 更新状态显示
    updateStatus(message, progress = null) {
        const statusEl = document.getElementById('status');
        const progressEl = document.getElementById('progress');
        
        statusEl.textContent = message;
        if (progress !== null) {
            progressEl.textContent = progress;
        }
    }
    
    // 显示错误信息
    showError(message) {
        const errorEl = document.getElementById('errorMsg');
        errorEl.textContent = message;
        errorEl.style.display = 'block';
        
        // 3秒后自动隐藏错误信息
        setTimeout(() => {
            errorEl.style.display = 'none';
        }, 3000);
    }
    
    // 获取当前登录用户ID（优先通过API，其次尝试Cookie）
    async getUserId() {
        // 1) 优先调用 B 站自带接口：返回登录态与 mid
        try {
            const navResp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Referer': 'https://www.bilibili.com/',
                    'Cache-Control': 'no-cache'
                }
            });
            if (navResp.ok) {
                const navJson = await navResp.json();
                if (navJson && navJson.code === 0 && navJson.data && navJson.data.isLogin) {
                    const mid = String(navJson.data.mid || '');
                    if (mid) return mid;
                }
            }
        } catch (e) {
            // 忽略，回退到 Cookie 方案
            console.warn('通过 nav 接口获取 mid 失败，回退到 Cookie 方案', e);
        }

        // 2) 回退：尝试读取 DedeUserID Cookie
        try {
            const cookies = await chrome.cookies.getAll({ domain: '.bilibili.com' });
            const userIdCookie = cookies.find(cookie => cookie.name === 'DedeUserID');
            if (userIdCookie && userIdCookie.value) {
                return userIdCookie.value;
            }
        } catch (e) {
            console.warn('读取 Cookie 失败', e);
        }

        // 3) 再次通过在可见标签页里注入获取（用户可能使用多账户/分区存储）
        // 尝试从当前激活标签页（B站页面）读取 window.__BILI_USER_INFO__（若存在）
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('bilibili.com')) {
                const [{ result }] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        try {
                            const nav = window.__BILI_USER_INFO__ || {};
                            return nav.mid || '';
                        } catch (_) { return ''; }
                    }
                });
                if (result) return String(result);
            }
        } catch (e) {
            console.warn('从页面上下文尝试获取 mid 失败', e);
        }

        throw new Error('无法获取用户信息：请先在 https://www.bilibili.com 登录后再重试');
    }
    
    // 获取关注列表数据
    async fetchFollowingList(vmid, page = 1) {
        try {
            const url = `${this.apiBase}${this.followingApi}?vmid=${vmid}&pn=${page}&ps=${this.pageSize}`;
            
            const response = await fetch(url, {
                method: 'GET',
                credentials: 'include', // 自动携带cookies
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Referer': 'https://space.bilibili.com/'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP错误: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.code !== 0) {
                throw new Error(`API错误: ${data.message || '未知错误'}`);
            }
            
            return data.data;
        } catch (error) {
            console.error('获取关注列表失败:', error);
            throw error;
        }
    }
    
    // 获取所有关注列表
    async getAllFollowings(vmid) {
        this.allFollowings = [];
        this.currentPage = 1;
        
        try {
            // 先获取第一页，确定总页数
            const firstPageData = await this.fetchFollowingList(vmid, 1);
            this.totalPages = Math.ceil(firstPageData.total / this.pageSize);
            
            this.allFollowings = [...firstPageData.list];
            this.updateStatus(`正在加载第1页...`, `1/${this.totalPages}`);
            
            // 获取剩余页面
            for (let page = 2; page <= this.totalPages; page++) {
                const pageData = await this.fetchFollowingList(vmid, page);
                this.allFollowings = [...this.allFollowings, ...pageData.list];
                
                this.updateStatus(`正在加载第${page}页...`, `${page}/${this.totalPages}`);
                
                // 添加延迟避免请求过于频繁
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            return this.allFollowings;
        } catch (error) {
            throw error;
        }
    }

    // 基础重试封装（指数退避）
    async requestWithRetry(url, options = {}, retries = 2) {
        let attempt = 0;
        while (true) {
            try {
                const resp = await fetch(url, { credentials: 'include', ...options });
                if (!resp.ok) {
                    // 自适应：429 视为限流信号
                    if (this.enableAdaptive && resp.status === 429 && this.maxConcurrency > 3) {
                        this.maxConcurrency = Math.max(3, Math.floor(this.maxConcurrency / 2));
                        const info = document.getElementById('concurrencyInfo');
                        if (info) info.textContent = `（并发 ${this.maxConcurrency}）`;
                    }
                    throw new Error(`HTTP错误: ${resp.status}`);
                }
                const json = await resp.json();
                if (json.code !== 0) throw new Error(json.message || 'API错误');
                return json.data;
            } catch (e) {
                if (attempt >= retries) throw e;
                let backoff = 500 * Math.pow(3, attempt); // 500 -> 1500 -> 4500
                if (this.enableAdaptive) backoff *= 1.5; // 降速更温和
                await new Promise(r => setTimeout(r, backoff));
                attempt++;
            }
        }
    }

    // 并发池执行器
    async runWithConcurrency(tasks, limit = this.maxConcurrency) {
        const results = new Array(tasks.length);
        let idx = 0;
        const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
            while (idx < tasks.length) {
                const cur = idx++;
                try {
                    results[cur] = await tasks[cur]();
                } catch (e) {
                    results[cur] = { error: e };
                }
            }
        });
        await Promise.all(workers);
        return results;
    }

    // 为每个 mid 富集更多信息（按选中字段）
    async enrichFollowings(followings) {
        const needAny = Object.values(this.enrichFields).some(Boolean);
        if (!this.enableEnrich || !needAny) return {};

        const enrichCountEl = document.getElementById('enrichCount');
        const enrichSkippedEl = document.getElementById('enrichSkipped');

        this.enrichStats = { done: 0, total: followings.length, skipped: 0 };
        const tasks = followings.map((up, i) => async () => {
            const mid = up.mid;
            const result = {};
            // followers
            if (this.enrichFields.followers) {
                try {
                    const stat = await this.requestWithRetry(`${this.apiBase}/x/relation/stat?vmid=${mid}`);
                    result.followers = stat.follower;
                } catch (_) { this.enrichStats.skipped++; }
            }
            // likes
            if (this.enrichFields.likes) {
                try {
                    const upstat = await this.requestWithRetry(`${this.apiBase}/x/space/upstat?mid=${mid}`);
                    result.likes = upstat && upstat.likes != null ? upstat.likes : (upstat && upstat.data && upstat.data.likes);
                } catch (_) { this.enrichStats.skipped++; }
            }
            // videos count
            if (this.enrichFields.videos) {
                try {
                    const navnum = await this.requestWithRetry(`${this.apiBase}/x/space/navnum?mid=${mid}`);
                    result.videoCount = navnum && (navnum.video || navnum.video_archive || navnum.toview || navnum.dynamic) ? (navnum.video || navnum.video_archive) : (navnum && navnum.data && navnum.data.video);
                } catch (_) { this.enrichStats.skipped++; }
            }
            // level & official
            if (this.enrichFields.level || this.enrichFields.official) {
                try {
                    const info = await this.requestWithRetry(`${this.apiBase}/x/space/acc/info?mid=${mid}`);
                    if (this.enrichFields.level) result.level = info.level;
                    if (this.enrichFields.official) result.official = info.official && (info.official.title || info.official.role || info.official.type) ? info.official : (info.official_verify || null);
                } catch (_) { this.enrichStats.skipped++; }
            }

            this.enrichStats.done++;
            if (enrichCountEl) enrichCountEl.textContent = `${this.enrichStats.done}/${this.enrichStats.total}`;
            if (enrichSkippedEl) enrichSkippedEl.textContent = `（已跳过 ${this.enrichStats.skipped}）`;
            // 轻微节流
            await new Promise(r => setTimeout(r, 300));
            return { mid, data: result };
        });

        const results = await this.runWithConcurrency(tasks, this.maxConcurrency);
        const map = {};
        for (const r of results) {
            if (r && r.mid) map[r.mid] = r.data;
        }
        return map;
    }
    
    // 生成HTML文件内容
    generateHTML(followings) {
        const currentDate = new Date().toLocaleDateString('zh-CN');
        const currentTime = new Date().toLocaleTimeString('zh-CN');
        
        const hasFollowers = followings.some(u => u.followers != null);
        const sortSelect = document.getElementById('sortSelect');
        const sortValue = sortSelect ? sortSelect.value : 'none';
        let list = [...followings];
        if (hasFollowers && sortValue === 'followers_desc') {
            list.sort((a, b) => (b.followers || 0) - (a.followers || 0));
        }

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>B站关注列表 - ${currentDate}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #00a1d6 0%, #0084ff 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 16px;
        }
        
        .stats {
            display: flex;
            justify-content: center;
            gap: 30px;
            margin-top: 20px;
        }
        
        .stat-item {
            text-align: center;
        }
        
        .stat-number {
            font-size: 24px;
            font-weight: bold;
            display: block;
        }
        
        .stat-label {
            font-size: 14px;
            opacity: 0.8;
        }
        
        .search-section {
            padding: 20px;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
        }
        
        .search-box {
            width: 100%;
            max-width: 400px;
            margin: 0 auto;
            position: relative;
        }
        
        .search-input {
            width: 100%;
            padding: 12px 40px 12px 16px;
            border: 2px solid #e9ecef;
            border-radius: 25px;
            font-size: 16px;
            outline: none;
            transition: border-color 0.3s;
        }
        
        .search-input:focus {
            border-color: #00a1d6;
        }
        
        .search-icon {
            position: absolute;
            right: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: #6c757d;
        }
        
        .content {
            padding: 20px;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
        }
        
        .up-card {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 12px;
            padding: 20px;
            transition: all 0.3s ease;
            cursor: pointer;
            text-decoration: none;
            color: inherit;
        }
        
        .up-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
            border-color: #00a1d6;
        }
        
        .up-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .up-avatar {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            margin-right: 15px;
            object-fit: cover;
        }
        
        .up-info h3 {
            font-size: 16px;
            margin-bottom: 5px;
            color: #333;
        }
        
        .up-mid {
            font-size: 12px;
            color: #6c757d;
        }
        
        .up-sign {
            font-size: 14px;
            color: #666;
            line-height: 1.5;
            max-height: 60px;
            overflow: hidden;
            text-overflow: ellipsis;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }
        
        .no-results {
            text-align: center;
            padding: 40px;
            color: #6c757d;
            font-size: 16px;
        }
        
        .footer {
            text-align: center;
            padding: 20px;
            color: #6c757d;
            font-size: 14px;
            border-top: 1px solid #e9ecef;
        }
        
        @media (max-width: 768px) {
            .grid {
                grid-template-columns: 1fr;
            }
            
            .stats {
                flex-direction: column;
                gap: 15px;
            }
            
            .header {
                padding: 20px;
            }
            
            .header h1 {
                font-size: 24px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📺 B站关注列表</h1>
            <p>导出时间: ${currentDate} ${currentTime}</p>
            <div class="stats">
                <div class="stat-item">
                    <span class="stat-number">${followings.length}</span>
                    <span class="stat-label">关注总数</span>
                </div>
                <div class="stat-item">
                    <span class="stat-number">${Math.floor(followings.length / 10)}</span>
                    <span class="stat-label">页数</span>
                </div>
            </div>
        </div>
        
        <div class="search-section">
            <div class="search-box">
                <input type="text" class="search-input" id="searchInput" placeholder="搜索UP主名称或简介...">
                <span class="search-icon">🔍</span>
            </div>
        </div>
        
        <div class="content">
            <div class="grid" id="upGrid">
                ${list.map(up => `
                    <a href="https://space.bilibili.com/${up.mid}" target="_blank" class="up-card">
                        <div class="up-header">
                            <img src="${up.face}" alt="${up.uname}" class="up-avatar" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiNmMGYwZjAiLz4KPHN2ZyB4PSIxMiIgeT0iMTIiIHdpZHRoPSIyNiIgaGVpZ2h0PSIyNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjOTk5Ij4KPHBhdGggZD0iTTEyIDEyYzIuMjEgMCA0LTEuNzkgNC00cy0xLjc5LTQtNC00LTQgMS43OS00IDQgMS43OSA0IDQgNHptMCAyYy0yLjY3IDAtOCAxLjM0LTggNHYyaDE2di0yYzAtMi42Ni01LjMzLTQtOC00eiIvPgo8L3N2Zz4KPC9zdmc+'">
                            <div class="up-info">
                                <h3>${up.uname}</h3>
                                <div class="up-mid">UID: ${up.mid}</div>
                            </div>
                        </div>
                        <div class="up-sign">${up.sign || '这个人很懒，什么都没有写...'}</div>
                        ${up.followers != null || up.likes != null || up.videoCount != null || up.level != null || up.official ? `
                        <div style="margin-top:10px;font-size:13px;color:#444;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
                            ${up.followers != null ? `<div>粉丝：${up.followers}</div>` : ''}
                            ${up.likes != null ? `<div>获赞：${up.likes}</div>` : ''}
                            ${up.videoCount != null ? `<div>投稿数：${up.videoCount}</div>` : ''}
                            ${up.level != null ? `<div>等级：Lv.${up.level}</div>` : ''}
                            ${up.official ? `<div>认证：${(up.official.title||'官方') }</div>` : ''}
                        </div>` : ''}
                    </a>
                `).join('')}
            </div>
            
            <div id="noResults" class="no-results" style="display: none;">
                没有找到匹配的UP主
            </div>
        </div>
        
        <div class="footer">
            <p>由 B站关注列表导出器 生成 | 点击UP主卡片可跳转到其B站主页</p>
        </div>
    </div>
    
    <script>
        // 搜索功能
        const searchInput = document.getElementById('searchInput');
        const upGrid = document.getElementById('upGrid');
        const noResults = document.getElementById('noResults');
        const allCards = Array.from(upGrid.children);
        
        function filterCards() {
            const searchTerm = searchInput.value.toLowerCase();
            let visibleCount = 0;
            
            allCards.forEach(card => {
                const upName = card.querySelector('h3').textContent.toLowerCase();
                const upSign = card.querySelector('.up-sign').textContent.toLowerCase();
                
                if (upName.includes(searchTerm) || upSign.includes(searchTerm)) {
                    card.style.display = 'block';
                    visibleCount++;
                } else {
                    card.style.display = 'none';
                }
            });
            
            noResults.style.display = visibleCount === 0 ? 'block' : 'none';
        }
        
        searchInput.addEventListener('input', filterCards);
        
        // 添加键盘快捷键
        document.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                searchInput.focus();
            }
        });
    </script>
</body>
</html>`;
    }
    
    // 下载HTML文件
    downloadHTML(content) {
        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const currentDate = new Date().toISOString().split('T')[0];
        const filename = `bilibili_following_list_${currentDate}.html`;
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
    }
    
    // 开始导出流程
    async startExport() {
        const exportBtn = document.getElementById('exportBtn');
        exportBtn.disabled = true;
        exportBtn.innerHTML = '<span class="loading"></span> 正在导出...';
        
        try {
            this.updateStatus('正在获取用户信息...');
            
            // 获取用户ID
            const vmid = await this.getUserId();
            
            this.updateStatus('正在获取关注列表...');
            
            // 获取所有关注列表
            let followings = await this.getAllFollowings(vmid);

            // 如果开启富集，执行富集流程
            if (this.enableEnrich) {
                const enrichMap = await this.enrichFollowings(followings);
                followings = followings.map(up => ({ ...up, ...(enrichMap[up.mid] || {}) }));
                // 排序区常显，无需在此显示
            }
            
            this.updateStatus('正在生成HTML文件...');
            
            // 生成HTML内容
            const htmlContent = this.generateHTML(followings);
            
            this.updateStatus('正在下载文件...');
            
            // 下载文件
            this.downloadHTML(htmlContent);
            
            this.updateStatus('导出完成!', `${followings.length}个UP主`);
            
        } catch (error) {
            console.error('导出失败:', error);
            this.showError(error.message);
            this.updateStatus('导出失败');
        } finally {
            exportBtn.disabled = false;
            exportBtn.innerHTML = '<span class="btn-icon">📥</span><span class="btn-text">导出关注列表</span>';
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    new BilibiliExporter();
});
