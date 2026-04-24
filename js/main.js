document.addEventListener('DOMContentLoaded', async () => {
    const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgZpOBpn3xw59aPXznJLkXnAMBxQJ3y2VpfxKlLku12jdGvZbHVPo33T81BbuUXRUcqnLYWNvFNLMk/pub?gid=1177965804&single=true&output=csv';
    
    let engine;
    const form = document.getElementById('planner-form');
    const resultsArea = document.getElementById('results-area');
    const recommendationsContainer = document.getElementById('recommendations-container');
    const keywordCloud = document.getElementById('keyword-cloud');

    // API Key Management has been removed for Vercel Backend Security

    async function init() {
        try {
            const rawData = await fetchData();
            const processedData = processSheetData(rawData);
            
            engine = new CampaignEngine(processedData);
            
            // Populate dropdowns dynamically
            populateDropdowns(processedData);

            // Render keyword cloud
            renderKeywordCloud();
        } catch (error) {
            console.error('Error initializing app:', error);
            // alert('데이터를 불러오는 중 오류가 발생했습니다. 구글 시트 게시 상태를 확인해주세요.');
        }
    }

    async function fetchData() {
        return new Promise((resolve, reject) => {
            Papa.parse(SHEET_URL, {
                download: true,
                header: false,
                skipEmptyLines: true,
                complete: (results) => {
                    const rows = results.data;
                    // Find header row index (scanning first 10 rows)
                    let headerIndex = -1;
                    for (let i = 0; i < Math.min(10, rows.length); i++) {
                        if (rows[i].includes('고객 세그먼트') || rows[i].includes('발송매체')) {
                            headerIndex = i;
                            break;
                        }
                    }
                    
                    if (headerIndex === -1) {
                        console.error('Header row not found in the CSV');
                        resolve([]); // fallback
                        return;
                    }
                    
                    const headers = rows[headerIndex];
                    const dataRows = rows.slice(headerIndex + 1);
                    
                    const parsedData = dataRows.map(row => {
                        const obj = {};
                        headers.forEach((header, index) => {
                            // Only map non-empty headers
                            if (header && typeof header === 'string') {
                                // Keep the first occurrence of a header if duplicates exist
                                if (!(header.trim() in obj)) {
                                    obj[header.trim()] = row[index] || "";
                                }
                            }
                        });
                        return obj;
                    });
                    
                    resolve(parsedData);
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    }

    function processSheetData(data) {
        // Map sheet column names to engine keys if they differ
        return data.map(row => ({
            "발송일자": row["발송일자"] || row["날짜"] || "",
            "발송시간": row["발송시간"] || "",
            "발송매체": row["발송매체"] || row["매체"] || "",
            "고객 세그먼트": row["고객 세그먼트"] || row["세그먼트"] || "",
            "제목": row["제목"] || "",
            "내용": row["내용"] || "",
            "Info": row["Info"] || row["캠페인명"] || "",
            "오픈율": row["오픈율"] || row["CTR"] || "0%",
            "CTR": row["CTR"] || row["오픈율"] || "0%",
            "구매전환율": row["구매율"] || row["구매전환율"] || row["CVR"] || "0%"
        }));
    }

    function renderKeywordCloud() {
        keywordCloud.innerHTML = '';
        const topKeywords = engine.analyzeKeywords().slice(0, 10);
        topKeywords.forEach(kw => {
            const tag = document.createElement('span');
            tag.className = 'keyword-tag';
            tag.textContent = `#${kw.word} (Lift: +${(kw.openLift * 100).toFixed(0)}%)`;
            keywordCloud.appendChild(tag);
        });
    }
    
    // Real-time relevance score
    const purposeInput = document.getElementById('campaign-purpose');
    const relevanceBadge = document.getElementById('relevance-score');
    const scoreValue = relevanceBadge.querySelector('.score-value');

    purposeInput.addEventListener('input', () => {
        if (!engine) return;
        const score = engine.getRelevanceScore(purposeInput.value);
        if (score > 0) {
            relevanceBadge.style.display = 'flex';
            scoreValue.textContent = `${score}%`;
            
            // Dynamic color based on score
            if (score > 70) scoreValue.style.color = 'var(--success-color)';
            else if (score > 40) scoreValue.style.color = 'var(--accent-light)';
            else scoreValue.style.color = 'var(--warning-color)';
        } else {
            relevanceBadge.style.display = 'none';
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!engine) return;
        
        const btn = document.getElementById('generate-btn');
        const loader = btn.querySelector('.loader-inner');
        const btnText = btn.querySelector('span');
        const skeletons = document.getElementById('loading-skeletons');

        // Loading state
        btnText.style.display = 'none';
        loader.style.display = 'block';
        btn.disabled = true;
        resultsArea.style.display = 'block';
        recommendationsContainer.style.display = 'none';
        skeletons.style.display = 'block';
        resultsArea.scrollIntoView({ behavior: 'smooth' });

        try {
            const params = {
                isWeekend: document.getElementById('send-day').value === 'weekend',
                time: document.getElementById('send-time').value,
                segment: document.getElementById('customer-segment').value,
                medium: document.getElementById('medium').value,
                purpose: document.getElementById('campaign-purpose').value
            };

            const prompt = engine.buildPrompt(params);

            // Call Vercel Backend
            const response = await fetch(`/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt })
            });

            if (!response.ok) {
                const errJson = await response.json().catch(() => ({error: 'Unknown backend error'}));
                throw new Error(`백엔드 오류: ${errJson.error}`);
            }

            const data = await response.json();
            const rawJsonText = data.candidates[0].content.parts[0].text;
            let recs = [];
            try {
                const cleanText = rawJsonText.replace(/```json/g, '').replace(/```/g, '').trim();
                recs = JSON.parse(cleanText);
            } catch (err) {
                console.error("Failed to parse Gemini output:", rawJsonText);
                throw new Error("Invalid output format from AI (not a pure JSON array)");
            }

            renderRecommendations(recs);

        } catch (error) {
            console.error(error);
            alert('AI 생성 중 오류가 발생했습니다. API Key가 올바른지 확인해주세요.\n\n에러 내용: ' + error.message);
        } finally {
            skeletons.style.display = 'none';
            recommendationsContainer.style.display = 'grid'; // Reset to grid
            btnText.style.display = 'block';
            loader.style.display = 'none';
            btn.disabled = false;
        }
    });

    function renderRecommendations(recs) {
        recommendationsContainer.innerHTML = '';
        recs.forEach((rec, index) => {
            const card = document.createElement('div');
            card.className = 'recommendation-card';
            card.style.animationDelay = `${index * 0.1}s`;

            card.innerHTML = `
                <div class="card-label">추천 안 #${index + 1}</div>
                <button class="copy-btn" title="복사하기">
                    <i class="far fa-copy"></i> <span>Copy</span>
                </button>
                <div class="copy-area">
                    <div class="copy-title">${rec.title}</div>
                    <div class="copy-content">${rec.content}</div>
                </div>
                <div class="kpi-container">
                    <div class="kpi-item">
                        <span class="kpi-label">예상 오픈율 (CTR)</span>
                        <div class="kpi-value">
                            ${rec.predictedCTR}<span class="kpi-unit">%</span>
                            <span class="kpi-trend trend-up">▲</span>
                        </div>
                    </div>
                    <div class="kpi-item">
                        <span class="kpi-label">예상 구매전환율 (CVR)</span>
                        <div class="kpi-value">
                            ${rec.predictedCVR}<span class="kpi-unit">%</span>
                            <span class="kpi-trend trend-up">▲</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Add copy event
            const copyBtn = card.querySelector('.copy-btn');
            copyBtn.addEventListener('click', () => {
                const textToCopy = `[${rec.title}]\n${rec.content}`;
                navigator.clipboard.writeText(textToCopy).then(() => {
                    copyBtn.classList.add('copied');
                    copyBtn.querySelector('span').textContent = 'Copied!';
                    copyBtn.querySelector('i').className = 'fas fa-check';
                    
                    setTimeout(() => {
                        copyBtn.classList.remove('copied');
                        copyBtn.querySelector('span').textContent = 'Copy';
                        copyBtn.querySelector('i').className = 'far fa-copy';
                    }, 2000);
                });
            });

            recommendationsContainer.appendChild(card);
        });
    }

    function populateDropdowns(data) {
        const segments = [...new Set(data.map(item => item["고객 세그먼트"]))].filter(Boolean);
        const mediums = [...new Set(data.map(item => item["발송매체"]))].filter(Boolean);
        
        const segmentSelect = document.getElementById('customer-segment');
        const mediumSelect = document.getElementById('medium');
        
        segmentSelect.innerHTML = '';
        mediumSelect.innerHTML = '';
        
        segments.forEach(seg => {
            const opt = document.createElement('option');
            opt.value = seg;
            opt.textContent = seg;
            segmentSelect.appendChild(opt);
        });
        
        mediums.forEach(med => {
            const opt = document.createElement('option');
            opt.value = med;
            opt.textContent = med;
            mediumSelect.appendChild(opt);
        });
    }

    // Start initialization
    await init();
});
