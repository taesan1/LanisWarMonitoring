// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'collectMissingGuilds') {
        collectGuildsInBackgroundParallel(request.guilds, sender.tab.id)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

/**
 * 길드 정보 자동 수집 (병렬 처리 - 실시간 진행 상황 전달)
 */
async function collectGuildsInBackgroundParallel(guildNames, tabId) {
    console.log(`${guildNames.length}개 길드 병렬 수집 시작:`, guildNames);

    const batchSize = 3; // 동시에 3개씩 처리
    let completedCount = 0;
    const results = [];

    for (let i = 0; i < guildNames.length; i += batchSize) {
        const batch = guildNames.slice(i, i + batchSize);
        console.log(`배치 ${Math.floor(i/batchSize) + 1}: ${batch.join(', ')}`);

        // 배치 내 길드들을 병렬로 처리
        const batchResults = await Promise.all(batch.map(async (guildName) => {
            try {
                const tab = await chrome.tabs.create({
                    url: `https://lanis.me/guild/${encodeURIComponent(guildName)}`,
                    active: false
                });

                await new Promise(resolve => setTimeout(resolve, 5000));
                await chrome.tabs.remove(tab.id);

                completedCount++;
                console.log(`${guildName} 수집 완료 (${completedCount}/${guildNames.length})`);

                // 실시간으로 content script에 진행 상황 전달
                chrome.tabs.sendMessage(tabId, {
                    type: 'guildCollectProgress',
                    guildName: guildName,
                    current: completedCount,
                    total: guildNames.length,
                    success: true
                }).catch(() => {});

                return { guildName, success: true };
            } catch (error) {
                completedCount++;
                console.error(`${guildName} 수집 실패:`, error);

                chrome.tabs.sendMessage(tabId, {
                    type: 'guildCollectProgress',
                    guildName: guildName,
                    current: completedCount,
                    total: guildNames.length,
                    success: false,
                    error: error.message
                }).catch(() => {});

                return { guildName, success: false, error: error.message };
            }
        }));

        results.push(...batchResults);

        // 배치 간 1초 대기
        if (i + batchSize < guildNames.length) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.log('모든 길드 병렬 수집 완료');

    // 최종 결과 전달
    chrome.tabs.sendMessage(tabId, {
        type: 'guildCollectComplete',
        results: results
    }).catch(() => {});
}