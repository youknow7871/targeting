class CampaignEngine {
    constructor(data) {
        this.data = data.map(item => ({
            ...item,
            openRate: parseFloat(item["오픈율"]) || parseFloat(item["CTR"]) || 0,
            cvr: parseFloat(item["구매전환율"]) || parseFloat(item["CVR"]) || 0,
            isWeekend: this.checkWeekend(item["발송일자"] || item["날짜"])
        }));
        this.globalAvgOpen = this.data.length ? this.data.reduce((acc, i) => acc + i.openRate, 0) / this.data.length : 1;
        this.globalAvgCvr = this.data.length ? this.data.reduce((acc, i) => acc + i.cvr, 0) / this.data.length : 1;
    }

    checkWeekend(dateStr) {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    // Extract ML Insights specifically for the given parameters
    getInsightsForParams(params) {
        const { isWeekend, segment, medium } = params;
        
        // GROUND RULE: Ignore rows where URL is invalid (if it exists).
        const validData = this.data.filter(item => {
            const link = (item["링크"] || "").toLowerCase();
            if (link) {
                return link.startsWith("http://") || link.startsWith("https://");
            }
            return (item["제목"] || item["내용"]) ? true : false;
        });

        // 1. 세그먼트 기준(Baseline) 필터링 - 대상자 편향(Selection Bias) 제거를 위함
        const segmentData = segment ? validData.filter(item => (item["고객 세그먼트"] || "").includes(segment)) : validData;
        const baselineData = segmentData.length > 0 ? segmentData : validData;
        
        const baselineOpen = baselineData.reduce((acc, i) => acc + i.openRate, 0) / (baselineData.length || 1);
        const baselineCVR = baselineData.reduce((acc, i) => acc + i.cvr, 0) / (baselineData.length || 1);

        // 2. 매체 등 현재 상황에 맞는 구체적 타깃 데이터 필터링
        const targetData = baselineData.filter(item => {
            let score = 0;
            if (item["발송매체"] && item["발송매체"].includes(medium)) score += 1;
            return score >= 1; 
        }).length > 0 ? baselineData.filter(item => item["발송매체"] && item["발송매체"].includes(medium)) : baselineData;

        // 3. Taxonomy(소구점) 분류 및 성과 분석
        const taxonomies = {
            "동경심/VIP": { keywords: ['vip', '우수', '승급', '플래티넘', '신분', '초대', '특별'], count: 0, sumOpen: 0 },
            "추천": { keywords: ['추천', '타깃팅', '제안', '맞춤', '고객님을 위한'], count: 0, sumOpen: 0 },
            "긴급": { keywords: ['오늘만', '이번', '마감', '선착순', '마지막', '종료'], count: 0, sumOpen: 0 },
            "혜택": { keywords: ['할인', '특가', '쿠폰', '무료', '최대', '적립'], count: 0, sumOpen: 0 },
            "사은품/행사": { keywords: ['사은품', '이벤트', '참여', '행사', '응모', '증정'], count: 0, sumOpen: 0 }
        };

        const keywords = {};
        targetData.forEach(item => {
            if (!item['제목'] && !item['내용']) return;
            const text = (item['제목'] + " " + item['내용'] + " " + (item['Info']||"")).toLowerCase();
            
            // Taxonomy 분류
            for (const [taxName, taxInfo] of Object.entries(taxonomies)) {
                if (taxInfo.keywords.some(k => text.includes(k))) {
                    taxInfo.count++;
                    taxInfo.sumOpen += item.openRate;
                }
            }

            // 개별 키워드 추출
            const words = text.split(/[\s,.;:!?()]+/).filter(w => w.length > 1);
            const uniqueWords = [...new Set(words)];
            
            uniqueWords.forEach(word => {
                // 노이즈 단어 필터링
                if (['광고', '무료수신거부', '수신거부', '앱설정', '고객님', '확인해', '바로'].includes(word)) return;
                if (!keywords[word]) keywords[word] = { count: 0, sumOpen: 0 };
                keywords[word].count++;
                keywords[word].sumOpen += item.openRate;
            });
        });

        // Taxonomy 리프트 계산
        const taxResults = [];
        for (const [taxName, stats] of Object.entries(taxonomies)) {
            if (stats.count > 0) {
                const avgOpen = stats.sumOpen / stats.count;
                const openLift = avgOpen / baselineOpen;
                taxResults.push({ name: taxName, lift: openLift, avgOpen });
            }
        }
        taxResults.sort((a, b) => b.lift - a.lift);
        const bestTaxonomy = taxResults.length > 0 ? taxResults[0] : null;

        // 키워드 리프트 계산 (CVR 배제, 오직 CTR Lift 기반)
        const kwResults = [];
        for (const [word, stats] of Object.entries(keywords)) {
            if (stats.count >= 2) {
                const avgOpen = stats.sumOpen / stats.count;
                const openLift = avgOpen / baselineOpen;
                kwResults.push({ word, score: openLift, avgOpen }); // score is pure CTR Lift
            }
        }
        
        return {
            topKeywords: kwResults.sort((a, b) => b.score - a.score).slice(0, 7),
            bestTaxonomy: bestTaxonomy,
            pastBestPerformers: targetData.sort((a, b) => b.openRate - a.openRate).slice(0, 3),
            baselineOpen: baselineOpen,
            baselineCVR: baselineCVR
        };
    }

    // This replaces the old rigid recommend() function and acts as a dynamic Prompt Builder
    buildPrompt(params) {
        const insights = this.getInsightsForParams(params);
        
        const m = (params.medium || "").toLowerCase();
        let category = '문자'; // Default classification
        
        if (m.includes('웹') || m.includes('web')) {
            category = 'WEB';
        } else if (m.includes('앱') || m === '푸시' || m.includes('푸시')) {
            category = '푸시';
        } else if (m.includes('카카오') || m.includes('친구톡')) {
            category = '친구톡';
        } else {
            category = '문자'; // LMS, MMS
        }
        
        let mediumConstraints = "";
        if (category === '푸시' || category === 'WEB') {
            mediumConstraints = `
- 🚨 THIS IS A ${category} NOTIFICATION. IT MUST BE EXTREMELY CONCISE AND SHORT!
- Title Length: MAXIMUM 15~20 characters (must fit on one line on a locked smartphone screen).
- Content Length: MAXIMUM 30~50 characters.
- Style: Highly engaging, urgent, or fun.
- You MUST organically use 1 or 2 appropriate EMOJIS (🔔, 🔥, 🚀, 🎁, etc.) in the Title and Content.
- DO NOT write a long text message. NO formal structural templates like '(광고)' unless necessary. Keep it punchy!
`;
        } else if (category === '친구톡') {
            mediumConstraints = `
- THIS IS A KAKAOTALK FRIEND-TALK (카카오 친구톡) MESSAGE.
- Title Length: 15~30 characters. Catchy and engaging.
- Content Length: Up to 100~250 characters. You can use multiple lines and paragraphs for readability.
- Style: Friendly, conversational, and highly engaging. 
- You MUST organically use appropriate EMOJIS. You can use bullet points or structural layouts if needed.
`;
        } else {
            mediumConstraints = `
- THIS IS A LONG TEXT MESSAGE (LMS / MMS).
- ABSOLUTE RULE: You MUST output the content EXACTLY following this structural template. DO NOT deviate from this layout. DO NOT output a short 1-line push notification.

[REQUIRED TEMPLATE]
(광고) [Brand/Shop Name]
[1~2 sentences of natural hook/greeting. DO NOT use customer names like "[고객명]님". DO NOT use emojis.]

■ [Event/Promo Name] 안내
- [Key info 1]
- [Key info 2]

■ 놓치면 후회할 단독 혜택
- [Benefit 1]
- [Benefit 2]

------------------------------------------
★ 시크릿 혜택 ★
[Describe the core benefit/gift here]
(※ [Condition, e.g., 일 선착순 한정])
------------------------------------------

[Closing sentence urging immediate action without using cliches.]
무료수신거부 080-XXX-XXXX
[END OF TEMPLATE]

- Style Constraints:
  1. NO EMOJIS: STRICTLY NO EMOJIS allowed. Use only standard text symbols (■, ★, ※, ▶).
  2. TONE: Make it sound exclusive and urgent ("조기 품절 주의").
`;
        }
        
        const contextStr = `
You are a highly skilled CRM Marketing AI. Your objective is to generate 3 customized CRM messages.
Target Audience (Segment): ${params.segment}
Delivery Medium: ${params.medium}
Delivery Timing: ${params.time} (${params.isWeekend ? 'Weekend' : 'Weekday'})
Campaign Purpose: ${params.purpose}

[ML Analytics Data]
Based on historical data for this target audience (Selection Bias removed), the baseline Open Rate is ${insights.baselineOpen.toFixed(2)}% and CVR is ${insights.baselineCVR.toFixed(2)}%.
${insights.bestTaxonomy ? `The most mathematically effective Campaign Theme (Taxonomy) for this audience is: "${insights.bestTaxonomy.name}" (Lifts Open Rate by ${(insights.bestTaxonomy.lift * 100).toFixed(0)}%). YOU MUST HIGHLY EMPHASIZE THIS THEME in your tone and message.` : ''}

The most statistically effective keywords (Relative CTR Lift Priority) for this segment are: 
${insights.topKeywords.map(k => `"${k.word}" (Lift: +${(k.score * 100 - 100).toFixed(0)}%)`).join(', ')}

Here are extreme high-performing past successful campaigns. CRITICAL: DO NOT COPY THEIR FORMATTING OR EMOJIS IF THEY CONFLICT WITH THE CONSTRAINTS BELOW. Use them ONLY for content inspiration:
${insights.pastBestPerformers.map(p => `- Title: ${p['제목']}\n  Content: ${p['내용']}\n  Result: CTR ${p.openRate}%`).join('\n\n')}

[Task Constraints]
1. Write 3 highly engaging, creative, and personalized campaign messages matching the "Campaign Purpose". Note: Suggest 3 slightly different A/B test variants (e.g., Variant 1: Focus on Urgency, Variant 2: Focus on ${insights.bestTaxonomy ? insights.bestTaxonomy.name : 'Benefit'}, Variant 3: Direct/Concise).
${mediumConstraints}
2. ABSOLUTE RULE: You MUST strictly follow the "Style Constraints" defined above for your chosen medium. If the past campaigns contain emojis or names (like 안녕하세요 고객님), IGNORE them and adhere strictly to your constraints.
3. You MUST organically sprinkle the "highly effective keywords" identified by ML into your writing.
4. Predict the CTR and CVR for each of your 3 recommendations. Make realistic, data-driven estimations slightly higher than historical baseline.
5. YOU MUST RETURN YOUR RESPONSE IN PURE RAW JSON FORMAT ONLY, without any markdown blocks or explanation. Do not wrap in \`\`\`json. The JSON must be an array of objects precisely following this schema:
[
  {
    "title": "String",
    "content": "String",
    "predictedCTR": "Number (String fixed to 2 decimals)",
    "predictedCVR": "Number (String fixed to 2 decimals)"
  }
]
`;
        return contextStr;
    }

    // Keep for keyword cloud
    analyzeKeywords() {
        return this.getInsightsForParams({segment: "", medium: ""}).topKeywords.map(k => ({
            word: k.word,
            openLift: k.score - 1
        }));
    }

    getRelevanceScore(purpose) {
        if (!purpose || purpose.length < 2) return 0;
        const words = purpose.split(/[\s,.;:!?()]+/).filter(w => w.length > 1);
        let maxScore = 0;
        const analytics = this.analyzeKeywords();
        words.forEach(word => {
            const found = analytics.find(a => a.word.includes(word) || word.includes(a.word));
            if (found) maxScore = Math.max(maxScore, found.openLift * 100);
        });
        return Math.min(100, Math.round((maxScore + 0.5) * 50)); 
    }
}

window.CampaignEngine = CampaignEngine;
