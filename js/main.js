document.addEventListener('DOMContentLoaded', () => {
    const engine = new CampaignEngine(window.CAMPAIGN_DATA);
    const form = document.getElementById('planner-form');
    const resultsArea = document.getElementById('results-area');
    const recommendationsContainer = document.getElementById('recommendations-container');
    const keywordCloud = document.getElementById('keyword-cloud');

    // Render keyword cloud
    const topKeywords = engine.analyzeKeywords().slice(0, 10);
    topKeywords.forEach(kw => {
        const tag = document.createElement('span');
        tag.className = 'keyword-tag';
        tag.textContent = `#${kw.word} (Lift: +${(kw.openLift * 100).toFixed(0)}%)`;
        keywordCloud.appendChild(tag);
    });
    
    // Real-time relevance score
    const purposeInput = document.getElementById('campaign-purpose');
    const relevanceBadge = document.getElementById('relevance-score');
    const scoreValue = relevanceBadge.querySelector('.score-value');

    purposeInput.addEventListener('input', () => {
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

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const btn = document.getElementById('generate-btn');
        const loader = btn.querySelector('.loader-inner');
        const btnText = btn.querySelector('span');

        // Loading state
        btnText.style.display = 'none';
        loader.style.display = 'block';
        btn.disabled = true;

        setTimeout(() => {
            const params = {
                isWeekend: document.getElementById('send-day').value === 'weekend',
                time: document.getElementById('send-time').value,
                segment: document.getElementById('customer-segment').value,
                medium: document.getElementById('medium').value === 'push' ? '푸시' : '문자',
                purpose: document.getElementById('campaign-purpose').value
            };

            const recs = engine.recommend(params);
            renderRecommendations(recs);

            resultsArea.style.display = 'block';
            btnText.style.display = 'block';
            loader.style.display = 'none';
            btn.disabled = false;

            resultsArea.scrollIntoView({ behavior: 'smooth' });
        }, 800);
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
});
