document.addEventListener('DOMContentLoaded', async () => {
    const JSON_URL = 'assets/campaign_master.json';
    
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
        try {
            // 캐시를 무효화하여 항상 최신 JSON을 가져오도록 설정
            const timestamp = new Date().getTime();
            const response = await fetch(`${JSON_URL}?t=${timestamp}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return data;
        } catch (error) {
            console.error("데이터 로드 중 오류 발생:", error);
            throw error;
        }
    }

    function processSheetData(data) {
        // Map sheet column names to engine keys supporting both new and old schemas
        return data.map(row => ({
            "발송일자": row["send_date"] || row["발송일자"] || row["날짜"] || "",
            "발송시간": row["send_time"] || row["발송시간"] || "",
            "발송매체": row["medium"] || row["발송매체"] || row["매체"] || "",
            "고객 세그먼트": row["segment"] || row["고객 세그먼트"] || row["세그먼트"] || "",
            "제목": row["title"] || row["제목"] || "",
            "내용": row["content"] || row["내용"] || "",
            "Info": row["purpose"] || row["Info"] || row["캠페인명"] || "",
            "오픈율": row["ctr"] || row["오픈율"] || row["CTR"] || "0%",
            "CTR": row["ctr"] || row["오픈율"] || row["CTR"] || "0%",
            "구매전환율": row["cvr"] || row["구매율"] || row["구매전환율"] || row["CVR"] || "0%",
            "링크": row["link"] || row["링크"] || "",
            "카테고리": row["category"] || row["카테고리"] || "",
            "오퍼": row["offer_type"] || row["오퍼"] || "",
            "오퍼상세": row["offer_detail"] || row["오퍼상세"] || ""
        }));
    }

    function renderKeywordCloud() {
        if (!keywordCloud) return;
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
