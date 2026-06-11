// 超星学习通一键评教 - 书签脚本
// 使用方法：在评教表单页面的控制台中执行此脚本
// 或者创建一个书签，将以下代码粘贴到书签的URL中（加上 javascript: 前缀）

javascript:void(function(){
    'use strict';

    if (!document.getElementById('formId')) {
        alert('当前页面不是评教表单页面！');
        return;
    }

    const questions = document.querySelectorAll('.testBox.groupTarget');
    console.log(`发现 ${questions.length} 道题目`);

    questions.forEach((q, index) => {
        if (q.offsetParent === null) return; // 跳过隐藏题目

        const title = q.querySelector('.target-title')?.getAttribute('value') || `题目${index+1}`;

        // 单选题
        const radio = q.querySelector('input[type="radio"]');
        if (radio && !radio.checked) {
            radio.click();
            console.log(`✓ ${title.substring(0, 30)}... -> 选中第一个选项`);
            return;
        }

        // 多选题
        const checkboxes = q.querySelectorAll('input[type="checkbox"]');
        if (checkboxes.length > 0) {
            // 特殊处理教材题目
            if (title.includes('教材')) {
                checkboxes.forEach(cb => {
                    if (cb.closest('label')?.textContent?.includes('无上述问题') && !cb.checked) {
                        cb.click();
                        console.log(`✓ ${title.substring(0, 30)}... -> 无上述问题`);
                    }
                });
            } else {
                checkboxes.forEach(cb => {
                    if (!cb.checked) cb.click();
                });
                console.log(`✓ ${title.substring(0, 30)}... -> 全选`);
            }
            return;
        }

        // 文本题
        const textarea = q.querySelector('textarea');
        if (textarea && !textarea.value.trim()) {
            textarea.value = '老师讲课认真负责，教学效果很好，感谢老师的辛勤付出！';
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            console.log(`✓ ${title.substring(0, 30)}... -> 已填写评语`);
        }
    });

    console.log('=============================');
    console.log('所有题目已填写完成！');
    console.log('检查无误后执行: save(2) 提交');
    console.log('=============================');
})();
