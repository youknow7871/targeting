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
        
        // Filter data relevant to current condition to find what works best
        const relevantData = this.data.filter(item => {
            let score = 0;
            if (item["고객 세그먼트"] && item["고객 세그먼트"].includes(segment)) score += 3;
            if (item["발송매체"] && item["발송매체"].includes(medium)) score += 1;
            return score >= 1; // Must have some relevance
        });

        const targetData = relevantData.length > 0 ? relevantData : this.data; // fallback to all data if none match

        // Keyword extraction & scoring
        const keywords = {};
        targetData.forEach(item => {
            if (!item['제목'] && !item['내용']) return;
            const words = (item['제목'] + " " + item['내용']).split(/[\s,.;:!?()]+/).filter(w => w.length > 1);
            const uniqueWords = [...new Set(words)];
            
            uniqueWords.forEach(word => {
                if (!keywords[word]) keywords[word] = { count: 0, sumOpen: 0, sumCvr: 0 };
                keywords[word].count++;
                keywords[word].sumOpen += item.openRate;
                keywords[word].sumCvr += item.cvr;
            });
        });

        const results = [];
        for (const [word, stats] of Object.entries(keywords)) {
            if (stats.count >= 2) {
                const avgOpen = stats.sumOpen / stats.count;
                const avgCvr = stats.sumCvr / stats.count;
                const openLift = avgOpen / this.globalAvgOpen;
                const cvrLift = avgCvr / this.globalAvgCvr;
                
                // USER REQUIREMENT: Open Rate > CVR priority (70% vs 30%)
                const score = (openLift * 0.7) + (cvrLift * 0.3);
                
                results.push({ word, score, avgOpen, avgCvr });
            }
        }
        
        return {
            topKeywords: results.sort((a, b) => b.score - a.score).slice(0, 5),
            pastBestPerformers: targetData.sort((a, b) => b.openRate - a.openRate).slice(0, 3),
            baselineOpen: targetData.reduce((acc, i) => acc + i.openRate, 0) / targetData.length,
            baselineCVR: targetData.reduce((acc, i) => acc + i.cvr, 0) / targetData.length
        };
    }

    // This replaces the old rigid recommend() function and acts as a dynamic Prompt Builder
    buildPrompt(params) {
        const insights = this.getInsightsForParams(params);
        
        const contextStr = `
You are a highly skilled CRM Marketing AI. Your objective is to generate 3 customized CRM messages.
Target Audience (Segment): ${params.segment}
Delivery Medium: ${params.medium}
Delivery Timing: ${params.time} (${params.isWeekend ? 'Weekend' : 'Weekday'})
Campaign Purpose: ${params.purpose}

[ML Analytics Data]
Based on historical data for this audience, the average Open Rate is ${insights.baselineOpen.toFixed(2)}% and CVR is ${insights.baselineCVR.toFixed(2)}%.
The most statistically effective keywords that mathematically lifted Open Rates (Highest Priority) are: 
${insights.topKeywords.map(k => `"${k.word}"`).join(', ')}

Here are extreme high-performing past successful campaigns exactly for this segment/medium to study the preferred tone and length:
${insights.pastBestPerformers.map(p => `- Title: ${p['제목']}\n  Content: ${p['내용']}\n  Result: CTR ${p.openRate}%, CVR ${p.cvr}%`).join('\n\n')}

[Task Constraints]
1. Write 3 highly engaging, creative, and personalized campaign messages matching the "Campaign Purpose".
2. You MUST organically sprinkle the "highly effective keywords" identified by ML into your writing.
3. Keep the tone similar to the past successful campaigns, but adapt it to the new purpose.
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
