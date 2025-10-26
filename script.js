// ===================================
// QUIZ APPLICATION - OPTIMIZED VERSION
// ===================================

const QuizApp = (function() {
    'use strict';
    
    // ===================================
    // PRIVATE STATE
    // ===================================
    const state = {
        questions: [],
        originalQuestions: [],
        allQuestions: [], // Toàn bộ câu hỏi từ file
        currentQuestionIndex: 0,
        userAnswers: [],
        wrongQuestions: [],
        isRetryMode: false,
        history: [],
        bookmarkedQuestions: new Set(),
        timerInterval: null,
        timeRemaining: 0,
        currentFilter: 'all',
        questionMap: new Map(), // Map ID -> Question cho O(1) lookup
        reviewMode: false,
        settings: {
            darkMode: false,
            timerEnabled: false,
            timeLimit: 30,
            shuffleQuestions: false,
            shuffleAnswers: false,
            selectedTopic: 'all'
        }
    };

    // ===================================
    // UTILITY FUNCTIONS
    // ===================================
    
    /**
     * Sanitize HTML to prevent XSS
     */
    function sanitizeHTML(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Render LaTeX with KaTeX
     */
    function renderMath(element) {
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(element, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false}
                ],
                throwOnError: false
            });
        }
    }
    
    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    function shuffleArray(array) {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    }
    
    /**
     * Validate question object
     */
    function validateQuestion(q) {
        if (!q.question || typeof q.question !== 'string') {
            return { valid: false, error: 'Thiếu hoặc sai định dạng câu hỏi' };
        }
        
        if (!Array.isArray(q.answers) || q.answers.length < 2) {
            return { valid: false, error: 'Cần ít nhất 2 đáp án' };
        }
        
        if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) {
            return { valid: false, error: `Chỉ số đáp án đúng không hợp lệ (${q.correct})` };
        }
        
        // Auto-generate ID if missing
        if (!q.id) {
            q.id = `Q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        }
        
        return { valid: true };
    }
    
    /**
     * Generate unique ID
     */
    function generateID() {
        return `Q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    /**
     * Show toast notification
     */
    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'error' ? 'error' : ''}`;
        toast.innerHTML = `
            <span style="font-size: 1.2em;">${type === 'success' ? '✅' : '❌'}</span>
            <span>${sanitizeHTML(message)}</span>
        `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
    
    /**
     * Show/hide screen
     */
    function showScreen(screenClass) {
        document.querySelectorAll('.home-screen, .quiz-screen, .result-screen, .review-screen').forEach(s => {
            s.classList.remove('active');
        });
        document.querySelector('.' + screenClass).classList.add('active');
    }

    // ===================================
    // FILE HANDLING
    // ===================================
    
    function setupFileUpload() {
        const fileInput = document.getElementById('fileInput');
        
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Check file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                showToast('File quá lớn (tối đa 5MB)', 'error');
                return;
            }
            
            document.getElementById('fileName').textContent = file.name;
            const reader = new FileReader();
            
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    
                    if (!data.questions || !Array.isArray(data.questions) || data.questions.length === 0) {
                        throw new Error('File không đúng định dạng hoặc không có câu hỏi');
                    }
                    
                    // Validate all questions
                    const errors = [];
                    data.questions.forEach((q, idx) => {
                        const validation = validateQuestion(q);
                        if (!validation.valid) {
                            errors.push(`Câu ${idx + 1}: ${validation.error}`);
                        }
                    });
                    
                    if (errors.length > 0) {
                        throw new Error(`Có ${errors.length} câu hỏi lỗi:\n${errors.slice(0, 3).join('\n')}`);
                    }
                    
                    // Store questions
                    state.allQuestions = JSON.parse(JSON.stringify(data.questions));
                    state.originalQuestions = JSON.parse(JSON.stringify(data.questions));
                    
                    // Build question map for O(1) lookup
                    state.questionMap.clear();
                    state.allQuestions.forEach(q => {
                        state.questionMap.set(q.id, q);
                    });
                    
                    // Extract topics
                    updateTopicFilter();
                    
                    // Apply topic filter
                    filterQuestionsByTopic(state.settings.selectedTopic);
                    
                    document.getElementById('startBtn').disabled = false;
                    showToast(`✅ Tải thành công ${state.allQuestions.length} câu hỏi!`);
                    
                } catch (error) {
                    showToast('❌ Lỗi: ' + error.message, 'error');
                    document.getElementById('startBtn').disabled = true;
                    document.getElementById('fileName').textContent = 'Chưa chọn file';
                }
            };
            
            reader.onerror = () => {
                showToast('❌ Không thể đọc file', 'error');
            };
            
            reader.readAsText(file);
        });
    }

    // ===================================
    // TOPIC FILTERING
    // ===================================
    
    function updateTopicFilter() {
        const topics = new Set();
        state.allQuestions.forEach(q => {
            if (q.topic) topics.add(q.topic);
        });
        
        const select = document.getElementById('topicFilter');
        select.innerHTML = '<option value="all">Tất cả chủ đề</option>';
        
        [...topics].sort().forEach(topic => {
            const option = document.createElement('option');
            option.value = topic;
            option.textContent = topic;
            select.appendChild(option);
        });
        
        select.value = state.settings.selectedTopic;
        
        select.onchange = () => {
            state.settings.selectedTopic = select.value;
            filterQuestionsByTopic(select.value);
            saveSettings();
        };
        
        updateTopicStats();
    }
    
    function filterQuestionsByTopic(topic) {
        if (topic === 'all') {
            state.originalQuestions = JSON.parse(JSON.stringify(state.allQuestions));
        } else {
            state.originalQuestions = state.allQuestions
                .filter(q => q.topic === topic)
                .map(q => JSON.parse(JSON.stringify(q)));
        }
        
        state.questions = JSON.parse(JSON.stringify(state.originalQuestions));
        
        document.getElementById('startBtn').disabled = state.questions.length === 0;
        updateTopicStats();
    }
    
    function updateTopicStats() {
        const stats = document.getElementById('topicStats');
        const count = state.originalQuestions.length;
        const total = state.allQuestions.length;
        
        if (state.settings.selectedTopic === 'all') {
            stats.textContent = `📊 Tổng: ${total} câu hỏi`;
        } else {
            stats.textContent = `📊 ${count} câu hỏi (${Math.round(count/total*100)}% tổng số)`;
        }
    }

    // ===================================
    // QUIZ LOGIC
    // ===================================
    
    function startQuiz() {
        state.currentQuestionIndex = 0;
        state.bookmarkedQuestions.clear();
        state.reviewMode = false;
        
        if (!state.isRetryMode) {
            state.questions = JSON.parse(JSON.stringify(state.originalQuestions));
            
            if (state.settings.shuffleQuestions) {
                state.questions = shuffleArray(state.questions);
            }
            
            if (state.settings.shuffleAnswers) {
                state.questions = state.questions.map(q => {
                    const answersWithIndex = q.answers.map((a, i) => ({ 
                        text: a, 
                        isCorrect: i === q.correct 
                    }));
                    const shuffled = shuffleArray(answersWithIndex);
                    return {
                        ...q,
                        answers: shuffled.map(a => a.text),
                        correct: shuffled.findIndex(a => a.isCorrect)
                    };
                });
            }
        }
        
        state.userAnswers = new Array(state.questions.length).fill(null);
        
        if (state.settings.timerEnabled) {
            state.timeRemaining = state.settings.timeLimit * 60;
            startTimer();
            document.getElementById('timerDisplay').style.display = 'flex';
        } else {
            document.getElementById('timerDisplay').style.display = 'none';
        }
        
        showScreen('quiz-screen');
        updateQuestionNav();
        displayQuestion();
    }
    
    function startTimer() {
        stopTimer(); // Clear any existing timer
        
        state.timerInterval = setInterval(() => {
            state.timeRemaining--;
            updateTimerDisplay();
            
            if (state.timeRemaining <= 0) {
                stopTimer();
                showToast('⏰ Hết giờ làm bài!', 'error');
                submitQuiz();
            }
        }, 1000);
    }
    
    function stopTimer() {
        if (state.timerInterval) {
            clearInterval(state.timerInterval);
            state.timerInterval = null;
        }
    }
    
    function updateTimerDisplay() {
        const minutes = Math.floor(state.timeRemaining / 60);
        const seconds = state.timeRemaining % 60;
        document.getElementById('timer').textContent = 
            `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        const display = document.getElementById('timerDisplay');
        if (state.timeRemaining <= 300) {
            display.style.color = '#ef4444';
        } else {
            display.style.color = '';
        }
    }
    
    function displayQuestion() {
        const q = state.questions[state.currentQuestionIndex];
        const questionNumber = document.getElementById('questionNumber');
        const questionText = document.getElementById('questionText');
        
        questionNumber.textContent = `Câu ${state.currentQuestionIndex + 1}/${state.questions.length}`;
        questionText.innerHTML = sanitizeHTML(q.question);
        
        // Render LaTeX
        renderMath(questionText);
        
        // Bookmark button
        const bookmarkBtn = document.getElementById('bookmarkBtn');
        if (state.bookmarkedQuestions.has(state.currentQuestionIndex)) {
            bookmarkBtn.classList.add('bookmarked');
            bookmarkBtn.textContent = '⭐';
        } else {
            bookmarkBtn.classList.remove('bookmarked');
            bookmarkBtn.textContent = '☆';
        }
        
        // Progress
        const progress = ((state.currentQuestionIndex + 1) / state.questions.length) * 100;
        document.getElementById('progressBar').style.width = progress + '%';
        document.getElementById('progressText').textContent = 
            `${state.currentQuestionIndex + 1}/${state.questions.length}`;
        
        const answeredCount = state.userAnswers.filter(a => a !== null).length;
        document.getElementById('answeredCount').textContent = `Đã trả lời: ${answeredCount}`;

        // Answers
        const answersContainer = document.getElementById('answersContainer');
        answersContainer.innerHTML = '';
        
        q.answers.forEach((answer, index) => {
            const div = document.createElement('div');
            div.className = 'answer-option';
            if (state.userAnswers[state.currentQuestionIndex] === index) {
                div.classList.add('selected');
            }
            div.innerHTML = sanitizeHTML(answer);
            renderMath(div);
            div.onclick = () => selectAnswer(index);
            answersContainer.appendChild(div);
        });

        // Navigation buttons
        document.getElementById('prevBtn').style.display = 
            state.currentQuestionIndex > 0 ? 'inline-block' : 'none';
        document.getElementById('nextBtn').style.display = 
            state.currentQuestionIndex < state.questions.length - 1 ? 'inline-block' : 'none';
        document.getElementById('submitBtn').style.display = 
            state.currentQuestionIndex === state.questions.length - 1 ? 'inline-block' : 'none';
        
        updateQuestionNav();
    }
    
    function updateQuestionNav() {
        const nav = document.getElementById('questionNav');
        nav.innerHTML = '';
        
        state.questions.forEach((_, index) => {
            const div = document.createElement('div');
            div.className = 'question-nav-item';
            
            if (state.userAnswers[index] !== null) {
                div.classList.add('answered');
            }
            if (index === state.currentQuestionIndex) {
                div.classList.add('current');
            }
            
            div.textContent = state.bookmarkedQuestions.has(index) ? '⭐' : (index + 1);
            div.onclick = () => {
                state.currentQuestionIndex = index;
                displayQuestion();
            };
            nav.appendChild(div);
        });
    }
    
    function selectAnswer(index) {
        state.userAnswers[state.currentQuestionIndex] = index;
        displayQuestion();
    }
    
    function prevQuestion() {
        if (state.currentQuestionIndex > 0) {
            state.currentQuestionIndex--;
            displayQuestion();
        }
    }
    
    function nextQuestion() {
        if (state.currentQuestionIndex < state.questions.length - 1) {
            state.currentQuestionIndex++;
            displayQuestion();
        }
    }
    
    function toggleBookmark() {
        if (state.bookmarkedQuestions.has(state.currentQuestionIndex)) {
            state.bookmarkedQuestions.delete(state.currentQuestionIndex);
        } else {
            state.bookmarkedQuestions.add(state.currentQuestionIndex);
        }
        displayQuestion();
    }
    
    function submitQuiz() {
        stopTimer();
        
        if (state.userAnswers.includes(null)) {
            if (!confirm('⚠️ Bạn chưa trả lời hết các câu. Bạn có chắc muốn nộp bài?')) {
                return;
            }
        }

        let correctCount = 0;
        state.wrongQuestions = [];

        state.questions.forEach((q, index) => {
            if (state.userAnswers[index] === q.correct) {
                correctCount++;
            } else {
                state.wrongQuestions.push({
                    id: q.id, // Store ID instead of question text
                    index: index,
                    userAnswer: state.userAnswers[index],
                    correctAnswer: q.correct
                });
            }
        });

        const score = (correctCount / state.questions.length * 10).toFixed(2);
        const timeTaken = state.settings.timerEnabled ? 
            state.settings.timeLimit * 60 - state.timeRemaining : null;
        
        if (!state.isRetryMode) {
            const historyItem = {
                date: new Date().toLocaleString('vi-VN'),
                timestamp: Date.now(),
                score: score,
                total: state.questions.length,
                correct: correctCount,
                wrong: state.wrongQuestions.length,
                timeSpent: timeTaken ? 
                    `${Math.floor(timeTaken / 60)}:${(timeTaken % 60).toString().padStart(2, '0')}` : null,
                topic: state.settings.selectedTopic
            };
            state.history.unshift(historyItem);
            saveHistory();
        }
        
        // Display results
        document.getElementById('scoreDisplay').textContent = score;
        document.getElementById('totalQuestions').textContent = state.questions.length;
        document.getElementById('correctAnswers').textContent = correctCount;
        document.getElementById('wrongAnswers').textContent = state.wrongQuestions.length;

        let message = '';
        if (score >= 8) message = '🌟 Xuất sắc!';
        else if (score >= 6.5) message = '👍 Khá tốt!';
        else if (score >= 5) message = '😊 Trung bình';
        else message = '💪 Cố gắng hơn nhé!';
        document.getElementById('scoreMessage').textContent = message;

        const wrongSection = document.getElementById('wrongAnswersSection');
        if (state.wrongQuestions.length > 0) {
            wrongSection.innerHTML = '<div class="wrong-answers"><h3 style="color: #ef4444; margin-bottom: 15px;">❌ Các câu sai:</h3></div>';
            const wrongContainer = wrongSection.querySelector('.wrong-answers');
            
            state.wrongQuestions.forEach(item => {
                const q = state.questions[item.index];
                const div = document.createElement('div');
                div.className = 'wrong-answer-item';
                
                const userAnswerText = item.userAnswer !== null ? 
                    q.answers[item.userAnswer] : 'Không trả lời';
                
                div.innerHTML = `
                    <div class="question">Câu ${item.index + 1}: ${sanitizeHTML(q.question)}</div>
                    <div class="info">❌ Bạn chọn: ${sanitizeHTML(userAnswerText)}</div>
                    <div class="info" style="color: #10b981;">✅ Đáp án đúng: ${sanitizeHTML(q.answers[item.correctAnswer])}</div>
                `;
                wrongContainer.appendChild(div);
            });

            document.getElementById('retryWrongBtn').style.display = 'inline-block';
        } else {
            wrongSection.innerHTML = '';
            document.getElementById('retryWrongBtn').style.display = 'none';
        }

        showScreen('result-screen');
    }
    
    /**
     * OPTIMIZED: Retry wrong questions using ID lookup
     */
    function retryWrong() {
        // Use Map for O(1) lookup instead of O(n) find()
        state.questions = state.wrongQuestions
            .map(item => {
                const q = state.questionMap.get(item.id);
                if (q) {
                    const cloned = JSON.parse(JSON.stringify(q));
                    cloned._previousAnswer = item.userAnswer;
                    return cloned;
                }
                return null;
            })
            .filter(q => q !== null);
        
        if (state.questions.length === 0) {
            showToast('❌ Không tìm thấy câu hỏi để làm lại', 'error');
            return;
        }
        
        state.isRetryMode = true;
        startQuiz();
    }
    
    function retryAll() {
        state.isRetryMode = false;
        state.questions = JSON.parse(JSON.stringify(state.originalQuestions));
        startQuiz();
    }
    
    function goHome() {
        stopTimer();
        showScreen('home-screen');
        state.isRetryMode = false;
        displayHistory();
    }

    // ===================================
    // REVIEW MODE
    // ===================================
    
    function reviewAnswers() {
        state.reviewMode = true;
        state.currentQuestionIndex = 0;
        showScreen('review-screen');
        displayReviewQuestion();
    }
    
    function displayReviewQuestion() {
        const q = state.questions[state.currentQuestionIndex];
        const userAnswer = state.userAnswers[state.currentQuestionIndex];
        
        // Update header
        document.getElementById('reviewQuestionNumber').textContent = 
            `Câu ${state.currentQuestionIndex + 1}/${state.questions.length}`;
        
        // Update question text
        const questionText = document.getElementById('reviewQuestionText');
        questionText.innerHTML = sanitizeHTML(q.question);
        renderMath(questionText);
        
        // Update progress
        const progress = ((state.currentQuestionIndex + 1) / state.questions.length) * 100;
        document.getElementById('reviewProgressBar').style.width = progress + '%';
        document.getElementById('reviewProgressText').textContent = 
            `${state.currentQuestionIndex + 1}/${state.questions.length}`;
        
        // Display answers with correct/incorrect marking
        const answersContainer = document.getElementById('reviewAnswersContainer');
        answersContainer.innerHTML = '';
        
        q.answers.forEach((answer, index) => {
            const div = document.createElement('div');
            div.className = 'answer-option disabled';
            
            // Mark user's answer
            if (userAnswer === index) {
                if (index === q.correct) {
                    div.classList.add('correct');
                } else {
                    div.classList.add('incorrect');
                }
            }
            
            // Mark correct answer
            if (index === q.correct && userAnswer !== index) {
                div.classList.add('correct');
            }
            
            div.innerHTML = sanitizeHTML(answer);
            renderMath(div);
            answersContainer.appendChild(div);
        });
        
        // Display explanation if available
        const explanationDiv = document.getElementById('reviewExplanation');
        if (q.explanation) {
            explanationDiv.style.display = 'block';
            explanationDiv.innerHTML = `
                <h4>💡 Giải thích:</h4>
                <p>${sanitizeHTML(q.explanation)}</p>
            `;
            renderMath(explanationDiv);
        } else {
            explanationDiv.style.display = 'none';
        }
        
        // Update navigation
        document.getElementById('reviewPrevBtn').style.display = 
            state.currentQuestionIndex > 0 ? 'inline-block' : 'none';
        document.getElementById('reviewNextBtn').style.display = 
            state.currentQuestionIndex < state.questions.length - 1 ? 'inline-block' : 'none';
        
        updateReviewNav();
    }
    
    function updateReviewNav() {
        const nav = document.getElementById('reviewQuestionNav');
        nav.innerHTML = '';
        
        state.questions.forEach((q, index) => {
            const div = document.createElement('div');
            div.className = 'question-nav-item';
            
            const userAnswer = state.userAnswers[index];
            const isCorrect = userAnswer === q.correct;
            
            if (isCorrect) {
                div.classList.add('answered');
                div.style.background = '#10b981';
            } else if (userAnswer !== null) {
                div.style.background = '#ef4444';
                div.style.color = 'white';
            }
            
            if (index === state.currentQuestionIndex) {
                div.classList.add('current');
            }
            
            div.textContent = index + 1;
            div.onclick = () => {
                state.currentQuestionIndex = index;
                displayReviewQuestion();
            };
            nav.appendChild(div);
        });
    }
    
    function prevReviewQuestion() {
        if (state.currentQuestionIndex > 0) {
            state.currentQuestionIndex--;
            displayReviewQuestion();
        }
    }
    
    function nextReviewQuestion() {
        if (state.currentQuestionIndex < state.questions.length - 1) {
            state.currentQuestionIndex++;
            displayReviewQuestion();
        }
    }
    
    function exitReview() {
        showScreen('result-screen');
    }

    // ===================================
    // HISTORY MANAGEMENT
    // ===================================
    
    function displayHistory() {
        const container = document.getElementById('historyContainer');
        const section = document.getElementById('historySection');
        const filterBtns = document.getElementById('filterButtons');
        
        let filtered = state.history;
        
        if (state.currentFilter !== 'all') {
            filtered = state.history.filter(item => {
                const score = parseFloat(item.score);
                if (state.currentFilter === 'excellent') return score >= 8;
                if (state.currentFilter === 'good') return score >= 6.5 && score < 8;
                if (state.currentFilter === 'average') return score >= 5 && score < 6.5;
                return true;
            });
        }
        
        if (state.history.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        
        filterBtns.innerHTML = `
            <button class="filter-btn ${state.currentFilter === 'all' ? 'active' : ''}" 
                    onclick="app.filterHistory('all')">Tất cả</button>
            <button class="filter-btn ${state.currentFilter === 'excellent' ? 'active' : ''}" 
                    onclick="app.filterHistory('excellent')">Xuất sắc (≥8)</button>
            <button class="filter-btn ${state.currentFilter === 'good' ? 'active' : ''}" 
                    onclick="app.filterHistory('good')">Khá (≥6.5)</button>
            <button class="filter-btn ${state.currentFilter === 'average' ? 'active' : ''}" 
                    onclick="app.filterHistory('average')">Trung bình (≥5)</button>
        `;

        if (filtered.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #666;">Không có kết quả</p>';
            return;
        }

        container.innerHTML = '';
        filtered.forEach(item => {
            const scoreColor = item.score >= 8 ? '#10b981' : 
                              item.score < 5 ? '#ef4444' : '#667eea';
            
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div class="history-header">
                    <div class="history-score" style="color: ${scoreColor}">${item.score} điểm</div>
                    <div class="history-date">${sanitizeHTML(item.date)}</div>
                </div>
                <div class="history-stats">
                    <span>📊 ${item.total} câu</span>
                    <span style="color: #10b981;">✅ ${item.correct}</span>
                    <span style="color: #ef4444;">❌ ${item.wrong}</span>
                    ${item.timeSpent ? `<span>⏱️ ${item.timeSpent}</span>` : ''}
                    ${item.topic && item.topic !== 'all' ? `<span>🎯 ${sanitizeHTML(item.topic)}</span>` : ''}
                </div>
            `;
            container.appendChild(div);
        });
    }
    
    function filterHistory(type) {
        state.currentFilter = type;
        displayHistory();
    }
    
    function exportHistory(format = 'csv') {
        if (state.history.length === 0) {
            showToast('⚠️ Chưa có lịch sử', 'error');
            return;
        }

        if (format === 'csv') {
            const csv = [
                ['Ngày', 'Điểm', 'Tổng', 'Đúng', 'Sai', 'Thời gian', 'Chủ đề'],
                ...state.history.map(i => [
                    i.date, 
                    i.score, 
                    i.total, 
                    i.correct, 
                    i.wrong, 
                    i.timeSpent || 'N/A',
                    i.topic || 'Tất cả'
                ])
            ].map(r => r.join(',')).join('\n');

            downloadFile(csv, `lich-su_${Date.now()}.csv`, 'text/csv;charset=utf-8;');
            showToast('📥 Đã xuất file CSV!');
        } else if (format === 'json') {
            const json = JSON.stringify({
                export_date: new Date().toISOString(),
                total_sessions: state.history.length,
                sessions: state.history
            }, null, 2);
            
            downloadFile(json, `lich-su_${Date.now()}.json`, 'application/json');
            showToast('📥 Đã xuất file JSON!');
        }
    }
    
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob(['\ufeff' + content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
    
    function clearHistory() {
        if (confirm('⚠️ Xóa toàn bộ lịch sử?')) {
            state.history = [];
            state.currentFilter = 'all';
            sessionStorage.removeItem('quizHistory');
            displayHistory();
            showToast('✅ Đã xóa lịch sử!');
        }
    }

    // ===================================
    // SETTINGS
    // ===================================
    
    function toggleDarkMode() {
        state.settings.darkMode = !state.settings.darkMode;
        document.getElementById('darkModeToggle').classList.toggle('active');
        document.body.classList.toggle('dark-mode');
        saveSettings();
    }
    
    function toggleTimer() {
        state.settings.timerEnabled = !state.settings.timerEnabled;
        document.getElementById('timerToggle').classList.toggle('active');
        saveSettings();
    }
    
    function toggleShuffle() {
        state.settings.shuffleQuestions = !state.settings.shuffleQuestions;
        document.getElementById('shuffleToggle').classList.toggle('active');
        saveSettings();
    }
    
    function toggleShuffleAnswers() {
        state.settings.shuffleAnswers = !state.settings.shuffleAnswers;
        document.getElementById('shuffleAnswersToggle').classList.toggle('active');
        saveSettings();
    }
    
    function saveSettings() {
        state.settings.timeLimit = parseInt(document.getElementById('timeLimit').value) || 30;
        try {
            sessionStorage.setItem('quizSettings', JSON.stringify(state.settings));
        } catch (e) {
            console.warn('Không thể lưu settings');
        }
    }
    
    function loadSettings() {
        try {
            const saved = sessionStorage.getItem('quizSettings');
            if (saved) {
                state.settings = { ...state.settings, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Không thể load settings');
        }
    }
    
    function applySettings() {
        if (state.settings.darkMode) {
            document.body.classList.add('dark-mode');
            document.getElementById('darkModeToggle').classList.add('active');
        }
        if (state.settings.timerEnabled) {
            document.getElementById('timerToggle').classList.add('active');
        }
        if (state.settings.shuffleQuestions) {
            document.getElementById('shuffleToggle').classList.add('active');
        }
        if (state.settings.shuffleAnswers) {
            document.getElementById('shuffleAnswersToggle').classList.add('active');
        }
        document.getElementById('timeLimit').value = state.settings.timeLimit;
        document.getElementById('timeLimit').addEventListener('change', saveSettings);
    }
    
    function saveHistory() {
        if (state.history.length > 50) {
            state.history = state.history.slice(0, 50);
        }
        try {
            sessionStorage.setItem('quizHistory', JSON.stringify(state.history));
        } catch (e) {
            console.warn('Không thể lưu lịch sử');
        }
    }
    
    function loadHistory() {
        try {
            const saved = sessionStorage.getItem('quizHistory');
            if (saved) state.history = JSON.parse(saved);
        } catch (e) {
            state.history = [];
        }
    }

    // ===================================
    // UTILITIES
    // ===================================
    
    function copyJsonFormat(event) {
        const text = document.getElementById('jsonFormat').textContent;
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Đã copy!');
            const btn = event.target;
            const original = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            setTimeout(() => btn.innerHTML = original, 2000);
        }).catch(() => showToast('❌ Không thể copy', 'error'));
    }

    // ===================================
    // KEYBOARD SHORTCUTS
    // ===================================
    
    function setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            const quizActive = document.querySelector('.quiz-screen').classList.contains('active');
            const reviewActive = document.querySelector('.review-screen').classList.contains('active');
            
            if (quizActive) {
                handleQuizKeyboard(e);
            } else if (reviewActive) {
                handleReviewKeyboard(e);
            }
        });
    }
    
    function handleQuizKeyboard(e) {
        // Navigate questions
        if (e.key === 'ArrowLeft' && state.currentQuestionIndex > 0) {
            e.preventDefault();
            prevQuestion();
        } else if (e.key === 'ArrowRight' && state.currentQuestionIndex < state.questions.length - 1) {
            e.preventDefault();
            nextQuestion();
        }
        // Select answer with numbers 1-4
        else if (e.key >= '1' && e.key <= '4') {
            e.preventDefault();
            const index = parseInt(e.key) - 1;
            if (index < state.questions[state.currentQuestionIndex].answers.length) {
                selectAnswer(index);
            }
        }
        // Select answer with letters A-D
        else if (e.key.toUpperCase() >= 'A' && e.key.toUpperCase() <= 'D') {
            e.preventDefault();
            const index = e.key.toUpperCase().charCodeAt(0) - 65;
            if (index < state.questions[state.currentQuestionIndex].answers.length) {
                selectAnswer(index);
            }
        }
        // Navigate answers with arrow keys
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const current = state.userAnswers[state.currentQuestionIndex];
            if (current !== null && current > 0) {
                selectAnswer(current - 1);
            } else if (current === null) {
                selectAnswer(state.questions[state.currentQuestionIndex].answers.length - 1);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const current = state.userAnswers[state.currentQuestionIndex];
            const maxIndex = state.questions[state.currentQuestionIndex].answers.length - 1;
            if (current !== null && current < maxIndex) {
                selectAnswer(current + 1);
            } else if (current === null) {
                selectAnswer(0);
            }
        }
        // Bookmark (B key)
        else if (e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleBookmark();
        }
        // Submit (Enter at last question)
        else if (e.key === 'Enter' && state.currentQuestionIndex === state.questions.length - 1) {
            e.preventDefault();
            submitQuiz();
        }
    }
    
    function handleReviewKeyboard(e) {
        if (e.key === 'ArrowLeft' && state.currentQuestionIndex > 0) {
            e.preventDefault();
            prevReviewQuestion();
        } else if (e.key === 'ArrowRight' && state.currentQuestionIndex < state.questions.length - 1) {
            e.preventDefault();
            nextReviewQuestion();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitReview();
        }
    }

    // ===================================
    // INITIALIZATION
    // ===================================
    
    function init() {
        loadHistory();
        loadSettings();
        applySettings();
        displayHistory();
        setupFileUpload();
        setupKeyboard();
        
        // Prevent accidental page reload
        window.addEventListener('beforeunload', (e) => {
            const quizActive = document.querySelector('.quiz-screen').classList.contains('active');
            if (quizActive && state.userAnswers.some(a => a !== null)) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    // ===================================
    // PUBLIC API
    // ===================================
    
    return {
        init,
        startQuiz,
        selectAnswer,
        prevQuestion,
        nextQuestion,
        toggleBookmark,
        submitQuiz,
        retryWrong,
        retryAll,
        goHome,
        reviewAnswers,
        prevReviewQuestion,
        nextReviewQuestion,
        exitReview,
        toggleDarkMode,
        toggleTimer,
        toggleShuffle,
        toggleShuffleAnswers,
        copyJsonFormat,
        exportHistory,
        filterHistory,
        clearHistory
    };
})();

// ===================================
// INITIALIZE APPLICATION
// ===================================
window.addEventListener('DOMContentLoaded', () => {
    window.app = QuizApp;
    QuizApp.init();
});