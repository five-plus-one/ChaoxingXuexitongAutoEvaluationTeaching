// ==UserScript==
// @name         超星学习通一键评教
// @namespace    https://five-plus-one.github.io/ChaoxingXuexitongAutoEvaluationTeaching/
// @version      2.0.0
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

    /* ── Config ─────────────────────────────────────────── */

    const CONFIG = {
        comment: '老师授课认真负责，教学效果良好，课程安排合理，能及时解答学生疑问，非常满意。',
        positiveKeywords: ['无上述问题', '没有问题', '正常', '很好', '满意', '认真', '负责', '积极', '优秀'],
    };

    /* ── Utilities ──────────────────────────────────────── */

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

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

    /* ── Batch State (跨页面持久化) ──────────────────────── */

    function getBatch() {
        try { return JSON.parse(sessionStorage.getItem('ae_batch')); } catch { return null; }
    }
    function setBatch(state) { sessionStorage.setItem('ae_batch', JSON.stringify(state)); }
    function clearBatch() { sessionStorage.removeItem('ae_batch'); }

    /* ── 页面检测 ───────────────────────────────────────── */

    function isFormPage() { return !!$('#formId'); }

    function isListPage() {
        const rows = $$('table tbody tr');
        if (rows.length === 0) return false;
        for (const a of $$('a')) {
            if (a.textContent.trim() === '待评价' || a.textContent.trim() === '查看详情') return true;
        }
        return false;
    }

    /* ── 列表页：扫描待评价项 ────────────────────────────── */

    function findPendingLinks() {
        const items = [];
        $$('a').forEach(a => {
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

    /* ── 表单页：自动填答 ────────────────────────────────── */

    function autoFillForm() {
        let filled = 0;
        let totalScore = 0;

        $$('.testBox.groupTarget').forEach(group => {
            if (getComputedStyle(group).display === 'none') return;

            const radios = $$('input[type="radio"]', group);
            if (radios.length > 0) {
                if (!radios[0].checked) radios[0].click();
                totalScore += parseFloat(radios[0].getAttribute('score')) || 0;
                filled++;
                return;
            }

            const checkboxes = $$('input[type="checkbox"]', group);
            if (checkboxes.length > 0) {
                const title = group.querySelector('.target-title')?.getAttribute('value') || '';
                let clicked = false;
                if (title.includes('教材') || title.includes('选用') || title.includes('情况')) {
                    checkboxes.forEach(cb => {
                        const text = cb.closest('label')?.textContent || '';
                        if (CONFIG.positiveKeywords.some(kw => text.includes(kw)) && !cb.checked) {
                            cb.click();
                            clicked = true;
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

    /* ── 表单页：确认弹窗 ────────────────────────────────── */

    function showConfirmModal({ teacher, course, filled, totalScore, index, total }) {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.id = 'ae-confirm-overlay';
            overlay.innerHTML = `
                <style>
                    #ae-confirm-overlay {
                        position: fixed; inset: 0; z-index: 9999999;
                        background: rgba(0,0,0,.5); display: flex;
                        align-items: center; justify-content: center;
                        font-family: system-ui, -apple-system, sans-serif;
                    }
                    #ae-confirm-modal {
                        background: #fff; border-radius: 16px; padding: 28px 32px;
                        width: 400px; max-width: 90vw; box-shadow: 0 20px 60px rgba(0,0,0,.3);
                    }
                    #ae-confirm-modal h3 {
                        margin: 0 0 16px; font-size: 18px; color: #333;
                    }
                    #ae-confirm-modal .ae-info-row {
                        display: flex; padding: 8px 0; border-bottom: 1px solid #f0f0f0;
                        font-size: 14px;
                    }
                    #ae-confirm-modal .ae-info-label {
                        color: #999; width: 80px; flex-shrink: 0;
                    }
                    #ae-confirm-modal .ae-info-value {
                        color: #333; font-weight: 500;
                    }
                    #ae-confirm-modal .ae-score {
                        margin: 16px 0; padding: 12px; background: #f6ffed;
                        border-radius: 8px; text-align: center; font-size: 14px;
                        color: #52c41a; font-weight: 600;
                    }
                    #ae-confirm-modal .ae-btns {
                        display: flex; gap: 10px; margin-top: 20px;
                    }
                    #ae-confirm-modal .ae-btns button {
                        flex: 1; padding: 12px; border: none; border-radius: 8px;
                        font-size: 15px; font-weight: 600; cursor: pointer;
                        transition: opacity .2s;
                    }
                    #ae-confirm-modal .ae-btns button:hover { opacity: .85; }
                    #ae-confirm-modal .ae-btns .ae-yes { background: #667eea; color: #fff; }
                    #ae-confirm-modal .ae-btns .ae-skip { background: #f0f0f0; color: #666; }
                    #ae-confirm-modal .ae-btns .ae-stop { background: #ff4d4f; color: #fff; }
                    #ae-confirm-modal .ae-progress-text {
                        text-align: center; color: #999; font-size: 12px; margin-top: 12px;
                    }
                </style>
                <div id="ae-confirm-modal">
                    <h3>确认提交评教</h3>
                    <div class="ae-info-row">
                        <span class="ae-info-label">教师</span>
                        <span class="ae-info-value">${teacher || '未知'}</span>
                    </div>
                    <div class="ae-info-row">
                        <span class="ae-info-label">课程</span>
                        <span class="ae-info-value">${course || '未知'}</span>
                    </div>
                    <div class="ae-info-row">
                        <span class="ae-info-label">已填</span>
                        <span class="ae-info-value">${filled} 道题目</span>
                    </div>
                    <div class="ae-score">预估总分：${totalScore} 分</div>
                    <div class="ae-btns">
                        <button class="ae-yes" id="ae-cfm-yes">确认提交</button>
                        <button class="ae-skip" id="ae-cfm-skip">跳过此项</button>
                        <button class="ae-stop" id="ae-cfm-stop">停止批量</button>
                    </div>
                    <div class="ae-progress-text">${index + 1} / ${total}</div>
                </div>
            `;
            document.body.appendChild(overlay);

            overlay.querySelector('#ae-cfm-yes').onclick = () => { overlay.remove(); resolve('submit'); };
            overlay.querySelector('#ae-cfm-skip').onclick = () => { overlay.remove(); resolve('skip'); };
            overlay.querySelector('#ae-cfm-stop').onclick = () => { overlay.remove(); resolve('stop'); };
        });
    }

    /* ── 列表页：控制面板 ────────────────────────────────── */

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'ae-panel';
        panel.innerHTML = `
            <style>
                #ae-panel {
                    position: fixed; bottom: 20px; right: 20px; z-index: 999999;
                    width: 380px; background: #fff; border-radius: 12px;
                    box-shadow: 0 8px 32px rgba(0,0,0,.18); font-family: system-ui, -apple-system, sans-serif;
                    overflow: hidden;
                }
                #ae-panel.minimized .ae-body { display: none; }
                #ae-panel .ae-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: #fff; padding: 14px 16px; cursor: pointer;
                    display: flex; justify-content: space-between; align-items: center;
                    user-select: none;
                }
                #ae-panel .ae-header h3 { margin: 0; font-size: 15px; font-weight: 600; }
                #ae-panel .ae-body { padding: 14px 16px; }
                #ae-panel .ae-stat { display: flex; gap: 12px; margin-bottom: 12px; }
                #ae-panel .ae-stat span {
                    flex: 1; text-align: center; padding: 8px; border-radius: 8px; font-size: 13px;
                }
                #ae-panel .ae-stat .ae-s-total { background: #f0f0f0; }
                #ae-panel .ae-stat .ae-s-done { background: #f6ffed; color: #52c41a; }
                #ae-panel .ae-stat .ae-s-fail { background: #fff2f0; color: #ff4d4f; }
                #ae-panel .ae-btns { display: flex; gap: 8px; }
                #ae-panel .ae-btns button {
                    flex: 1; padding: 10px; border: none; border-radius: 8px;
                    font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .2s;
                }
                #ae-panel .ae-btns button:hover { opacity: .85; }
                #ae-panel .ae-btns .ae-start { background: #667eea; color: #fff; }
                #ae-panel .ae-btns button:disabled { opacity: .4; cursor: not-allowed; }
                #ae-panel .ae-tip { margin-top: 10px; font-size: 12px; color: #999; line-height: 1.6; }
            </style>
            <div class="ae-header">
                <h3>一键评教</h3>
                <span>▼</span>
            </div>
            <div class="ae-body">
                <div class="ae-stat">
                    <span class="ae-s-total">待评: <b id="ae-p-total">0</b></span>
                    <span class="ae-s-done">完成: <b id="ae-p-done">0</b></span>
                    <span class="ae-s-fail">跳过: <b id="ae-p-skip">0</b></span>
                </div>
                <div class="ae-btns">
                    <button class="ae-start" id="ae-start">开始批量评教</button>
                </div>
                <div class="ae-tip">
                    点击开始后，脚本会逐个打开评教表单，自动填答后弹窗确认，你确认后才会提交。
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('.ae-header').onclick = () => panel.classList.toggle('minimized');
        panel.querySelector('#ae-start').onclick = startBatch;

        const pending = findPendingLinks();
        panel.querySelector('#ae-p-total').textContent = pending.length;

        const doneCount = $$('a').length - [...$$('a')].filter(a => a.textContent.trim() === '待评价').length;
        let doneNum = 0;
        $$('a').forEach(a => { if (a.textContent.trim() === '查看详情') doneNum++; });
        panel.querySelector('#ae-p-done').textContent = doneNum;
    }

    /* ── 列表页：启动批量 ────────────────────────────────── */

    function startBatch() {
        const items = findPendingLinks();
        if (items.length === 0) {
            showToast('没有待评价的项目', 'warn');
            return;
        }

        const state = {
            active: true,
            total: items.length,
            done: 0,
            skip: 0,
            currentTeacher: items[0].teacher,
            currentCourse: items[0].course,
        };
        setBatch(state);

        showToast(`开始批量评教：共 ${items.length} 个，即将打开第一个`, 'info', 2000);

        setTimeout(() => {
            items[0].link.click();
        }, 500);
    }

    /* ── 表单页：处理逻辑 ────────────────────────────────── */

    async function processFormPage() {
        const state = getBatch();
        if (!state || !state.active) return;

        await sleep(1000);

        const info = extractFormInfo();
        const { filled, totalScore } = autoFillForm();

        const result = await showConfirmModal({
            teacher: info.teacher || state.currentTeacher,
            course: info.course || state.currentCourse,
            filled,
            totalScore,
            index: state.done + state.skip,
            total: state.total,
        });

        if (result === 'submit') {
            showToast('正在提交...', 'info', 2000);
            state.done++;
            setBatch(state);

            await sleep(500);
            if (typeof save === 'function') {
                save(2);
            } else {
                const btn = $('.botBtnBox .save');
                if (btn) btn.click();
            }
        } else if (result === 'skip') {
            state.skip++;
            setBatch(state);
            showToast('已跳过，返回列表', 'warn');
            await sleep(500);
            goBackToList();
        } else if (result === 'stop') {
            clearBatch();
            showToast('已停止批量评教', 'warn');
            goBackToList();
        }
    }

    function extractFormInfo() {
        const spans = $$('.topBox p span');
        let teacher = '', course = '';
        spans.forEach(s => {
            const text = s.textContent.trim();
            if (text.startsWith('授课教师')) teacher = text.replace('授课教师：', '').trim();
            if (text.startsWith('课程名称')) course = text.replace('课程名称：', '').trim();
        });
        return { teacher, course };
    }

    function goBackToList() {
        if (typeof goBack === 'function') {
            goBack();
        } else {
            window.location.href = '/pj/newesReception/hehaiRatedHome';
        }
    }

    /* ── 列表页：继续下一项 ──────────────────────────────── */

    function continueOnListPage() {
        const state = getBatch();
        if (!state || !state.active) return;

        const pending = findPendingLinks();
        if (pending.length === 0) {
            const msg = `批量评教完成！完成 ${state.done} 个，跳过 ${state.skip} 个`;
            clearBatch();
            showToast(msg, 'success', 5000);
            return;
        }

        const panel = $('#ae-panel');
        if (panel) {
            panel.querySelector('#ae-p-total').textContent = pending.length;
            panel.querySelector('#ae-p-done').textContent = state.done;
            panel.querySelector('#ae-p-skip').textContent = state.skip;
        }

        state.currentTeacher = pending[0].teacher;
        state.currentCourse = pending[0].course;
        setBatch(state);

        showToast(`(${state.done + state.skip + 1}/${state.total}) 即将打开: ${pending[0].teacher} - ${pending[0].course}`, 'info', 2000);

        setTimeout(() => {
            pending[0].link.click();
        }, 1000);
    }

    /* ── Init ───────────────────────────────────────────── */

    function init() {
        if (isFormPage()) {
            processFormPage();
        } else if (isListPage()) {
            createPanel();
            continueOnListPage();
        }
    }

    setTimeout(init, 1000);

})();
