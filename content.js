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
 * @version 1.5
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
    let sortState = {
        guild: { key: 'attackRemaining', order: 'desc' }, // 길드 뷰 기본값: 남은 공격권 많은 순
        village: { key: 'attacks', order: 'desc' }        // 마을 뷰 기본값: 공격 횟수 많은 순
    };
    const STORAGE_KEY = 'lanis_war_logs1';
    const GUILD_STORAGE_KEY = 'lanis_guild_info1';

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
    // 플로팅 버튼 관리  및 스타일
    // =====================================================
    // UI 스타일 정의 (CSS 주입) - 전체 코드
    // =====================================================
    function injectCustomStyles() {
        const styleId = 'lanis-war-tracker-style';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* 1. 전체 팝업 컨테이너 */
            #war-status-popup {
                font-family: 'Pretendard', 'Malgun Gothic', sans-serif;
                background: #1e1e24 !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                box-shadow: 0 20px 50px rgba(0,0,0,0.8) !important;
                color: #e0e0e0;
                border-radius: 12px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                font-size: 13px;
                min-width: 400px;
                min-height: 300px;
            }

            /* 2. 스크롤바 커스텀 */
            #war-status-popup ::-webkit-scrollbar { width: 6px; height: 6px; }
            #war-status-popup ::-webkit-scrollbar-track { background: #222; }
            #war-status-popup ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
            #war-status-popup ::-webkit-scrollbar-thumb:hover { background: #777; }

            /* 3. 상단 헤더 */
            .lanis-header {
                background: #25252b; padding: 10px 16px; border-bottom: 1px solid #333;
                display: flex; justify-content: space-between; align-items: center;
                height: 50px; flex-shrink: 0; cursor: move; user-select: none;
            }
            .lanis-title h2 { margin: 0; font-size: 15px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px; }
            .lanis-title p { margin: 0; font-size: 11px; color: #aaa; margin-top: 2px;}

            /* 4. 버튼 그룹 */
            .lanis-btn-group { display: flex; gap: 6px; align-items: center; }
            .lanis-btn {
                padding: 5px 10px; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;
                font-size: 11px; font-weight: 600; cursor: pointer; color: #eee;
                transition: all 0.2s; height: 28px; display: flex; align-items: center; justify-content: center; white-space: nowrap;
            }
            .lanis-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
            .lanis-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(1); }
            
            .btn-purple { background: #6a1b9a; border-color: #8e24aa; }
            .btn-red { background: #c62828; border-color: #e53935; }
            .btn-orange { background: #ef6c00; border-color: #fb8c00; }
            .btn-blue { background: #1565c0; border-color: #1e88e5; }
            .btn-green { background: #2e7d32; border-color: #43a047; }
            .btn-gray { background: #424242; border-color: #616161; }

            /* 5. 메인 레이아웃 */
            .lanis-body { display: flex; flex: 1; overflow: hidden; position: relative; background: #121212; }
            
            /* 사이드바 */
            .lanis-sidebar { width: 260px; background: #1a1a1e; border-right: 1px solid #333; display: flex; flex-direction: column; flex-shrink: 0; }
            .sidebar-tabs { display: flex; padding: 8px; gap: 4px; border-bottom: 1px solid #333; background: #222; }
            .tab-btn { flex: 1; padding: 6px; border: none; border-radius: 4px; color: #888; background: transparent; cursor: pointer; font-weight: bold; font-size: 12px; transition: 0.2s; }
            .tab-btn:hover { background: rgba(255,255,255,0.05); color: #ccc; }
            .tab-btn.active { background: #3f51b5; color: white; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

            .card-container { padding: 8px; overflow-y: auto; flex: 1; }
            .card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
            .lanis-card {
                background: #2c2c33; padding: 8px 10px; border-radius: 6px; cursor: pointer;
                border: 1px solid transparent; transition: all 0.2s;
                display: flex; flex-direction: column; justify-content: center; min-height: 50px;
            }
            .lanis-card:hover { background: #383840; border-color: #555; transform: translateY(-1px); }
            .lanis-card.active { background: #303045; border-color: #5c6bc0; box-shadow: inset 0 0 0 1px #5c6bc0; }
            .card-title { font-size: 12px; font-weight: bold; color: #fff; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .card-sub { font-size: 11px; color: #aaa; display: flex; justify-content: space-between; align-items: center; }

            /* 전체 보기 카드 */
            .total-card { 
                border: 1px dashed #555; background: rgba(255,255,255,0.05) !important; 
                margin-bottom: 8px; font-weight: bold; color: #fff; 
                justify-content: center; align-items: center; text-align: center; min-height: 40px;
            }
            .total-card:hover { background: rgba(255,255,255,0.1) !important; border-color: #777; }
            .total-card.active { background: #3949ab !important; border: 1px solid #7986cb; box-shadow: 0 0 8px rgba(92,107,192,0.4); }

            /* 6. 메인 콘텐츠 및 통계 그리드 (여기가 핵심 수정됨) */
            .lanis-content { flex: 1; display: flex; flex-direction: column; background: #161618; overflow: hidden; position: relative; }
            .detail-view { flex: 1; overflow-y: auto; padding: 0; position: relative; }

            /* 통계 그리드 레이아웃 */
            .stat-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr); /* 2열 고정 */
                gap: 12px;
                padding: 10px;
            }
            /* 통계 카드 스타일 */
            .stat-card {
                background: #25252b;
                border-radius: 8px;
                padding: 12px 15px;
                display: flex; flex-direction: column; gap: 4px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.2);
                border: 1px solid #333;
                position: relative;
                overflow: hidden;
            }
            /* 왼쪽 컬러바 */
            .stat-card::before {
                content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
                background: var(--card-color, #555);
            }
            .stat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
            .stat-title { font-size: 11px; font-weight: bold; color: var(--card-color, #aaa); text-transform: uppercase; letter-spacing: 0.5px; }
            .stat-icon { font-size: 16px; }
            .stat-value { font-size: 16px; font-weight: bold; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .stat-sub { font-size: 11px; color: #888; margin-top: 2px; }
            
            /* 가로로 꽉 차는 카드 (라이벌, 로그 등) */
            .span-2 { grid-column: span 2; }

            /* 빈 화면 */
            .empty-placeholder {
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                text-align: center; color: #444; pointer-events: none;
            }
            .empty-icon { font-size: 48px; margin-bottom: 10px; opacity: 0.5; }
            .empty-text { font-size: 14px; font-weight: 500; }

            /* 하단 로그 패널 */
            .log-panel { height: 180px; background: #0f0f10; border-top: 1px solid #333; display: flex; flex-direction: column; flex-shrink: 0; }
            .log-header { padding: 4px 10px; font-size: 11px; font-weight: bold; color: #666; background: #1a1a1a; border-bottom: 1px solid #222; display: flex; justify-content: space-between; }
            .log-body { flex: 1; overflow-y: auto; padding: 6px 10px; font-family: 'Consolas', monospace; font-size: 11px; line-height: 1.5; }

            /* 7. 상세 테이블 */
            .table-container { padding: 15px; }
            .detail-header { margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #333; display: flex; align-items: center; justify-content: space-between; }
            .detail-header h3 { margin: 0; font-size: 16px; color: white; display: flex; align-items: center; gap: 8px; }
            
            .lanis-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
            .lanis-table th {
                position: sticky; top: 0; background: #202025; color: #bbb; padding: 8px;
                font-weight: 600; text-align: center; border-bottom: 2px solid #444; z-index: 5; font-size: 11px;
            }
            .lanis-table td { padding: 6px 8px; border-bottom: 1px solid #2a2a2a; color: #ddd; vertical-align: middle; }
            .lanis-table tr:hover td { background: rgba(255,255,255,0.03); }
            
            /* 유틸리티 */
            .txt-left { text-align: left; }
            .txt-center { text-align: center; }
            .txt-right { text-align: right; font-family: 'Consolas', monospace; }
            .border-r { border-right: 1px solid #333; }
            .c-success { color: #81c784; }
            .c-fail { color: #e57373; }
            .c-dim { color: #555; }
            
            .badge { padding: 2px 5px; border-radius: 3px; font-size: 10px; margin-right: 3px; display: inline-block; margin-bottom: 2px;}
            .bg-attack { background: rgba(239, 83, 80, 0.15); color: #ef5350; border: 1px solid rgba(239, 83, 80, 0.2); }
            .bg-defend { background: rgba(102, 187, 106, 0.15); color: #66bb6a; border: 1px solid rgba(102, 187, 106, 0.2); }
            .bg-clash { background: rgba(255, 167, 38, 0.15); color: #ffa726; border: 1px solid rgba(255, 167, 38, 0.2); }

            #resize-handle:hover { background: linear-gradient(135deg, transparent 50%, rgba(100, 181, 246, 0.6) 50%) !important; }

            /* 9. 모바일 반응형 */
            @media (max-width: 768px) {
                .lanis-body { flex-direction: column; }
                .lanis-sidebar { width: 100%; height: 160px; border-right: none; border-bottom: 1px solid #333; }
                .card-grid { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
                
                /* 모바일에서는 통계 카드 1열로 변경 */
                .stat-grid { grid-template-columns: 1fr; }
                .span-2 { grid-column: span 1; }
            }
        `;
        document.head.appendChild(style);
    }
    function createFloatingButton() {
        // if (document.getElementById('war-tracker-btn')) return;

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
    // 데이터 초기화 함수
    // =====================================================
    function resetStoredData() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(GUILD_STORAGE_KEY);
        logMessages = [];
        Object.keys(guildLogs).forEach(key => guildLogs[key] = []);
        Object.keys(villageLogs).forEach(key => villageLogs[key] = []);
        villageOwnership = {};
        totalNeed = [];
        selectedGuild = null;
        selectedVillage = null;
        currentView = 'guild';
        addLog('🗑️ 모든 데이터 초기화 완료 (로그 & 길드 정보 삭제됨)', 'success');
        // UI 새로고침
        const savedLogs = [];
        const guildData = null;
        const guildStatus = {};
        const villageStatus = {};
        const existingPopup = document.getElementById('war-status-popup');
        if (existingPopup) {
            updateStatusPopup(guildStatus, villageStatus);
        } else {
            createStatusPopup(guildStatus, villageStatus);
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
        const storedData = localStorage.getItem(GUILD_STORAGE_KEY);
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
            const storageData = JSON.parse(localStorage.getItem(GUILD_STORAGE_KEY) || "{}");

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
            localStorage.setItem(GUILD_STORAGE_KEY, JSON.stringify(storageData));

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
            const storedData = localStorage.getItem(GUILD_STORAGE_KEY);

            if (!storedData) return;

            const guildInfo = JSON.parse(storedData);

            if (guildInfo[guildName]) {
                delete guildInfo[guildName];
                localStorage.setItem(GUILD_STORAGE_KEY, JSON.stringify(guildInfo));
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
            const raw = localStorage.getItem(GUILD_STORAGE_KEY);
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

        // UI 새로고침 및 플레이어 정보 업데이트
        setTimeout(() => {
            const savedLogs = loadStoredLogs();
            // 길드 정보 업데이트 후 로그 재처리 (플레이어 길드 할당)
            updatePlayerGuildsInLogs(savedLogs);
            processAndDisplayLogs(savedLogs);
            addLog('길드별 보기 렌더링 최신화 완료 (플레이어 정보 업데이트됨)', 'success');
        }, 1000);
    }

    /**
     * 저장된 로그에서 플레이어의 길드 정보를 업데이트
     * 길드 데이터에서 플레이어 이름을 검색하여 guildName 할당
     */
    function updatePlayerGuildsInLogs(logs) {
        if (logs.length === 0) return logs;

        const guildData = loadStoredGuilds();
        if (Object.keys(guildData).length === 0) {
            addLog('길드 데이터가 없어 플레이어 정보 업데이트를 건너뜁니다.', 'warn');
            return logs;
        }

        let updatedCount = 0;

        // 공격자 길드 업데이트
        logs.forEach(log => {
            if (log.guildName === '길드 X' || !log.guildName) {
                const attackerGuild = findGuildByMember(guildData, log.memberName);
                if (attackerGuild) {
                    log.guildName = attackerGuild;
                    updatedCount++;
                }
            }

            // 수비자 길드 업데이트
            if (log.defenderName && (log.defenderGuild === '길드 X' || !log.defenderGuild)) {
                const defenderGuild = findGuildByMember(guildData, log.defenderName);
                if (defenderGuild) {
                    log.defenderGuild = defenderGuild;
                    updatedCount++;
                }
            }
        });

        if (updatedCount > 0) {
            saveStoredLogs(logs);
            addLog(`플레이어 길드 정보 업데이트: ${updatedCount}건`, 'success');
        }

        return logs;
    }

    /**
     * 길드 데이터에서 멤버 이름으로 길드명 찾기
     */
    function findGuildByMember(guildData, memberName) {
        if (!memberName) return null;

        for (const [guildName, guildInfo] of Object.entries(guildData)) {
            if (guildInfo.members && guildInfo.members.some(m => m.nickname === memberName)) {
                return guildName;
            }
        }
        return null;
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
    /**
     * 전쟁 페이지 테이블에서 참여 길드 목록 추출 (다크/라이트 모드 호환 패치)
     */
    function extractWarGuildsFromPage() {
        const guildSet = new Set();

        try {
            // [수정됨] 테마별 선택자들을 배열로 관리하여 순차적으로 찾습니다.
            const targetSelectors = [
                ".MuiPaper-root.css-1kukkbt .war-interactive-area .MuiBox-root.css-yuipcy",
                ".MuiPaper-root.css-1mg2w7 .war-interactive-area .MuiBox-root.css-yuipcy",
                ".war-interactive-area > div.MuiBox-root"
            ];

            let warTable = null;

            // 유효한 테이블 컨테이너 찾기
            for (const selector of targetSelectors) {
                const el = document.querySelector(selector);
                if (el) {
                    warTable = el;
                    // addLog(`길드 목록 컨테이너 찾음: ${selector}`, 'info'); // 디버깅용
                    break;
                }
            }

            if (warTable) {
                // 🔹 대표적인 길드명 위치 (MuiChip, Typography 등)
                const guildElements = warTable.querySelectorAll(
                    ".MuiChip-label, .MuiTypography-root, .MuiBox-root"
                );

                guildElements.forEach((el) => {
                    const text = el.textContent.trim();
                    // 숫자만 있거나, 너무 짧/긴 텍스트, "VS" 등 제외
                    if (text && text.length >= 2 && text.length <= 20 && !/^\d+$/.test(text)) {
                        guildSet.add(text);
                    }
                });
            } else {
                // 컨테이너를 못 찾았더라도 페이지 전체에서 'war-interactive-area' 근처를 훑어보는 비상 로직
                const fallbackArea = document.querySelector('.war-interactive-area');
                if (fallbackArea) {
                    fallbackArea.querySelectorAll(".MuiChip-label").forEach(el => guildSet.add(el.textContent.trim()));
                }
            }

        } catch (error) {
            console.error("길드 목록 추출 중 오류:", error);
        }

        // 🔸 결과 정리
        const guilds = Array.from(guildSet)
            .filter((g) => g && g !== "무소속" && !g.includes("VS"))
            .map((g) => g.trim());

        if (guilds.length === 0) {
            addLog("⚠️ 전쟁 페이지에서 길드 목록을 찾을 수 없습니다. (선택자 불일치)", "warn");
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

        // UI 새로고침 및 플레이어 정보 업데이트
        setTimeout(() => {
            const savedLogs = loadStoredLogs();
            // 길드 정보 업데이트 후 로그 재처리 (플레이어 길드 할당)
            updatePlayerGuildsInLogs(savedLogs);
            processAndDisplayLogs(savedLogs);
            addLog('길드별 보기 렌더링 최신화 완료 (플레이어 정보 업데이트됨)', 'success');
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

        // 1. 길드 데이터 초기화
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

        // 2. 로그를 시간 오름차순(과거->미래)으로 정렬하여 흐름 파악
        const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

        // 3. 중복 방지를 위한 마지막 행동 추적 맵
        const lastActionMap = {};

        // 시간 문자열에서 '초' 단위 시간을 추출하는 헬퍼 함수
        const getTimeInSeconds = (dateStr) => {
            const match = dateStr.match(/(\d{1,2}):(\d{2}):(\d{2})/);
            if (!match) return 0;
            return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        };

        sortedLogs.forEach(log => {
            if (!log.isAttack) return;

            // 공격자 데이터 가져오기 (없으면 생성)
            let attackerGuild = guildStatus[log.guildName];
            if (!attackerGuild) {
                guildStatus[log.guildName] = {};
                attackerGuild = guildStatus[log.guildName];
            }

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

            // =====================================================
            // [핵심 수정] 요새 파괴 -> 마을 점령 중복 카운트 방지
            // =====================================================
            let isDuplicate = false;
            const uniqueKey = `${log.guildName}_${log.memberName}`; // 길드+이름으로 식별
            const currentTime = getTimeInSeconds(log.date);

            if (lastActionMap[uniqueKey]) {
                const lastLog = lastActionMap[uniqueKey].log;
                const lastTime = lastActionMap[uniqueKey].time;

                // 1. 이전 행동과 2초 이내의 아주 짧은 간격인지 확인
                if (Math.abs(currentTime - lastTime) <= 2) {
                    // 2. 하나는 '요새', 하나는 '요새가 아님(마을)'인 경우 -> 세트 행동으로 간주
                    if (lastLog.isFortress !== log.isFortress) {
                        isDuplicate = true;
                    }
                }
            }

            // 현재 행동을 마지막 행동으로 기록 (중복이든 아니든 시간 갱신)
            lastActionMap[uniqueKey] = { log: log, time: currentTime };

            // 중복된 행동(세트 행동)이면 통계에 반영하지 않고 건너뜀
            if (isDuplicate) {
                return;
            }
            // =====================================================

            // 공격권 차감 (0 이하로도 내려가도록 조건문 제거함)
            attackerData.attackRemaining--;

            if (log.isSuccess) {
                attackerData.attackSuccess++;
            } else {
                attackerData.attackFail++;
            }

            // 수비자 처리 로직
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
        const stored = localStorage.getItem(GUILD_STORAGE_KEY);
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
        const stored = localStorage.getItem(GUILD_STORAGE_KEY);
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
                let attackerGuild = cells[4].textContent.trim();

                // 공격자 길드명이 없거나 '길드 X'인 경우, 길드 데이터에서 검색
                if (!attackerGuild || attackerGuild === '길드 X') {
                    const foundGuild = findGuildByMember(guildData, attackerName);
                    if (foundGuild) {
                        attackerGuild = foundGuild;
                    } else {
                        attackerGuild = '길드 X';
                    }
                }

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

            // 플레이어 길드 정보 업데이트
            const updatedLogs = updatePlayerGuildsInLogs(mergedLogs);
            saveStoredLogs(updatedLogs);

            // 길드 데이터 체크
            const guildData = loadGuildData();
            if (!guildData) {
                addLog('⚠️ 길드 정보가 없어 분석을 건너뜁니다.', 'error');
                // 로그는 저장했지만 분석은 하지 않음
                return;
            }

            processAndDisplayLogs(updatedLogs);
        } else {
            addLog('파싱된 로그 없음', 'info');
            if (currentLogs.length > 0) {
                // 기존 로그 업데이트
                const updatedLogs = updatePlayerGuildsInLogs(currentLogs);
                saveStoredLogs(updatedLogs);
                const guildData = loadGuildData();
                if (guildData) {
                    processAndDisplayLogs(updatedLogs);
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

// =====================================================
    // 2. 통계 계산 로직 (상세 데이터 추가 수집)
    // =====================================================
    function calculateStatistics(logs) {
        if (!logs || logs.length === 0) return null;

        const stats = {
            topAttacker: { name: '-', guild: '-', count: 0 },
            topDefender: { name: '-', guild: '-', count: 0 },
            worstAttacker: { name: '-', guild: '-', count: 0 },
            pacifist: { name: '-', guild: '-', count: 0 },
            // [수정] 라이벌 상세 정보 (승수 포함)
            nemesis: { p1: '-', p2: '-', p1Wins: 0, p2Wins: 0, count: 0 },
            hottestVillage: { name: '-', count: 0 },
            fortressVillage: { name: '-', count: 0 },
            ironWallGuild: { name: '-', rate: 0, win: 0, total: 0 },
            spearGuild: { name: '-', win: 0, total: 0 },
            fireGuild: { name: '-', fail: 0, total: 0 },
            mostActiveGuild: { name: '-', count: 0, att: 0, def: 0 },
            capturedVillages: []
        };

        const attackers = {};
        const defenders = {};
        const villageAttacks = {};
        const fortressAttacks = {};
        const rivalries = {}; // { key: { p1, p2, p1Wins, p2Wins, total } }
        const guildStats = {};
        const villageOwner = {};

        const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

        sortedLogs.forEach(log => {
            if (!log.isAttack) return;

            // 개인 통계
            const attKey = log.memberName;
            if (!attackers[attKey]) attackers[attKey] = { success: 0, fail: 0, guild: log.guildName };
            if (log.isSuccess) attackers[attKey].success++; else attackers[attKey].fail++;

            if (log.defenderName && !log.isFortress) {
                const defKey = log.defenderName;
                if (!defenders[defKey]) defenders[defKey] = { success: 0, fail: 0, guild: log.defenderGuild || '길드 X' };
                if (log.isSuccess) defenders[defKey].fail++; else defenders[defKey].success++;

                // [수정] 라이벌 승패 로직
                // 이름을 정렬해서 항상 같은 키가 되도록 함 (예: '가 vs 나', '나 vs 가' 통일)
                const names = [log.memberName, log.defenderName].sort();
                const p1 = names[0];
                const p2 = names[1];
                const pairKey = `${p1} vs ${p2}`;

                if (!rivalries[pairKey]) {
                    rivalries[pairKey] = { p1, p2, p1Wins: 0, p2Wins: 0, total: 0 };
                }
                rivalries[pairKey].total++;

                // 승자 판별
                // 공격 성공시: 공격자가 승리 / 방어 성공시: 수비자가 승리
                const winner = log.isSuccess ? log.memberName : log.defenderName;

                if (winner === p1) rivalries[pairKey].p1Wins++;
                else rivalries[pairKey].p2Wins++;
            }

            // 마을/요새
            villageAttacks[log.village] = (villageAttacks[log.village] || 0) + 1;
            if (log.isFortress) fortressAttacks[log.village] = (fortressAttacks[log.village] || 0) + 1;

            // 길드
            const attGuild = log.guildName;
            if (attGuild && attGuild !== '길드 X') {
                if (!guildStats[attGuild]) guildStats[attGuild] = { attWin: 0, attFail: 0, defWin: 0, defFail: 0 };
                if (log.isSuccess) guildStats[attGuild].attWin++; else guildStats[attGuild].attFail++;
            }
            const defGuild = log.defenderGuild;
            if (defGuild && defGuild !== '길드 X' && !log.isFortress) {
                if (!guildStats[defGuild]) guildStats[defGuild] = { attWin: 0, attFail: 0, defWin: 0, defFail: 0 };
                if (log.isSuccess) guildStats[defGuild].defFail++; else guildStats[defGuild].defWin++;
            }

            // 점령
            if (log.isCaptureResult) {
                const prev = villageOwner[log.village] || '-';
                villageOwner[log.village] = log.guildName;
                stats.capturedVillages.push({
                    village: log.village, from: prev, to: log.guildName,
                    time: log.date.match(/(\d{2}:\d{2}:\d{2})/)?.[0] || ''
                });
            } else if (log.isSuccess && !log.isFortress && !villageOwner[log.village]) {
                if (log.defenderGuild && log.defenderGuild !== '길드 X') {
                    villageOwner[log.village] = log.defenderGuild;
                }
            }
        });

        // 결과 분석
        for (const [name, data] of Object.entries(attackers)) {
            if (data.success > stats.topAttacker.count) stats.topAttacker = { name, guild: data.guild, count: data.success };
            if (data.fail > stats.worstAttacker.count) stats.worstAttacker = { name, guild: data.guild, count: data.fail };
            if (data.success === 0 && data.fail >= 3 && data.fail > stats.pacifist.count) stats.pacifist = { name, guild: data.guild, count: data.fail };
        }
        for (const [name, data] of Object.entries(defenders)) {
            if (data.success > stats.topDefender.count) stats.topDefender = { name, guild: data.guild, count: data.success };
        }

        // [수정] 라이벌 최댓값 찾기
        for (const [key, data] of Object.entries(rivalries)) {
            if (data.total > stats.nemesis.count) {
                stats.nemesis = {
                    p1: data.p1,
                    p2: data.p2,
                    p1Wins: data.p1Wins,
                    p2Wins: data.p2Wins,
                    count: data.total
                };
            }
        }

        for (const [v, c] of Object.entries(villageAttacks)) {
            if (c > stats.hottestVillage.count) stats.hottestVillage = { name: v, count: c };
        }
        for (const [v, c] of Object.entries(fortressAttacks)) {
            if (c > stats.fortressVillage.count) stats.fortressVillage = { name: v, count: c };
        }

        for (const [gName, d] of Object.entries(guildStats)) {
            const attTotal = d.attWin + d.attFail;
            const defTotal = d.defWin + d.defFail;
            const totalActivity = attTotal + defTotal;

            if (d.attWin > stats.spearGuild.win) stats.spearGuild = { name: gName, win: d.attWin, total: attTotal };
            if (d.attFail > stats.fireGuild.fail) stats.fireGuild = { name: gName, fail: d.attFail, total: attTotal };

            if (defTotal >= 5) {
                const rate = (d.defWin / defTotal) * 100;
                if (rate > stats.ironWallGuild.rate || (rate === stats.ironWallGuild.rate && defTotal > stats.ironWallGuild.total)) {
                    stats.ironWallGuild = { name: gName, rate: rate, win: d.defWin, total: defTotal };
                }
            }
            if (totalActivity > stats.mostActiveGuild.count) {
                stats.mostActiveGuild = { name: gName, count: totalActivity, att: attTotal, def: defTotal };
            }
        }
        return stats;
    }

// =====================================================
    // 3. 뷰 생성 (플레이어 이름 옆에 길드명 표시)
    // =====================================================
    function createStatisticsView(logs, isToday = false) {
        const stats = calculateStatistics(logs);
        if (!stats) return '<div class="empty-placeholder"><div class="empty-text">데이터 부족</div></div>';

        const title = isToday ? '오늘의 하이라이트' : '지난 전쟁 하이라이트';

        const mkCard = (icon, label, color, content, isFullWidth = false) => `
            <div class="stat-card ${isFullWidth ? 'span-2' : ''}" style="--card-color: ${color};">
                <div class="stat-header">
                    <span class="stat-title">${label}</span>
                    <span class="stat-icon">${icon}</span>
                </div>
                ${content}
            </div>
        `;

        // [수정됨] 이름 (길드명) 형태로 변경
        const pInfo = (d, sub) => `
            <div class="stat-value">
                ${d.name} <span style="font-size:11px; color:#aaa; font-weight:normal;">(${d.guild})</span>
            </div>
            <div class="stat-sub">${d.count}${sub}</div>
        `;

        const gInfo = (d, sub) => `<div class="stat-value">${d.name}</div><div class="stat-sub">${sub}</div>`;

        return `
            <div style="padding: 15px; height: 100%; overflow-y:auto;">
                <h3 style="margin: 0 0 15px 0; color: #fff; font-size: 16px; text-align: center;">${title}</h3>
                
                <div class="stat-grid">
                    ${mkCard('🏆', '공격왕', '#ffd700', stats.topAttacker.count > 0 ? pInfo(stats.topAttacker, '승') : '<span style="color:#555">-</span>')}
                    ${mkCard('🛡️', '방어왕', '#42a5f5', stats.topDefender.count > 0 ? pInfo(stats.topDefender, '방어') : '<span style="color:#555">-</span>')}

                    ${mkCard('💔', '최다 실패', '#ef5350', stats.worstAttacker.count > 0 ? pInfo(stats.worstAttacker, '실패') : '<span style="color:#555">-</span>')}
                    ${mkCard('🕊️', '평화주의자', '#81c784', stats.pacifist.count > 0 ? pInfo(stats.pacifist, '패 (0승)') : '<div class="stat-sub" style="color:#555">대상 없음</div>')}

        ${stats.nemesis.count > 0
            ? mkCard('⚔️', '숙명의 라이벌', '#ab47bc',
                `<div style="display:flex; justify-content:space-between; align-items:center; font-size:14px; font-weight:bold; color:#fff;">
                                <span>${stats.nemesis.p1} </span>
                                <span style="font-size:10px; color:#aaa; margin:0 5px;">VS</span>
                                <span>${stats.nemesis.p2} </span>
                            </div>
                            <div class="stat-sub" style="text-align:right;">( ${stats.nemesis.p1Wins} : ${stats.nemesis.p2Wins} )    총 ${stats.nemesis.count}회 교전</div>`, true)
            : ''}
                    
                    ${mkCard('🔥', '최다 접전지', '#ff7043', stats.hottestVillage.count > 0 ? `<div class="stat-value">${stats.hottestVillage.name}</div><div class="stat-sub">${stats.hottestVillage.count}회 전투</div>` : '<span style="color:#555">-</span>')}
                    ${mkCard('🏰', '요새 발견', '#7e57c2', stats.fortressVillage.count > 0 ? `<div class="stat-value">${stats.fortressVillage.name}</div><div class="stat-sub">${stats.fortressVillage.count}회 공격</div>` : '<div class="stat-sub">발견 안됨</div>')}

                    ${mkCard('🧱', '철벽 길드', '#90caf9', stats.ironWallGuild.total > 0 ? gInfo(stats.ironWallGuild, `방어율 ${Math.round(stats.ironWallGuild.rate)}% <span style="color:#aaa; font-size:10px;">(${stats.ironWallGuild.win}/${stats.ironWallGuild.total}회 방어)</span>`) : '<span style="color:#555">-</span>')}
                    
                    ${mkCard('🎋', '죽창 길드', '#c6ff00', stats.spearGuild.total > 0 ? gInfo(stats.spearGuild, `공격 성공 ${stats.spearGuild.win}회 <span style="color:#aaa; font-size:10px;">(총 ${stats.spearGuild.total}회 시도)</span>`) : '<span style="color:#555">-</span>')}

                    ${mkCard('📢', '최다 참여 길드', '#ffca28', stats.mostActiveGuild.count > 0 ? gInfo(stats.mostActiveGuild, `총 ${stats.mostActiveGuild.count}전 <span style="color:#aaa; font-size:10px;">(공${stats.mostActiveGuild.att} / 방${stats.mostActiveGuild.def})</span>`) : '<span style="color:#555">-</span>')}
                    
                    ${mkCard('🧨', '불장난 길드', '#ffab91', stats.fireGuild.total > 0 ? gInfo(stats.fireGuild, `공격 실패 ${stats.fireGuild.fail}회 <span style="color:#aaa; font-size:10px;">(총 ${stats.fireGuild.total}회 시도)</span>`) : '<span style="color:#555">-</span>')}

                    ${stats.capturedVillages.length > 0 ? `
                        <div class="span-2" style="margin-top:5px;">
                            <div style="font-size:11px; color:#777; margin-bottom:5px; border-bottom:1px solid #333; padding-bottom:3px;">🚩 마을 점령 로그</div>
                            ${stats.capturedVillages.map(c => {
            const isTakeback = c.from !== '-';
            return `<div style="display:flex; gap:8px; padding:4px 0; border-bottom:1px dashed #333; font-size:12px; align-items:center;">
                                    <span style="color:#666; font-size:10px;">${c.time}</span>
                                    <span style="color:${isTakeback?'#ffb74d':'#69f0ae'}; font-weight:bold;">${c.to}</span>
                                    <span style="color:#aaa;">${c.village}</span>
                                    <span style="font-size:10px; color:#555;">${isTakeback ? '(탈환)' : '(점령)'}</span>
                                </div>`;
        }).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    function generateDetailView(guildStatus, villageStatus) {
        if (!selectedGuild && !selectedVillage) {
            const savedLogs = loadStoredLogs();

            if (savedLogs.length > 0) {
                const now = new Date();
                const currentHour = now.getHours();
                const isWarTime = currentHour >= 21; // 대략적인 전쟁 시간
                const statsView = createStatisticsView(savedLogs, isWarTime);

                return `<div style="padding: 20px; height: 100%;">${statsView}</div>`;
            } else {
                return `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #666;">
                    <div style="font-size: 40px; margin-bottom: 10px;">📊</div>
                    <div style="font-size: 16px;">수집된 데이터가 없습니다</div>
                    <div style="font-size: 12px; margin-top: 5px;">로그 수집 버튼을 눌러주세요</div>
                </div>`;
            }
        }

        if (currentView === 'guild' && selectedGuild) {
            return createGuildDetailTable(selectedGuild, guildStatus[selectedGuild]);
        } else if (currentView === 'village' && selectedVillage) {
            return createVillageDetailTable(selectedVillage, villageStatus[selectedVillage]);
        }
        return '';
    }

    function createGuildCards(guildStatus) {
        let html = `
        <div class="lanis-card total-card ${selectedGuild === null ? 'active' : ''}" data-action="reset">
            <div class="card-title" style="font-size:13px;">📊 전체 요약 보기</div>
        </div>
    `;

        const sortedGuilds = Object.keys(guildStatus).sort((a, b) => {
            return Object.keys(guildStatus[b]).length - Object.keys(guildStatus[a]).length;
        });

        for (const guildName of sortedGuilds) {
            const isSelected = selectedGuild === guildName;
            const memberCount = Object.keys(guildStatus[guildName]).length;

            html += `
            <div class="lanis-card ${isSelected ? 'active' : ''}" data-guild="${guildName}">
                <div class="card-title">${guildName}</div>
                <div class="card-sub">
                    <span>${memberCount}명</span>
                    ${isSelected ? '<span style="color:#7986cb;">●</span>' : ''}
                </div>
            </div>
        `;
        }
        return html;
    }

    function createVillageCards(villageStatus) {
        let html = `
    `;

        const sortedVillages = Object.keys(villageStatus).sort((a, b) => {
            return villageStatus[b].totalAttacks - villageStatus[a].totalAttacks;
        });

        for (const villageName of sortedVillages) {
            const stats = villageStatus[villageName];
            const isSelected = selectedVillage === villageName;
            const owner = villageOwnership[villageName];

            html += `
            <div class="lanis-card ${isSelected ? 'active' : ''}" data-village="${villageName}">
                <div class="card-title">${villageName}</div>
                <div class="card-sub" style="margin-bottom: 4px;">
                    ${owner ? `<span style="color:#66bb6a;">👑 ${owner.guildName}</span>` : '<span style="color:#757575;">⚪ 중립</span>'}
                </div>
                <div style="font-size: 10px; display:flex; gap:6px;">
                    <span style="color:#66bb6a;">성공 ${stats.successAttacks}</span>
                    <span style="color:#ef5350;">실패 ${stats.failAttacks}</span>
                </div>
            </div>
        `;
        }
        return html;
    }

    function createGuildDetailTable(guildName, members) {
        const villageStats = {};
        const logs = guildLogs[guildName] || [];

        // 마을 통계 계산
        logs.forEach(log => {
            if (!villageStats[log.village]) villageStats[log.village] = { attacking: 0, defending: 0 };
            if (log.isDefender) villageStats[log.village].defending++;
            else villageStats[log.village].attacking++;
        });

        // 상단 배지 (활동 많은 마을 순)
        const badges = Object.entries(villageStats)
            .sort((a, b) => (b[1].attacking + b[1].defending) - (a[1].attacking + a[1].defending))
            .map(([vName, stats]) => {
                let className = '';
                if (stats.attacking > 0 && stats.defending > 0) className = 'bg-clash';
                else if (stats.attacking > 0) className = 'bg-attack';
                else className = 'bg-defend';
                return `<span class="badge ${className}">${vName} (공${stats.attacking}/방${stats.defending})</span>`;
            }).join('');

        // 🔹 정렬 로직 적용
        const { key, order } = sortState.guild;
        const sortedMembers = Object.entries(members).sort((a, b) => {
            let valA, valB;

            // 정렬 키에 따른 값 추출
            if (key === 'nickname') {
                valA = a[0]; valB = b[0];
            } else {
                valA = a[1][key]; valB = b[1][key];
            }

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        // 정렬 아이콘 헬퍼
        const getIcon = (colKey) => {
            if (key !== colKey) return '<span style="color:#444">⇅</span>';
            return order === 'asc' ? '▲' : '▼';
        };

        // 헤더 스타일 (클릭 가능 표시)
        const thStyle = "cursor: pointer; user-select: none;";

        let html = `
        <div class="table-container">
            <div class="detail-header">
                <h3>${guildName}</h3>
                <div class="detail-badges">${badges || '<span style="color:#666; font-size:12px;">전투 기록 없음</span>'}</div>
            </div>
            
            <table class="lanis-table sortable-table">
                <thead>
                    <tr>
                        <th class="txt-left border-r" style="width: 120px; ${thStyle}" data-sort-key="nickname">
                            길드원 ${getIcon('nickname')}
                        </th>
                        <th class="txt-center" style="width: 60px; ${thStyle}" data-sort-key="attackRemaining">
                            공격권 ${getIcon('attackRemaining')}
                        </th>
                        <th class="txt-center border-r" style="width: 60px; ${thStyle}" data-sort-key="defenseRemaining">
                            수비권 ${getIcon('defenseRemaining')}
                        </th>
                        <th class="txt-right" style="${thStyle}" data-sort-key="attackSuccess">
                            공격성공 ${getIcon('attackSuccess')}
                        </th>
                        <th class="txt-right border-r" style="${thStyle}" data-sort-key="attackFail">
                            공격실패 ${getIcon('attackFail')}
                        </th>
                        <th class="txt-right" style="${thStyle}" data-sort-key="defenseSuccess">
                            수비성공 ${getIcon('defenseSuccess')}
                        </th>
                        <th class="txt-right" style="${thStyle}" data-sort-key="defenseFail">
                            수비실패 ${getIcon('defenseFail')}
                        </th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const [memberName, stats] of sortedMembers) {
            const fmt = (val, colorClass) => val > 0 ? `<span class="${colorClass}">${val}</span>` : `<span class="c-dim">-</span>`;

            html += `
            <tr>
                <td class="txt-left border-r" style="font-weight:bold; color:#eee;">${memberName}</td>
                <td class="txt-center" style="color:#90caf9;">${stats.attackRemaining}</td>
                <td class="txt-center border-r" style="color:#ffcc80;">${stats.defenseRemaining}</td>
                <td class="txt-center">${fmt(stats.attackSuccess, 'c-success')}</td>
                <td class="txt-center border-r">${fmt(stats.attackFail, 'c-fail')}</td>
                <td class="txt-center">${fmt(stats.defenseSuccess, 'c-success')}</td>
                <td class="txt-center">${fmt(stats.defenseFail, 'c-fail')}</td>
            </tr>
            `;
        }

        html += '</tbody></table></div>';
        return html;
    }

    function createVillageDetailTable(villageName, stats) {
        const owner = villageOwnership[villageName];
        let statusHtml = '';

        if (owner) {
            statusHtml = `
                <div style="background: rgba(76, 175, 80, 0.15); border: 1px solid #2e7d32; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="color: #66bb6a; font-size: 16px; font-weight: bold; margin-bottom: 5px;">
                        👑 현재 점령: ${owner.guildName}
                    </div>
                    <div style="font-size: 12px; color: #aaa;">
                        <span style="color:#81c784;">${owner.time} 점령</span>
                        ${owner.previousOwner !== owner.guildName ? ` <span style="color:#666;">|</span> <span style="color:#ffb74d;">탈환: ${owner.previousOwner} → ${owner.guildName}</span>` : ''}
                    </div>
                </div>
            `;
        } else {
            statusHtml = `
                <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid #444; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="color: #bdbdbd; font-size: 16px; font-weight: bold;">⚔️ 중립 지역</div>
                </div>
            `;
        }

        // 🔹 정렬 로직 적용
        const { key, order } = sortState.village;
        const sortedGuilds = Object.entries(stats.guilds).sort((a, b) => {
            let valA, valB;
            const statsA = a[1];
            const statsB = b[1];

            if (key === 'guildName') {
                valA = a[0]; valB = b[0];
            } else if (key === 'rate') {
                // 성공률 계산
                valA = statsA.attacks > 0 ? (statsA.success / statsA.attacks) : 0;
                valB = statsB.attacks > 0 ? (statsB.success / statsB.attacks) : 0;
            } else {
                valA = statsA[key]; valB = statsB[key];
            }

            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });

        const getIcon = (colKey) => {
            if (key !== colKey) return '<span style="color:#444">⇅</span>';
            return order === 'asc' ? '▲' : '▼';
        };
        const thStyle = "cursor: pointer; user-select: none;";

        let html = `
            <div class="table-container">
                <div class="detail-header">
                    <h3>${villageName}</h3>
                </div>
                ${statusHtml}
                
                <div style="display:flex; justify-content:space-around; background:#1e1e1e; padding:10px; border-radius:6px; margin-bottom:15px; border:1px solid #333;">
                    <div class="txt-center"><span class="c-dim">총 공격</span><br><strong style="color:#fff; font-size:16px;">${stats.totalAttacks}</strong></div>
                    <div class="txt-center"><span class="c-success">성공</span><br><strong style="color:#66bb6a; font-size:16px;">${stats.successAttacks}</strong></div>
                    <div class="txt-center"><span class="c-fail">실패</span><br><strong style="color:#ef5350; font-size:16px;">${stats.failAttacks}</strong></div>
                </div>

                <h4 style="color:#ddd; margin: 0 0 10px 0;">길드별 공격 현황</h4>
                <table class="lanis-table sortable-table">
                    <thead>
                        <tr>
                            <th class="txt-left" style="${thStyle}" data-sort-key="guildName">
                                길드명 ${getIcon('guildName')}
                            </th>
                            <th class="txt-center" style="${thStyle}" data-sort-key="attacks">
                                총 공격 ${getIcon('attacks')}
                            </th>
                            <th class="txt-center" style="${thStyle}" data-sort-key="success">
                                성공 ${getIcon('success')}
                            </th>
                            <th class="txt-center" style="${thStyle}" data-sort-key="fail">
                                실패 ${getIcon('fail')}
                            </th>
                            <th class="txt-center" style="${thStyle}" data-sort-key="rate">
                                성공률 ${getIcon('rate')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        for (const [guildName, guildStats] of sortedGuilds) {
            const isOwner = owner && owner.guildName === guildName;
            const rate = guildStats.attacks > 0 ? Math.round((guildStats.success / guildStats.attacks) * 100) : 0;

            html += `
                <tr style="${isOwner ? 'background: rgba(76, 175, 80, 0.1);' : ''}">
                    <td class="txt-left" style="color: ${isOwner ? '#66bb6a' : '#eee'}; font-weight: ${isOwner ? 'bold' : 'normal'};">
                        ${guildName} ${isOwner ? '👑' : ''}
                    </td>
                    <td class="txt-center" style="color:#ddd;">${guildStats.attacks}</td>
                    <td class="txt-center c-success">${guildStats.success}</td>
                    <td class="txt-center c-fail">${guildStats.fail}</td>
                    <td class="txt-center" style="color:#aaa; font-size:11px;">${rate}%</td>
                </tr>
            `;
        }

        html += '</tbody></table></div>';
        return html;
    }
    function attachTableSortListeners(guildStatus, villageStatus) {
        const headers = document.querySelectorAll('.sortable-table th[data-sort-key]');

        headers.forEach(th => {
            th.addEventListener('click', () => {
                const sortKey = th.getAttribute('data-sort-key');
                const targetState = currentView === 'guild' ? sortState.guild : sortState.village;

                // 이미 같은 키로 정렬 중이면 순서 반전, 아니면 내림차순(desc)으로 시작
                if (targetState.key === sortKey) {
                    targetState.order = targetState.order === 'asc' ? 'desc' : 'asc';
                } else {
                    targetState.key = sortKey;
                    targetState.order = 'desc'; // 기본적으로 숫자가 큰게 위로 오도록

                    // 이름 정렬일 경우 오름차순이 자연스러움
                    if (sortKey === 'nickname' || sortKey === 'guildName') {
                        targetState.order = 'asc';
                    }
                }

                // 화면 갱신
                const detailView = document.getElementById('detail-view');
                if (detailView) {
                    detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                    // 갱신 후 리스너 다시 부착 (HTML이 교체되었으므로)
                    attachTableSortListeners(guildStatus, villageStatus);
                }
            });
        });
    }
    function attachCardListeners(guildStatus, villageStatus) {
        // "전체 요약 보기" 버튼 처리
        const resetCard = document.querySelector('.lanis-card[data-action="reset"]');
        if (resetCard) {
            resetCard.addEventListener('click', () => {
                document.querySelectorAll('.lanis-card').forEach(c => c.classList.remove('active'));
                resetCard.classList.add('active');

                selectedGuild = null;
                selectedVillage = null;

                const detailView = document.getElementById('detail-view');
                if (detailView) {
                    detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                }
                updateLogDisplay();
            });
        }

        // 길드 카드 클릭
        if (currentView === 'guild') {
            document.querySelectorAll('.lanis-card[data-guild]').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.lanis-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');

                    selectedGuild = card.dataset.guild;

                    const detailView = document.getElementById('detail-view');
                    if (detailView) {
                        detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                        attachTableSortListeners(guildStatus, villageStatus);
                    }
                    updateLogDisplay();
                });
            });
        }
        // 마을 카드 클릭
        else {
            document.querySelectorAll('.lanis-card[data-village]').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.lanis-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');

                    selectedVillage = card.dataset.village;

                    const detailView = document.getElementById('detail-view');
                    if (detailView) {
                        detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
                        attachTableSortListeners(guildStatus, villageServices);
                    }
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
                ? `<div class="card-grid">${createGuildCards(guildStatus)}</div>`
                : `<div class="card-grid">${createVillageCards(villageStatus)}</div>`;

            cardContainer.innerHTML = cardsHtml;
            attachCardListeners(guildStatus, villageStatus);
            cardContainer.scrollTop = savedScroll;
        }

        const detailView = document.getElementById('detail-view');
        if (detailView) {
            detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
            attachTableSortListeners(guildStatus, villageStatus);
        }

        updateLogDisplay();
    }

    function updateStatusPopup(guildStatus, villageStatus) {
        updateLogInfoOnly();

        const cardContainer = document.getElementById('card-container');
        const detailView = document.getElementById('detail-view');

        if (cardContainer) {
            const savedScroll = cardContainer.scrollTop;

            const cardsHtml = currentView === 'guild'
                ? `<div class="card-grid">${createGuildCards(guildStatus)}</div>`
                : `<div class="card-grid">${createVillageCards(villageStatus)}</div>`;

            cardContainer.innerHTML = cardsHtml;
            attachCardListeners(guildStatus, villageStatus);
            cardContainer.scrollTop = savedScroll;
        }

        if (detailView) {
            const savedScroll = detailView.scrollTop;
            detailView.innerHTML = generateDetailView(guildStatus, villageStatus);
            attachTableSortListeners(guildStatus, villageStatus);
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
// =====================================================
    // 드래그(이동) 및 리사이즈(크기조절) 로직
    // =====================================================

    /**
     * 요소 이동 (헤더 드래그 시에만 작동)
     */
    function makeDraggable(element) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        const header = element.querySelector('#war-status-header');

        if (header) {
            header.onmousedown = dragMouseDown;
        }

        function dragMouseDown(e) {
            // 버튼이나 입력창 등을 클릭했을 때는 드래그 방지
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;

            e.preventDefault();
            // 시작 마우스 위치
            pos3 = e.clientX;
            pos4 = e.clientY;

            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        function elementDrag(e) {
            e.preventDefault();
            // 이동 거리 계산
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;

            // 새 위치 적용
            const newTop = (element.offsetTop - pos2);
            const newLeft = (element.offsetLeft - pos1);

            element.style.top = newTop + "px";
            element.style.left = newLeft + "px";

            // transform 초기화 (위치 계산 꼬임 방지)
            element.style.transform = "none";
            element.style.right = "auto";

            // 위치 기억 (전역 변수 업데이트)
            popupPosition.top = newTop + "px";
            popupPosition.left = newLeft + "px";
            popupPosition.right = null;
            popupPosition.transform = "none";
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    /**
     * 요소 크기 조절 (우측 하단 핸들)
     */
    function makeResizable(element) {
        const resizer = element.querySelector('#resize-handle');
        if (!resizer) return;

        resizer.addEventListener('mousedown', function(e) {
            e.preventDefault();

            // 초기 크기 및 마우스 위치 저장
            const startX = e.clientX;
            const startY = e.clientY;
            const startWidth = parseInt(document.defaultView.getComputedStyle(element).width, 10);
            const startHeight = parseInt(document.defaultView.getComputedStyle(element).height, 10);

            function doDrag(e) {
                // 새 크기 계산
                const newWidth = startWidth + e.clientX - startX;
                const newHeight = startHeight + e.clientY - startY;

                // 최소 크기 제한 (너무 작아지지 않도록)
                if (newWidth > 300) {
                    element.style.width = newWidth + 'px';
                    popupPosition.width = newWidth + 'px'; // 상태 저장
                }
                if (newHeight > 200) {
                    element.style.height = newHeight + 'px';
                    popupPosition.height = newHeight + 'px'; // 상태 저장
                }
            }

            function stopDrag() {
                window.removeEventListener('mousemove', doDrag);
                window.removeEventListener('mouseup', stopDrag);
            }

            window.addEventListener('mousemove', doDrag);
            window.addEventListener('mouseup', stopDrag);
        });
    }
    function createStatusPopup(guildStatus, villageStatus) {
        injectCustomStyles();

        const existingPopup = document.getElementById('war-status-popup');

        // 기존 팝업이 있으면 위치/크기 정보를 기억하고 삭제
        if (existingPopup) {
            const rect = existingPopup.getBoundingClientRect();
            popupPosition = {
                top: rect.top + "px",
                left: rect.left + "px",
                right: null,
                transform: "none",
                width: rect.width + "px",
                height: isMinimized ? 'auto' : (rect.height + "px") // 높이 기억
            };
            existingPopup.remove();
        }

        const popup = document.createElement('div');
        popup.id = 'war-status-popup';

        // 위치 및 크기 스타일 설정
        const posStyle = popupPosition.right
            ? `top: ${popupPosition.top}; right: ${popupPosition.right}; transform: ${popupPosition.transform};`
            : `top: ${popupPosition.top}; left: ${popupPosition.left}; transform: ${popupPosition.transform};`;

        const width = popupPosition.isMobile ? '95vw' : (popupPosition.width || '1050px');
        const height = popupPosition.isMobile
            ? (isMinimized ? 'auto' : '85vh')
            : (isMinimized ? 'auto' : (popupPosition.height || '750px'));

        popup.style.cssText = `position: fixed; ${posStyle} width: ${width}; height: ${height}; z-index: 10000;`;

        // 날짜 및 로그 정보
        const now = new Date();
        const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
        const logCount = window.warLogInfo ? window.warLogInfo.totalCount : 0;
        const logStatusText = window.warLogInfo
            ? `<span style="color:#aaa;">로그 ${logCount}개</span>`
            : `<span style="color:#666;">대기 중...</span>`;

        // HTML 구성
        let html = `
        <div id="war-status-header" class="lanis-header" style="cursor: move;"> <div class="lanis-title">
                <h2>
                    오늘의 전쟁 현황 
                    ${isCollecting ? '<span style="color:#66bb6a; font-size:11px; background:rgba(102,187,106,0.1); padding:2px 6px; border-radius:4px;">● 수집중</span>' : ''}
                </h2>
                <p>${dateStr} | ${logStatusText}</p>
            </div>
            
            <div class="lanis-btn-group">
                <button id="help-btn" class="lanis-btn btn-purple" title="도움말">❓</button>
                <button id="reset-data-btn" class="lanis-btn btn-red" title="초기화">🗑️</button>
                <div style="width:1px; height:16px; background:#444; margin:0 4px;"></div>
                <button id="auto-collect-missing-btn" class="lanis-btn btn-orange">🔄 길드수집</button>
                <button id="manual-collect-btn" class="lanis-btn btn-blue">로그 수동</button>
                <button id="auto-collect-btn" class="lanis-btn btn-green">${isCollecting ? '⏹ 중지' : '▶ 자동'}</button>
                <button id="minimize-btn" class="lanis-btn btn-gray" title="최소화">_</button>
            </div>
        </div>
        `;

        if (!isMinimized) {
            html += `
            <div class="lanis-body">
                <div class="lanis-sidebar">
                    <div class="sidebar-tabs">
                        <button id="guild-view-btn" class="tab-btn ${currentView === 'guild' ? 'active' : ''}">길드별</button>
                        <button id="village-view-btn" class="tab-btn ${currentView === 'village' ? 'active' : ''}">마을별</button>
                    </div>
             <div id="card-container" class="card-container">
    <div class="card-grid">
        ${currentView === 'guild' ? createGuildCards(guildStatus) : createVillageCards(villageStatus)}
    </div>
</div>
                </div>

                <div class="lanis-content">
                    <div id="detail-view" class="detail-view">
                        ${generateDetailView(guildStatus, villageStatus)}
                    </div>
                    
                    <div class="log-panel">
                        <div class="log-header">
                            <span>실시간 로그</span>
                            <span style="font-weight:normal; font-size:10px; opacity:0.7;">최근 100개</span>
                        </div>
                        <div id="war-log-container" class="log-body"></div>
                    </div>
                </div>
            </div>
            <div id="resize-handle" style="
                position: absolute; bottom: 0; right: 0; width: 20px; height: 20px;
                cursor: nwse-resize; z-index: 100001;
                background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 50%);
                border-bottom-right-radius: 12px;
            "></div>
            `;
        }

        popup.innerHTML = html;
        document.body.appendChild(popup);

        // [중요] 드래그 및 리사이즈 기능 활성화
        makeDraggable(popup);   // 헤더로 이동
        if (!isMinimized) {
            makeResizable(popup); // 핸들로 크기 조절
        }

        // 초기화 및 이벤트 연결
        setTimeout(() => {
            updateGuildCollectButton(totalNeed);
            attachPopupEventListeners(guildStatus, villageStatus);
            updateLogDisplay();

            // 플레이스홀더 체크
            const detailView = document.getElementById('detail-view');
            if(detailView && !detailView.innerHTML.trim()) {
                detailView.innerHTML = `
                    <div class="empty-placeholder">
                        <div class="empty-icon">🛡️</div>
                        <div class="empty-text">왼쪽 목록에서<br>길드나 마을을 선택하세요</div>
                    </div>
                `;
            }
        }, 50);
    }
    // 이벤트 리스너 연결 헬퍼 함수
    function attachPopupEventListeners(guildStatus, villageStatus) {
        // 도움말
        const helpBtn = document.getElementById('help-btn');
        if (helpBtn) helpBtn.onclick = () => {
            addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
            addLog('📖 전쟁 트래커 사용 방법', 'success');
            addLog('1️⃣ 길드 정보가 없으면 "길드수집" 버튼을 눌러주세요.', 'info');
            addLog('2️⃣ 전쟁 로그 화면에서 "더보기"를 눌러 로그를 확보하세요.', 'info');
            addLog('3️⃣ "로그 수동" 또는 "▶ 자동"을 눌러 수집을 시작합니다.', 'info');
            addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
        };

        // 초기화
        const resetBtn = document.getElementById('reset-data-btn');
        if (resetBtn) resetBtn.onclick = () => {
            if (confirm('모든 데이터를 초기화하시겠습니까?')) resetStoredData();
        };

        // 수동 수집
        const manualBtn = document.getElementById('manual-collect-btn');
        if (manualBtn) manualBtn.onclick = () => {
            const guildData = loadGuildData();
            if (!guildData) {
                addLog('⚠️ 길드 정보가 없습니다. 먼저 길드 수집을 해주세요.', 'error');
                return;
            }
            addLog('수동 수집 실행', 'info');
            collectAndRender();
        };

        // 자동 수집
        const autoBtn = document.getElementById('auto-collect-btn');
        if (autoBtn) autoBtn.onclick = () => {
            if (!isCollecting) {
                const guildData = loadGuildData();
                if (!guildData) {
                    addLog('⚠️ 길드 정보가 없습니다.', 'error');
                    return;
                }
                startCollection();
                autoBtn.innerHTML = '⏹ 중지';
                autoBtn.style.background = '#ef5350'; // Red
            } else {
                stopCollection();
                autoBtn.innerHTML = '▶ 자동';
                autoBtn.style.background = '#388e3c'; // Green
            }
            // 헤더 갱신 트리거
            const headerTitle = document.querySelector('#war-status-header h2');
            if(headerTitle) headerTitle.innerHTML = `오늘의 전쟁 현황 ${isCollecting ? '<span style="color:#4caf50; font-size:12px;">● 수집중</span>' : ''}`;
        };

        // 최소화
        document.getElementById('minimize-btn').onclick = () => {
            const popup = document.getElementById('war-status-popup');
            popup.remove();
            isPopupOpen = false;
            createFloatingButton(); // 플로팅 버튼 복구
        };

        // 뷰 전환 탭
        const guildTab = document.getElementById('guild-view-btn');
        const villageTab = document.getElementById('village-view-btn');

        if (guildTab && villageTab) {
            guildTab.onclick = () => {
                currentView = 'guild';
                selectedGuild = null;
                selectedVillage = null;
                updateCardSelection(guildStatus, villageStatus);
                guildTab.classList.add('active');
                villageTab.classList.remove('active');
            };

            villageTab.onclick = () => {
                currentView = 'village';
                selectedGuild = null;
                selectedVillage = null;
                updateCardSelection(guildStatus, villageStatus);
                villageTab.classList.add('active');
                guildTab.classList.remove('active');
            };
        }

        attachCardListeners(guildStatus, villageStatus);
        attachTableSortListeners(guildStatus, villageStatus);
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
