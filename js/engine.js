class CampaignEngine {
    constructor(data) {
        this.data = data.map(item => ({
            ...item,
            openRate: parseFloat(item.오픈율),
            cvr: parseFloat(item.구매전환율),
            isWeekend: this.checkWeekend(item.발송일자)
        }));
        this.globalAvgOpen = this.data.reduce((acc, i) => acc + i.openRate, 0) / this.data.length;
        this.globalAvgCvr = this.data.reduce((acc, i) => acc + i.cvr, 0) / this.data.length;
    }

    checkWeekend(dateStr) {
        const date = new Date(dateStr);
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    // Extract keywords and calculate their Lift
    analyzeKeywords() {
        const keywords = {};
        this.data.forEach(item => {
            const words = (item.제목 + " " + item.내용).split(/[\s,.;:!?()]+/).filter(w => w.length > 1);
            const uniqueWords = [...new Set(words)];
            
            uniqueWords.forEach(word => {
                if (!keywords[word]) {
                    keywords[word] = { count: 0, sumOpen: 0, sumCvr: 0 };
                }
                keywords[word].count++;
                keywords[word].sumOpen += item.openRate;
                keywords[word].sumCvr += item.cvr;
            });
        });

        const results = [];
        for (const [word, stats] of Object.entries(keywords)) {
            if (stats.count >= 2) { // Minimum frequency
                const avgOpen = stats.sumOpen / stats.count;
                const avgCvr = stats.sumCvr / stats.count;
                const openLift = (avgOpen / this.globalAvgOpen) - 1;
                const cvrLift = (avgCvr / this.globalAvgCvr) - 1;
                
                results.push({
                    word,
                    count: stats.count,
                    openLift,
                    cvrLift,
                    score: (openLift * 0.6) + (cvrLift * 0.4)
                });
            }
        }
        return results.sort((a, b) => b.score - a.score);
    }

    recommend(params) {
        const { isWeekend, time, segment, medium, purpose } = params;
        
        // Match score calculation
        const recommendations = this.data.map(item => {
            let matchScore = 0;
            if (item.isWeekend === isWeekend) matchScore += 2;
            if (item["고객 세그먼트"] && item["고객 세그먼트"].includes(segment)) matchScore += 3;
            if (item["발송매체"] && item["발송매체"].includes(medium)) matchScore += 1;
            
            // Simple purpose matching
            if (purpose && (item["제목"].includes(purpose) || item["내용"].includes(purpose) || item["Info"].includes(purpose))) {
                matchScore += 5;
            }

            return { ...item, matchScore };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);

        return recommendations.map(rec => {
            // Predict based on match and historical performance
            // We use the actual historical result as a baseline
            return {
                title: rec.제목,
                content: rec.내용,
                predictedCTR: (rec.openRate * 1.05).toFixed(2), // Slight AI adjustment placeholder
                predictedCVR: (rec.cvr * 1.02).toFixed(2),
                matchScore: rec.matchScore
            };
        });
    }

    getRelevanceScore(purpose) {
        if (!purpose || purpose.length < 2) return 0;
        
        const words = purpose.split(/[\s,.;:!?()]+/).filter(w => w.length > 1);
        let maxScore = 0;
        
        const analytics = this.analyzeKeywords();
        words.forEach(word => {
            const found = analytics.find(a => a.word.includes(word) || word.includes(a.word));
            if (found) {
                maxScore = Math.max(maxScore, found.score);
            }
        });
        
        // Normalize score to 0-100 range for display
        return Math.min(100, Math.round((maxScore + 0.5) * 50)); 
    }
}

window.CampaignEngine = CampaignEngine;
