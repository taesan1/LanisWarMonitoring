/**
 * =====================================================
 * 라니스 전쟁 현황 트래커 (Lanis War Status Tracker)
 * =====================================================
 * 【참고 및 도움 주신분】
 *  도히님 - https://github.com/dohits/lanis_helper?tab=readme-ov-file
 *
 * 【주요 기능】
 * 1. 전쟁 로그 실시간 수집 및 분석
 * 2. 길드별 공격권/수비권 추적
 * 3. 마을별 점령 현황 추적
 * 4. 전쟁 통계 생성 (최다 공격자, 최다 방어자 등)
 * 5. 로컬스토리지 자동 저장/불러오기 (날짜 기반)
 * 6. 누락된 길드 자동 감지 및 수집
 *
 * @version 1.3
 * @author WIFM
 * @license MIT
 */

(function() {
    'use strict';

    // =====================================================
    // 전역 변수 선언
    // =====================================================

    let updateInterval = null;
    let logMessages = [];
    const guildLogs = {};
    const villageLogs = {};
    const villageOwnership = {};

    function getInitialPopupPosition() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 모바일/태블릿 감지
        const isMobile = viewportWidth <= 768;
        const isTablet = viewportWidth > 768 && viewportWidth <= 1024;

        let width, height;

        if (isMobile) {
            // 모바일: 거의 전체 화면 사용
            width = Math.min(viewportWidth - 20, 500); // 좌우 10px 여백
            height = viewportHeight - 20; // 상하 10px 여백
        } else if (isTablet) {
            // 태블릿: 90% 사용
            width = Math.min(viewportWidth * 0.9, 900);
            height = viewportHeight * 0.9;
        } else {
            // 데스크톱: 기존 로직
            width = Math.min(Math.max(viewportWidth * 0.85, 800), 1400);
            height = Math.max(viewportHeight * 0.92, 600);
        }

        // 중앙 정렬
        const left = (viewportWidth - width) / 2;
        const top = (viewportHeight - height) / 2;

        return {
            top: `${Math.max(10, top)}px`,
            left: `${Math.max(10, left)}px`,
            right: null,
            transform: 'none',
            width: `${width}px`,
            height: `${height}px`,
            isMobile: isMobile,
            isTablet: isTablet
        };
    }

    let popupPosition = getInitialPopupPosition();

    let isMinimized = false;
    let currentView = 'guild';
    let selectedGuild = null;
    let selectedVillage = null;
    let isWarPage = false;
    let isCollecting = false;
    let isPopupOpen = false;
    let totalNeed=[];
    const STORAGE_KEY = 'lanis_war_logs1';

    // =====================================================
    // 페이지 감지 및 초기화
    // =====================================================

    function checkWarPage() {
        const newIsWarPage = window.location.href.includes('lanis.me/war');

        if (newIsWarPage && !isWarPage) {
            isWarPage = true;
            setTimeout(() => {
                createFloatingButton();
            }, 1000);
        } else if (!newIsWarPage && isWarPage) {
            isWarPage = false;
            removeFloatingButton();

            const popup = document.getElementById('war-status-popup');
            if (popup) {
                popup.remove();
            }

            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
        }
    }

    // =====================================================
    // 플로팅 버튼 관리
    // =====================================================

    function createFloatingButton() {
        if (document.getElementById('war-tracker-btn')) return;

        const btn = document.createElement('div');
        btn.id = 'war-tracker-btn';
        btn.style.cssText = `
            position: fixed;
            right: 20px;
            top: 50%;
            transform: translateY(-50%);
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            cursor: pointer;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s;
        `;
        btn.innerHTML = '⚔️';
        btn.title = '전쟁 현황 보기';

        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-50%) scale(1.1)';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(-50%) scale(1)';
        });

        btn.addEventListener('click', () => {
            if (!isPopupOpen) {
                isPopupOpen = true;
                btn.style.display = 'none';
                isCollecting = false;

                popupPosition = getInitialPopupPosition();

                const savedLogs = loadStoredLogs();
                if (savedLogs.length > 0) {
                    addLog(`저장된 로그 ${savedLogs.length}개 로드`, 'info');
                    processAndDisplayLogs(savedLogs);
                } else {
                    const guildData = loadGuildData();
                    const guildStatus = guildData ? analyzeWarStatus(guildData, []) : {};
                    const villageStatus = {};
                    createStatusPopup(guildStatus, villageStatus);
                }
            }
        });

        document.body.appendChild(btn);
    }

    function removeFloatingButton() {
        const btn = document.getElementById('war-tracker-btn');
        if (btn) {
            btn.remove();
        }
    }

    // =====================================================
    // 로컬스토리지 관리
    // =====================================================

    function getCurrentDate() {
        const now = new Date();
        const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        return `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, '0')}-${String(koreaTime.getDate()).padStart(2, '0')}`;
    }

    function getCurrentDayOfWeek() {
        const now = new Date();
        const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        return days[koreaTime.getDay()];
    }

    function loadStoredLogs() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const data = JSON.parse(stored);

                // data가 유효한 객체인지 확인
                if (!data || typeof data !== 'object') {
                    addLog('저장된 로그 형식이 올바르지 않습니다', 'error');
                    localStorage.removeItem(STORAGE_KEY);
                    return [];
                }

                const currentDate = getCurrentDate();

                // date 속성이 없으면 구 버전 데이터로 간주하고 삭제
                if (!data.date) {
                    addLog('구 버전 로그 데이터 삭제됨', 'info');
                    localStorage.removeItem(STORAGE_KEY);
                    return [];
                }

                // 날짜가 다르면 삭제
                if (data.date !== currentDate) {
                    const dayOfWeek = data.dayOfWeek || '';
                    addLog(`이전 날짜(${data.date} ${dayOfWeek}) 로그 삭제됨`, 'info');
                    localStorage.removeItem(STORAGE_KEY);
                    return [];
                }

                return data.logs || [];
            } catch (e) {
                addLog('저장된 로그 불러오기 실패: ' + e.message, 'error');
                // 오류 발생 시 손상된 데이터 삭제
                localStorage.removeItem(STORAGE_KEY);
                return [];
            }
        }
        return [];
    }

    function saveStoredLogs(logs) {
        const currentDate = getCurrentDate();
        const currentDayOfWeek = getCurrentDayOfWeek();

        try {
            const data = {
                date: currentDate,
                dayOfWeek: currentDayOfWeek,
                logs: logs
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            addLog(`${logs.length}개 로그 저장 완료 (${currentDate} ${currentDayOfWeek})`, 'success');
        } catch (e) {
            addLog('로그 저장 실패: ' + e.message, 'error');
        }
    }

    // =====================================================
    // 길드 수집 관련 함수
    // =====================================================
    /**
     * 로그에서 발견된 길드 목록 추출
     */
    function extractGuildsFromLogs(logs) {
        const guildSet = new Set();

        logs.forEach(log => {
            if (log.guildName && log.guildName !== '길드 X') {
                guildSet.add(log.guildName);
            }
            if (log.defenderGuild && log.defenderGuild !== '길드 X') {
                guildSet.add(log.defenderGuild);
            }
        });

        return Array.from(guildSet);
    }
    /**
     * 누락된 길드 찾기
     */
    function findMissingGuilds(logsGuilds) {
        const storedData = localStorage.getItem('lanis_guild_info1');
        if (!storedData) {
            return logsGuilds;
        }

        try {
            const guildInfo = JSON.parse(storedData);
            const storedGuilds = Object.keys(guildInfo);

            return logsGuilds.filter(guild => !storedGuilds.includes(guild));
        } catch (e) {
            return logsGuilds;
        }
    }
    /**
     * iframe에 길드 페이지 로드 및 데이터 수집
     */
    function loadGuildInIframe(iframe, guildName) {
        return new Promise((resolve) => {
            console.log(`loadGuildInIframe 시작: ${guildName}`);

            // 🔸 무소속은 iframe 수집 대상 제외
            if (!guildName || guildName.trim() === "무소속") {
                console.log("무소속은 수집하지 않습니다.");
                resolve(false);
                return;
            }

            // 🔸 15초 타임아웃
            const timeout = setTimeout(() => {
                console.warn(`⏰ 타임아웃: ${guildName}`);
                cleanup();
                resolve(false);
            }, 15000);

            // 🔸 iframe 로드 핸들러
            const onLoad = async () => {
                console.log(`iframe 로드 완료: ${guildName}, DOM 렌더링 대기 중...`);
                cleanup();

                try {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    if (!iframeDoc) {
                        console.log("iframe document 접근 불가");
                        resolve(false);
                        return;
                    }

                    // 🔸 약간의 렌더링 대기
                    await delay(1000);

                    // 🔸 "길드를 찾을 수 없습니다" 감지
                    const errorAlert = iframeDoc.querySelector(
                        "#root > div:nth-child(2) > div:nth-child(1) > div > div.MuiBox-root.css-zwlyuw > div > div.MuiPaper-root.MuiPaper-elevation.MuiPaper-rounded.MuiPaper-elevation0.MuiAlert-root.MuiAlert-colorError.MuiAlert-standardError.MuiAlert-standard.css-ikh64q > div.MuiAlert-message.css-127h8j3"
                    );
                    if (errorAlert && errorAlert.textContent.includes("길드를 찾을 수 없습니다")) {
                        console.warn(`⚠️ ${guildName} 길드를 찾을 수 없습니다. 제거합니다.`);
                        removeGuildFromStorage(guildName);
                        resolve(false);
                        return;
                    }

                    // 🔸 React 렌더링 완료 대기 (길드원 테이블)
                    const hasTable = await waitForElement(
                        iframeDoc,
                        "tbody.MuiTableBody-root tr.MuiTableRow-root",
                        10000
                    );

                    if (!hasTable) {
                        console.log("길드원 테이블을 찾을 수 없음:", guildName);
                        resolve(false);
                        return;
                    }

                    console.log("DOM 렌더링 완료, 수집 시작:", guildName);
                    await delay(500);

                    const success = collectGuildFromDocument(iframeDoc, guildName);
                    console.log(`✅ 수집 결과: ${guildName} = ${success}`);
                    resolve(success);

                } catch (error) {
                    console.error(`❌ ${guildName} 수집 중 오류:`, error);
                    resolve(false);
                }
            };

            // 🔸 iframe 로드 실패 핸들러
            const onError = () => {
                console.error(`iframe 로드 실패: ${guildName}`);
                cleanup();
                resolve(false);
            };

            // 🔸 공통 정리 함수
            const cleanup = () => {
                clearTimeout(timeout);
                iframe.removeEventListener("load", onLoad);
                iframe.removeEventListener("error", onError);
            };

            // 🔸 헬퍼 함수들
            const delay = (ms) => new Promise((r) => setTimeout(r, ms));

            const waitForElement = async (doc, selector, maxWait = 10000) => {
                const start = Date.now();
                while (Date.now() - start < maxWait) {
                    const el = doc.querySelector(selector);
                    if (el) return true;
                    await delay(200);
                }
                return false;
            };

            // 🔸 이벤트 등록 및 iframe 로드 시작
            iframe.addEventListener("load", onLoad);
            iframe.addEventListener("error", onError);

            const url = `https://lanis.me/guild/${encodeURIComponent(guildName)}`;
            console.log(`iframe src 설정: ${url}`);
            iframe.src = url;
        });
    }
    /**
     * 문서에서 길드 정보 수집
     */
    function collectGuildFromDocument(doc, expectedGuildName) {
        try {
            console.log("collectGuildFromDocument 시작");

            // 🔸 1. 길드 이름
            const guildNameElement = doc.querySelector("h5.MuiTypography-root.MuiTypography-h5");
            const guildName = guildNameElement
                ? guildNameElement.textContent.trim()
                : expectedGuildName;
            console.log("길드명:", guildName);

            if (!guildName || guildName === "무소속") {
                console.log("무소속은 수집 대상이 아닙니다.");
                return false;
            }

            // 🔸 2. 기본 정보 섹션
            const guildInfoSection = doc.querySelector("div.MuiBox-root.css-16cle9o");
            if (!guildInfoSection) {
                console.warn("⚠️ 길드 정보 섹션을 찾을 수 없습니다.");
                return false;
            }

            // 🔸 3. 기본 정보 추출
            const infoParagraphs = guildInfoSection.querySelectorAll(
                "p.MuiTypography-root.MuiTypography-body2"
            );
            let guildMaster = "";
            let guildLevel = "";
            let memberCount = "";

            infoParagraphs.forEach((p) => {
                const text = p.textContent.trim();
                const goldText = p.querySelector('span[style*="color: rgb(255, 215, 0)"]');
                if (text.includes("길드장")) guildMaster = goldText?.textContent.trim() || "";
                else if (text.includes("길드 레벨")) guildLevel = goldText?.textContent.trim() || "";
                else if (text.includes("길드원 수")) memberCount = goldText?.textContent.trim() || "";
            });

            console.log("기본정보:", { guildMaster, guildLevel, memberCount });

            // 🔸 4. 설명
            const descriptionElement = doc.querySelector(
                "div.MuiBox-root.css-7u2oev p.MuiTypography-root.MuiTypography-body1"
            );
            const description = descriptionElement ? descriptionElement.textContent.trim() : "";

            // 🔸 5. 길드원 테이블
            const memberRows = doc.querySelectorAll("tbody.MuiTableBody-root tr.MuiTableRow-root");
            console.log("길드원 행 개수:", memberRows.length);

            const members = [];

            memberRows.forEach((row) => {
                const cells = row.querySelectorAll("td.MuiTableCell-root");
                if (cells.length >= 3) {
                    const nicknameElement = cells[0].querySelector("span.MuiTypography-root");
                    const reputationElement = cells[1];
                    const positionElement = cells[2].querySelector("p.MuiTypography-root");

                    const nickname = nicknameElement ? nicknameElement.textContent.trim() : "";
                    const reputation = reputationElement
                        ? parseInt(reputationElement.textContent.trim().replace(/,/g, "")) || 0
                        : 0;
                    const position = positionElement ? positionElement.textContent.trim() : "";

                    if (nickname) {
                        members.push({ nickname, reputation, position });
                    }
                }
            });

            if (members.length === 0) {
                console.log("⚠️ 길드원 데이터가 없습니다. 수집 실패");
                return false;
            }

            // 🔸 6. 기존 데이터와 병합 / 갱신
            const storageKey = "lanis_guild_info1";
            const storageData = JSON.parse(localStorage.getItem(storageKey) || "{}");

            const oldData = storageData[guildName];
            const guildInfo = {
                guildName,
                guildMaster,
                guildLevel: parseInt(guildLevel) || 0,
                memberCount,
                description,
                members,
                collectedAt: new Date().toISOString(),
                url: `https://lanis.me/guild/${encodeURIComponent(guildName)}`,
            };

            // 🔹 기존 데이터가 있다면 diff 검사 (갱신된 멤버만 교체)
            if (oldData) {
                const diffMembers = members.filter(
                    (m) => !oldData.members?.some((old) => old.nickname === m.nickname)
                );
                if (diffMembers.length > 0) {
                    console.log(`📈 신규 길드원 ${diffMembers.length}명 추가:`, diffMembers);
                }
            }

            storageData[guildName] = guildInfo;
            localStorage.setItem(storageKey, JSON.stringify(storageData));

            console.log(`✅ ${guildName} 저장 완료 (${members.length}명)`);
            return true;
        } catch (error) {
            console.error("길드 정보 수집 오류:", error);
            return false;
        }
    }
    /**
     * 로컬스토리지에서 특정 길드 삭제
     */
    function removeGuildFromStorage(guildName) {
        try {
            const storageKey = 'lanis_guild_info1';
            const storedData = localStorage.getItem(storageKey);

            if (!storedData) return;

            const guildInfo = JSON.parse(storedData);

            if (guildInfo[guildName]) {
                delete guildInfo[guildName];
                localStorage.setItem(storageKey, JSON.stringify(guildInfo));
                console.log(`길드 삭제됨: ${guildName}`);
                addLog(`⚠️ ${guildName} 길드를 찾을 수 없어 저장소에서 삭제했습니다`, 'error');
            }
        } catch (e) {
            console.error('길드 삭제 실패:', e);
        }
    }
    function findOldGuildData(days = 7) {
        const data = loadStoredGuilds();
        const now = new Date();
        const threshold = days * 24 * 60 * 60 * 1000;

        return Object.keys(data).filter((g) => {
            const info = data[g];
            if (!info?.collectedAt) return false;
            const diff = now - new Date(info.collectedAt);
            return diff > threshold;
        });
    }

    function loadStoredGuilds() {
        try {
            const storageKey = "lanis_guild_info1";
            const raw = localStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("길드 데이터 불러오기 오류:", e);
            return {};
        }
    }

    /**
     * 특정 길드 리스트를 iframe으로 수집
     */
    async function collectSpecificGuildsWithIframe(guildList) {
        if (guildList.length === 0) return;

        addLog(`${guildList.length}개 길드 수집 시작: ${guildList.join(', ')}`, 'info');
        addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

        const startTime = Date.now();
        let successCount = 0;
        let failCount = 0;
        let notFoundCount = 0;

        // iframe 생성 (디버깅용)
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `
        position: fixed;
        top: 50px;
        right: 50px;
        width: 400px;
        height: 600px;
        border: 3px solid red;
        z-index: 99999;
        background: white;   
        opacity: 0;
    `;
//
        document.body.appendChild(iframe);
        addLog('iframe 생성 완료', 'info');

        for (let i = 0; i < guildList.length; i++) {
            const guildName = guildList[i];
            const current = i + 1;
            const percentage = Math.round((current / guildList.length) * 100);

            try {
                addLog(`[${current}/${guildList.length}] ${guildName} 수집 중... (${percentage}%)`, 'info');

                const success = await loadGuildInIframe(iframe, guildName);

                if (success) {
                    successCount++;
                    addLog(`[${current}/${guildList.length}] ${guildName} 수집 완료 (${percentage}%)`, 'success');
                } else {
                    // 로그에서 길드 삭제 메시지가 있는지 확인
                    const wasDeleted = logMessages.some(log =>
                        log.message.includes(`${guildName} 길드를 찾을 수 없어`)
                    );

                    if (wasDeleted) {
                        notFoundCount++;
                    } else {
                        failCount++;
                        addLog(`[${current}/${guildList.length}] ${guildName} 수집 실패 (${percentage}%)`, 'error');
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                failCount++;
                addLog(`[${current}/${guildList.length}] ${guildName} 오류: ${error.message}`, 'error');
            }
        }

        iframe.remove();

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'success');

        let resultMsg = `✓ 수집 완료: 성공 ${successCount}개`;
        if (notFoundCount > 0) resultMsg += `, 존재하지 않음 ${notFoundCount}개`;
        if (failCount > 0) resultMsg += `, 실패 ${failCount}개`;
        resultMsg += ` (${elapsed}초)`;

        addLog(resultMsg, 'success');

        // UI 새로고침
        setTimeout(() => {
            const savedLogs = loadStoredLogs();
            processAndDisplayLogs(savedLogs);
            addLog('길드별 보기 렌더링 최신화 완료', 'success');
        }, 1000);
    }
    /**
     * 길드 수집 버튼 상태 업데이트
     */
    function updateGuildCollectButton(totalNeed = []) {
        const autoCollectMissingBtn = document.getElementById('auto-collect-missing-btn');
        if (!autoCollectMissingBtn) return;

        // 페이지에서 현재 전쟁 참여 길드 추출
        const warGuilds = extractWarGuildsFromPage();
        if (warGuilds.length === 0) {
            addLog('수집할 길드가 없습니다. 전쟁 페이지를 확인해주세요.', 'error');
            return;
        }
        const guildData = loadGuildData();

        const missingGuilds = findMissingGuilds(warGuilds);
        const oldGuilds = findOldGuildData(7);
        totalNeed.push(...missingGuilds);
        totalNeed.push(...oldGuilds);
        totalNeed = [...new Set(totalNeed)];

        if (totalNeed.length === 0 && guildData && oldGuilds.length === 0 && missingGuilds.length === 0) {
            autoCollectMissingBtn.disabled = true;
            autoCollectMissingBtn.textContent = '✅ 모든 길드 수집됨';
            autoCollectMissingBtn.style.background = '#666';
            return;
        }

        // 버튼 상태 결정
        if (totalNeed.length > 0) {
            autoCollectMissingBtn.style.background = "#c0392b";
            autoCollectMissingBtn.style.borderColor = "#e74c3c";
            autoCollectMissingBtn.textContent = `🚨 ${totalNeed.length}개 길드 수집 필요`;
            autoCollectMissingBtn.disabled = false;
            autoCollectMissingBtn.onclick = () => {
                addLog(`📦 ${totalNeed.length}개 길드 수집 시작`, "info");
                collectSpecificGuildsWithIframe(totalNeed);
            };
        } else {
            addLog('모든 전쟁 참여 길드 정보가 이미 수집되어 있습니다', 'success');
            autoCollectMissingBtn.disabled = true;
            autoCollectMissingBtn.textContent = '✅ 모든 길드 수집됨';
            autoCollectMissingBtn.style.background = '#666';
        }

        // 로그 표시
        addLog(`📦 ${totalNeed.length}개 길드 수집 상태 갱신`, "info");
    }

    /**
     * 전쟁 페이지 테이블에서 참여 길드 목록 추출
     */
    function extractWarGuildsFromPage() {
        const guildSet = new Set();

        try {
            // 🔸 전쟁 참여 길드 테이블 컨테이너
            const warTable = document.querySelector(
                "#root > div:nth-child(2) > div:nth-child(1) > div > div.MuiBox-root.css-zwlyuw > div.MuiPaper-root.MuiPaper-elevation.MuiPaper-rounded.MuiPaper-elevation0.css-kapcme > div > div.war-interactive-area.MuiBox-root.css-0 > div.MuiBox-root.css-yuipcy"
            );

            if (warTable) {
                // 🔹 대표적인 길드명 위치 (MuiChip, Typography 등)
                const guildElements = warTable.querySelectorAll(
                    ".MuiChip-label, .MuiTypography-root, .MuiBox-root"
                );

                guildElements.forEach((el) => {
                    const text = el.textContent.trim();
                    // 숫자만 또는 너무 짧거나 긴 텍스트는 제외
                    if (text && text.length >= 2 && text.length <= 20 && !/^\d+$/.test(text)) {
                        guildSet.add(text);
                    }
                });
            }

            // 🔸 보조 탐색 (행 단위로 검사)
            if (guildSet.size === 0 && warTable) {
                const rows = warTable.querySelectorAll("tr, .MuiTableRow-root");
                rows.forEach((row) => {
                    const cells = row.querySelectorAll("td, .MuiTableCell-root, .MuiTypography-root");
                    cells.forEach((cell) => {
                        const text = cell.textContent.trim();
                        if (text && text.length >= 2 && text.length <= 20 && !/^\d+$/.test(text)) {
                            guildSet.add(text);
                        }
                    });
                });
            }
        } catch (error) {
            console.error("길드 목록 추출 중 오류:", error);
        }

        // 🔸 결과 정리
        const guilds = Array.from(guildSet)
            .filter((g) => g && g !== "무소속" && !g.includes("VS"))
            .map((g) => g.trim());

        if (guilds.length > 0) {
        } else {
            addLog("⚠️ 전쟁 페이지에서 길드 목록을 찾을 수 없습니다.", "warn");
        }

        return guilds;
    }
    /**
     * 전쟁 참여 길드 자동 수집
     */
    async function collectWarGuildsWithIframe() {
        // 전쟁 페이지에서 길드 목록 추출
        const warGuilds = extractWarGuildsFromPage();

        if (warGuilds.length === 0) {
            addLog('수집할 길드가 없습니다. 전쟁 페이지를 확인해주세요.', 'error');
            return;
        }

        // 이미 수집된 길드 필터링
        const missingGuilds = findMissingGuilds(warGuilds);

        if (missingGuilds.length === 0) {
            addLog('모든 전쟁 참여 길드 정보가 이미 수집되어 있습니다', 'success');

            // 버튼 상태 업데이트
            const autoCollectMissingBtn = document.getElementById('auto-collect-missing-btn');
            if (autoCollectMissingBtn) {
                autoCollectMissingBtn.disabled = true;
                autoCollectMissingBtn.textContent = '✅ 모든 길드 수집됨';
                autoCollectMissingBtn.style.background = '#666';
            }
            return;
        }

        addLog(`${missingGuilds.length}개 길드 수집 필요: ${missingGuilds.join(', ')}`, 'info');
        addLog('iframe을 이용한 빠른 수집을 시작합니다...', 'info');
        addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');

        const startTime = Date.now();
        let successCount = 0;
        let failCount = 0;

// iframe 생성 (디버깅용 - 화면에 보이게)
        const iframe = document.createElement('iframe');
        iframe.style.cssText = `
    position: fixed;
    top: 50px;
    right: 50px;
    width: 400px;
    height: 600px;
    border: 3px solid red;
    z-index: 99999;
    background: white;
`;
        document.body.appendChild(iframe);

        addLog('🔍 iframe 생성 완료 (화면 우측 상단에 표시)', 'info');

        for (let i = 0; i < missingGuilds.length; i++) {
            const guildName = missingGuilds[i];
            const current = i + 1;
            const percentage = Math.round((current / missingGuilds.length) * 100);

            try {
                addLog(`[${current}/${missingGuilds.length}] ${guildName} 수집 중... (${percentage}%)`, 'info');

                // iframe으로 페이지 로드
                const success = await loadGuildInIframe(iframe, guildName);

                if (success) {
                    successCount++;
                    addLog(`[${current}/${missingGuilds.length}] ${guildName} 수집 완료 (${percentage}%)`, 'success');
                } else {
                    failCount++;
                    addLog(`[${current}/${missingGuilds.length}] ${guildName} 수집 실패 (${percentage}%)`, 'error');
                }

                // 다음 길드로 넘어가기 전 짧은 대기
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                failCount++;
                addLog(`[${current}/${missingGuilds.length}] ${guildName} 오류: ${error.message} (${percentage}%)`, 'error');
            }
        }

        // iframe 제거
        iframe.remove();

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'success');
        addLog(`✓ 길드 수집 완료: 성공 ${successCount}개, 실패 ${failCount}개`, 'success');
        addLog(`총 소요 시간: ${elapsed}초`, 'info');

        if (failCount > 0) {
            addLog('⚠️ 일부 길드 수집에 실패했습니다. X-Frame-Options 차단일 수 있습니다.', 'error');
        }

        // 버튼 상태 업데이트
        const autoCollectMissingBtn = document.getElementById('auto-collect-missing-btn');
        if (autoCollectMissingBtn) {
            autoCollectMissingBtn.disabled = false;

            // 다시 체크
            const remainingMissing = findMissingGuilds(warGuilds);
            if (remainingMissing.length === 0) {
                autoCollectMissingBtn.textContent = '✅ 모든 길드 수집됨';
                autoCollectMissingBtn.style.background = '#666';
                autoCollectMissingBtn.disabled = true;
            } else {
                autoCollectMissingBtn.textContent = `🔄 길드 자동 수집 (${remainingMissing.length}개)`;
                autoCollectMissingBtn.style.background = '#ff9800';
            }
        }

        // UI 새로고침
        setTimeout(() => {
            const savedLogs = loadStoredLogs();
            processAndDisplayLogs(savedLogs);
            addLog('길드별 보기 렌더링 최신화 완료', 'success');
        }, 1000);
    }

    // =====================================================
    // 로그 처리 및 분석
    // =====================================================

    function mergeLogs(existingLogs, newLogs) {
        const logMap = new Map();

        existingLogs.forEach(log => {
            const key = `${log.date}_${log.guildName}_${log.memberName}_${log.target}_${log.isSuccess}`;
            logMap.set(key, log);
        });

        newLogs.forEach(log => {
            const key = `${log.date}_${log.guildName}_${log.memberName}_${log.target}_${log.isSuccess}`;
            logMap.set(key, log);
        });

        return Array.from(logMap.values()).sort((a, b) => {
            return b.date.localeCompare(a.date);
        });
    }

    function calculateVillageOwnership(logs) {
        const ownership = {};

        const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

        sortedLogs.forEach(log => {
            if (log.isFortress) return;

            if (log.isCaptureResult) {
                const prevOwner = ownership[log.village] ? ownership[log.village].guildName : null;

                ownership[log.village] = {
                    guildName: log.guildName && log.guildName !== '길드 X' ? log.guildName : '-',
                    date: log.date,
                    time: log.date.match(/(\d{2}:\d{2}:\d{2})/)?.[0] || '',
                    previousOwner: prevOwner && prevOwner !== '길드 X' ? prevOwner : '-'
                };
            }
            else if (!ownership[log.village] && log.defenderGuild) {
                ownership[log.village] = {
                    guildName: log.defenderGuild && log.defenderGuild !== '길드 X' ? log.defenderGuild : '-',
                    date: log.date,
                    time: log.date.match(/(\d{2}:\d{2}:\d{2})/)?.[0] || '',
                    previousOwner: log.defenderGuild && log.defenderGuild !== '길드 X' ? log.defenderGuild : '-'
                };
            }
        });

        return ownership;
    }

    function reconstructDetailedLogs(logs, guildData) {
        Object.keys(guildLogs).forEach(key => guildLogs[key] = []);
        Object.keys(villageLogs).forEach(key => villageLogs[key] = []);

        logs.forEach(log => {
            if (!log.isAttack) return;

            const timeMatch = log.date.match(/(\d{2}:\d{2}:\d{2})/);
            const time = timeMatch ? timeMatch[1] : '';

            const guildKey = log.guildName;
            if (!guildLogs[guildKey]) {
                guildLogs[guildKey] = [];
            }
            guildLogs[guildKey].push({
                time,
                memberName: log.memberName,
                target: log.target,
                isSuccess: log.isSuccess,
                village: log.village,
                isDefender: false
            });

            if (log.defenderName && !log.isFortress) {
                let defenderGuild = log.defenderGuild;

                if (!defenderGuild) {
                    for (const guildInfo of Object.values(guildData)) {
                        const isMember = guildInfo.members && guildInfo.members.some(m => m.nickname === log.defenderName);
                        if (isMember) {
                            defenderGuild = guildInfo.guildName;
                            break;
                        }
                    }
                }

                if (!defenderGuild) {
                    defenderGuild = '길드 X';
                    log.defenderGuild = '길드 X';
                }

                if (defenderGuild) {
                    if (!guildLogs[defenderGuild]) {
                        guildLogs[defenderGuild] = [];
                    }
                    guildLogs[defenderGuild].push({
                        time,
                        memberName: log.defenderName,
                        target: `${log.guildName} ${log.memberName}`,
                        isSuccess: !log.isSuccess,
                        village: log.village,
                        isDefender: true
                    });
                }
            }

            if (!villageLogs[log.village]) {
                villageLogs[log.village] = [];
            }
            villageLogs[log.village].push({
                time,
                guildName: log.guildName,
                memberName: log.memberName,
                target: log.target,
                isSuccess: log.isSuccess
            });
        });
    }

    function analyzeWarStatus(guilds, logs) {
        const guildStatus = {};

        for (const [guildName, members] of Object.entries(guilds)) {
            guildStatus[guildName] = {};
            members.forEach(member => {
                guildStatus[guildName][member.name] = {
                    attackRemaining: 8,
                    defenseRemaining: 4,
                    attackSuccess: 0,
                    attackFail: 0,
                    defenseSuccess: 0,
                    defenseFail: 0
                };
            });
        }

        if (!logs || logs.length === 0) {
            return guildStatus;
        }

        logs.forEach(log => {
            if (!log.isAttack) return;

            const attackerGuild = guildStatus[log.guildName];
            if (attackerGuild) {
                let attackerData = attackerGuild[log.memberName];

                if (!attackerData) {
                    attackerGuild[log.memberName] = {
                        attackRemaining: 8,
                        defenseRemaining: 4,
                        attackSuccess: 0,
                        attackFail: 0,
                        defenseSuccess: 0,
                        defenseFail: 0
                    };
                    attackerData = attackerGuild[log.memberName];
                }

                if (attackerData.attackRemaining > 0) {
                    attackerData.attackRemaining--;
                }

                if (log.isSuccess) {
                    attackerData.attackSuccess++;
                } else {
                    attackerData.attackFail++;
                }
            }

            if (log.defenderName && !log.isFortress) {
                let defenderGuild = log.defenderGuild;

                if (!defenderGuild) {
                    for (const [checkGuildName, members] of Object.entries(guildStatus)) {
                        if (members[log.defenderName]) {
                            defenderGuild = checkGuildName;
                            break;
                        }
                    }
                }

                if (defenderGuild && guildStatus[defenderGuild]) {
                    let defenderData = guildStatus[defenderGuild][log.defenderName];

                    if (!defenderData) {
                        guildStatus[defenderGuild][log.defenderName] = {
                            attackRemaining: 8,
                            defenseRemaining: 4,
                            attackSuccess: 0,
                            attackFail: 0,
                            defenseSuccess: 0,
                            defenseFail: 0
                        };
                        defenderData = guildStatus[defenderGuild][log.defenderName];
                    }

                    if (log.isSuccess) {
                        defenderData.defenseFail++;
                        if (defenderData.defenseRemaining > 0) {
                            defenderData.defenseRemaining--;
                        }
                    } else {
                        defenderData.defenseSuccess++;
                    }
                }
            }
        });

        return guildStatus;
    }

    function analyzeVillageStatus(logs) {
        const villageStatus = {};

        logs.forEach(log => {
            if (!villageStatus[log.village]) {
                villageStatus[log.village] = {
                    totalAttacks: 0,
                    successAttacks: 0,
                    failAttacks: 0,
                    guilds: {}
                };
            }

            const vStatus = villageStatus[log.village];
            vStatus.totalAttacks++;

            if (log.isSuccess) {
                vStatus.successAttacks++;
            } else {
                vStatus.failAttacks++;
            }

            if (!vStatus.guilds[log.guildName]) {
                vStatus.guilds[log.guildName] = { attacks: 0, success: 0, fail: 0 };
            }
            vStatus.guilds[log.guildName].attacks++;

            if (log.isSuccess) {
                vStatus.guilds[log.guildName].success++;
            } else {
                vStatus.guilds[log.guildName].fail++;
            }
        });

        return villageStatus;
    }

    // =====================================================
    // 로그 수집 및 파싱
    // =====================================================

    function loadGuildData() {
        const stored = localStorage.getItem('lanis_guild_info1');
        if (!stored) {
            addLog('길드 정보가 없습니다.', 'error');
            return null;
        }

        try {
            const data = JSON.parse(stored);
            if (!data || Object.keys(data).length === 0) {
                addLog('길드 데이터가 비어있습니다.', 'error');
                return null;
            }

            const guilds = {};
            let hasOldData = false;

            for (const [key, guildInfo] of Object.entries(data)) {
                const guildName = guildInfo.guildName;
                const members = guildInfo.members || [];

                // 수집 날짜 체크
                if (guildInfo.collectedAt) {
                    const collectedTime = new Date(guildInfo.collectedAt).getTime();
                    const weekInMs = 7 * 24 * 60 * 60 * 1000;

                    if (Date.now() - collectedTime > weekInMs) {
                        hasOldData = true;
                    }
                }

                guilds[guildName] = members.map(member => ({
                    name: member.nickname,
                    attackRemaining: 8,
                    defenseRemaining: 4,
                    attackSuccess: 0,
                    attackFail: 0,
                    defenseSuccess: 0,
                    defenseFail: 0
                }));

                if (!guildLogs[guildName]) {
                    guildLogs[guildName] = [];
                }
            }

            if (hasOldData) {
                addLog('일부 길드 데이터가 7일 이상 경과했습니다. 재수집을 권장합니다.', 'info');
            }

            return guilds;
        } catch (e) {
            addLog(`길드 데이터 파싱 오류: ${e.message}`, 'error');
            return null;
        }
    }

    function findWarLogTable() {
        const tables = document.querySelectorAll('.MuiBox-root.css-178yklu');
        for (const table of tables) {
            const tbody = table.querySelector('.MuiTableBody-root.css-y6j1my');
            const thead = table.querySelector('.MuiTableHead-root.css-s4zxv0');

            if (tbody && thead) {
                const rows = tbody.querySelectorAll('tr');
                if (rows.length > 0) {
                    addLog('전쟁 로그 테이블 찾기 성공 (새 구조)', 'success');
                    return tbody;
                }
            }
        }

        const newTableSelector = document.querySelector("#root > div:nth-child(2) > div:nth-child(1) > div > div.MuiBox-root.css-zwlyuw > div.MuiPaper-root.MuiPaper-elevation.MuiPaper-rounded.MuiPaper-elevation0.css-kapcme > div > div.MuiBox-root.css-178yklu > div.MuiPaper-root.MuiPaper-elevation.MuiPaper-rounded.MuiPaper-elevation0.MuiTableContainer-root.css-8te8e2");
        if (newTableSelector) {
            const tbody = newTableSelector.querySelector('.MuiTableBody-root');
            if (tbody) {
                addLog('전쟁 로그 테이블 찾기 성공 (선택자)', 'success');
                return tbody;
            }
        }

        const allBoxes = document.querySelectorAll('.MuiBox-root.css-1kw3y0a');
        for (const box of allBoxes) {
            if (box.textContent.includes('전쟁 로그')) {
                const parent = box.parentElement;
                if (parent) {
                    const table = parent.querySelector('.MuiBox-root.css-178yklu');
                    if (table) {
                        const tbody = table.querySelector('.MuiTableBody-root');
                        if (tbody) {
                            addLog('전쟁 로그 테이블 찾기 성공 (텍스트 검색)', 'success');
                            return tbody;
                        }
                    }
                }
            }
        }

        const h6Elements = document.querySelectorAll('.MuiTypography-h6');
        for (const h6 of h6Elements) {
            if (h6.textContent.includes('전쟁 로그')) {
                let parent = h6.parentElement;
                while (parent) {
                    const table = parent.querySelector('.MuiBox-root.css-178yklu');
                    if (table) {
                        const tbody = table.querySelector('.MuiTableBody-root');
                        if (tbody) {
                            addLog('전쟁 로그 테이블 찾기 성공 (h6 검색)', 'success');
                            return tbody;
                        }
                    }
                    parent = parent.parentElement;
                }
            }
        }

        const allTbodies = document.querySelectorAll('.MuiTableBody-root');
        for (const tbody of allTbodies) {
            const rows = tbody.querySelectorAll('tr');
            if (rows.length > 5) {
                addLog('전쟁 로그 테이블 찾기 성공 (행 개수 기준)', 'success');
                return tbody;
            }
        }

        return null;
    }

    function parseWarLogs() {
        const logTable = findWarLogTable();
        if (!logTable) {
            addLog('전쟁 로그 테이블을 찾을 수 없습니다.', 'error');
            alert('전쟁 로그를 찾을 수 없습니다.\n\n"더보기" 버튼을 눌러 로그를 더 불러온 후\n다시 수집 버튼을 눌러주세요.');
            return [];
        }

        addLog('전쟁 로그 테이블 찾음, 파싱 시작...', 'info');

        const logRows = logTable.querySelectorAll('tr');
        addLog(`${logRows.length}개의 로그 행 발견`, 'info');

        const logs = [];
        const stored = localStorage.getItem('lanis_guild_info');
        const guildData = stored ? JSON.parse(stored) : {};

        let parsedCount = 0;
        let skippedCount = 0;
        let skipReasons = {
            noTime: 0,
            noResult: 0,
            wrongResult: 0,
            wrongDay: 0,
            wrongHour: 0,
            tooFewCells: 0
        };

        const now = new Date();
        const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const todayDate = `${koreaTime.getFullYear()}. ${String(koreaTime.getMonth() + 1).padStart(2, '0')}. ${String(koreaTime.getDate()).padStart(2, '0')}.`;

        logRows.forEach((row, index) => {
            try {
                const cells = row.querySelectorAll('td');

                if (cells.length < 6) {
                    skipReasons.tooFewCells++;
                    skippedCount++;
                    return;
                }

                const timeElement = cells[0].querySelector('[aria-label]');
                if (!timeElement) {
                    skipReasons.noTime++;
                    skippedCount++;
                    return;
                }
                const dateLabel = timeElement.getAttribute('aria-label');


                // 당일 날짜 체크
                if (!dateLabel.startsWith(todayDate)) {
                    skipReasons.wrongDay++;
                    skippedCount++;
                    return;
                }

                // 21시대(오후 9시) 로그만 수집
                const isAfternoon9 = dateLabel.includes('오후 09:') || dateLabel.includes('오후 9:');
                if (!isAfternoon9) {
                    skipReasons.wrongHour++;
                    skippedCount++;
                    return;
                }

                const resultChip = cells[1].querySelector('.MuiChip-label');
                if (!resultChip) {
                    skipReasons.noResult++;
                    skippedCount++;
                    return;
                }
                const resultText = resultChip.textContent.trim();

                const attackResults = ['공격 승리', '공격 패배', '마을 점령'];
                if (!attackResults.includes(resultText)) {
                    skipReasons.wrongResult++;
                    skippedCount++;
                    return;
                }

                const isSuccess = (resultText === '공격 승리' || resultText === '마을 점령');
                const isCaptureResult = (resultText === '마을 점령');

                const villageChip = cells[2].querySelector('.MuiChip-label');
                const village = villageChip ? villageChip.textContent.trim() : '알 수 없음';

                const attackerName = cells[3].textContent.trim();
                const attackerGuild = cells[4].textContent.trim();

                const defenderName = cells[5].textContent.trim();
                const isFortress = defenderName.includes('요새');

                const log = {
                    date: dateLabel,
                    village: village,
                    guildName: attackerGuild,
                    memberName: attackerName,
                    target: isFortress ? defenderName : `${village} 마을의 ${defenderName}`,
                    defenderName: isFortress ? null : defenderName,
                    isFortress: isFortress,
                    isSuccess: isSuccess,
                    isCaptureResult: isCaptureResult,
                    isAttack: true
                };

                logs.push(log);
                parsedCount++;

                if (!isFortress && defenderName) {
                    let foundGuild = false;
                    for (const guildInfo of Object.values(guildData)) {
                        const isMember = guildInfo.members && guildInfo.members.some(m => m.nickname === defenderName);
                        if (isMember) {
                            log.defenderGuild = guildInfo.guildName;
                            foundGuild = true;
                            break;
                        }
                    }
                    if (!foundGuild) {
                        log.defenderGuild = '길드 X';
                    }
                }
            } catch (e) {
                addLog(`행 ${index} 파싱 오류: ${e.message}`, 'error');
                skippedCount++;
            }
        });

        if (parsedCount === 0 && skippedCount > 0) {
            addLog(`건너뛴 이유: 셀부족=${skipReasons.tooFewCells}, 시간없음=${skipReasons.noTime}, 다른날짜=${skipReasons.wrongDay}, 다른시간=${skipReasons.wrongHour}, 결과없음=${skipReasons.noResult}, 다른결과=${skipReasons.wrongResult}`, 'info');
        }

        addLog(`파싱 완료: ${parsedCount}개 성공, ${skippedCount}개 건너뜀`, 'success');
        return logs;
    }

    // =====================================================
    // 수집 제어
    // =====================================================

    function startCollection() {
        if (isCollecting) return;

        isCollecting = true;
        addLog('자동 수집 시작', 'success');

        collectAndRender();

        if (updateInterval) {
            clearInterval(updateInterval);
        }
        updateInterval = setInterval(() => {
            if (isCollecting) {
                // 매 인터벌마다 길드 데이터 체크
                const currentGuildData = loadGuildData();
                if (!currentGuildData) {
                    addLog('⚠️ 길드 정보가 없습니다. 자동 수집을 중지합니다.', 'error');
                    stopCollection();

                    // 버튼 UI 업데이트
                    const autoBtn = document.getElementById('auto-collect-btn');
                    if (autoBtn) {
                        autoBtn.textContent = '로그 자동 수집';
                        autoBtn.style.background = '#4caf50';
                    }

                    const header = document.querySelector('#war-status-header h2');
                    if (header) {
                        header.textContent = '오늘의 전쟁 현황';
                    }
                    return;
                }

                addLog('새 로그 확인 중...');
                collectAndRender();
            }
        }, 20000);
    }

    function collectAndRender() {
        const currentLogs = loadStoredLogs();
        const newParsedLogs = parseWarLogs();

        if (newParsedLogs.length > 0) {
            const mergedLogs = mergeLogs(currentLogs, newParsedLogs);

            if (mergedLogs.length > currentLogs.length) {
                const newCount = mergedLogs.length - currentLogs.length;
                addLog(`새 로그 ${newCount}개 발견`, 'success');
            } else {
                addLog('새 로그 없음', 'info');
            }

            saveStoredLogs(mergedLogs);

            // 길드 데이터 체크
            const guildData = loadGuildData();
            if (!guildData) {
                addLog('⚠️ 길드 정보가 없어 분석을 건너뜁니다.', 'error');
                // 로그는 저장했지만 분석은 하지 않음
                return;
            }

            processAndDisplayLogs(mergedLogs);
        } else {
            addLog('파싱된 로그 없음', 'info');
            if (currentLogs.length > 0) {
                const guildData = loadGuildData();
                if (guildData) {
                    processAndDisplayLogs(currentLogs);
                }
            }
        }
    }

    function stopCollection() {
        isCollecting = false;
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
        addLog('자동 수집 중지', 'info');
    }

    // =====================================================
    // UI 생성 및 업데이트
    // =====================================================

    /**
     * 전쟁 로그를 분석하여 UI 및 버튼 상태를 갱신합니다.
     * - 새로운 길드 발견 시: 자동 수집 버튼 활성화
     * - 7일 이상 된 길드 데이터 존재 시: 재수집 안내
     */
    function processAndDisplayLogs(logs) {
        // 🔹 로그에서 길드명 추출
        const logsGuilds = extractGuildsFromLogs(logs);
        const missingGuilds = findMissingGuilds(logsGuilds); // 새로운 길드
        const guildData = loadGuildData(); // 로컬 저장된 길드 정보

        // 🔹 버튼 상태 업데이트
        updateGuildCollectButton(missingGuilds);

        // 🔸 안내 로그 출력
        if (!guildData && logsGuilds.length > 0) {
            addLog(`⚠️ ${logsGuilds.length}개 길드 발견됨. 자동 수집이 필요합니다.`, 'warn');
            addLog('💡 "길드 자동 수집" 버튼을 눌러 수집을 시작하세요.', 'info');
        } else if (missingGuilds.length > 0) {
            addLog(`⚠️ 새로운 길드 ${missingGuilds.length}개 발견: ${missingGuilds.join(', ')}`, 'info');
        }


        // 🔹 길드 데이터 없을 때는 빈 상태로 팝업 생성
        if (!guildData) {
            const guildStatus = {};
            const villageStatus = analyzeVillageStatus(logs);
            const existingPopup = document.getElementById('war-status-popup');

            if (!existingPopup) createStatusPopup(guildStatus, villageStatus);
            else updateStatusPopup(guildStatus, villageStatus);
            return;
        }

        // 🔹 로그 상세 재구성 및 분석
        reconstructDetailedLogs(logs, guildData);
        const guildStatus = analyzeWarStatus(guildData, logs);
        const villageStatus = analyzeVillageStatus(logs);
        Object.assign(villageOwnership, calculateVillageOwnership(logs));

        // 🔹 로그 요약정보 저장
        if (logs.length > 0) {
            window.warLogInfo = {
                firstLog: logs[0],
                lastLog: logs[logs.length - 1],
                totalCount: logs.length,
            };
        }

        // 🔹 팝업 갱신
        const existingPopup = document.getElementById('war-status-popup');
        if (!existingPopup) createStatusPopup(guildStatus, villageStatus);
        else updateStatusPopup(guildStatus, villageStatus);
    }


    function updateLogInfoOnly() {
        const headerInfo = document.querySelector('#war-log-info');
        if (headerInfo && window.warLogInfo) {
            const firstLog = window.warLogInfo.firstLog;
            const time = firstLog.date.match(/\d{2}:\d{2}:\d{2}/)?.[0] || '';

            headerInfo.innerHTML = `
                최신: ${time} | ${firstLog.guildName} ${firstLog.memberName} → ${firstLog.target}
                ${firstLog.isSuccess ? '<span style="color: #4f4;">승리</span>' : '<span style="color: #f44;">패배</span>'}
                | 총 ${window.warLogInfo.totalCount}개
            `;
        }
    }

    function addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString('ko-KR');
        logMessages.push({ time: timestamp, message, type });

        if (logMessages.length > 100) {
            logMessages.shift();
        }

        updateLogDisplay();
    }

    function updateLogDisplay() {
        const logContainer = document.getElementById('war-log-container');
        if (!logContainer) return;

        if (currentView === 'guild' && selectedGuild) {
            const logs = guildLogs[selectedGuild] || [];
            if (logs.length === 0) {
                logContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">아직 전쟁 기록이 없습니다.</div>';
            } else {
                logContainer.innerHTML = logs.map(log => {
                    const color = log.isSuccess ? '#44ff44' : '#ff4444';
                    const actionType = log.isDefender ? '방어' : '공격';
                    return `<div style="color: ${color}; margin-bottom: 5px; padding: 5px; border-bottom: 1px solid #333;">[${log.time}] ${log.memberName} → ${log.target} ${actionType} ${log.isSuccess ? '성공' : '실패'}</div>`;
                }).join('');
            }
        }
        else if (currentView === 'village' && selectedVillage) {
            const logs = villageLogs[selectedVillage] || [];
            if (logs.length === 0) {
                logContainer.innerHTML = '<div style="color: #888; text-align: center; padding: 20px;">아직 전쟁 기록이 없습니다.</div>';
            } else {
                logContainer.innerHTML = logs.map(log => {
                    const color = log.isSuccess ? '#44ff44' : '#ff4444';
                    return `<div style="color: ${color}; margin-bottom: 5px; padding: 5px; border-bottom: 1px solid #333;">[${log.time}] ${log.guildName} ${log.memberName} → ${log.target} 공격 ${log.isSuccess ? '성공' : '실패'}</div>`;
                }).join('');
            }
        }
        else {
            logContainer.innerHTML = logMessages.map(log => {
                const color = log.type === 'error' ? '#ff4444' : log.type === 'success' ? '#44ff44' : '#ffffff';
                return `<div style="color: ${color}; margin-bottom: 5px;">[${log.time}] ${log.message}</div>`;
            }).join('');
        }

        logContainer.scrollTop = logContainer.scrollHeight;
    }

    function calculateStatistics(logs) {
        if (logs.length === 0) return null;

        const stats = {
            topAttacker: { name: '', guild: '', count: 0 },
            topDefender: { name: '', guild: '', count: 0 },
            worstAttacker: { name: '', guild: '', count: 0 },
            fortressVillage: { name: '', count: 0 },
            hottestVillage: { name: '', count: 0 },
            capturedVillages: []
        };

        const attackSuccess = {};
        const defenseSuccess = {};
        const attackFail = {};
        const villageAttacks = {};
        const fortressAttacks = {};
        const villageOwnership = {};

        const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

        sortedLogs.forEach(log => {
            if (!log.isAttack) return;

            const attackerKey = `${log.guildName}:${log.memberName}`;
            if (log.isSuccess) {
                attackSuccess[attackerKey] = (attackSuccess[attackerKey] || 0) + 1;
            } else {
                attackFail[attackerKey] = (attackFail[attackerKey] || 0) + 1;
            }

            if (log.isFortress) {
                fortressAttacks[log.village] = (fortressAttacks[log.village] || 0) + 1;
            }

            if (log.isCaptureResult && !log.isFortress) {
                const prevOwner = villageOwnership[log.village];
                const fromGuild = prevOwner && prevOwner !== '길드 X' ? prevOwner : '-';
                const toGuild = log.guildName && log.guildName !== '길드 X' ? log.guildName : '-';

                villageOwnership[log.village] = log.guildName;

                stats.capturedVillages.push({
                    village: log.village,
                    from: fromGuild,
                    to: toGuild,
                    time: log.date.match(/(\d{2}:\d{2}:\d{2})/)?.[0] || ''
                });
            } else if (log.isSuccess && !log.isFortress && !villageOwnership[log.village]) {
                if (log.defenderGuild && log.defenderGuild !== '길드 X') {
                    villageOwnership[log.village] = log.defenderGuild;
                }
            }

            if (log.defenderName && !log.isFortress) {
                const defenderGuild = log.defenderGuild || '길드 X';
                const defenderKey = `${defenderGuild}:${log.defenderName}`;

                if (!log.isSuccess) {
                    defenseSuccess[defenderKey] = (defenseSuccess[defenderKey] || 0) + 1;
                }
            }

            villageAttacks[log.village] = (villageAttacks[log.village] || 0) + 1;
        });

        for (const [key, count] of Object.entries(attackSuccess)) {
            if (count > stats.topAttacker.count) {
                const [guild, name] = key.split(':');
                stats.topAttacker = { name, guild, count };
            }
        }

        for (const [key, count] of Object.entries(defenseSuccess)) {
            if (count > stats.topDefender.count) {
                const [guild, name] = key.split(':');
                stats.topDefender = { name, guild, count };
            }
        }

        for (const [key, count] of Object.entries(attackFail)) {
            if (count > stats.worstAttacker.count) {
                const [guild, name] = key.split(':');
                stats.worstAttacker = { name, guild, count };
            }
        }

        for (const [village, count] of Object.entries(fortressAttacks)) {
            if (count > stats.fortressVillage.count) {
                stats.fortressVillage = { name: village, count };
            }
        }

        for (const [village, count] of Object.entries(villageAttacks)) {
            if (count > stats.hottestVillage.count) {
                stats.hottestVillage = { name: village, count };
            }
        }

        return stats;
    }

    function createStatisticsView(logs, isToday = false) {
        const stats = calculateStatistics(logs);

        if (!stats) {
            return '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 16px;">통계 데이터가 없습니다</div>';
        }

        const title = isToday ? '오늘의 전쟁 통계' : '어제의 전쟁 통계';

        return `
            <div style="padding: 10px; overflow-y: auto; height: 100%;">
                <h3 style="margin: 0 0 20px 0; color: #ffffff; text-align: center;">${title}</h3>

                <div style="display: grid; gap: 5px;">
                    ${stats.topAttacker.count > 0 ? `
                        <div style="background: #1a4d1a; padding: 5px; border-radius: 8px; border: 2px solid #2d7a2d;">
                            <h4 style="margin: 0 0 10px 0; color: #4f4; font-size: 16px;">🏆 최다 공격 승리자</h4>
                            <p style="margin: 5px 0; color: #ffffff; font-size: 18px; font-weight: bold;">${stats.topAttacker.guild} ${stats.topAttacker.name}</p>
                            <p style="margin: 5px 0 0 0; color: #8f8; font-size: 14px;">${stats.topAttacker.count}회 승리</p>
                        </div>
                    ` : ''}

                    ${stats.topDefender.count > 0 ? `
                        <div style="background: #1a3d4d; padding: 5px; border-radius: 8px; border: 2px solid #2d5a7a;">
                            <h4 style="margin: 0 0 10px 0; color: #4af; font-size: 16px;">🛡️ 최다 방어 성공자</h4>
                            <p style="margin: 5px 0; color: #ffffff; font-size: 18px; font-weight: bold;">${stats.topDefender.guild} ${stats.topDefender.name}</p>
                            <p style="margin: 5px 0 0 0; color: #8cf; font-size: 14px;">${stats.topDefender.count}회 방어 성공</p>
                        </div>
                    ` : ''}

                    ${stats.hottestVillage.count > 0 ? `
                        <div style="background: #4d3d1a; padding: 5px; border-radius: 8px; border: 2px solid #7a5a2d;">
                            <h4 style="margin: 0 0 10px 0; color: #fa4; font-size: 16px;">🔥 최다 접전 마을</h4>
                            <p style="margin: 5px 0; color: #ffffff; font-size: 18px; font-weight: bold;">${stats.hottestVillage.name}</p>
                            <p style="margin: 5px 0 0 0; color: #fc8; font-size: 14px;">${stats.hottestVillage.count}회 전투</p>
                        </div>
                    ` : ''}

                    ${stats.worstAttacker.count > 0 ? `
                        <div style="background: #4d1a1a; padding: 5px; border-radius: 8px; border: 2px solid #7a2d2d;">
                            <h4 style="margin: 0 0 10px 0; color: #f44; font-size: 16px;">💔 최다 공격 실패자</h4>
                            <p style="margin: 5px 0; color: #ffffff; font-size: 18px; font-weight: bold;">${stats.worstAttacker.guild} ${stats.worstAttacker.name}</p>
                            <p style="margin: 5px 0 0 0; color: #f88; font-size: 14px;">${stats.worstAttacker.count}회 실패</p>
                        </div>
                    ` : ''}

                    ${stats.fortressVillage.count > 0 ? `
                        <div style="background: #3d2a4d; padding: 5px; border-radius: 8px; border: 2px solid #5a3d7a;">
                            <h4 style="margin: 0 0 10px 0; color: #f4f; font-size: 16px;">🏰 요새가 보인 마을</h4>
                            <p style="margin: 5px 0; color: #ffffff; font-size: 18px; font-weight: bold;">${stats.fortressVillage.name}</p>
                            <p style="margin: 5px 0 0 0; color: #f8f; font-size: 14px;">${stats.fortressVillage.count}회 요새 공격</p>
                        </div>
                    ` : ''}

                    ${stats.capturedVillages.length > 0 ? `
                        <div style="background: #2a2a1a; padding: 5px; border-radius: 8px; border: 2px solid #5a5a2d;">
                            <h4 style="margin: 0 0 10px 0; color: #ff4; font-size: 16px;">⚔️ 마을 점령/탈환 (${stats.capturedVillages.length}회)</h4>
                            ${stats.capturedVillages.map(capture => {
            const fromGuild = capture.from && capture.from !== '길드 X' ? capture.from : '-';
            const toGuild = capture.to && capture.to !== '길드 X' ? capture.to : '-';
            const action = (fromGuild === '-' ? '점령했습니다' : '탈환했습니다');

            return `
                                    <div style="padding: 8px; margin: 5px 0; background: #1a1a1a; border-radius: 4px;">
                                        <p style="margin: 0; color: #ffffff; font-size: 14px;">
                                            ${toGuild} 길드가 ${fromGuild !== '-' ? fromGuild + ' 길드로부터 ' : ''}${capture.village} 마을을 ${action}
                                        </p>
                                        <p style="margin: 3px 0 0 0; color: #888; font-size: 11px;">${capture.time}</p>
                                    </div>
                                `;
        }).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    function generateDetailView(guildStatus, villageStatus) {
        const isMobile = window.innerWidth <= 768;

        if (!selectedGuild && !selectedVillage) {
            const savedLogs = loadStoredLogs();

            if (savedLogs.length > 0) {
                const now = new Date();
                const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
                const currentHour = koreaTime.getHours();
                const isWarTime = currentHour >= 21 && currentHour < 22;
                const isAfterWar = currentHour >= 22;

                const statsView = createStatisticsView(savedLogs, isWarTime || isAfterWar);

                // 모바일일 때는 스타일 래핑
                return `
                <div style="width: ${isMobile ? '100vw' : '100%'}; 
                            height: ${isMobile ? 'auto' : '100%'}; 
                            overflow-y: auto;">
                    ${statsView}
                </div>`;
            } else {
                return `
                <div style="display: flex; align-items: center; justify-content: center;
                            height: ${isMobile ? '50vh' : '100%'}; color: #888; font-size: 15px;">
                    아직 수집된 로그가 없습니다
                </div>`;
            }
        }

        if (currentView === 'guild' && selectedGuild) {
            const content = createGuildDetailTable(selectedGuild, guildStatus[selectedGuild]);
            return `<div style="width:${isMobile ? '100vw' : '100%'}; height:${isMobile ? 'auto' : '100%'}; overflow-y:auto;">${content}</div>`;
        } else if (currentView === 'village' && selectedVillage) {
            const content = createVillageDetailTable(selectedVillage, villageStatus[selectedVillage]);
            return `<div style="width:${isMobile ? '100vw' : '100%'}; height:${isMobile ? 'auto' : '100%'}; overflow-y:auto;">${content}</div>`;
        } else {
            return `
            <div style="display: flex; align-items: center; justify-content: center;
                        height: ${isMobile ? '50vh' : '100%'}; color: #888; font-size: 15px;">
                왼쪽에서 길드나 마을을 선택하세요
            </div>`;
        }
    }


    function createGuildCards(guildStatus) {
        let html = '';

        for (const guildName of Object.keys(guildStatus)) {
            const isSelected = selectedGuild === guildName;
            html += `
                <div class="guild-card" data-guild="${guildName}" style="
                    background: ${isSelected ? '#444' : '#333'};
                    padding: 5px;
                    border-radius: 8px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.3s;
                    border: 3px solid ${isSelected ? '#66f' : '#ada8a878'};
                ">
                    <h4 style="margin: 0; color: #ffffff; font-size: 16px;">${guildName}</h4>
                    <p style="margin: 5px 0 0 0; color: #aaa; font-size: 12px;">${Object.keys(guildStatus[guildName]).length}명</p>
                </div>
            `;
        }


        return html;
    }

    function createVillageCards(villageStatus) {
        let html = '';

        for (const [villageName, stats] of Object.entries(villageStatus)) {
            const isSelected = selectedVillage === villageName;
            const owner = villageOwnership[villageName];

            html += `
                <div class="village-card" data-village="${villageName}" style="
                    background: ${isSelected ? '#444' : '#333'};
                    padding: 5px;
                    border-radius: 8px;
                    cursor: pointer;
                    text-align: center;
                    transition: all 0.3s;
                    border: 2px solid ${isSelected ? '#f6f' : '#444'};
                ">
                    <h4 style="margin: 0; color: #ffffff; font-size: 16px;">${villageName}</h4>
                    ${owner ? `
                        <p style="margin: 5px 0 0 0; color: #4f4; font-size: 11px;">👑 ${owner.guildName}</p>
                    ` : `
                        <p style="margin: 5px 0 0 0; color: #888; font-size: 11px;">⚔️ 중립</p>
                    `}
                    <p style="margin: 5px 0 0 0; color: #4f4; font-size: 12px;">성공: ${stats.successAttacks}</p>
                    <p style="margin: 5px 0 0 0; color: #f44; font-size: 12px;">실패: ${stats.failAttacks}</p>
                </div>
            `;
        }
        return html;
    }

    function createGuildDetailTable(guildName, members) {
        const villageStats = {};
        const logs = guildLogs[guildName] || [];

        logs.forEach(log => {
            if (!villageStats[log.village]) {
                villageStats[log.village] = {
                    attacking: 0,
                    defending: 0
                };
            }

            if (log.isDefender) {
                villageStats[log.village].defending++;
            } else {
                villageStats[log.village].attacking++;
            }
        });

        const villages = Object.entries(villageStats).sort((a, b) => {
            const aTotal = (a[1].attacking > 0 ? 1 : 0) + (a[1].defending > 0 ? 1 : 0);
            const bTotal = (b[1].attacking > 0 ? 1 : 0) + (b[1].defending > 0 ? 1 : 0);
            if (aTotal !== bTotal) return bTotal - aTotal;
            return b[1].attacking - a[1].attacking;
        });

        let html = `
        <div style="padding: 15px;">
            <h3 style="margin: 0 0 10px 0; color: #ffffff;">${guildName} 상세 정보</h3>
            
            ${villages.length > 0 ? `
                <div style="
                    background: #1a3d4d;
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 15px;
                    border: 2px solid #2d5a7a;
                ">
                    <div style="color: #8cf; font-size: 14px; font-weight: bold; margin-bottom: 8px;">
                        ⚔️ 전투 중인 마을 (${villages.length}개)
                    </div>
                    <div style="
                        display: flex;
                        flex-wrap: wrap;
                        gap: 6px;
                        max-height: 150px;
                        overflow-y: auto;
                    ">
                        ${villages.map(([villageName, stats]) => {
            const isAttacking = stats.attacking > 0;
            const isDefending = stats.defending > 0;

            let bgColor, borderColor, text;
            if (isAttacking && isDefending) {
                bgColor = '#4d3d1a';
                borderColor = '#7a5a2d';
                text = `⚔️🛡️ ${villageName} (공${stats.attacking} / 방${stats.defending})`;
            } else if (isAttacking) {
                bgColor = '#4d1a1a';
                borderColor = '#7a2d2d';
                text = `⚔️ ${villageName} (공격 ${stats.attacking}회)`;
            } else {
                bgColor = '#1a4d1a';
                borderColor = '#2d7a2d';
                text = `🛡️ ${villageName} (방어 ${stats.defending}회)`;
            }

            return `
                                <span style="
                                    background: ${bgColor};
                                    color: #fff;
                                    padding: 6px 12px;
                                    border-radius: 4px;
                                    font-size: 12px;
                                    border: 1px solid ${borderColor};
                                    white-space: nowrap;
                                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                ">
                                    ${text}
                                </span>
                            `;
        }).join('')}
                    </div>
                </div>
            ` : `
                <div style="
                    background: #4d4d1a;
                    color: #888;
                    padding: 12px;
                    border-radius: 8px;
                    margin-bottom: 15px;
                    border: 2px solid #7a7a2d;
                    text-align: center;
                    font-size: 14px;
                ">
                    전투 기록이 없습니다
                </div>
            `}
            
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: #1a1a1a;">
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff; border-right-width: 5px;">길드원</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">남은<br>공격권</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff; border-right-width: 5px;">남은<br>수비권</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">공격<br>성공</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff; border-right-width: 5px;">공격<br>실패</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">수비<br>성공</th>
                        <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">수비<br>실패</th>
                    </tr>
                </thead>
                <tbody>
    `;

        for (const [memberName, stats] of Object.entries(members)) {
            html += `
            <tr style="background: #2a2a2a;">
                <td style="border: 1px solid #444; padding: 10px; color: #ffffff; border-right-width: 5px;">${memberName}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #4af;">${stats.attackRemaining}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #fa4; border-right-width: 5px;">${stats.defenseRemaining}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #4f4;">${stats.attackSuccess}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #f44; border-right-width: 5px;">${stats.attackFail}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #4f4;">${stats.defenseSuccess}</td>
                <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #f44;">${stats.defenseFail}</td>
            </tr>
        `;
        }

        html += '</tbody></table></div>';
        return html;
    }

    function createVillageDetailTable(villageName, stats) {
        const owner = villageOwnership[villageName];

        let html = `
            <div style="padding: 15px;">
                <h3 style="margin: 0 0 15px 0; color: #ffffff;">${villageName} 마을 통계</h3>
                ${owner ? `
                    <div style="background: #1a4d1a; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 2px solid #2d7a2d;">
                        <p style="margin: 0; color: #4f4; font-size: 16px; font-weight: bold;">
                            🏆 현재 점령: ${owner.guildName}
                        </p>
                        <p style="margin: 5px 0 0 0; color: #8f8; font-size: 12px;">
                            점령 시각: ${owner.time}
                        </p>
                        ${owner.previousOwner !== owner.guildName ? `
                            <p style="margin: 5px 0 0 0; color: #fa4; font-size: 12px;">
                                ⚔️ 탈환: ${owner.previousOwner} → ${owner.guildName}
                            </p>
                        ` : `
                            <p style="margin: 5px 0 0 0; color: #8f8; font-size: 12px;">
                                🛡️ 방어 성공 (${owner.guildName} 유지)
                            </p>
                        `}
                    </div>
                ` : `
                    <div style="background: #4d4d1a; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 2px solid #7a7a2d;">
                        <p style="margin: 0; color: #ff4; font-size: 16px; font-weight: bold;">
                            ⚔️ 중립 상태 (점령 기록 없음)
                        </p>
                    </div>
                `}
                <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <p style="margin: 5px 0; color: #ffffff;">총 공격 횟수: ${stats.totalAttacks}</p>
                    <p style="margin: 5px 0; color: #4f4;">성공한 공격: ${stats.successAttacks}</p>
                    <p style="margin: 5px 0; color: #f44;">실패한 공격: ${stats.failAttacks}</p>
                </div>
                <h4 style="margin: 15px 0 10px 0; color: #ffffff;">길드별 공격 현황</h4>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #1a1a1a;">
                            <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">길드명</th>
                            <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">총 공격</th>
                            <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">성공</th>
                            <th style="border: 1px solid #444; padding: 10px; color: #ffffff;">실패</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const [guildName, guildStats] of Object.entries(stats.guilds)) {
            const isOwner = owner && owner.guildName === guildName;
            html += `
                <tr style="background: ${isOwner ? '#1a3d1a' : '#2a2a2a'};">
                    <td style="border: 1px solid #444; padding: 10px; color: #ffffff;">
                        ${guildName}${isOwner ? ' 👑' : ''}
                    </td>
                    <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #aaa;">${guildStats.attacks}</td>
                    <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #4f4;">${guildStats.success}</td>
                    <td style="border: 1px solid #444; padding: 10px; text-align: center; color: #f44;">${guildStats.fail}</td>
                </tr>
            `;
        }

        html += '</tbody></table></div>';
        return html;
    }

    function attachCardListeners(guildStatus, villageStatus) {
        if (currentView === 'guild') {
            document.querySelectorAll('.guild-card').forEach(card => {
                card.addEventListener('click', () => {
                    selectedGuild = card.dataset.guild;
                    const detailView = document.getElementById('detail-view');
                    if (detailView) {
                        detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                    }
                    updateCardSelection(guildStatus, villageStatus);
                    updateLogDisplay();
                });
            });
        } else {
            document.querySelectorAll('.village-card').forEach(card => {
                card.addEventListener('click', () => {
                    selectedVillage = card.dataset.village;
                    const detailView = document.getElementById('detail-view');
                    if (detailView) {
                        detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                    }
                    updateCardSelection(guildStatus, villageStatus);
                    updateLogDisplay();
                });
            });
        }
    }

    function updateCardSelection(guildStatus, villageStatus) {
        const cardContainer = document.getElementById('card-container');
        if (cardContainer) {
            const savedScroll = cardContainer.scrollTop;

            const cardsHtml = currentView === 'guild'
                ? createGuildCards(guildStatus)
                : createVillageCards(villageStatus);

            cardContainer.innerHTML = cardsHtml.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');

            attachCardListeners(guildStatus, villageStatus);
            cardContainer.scrollTop = savedScroll;
        }
    }

    function updateStatusPopup(guildStatus, villageStatus) {
        updateLogInfoOnly();

        const cardContainer = document.getElementById('card-container');
        const detailView = document.getElementById('detail-view');

        if (cardContainer) {
            const savedScroll = cardContainer.scrollTop;
            const cardsHtml = currentView === 'guild'
                ? createGuildCards(guildStatus)
                : createVillageCards(villageStatus);

            cardContainer.innerHTML = cardsHtml.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
            attachCardListeners(guildStatus, villageStatus);
            cardContainer.scrollTop = savedScroll;
        }

        if (detailView) {
            const savedScroll = detailView.scrollTop;
            detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
            detailView.scrollTop = savedScroll;
        }

        updateLogDisplay();
    }

    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('#war-status-header');

        header.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            if (e.target.tagName === 'BUTTON') return;
            e.preventDefault();
            pos3 = e.clientX;
            pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            const newTop = (element.offsetTop - pos2);
            const newLeft = (element.offsetLeft - pos1);

            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";
            element.style.right = "auto";
            element.style.transform = "none";

            popupPosition = {
                top: newTop + "px",
                left: newLeft + "px",
                right: null,
                transform: "none"
            };
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    function createStatusPopup(guildStatus, villageStatus) {
        const existingPopup = document.getElementById('war-status-popup');

        if (existingPopup) {
            const rect = existingPopup.getBoundingClientRect();
            popupPosition = {
                top: rect.top + "px",
                left: rect.left + "px",
                right: null,
                transform: "none",
                width: rect.width + "px",
                height: isMinimized ? popupPosition.height : (rect.height + "vw")
            };
            existingPopup.remove();
        }

        const popup = document.createElement('div');
        popup.id = 'war-status-popup';

        const posStyle = popupPosition.right
            ? `top: ${popupPosition.top}; right: ${popupPosition.right}; transform: ${popupPosition.transform};`
            : `top: ${popupPosition.top}; left: ${popupPosition.left}; transform: ${popupPosition.transform};`;

        const width = popupPosition.isMobile
            ? (popupPosition.width || '95vw')
            : (popupPosition.width || '900px');

        const height = popupPosition.isMobile
            ? (isMinimized ? 'auto' : (popupPosition.height || '75vh'))
            : (isMinimized ? 'auto' : (popupPosition.height || '55vh'));

        const minWidth = popupPosition.isMobile ? '95vw' : '600px';
        const sidebarWidth = popupPosition.isMobile ? '100%' : '150px';
        const sidebarDisplay = 'flex';
        const sidebarFlexShrink = popupPosition.isMobile ? '0' : '0';
        popup.style.cssText = `
        position: fixed;
        ${posStyle}
        background: #2a2a2a;
        border: 2px solid #444;
        border-radius: 8px;
        padding: 0;
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        width: ${width};
        height: ${height};
        min-width: ${minWidth};
        ${isMinimized ? '' : 'min-height: 400px;'}
        color: #ffffff;
        display: flex;
        flex-direction: column;
        ${isMinimized || popupPosition.isMobile ? '' : 'resize: both;'}
        overflow: hidden;
    `;

        const now = new Date();
        const koreaTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
        const days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
        const currentDay = days[koreaTime.getDay()];
        const dateStr = `${koreaTime.getFullYear()}년 ${koreaTime.getMonth() + 1}월 ${koreaTime.getDate()}일`;

        let html = `
         <div id="war-status-header" style="
            background: #1a1a1a;
            padding: ${popupPosition.isMobile ? '8px' : '10px'};
            cursor: move;
            border-bottom: 2px solid #444;
            display: flex;
            flex-direction: ${popupPosition.isMobile ? 'column' : 'row'};
            justify-content: space-between;
            align-items: ${popupPosition.isMobile ? 'stretch' : 'center'};
            flex-shrink: 0;
            gap: ${popupPosition.isMobile ? '10px' : '0'};
        ">
              <div>
                <h2 style="margin: 0; color: #ffffff; font-size: ${popupPosition.isMobile ? '16px' : '18px'};">오늘의 전쟁 현황${isCollecting ? ' (자동 수집 중...)' : ''}</h2>
                <p style="margin: 5px 0 0 0; color: #aaa; font-size: ${popupPosition.isMobile ? '12px' : '14px'};">${dateStr} (${currentDay})</p>
                ${!popupPosition.isMobile ? `
                <p id="war-log-info" style="margin: 5px 0 0 0; color: #888; font-size: 12px;">
                    ${window.warLogInfo ? `
                        최신: ${window.warLogInfo.firstLog.date.match(/\d{2}:\d{2}:\d{2}/)?.[0] || ''} | 
                        ${window.warLogInfo.firstLog.guildName} ${window.warLogInfo.firstLog.memberName} → ${window.warLogInfo.firstLog.target} 
                        ${window.warLogInfo.firstLog.isSuccess ? '<span style="color: #4f4;">승리</span>' : '<span style="color: #f44;">패배</span>'} 
                        | 총 ${window.warLogInfo.totalCount}개
                    ` : '로그 수집 대기중...'}
                </p>
                ` : ''}
            </div>
      <div style="display: ${popupPosition.isMobile ? 'grid' : 'flex'}; 
                        grid-template-columns: ${popupPosition.isMobile ? '1fr 1fr' : 'none'}; 
                        gap: ${popupPosition.isMobile ? '5px' : '10px'};">
                <button id="help-btn" style="
                    padding: ${popupPosition.isMobile ? '6px 8px' : '5px 10px'};
                    background: #9c27b0;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                ">❓ 도움말</button>
                <button id="auto-collect-missing-btn" style="
                    padding: ${popupPosition.isMobile ? '8px 10px' : '5px 15px'};
                    background: #ff9800;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                     font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                ">🔄 길드 수집</button>
                <button id="manual-collect-btn" style="
                    padding: ${popupPosition.isMobile ? '8px 10px' : '5px 15px'};
                    background: #2196F3;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                     font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                ">로그 수동</button>
                <button id="auto-collect-btn" style="
                    padding: ${popupPosition.isMobile ? '8px 10px' : '5px 15px'};
                    background: ${isCollecting ? '#ff9800' : '#4caf50'};
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                ">${isCollecting ? '자동 중지' : '로그 자동'}</button>
                <button id="minimize-btn" style="
                    padding: ${popupPosition.isMobile ? '8px 10px' : '5px 15px'};
                    background: #ec2d2d;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                     font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                    ${popupPosition.isMobile ? 'grid-column: 1 / -1;' : ''}
                ">최소화</button>
            </div>
        </div>
    `;
        if (!isMinimized) {
            html += `
          <div style="display: flex; flex: 1; overflow: hidden; flex-direction: ${popupPosition.isMobile ? 'column' : 'row'};">
                <div style="width: ${sidebarWidth}; 
                            display: ${sidebarDisplay}; 
                            background: #1a1a1a; 
                            border-right: 2px solid #444; 
                            flex-direction: column;">
                    <div style="padding: 10px; border-bottom: 1px solid #444; flex-shrink: 0;">
                        <button id="guild-view-btn" style="
                            width: 100%;
                            padding: 10px;
                            margin-bottom: 5px;
                            background: ${currentView === 'guild' ? '#555' : '#333'};
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">길드별 보기</button>
                        <button id="village-view-btn" style="
                            width: 100%;
                            padding: 10px;
                            background: ${currentView === 'village' ? '#555' : '#333'};
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-weight: bold;
                        ">마을별 보기</button>
                    </div>
                    <div id="card-container" style="overflow-y: auto; flex: 1;">
                        ${currentView === 'guild' ? createGuildCards(guildStatus) : createVillageCards(villageStatus)}
                    </div>
                </div>
                   <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div id="detail-view" style="flex: 1; overflow-y: auto; background: #2a2a2a;">
                        ${generateDetailView(guildStatus, villageStatus)}
                    </div>
                    <div style="height: ${popupPosition.isMobile ? '230px' : '280px'}; 
                                background: #1a1a1a; 
                                border-top: 2px solid #444; 
                                display: flex; 
                                flex-direction: column; 
                                flex-shrink: 0;">
                        <h4 style="margin: 10px 15px; color: #ffffff; font-size: 14px;">로그</h4>
                        <div id="war-log-container" style="
                            flex: 1;
                            background: #000;
                            margin: 0 15px 15px 15px;
                            padding: 10px;
                            border-radius: 4px;
                            overflow-y: auto;
                            font-family: monospace;
                            font-size: ${popupPosition.isMobile ? '12px' : '14px'};
                        "></div>
                    </div>
                </div>
            </div>
        `;
        }


        popup.innerHTML = html;

        if (!isMinimized) {
            const resizeHandle = document.createElement('div');
            resizeHandle.id = 'resize-handle';
            resizeHandle.style.cssText = `
            position: absolute;
            bottom: 2px;
            right: 2px;
            width: 50px;
            height: 50px;
            cursor: nwse-resize;
            z-index: 100000;
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            padding: 8px;
            background: linear-gradient(135deg, transparent 0%, transparent 40%, rgba(102, 126, 234, 0.95) 40%);
            border-bottom-right-radius: 6px;
            transition: all 0.3s;
            pointer-events: auto;
            box-shadow: -2px -2px 8px rgba(0, 0, 0, 0.3);
        `;

            resizeHandle.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                gap: 4px;
                align-items: flex-end;
            ">
         ↘
            </div>
        `;

            popup.appendChild(resizeHandle);

            resizeHandle.addEventListener('mouseenter', () => {
                resizeHandle.style.background = 'linear-gradient(135deg, transparent 0%, transparent 40%, rgba(118, 75, 162, 1) 40%)';
                resizeHandle.style.transform = 'scale(1.1)';
                resizeHandle.style.boxShadow = '-3px -3px 12px rgba(0, 0, 0, 0.5)';
            });

            resizeHandle.addEventListener('mouseleave', () => {
                resizeHandle.style.background = 'linear-gradient(135deg, transparent 0%, transparent 40%, rgba(102, 126, 234, 0.95) 40%)';
                resizeHandle.style.transform = 'scale(1)';
                resizeHandle.style.boxShadow = '-2px -2px 8px rgba(0, 0, 0, 0.3)';
            });
        }

        document.body.appendChild(popup);

        makeDraggable(popup);

        // 팝업 생성 직후 버튼 상태 업데이트
        setTimeout(() => {
            updateGuildCollectButton(totalNeed)
        }, 100);


// 도움말 버튼
        const helpBtn = document.getElementById('help-btn');
        if (helpBtn) {
            helpBtn.addEventListener('click', () => {
                addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                addLog('📖 전쟁 트래커 사용 방법', 'success');
                addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                addLog('1️⃣ 길드 정보가 저장되어 있지 않으면, "길드 자동 수집" 버튼을 누르고 끝날 때까지 대기해주세요. ', 'info');
                addLog('', 'info');
                addLog('2️⃣ 전쟁 로그 화면에서 "더보기" 버튼을 눌러 당일 전쟁 로그가 보일 때까지 클릭해주세요.', 'info');
                addLog('', 'info');
                addLog('3️⃣ 팝업 화면 우측 상단의  "로그 수동 수집" 버튼을 눌러주세요. ', 'info');
                addLog('', 'info');
                addLog('4️⃣ "로그 자동 수집" 버튼을 누르면, 20초마다 한 번씩 로그를 조사합니다.', 'info');
                addLog('', 'info');
                addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
                addLog('💡 팁: 로그 창을 확인하여 진행 상황을 파악하세요!', 'success');
                addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
            });
        }

        const manualBtn = document.getElementById('manual-collect-btn');
        if (manualBtn) {
            manualBtn.addEventListener('click', () => {
                addLog('수동 수집 시작', 'info');
                const guildData = loadGuildData();
                if (!guildData) {
                    addLog('⚠️ 길드 정보가 없습니다. 로그 자동 수집을 시작할 수 없습니다.', 'error');
                    addLog('💡 먼저 "길드 자동 수집" 버튼을 눌러 길드 정보를 수집하세요.', 'info');

                    return; // 버튼 상태 변경 없이 종료
                }
                collectAndRender();
            });
        }

        const autoBtn = document.getElementById('auto-collect-btn');
        if (autoBtn) {
            autoBtn.addEventListener('click', () => {
                if (!isCollecting) {
                    // 길드 정보 체크 먼저
                    const guildData = loadGuildData();
                    if (!guildData) {
                        addLog('⚠️ 길드 정보가 없습니다. 로그 자동 수집을 시작할 수 없습니다.', 'error');
                        addLog('💡 먼저 "길드 자동 수집" 버튼을 눌러 길드 정보를 수집하세요.', 'info');

                        autoBtn.textContent = '자동 수집 중지';
                        autoBtn.style.background = '#ff9800';
                        return; // 버튼 상태 변경 없이 종료
                    }

                    // 자동 수집 시작
                    startCollection();

                    // 버튼 UI 즉시 업데이트
                    autoBtn.textContent = '자동 수집 중지';
                    autoBtn.style.background = '#ff9800';

                    const header = document.querySelector('#war-status-header h2');
                    if (header) {
                        header.textContent = '오늘의 전쟁 현황 (자동 수집 중...)';
                    }
                } else {
                    // 자동 수집 중지
                    stopCollection();

                    // 버튼 UI 즉시 업데이트
                    autoBtn.textContent = '로그 자동 수집';
                    autoBtn.style.background = '#4caf50';

                    const header = document.querySelector('#war-status-header h2');
                    if (header) {
                        header.textContent = '오늘의 전쟁 현황';
                    }
                }
            });
        }

        document.getElementById('minimize-btn').addEventListener('click', () => {
            popup.remove();
            isPopupOpen = false;

            const existingBtn = document.getElementById('war-tracker-btn');
            if (existingBtn) {
                existingBtn.style.display = 'flex';
            } else {
                createFloatingButton();
            }
        });

        if (!isMinimized) {
            document.getElementById('guild-view-btn').addEventListener('click', () => {
                currentView = 'guild';
                selectedGuild = null;
                selectedVillage = null;

                const savedLogs = loadStoredLogs();
                processAndDisplayLogs(savedLogs.length > 0 ? savedLogs : []);
            });

            document.getElementById('village-view-btn').addEventListener('click', () => {
                currentView = 'village';
                selectedGuild = null;
                selectedVillage = null;

                const savedLogs = loadStoredLogs();
                processAndDisplayLogs(savedLogs.length > 0 ? savedLogs : []);
            });

            attachCardListeners(guildStatus, villageStatus);
            updateLogDisplay();
        }
    }

    // =====================================================
    // 페이지 감지 및 초기화 (이벤트 리스너)
    // =====================================================

    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            checkWarPage();
        }
    }).observe(document, {subtree: true, childList: true});

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            checkWarPage();
        });
    } else {
        checkWarPage();
    }

    window.showWarStatus = () => {
        const savedLogs = loadStoredLogs();
        processAndDisplayLogs(savedLogs.length > 0 ? savedLogs : []);
    };

})();
