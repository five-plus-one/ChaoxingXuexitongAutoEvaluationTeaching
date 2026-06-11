// ==UserScript==
// @name         超星学习通一键评教
// @namespace    https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/
// @version      1.0.0
// @description  批量自动评教，一键给所有教师最好的评价并提交
// @author       five-plus-one
// @match        *://*.chaoxing.com/*
// @match        *://i.chaoxing.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/chaoxing-auto-eval.user.js
// @downloadURL  https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/chaoxing-auto-eval.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        delay: 1500,
        comment: '老师授课认真负责，教学效果良好，课程安排合理，能及时解答学生疑问，非常满意。',
        positiveKeywords: ['无上述问题', '没有问题', '正常', '很好', '满意', '认真', '负责', '积极', '优秀', '无'],
        maxRetries: 2,
    };

    /* ── Utilities ──────────────────────────────────────── */

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function showToast(msg, type = 'info', duration = 3000) {
        const el = document.createElement('div');
        const colors = { info: '#1890ff', success: '#52c41a', error: '#ff4d4f', warn: '#faad14' };
        Object.assign(el.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: '999999',
            padding: '12px 20px', borderRadius: '8px', color: '#fff',
            background: colors[type] || colors.info, fontSize: '14px',
            fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.15)',
            transition: 'opacity .3s', opacity: '0', maxWidth: '360px', wordBreak: 'break-all',
        });
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.style.opacity = '1');
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration);
    }

    function parseOnclick(str) {
        const m = str.match(/questionnaireInfo\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/);
        return m ? { alreadyId: m[1], grantId: m[2], questionnaireId: m[3] } : null;
    }

    /* ── Form Parser ────────────────────────────────────── */

    function parseFormHTML(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const getVal = id => { const el = doc.getElementById(id); return el ? el.value : ''; };

        const meta = {
            uId: getVal('uId'),
            fid: getVal('fid'),
            questionnaireId: getVal('questionnaireId'),
            alreadyId: getVal('alreadyId'),
            grantId: getVal('grantId'),
        };

        const questions = [];
        const groups = doc.querySelectorAll('.testBox.groupTarget');
        groups.forEach(group => {
            const id = group.id;
            const visible = group.style.display !== 'none';
            if (!visible) return;

            const titleEl = group.querySelector('.target-title');
            const title = titleEl ? (titleEl.getAttribute('value') || titleEl.textContent || '').trim() : '';

            const hiddenInputs = [];
            group.querySelectorAll('input[type="hidden"]').forEach(h => {
                hiddenInputs.push({ name: h.name, value: h.value });
            });

            const radios = group.querySelectorAll('input[type="radio"]');
            const checkboxes = group.querySelectorAll('input[type="checkbox"]');
            const textarea = group.querySelector('textarea');

            let qType = 'unknown';
            let bestValue = '';
            let bestScore = 0;
            let selectedCheckboxes = [];

            if (radios.length > 0) {
                qType = 'radio';
                const first = radios[0];
                bestValue = first.value;
                bestScore = parseFloat(first.getAttribute('score')) || 0;
            } else if (checkboxes.length > 0) {
                qType = 'checkbox';
                const hasPositive = Array.from(checkboxes).some(cb => {
                    const label = cb.closest('label');
                    const text = label ? label.textContent : '';
                    return CONFIG.positiveKeywords.some(kw => text.includes(kw));
                });

                if (hasPositive) {
                    checkboxes.forEach(cb => {
                        const label = cb.closest('label');
                        const text = label ? label.textContent : '';
                        if (CONFIG.positiveKeywords.some(kw => text.includes(kw))) {
                            selectedCheckboxes.push(cb.value);
                        }
                    });
                } else if (checkboxes.length > 0) {
                    selectedCheckboxes.push(checkboxes[checkboxes.length - 1].value);
                }
            } else if (textarea) {
                qType = 'textarea';
                bestValue = CONFIG.comment;
            }

            questions.push({ id, title, qType, bestValue, bestScore, selectedCheckboxes, hiddenInputs, name: radios[0]?.name || checkboxes[0]?.name || textarea?.name || '' });
        });

        return { meta, questions, doc };
    }

    /* ── Build & Submit ─────────────────────────────────── */

    function buildPostData(formDoc, parsedAnswers, saveType) {
        const params = [];
        const added = new Set();

        formDoc.querySelectorAll('input[name], textarea[name]').forEach(el => {
            const name = el.name;
            if (!name) return;

            if (el.type === 'radio') {
                const q = parsedAnswers.find(a => a.name === name);
                if (q && q.qType === 'radio') {
                    const key = 'radio_' + name;
                    if (!added.has(key)) {
                        params.push([name, q.bestValue]);
                        added.add(key);
                    }
                }
            } else if (el.type === 'checkbox') {
                const q = parsedAnswers.find(a => a.name === name);
                if (q && q.qType === 'checkbox') {
                    const key = 'cb_' + name;
                    if (!added.has(key)) {
                        q.selectedCheckboxes.forEach(v => params.push([name, v]));
                        added.add(key);
                    }
                }
            } else if (el.tagName === 'TEXTAREA') {
                const q = parsedAnswers.find(a => a.name === name);
                if (q && q.qType === 'textarea') {
                    const key = 'ta_' + name;
                    if (!added.has(key)) {
                        params.push([name, q.bestValue]);
                        added.add(key);
                    }
                }
            } else {
                params.push([name, el.value]);
            }
        });

        params.push(['saveType', String(saveType)]);
        return params.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
    }

    function calcCheckScore(questions) {
        return questions.reduce((sum, q) => sum + (q.qType === 'radio' ? q.bestScore : 0), 0);
    }

    async function fetchFormPage(alreadyId, grantId, questionnaireId) {
        const url = `/pj/newesReception/questionnaireInfo?alreadyId=${alreadyId}&grantId=${grantId}&questionnaireId=${questionnaireId}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.text();
    }

    async function submitEval(parsed) {
        const { meta, questions, doc } = parsed;
        const checkScore = calcCheckScore(questions);
        const postData = buildPostData(doc, questions, 2);

        const linkParam = `?checkScore=${checkScore}&questionnaireId=${meta.questionnaireId}&fid=${meta.fid}&uId=${meta.uId}&grantId=${meta.grantId}&alreadyId=${meta.alreadyId}&saveType1=2`;

        const resp = await fetch('/pj/newesReception/saveQuestionnaire' + linkParam, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: postData + '&checkScore=' + checkScore,
        });

        const data = await resp.json();
        return { success: data.status === 1, message: data.msg || data.message || '未知结果', score: checkScore };
    }

    /* ── List Page Detection ────────────────────────────── */

    function findPendingItems() {
        const items = [];
        const links = document.querySelectorAll('a');
        links.forEach(a => {
            const text = a.textContent.trim();
            if (text !== '待评价') return;
            const onclick = a.getAttribute('onclick') || '';
            const params = parseOnclick(onclick);
            if (!params) return;

            const tr = a.closest('tr');
            if (!tr) return;
            const tds = tr.querySelectorAll('td');
            const teacher = tds[2]?.textContent.trim() || '未知教师';
            const course = tds[3]?.textContent.trim() || '未知课程';
            const formType = tds[1]?.textContent.trim() || '';

            items.push({ ...params, teacher, course, formType, element: tr });
        });
        return items;
    }

    function findAllDoneItems() {
        const done = [];
        document.querySelectorAll('a').forEach(a => {
            const text = a.textContent.trim();
            if (text === '查看详情') {
                const tr = a.closest('tr');
                if (tr) {
                    const tds = tr.querySelectorAll('td');
                    done.push({ teacher: tds[2]?.textContent.trim() || '' });
                }
            }
        });
        return done;
    }

    /* ── Control Panel ──────────────────────────────────── */

    let panel, statusEl, logEl, startBtn, stopBtn;
    let running = false;
    let stopRequested = false;

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'auto-eval-panel';
        panel.innerHTML = `
            <style>
                #auto-eval-panel {
                    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
                    width: 380px; background: #fff; border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,.18); font-family: system-ui, -apple-system, sans-serif;
                    overflow: hidden; transition: transform .3s;
                }
                #auto-eval-panel.minimized { transform: translateY(calc(100% - 48px)); }
                #auto-eval-panel .ae-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #fff; padding: 14px 16px; cursor: pointer;
                    display: flex; justify-content: space-between; align-items: center;
                    user-select: none;
                }
                #auto-eval-panel .ae-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
                #auto-eval-panel .ae-body { padding: 14px 16px; max-height: 400px; overflow-y: auto; }
                #auto-eval-panel .ae-stat { display: flex; gap: 12px; margin-bottom: 12px; }
                #auto-eval-panel .ae-stat span {
                    flex: 1; text-align: center; padding: 8px; border-radius: 8px; font-size: 13px;
                }
                #auto-eval-panel .ae-stat .ae-total { background: #f0f0f0; }
                #auto-eval-panel .ae-stat .ae-done { background: #f6ffed; color: #52c41a; }
                #auto-eval-panel .ae-stat .ae-fail { background: #fff2f0; color: #ff4d4f; }
                #auto-eval-panel .ae-btns { display: flex; gap: 8px; margin-bottom: 12px; }
                #auto-eval-panel .ae-btns button {
                    flex: 1; padding: 10px; border: none; border-radius: 8px;
                    font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s;
                }
                #auto-eval-panel .ae-btns button:hover { opacity: .85; }
                #auto-eval-panel .ae-btns .ae-start { background: #667eea; color: #fff; }
                #auto-eval-panel .ae-btns .ae-stop { background: #ff4d4f; color: #fff; }
                #auto-eval-panel .ae-btns button:disabled { opacity: .4; cursor: not-allowed; }
                #auto-eval-panel .ae-log {
                    background: #fafafa; border-radius: 8px; padding: 10px;
                    font-size: 12px; max-height: 200px; overflow-y: auto;
                    font-family: 'Cascadia Code', 'Fira Code', monospace; line-height: 1.6;
                }
                #auto-eval-panel .ae-log .ae-ok { color: #52c41a; }
                #auto-eval-panel .ae-log .ae-err { color: #ff4d4f; }
                #auto-eval-panel .ae-log .ae-info { color: #1890ff; }
                #auto-eval-panel .ae-progress {
                    height: 4px; background: #f0f0f0; border-radius: 2px; margin-bottom: 12px; overflow: hidden;
                }
                #auto-eval-panel .ae-progress-bar {
                    height: 100%; background: linear-gradient(90deg, #667eea, #764ba2);
                    border-radius: 2px; transition: width .3s; width: 0%;
                }
            </style>
            <div class="ae-header">
                <h3>📋 超星一键评教</h3>
                <span class="ae-toggle">▼</span>
            </div>
            <div class="ae-body">
                <div class="ae-stat">
                    <span class="ae-total">待评: <b id="ae-total">0</b></span>
                    <span class="ae-done">完成: <b id="ae-done">0</b></span>
                    <span class="ae-fail">失败: <b id="ae-fail">0</b></span>
                </div>
                <div class="ae-progress"><div class="ae-progress-bar" id="ae-bar"></div></div>
                <div class="ae-btns">
                    <button class="ae-start" id="ae-start">▶ 开始批量评教</button>
                    <button class="ae-stop" id="ae-stop" disabled>⏹ 停止</button>
                </div>
                <div class="ae-log" id="ae-log">
                    <div class="ae-info">就绪，点击"开始批量评教"启动</div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        statusEl = { total: panel.querySelector('#ae-total'), done: panel.querySelector('#ae-done'), fail: panel.querySelector('#ae-fail'), bar: panel.querySelector('#ae-bar') };
        logEl = panel.querySelector('#ae-log');
        startBtn = panel.querySelector('#ae-start');
        stopBtn = panel.querySelector('#ae-stop');

        panel.querySelector('.ae-header').addEventListener('click', () => panel.classList.toggle('minimized'));
        startBtn.addEventListener('click', startBatch);
        stopBtn.addEventListener('click', () => { stopRequested = true; });

        const alreadyDone = findAllDoneItems();
        if (alreadyDone.length > 0) {
            log(`已有 ${alreadyDone.length} 个评价已完成（显示"查看详情"）`, 'info');
        }
    }

    function log(msg, type = '') {
        const div = document.createElement('div');
        if (type) div.className = 'ae-' + type;
        div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        logEl.appendChild(div);
        logEl.scrollTop = logEl.scrollHeight;
    }

    function updateStat(total, done, fail) {
        statusEl.total.textContent = total;
        statusEl.done.textContent = done;
        statusEl.fail.textContent = fail;
        statusEl.bar.style.width = total ? ((done + fail) / total * 100) + '%' : '0%';
    }

    /* ── Batch Processor ────────────────────────────────── */

    async function startBatch() {
        if (running) return;
        running = true;
        stopRequested = false;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        logEl.innerHTML = '';

        const items = findPendingItems();
        const total = items.length;

        if (total === 0) {
            log('没有找到待评价的项目', 'info');
            showToast('没有找到待评价的项目', 'warn');
            running = false;
            startBtn.disabled = false;
            stopBtn.disabled = true;
            return;
        }

        log(`发现 ${total} 个待评价项目，开始处理...`, 'info');
        showToast(`开始批量评教：共 ${total} 个`, 'info');
        updateStat(total, 0, 0);

        let done = 0, fail = 0;

        for (let i = 0; i < total; i++) {
            if (stopRequested) {
                log('用户手动停止', 'err');
                showToast('已停止批量评教', 'warn');
                break;
            }

            const item = items[i];
            log(`[${i + 1}/${total}] ${item.teacher} - ${item.course}`, 'info');

            let success = false;
            for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
                try {
                    if (retry > 0) log(`  重试 (${retry}/${CONFIG.maxRetries})...`, 'info');

                    const html = await fetchFormPage(item.alreadyId, item.grantId, item.questionnaireId);
                    const parsed = parseFormHTML(html);

                    if (!parsed.meta.uId) throw new Error('无法获取用户ID，可能未登录或页面结构变化');

                    log(`  表单解析完成，共 ${parsed.questions.length} 题，预估得分 ${calcCheckScore(parsed.questions)}`, 'info');

                    const result = await submitEval(parsed);

                    if (result.success) {
                        log(`  ✓ 提交成功 (得分: ${result.score})`, 'ok');
                        if (item.element) item.element.style.opacity = '0.4';
                        done++;
                        success = true;
                        break;
                    } else {
                        throw new Error(result.message);
                    }
                } catch (err) {
                    if (retry === CONFIG.maxRetries) {
                        log(`  ✗ 失败: ${err.message}`, 'err');
                        fail++;
                    } else {
                        log(`  出错: ${err.message}，准备重试`, 'err');
                        await sleep(2000);
                    }
                }
            }

            updateStat(total, done, fail);

            if (i < total - 1 && !stopRequested) {
                const jitter = Math.random() * 1000;
                await sleep(CONFIG.delay + jitter);
            }
        }

        const summary = `批量评教完成！成功 ${done} 个，失败 ${fail} 个`;
        log(summary, done > 0 ? 'ok' : 'err');
        showToast(summary, fail === 0 ? 'success' : 'warn', 5000);

        running = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }

    /* ── Single Form Auto-Fill (Form Page Mode) ─────────── */

    function autoFillCurrentForm() {
        if (!document.getElementById('formId')) return;
        log('检测到评教表单页面，自动填答中...', 'info');

        document.querySelectorAll('.testBox.groupTarget').forEach(group => {
            if (group.offsetParent === null && getComputedStyle(group).display === 'none') return;

            const radios = group.querySelectorAll('input[type="radio"]');
            if (radios.length > 0 && !radios[0].checked) {
                radios[0].click();
                return;
            }

            const checkboxes = group.querySelectorAll('input[type="checkbox"]');
            if (checkboxes.length > 0) {
                const title = group.querySelector('.target-title')?.getAttribute('value') || '';
                if (title.includes('教材') || title.includes('选用')) {
                    checkboxes.forEach(cb => {
                        const text = cb.closest('label')?.textContent || '';
                        if (CONFIG.positiveKeywords.some(kw => text.includes(kw)) && !cb.checked) cb.click();
                    });
                }
                return;
            }

            const textarea = group.querySelector('textarea');
            if (textarea && !textarea.value.trim()) {
                textarea.value = CONFIG.comment;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });

        log('自动填答完成，请检查后手动提交', 'ok');
        showToast('自动填答完成', 'success');
    }

    /* ── Init ───────────────────────────────────────────── */

    function init() {
        const isListPage = findPendingItems().length > 0 || document.querySelector('table tbody tr');

        if (isListPage) {
            createPanel();
            showToast('一键评教脚本已加载', 'info');
        } else if (document.getElementById('formId')) {
            autoFillCurrentForm();
        } else {
            showToast('请在评教列表页或评教表单页使用', 'warn');
        }
    }

    setTimeout(init, 800);

})();
