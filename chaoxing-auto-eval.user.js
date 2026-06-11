// ==UserScript==
// @name         超星学习通一键评教
// @namespace    https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/
// @version      2.1.0
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

    /* ── 等待元素出现 ───────────────────────────────────── */

    function waitForElements(selector, timeout = 15000, root = document) {
        return new Promise(resolve => {
            const found = $$(selector, root);
            if (found.length > 0) return resolve(found);

            const obs = new MutationObserver(() => {
                const els = $$(selector, root);
                if (els.length > 0) { obs.disconnect(); resolve(els); }
            });
            obs.observe(root.body || root, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve($$(selector, root)); }, timeout);
        });
    }

    /* ── 页面检测 ───────────────────────────────────────── */

    function isFormPage(doc) { return !!(doc || document).getElementById('formId'); }

    function findPendingLinks(doc) {
        const d = doc || document;
        const items = [];
        $$('a', d).forEach(a => {
            if (a.textContent.trim() !== '待评价') return;
            const onclick = a.getAttribute('onclick') || '';
            const m = onclick.match(/questionnaireInfo\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/);
            if (!m) return;
            const tr = a.closest('tr');
            if (!tr) return;
            const tds = tr.querySelectorAll('td');
            items.push({
                alreadyId: m[1], grantId: m[2], questionnaireId: m[3],
                teacher: tds[2]?.textContent.trim() || '',
                course: tds[3]?.textContent.trim() || '',
                link: a,
            });
        });
        return items;
    }

    /* ── 检查当前页面和 iframe ──────────────────────────── */

    function findAllFrames() {
        const frames = [];
        try {
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const f = window.frames[i].document;
                    if (f) frames.push(f);
                } catch {}
            }
        } catch {}
        return frames;
    }

    /* ── 自动填答 ───────────────────────────────────────── */

    function autoFillForm(doc) {
        const d = doc || document;
        let filled = 0, totalScore = 0;

        $$('.testBox.groupTarget', d).forEach(group => {
            if (d !== document && getComputedStyle(group).display === 'none') return;

            const radios = $$('input[type="radio"]', group);
            if (radios.length > 0) {
                if (!radios[0].checked) radios[0].click();
                totalScore += parseFloat(radios[0].getAttribute('score')) || 0;
                filled++;
                return;
            }

            const checkboxes = $$('input[type="checkbox"]', group);
            if (checkboxes.length > 0) {
                const title = (group.querySelector('.target-title')?.getAttribute('value') || '');
                let clicked = false;
                if (title.includes('教材') || title.includes('选用') || title.includes('情况')) {
                    checkboxes.forEach(cb => {
                        const text = cb.closest('label')?.textContent || '';
                        if (CONFIG.positiveKeywords.some(kw => text.includes(kw)) && !cb.checked) {
                            cb.click(); clicked = true;
                        }
                    });
                }
                if (!clicked) {
                    const lastCb = checkboxes[checkboxes.length - 1];
                    if (!lastCb.checked) lastCb.click();
                }
                filled++;
                return;
            }

            const textarea = group.querySelector('textarea');
            if (textarea && !textarea.value.trim()) {
                textarea.value = CONFIG.comment;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
                filled++;
            }
        });

        return { filled, totalScore };
    }

    /* ── 确认弹窗 ───────────────────────────────────────── */

    function showConfirmModal({ teacher, course, filled, totalScore, index, total }) {
        return new Promise(resolve => {
            const old = document.getElementById('ae-confirm-overlay');
            if (old) old.remove();

            const overlay = document.createElement('div');
            overlay.id = 'ae-confirm-overlay';
            overlay.innerHTML = `
                <style>
                    #ae-confirm-overlay {
                        position: fixed; inset: 0; z-index: 2147483647;
                        background: rgba(0,0,0,.55); display: flex;
                        align-items: center; justify-content: center;
                        font-family: system-ui, -apple-system, sans-serif;
                    }
                    #ae-confirm-overlay .ae-modal {
                        background: #fff; border-radius: 16px; padding: 28px 32px;
                        width: 400px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,.3);
                        color: #333;
                    }
                    #ae-confirm-overlay h3 { margin: 0 0 16px; font-size: 18px; }
                    #ae-confirm-overlay .ae-row {
                        display: flex; padding: 10px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px;
                    }
                    #ae-confirm-overlay .ae-lbl { color: #999; width: 70px; flex-shrink: 0; }
                    #ae-confirm-overlay .ae-val { color: #333; font-weight: 500; }
                    #ae-confirm-overlay .ae-score {
                        margin: 16px 0; padding: 14px; background: #f0fdf4;
                        border-radius: 10px; text-align: center; font-size: 15px;
                        color: #16a34a; font-weight: 700;
                    }
                    #ae-confirm-overlay .ae-btns { display: flex; gap: 10px; margin-top: 20px; }
                    #ae-confirm-overlay .ae-btns button {
                        flex: 1; padding: 13px; border: none; border-radius: 10px;
                        font-size: 15px; font-weight: 600; cursor: pointer; transition: all .15s;
                    }
                    #ae-confirm-overlay .ae-btns button:hover { transform: translateY(-1px); }
                    #ae-confirm-overlay .ae-btns .ae-yes { background: #000; color: #fff; }
                    #ae-confirm-overlay .ae-btns .ae-yes:hover { background: #222; }
                    #ae-confirm-overlay .ae-btns .ae-skip { background: #f3f4f6; color: #666; }
                    #ae-confirm-overlay .ae-btns .ae-stop { background: #fef2f2; color: #dc2626; }
                    #ae-confirm-overlay .ae-prog {
                        text-align: center; color: #999; font-size: 12px; margin-top: 14px;
                    }
                </style>
                <div class="ae-modal">
                    <h3>确认提交评教</h3>
                    <div class="ae-row"><span class="ae-lbl">教师</span><span class="ae-val">${teacher || '未知'}</span></div>
                    <div class="ae-row"><span class="ae-lbl">课程</span><span class="ae-val">${course || '未知'}</span></div>
                    <div class="ae-row"><span class="ae-lbl">已填</span><span class="ae-val">${filled} 道题目</span></div>
                    <div class="ae-score">预估总分：${totalScore} 分</div>
                    <div class="ae-btns">
                        <button class="ae-yes" id="ae-cfm-yes">确认提交</button>
                        <button class="ae-skip" id="ae-cfm-skip">跳过</button>
                        <button class="ae-stop" id="ae-cfm-stop">停止</button>
                    </div>
                    <div class="ae-prog">${index + 1} / ${total}</div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#ae-cfm-yes').onclick = () => { overlay.remove(); resolve('submit'); };
            overlay.querySelector('#ae-cfm-skip').onclick = () => { overlay.remove(); resolve('skip'); };
            overlay.querySelector('#ae-cfm-stop').onclick = () => { overlay.remove(); resolve('stop'); };
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
                #ae-panel {
                    position: fixed; bottom: 24px; right: 24px; z-index: 2147483646;
                    width: 320px; background: #fff; border-radius: 16px;
                    box-shadow: 0 12px 40px rgba(0,0,0,.2); font-family: system-ui, -apple-system, sans-serif;
                    overflow: hidden; border: 1px solid rgba(0,0,0,.06);
                }
                #ae-panel.minimized .ae-body { display: none; }
                #ae-panel .ae-header {
                    background: #000; color: #fff; padding: 16px 18px; cursor: pointer;
                    display: flex; justify-content: space-between; align-items: center;
                    user-select: none;
                }
                #ae-panel .ae-header h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: .3px; }
                #ae-panel .ae-header .ae-toggle { font-size: 12px; opacity: .6; transition: transform .2s; }
                #ae-panel.minimized .ae-header .ae-toggle { transform: rotate(180deg); }
                #ae-panel .ae-body { padding: 16px 18px; }
                #ae-panel .ae-stat { display: flex; gap: 8px; margin-bottom: 14px; }
                #ae-panel .ae-stat span {
                    flex: 1; text-align: center; padding: 10px 6px; border-radius: 10px;
                    font-size: 13px; background: #f7f7f8;
                }
                #ae-panel .ae-stat b { font-weight: 700; }
                #ae-panel .ae-stat .ae-s-done { background: #f0fdf4; color: #16a34a; }
                #ae-panel .ae-stat .ae-s-skip { background: #fefce8; color: #ca8a04; }
                #ae-panel .ae-btns { display: flex; gap: 8px; }
                #ae-panel .ae-btns button {
                    flex: 1; padding: 12px; border: none; border-radius: 10px;
                    font-size: 14px; font-weight: 600; cursor: pointer; transition: all .15s;
                }
                #ae-panel .ae-btns button:hover { transform: translateY(-1px); }
                #ae-panel .ae-btns .ae-start { background: #000; color: #fff; }
                #ae-panel .ae-btns .ae-start:hover { background: #222; }
                #ae-panel .ae-btns button:disabled { opacity: .35; cursor: not-allowed; transform: none; }
                #ae-panel .ae-tip { margin-top: 12px; font-size: 12px; color: #999; line-height: 1.6; }
            </style>
            <div class="ae-header">
                <h3>一键评教</h3>
                <span class="ae-toggle">▲</span>
            </div>
            <div class="ae-body">
                <div class="ae-stat">
                    <span>待评 <b id="ae-p-total">0</b></span>
                    <span class="ae-s-done">完成 <b id="ae-p-done">0</b></span>
                    <span class="ae-s-skip">跳过 <b id="ae-p-skip">0</b></span>
                </div>
                <div class="ae-btns">
                    <button class="ae-start" id="ae-start">开始批量评教</button>
                </div>
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
        const pending = findPendingLinks();
        panel.querySelector('#ae-p-total').textContent = pending.length;
        let doneNum = 0;
        $$('a').forEach(a => { if (a.textContent.trim() === '查看详情') doneNum++; });
        panel.querySelector('#ae-p-done').textContent = doneNum;
        const state = getBatch();
        if (state) panel.querySelector('#ae-p-skip').textContent = state.skip || 0;
    }

    /* ── 启动批量 ───────────────────────────────────────── */

    function startBatch() {
        const items = findPendingLinks();
        if (items.length === 0) {
            showToast('没有待评价的项目', 'warn');
            return;
        }
        setBatch({
            active: true, total: items.length, done: 0, skip: 0,
            currentTeacher: items[0].teacher, currentCourse: items[0].course,
        });
        showToast(`开始：共 ${items.length} 个待评价`, 'info', 2000);
        setTimeout(() => items[0].link.click(), 600);
    }

    /* ── 表单页处理 ─────────────────────────────────────── */

    async function processFormPage() {
        const state = getBatch();
        if (!state || !state.active) return;

        await sleep(1200);
        const info = extractFormInfo();
        const { filled, totalScore } = autoFillForm();

        const result = await showConfirmModal({
            teacher: info.teacher || state.currentTeacher,
            course: info.course || state.currentCourse,
            filled, totalScore,
            index: state.done + state.skip, total: state.total,
        });

        if (result === 'submit') {
            state.done++; setBatch(state);
            showToast('正在提交...', 'info', 1500);
            await sleep(600);
            if (typeof save === 'function') save(2);
            else { const btn = $('.botBtnBox .save'); if (btn) btn.click(); }
        } else if (result === 'skip') {
            state.skip++; setBatch(state);
            showToast('已跳过', 'warn');
            await sleep(400);
            goBackToList();
        } else {
            clearBatch();
            showToast('已停止', 'warn');
            goBackToList();
        }
    }

    function extractFormInfo() {
        let teacher = '', course = '';
        $$('.topBox p span').forEach(s => {
            const t = s.textContent.trim();
            if (t.startsWith('授课教师')) teacher = t.replace('授课教师：', '').trim();
            if (t.startsWith('课程名称')) course = t.replace('课程名称：', '').trim();
        });
        return { teacher, course };
    }

    function goBackToList() {
        if (typeof goBack === 'function') goBack();
        else window.location.href = '/pj/newesReception/hehaiRatedHome';
    }

    /* ── 列表页：继续下一项 ─────────────────────────────── */

    function continueOnListPage() {
        const state = getBatch();
        if (!state || !state.active) return;

        const pending = findPendingLinks();
        if (pending.length === 0) {
            const msg = `批量评教完成！完成 ${state.done} 个，跳过 ${state.skip} 个`;
            clearBatch();
            showToast(msg, 'success', 5000);
            updatePanelStats();
            return;
        }

        updatePanelStats();
        state.currentTeacher = pending[0].teacher;
        state.currentCourse = pending[0].course;
        setBatch(state);

        showToast(`(${state.done + state.skip + 1}/${state.total}) ${pending[0].teacher} - ${pending[0].course}`, 'info', 2000);
        setTimeout(() => pending[0].link.click(), 1200);
    }

    /* ── Init (带重试) ──────────────────────────────────── */

    async function init() {
        if (isFormPage()) {
            processFormPage();
            return;
        }

        for (let attempt = 0; attempt < 20; attempt++) {
            const pending = findPendingLinks();
            if (pending.length > 0) {
                createPanel();
                continueOnListPage();
                return;
            }

            const frames = findAllFrames();
            for (const fdoc of frames) {
                if (isFormPage(fdoc)) {
                    processFormPage();
                    return;
                }
                const fp = findPendingLinks(fdoc);
                if (fp.length > 0) {
                    createPanel();
                    continueOnListPage();
                    return;
                }
            }

            await sleep(500);
        }

        if (!document.getElementById('ae-panel')) {
            showToast('未检测到评教页面，请进入评教列表后刷新', 'warn', 4000);
        }
    }

    init();

})();
