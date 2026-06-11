// ==UserScript==
// @name         超星学习通一键评教
// @namespace    https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/
// @version      2.3.0
// @description  批量自动评教，打开表单页自动填答，确认后提交
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
        comment: '老师授课认真负责，教学效果良好，课程安排合理，能及时解答学生疑问，非常满意。',
        positiveKeywords: ['无上述问题', '没有问题', '正常', '很好', '满意', '认真', '负责', '积极', '优秀'],
    };

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const $ = (s, ctx) => (ctx || document).querySelector(s);
    const $$ = (s, ctx) => (ctx || document).querySelectorAll(s);

    /* ── Toast ──────────────────────────────────────────── */

    function showToast(msg, type = 'info', duration = 3000) {
        const el = document.createElement('div');
        const colors = { info: '#1890ff', success: '#52c41a', error: '#ff4d4f', warn: '#faad14' };
        Object.assign(el.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
            padding: '14px 22px', borderRadius: '10px', color: '#fff',
            background: colors[type] || colors.info, fontSize: '14px',
            fontFamily: 'system-ui, -apple-system, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)',
            transition: 'opacity .3s', opacity: '0', maxWidth: '380px', wordBreak: 'break-all',
        });
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.style.opacity = '1');
        setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, duration);
    }

    /* ── Batch State ────────────────────────────────────── */

    function getBatch() {
        try { return JSON.parse(sessionStorage.getItem('ae_batch')); } catch { return null; }
    }
    function setBatch(state) { sessionStorage.setItem('ae_batch', JSON.stringify(state)); }
    function clearBatch() { sessionStorage.removeItem('ae_batch'); }

    /* ── 查找待评价链接 ─────────────────────────────────── */

    function findPendingLinks() {
        const items = [];
        $$('[onclick]').forEach(el => {
            const onclick = el.getAttribute('onclick') || '';
            if (!onclick.includes('questionnaireInfo')) return;
            if (el.textContent.trim() !== '待评价') return;

            const m = onclick.match(/questionnaireInfo\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/);
            if (!m) return;

            const tr = el.closest('tr');
            let teacher = '', course = '';
            if (tr) {
                const tds = tr.querySelectorAll('td');
                const header = tr.closest('table')?.querySelector('thead tr');
                if (header) {
                    header.querySelectorAll('th').forEach((th, idx) => {
                        const h = th.textContent.trim();
                        if (h.includes('教师')) teacher = tds[idx]?.textContent.trim() || '';
                        if (h.includes('课程')) course = tds[idx]?.textContent.trim() || '';
                    });
                }
                if (!teacher && !course && tds.length >= 4) {
                    teacher = tds[2]?.textContent.trim() || '';
                    course = tds[3]?.textContent.trim() || '';
                }
            }

            items.push({ alreadyId: m[1], grantId: m[2], questionnaireId: m[3], teacher, course, link: el });
        });
        return items;
    }

    /* ── 自动填答（返回答案列表） ───────────────────────── */

    function autoFillForm() {
        let filled = 0, totalScore = 0;
        const answers = [];

        $$('.testBox.groupTarget').forEach(group => {
            if (getComputedStyle(group).display === 'none') return;

            const titleEl = group.querySelector('.target-title');
            const qTitle = titleEl ? (titleEl.getAttribute('value') || titleEl.textContent || '').trim() : '未知题目';
            const num = group.querySelector('.tmnum')?.textContent?.trim() || '';

            const radios = $$('input[type="radio"]', group);
            if (radios.length > 0) {
                if (!radios[0].checked) radios[0].click();
                const score = parseFloat(radios[0].getAttribute('score')) || 0;
                totalScore += score;
                const answer = radios[0].closest('label')?.querySelector('.target-zh')?.textContent?.trim() || radios[0].value;
                answers.push({ num, title: qTitle, answer, score });
                filled++;
                return;
            }

            const checkboxes = $$('input[type="checkbox"]', group);
            if (checkboxes.length > 0) {
                let clicked = false;
                const selectedTexts = [];
                if (qTitle.includes('教材') || qTitle.includes('选用') || qTitle.includes('情况')) {
                    checkboxes.forEach(cb => {
                        const text = cb.closest('label')?.textContent?.trim() || '';
                        if (CONFIG.positiveKeywords.some(kw => text.includes(kw)) && !cb.checked) {
                            cb.click(); clicked = true;
                            selectedTexts.push(text);
                        }
                    });
                }
                if (!clicked && checkboxes.length > 0) {
                    const lastCb = checkboxes[checkboxes.length - 1];
                    if (!lastCb.checked) lastCb.click();
                    selectedTexts.push(lastCb.closest('label')?.textContent?.trim() || lastCb.value);
                }
                answers.push({ num, title: qTitle, answer: selectedTexts.join('、') || '已选', score: 0 });
                filled++;
                return;
            }

            const textarea = group.querySelector('textarea');
            if (textarea && !textarea.value.trim()) {
                textarea.value = CONFIG.comment;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
                answers.push({ num, title: qTitle, answer: CONFIG.comment, score: 0 });
                filled++;
            }
        });

        return { filled, totalScore, answers };
    }

    /* ── 确认弹窗（10秒倒计时 + 答案预览 + 暂停） ──────── */

    const COUNTDOWN_SEC = 10;

    function showConfirmModal({ teacher, course, filled, totalScore, index, total, answers }) {
        return new Promise(resolve => {
            const old = document.getElementById('ae-confirm-overlay');
            if (old) old.remove();

            let countdown = COUNTDOWN_SEC;
            let paused = false;
            let timer = null;

            const answersHtml = (answers || []).map((a, i) =>
                `<div class="ae-ans-item"><span class="ae-ans-num">${a.num || (i + 1)}</span><div class="ae-ans-body"><div class="ae-ans-q">${a.title}</div><div class="ae-ans-a">→ ${a.answer}${a.score > 0 ? ' <span class="ae-ans-score">(' + a.score + '分)</span>' : ''}</div></div></div>`
            ).join('');

            const overlay = document.createElement('div');
            overlay.id = 'ae-confirm-overlay';
            overlay.innerHTML = `
                <style>
                    #ae-confirm-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif}
                    #ae-confirm-overlay .ae-modal{background:#fff;border-radius:16px;width:520px;max-width:92vw;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3);color:#333}
                    #ae-confirm-overlay .ae-head{padding:24px 28px 0;flex-shrink:0}
                    #ae-confirm-overlay .ae-head h3{margin:0 0 12px;font-size:18px;display:flex;align-items:center;gap:10px}
                    #ae-confirm-overlay .ae-head .ae-countdown{display:inline-flex;align-items:center;gap:4px;background:#f3f4f6;border-radius:8px;padding:4px 10px;font-size:13px;font-weight:600;color:#666;cursor:pointer;user-select:none}
                    #ae-confirm-overlay .ae-head .ae-countdown.paused{background:#fef3c7;color:#d97706}
                    #ae-confirm-overlay .ae-head .ae-countdown svg{width:14px;height:14px}
                    #ae-confirm-overlay .ae-info{display:flex;gap:16px;font-size:13px;color:#666;margin-top:8px;flex-wrap:wrap}
                    #ae-confirm-overlay .ae-info span{display:flex;align-items:center;gap:4px}
                    #ae-confirm-overlay .ae-score-bar{margin:16px 28px 0;padding:12px 16px;background:#f0fdf4;border-radius:10px;text-align:center;font-size:15px;color:#16a34a;font-weight:700;flex-shrink:0}
                    #ae-confirm-overlay .ae-answers{flex:1;overflow-y:auto;padding:16px 28px;min-height:0}
                    #ae-confirm-overlay .ae-ans-item{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:13px}
                    #ae-confirm-overlay .ae-ans-item:last-child{border-bottom:none}
                    #ae-confirm-overlay .ae-ans-num{flex-shrink:0;width:22px;height:22px;background:#f3f4f6;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:600;color:#999;font-size:11px}
                    #ae-confirm-overlay .ae-ans-body{flex:1;min-width:0}
                    #ae-confirm-overlay .ae-ans-q{color:#333;font-weight:500;line-height:1.4}
                    #ae-confirm-overlay .ae-ans-a{color:#16a34a;margin-top:2px;line-height:1.4;word-break:break-all}
                    #ae-confirm-overlay .ae-ans-score{color:#999;font-weight:400}
                    #ae-confirm-overlay .ae-foot{padding:16px 28px 24px;border-top:1px solid #f0f0f0;flex-shrink:0}
                    #ae-confirm-overlay .ae-btns{display:flex;gap:10px}
                    #ae-confirm-overlay .ae-btns button{flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s}
                    #ae-confirm-overlay .ae-btns button:hover{transform:translateY(-1px)}
                    #ae-confirm-overlay .ae-btns .ae-yes{background:#000;color:#fff}
                    #ae-confirm-overlay .ae-btns .ae-skip{background:#f3f4f6;color:#666}
                    #ae-confirm-overlay .ae-btns .ae-stop{background:#fef2f2;color:#dc2626}
                    #ae-confirm-overlay .ae-prog{text-align:center;color:#999;font-size:12px;margin-top:12px}
                </style>
                <div class="ae-modal">
                    <div class="ae-head">
                        <h3>
                            确认提交评教
                            <span class="ae-countdown" id="ae-cd" title="点击暂停/继续">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                <span id="ae-cd-num">${COUNTDOWN_SEC}</span>s
                            </span>
                        </h3>
                        <div class="ae-info">
                            <span>教师：${teacher || '未知'}</span>
                            <span>课程：${course || '未知'}</span>
                            <span>${filled} 道题</span>
                        </div>
                    </div>
                    <div class="ae-score-bar">预估总分：${totalScore} 分</div>
                    <div class="ae-answers">${answersHtml || '<div style="color:#999;text-align:center;padding:20px">无题目数据</div>'}</div>
                    <div class="ae-foot">
                        <div class="ae-btns">
                            <button class="ae-yes" id="ae-cfm-yes">确认提交</button>
                            <button class="ae-skip" id="ae-cfm-skip">跳过</button>
                            <button class="ae-stop" id="ae-cfm-stop">停止</button>
                        </div>
                        <div class="ae-prog">${index + 1} / ${total}</div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const cdEl = overlay.querySelector('#ae-cd');
            const cdNum = overlay.querySelector('#ae-cd-num');

            function cleanup() {
                if (timer) clearInterval(timer);
                overlay.remove();
            }

            function startTimer() {
                timer = setInterval(() => {
                    if (paused) return;
                    countdown--;
                    cdNum.textContent = countdown;
                    if (countdown <= 0) {
                        cleanup();
                        resolve('submit');
                    }
                }, 1000);
            }

            cdEl.addEventListener('click', (e) => {
                e.stopPropagation();
                paused = !paused;
                cdEl.classList.toggle('paused', paused);
                cdNum.textContent = paused ? '⏸' : countdown;
            });

            overlay.querySelector('#ae-cfm-yes').onclick = () => { cleanup(); resolve('submit'); };
            overlay.querySelector('#ae-cfm-skip').onclick = () => { cleanup(); resolve('skip'); };
            overlay.querySelector('#ae-cfm-stop').onclick = () => { cleanup(); resolve('stop'); };

            startTimer();
        });
    }

    /* ── 控制面板 ───────────────────────────────────────── */

    let panelCreated = false;

    function createPanel() {
        if (panelCreated || document.getElementById('ae-panel')) return;
        panelCreated = true;
        const panel = document.createElement('div');
        panel.id = 'ae-panel';
        panel.innerHTML = `
            <style>
                #ae-panel{position:fixed;bottom:24px;right:24px;z-index:2147483646;width:320px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.2);font-family:system-ui,-apple-system,sans-serif;overflow:hidden;border:1px solid rgba(0,0,0,.06)}
                #ae-panel.minimized .ae-body{display:none}
                #ae-panel .ae-header{background:#000;color:#fff;padding:16px 18px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;user-select:none}
                #ae-panel .ae-header h3{margin:0;font-size:15px;font-weight:600}
                #ae-panel .ae-header .ae-toggle{font-size:12px;opacity:.6;transition:transform .2s}
                #ae-panel.minimized .ae-header .ae-toggle{transform:rotate(180deg)}
                #ae-panel .ae-body{padding:16px 18px}
                #ae-panel .ae-stat{display:flex;gap:8px;margin-bottom:14px}
                #ae-panel .ae-stat span{flex:1;text-align:center;padding:10px 6px;border-radius:10px;font-size:13px;background:#f7f7f8}
                #ae-panel .ae-stat b{font-weight:700}
                #ae-panel .ae-stat .ae-s-done{background:#f0fdf4;color:#16a34a}
                #ae-panel .ae-stat .ae-s-skip{background:#fefce8;color:#ca8a04}
                #ae-panel .ae-btns{display:flex;gap:8px}
                #ae-panel .ae-btns button{flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer}
                #ae-panel .ae-btns .ae-start{background:#000;color:#fff}
                #ae-panel .ae-btns button:disabled{opacity:.35;cursor:not-allowed}
                #ae-panel .ae-tip{margin-top:12px;font-size:12px;color:#999;line-height:1.6}
            </style>
            <div class="ae-header"><h3>一键评教</h3><span class="ae-toggle">▲</span></div>
            <div class="ae-body">
                <div class="ae-stat">
                    <span>待评 <b id="ae-p-total">0</b></span>
                    <span class="ae-s-done">完成 <b id="ae-p-done">0</b></span>
                    <span class="ae-s-skip">跳过 <b id="ae-p-skip">0</b></span>
                </div>
                <div class="ae-btns"><button class="ae-start" id="ae-start">开始批量评教</button></div>
                <div class="ae-tip">点击开始后，逐个打开表单自动填答，确认后提交</div>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector('.ae-header').onclick = () => panel.classList.toggle('minimized');
        panel.querySelector('#ae-start').onclick = startBatch;
        updatePanelStats();
    }

    function updatePanelStats() {
        const panel = document.getElementById('ae-panel');
        if (!panel) return;
        panel.querySelector('#ae-p-total').textContent = findPendingLinks().length;
        let doneNum = 0;
        $$('a').forEach(a => { if (a.textContent.trim() === '查看详情') doneNum++; });
        panel.querySelector('#ae-p-done').textContent = doneNum;
        const state = getBatch();
        if (state) panel.querySelector('#ae-p-skip').textContent = state.skip || 0;
    }

    /* ── 启动批量 ───────────────────────────────────────── */

    function startBatch() {
        const items = findPendingLinks();
        if (items.length === 0) { showToast('没有待评价的项目', 'warn'); return; }
        setBatch({ active: true, total: items.length, done: 0, skip: 0, currentTeacher: items[0].teacher, currentCourse: items[0].course });
        showToast(`开始：共 ${items.length} 个`, 'info', 2000);
        setTimeout(() => items[0].link.click(), 600);
    }

    /* ── 表单页处理 ─────────────────────────────────────── */

    async function processFormPage() {
        const state = getBatch();
        if (!state || !state.active) return;
        await sleep(1500);

        let teacher = '', course = '';
        $$('.topBox p span').forEach(s => {
            const t = s.textContent.trim();
            if (t.startsWith('授课教师')) teacher = t.replace('授课教师：', '').trim();
            if (t.startsWith('课程名称')) course = t.replace('课程名称：', '').trim();
        });

        const { filled, totalScore, answers } = autoFillForm();
        const result = await showConfirmModal({
            teacher: teacher || state.currentTeacher,
            course: course || state.currentCourse,
            filled, totalScore, answers,
            index: state.done + state.skip, total: state.total,
        });

        if (result === 'submit') {
            state.done++; setBatch(state);
            await sleep(600);
            if (typeof save === 'function') save(2);
            else { const btn = $('.botBtnBox .save'); if (btn) btn.click(); }
        } else if (result === 'skip') {
            state.skip++; setBatch(state);
            goBackToList();
        } else {
            clearBatch();
            goBackToList();
        }
    }

    function goBackToList() {
        if (typeof goBack === 'function') goBack();
        else window.location.href = '/pj/newesReception/hehaiRatedHome';
    }

    /* ── 列表页继续 ─────────────────────────────────────── */

    function continueOnListPage() {
        const state = getBatch();
        if (!state || !state.active) return;
        const pending = findPendingLinks();
        if (pending.length === 0) {
            clearBatch();
            showToast(`批量评教完成！完成 ${state.done} 个，跳过 ${state.skip} 个`, 'success', 5000);
            updatePanelStats();
            return;
        }
        updatePanelStats();
        state.currentTeacher = pending[0].teacher;
        state.currentCourse = pending[0].course;
        setBatch(state);
        showToast(`(${state.done + state.skip + 1}/${state.total}) ${pending[0].teacher}`, 'info', 2000);
        setTimeout(() => pending[0].link.click(), 1200);
    }

    /* ── Init：优先检测待评价链接，再检测表单 ────────────── */

    async function init() {
        for (let attempt = 0; attempt < 30; attempt++) {
            // 优先级1：有待评价链接 → 列表页
            const pending = findPendingLinks();
            if (pending.length > 0) {
                createPanel();
                continueOnListPage();
                return;
            }

            // 优先级2：有实际评教题目（.testBox.groupTarget）→ 表单页
            // 注意：不能只看 #formId，列表页上也可能有 formId 元素
            if ($('.testBox.groupTarget')) {
                processFormPage();
                return;
            }

            await sleep(500);
        }

        // 轮询结束仍未找到内容，显示提示
        if (window.parent === window) {
            showToast('请先点击左侧"评价问卷"进入评教列表', 'warn', 5000);
        }
    }

    init();

})();
